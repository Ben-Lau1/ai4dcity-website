'use strict';

const BUCKET_COUNT = 65536;
const datasets = {};
const pendingInitializations = {};
const pendingResults = {};
const buckets = new Uint32Array(BUCKET_COUNT);
const offsets = new Uint32Array(BUCKET_COUNT);
const DEFAULT_FOV_Y = 55 * Math.PI / 180;
const DEFAULT_FAR = 3000;
const FRUSTUM_GUARD = 24;
const SAMPLE_STRIDE_SCALE = 2;
let scratchCapacity = 0;
let scratchDepths = new Float32Array(0);
let scratchKeys = new Uint16Array(0);
let scratchVisible = new Uint32Array(0);

function normalizeSampleStride(value) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  return Math.max(1, Math.min(12, Math.round(resolved * SAMPLE_STRIDE_SCALE)
    / SAMPLE_STRIDE_SCALE));
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function ensureScratch(count) {
  if (count <= scratchCapacity) return;
  scratchCapacity = Math.ceil(count / 65536) * 65536;
  scratchDepths = new Float32Array(scratchCapacity);
  scratchKeys = new Uint16Array(scratchCapacity);
  scratchVisible = new Uint32Array(scratchCapacity);
}

function decodeCoordinate(value) {
  return Math.sign(value) * (Math.exp(Math.abs(value)) - 1);
}

function initializePacked(datasetId, count, packed, mins, maxs) {
  if (!count || packed.length < count * 6) {
    throw new Error('Packed means buffer is incomplete');
  }
  const centers = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const source = index * 6;
    const target = index * 3;
    const nx = (packed[source] + packed[source + 3] * 256) / 65535;
    const ny = (packed[source + 1] + packed[source + 4] * 256) / 65535;
    const nz = (packed[source + 2] + packed[source + 5] * 256) / 65535;
    const x = decodeCoordinate(mins[0] + (maxs[0] - mins[0]) * nx);
    const y = decodeCoordinate(mins[1] + (maxs[1] - mins[1]) * ny);
    const z = decodeCoordinate(mins[2] + (maxs[2] - mins[2]) * nz);
    centers[target] = -x;
    centers[target + 1] = z;
    centers[target + 2] = y;
  }
  datasets[datasetId] = { centers, count };
  worker.postMessage({ type: 'ready', datasetId, count });
}

function initializeDataset(datasetId, count, buffer, format, mins, maxs) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (format !== 'uint16x3-linear') {
    initializePacked(datasetId, count, bytes, mins, maxs);
    return;
  }
  if (!count || bytes.byteLength !== count * 6) {
    throw new Error('Linear sort centers buffer is incomplete');
  }
  const exactBuffer = bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const resolvedMins = mins.map(Number);
  const scales = maxs.map((value, index) => (
    (Number(value) - resolvedMins[index]) / 65535
  ));
  datasets[datasetId] = {
    count,
    mins: resolvedMins,
    quantized: new Uint16Array(exactBuffer),
    scales,
  };
  worker.postMessage({ type: 'ready', datasetId, count });
}

function initialize(data) {
  const datasetId = data.datasetId || 'root';
  initializeDataset(
    datasetId,
    data.count,
    data.sortDataBuffer || data.meansBuffer,
    data.format || 'packed-log-u8',
    data.mins,
    data.maxs,
  );
}

function beginChunkedInitialization(data) {
  const datasetId = data.datasetId;
  const byteLength = Math.max(0, Math.floor(Number(data.byteLength) || 0));
  if (!datasetId || !byteLength || byteLength < data.count * 6) {
    throw new Error('Chunked packed means metadata is incomplete');
  }
  pendingInitializations[datasetId] = {
    count: data.count,
    format: data.format || 'packed-log-u8',
    maxs: data.maxs,
    mins: data.mins,
    payload: new Uint8Array(byteLength),
    received: 0,
  };
}

function appendInitializationChunk(data) {
  const pending = pendingInitializations[data.datasetId];
  if (!pending) return;
  const chunk = new Uint8Array(data.sortDataBuffer || data.meansBuffer);
  const offset = Math.max(0, Math.floor(Number(data.offset) || 0));
  if (offset + chunk.length > pending.payload.length) {
    throw new Error('Chunked packed means payload exceeds its allocation');
  }
  pending.payload.set(chunk, offset);
  pending.received += chunk.length;
  if (pending.received < pending.payload.length) return;
  delete pendingInitializations[data.datasetId];
  initializeDataset(
    data.datasetId,
    pending.count,
    pending.payload,
    pending.format,
    pending.mins,
    pending.maxs,
  );
}

