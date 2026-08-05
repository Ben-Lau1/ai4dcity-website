'use strict';

const GRID_SIZE = 2;
const LOAD_RADIUS = 42;
const ACTIVE_NODE_COUNT = 2;
const MAX_CACHED_NODES = 4;
const UPDATE_INTERVAL_MS = 400;
const RETRY_DELAY_MS = 4000;
const MAX_GROUND_DELTA = 6;
const MIN_UP_NORMAL = 0.55;
const MAX_GRID_CELLS_PER_TRIANGLE = 256;
const PARSE_SLICE_BUDGET_MS = 4;
const PATH_CORRIDOR_RADIUS = 24;
const MAX_PATH_SEGMENT_LENGTH = 45;
const PARSE_ABORTED = 'COLLISION_PARSE_ABORTED';

const TYPES = {
  char: { bytes: 1, getter: 'getInt8' },
  int8: { bytes: 1, getter: 'getInt8' },
  uchar: { bytes: 1, getter: 'getUint8' },
  uint8: { bytes: 1, getter: 'getUint8' },
  short: { bytes: 2, getter: 'getInt16' },
  int16: { bytes: 2, getter: 'getInt16' },
  ushort: { bytes: 2, getter: 'getUint16' },
  uint16: { bytes: 2, getter: 'getUint16' },
  int: { bytes: 4, getter: 'getInt32' },
  int32: { bytes: 4, getter: 'getInt32' },
  uint: { bytes: 4, getter: 'getUint32' },
  uint32: { bytes: 4, getter: 'getUint32' },
  float: { bytes: 4, getter: 'getFloat32' },
  float32: { bytes: 4, getter: 'getFloat32' },
  double: { bytes: 8, getter: 'getFloat64' },
  float64: { bytes: 8, getter: 'getFloat64' },
};

function typeInfo(name) {
  const info = TYPES[String(name || '').toLowerCase()];
  if (!info) throw new Error(`Unsupported PLY type ${name}`);
  return info;
}

function readScalar(view, offset, type) {
  const info = typeInfo(type);
  return info.bytes === 1
    ? view[info.getter](offset)
    : view[info.getter](offset, true);
}

function headerOf(bytes) {
  const marker = [101, 110, 100, 95, 104, 101, 97, 100, 101, 114];
  let markerOffset = -1;
  const searchLength = Math.min(bytes.length - marker.length, 65536);
  for (let offset = 0; offset <= searchLength; offset += 1) {
    let matches = true;
    for (let index = 0; index < marker.length; index += 1) {
      if (bytes[offset + index] !== marker[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      markerOffset = offset;
      break;
    }
  }
  if (markerOffset < 0) throw new Error('PLY header is incomplete');
  let dataOffset = markerOffset + marker.length;
  while (dataOffset < bytes.length && bytes[dataOffset] !== 10) dataOffset += 1;
  if (dataOffset >= bytes.length) throw new Error('PLY header terminator is incomplete');
  dataOffset += 1;
  let text = '';
  for (let index = 0; index < dataOffset; index += 1) text += String.fromCharCode(bytes[index]);
  return { dataOffset, lines: text.replace(/\r/g, '').trim().split('\n') };
}

function parseLayout(bytes) {
  const header = headerOf(bytes);
  let section = '';
  let vertexCount = 0;
  let faceCount = 0;
  const vertexProperties = [];
  let faceList = null;
  header.lines.forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'format' && parts[1] !== 'binary_little_endian') {
      throw new Error(`Unsupported PLY format ${parts[1]}`);
    }
    if (parts[0] === 'element') {
      section = parts[1];
      if (section === 'vertex') vertexCount = Number(parts[2]) || 0;
      if (section === 'face') faceCount = Number(parts[2]) || 0;
      return;
    }
    if (parts[0] !== 'property') return;
    if (section === 'vertex' && parts[1] !== 'list') {
      vertexProperties.push({ name: parts[2], type: parts[1] });
    } else if (section === 'face' && parts[1] === 'list' && !faceList) {
      faceList = { countType: parts[2], indexType: parts[3] };
    }
  });
  if (!vertexCount || !faceCount || !faceList) throw new Error('PLY mesh layout is incomplete');

  let vertexStride = 0;
  const offsets = {};
  vertexProperties.forEach((property) => {
    offsets[property.name] = { offset: vertexStride, type: property.type };
    vertexStride += typeInfo(property.type).bytes;
  });
  if (!offsets.x || !offsets.y || !offsets.z) throw new Error('PLY position properties are missing');
  return { ...header, faceCount, faceList, offsets, vertexCount, vertexStride };
}

