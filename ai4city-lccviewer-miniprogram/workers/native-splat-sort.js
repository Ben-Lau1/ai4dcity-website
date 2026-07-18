'use strict';

const BUCKET_COUNT = 65536;
const datasets = {};
const buckets = new Uint32Array(BUCKET_COUNT);
const offsets = new Uint32Array(BUCKET_COUNT);
const DEFAULT_FOV_Y = 55 * Math.PI / 180;
const DEFAULT_FAR = 3000;
const FRUSTUM_GUARD = 24;
let scratchCapacity = 0;
let scratchDepths = new Float32Array(0);
let scratchKeys = new Uint16Array(0);
let scratchVisible = new Uint32Array(0);

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

function initialize(data) {
  const datasetId = data.datasetId || 'root';
  const count = data.count;
  const packed = new Uint8Array(data.meansBuffer);
  if (!count || packed.length < count * 6) {
    throw new Error('Packed means buffer is incomplete');
  }
  const mins = data.mins;
  const maxs = data.maxs;
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
  const { centers, count } = dataset;
  const sampleStride = Math.max(1, Math.floor(Number(data.sampleStride) || 1));
  const sampledCapacity = Math.ceil(count / sampleStride);
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
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  let visibleCount = 0;
  // Preserve the same source-index sample set for every camera direction while
  // avoiding depth work for points that the renderer will not draw.
  for (let index = 0; index < count; index += sampleStride) {
    const offset = index * 3;
    const relativeX = centers[offset] - position[0];
    const relativeY = centers[offset + 1] - position[1];
    const relativeZ = centers[offset + 2] - position[2];
    const depth = relativeX * forward[0] + relativeY * forward[1] + relativeZ * forward[2];
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
      type: 'sorted',
      datasetId,
      generation: data.generation,
      requestId: data.requestId,
      indexesBuffer: new Uint32Array(0).buffer,
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
  worker.postMessage({
    type: 'sorted',
    datasetId,
    generation: data.generation,
    requestId: data.requestId,
    indexesBuffer: result.buffer,
    duration: Date.now() - data.startedAt,
    workerDuration: Date.now() - computeStartedAt,
    totalCount: count,
    visibleCount,
  });
}

worker.onMessage((event) => {
  const data = event && event.message && typeof event.message === 'object'
    ? event.message
    : event;
  if (!data || !data.type) return;
  if (data.type === 'init') initialize(data);
  else if (data.type === 'sort') sort(data);
  else if (data.type === 'release') delete datasets[data.datasetId];
});