function makeFrustum(forward, aspect, fovY, padding) {
  const direction = normalize(forward);
  const right = normalize(cross(direction, [0, 1, 0]));
  const up = normalize(cross(right, direction));
  const maxHalfAngle = Math.PI * 0.495;
  const verticalHalfAngle = Math.min(maxHalfAngle, fovY * 0.5 + padding);
  const horizontalHalfAngle = Math.min(
    maxHalfAngle,
    Math.atan(Math.tan(fovY * 0.5) * aspect) + padding,
  );
  return {
    forward: direction,
    horizontalTan: Math.tan(horizontalHalfAngle),
    right,
    up,
    verticalTan: Math.tan(verticalHalfAngle),
  };
}

function insideFrustum(relativeX, relativeY, relativeZ, frustum, far) {
  const depth = relativeX * frustum.forward[0]
    + relativeY * frustum.forward[1]
    + relativeZ * frustum.forward[2];
  if (depth + FRUSTUM_GUARD < 0.1 || depth - FRUSTUM_GUARD > far) return false;
  const horizontal = Math.abs(
    relativeX * frustum.right[0]
      + relativeY * frustum.right[1]
      + relativeZ * frustum.right[2],
  );
  const vertical = Math.abs(
    relativeX * frustum.up[0]
      + relativeY * frustum.up[1]
      + relativeZ * frustum.up[2],
  );
  const projectedDepth = Math.max(depth, 0);
  return horizontal <= projectedDepth * frustum.horizontalTan + FRUSTUM_GUARD
    && vertical <= projectedDepth * frustum.verticalTan + FRUSTUM_GUARD;
}