function gridKey(x, z) {
  return `${Math.floor(x / GRID_SIZE)},${Math.floor(z / GRID_SIZE)}`;
}

function triangleGround(triangles, index, x, z) {
  const offset = index * 9;
  const ax = triangles[offset];
  const ay = triangles[offset + 1];
  const az = triangles[offset + 2];
  const bx = triangles[offset + 3];
  const by = triangles[offset + 4];
  const bz = triangles[offset + 5];
  const cx = triangles[offset + 6];
  const cy = triangles[offset + 7];
  const cz = triangles[offset + 8];
  const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(denominator) < 0.000001) return null;
  const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
  const b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
  const c = 1 - a - b;
  if (a < -0.002 || b < -0.002 || c < -0.002) return null;
  return a * ay + b * by + c * cy;
}

function createCollisionMesh(triangles, cells, globalTriangles, triangleCount) {
  return {
    triangleCount,
    sampleGround(position, referenceY) {
      const candidates = cells[gridKey(position[0], position[2])] || [];
      const targetY = Number.isFinite(referenceY) ? referenceY : position[1];
      let closest = null;
      let closestDelta = Infinity;
      const test = (index) => {
        const y = triangleGround(triangles, index, position[0], position[2]);
        if (y === null || !Number.isFinite(y)) return;
        const delta = Math.abs(y - targetY);
        if (delta > MAX_GROUND_DELTA) return;
        if (delta < closestDelta - 0.0001
          || (Math.abs(delta - closestDelta) <= 0.0001 && (closest === null || y > closest))) {
          closest = y;
          closestDelta = delta;
        }
      };
      candidates.forEach(test);
      globalTriangles.forEach(test);
      return closest;
    },
  };
}

function createTriangleAccumulator(vertices, vertexCount, totalTriangles) {
  const triangles = new Float32Array(totalTriangles * 9);
  const cells = Object.create(null);
  const globalTriangles = [];
  let triangleCount = 0;

  function addTriangle(first, second, third) {
    if (first >= vertexCount || second >= vertexCount || third >= vertexCount) return;
    const a = first * 3;
    const b = second * 3;
    const c = third * 3;
    const ax = vertices[a];
    const ay = vertices[a + 1];
    const az = vertices[a + 2];
    const bx = vertices[b];
    const by = vertices[b + 1];
    const bz = vertices[b + 2];
    const cx = vertices[c];
    const cy = vertices[c + 1];
    const cz = vertices[c + 2];
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength < 0.000001 || Math.abs(ny) / normalLength < MIN_UP_NORMAL) return;

    const target = triangleCount * 9;
    triangles[target] = ax;
    triangles[target + 1] = ay;
    triangles[target + 2] = az;
    triangles[target + 3] = bx;
    triangles[target + 4] = by;
    triangles[target + 5] = bz;
    triangles[target + 6] = cx;
    triangles[target + 7] = cy;
    triangles[target + 8] = cz;
    const minCellX = Math.floor(Math.min(ax, bx, cx) / GRID_SIZE);
    const maxCellX = Math.floor(Math.max(ax, bx, cx) / GRID_SIZE);
    const minCellZ = Math.floor(Math.min(az, bz, cz) / GRID_SIZE);
    const maxCellZ = Math.floor(Math.max(az, bz, cz) / GRID_SIZE);
    const coveredCells = (maxCellX - minCellX + 1) * (maxCellZ - minCellZ + 1);
    if (coveredCells > MAX_GRID_CELLS_PER_TRIANGLE) {
      globalTriangles.push(triangleCount);
    } else {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
          const key = `${cellX},${cellZ}`;
          if (!cells[key]) cells[key] = [];
          cells[key].push(triangleCount);
        }
      }
    }
    triangleCount += 1;
  }

  return {
    addTriangle,
    finish() {
      return createCollisionMesh(triangles, cells, globalTriangles, triangleCount);
    },
  };
}

function nextParseSlice() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertParseContinues(shouldContinue) {
  if (!shouldContinue || shouldContinue()) return;
  const error = new Error('Collision mesh parse cancelled');
  error.code = PARSE_ABORTED;
  throw error;
}

function parseCollisionPly(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const layout = parseLayout(bytes);
  const vertices = new Float32Array(layout.vertexCount * 3);
  for (let index = 0; index < layout.vertexCount; index += 1) {
    const source = layout.dataOffset + index * layout.vertexStride;
    const x = readScalar(view, source + layout.offsets.x.offset, layout.offsets.x.type);
    const y = readScalar(view, source + layout.offsets.y.offset, layout.offsets.y.type);
    const z = readScalar(view, source + layout.offsets.z.offset, layout.offsets.z.type);
    const target = index * 3;
    vertices[target] = -x;
    vertices[target + 1] = z;
    vertices[target + 2] = y;
  }

  const countInfo = typeInfo(layout.faceList.countType);
  const indexInfo = typeInfo(layout.faceList.indexType);
  const faceOffset = layout.dataOffset + layout.vertexCount * layout.vertexStride;
  let cursor = faceOffset;
  let totalTriangles = 0;
  for (let face = 0; face < layout.faceCount; face += 1) {
    if (cursor + countInfo.bytes > view.byteLength) throw new Error('PLY face buffer is incomplete');
    const count = readScalar(view, cursor, layout.faceList.countType);
    cursor += countInfo.bytes;
    totalTriangles += Math.max(0, count - 2);
    cursor += count * indexInfo.bytes;
  }
  if (cursor > view.byteLength) throw new Error('PLY face indexes are incomplete');

  const accumulator = createTriangleAccumulator(
    vertices,
    layout.vertexCount,
    totalTriangles,
  );

  cursor = faceOffset;
  for (let face = 0; face < layout.faceCount; face += 1) {
    const count = readScalar(view, cursor, layout.faceList.countType);
    cursor += countInfo.bytes;
    if (count < 3) {
      cursor += count * indexInfo.bytes;
      continue;
    }
    const first = readScalar(view, cursor, layout.faceList.indexType);
    cursor += indexInfo.bytes;
    let previous = readScalar(view, cursor, layout.faceList.indexType);
    cursor += indexInfo.bytes;
    for (let item = 2; item < count; item += 1) {
      const current = readScalar(view, cursor, layout.faceList.indexType);
      cursor += indexInfo.bytes;
      accumulator.addTriangle(first, previous, current);
      previous = current;
    }
  }

  return accumulator.finish();
}

async function parseCollisionPlyAsync(buffer, options = {}) {
  const shouldContinue = typeof options.shouldContinue === 'function'
    ? options.shouldContinue
    : null;
  assertParseContinues(shouldContinue);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const layout = parseLayout(bytes);
  const vertices = new Float32Array(layout.vertexCount * 3);
  let sliceStartedAt = Date.now();

  for (let index = 0; index < layout.vertexCount; index += 1) {
    const source = layout.dataOffset + index * layout.vertexStride;
    const x = readScalar(view, source + layout.offsets.x.offset, layout.offsets.x.type);
    const y = readScalar(view, source + layout.offsets.y.offset, layout.offsets.y.type);
    const z = readScalar(view, source + layout.offsets.z.offset, layout.offsets.z.type);
    const target = index * 3;
    vertices[target] = -x;
    vertices[target + 1] = z;
    vertices[target + 2] = y;
    if ((index & 1023) === 1023 && Date.now() - sliceStartedAt >= PARSE_SLICE_BUDGET_MS) {
      assertParseContinues(shouldContinue);
      await nextParseSlice();
      assertParseContinues(shouldContinue);
      sliceStartedAt = Date.now();
    }
  }

  const countInfo = typeInfo(layout.faceList.countType);
  const indexInfo = typeInfo(layout.faceList.indexType);
  const faceOffset = layout.dataOffset + layout.vertexCount * layout.vertexStride;
  let cursor = faceOffset;
  let totalTriangles = 0;
  for (let face = 0; face < layout.faceCount; face += 1) {
    if (cursor + countInfo.bytes > view.byteLength) throw new Error('PLY face buffer is incomplete');
    const count = readScalar(view, cursor, layout.faceList.countType);
    cursor += countInfo.bytes;
    totalTriangles += Math.max(0, count - 2);
    cursor += count * indexInfo.bytes;
    if ((face & 1023) === 1023 && Date.now() - sliceStartedAt >= PARSE_SLICE_BUDGET_MS) {
      assertParseContinues(shouldContinue);
      await nextParseSlice();
      assertParseContinues(shouldContinue);
      sliceStartedAt = Date.now();
    }
  }
  if (cursor > view.byteLength) throw new Error('PLY face indexes are incomplete');

  const accumulator = createTriangleAccumulator(
    vertices,
    layout.vertexCount,
    totalTriangles,
  );
  cursor = faceOffset;
  for (let face = 0; face < layout.faceCount; face += 1) {
    const count = readScalar(view, cursor, layout.faceList.countType);
    cursor += countInfo.bytes;
    if (count < 3) {
      cursor += count * indexInfo.bytes;
    } else {
      const first = readScalar(view, cursor, layout.faceList.indexType);
      cursor += indexInfo.bytes;
      let previous = readScalar(view, cursor, layout.faceList.indexType);
      cursor += indexInfo.bytes;
      for (let item = 2; item < count; item += 1) {
        const current = readScalar(view, cursor, layout.faceList.indexType);
        cursor += indexInfo.bytes;
        accumulator.addTriangle(first, previous, current);
        previous = current;
      }
    }
    if ((face & 255) === 255 && Date.now() - sliceStartedAt >= PARSE_SLICE_BUDGET_MS) {
      assertParseContinues(shouldContinue);
      await nextParseSlice();
      assertParseContinues(shouldContinue);
      sliceStartedAt = Date.now();
    }
  }
  assertParseContinues(shouldContinue);
  return accumulator.finish();
}