function sort(data) {
  const computeStartedAt = Date.now();
  const datasetId = data.datasetId || 'root';
  const dataset = datasets[datasetId];
  if (!dataset) return;
  delete pendingResults[datasetId];
  const {
    centers, count, mins, quantized, scales,
  } = dataset;
  const sampleStride = normalizeSampleStride(data.sampleStride);
  const sampleStrideUnits = Math.round(sampleStride * SAMPLE_STRIDE_SCALE);
  const sampledCapacity = Math.ceil(count * SAMPLE_STRIDE_SCALE / sampleStrideUnits);
  ensureScratch(sampledCapacity);
  const depths = scratchDepths;
  const keys = scratchKeys;
  const visible = scratchVisible;
  const position = data.position;
  const forward = normalize(data.forward);
  const aspect = Math.max(0.1, Number(data.aspect) || 1);
  const fovY = Number(data.fovY) || DEFAULT_FOV_Y;
  const padding = Math.max(0, Number(data.frustumPadding) || 0);
  const currentFrustum = makeFrustum(forward, aspect, fovY, padding);
  const predictedFrustum = data.predictedForward
    ? makeFrustum(data.predictedForward, aspect, fovY, padding)
    : null;
  const far = Number(data.far) || DEFAULT_FAR;
  const cullToFrustum = data.cullToFrustum !== false;
  const enableDepthSorting = data.enableDepthSorting === true;
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  let visibleCount = 0;
  // Preserve the same source-index sample set for every camera direction while
  // avoiding depth work for points that the renderer will not draw.
  for (let sample = 0; sample < sampledCapacity; sample += 1) {
    const intervalStart = Math.floor(
      sample * sampleStrideUnits / SAMPLE_STRIDE_SCALE,
    );
    const intervalEnd = Math.min(
      count,
      Math.floor((sample + 1) * sampleStrideUnits / SAMPLE_STRIDE_SCALE),
    );
    const intervalSize = Math.max(1, intervalEnd - intervalStart);
    const stableHash = Math.imul(sample + 1, 0x9e3779b1) >>> 0;
    const index = intervalStart + (stableHash % intervalSize);
    if (index >= count) break;
    const offset = index * 3;
    const centerX = quantized
      ? mins[0] + quantized[offset] * scales[0]
      : centers[offset];
    const centerY = quantized
      ? mins[1] + quantized[offset + 1] * scales[1]
      : centers[offset + 1];
    const centerZ = quantized
      ? mins[2] + quantized[offset + 2] * scales[2]
      : centers[offset + 2];
    const relativeX = centerX - position[0];
    const relativeY = centerY - position[1];
    const relativeZ = centerZ - position[2];
    // H5 defaults to radial ordering and only re-sorts after translation. It
    // keeps an already clear view intact through pure camera rotations.
    const depth = enableDepthSorting
      ? relativeX * forward[0] + relativeY * forward[1] + relativeZ * forward[2]
      : relativeX * relativeX + relativeY * relativeY + relativeZ * relativeZ;
    if (cullToFrustum) {
      const visibleNow = insideFrustum(
        relativeX,
        relativeY,
        relativeZ,
        currentFrustum,
        far,
      );
      const visibleSoon = predictedFrustum && insideFrustum(
        relativeX,
        relativeY,
        relativeZ,
        predictedFrustum,
        far,
      );
      if (!visibleNow && !visibleSoon) continue;
    }
    visible[visibleCount] = index;
    depths[visibleCount] = depth;
    visibleCount += 1;
    if (depth < minDepth) minDepth = depth;
    if (depth > maxDepth) maxDepth = depth;
  }

  if (!visibleCount) {
    worker.postMessage({
      type: 'sorted-start',
      datasetId,
      generation: data.generation,
      requestId: data.requestId,
      duration: Date.now() - data.startedAt,
      workerDuration: Date.now() - computeStartedAt,
      totalCount: count,
      visibleCount: 0,
    });
    return;
  }

  buckets.fill(0);
  const scale = (BUCKET_COUNT - 1) / Math.max(maxDepth - minDepth, 0.0001);
  for (let item = 0; item < visibleCount; item += 1) {
    const key = Math.max(0, Math.min(
      BUCKET_COUNT - 1,
      Math.floor((depths[item] - minDepth) * scale),
    ));
    keys[item] = key;
    buckets[key] += 1;
  }

  let cursor = 0;
  for (let bucket = BUCKET_COUNT - 1; bucket >= 0; bucket -= 1) {
    offsets[bucket] = cursor;
    cursor += buckets[bucket];
  }
  const result = new Uint32Array(visibleCount);
  for (let item = 0; item < visibleCount; item += 1) {
    const index = visible[item];
    const key = keys[item];
    result[offsets[key]] = index;
    offsets[key] += 1;
  }
  pendingResults[datasetId] = {
    generation: data.generation,
    nextOffset: 0,
    requestId: data.requestId,
    result,
  };
  worker.postMessage({
    type: 'sorted-start',
    datasetId,
    generation: data.generation,
    requestId: data.requestId,
    duration: Date.now() - data.startedAt,
    workerDuration: Date.now() - computeStartedAt,
    totalCount: count,
    visibleCount,
  });
}

function sendResultChunk(data) {
  const pending = pendingResults[data.datasetId];
  if (!pending
    || pending.generation !== data.generation
    || pending.requestId !== data.requestId) return;
  const maxCount = Math.max(
    1,
    Math.min(65536, Math.floor(Number(data.maxCount) || 32768)),
  );
  const offset = pending.nextOffset;
  const end = Math.min(pending.result.length, offset + maxCount);
  const chunk = pending.result.slice(offset, end);
  pending.nextOffset = end;
  const done = end >= pending.result.length;
  if (done) delete pendingResults[data.datasetId];
  worker.postMessage({
    type: 'sorted-chunk',
    datasetId: data.datasetId,
    generation: data.generation,
    requestId: data.requestId,
    offset,
    indexesBuffer: chunk.buffer,
    done,
  });
}

worker.onMessage((event) => {
  const data = event && event.message && typeof event.message === 'object'
    ? event.message
    : event;
  if (!data || !data.type) return;
  if (data.type === 'init') initialize(data);
  else if (data.type === 'init-start') beginChunkedInitialization(data);
  else if (data.type === 'init-chunk') appendInitializationChunk(data);
  else if (data.type === 'sort') sort(data);
  else if (data.type === 'result-chunk') sendResultChunk(data);
  else if (data.type === 'discard-result') {
    const pending = pendingResults[data.datasetId];
    if (pending
      && pending.generation === data.generation
      && pending.requestId === data.requestId) {
      delete pendingResults[data.datasetId];
    }
  }
  else if (data.type === 'release') {
    delete datasets[data.datasetId];
    delete pendingInitializations[data.datasetId];
    delete pendingResults[data.datasetId];
  }
});