function requestArrayBuffer(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300 || !response.data) {
          reject(new Error(`Collision mesh request failed (${response.statusCode})`));
          return;
        }
        resolve(response.data);
      },
      fail(error) {
        reject(new Error((error && error.errMsg) || 'Collision mesh request failed'));
      },
    });
  });
}

function distanceToBoundsSquaredXZ(position, bounds) {
  const dx = Math.max(bounds.min[0] - position[0], 0, position[0] - bounds.max[0]);
  const dz = Math.max(bounds.min[2] - position[2], 0, position[2] - bounds.max[2]);
  return dx * dx + dz * dz;
}

function buildTrajectoryCorridor(trajectory) {
  const points = (trajectory || []).filter((point) => (
    Array.isArray(point)
    && point.length >= 3
    && point.slice(0, 3).every(Number.isFinite)
  )).map((point) => point.slice(0, 3));
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end[0] - start[0];
    const dz = end[2] - start[2];
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq > 0.0001
      && lengthSq <= MAX_PATH_SEGMENT_LENGTH * MAX_PATH_SEGMENT_LENGTH) {
      segments.push({ dx, dz, end, lengthSq, start });
    }
  }
  return { points, segments };
}

function isWithinTrajectoryCorridor(
  corridor,
  position,
  radius = PATH_CORRIDOR_RADIUS,
) {
  if (!corridor || !position) return false;
  const radiusSq = Math.max(0, Number(radius) || 0) ** 2;
  for (let index = 0; index < corridor.segments.length; index += 1) {
    const segment = corridor.segments[index];
    const relativeX = position[0] - segment.start[0];
    const relativeZ = position[2] - segment.start[2];
    const ratio = Math.max(0, Math.min(
      1,
      (relativeX * segment.dx + relativeZ * segment.dz) / segment.lengthSq,
    ));
    const dx = position[0] - (segment.start[0] + segment.dx * ratio);
    const dz = position[2] - (segment.start[2] + segment.dz * ratio);
    if (dx * dx + dz * dz <= radiusSq) return true;
  }
  for (let index = 0; index < corridor.points.length; index += 1) {
    const dx = position[0] - corridor.points[index][0];
    const dz = position[2] - corridor.points[index][2];
    if (dx * dx + dz * dz <= radiusSq) return true;
  }
  return false;
}

class CollisionController {
  constructor(scene, callbacks = {}) {
    this.nodes = (scene.collision && scene.collision.nodes) || [];
    this.pathCorridor = buildTrajectoryCorridor(scene.trajectory);
    this.pathGroundActive = false;
    this.onError = callbacks.onError || null;
    this.onReady = callbacks.onReady || null;
    this.states = {};
    this.desiredIds = new Set();
    this.loading = false;
    this.lastUpdateAt = 0;
    this.lastPosition = null;
    this.disposed = false;
  }

  update(position, force = false) {
    if (this.disposed || !position || !this.nodes.length) return;
    const now = Date.now();
    const moved = !this.lastPosition
      || Math.hypot(position[0] - this.lastPosition[0], position[2] - this.lastPosition[2]) >= 4;
    if (!force && !moved && now - this.lastUpdateAt < UPDATE_INTERVAL_MS) return;
    this.lastUpdateAt = now;
    this.lastPosition = position.slice();
    this.pathGroundActive = isWithinTrajectoryCorridor(this.pathCorridor, position);
    if (this.pathGroundActive) {
      this.desiredIds.clear();
      return;
    }
    const candidates = this.nodes.map((node) => ({
      node,
      distanceSq: distanceToBoundsSquaredXZ(position, node.bounds),
    })).sort((left, right) => (
      left.distanceSq - right.distanceSq || left.node.face - right.node.face
    ));
    let selected = candidates.filter((candidate) => (
      candidate.distanceSq <= LOAD_RADIUS * LOAD_RADIUS
    )).slice(0, ACTIVE_NODE_COUNT);
    if (!selected.length && candidates.length) selected = candidates.slice(0, 1);
    this.desiredIds = new Set(selected.map((candidate) => candidate.node.id));
    selected.forEach(({ node }) => {
      const state = this.states[node.id];
      if (state) state.lastUsedAt = now;
    });
    this.evict();
    this.pump();
  }

  pump() {
    if (this.disposed || this.loading) return;
    const now = Date.now();
    let node = null;
    this.desiredIds.forEach((id) => {
      if (node) return;
      const state = this.states[id];
      if (!state || (state.failed && state.retryAt <= now)) {
        node = this.nodes.find((candidate) => candidate.id === id);
      }
    });
    if (!node) return;
    const state = {
      failed: false,
      lastUsedAt: now,
      loading: true,
      mesh: null,
      retryAt: 0,
    };
    this.states[node.id] = state;
    this.loading = true;
    requestArrayBuffer(node.url)
      .then((buffer) => {
        if (this.disposed
          || this.states[node.id] !== state
          || !this.desiredIds.has(node.id)) {
          if (this.states[node.id] === state) delete this.states[node.id];
          return null;
        }
        return parseCollisionPlyAsync(buffer, {
          shouldContinue: () => (
            !this.disposed
            && this.states[node.id] === state
            && this.desiredIds.has(node.id)
          ),
        });
      })
      .then((mesh) => {
        if (!mesh || this.disposed || this.states[node.id] !== state) return;
        state.mesh = mesh;
        state.lastUsedAt = Date.now();
        if (this.onReady) this.onReady(node, mesh.triangleCount);
      })
      .catch((error) => {
        if (this.disposed || this.states[node.id] !== state) return;
        if (error && error.code === PARSE_ABORTED) {
          delete this.states[node.id];
          return;
        }
        state.failed = true;
        state.retryAt = Date.now() + RETRY_DELAY_MS;
        if (this.onError) this.onError(error);
      })
      .then(() => {
        if (this.states[node.id] === state) state.loading = false;
        this.loading = false;
        if (!this.disposed) {
          this.evict();
          this.pump();
        }
      });
  }

  sampleGround(position, referenceY) {
    if (this.disposed || !position) return null;
    if (this.pathGroundActive) return null;
    const targetY = Number.isFinite(referenceY) ? referenceY : position[1];
    let closest = null;
    let closestDelta = Infinity;
    Object.values(this.states).forEach((state) => {
      if (!state.mesh) return;
      const y = state.mesh.sampleGround(position, targetY);
      if (y === null || !Number.isFinite(y)) return;
      const delta = Math.abs(y - targetY);
      if (delta < closestDelta - 0.0001
        || (Math.abs(delta - closestDelta) <= 0.0001 && (closest === null || y > closest))) {
        closest = y;
        closestDelta = delta;
      }
    });
    return closest;
  }

  evict() {
    const ready = Object.keys(this.states)
      .filter((id) => !this.desiredIds.has(id) && !this.states[id].loading)
      .sort((left, right) => this.states[left].lastUsedAt - this.states[right].lastUsedAt);
    while (Object.keys(this.states).length > MAX_CACHED_NODES && ready.length) {
      delete this.states[ready.shift()];
    }
  }

  trimCache() {
    Object.keys(this.states).forEach((id) => {
      if (!this.desiredIds.has(id) && !this.states[id].loading) delete this.states[id];
    });
  }

  dispose() {
    this.disposed = true;
    this.states = {};
    this.desiredIds.clear();
  }
}

module.exports = {
  CollisionController,
  buildTrajectoryCorridor,
  isWithinTrajectoryCorridor,
  parseCollisionPly,
  parseCollisionPlyAsync,
};
