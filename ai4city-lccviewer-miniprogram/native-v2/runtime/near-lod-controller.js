'use strict';

const {
  cacheSogPayload,
  cleanupAssets,
  cleanupSogPayload,
  decodeSogPayload,
  fetchSogPayload,
} = require('./range-loader');
const { cameraWithinSortCoverage } = require('./camera-sort-policy');
const { normalizeSampleStride } = require('./sample-stride');
const { SplatRenderer } = require('./splat-renderer');

// The largest shipped near node contains 387,507 splats. Keep it selectable while
// making the advertised cap real for every node, including the first candidate.
const DETAIL_POINT_BUDGET = 1400000;
const DETAIL_RADIUS = 360;
const FINE_DETAIL_RADIUS = 220;
const PREFETCH_DISTANCES = [180, 420, 760, 1100];
const PREFETCH_RADIUS = 440;
const PREFETCH_NODE_COUNT = 12;
const PREFETCH_FILE_COUNT = 10;
const PREFETCH_FINE_FILE_COUNT = 2;
const DETAIL_FOV_Y = 55 * Math.PI / 180;
const DETAIL_FAR = 3000;
const PREFETCH_INSTALL_FILE_COUNT = 8;
const FAST_PREFETCH_FILE_COUNT = 2;
const STARTUP_WARM_MULTIPLIER = 3;
const MIN_STARTUP_WARM_FILES = 14;
const MAX_STARTUP_PREFETCH_FILES = 14;
const STARTUP_PATH_DISTANCE = 1400;
const STARTUP_PATH_SAMPLE_SPACING = 45;
const STARTUP_PATH_NODE_COUNT = 3;
const STARTUP_PATH_FILE_COUNT = 16;
const STARTUP_FAST_PATH_FILE_COUNT = 9;
const MAX_CACHED_DETAIL_FILES = 8;
const MAX_WARM_FAST_PATHS = 3;
const MAX_CONCURRENT_DETAIL_LOADS = 4;
const MAX_CONCURRENT_BACKGROUND_LOADS = 1;
const MAX_CONCURRENT_DETAIL_DECODES = 1;
const MAX_PENDING_DETAIL_INSTALLS = 2;
const MAX_BUFFERED_DETAIL_FILES = 10;
const RETRY_DELAY_MS = 2000;
const MAX_RESIDENT_LOAD_RETRIES = 3;
const SELECTION_UPDATE_INTERVAL_MS = 250;
const SELECTION_POSITION_THRESHOLD_SQ = 4;
const FULL_RESIDENT_MODE = false;
const RESIDENT_PAYLOAD_PRELOAD = false;
const EMPTY_INDEXES = new Uint32Array(0);

function uniqueFileOrder(fileIds) {
  const seen = new Set();
  const result = [];
  (fileIds || []).forEach((fileId) => {
    const normalized = String(fileId);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

function buildStartupWarmFileOrder(primaryFileIds, prefetchedFileIds) {
  const primary = uniqueFileOrder(primaryFileIds);
  const prefetched = uniqueFileOrder(prefetchedFileIds)
    .filter((fileId) => !primary.includes(fileId));
  const targetCount = Math.min(
    primary.length + MAX_STARTUP_PREFETCH_FILES,
    Math.max(primary.length * STARTUP_WARM_MULTIPLIER, MIN_STARTUP_WARM_FILES),
  );
  return [
    ...primary,
    ...prefetched.slice(0, Math.max(0, targetCount - primary.length)),
  ];
}

function sampleTrajectoryByDistance(trajectory, maxDistance, spacing) {
  const points = (trajectory || []).filter((point) => (
    Array.isArray(point)
    && point.length >= 3
    && point.slice(0, 3).every(Number.isFinite)
  ));
  if (!points.length) return [];
  const samples = [points[0].slice(0, 3)];
  const limit = Math.max(0, Number(maxDistance) || 0);
  const step = Math.max(1, Number(spacing) || 1);
  let traversed = 0;
  let nextSample = step;
  for (let index = 1; index < points.length && traversed < limit; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = Math.hypot(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    );
    if (segmentLength < 0.0001) continue;
    while (nextSample <= Math.min(limit, traversed + segmentLength)) {
      const ratio = (nextSample - traversed) / segmentLength;
      samples.push([
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
        start[2] + (end[2] - start[2]) * ratio,
      ]);
      nextSample += step;
    }
    traversed += segmentLength;
  }
  return samples;
}

function buildStartupPathFileOrder(scene, maxFiles = STARTUP_PATH_FILE_COUNT) {
  const nodes = (scene && scene.nearLod && scene.nearLod.nodes) || [];
  if (!nodes.length) return [];
  const samples = sampleTrajectoryByDistance(
    scene.trajectory,
    STARTUP_PATH_DISTANCE,
    STARTUP_PATH_SAMPLE_SPACING,
  );
  const result = [];
  const seen = new Set();
  const addFile = (fileId) => {
    const normalized = String(fileId);
    if (!normalized || seen.has(normalized) || result.length >= maxFiles) return;
    seen.add(normalized);
    result.push(normalized);
  };
  samples.forEach((position) => {
    if (result.length >= maxFiles) return;
    const nearest = nodes
      .map((node) => ({ node, distanceSq: distanceToBoundsSquared(position, node.bounds) }))
      .sort((left, right) => left.distanceSq - right.distanceSq)
      .slice(0, STARTUP_PATH_NODE_COUNT)
      .map((candidate) => candidate.node);
    nearest.forEach((node) => {
      (node.detail || []).forEach((range) => addFile(range.file));
    });
    nearest.forEach((node) => {
      (node.detail || []).forEach((range) => {
        (range.finer || []).forEach((finer) => addFile(finer.file));
      });
    });
  });
  return result;
}

function distanceToBoundsSquared(position, bounds) {
  let result = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = Math.max(
      bounds.min[axis] - position[axis],
      0,
      position[axis] - bounds.max[axis],
    );
    result += delta * delta;
  }
  return result;
}

function lodPositionOf(camera) {
  if (!camera) return null;
  const candidate = Array.isArray(camera.lodPosition)
    ? camera.lodPosition
    : camera.position;
  if (!Array.isArray(candidate)
    || candidate.length < 3
    || !candidate.slice(0, 3).every(Number.isFinite)) return null;
  return candidate;
}

function boundsSphere(bounds) {
  const center = [0, 1, 2].map(
    (axis) => (bounds.min[axis] + bounds.max[axis]) * 0.5,
  );
  const radius = Math.hypot(
    bounds.max[0] - center[0],
    bounds.max[1] - center[1],
    bounds.max[2] - center[2],
  );
  return { center, radius };
}

function mergeRangeBounds(ranges) {
  const valid = (ranges || []).filter((range) => (
    range
      && range.bounds
      && Array.isArray(range.bounds.min)
      && Array.isArray(range.bounds.max)
  ));
  if (!valid.length) return null;
  const bounds = {
    min: valid[0].bounds.min.slice(),
    max: valid[0].bounds.max.slice(),
  };
  valid.slice(1).forEach((range) => {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], range.bounds.min[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], range.bounds.max[axis]);
    }
  });
  return bounds;
}

function boundsDepthInterval(camera, bounds) {
  if (!camera || !bounds) return { far: 0, near: 0 };
  const forward = camera.forward || [0, 0, -1];
  const forwardLength = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  let near = 0;
  let far = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = (bounds.min[axis] - camera.position[axis])
      * forward[axis] / forwardLength;
    const maximum = (bounds.max[axis] - camera.position[axis])
      * forward[axis] / forwardLength;
    near += Math.min(minimum, maximum);
    far += Math.max(minimum, maximum);
  }
  return { far, near };
}

function boundsFarDepth(camera, bounds) {
  return boundsDepthInterval(camera, bounds).far;
}

function screenMetrics(camera, bounds, width, height) {
  const sphere = boundsSphere(bounds);
  const position = camera.position || [0, 0, 0];
  const forward = camera.forward || [0, 0, -1];
  const offset = [
    sphere.center[0] - position[0],
    sphere.center[1] - position[1],
    sphere.center[2] - position[2],
  ];
  const depth = offset[0] * forward[0]
    + offset[1] * forward[1]
    + offset[2] * forward[2];
  const far = Number(camera.far) || DETAIL_FAR;
  if (depth + sphere.radius <= 0 || depth - sphere.radius >= far) {
    return { area: 0, depth, visible: false };
  }
  const horizontalForward = Math.hypot(forward[0], forward[2]) || 1;
  const right = [
    forward[2] / horizontalForward,
    0,
    -forward[0] / horizontalForward,
  ];
  const horizontal = Math.abs(offset[0] * right[0] + offset[2] * right[2]);
  const vertical = Math.abs(offset[1]);
  const fovY = Number(camera.fovY) || DETAIL_FOV_Y;
  const viewportWidth = Math.max(1, Number(width) || 1080);
  const viewportHeight = Math.max(1, Number(height) || 1920);
  const aspect = Number(camera.aspect) || viewportWidth / viewportHeight;
  const margin = 15 * Math.PI / 180;
  const halfHeight = Math.max(0, depth) * Math.tan(fovY * 0.5 + margin) + sphere.radius;
  const halfWidth = halfHeight * aspect + sphere.radius;
  const visible = horizontal <= halfWidth && vertical <= halfHeight;
  if (!visible) return { area: 0, depth, visible: false };
  const focalPixels = viewportHeight / (2 * Math.tan(fovY * 0.5));
  const radiusPixels = focalPixels * sphere.radius / Math.max(1, depth - sphere.radius);
  const area = Math.min(
    Math.PI * radiusPixels * radiusPixels,
    viewportWidth * viewportHeight,
  );
  return { area, depth, visible: true };
}

function densityErrorPixels(area, pointTotal, stride) {
  const effectivePoints = Math.max(1, pointTotal / Math.max(1, stride));
  return Math.sqrt(Math.max(0, area) / effectivePoints);
}

function pointCount(node) {
  return node.detail.reduce((sum, range) => sum + range.count, 0);
}

function rangePointCount(ranges) {
  if (Array.isArray(ranges)) {
    return ranges.reduce((sum, range) => sum + (Number(range && range.count) || 0), 0);
  }
  return Number(ranges && ranges.count) || 0;
}

function rangesSignature(ranges) {
  return (ranges || []).slice()
    .sort((left, right) => left.start - right.start || left.count - right.count)
    .map((range) => `${range.start}:${range.count}`)
    .join('|');
}

function rangeKey(range) {
  return `${String(range.file)}:${Number(range.start) || 0}:${Number(range.count) || 0}`;
}

function makeRangeMask(ranges, sourceCount) {
  const count = Math.max(0, Math.floor(Number(sourceCount) || 0));
  const mask = new Uint8Array(count);
  (ranges || []).forEach((range) => {
    if (!range || range.count <= 0) return;
    const start = Math.max(0, Math.min(count, Math.floor(Number(range.start) || 0)));
    const end = Math.max(start, Math.min(count, start + Math.floor(Number(range.count) || 0)));
    if (end > start) mask.fill(1, start, end);
  });
  return mask;
}

function filterIndexesByMask(indexes, mask, keepMarked, scratch) {
  if (!indexes || !indexes.length) {
    return { indexes: new Uint32Array(0), scratch };
  }
  const output = scratch && scratch.length >= indexes.length
    ? scratch
    : new Uint32Array(indexes.length);
  let count = 0;
  for (let item = 0; item < indexes.length; item += 1) {
    const index = indexes[item];
    const marked = index < mask.length && mask[index] !== 0;
    if (marked === keepMarked) {
      output[count] = index;
      count += 1;
    }
  }
  return { indexes: output.subarray(0, count), scratch: output };
}

class NearLodController {
  constructor(options) {
    this.canvas = options.canvas;
    this.gl = options.gl;
    this.width = options.width;
    this.height = options.height;
    this.scene = options.scene;
    this.baseRenderer = options.baseRenderer;
    this.sortController = options.sortController;
    this.samplingStride = normalizeSampleStride(options.samplingStride);
    this.detailStride = normalizeSampleStride(
      options.detailSamplingStride,
      Math.max(1, this.samplingStride - 3),
    );
    this.detailPointBudget = Math.max(
      400000,
      Math.min(DETAIL_POINT_BUDGET, Number(options.detailPointBudget) || DETAIL_POINT_BUDGET),
    );
    this.fineReserveRatio = Math.max(
      0,
      Math.min(0.6, Number(options.fineReserveRatio) || 0),
    );
    this.onActiveCount = options.onActiveCount || null;
    this.onStatus = options.onStatus || null;
    this.onError = options.onError || null;
    this.onSortStale = options.onSortStale || null;
    this.onResidentProgress = options.onResidentProgress || null;
    this.states = {};
    this.selectedIds = [];
    this.selectedFineIds = [];
    this.selectedFineRanges = [];
    this.committedIds = [];
    this.committedFineIds = [];
    this.committedFineRanges = [];
    this.committedFileIds = new Set();
    this.visibleIds = [];
    this.selectedFileIds = new Set();
    this.prefetchedRangesByFile = Object.create(null);
    this.primaryFileIds = new Set();
    this.warmFileIds = new Set();
    this.fastPathFileIds = new Set();
    this.residentFileIds = new Set(Object.keys((this.scene.nearLod && this.scene.nearLod.sogs) || {}));
    // Keep the loading mask up while the spawn area and an equally sized
    // forward buffer are decoded, sorted, and installed.
    this.startupWarmFileIds = new Set();
    this.startupSelectionCaptured = false;
    this.residentFailedFileIds = new Set();
    this.sortFailedFileIds = new Set();
    this.fileRetryCounts = {};
    this.residentModeDegraded = false;
    this.residentReady = false;
    this.residentPayloadPreloadStarted = false;
    this.backgroundPreloadTimer = null;
    this.startupVisualCommitted = false;
    this.lastResidentProgressKey = '';
    this.activeRenderFileIds = new Set();
    this.activeRenderBounds = Object.create(null);
    this.activeRefinedCount = 0;
    this.pendingFileIds = [];
    this.pendingDecodeIds = [];
    this.pendingInstallIds = [];
    this.pendingFastPathIds = [];
    this.activeFileLoads = 0;
    this.activeDecodes = 0;
    this.baseIndexes = null;
    this.baseIndexesVersion = 0;
    this.baseIndexStride = this.samplingStride;
    this.residentBaseIndexes = null;
    this.residentBaseIndexesVersion = 0;
    this.residentBaseIndexStride = this.samplingStride;
    this.useResidentBaseFallback = false;
    this.baseAppliedKey = '';
    this.baseAppliedRangesSignature = '';
    this.baseCommittedRangesSignature = '';
    this.baseRequestedKey = '';
    this.baseStagedRangesSignature = '';
    this.baseRangeMask = null;
    this.baseRangeMaskSignature = '';
    this.baseFilterScratch = null;
    this.pendingIndexFilters = Object.create(null);
    this.pendingIndexFilterIds = [];
    this.currentCamera = null;
    this.lastSelectionCamera = null;
    this.prefetchDirection = null;
    this.lastSelectionUpdateAt = 0;
    this.interactionActive = false;
    this.disposed = false;
    if (this.baseRenderer && this.baseRenderer.setIndexStride) {
      this.baseRenderer.setIndexStride(this.samplingStride);
    }
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    Object.values(this.states).forEach((state) => {
      if (state.renderer) state.renderer.setSize(width, height);
      if (state.pendingRenderer) state.pendingRenderer.setSize(width, height);
    });
  }

  detailSamplingStride() {
    return normalizeSampleStride(this.detailStride);
  }

  setInteractionActive(active) {
    const next = !!active;
    if (next === this.interactionActive) return;
    this.interactionActive = next;
    if (next
      && this.sortController
      && typeof this.sortController.cancelDetailRequests === 'function') {
      this.sortController.cancelDetailRequests();
    }
    if (!next) this.pumpFileLoads();
  }

  setSamplingStride(
    stride,
    requestedDetailStride,
    requestedFineReserveRatio,
    requestedDetailPointBudget,
  ) {
    const normalized = normalizeSampleStride(stride);
    const normalizedDetail = normalizeSampleStride(
      requestedDetailStride,
      Math.max(1, normalized - 3),
    );
    const normalizedFineReserve = Math.max(
      0,
      Math.min(0.6, Number(requestedFineReserveRatio) || 0),
    );
    const normalizedDetailPointBudget = Math.max(
      400000,
      Math.min(
        DETAIL_POINT_BUDGET,
        Number(requestedDetailPointBudget) || DETAIL_POINT_BUDGET,
      ),
    );
    if (normalized === this.samplingStride
      && normalizedDetail === this.detailStride
      && normalizedFineReserve === this.fineReserveRatio
      && normalizedDetailPointBudget === this.detailPointBudget) {
      return false;
    }
    this.samplingStride = normalized;
    this.detailStride = normalizedDetail;
    this.fineReserveRatio = normalizedFineReserve;
    this.detailPointBudget = normalizedDetailPointBudget;
    this.lastSelectionCamera = null;
    this.lastSelectionUpdateAt = 0;
    // Existing index lists were sampled by a worker under the previous policy.
    // Keep them and their footprint compensation intact until matching results
    // arrive, then swap the new lists atomically in setBaseIndexes/onSorted.
    return true;
  }

  setBaseIndexes(indexes, options = {}) {
    const sampleStride = normalizeSampleStride(
      options.sampleStride,
      this.samplingStride,
    );
    this.baseIndexes = indexes;
    this.baseIndexesVersion += 1;
    this.baseIndexStride = sampleStride;
    if (options.resident) {
      this.residentBaseIndexes = indexes;
      this.residentBaseIndexesVersion += 1;
      this.residentBaseIndexStride = sampleStride;
      this.useResidentBaseFallback = true;
    } else {
      this.useResidentBaseFallback = false;
    }
    this.applySelection();
    this.notifyResidentProgress();
  }

  isFileSelected(fileId) {
    const normalized = String(fileId);
    return this.selectedFileIds.has(normalized)
      || this.committedFileIds.has(normalized);
  }

  isFileWanted(fileId) {
    const normalized = String(fileId);
    if (FULL_RESIDENT_MODE && !this.residentModeDegraded) {
      return this.residentFileIds.has(normalized);
    }
    if (RESIDENT_PAYLOAD_PRELOAD
      && this.residentReady
      && !this.residentModeDegraded) {
      return this.residentFileIds.has(normalized);
    }
    if (!this.residentReady
      && !this.residentModeDegraded
      && this.startupWarmFileIds.has(normalized)) {
      return true;
    }
    return this.isFileSelected(normalized);
  }

  sortCameraForFile(fileId, requestedCamera) {
    const camera = requestedCamera || this.currentCamera;
    if (!camera) return null;
    const reason = camera.reason || (this.residentReady ? 'settled' : 'initial');
    return {
      ...camera,
      predictedForward: camera.forward.slice(),
      reason,
      sampleStride: this.detailSamplingStride(),
      cullToFrustum: false,
    };
  }

  shouldPrepareFastPath(fileId) {
    return this.fastPathFileIds.has(String(fileId));
  }

  prepareFastPathForState(fileId, state) {
    if (!state || !state.renderer || !this.shouldPrepareFastPath(fileId)) return false;
    if (state.renderer.hasFastPath && state.renderer.hasFastPath()) return true;
    if (state.fastPathAttempted) return false;
    const normalized = String(fileId);
    if (!this.pendingFastPathIds.includes(normalized)) {
      this.pendingFastPathIds.push(normalized);
    }
    return true;
  }

  trimFastPaths(force = false) {
    if (this.disposed) return;
    // Keep compact textures and committed indexes for every visited block, but
    // bound the much larger predecoded fast path. Returning to an older block
    // can render immediately through the compact shader while its fast path is
    // rebuilt in the background.
    const warmFastPaths = Object.keys(this.states)
      .map((fileId) => ({ fileId, state: this.states[fileId] }))
      .filter(({ fileId, state }) => !this.fastPathFileIds.has(fileId)
        && state.renderer
        && state.renderer.hasFastPath())
      .sort((left, right) => (right.state.lastUsedAt || 0) - (left.state.lastUsedAt || 0));
    Object.keys(this.states).forEach((fileId) => {
      const state = this.states[fileId];
      if (!this.fastPathFileIds.has(fileId) && state.renderer) {
        state.renderer.releaseProjectionStorage();
      }
    });
    const retainedWarmFastPaths = force ? 0 : MAX_WARM_FAST_PATHS;
    warmFastPaths.slice(retainedWarmFastPaths).forEach(({ state }) => {
      state.renderer.releaseFastPath();
      state.fastPathAttempted = false;
    });
  }

  flushResidentUploads() {
    // Finish the first visual handoff behind the loading mask. The interactive
    // loop keeps these jobs incremental after startup, but exposing the scene
    // before this atomic plan commits produces a visibly soft first frame.
    this.applySelection();
    this.flushIndexFilters(Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY);
    if (this.baseRenderer) this.baseRenderer.flushIndexUpload(Number.POSITIVE_INFINITY);
    Object.values(this.states).forEach((state) => {
      if (state.renderer) state.renderer.flushIndexUpload(Number.POSITIVE_INFINITY);
    });
    this.applySelection();
  }

  startupVisualReady(hasIssues = false) {
    if (!this.startupSelectionCaptured) return false;
    if (this.pendingIndexFilterIds.some((filterId) => (
      filterId === 'base'
      || this.startupWarmFileIds.has(String(filterId).replace(/^detail:/, ''))
    ))) return false;
    if (this.baseRenderer
      && (this.baseRenderer.pendingIndexUpload || this.baseRenderer.hasStagedIndexes())) {
      return false;
    }
    for (const fileId of this.startupWarmFileIds) {
      const state = this.states[fileId];
      if (state
        && state.renderer
        && (state.renderer.pendingIndexUpload || state.renderer.hasStagedIndexes())) {
        return false;
      }
    }
    for (const fileId of this.startupWarmFileIds) {
      if (!this.shouldPrepareFastPath(fileId)
        || this.residentFailedFileIds.has(fileId)) continue;
      const state = this.states[fileId];
      if (!state || !state.renderer) return false;
      const fastReady = state.renderer.hasFastPath && state.renderer.hasFastPath();
      if (!fastReady && !state.renderer.fastDisabled && !state.fastPathAttempted) {
        return false;
      }
    }
    if (hasIssues) return true;

    const plan = this.buildPlan(this.selectedIds, this.selectedFineRanges);
    if (this.baseCommittedRangesSignature !== rangesSignature(plan.baseRanges)) return false;
    if (this.committedFileIds.size !== plan.fileIds.size) return false;
    for (const fileId of plan.fileIds) {
      const state = this.states[fileId];
      if (!this.committedFileIds.has(fileId)
        || !state
        || state.committedRangesSignature !== plan.signatures[fileId]) return false;
    }
    return true;
  }

  residentPayloadFileOrder() {
    const lodPosition = lodPositionOf(this.currentCamera)
      || (Array.isArray(this.scene.start) ? this.scene.start : [0, 0, 0]);
    const distances = Object.create(null);
    const recordRange = (range, inheritedBounds = null) => {
      if (!range) return;
      const fileId = range.file == null ? '' : String(range.file);
      const bounds = range.bounds || inheritedBounds;
      if (fileId && bounds) {
        const distanceSq = distanceToBoundsSquared(lodPosition, bounds);
        distances[fileId] = distances[fileId] == null
          ? distanceSq
          : Math.min(distances[fileId], distanceSq);
      }
      (range.finer || []).forEach((finer) => recordRange(finer, bounds));
    };
    ((this.scene.nearLod && this.scene.nearLod.nodes) || []).forEach((node) => {
      (node.detail || []).forEach((range) => recordRange(range, node.bounds));
    });
    return Array.from(this.residentFileIds).sort((left, right) => {
      const leftDistance = distances[left] == null ? Number.POSITIVE_INFINITY : distances[left];
      const rightDistance = distances[right] == null ? Number.POSITIVE_INFINITY : distances[right];
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return left.localeCompare(right);
    });
  }

  startResidentPayloadPreload() {
    if (this.disposed
      || this.residentPayloadPreloadStarted
      || this.residentModeDegraded
      || !RESIDENT_PAYLOAD_PRELOAD) return;
    this.residentPayloadPreloadStarted = true;
    this.residentPayloadFileOrder().forEach((fileId) => {
      if (this.states[fileId]
        || this.residentFailedFileIds.has(fileId)
        || this.pendingFileIds.includes(fileId)) return;
      this.pendingFileIds.push(fileId);
    });
    this.pumpFileLoads();
  }

  notifyResidentProgress() {
    const startupIds = Array.from(this.startupWarmFileIds);
    const loaded = startupIds.reduce((count, fileId) => {
      const state = this.states[fileId];
      return count + (state && state.renderer ? 1 : 0);
    }, 0);
    const failed = startupIds.reduce(
      (count, fileId) => count + (this.residentFailedFileIds.has(fileId) ? 1 : 0),
      0,
    );
    const sorted = startupIds.reduce((count, fileId) => {
      const state = this.states[fileId];
      return count + (state && state.sortedIndexes ? 1 : 0);
    }, 0);
    const sortFailed = startupIds.reduce(
      (count, fileId) => count + (
        this.sortFailedFileIds.has(fileId) || this.residentFailedFileIds.has(fileId) ? 1 : 0
      ),
      0,
    );
    const startupComplete = sorted + sortFailed >= startupIds.length;
    const loadComplete = loaded + failed >= startupIds.length;
    const issueIds = new Set(this.residentFailedFileIds);
    startupIds.forEach((fileId) => {
      if (this.sortFailedFileIds.has(fileId)) issueIds.add(fileId);
    });
    const dataReady = this.startupSelectionCaptured && loadComplete && startupComplete;
    if (dataReady && !this.residentReady) {
      this.residentReady = true;
      if (RESIDENT_PAYLOAD_PRELOAD) {
        this.backgroundPreloadTimer = setTimeout(() => {
          this.backgroundPreloadTimer = null;
          if (!this.disposed && this.residentReady) this.startResidentPayloadPreload();
        }, 1500);
      }
    }
    if (dataReady && !this.startupVisualCommitted) {
      const hasIssues = issueIds.size > 0;
      if (!this.startupVisualReady(hasIssues)) {
        // The loading mask must not disappear while a replacement index
        // texture is only partially uploaded. This may run once for detail
        // data and once again when the root sort arrives later.
        this.flushResidentUploads();
      }
      this.startupVisualCommitted = this.startupVisualReady(hasIssues);
    }
    const complete = dataReady && this.startupVisualCommitted;
    const progressKey = [
      complete ? 1 : 0,
      dataReady ? 1 : 0,
      failed,
      issueIds.size,
      loaded,
      sortFailed,
      sorted,
      startupIds.length,
      startupIds.length,
    ].join('/');
    if (progressKey === this.lastResidentProgressKey) return;
    this.lastResidentProgressKey = progressKey;
    if (!this.onResidentProgress) return;
    this.onResidentProgress({
      complete,
      dataReady,
      failed,
      issues: issueIds.size,
      loaded,
      sortFailed,
      sorted,
      sortTotal: startupIds.length,
      total: startupIds.length,
    });
  }

  visibleNodes(camera) {
    const lod = this.scene.nearLod;
    if (!lod || !lod.nodes) return [];
    return lod.nodes.filter(
      (node) => screenMetrics(camera, node.bounds, this.width, this.height).visible,
    );
  }

  selectNodes(camera, visibleNodes) {
    const previous = new Set(this.selectedIds);
    const coarseBudget = this.detailPointBudget * (1 - this.fineReserveRatio);
    const lodPosition = lodPositionOf(camera) || camera.position;
    const candidates = (visibleNodes || []).map((node) => {
      const metrics = screenMetrics(camera, node.bounds, this.width, this.height);
      const detailCount = pointCount(node);
      const baseRangeCount = rangePointCount(node.base);
      const baseCount = baseRangeCount > 0
        ? baseRangeCount
        : Math.max(1, detailCount * 0.25);
      const coarseError = densityErrorPixels(
        metrics.area,
        baseCount,
        normalizeSampleStride(this.samplingStride),
      );
      const refinedError = densityErrorPixels(
        metrics.area,
        detailCount,
        this.detailSamplingStride(),
      );
      const effectiveCost = detailCount / this.detailSamplingStride();
      const benefit = Math.max(0, coarseError - refinedError);
      const keepWeight = previous.has(node.id) ? 1.15 : 1;
      return {
        benefit,
        distanceSq: distanceToBoundsSquared(lodPosition, node.bounds),
        effectiveCost,
        node,
        priority: keepWeight * benefit * Math.max(1, metrics.area)
          / Math.max(1, effectiveCost),
      };
    });
    // Screen-space benefit alone can refine a large distant node while leaving
    // the camera's current block on the coarse root. Reserve the closest node
    // first so a fixed path segment cannot stay blurry despite loaded detail.
    const localCandidate = candidates
      .filter((candidate) => (
        candidate.effectiveCost >= 1000
        && candidate.effectiveCost <= coarseBudget
      ))
      .sort((left, right) => (
        left.distanceSq - right.distanceSq
        || Number(previous.has(right.node.id)) - Number(previous.has(left.node.id))
        || right.priority - left.priority
      ))[0] || null;
    const eligible = candidates
      .filter((candidate) => (
        candidate === localCandidate
        || candidate.benefit >= (previous.has(candidate.node.id) ? 0.08 : 0.12)
      ))
      .sort((left, right) => right.priority - left.priority);
    const selected = [];
    let points = 0;
    if (localCandidate) {
      selected.push(localCandidate.node);
      points += localCandidate.effectiveCost;
    }
    eligible.forEach((candidate) => {
      if (candidate === localCandidate) return;
      if (candidate.effectiveCost < 1000
        || points + candidate.effectiveCost > coarseBudget) return;
      selected.push(candidate.node);
      points += candidate.effectiveCost;
    });
    return selected;
  }

  selectFineRanges(camera, selectedNodes) {
    const previous = new Set(this.selectedFineIds);
    const exitRadiusSq = FINE_DETAIL_RADIUS * FINE_DETAIL_RADIUS * 1.21;
    const lodPosition = lodPositionOf(camera) || camera.position;
    let points = (selectedNodes || []).reduce(
      (sum, node) => sum + pointCount(node) / this.detailSamplingStride(),
      0,
    );
    const candidates = [];
    (selectedNodes || []).forEach((node) => {
      (node.detail || []).forEach((range, rangeIndex) => {
        if (!range.bounds || !range.finer || !range.finer.length) return;
        const distanceSq = distanceToBoundsSquared(lodPosition, range.bounds);
        const id = `${node.id}/${range.id || rangeIndex}`;
        if (distanceSq > (previous.has(id)
          ? exitRadiusSq
          : FINE_DETAIL_RADIUS * FINE_DETAIL_RADIUS)) return;
        const finerCount = rangePointCount(range.finer);
        const delta = (finerCount - range.count) / this.detailSamplingStride();
        if (delta <= 0) return;
        const metrics = screenMetrics(camera, range.bounds, this.width, this.height);
        if (!metrics.visible || metrics.area <= 0) return;
        const coarseError = densityErrorPixels(
          metrics.area,
          range.count,
          this.detailSamplingStride(),
        );
        const fineError = densityErrorPixels(
          metrics.area,
          finerCount,
          this.detailSamplingStride(),
        );
        const benefit = Math.max(0, coarseError - fineError);
        candidates.push({
          benefit,
          id,
          parentId: node.id,
          range,
          distanceSq,
          delta,
          priority: benefit * Math.max(1, metrics.area)
            * (previous.has(id) ? 1.15 : 1)
            / Math.max(1, delta),
        });
      });
    });
    const localCandidate = candidates.slice().sort((left, right) => (
      left.distanceSq - right.distanceSq
      || Number(previous.has(right.id)) - Number(previous.has(left.id))
      || right.priority - left.priority
    ))[0] || null;
    const eligible = candidates
      .filter((candidate) => (
        candidate === localCandidate
        || candidate.benefit >= (previous.has(candidate.id) ? 0.04 : 0.06)
      ))
      .sort((left, right) => right.priority - left.priority);
    const selected = [];
    if (localCandidate && points + localCandidate.delta <= this.detailPointBudget) {
      selected.push(localCandidate);
      points += localCandidate.delta;
    }
    eligible.forEach((candidate) => {
      if (candidate === localCandidate) return;
      if (points + candidate.delta > this.detailPointBudget) return;
      selected.push(candidate);
      points += candidate.delta;
    });
    return selected;
  }

  prefetchNodes(camera, selectedNodes) {
    const selectedIds = new Set((selectedNodes || []).map((node) => node.id));
    const lodPosition = lodPositionOf(camera) || camera.position;
    const sourceDirection = this.prefetchDirection || camera.forward;
    const length = Math.hypot(sourceDirection[0], sourceDirection[2]) || 1;
    const direction = [sourceDirection[0] / length, 0, sourceDirection[2] / length];
    const probes = PREFETCH_DISTANCES.map((distance) => [
      lodPosition[0] + direction[0] * distance,
      lodPosition[1],
      lodPosition[2] + direction[2] * distance,
    ]);
    return (this.scene.nearLod.nodes || [])
      .filter((node) => !selectedIds.has(node.id))
      .map((node) => {
        const distances = probes.map((probe) => distanceToBoundsSquared(probe, node.bounds));
        return { node, distanceSq: Math.min(...distances) };
      })
      .filter((candidate) => candidate.distanceSq <= PREFETCH_RADIUS * PREFETCH_RADIUS)
      .sort((left, right) => left.distanceSq - right.distanceSq)
      .slice(0, PREFETCH_NODE_COUNT)
      .map((candidate) => candidate.node);
  }

  update(camera, force = false) {
    if (this.disposed || !camera) return;
    const lodPosition = lodPositionOf(camera);
    if (!lodPosition) return;
    this.currentCamera = {
      position: camera.position.slice(),
      forward: camera.forward.slice(),
      enableDepthSorting: camera.enableDepthSorting === true,
      lodPosition: lodPosition.slice(),
      aspect: Number(camera.aspect) || Math.max(1, this.width) / Math.max(1, this.height),
      fovY: Number(camera.fovY) || DETAIL_FOV_Y,
      far: Number(camera.far) || DETAIL_FAR,
    };
    const now = Date.now();
    let positionChanged = force || !this.lastSelectionCamera;
    if (!force && this.lastSelectionCamera) {
      const dx = lodPosition[0] - this.lastSelectionCamera.position[0];
      const dy = lodPosition[1] - this.lastSelectionCamera.position[1];
      const dz = lodPosition[2] - this.lastSelectionCamera.position[2];
      const movedSq = dx * dx + dy * dy + dz * dz;
      positionChanged = movedSq >= SELECTION_POSITION_THRESHOLD_SQ;
      if (now - this.lastSelectionUpdateAt < SELECTION_UPDATE_INTERVAL_MS
        || !positionChanged) return;
      const horizontalLength = Math.hypot(dx, dz);
      if (horizontalLength > 0.5) {
        const nextDirection = [dx / horizontalLength, 0, dz / horizontalLength];
        if (this.prefetchDirection) {
          const blend = 0.72;
          const mixedX = this.prefetchDirection[0] * (1 - blend) + nextDirection[0] * blend;
          const mixedZ = this.prefetchDirection[2] * (1 - blend) + nextDirection[2] * blend;
          const mixedLength = Math.hypot(mixedX, mixedZ) || 1;
          this.prefetchDirection = [mixedX / mixedLength, 0, mixedZ / mixedLength];
        } else {
          this.prefetchDirection = nextDirection;
        }
      }
    } else if (!this.prefetchDirection) {
      const forwardLength = Math.hypot(this.currentCamera.forward[0], this.currentCamera.forward[2]) || 1;
      this.prefetchDirection = [
        this.currentCamera.forward[0] / forwardLength,
        0,
        this.currentCamera.forward[2] / forwardLength,
      ];
    }
    this.lastSelectionCamera = {
      position: lodPosition.slice(),
      forward: this.currentCamera.forward.slice(),
    };
    this.lastSelectionUpdateAt = now;
    const visible = this.visibleNodes(this.currentCamera);
    const selected = this.selectNodes(this.currentCamera, visible);
    const selectedFine = this.selectFineRanges(this.currentCamera, selected);
    const prefetched = this.prefetchNodes(this.currentCamera, selected);
    const nextVisibleIds = visible.map((node) => node.id).sort();
    const nextIds = selected.map((node) => node.id).sort();
    const nextFineIds = selectedFine.map((item) => item.id).sort();
    const visibilityChanged = nextVisibleIds.join('|') !== this.visibleIds.join('|');
    const selectionChanged = nextIds.join('|') !== this.selectedIds.join('|')
      || nextFineIds.join('|') !== this.selectedFineIds.join('|');
    this.visibleIds = nextVisibleIds;
    this.selectedIds = nextIds;
    this.selectedFineIds = nextFineIds;
    this.selectedFineRanges = selectedFine;
    const previousSelectedFileSignature = Array.from(this.selectedFileIds).sort().join('|');
    const currentDetailFileIds = new Set();
    const currentFineFileIds = new Set();
    const prefetchedFileIds = new Set();
    const prefetchedFineFileIds = new Set();
    const prefetchedFileOrder = [];
    const prefetchedFineFileOrder = [];
    const prefetchedRangesByFile = Object.create(null);
    const addPrefetchedRange = (range) => {
      const fileId = String(range.file);
      if (!prefetchedRangesByFile[fileId]) prefetchedRangesByFile[fileId] = [];
      if (!prefetchedRangesByFile[fileId].includes(range)) {
        prefetchedRangesByFile[fileId].push(range);
      }
    };
    const addPrefetchedFile = (fileId) => {
      const normalized = String(fileId);
      if (currentDetailFileIds.has(normalized)
        || prefetchedFileIds.has(normalized)
        || prefetchedFileOrder.length >= PREFETCH_FILE_COUNT) return;
      prefetchedFileIds.add(normalized);
      prefetchedFileOrder.push(normalized);
    };
    const addPrefetchedFineFile = (fileId) => {
      const normalized = String(fileId);
      if (currentFineFileIds.has(normalized)
        || prefetchedFineFileIds.has(normalized)
        || prefetchedFineFileOrder.length >= PREFETCH_FINE_FILE_COUNT) return;
      prefetchedFineFileIds.add(normalized);
      prefetchedFineFileOrder.push(normalized);
    };
    selected.forEach((node) => {
      node.detail.forEach((range) => currentDetailFileIds.add(String(range.file)));
    });
    // Load and sort the next depth-5 block before the camera reaches it. It
    // stays out of the draw list until selected.
    prefetched.forEach((node) => {
      node.detail.forEach((range) => {
        addPrefetchedFile(range.file);
        if (prefetchedFileIds.has(String(range.file))) addPrefetchedRange(range);
      });
    });
    // Depth 6 is queued after continuity-critical depth-5 files. Once ready it
    // replaces only its matching depth-5 ranges without creating a hole.
    selectedFine.forEach((item) => {
      item.range.finer.forEach((range) => currentFineFileIds.add(String(range.file)));
    });
    [...selected, ...prefetched].forEach((node) => {
      (node.detail || []).forEach((range) => {
        (range.finer || []).forEach((finer) => {
          addPrefetchedFineFile(finer.file);
          if (prefetchedFineFileIds.has(String(finer.file))) addPrefetchedRange(finer);
        });
      });
    });

    this.primaryFileIds = new Set([...currentDetailFileIds, ...currentFineFileIds]);
    const prefetchedLoadOrder = uniqueFileOrder([
      ...prefetchedFileOrder,
      ...prefetchedFineFileOrder,
    ]);
    if (!this.startupSelectionCaptured) {
      this.startupSelectionCaptured = true;
      const pathFileOrder = buildStartupPathFileOrder(this.scene);
      this.startupWarmFileIds = new Set(buildStartupWarmFileOrder(
        this.primaryFileIds,
        [
          ...prefetchedLoadOrder,
          ...pathFileOrder,
          ...this.residentPayloadFileOrder(),
        ],
      ));
    }
    const warmPrefetchFileIds = prefetchedLoadOrder.slice(0, PREFETCH_INSTALL_FILE_COUNT);
    const fastPrefetchFileIds = prefetchedLoadOrder.slice(0, FAST_PREFETCH_FILE_COUNT);
    this.warmFileIds = new Set([
      ...this.primaryFileIds,
      ...this.committedFileIds,
      ...warmPrefetchFileIds,
      ...(!this.residentReady ? this.startupWarmFileIds : []),
    ]);
    this.fastPathFileIds = new Set([
      ...this.primaryFileIds,
      ...this.committedFileIds,
      ...fastPrefetchFileIds,
      ...(!this.residentReady
        ? Array.from(this.startupWarmFileIds).slice(0, STARTUP_FAST_PATH_FILE_COUNT)
        : []),
    ]);
    this.selectedFileIds = new Set([
      ...currentDetailFileIds,
      ...currentFineFileIds,
      ...prefetchedFileIds,
      ...prefetchedFineFileIds,
    ]);
    this.prefetchedRangesByFile = prefetchedRangesByFile;
    const selectedFilesChanged = Array.from(this.selectedFileIds).sort().join('|')
      !== previousSelectedFileSignature;

    const residentLoadIds = FULL_RESIDENT_MODE && !this.residentModeDegraded
      ? Array.from(this.residentFileIds)
      : [];
    const loadOrder = [
      ...currentDetailFileIds,
      ...currentFineFileIds,
      ...prefetchedFileOrder,
      ...prefetchedFineFileOrder,
      ...(!this.residentReady ? this.startupWarmFileIds : []),
      ...residentLoadIds,
    ];
    this.pendingFileIds = this.pendingFileIds.filter((fileId) => this.isFileWanted(fileId));
    const priorityFileIds = new Set([
      ...currentDetailFileIds,
      ...currentFineFileIds,
    ]);
    new Set(loadOrder).forEach((fileId) => {
      const state = this.states[fileId];
      if (state && this.isFileWanted(fileId)) {
        state.lastUsedAt = Date.now();
        if (this.warmFileIds.has(fileId)) {
          this.queuePendingDecode(fileId, state);
          this.queuePendingInstall(fileId, state);
          this.ensureSortDataset(fileId);
          this.prepareFastPathForState(fileId, state);
        }
      }
      this.queueFile(fileId, priorityFileIds.has(fileId));
    });
    this.evictInactiveStates();
    this.trimFastPaths();
    if (selectionChanged
      || visibilityChanged
      || selectedFilesChanged) this.applySelection();
    this.notifyResidentProgress();
  }

  requestSort(camera, options = {}) {
    // Moving sorts only refresh depth order for the current LOD set. A pure
    // camera rotation must not rebuild the LOD selection or flash fallbacks.
    this.update(camera, options.activeOnly !== true);
    const preloadAll = FULL_RESIDENT_MODE
      && !this.residentModeDegraded
      && !this.residentReady;
    const activeOnlyIds = new Set([
      ...this.activeRenderFileIds,
      ...this.primaryFileIds,
    ]);
    const targetFileIds = preloadAll
      ? this.residentFileIds
      : (options.activeOnly ? activeOnlyIds : this.selectedFileIds);
    const maxDatasets = options.maxDatasets == null
      ? (options.activeOnly ? 1 : Number.POSITIVE_INFINITY)
      : Math.max(1, Math.floor(Number(options.maxDatasets) || 1));
    const candidates = [];
    targetFileIds.forEach((fileId) => {
      const state = this.states[fileId];
      if (!state || !state.renderer || state.failed || state.sortFailed) return;
      this.ensureSortDataset(fileId);
      const sortCamera = this.sortCameraForFile(fileId, camera) || camera;
      if (!state.sortHandle) return;
      const stats = state.sortHandle.getStats();
      if (!stats.ready || stats.busy || stats.queued) return;
      candidates.push({
        fileId,
        needsCoverage: !state.sortedCamera
          || !cameraWithinSortCoverage(sortCamera, state.sortedCamera),
        primary: this.primaryFileIds.has(fileId),
        active: this.activeRenderFileIds.has(fileId),
        requestedAt: state.lastSortRequestedAt || 0,
        sortCamera,
        state,
      });
    });
    candidates.sort((left, right) => (
      Number(right.needsCoverage) - Number(left.needsCoverage)
      || Number(right.primary) - Number(left.primary)
      || Number(right.active) - Number(left.active)
      || left.requestedAt - right.requestedAt
    ));
    let requested = 0;
    for (const candidate of candidates) {
      if (requested >= maxDatasets) break;
      if (!candidate.state.sortHandle.request(candidate.sortCamera)) continue;
      candidate.state.lastSortRequestedAt = Date.now();
      requested += 1;
    }
    return requested;
  }

  activeNodes() {
    const wanted = new Set(this.committedIds);
    return (this.scene.nearLod.nodes || []).filter((node) => {
      return wanted.has(node.id);
    });
  }

  activeFineRanges(activeNodes) {
    const activeParents = new Set((activeNodes || []).map((node) => node.id));
    return this.committedFineRanges.filter((item) => activeParents.has(item.parentId));
  }

  buildPlan(nodeIds, fineRanges) {
    const wanted = new Set(nodeIds || []);
    const nodes = (this.scene.nearLod.nodes || []).filter((node) => wanted.has(node.id));
    const activeParents = new Set(nodes.map((node) => node.id));
    const fine = (fineRanges || []).filter((item) => activeParents.has(item.parentId));
    const replaced = new Set(fine.map((item) => rangeKey(item.range)));
    const rangesByFile = Object.create(null);
    const addRange = (range) => {
      const fileId = String(range.file);
      if (!rangesByFile[fileId]) rangesByFile[fileId] = [];
      rangesByFile[fileId].push(range);
    };
    nodes.forEach((node) => {
      node.detail.forEach((range) => {
        if (!replaced.has(rangeKey(range))) addRange(range);
      });
    });
    fine.forEach((item) => item.range.finer.forEach(addRange));
    const signatures = Object.create(null);
    Object.keys(rangesByFile).forEach((fileId) => {
      signatures[fileId] = rangesSignature(rangesByFile[fileId]);
    });
    return {
      baseRanges: nodes.reduce((ranges, node) => ranges.concat(node.base || []), []),
      fileIds: new Set(Object.keys(rangesByFile)),
      fine,
      nodes,
      rangesByFile,
      signatures,
    };
  }

  queueBaseIndexes(plan) {
    const rangeSignature = rangesSignature(plan.baseRanges);
    const useResident = this.useResidentBaseFallback && this.residentBaseIndexes;
    const sourceIndexes = useResident ? this.residentBaseIndexes : this.baseIndexes;
    if (!sourceIndexes || !this.baseRenderer) return;
    const sourceStride = useResident ? this.residentBaseIndexStride : this.baseIndexStride;
    const sourceVersion = useResident
      ? `resident:${this.residentBaseIndexesVersion}`
      : `sorted:${this.baseIndexesVersion}`;
    const requestKey = `${sourceVersion}/${rangeSignature}/s${sourceStride}`;
    if (this.baseRequestedKey === requestKey) return;
    this.baseRequestedKey = requestKey;
    this.baseRenderer.setIndexStride(sourceStride);
    if (!this.baseRangeMask || rangeSignature !== this.baseRangeMaskSignature) {
      this.baseRangeMask = makeRangeMask(
        plan.baseRanges,
        this.baseRenderer.sourceCount,
      );
      this.baseRangeMaskSignature = rangeSignature;
    }
    const holdCommit = rangeSignature !== this.baseCommittedRangesSignature;
    const scratch = this.baseFilterScratch;
    this.baseFilterScratch = null;
    this.queueIndexFilter(
      'base',
      sourceIndexes,
      this.baseRangeMask,
      false,
      scratch,
      (indexes, output) => {
        if (this.disposed || this.baseRequestedKey !== requestKey) {
          this.returnBaseFilterScratch(output);
          return;
        }
        const release = () => this.returnBaseFilterScratch(output);
        this.baseStagedRangesSignature = rangeSignature;
        this.baseRenderer.updateIndexes(indexes, {
          holdCommit,
          immediate: false,
          preSampled: true,
          onCommitted: () => {
            this.baseCommittedRangesSignature = rangeSignature;
            this.baseAppliedRangesSignature = rangeSignature;
            release();
          },
          onDiscarded: release,
        });
      },
      (output) => this.returnBaseFilterScratch(output),
    );
  }

  queueDetailIndexes(fileId, state, ranges, rangeSignature) {
    if (!state || !state.renderer || !state.sortedIndexes) return;
    const useResident = state.useResidentFallback && state.residentIndexes;
    const sourceIndexes = useResident ? state.residentIndexes : state.sortedIndexes;
    const sourceStride = useResident ? state.residentStride : state.sortedStride;
    const sourceVersion = useResident
      ? `resident:${state.residentVersion}`
      : `sorted:${state.sortedVersion}`;
    const requestKey = `${sourceVersion}/${rangeSignature}/s${sourceStride}`;
    if (state.requestedKey === requestKey) return;
    state.requestedKey = requestKey;
    state.renderer.setIndexStride(sourceStride);
    const filterId = `detail:${fileId}`;
    const holdCommit = rangeSignature !== state.committedRangesSignature;
    if (!ranges.length) {
      this.cancelIndexFilter(filterId);
      state.stagedRangesSignature = rangeSignature;
      state.renderer.updateIndexes(EMPTY_INDEXES, {
        holdCommit,
        preSampled: true,
        onCommitted: () => {
          state.committedKey = requestKey;
          state.committedRangesSignature = rangeSignature;
          state.appliedRangesSignature = rangeSignature;
        },
      });
      return;
    }
    if (!state.rangeMask || rangeSignature !== state.rangeMaskSignature) {
      state.rangeMask = makeRangeMask(ranges, state.renderer.sourceCount);
      state.rangeMaskSignature = rangeSignature;
    }
    const scratch = state.filterScratch;
    state.filterScratch = null;
    this.queueIndexFilter(
      filterId,
      sourceIndexes,
      state.rangeMask,
      true,
      scratch,
      (indexes, output) => {
        if (this.disposed
          || this.states[fileId] !== state
          || state.requestedKey !== requestKey) {
          this.returnStateFilterScratch(fileId, state, output);
          return;
        }
        const release = () => this.returnStateFilterScratch(fileId, state, output);
        state.stagedRangesSignature = rangeSignature;
        state.renderer.updateIndexes(indexes, {
          holdCommit,
          immediate: false,
          preSampled: true,
          onCommitted: () => {
            state.committedKey = requestKey;
            state.committedRangesSignature = rangeSignature;
            state.appliedRangesSignature = rangeSignature;
            release();
          },
          onDiscarded: release,
        });
      },
      (output) => this.returnStateFilterScratch(fileId, state, output),
    );
  }

  planIsReady(plan) {
    const baseSignature = rangesSignature(plan.baseRanges);
    if (this.baseCommittedRangesSignature !== baseSignature) {
      if (!this.baseRenderer
        || this.baseStagedRangesSignature !== baseSignature
        || !this.baseRenderer.hasStagedIndexes()) return false;
    }
    for (const fileId of plan.fileIds) {
      const state = this.states[fileId];
      const signature = plan.signatures[fileId];
      if (!state || !state.renderer || !state.sortedIndexes) return false;
      if (state.committedRangesSignature === signature) continue;
      if (state.stagedRangesSignature !== signature
        || !state.renderer.hasStagedIndexes()) return false;
    }
    return true;
  }

  commitPlan(plan) {
    if (!this.planIsReady(plan)) return false;
    const baseSignature = rangesSignature(plan.baseRanges);
    if (this.baseStagedRangesSignature === baseSignature
      && this.baseRenderer.hasStagedIndexes()) {
      this.baseRenderer.commitStagedIndexes();
    }
    const participants = new Set(plan.fileIds);
    participants.forEach((fileId) => {
      const state = this.states[fileId];
      const signature = plan.signatures[fileId] || '';
      if (state
        && state.stagedRangesSignature === signature
        && state.renderer
        && state.renderer.hasStagedIndexes()) {
        state.renderer.commitStagedIndexes();
      }
    });
    this.committedIds = plan.nodes.map((node) => node.id).sort();
    this.committedFineIds = plan.fine.map((item) => item.id).sort();
    this.committedFineRanges = plan.fine.slice();
    this.committedFileIds = new Set(plan.fileIds);
    this.activeRenderFileIds = new Set(plan.fileIds);
    this.activeRenderBounds = Object.create(null);
    plan.fileIds.forEach((fileId) => {
      this.activeRenderBounds[fileId] = mergeRangeBounds(plan.rangesByFile[fileId]);
    });
    this.activeRefinedCount = plan.nodes.length + plan.fine.length;
    return true;
  }

  applySelection() {
    if (this.disposed) return;
    const desiredPlan = this.buildPlan(this.selectedIds, this.selectedFineRanges);
    this.queueBaseIndexes(desiredPlan);
    const participants = new Set(desiredPlan.fileIds);
    participants.forEach((fileId) => {
      const state = this.states[fileId];
      if (!state || !state.renderer || !state.sortedIndexes) return;
      const ranges = desiredPlan.rangesByFile[fileId] || [];
      this.queueDetailIndexes(
        fileId,
        state,
        ranges,
        desiredPlan.signatures[fileId] || '',
      );
    });
    Object.keys(this.states).forEach((fileId) => {
      if (participants.has(fileId)) return;
      const state = this.states[fileId];
      if (!state || !state.renderer) return;
      this.cancelIndexFilter(`detail:${fileId}`);
      if (state.renderer.discardPendingIndexUpload) {
        state.renderer.discardPendingIndexUpload();
      }
      if (state.renderer.hasStagedIndexes()) state.renderer.discardStagedIndexes();
      state.stagedRangesSignature = '';
      state.requestedKey = state.committedKey || '';
    });
    this.commitPlan(desiredPlan);
    let activeCount = this.baseRenderer.count || 0;
    this.activeRenderFileIds.forEach((fileId) => {
      const state = this.states[fileId];
      if (state && state.renderer) activeCount += state.renderer.count;
    });
    if (this.onActiveCount) this.onActiveCount(activeCount, this.activeRefinedCount);
  }

  releaseState(fileId) {
    const state = this.states[fileId];
    if (!state) return;
    this.cancelIndexFilter(`detail:${fileId}`);
    this.pendingInstallIds = this.pendingInstallIds.filter((id) => id !== fileId);
    this.pendingDecodeIds = this.pendingDecodeIds.filter((id) => id !== fileId);
    this.pendingFastPathIds = this.pendingFastPathIds.filter((id) => id !== fileId);
    delete this.states[fileId];
    if (state.sortHandle) state.sortHandle.dispose();
    if (state.renderer) state.renderer.dispose();
    if (state.pendingRenderer) state.pendingRenderer.dispose();
    if (state.pendingAssets) cleanupAssets(state.pendingAssets);
    if (state.payload) cleanupSogPayload(state.payload);
    state.means = null;
    state.payload = null;
  }

  evictInactiveStates(keepWarm = true) {
    if (this.disposed) return;
    // Preserve every visited block for reliable backtracking. Only a real
    // memory warning switches the controller into degraded cache mode through
    // trimCache(true); normal movement must never evict the path behind users.
    if (keepWarm && !this.residentModeDegraded) {
      // Direction changes can leave downloaded look-ahead payloads outside the
      // new corridor. Retain installed renderers, but release stale unvisited
      // payloads so the bounded download buffer can follow the camera.
      Object.keys(this.states).forEach((fileId) => {
        const state = this.states[fileId];
        if (state.renderer
          || this.isFileWanted(fileId)
          || state.loading
          || state.decoding
          || state.installing) return;
        this.releaseState(fileId);
      });
      return;
    }
    if (FULL_RESIDENT_MODE && !this.residentModeDegraded) return;
    const ids = Object.keys(this.states);
    const limit = keepWarm
      ? Math.max(MAX_CACHED_DETAIL_FILES, this.selectedFileIds.size + PREFETCH_INSTALL_FILE_COUNT)
      : this.selectedFileIds.size;
    if (ids.length <= limit) return;
    const candidates = ids
      .map((fileId) => ({ fileId, state: this.states[fileId] }))
      .filter(({ fileId, state }) => !this.isFileSelected(fileId)
        && !state.loading
        && !state.decoding
        && !state.installing)
      .sort((left, right) => (left.state.lastUsedAt || 0) - (right.state.lastUsedAt || 0));
    while (Object.keys(this.states).length > limit && candidates.length) {
      this.releaseState(candidates.shift().fileId);
    }
  }

  trimCache(force = false) {
    if (!force || this.disposed) return;
    this.residentModeDegraded = true;
    if (this.backgroundPreloadTimer) {
      clearTimeout(this.backgroundPreloadTimer);
      this.backgroundPreloadTimer = null;
    }
    if (!this.residentReady) {
      this.startupWarmFileIds = new Set(this.selectedFileIds);
      this.startupSelectionCaptured = true;
    }
    this.pendingFileIds = this.pendingFileIds.filter((fileId) => this.isFileSelected(fileId));
    Object.keys(this.states).forEach((fileId) => {
      const state = this.states[fileId];
      if (!this.isFileSelected(fileId)
        && !state.loading
        && !state.decoding
        && !state.installing) {
        this.releaseState(fileId);
      }
    });
    this.evictInactiveStates(false);
    this.notifyResidentProgress();
  }

  trimTransientCache() {
    if (this.disposed) return;
    // A first memory warning should shed expanded GPU caches without deleting
    // compact scene data or the committed index texture used for backtracking.
    this.trimFastPaths(true);
  }

  markSortingUnavailable() {
    this.startupWarmFileIds.forEach((fileId) => this.sortFailedFileIds.add(fileId));
    this.notifyResidentProgress();
  }

  queueFile(fileId, priority = false) {
    const normalized = String(fileId);
    if (this.disposed
      || !this.isFileWanted(normalized)
      || this.residentFailedFileIds.has(normalized)) return;
    const state = this.states[normalized];
    if (state && (!state.failed || Date.now() < state.retryAt)) return;
    const pendingIndex = this.pendingFileIds.indexOf(normalized);
    if (pendingIndex >= 0) {
      if (priority && pendingIndex > 0) {
        this.pendingFileIds.splice(pendingIndex, 1);
        this.pendingFileIds.unshift(normalized);
      }
    } else if (priority) {
      this.pendingFileIds.unshift(normalized);
    } else {
      this.pendingFileIds.push(normalized);
    }
    this.pumpFileLoads();
  }

  pumpFileLoads() {
    if (this.disposed) return;
    const concurrency = this.residentReady
      ? MAX_CONCURRENT_BACKGROUND_LOADS
      : MAX_CONCURRENT_DETAIL_LOADS;
    while (this.activeFileLoads < concurrency
      && this.pendingFileIds.length
      && this.bufferedPipelineCount() < MAX_BUFFERED_DETAIL_FILES) {
      let pendingIndex = 0;
      if (!this.residentReady) {
        pendingIndex = this.pendingFileIds.findIndex(
          (fileId) => this.startupWarmFileIds.has(fileId),
        );
        if (pendingIndex < 0) break;
      } else if (this.interactionActive) {
        pendingIndex = this.pendingFileIds.findIndex((fileId) => (
          this.primaryFileIds.has(fileId)
          || this.warmFileIds.has(fileId)
          || this.selectedFileIds.has(fileId)
        ));
        if (pendingIndex < 0) break;
      }
      const [fileId] = this.pendingFileIds.splice(pendingIndex, 1);
      if (!this.isFileWanted(fileId)) continue;
      const state = this.states[fileId];
      if (state && (!state.failed || Date.now() < state.retryAt)) continue;
      this.activeFileLoads += 1;
      this.ensureFile(fileId).then(() => {
        this.activeFileLoads = Math.max(0, this.activeFileLoads - 1);
        this.pumpFileLoads();
      });
    }
  }

  markFileLoadFailed(fileId, error) {
    const attempts = (this.fileRetryCounts[fileId] || 0) + 1;
    this.fileRetryCounts[fileId] = attempts;
    if (attempts >= MAX_RESIDENT_LOAD_RETRIES) {
      this.residentFailedFileIds.add(fileId);
      this.notifyResidentProgress();
      if (this.onError) this.onError(error);
      return;
    }
    setTimeout(() => {
      if (!this.disposed && this.isFileWanted(fileId)) {
        this.queueFile(fileId, this.primaryFileIds.has(fileId));
      }
    }, RETRY_DELAY_MS);
  }

  ensureSortDataset(fileId) {
    const state = this.states[fileId];
    if (!state
      || !state.means
      || state.failed
      || state.sortFailed) return;
    if (state.sortHandle) return;
    const descriptor = this.scene.nearLod.sogs[fileId];
    if (!descriptor) return;
    const detailScene = { ...this.scene, sog: descriptor };
    try {
      state.sortHandle = this.sortController.addDataset(`lod:${fileId}`, detailScene, state.means, {
        onReady: () => {
          if (this.disposed || this.states[fileId] !== state) return;
          state.sortReady = true;
          if (this.currentCamera && this.isFileWanted(fileId)) {
            if (state.sortHandle.request(this.sortCameraForFile(fileId))) {
              state.lastSortRequestedAt = Date.now();
            }
          }
        },
        onSorted: (indexes, stats, request) => {
          if (this.disposed || this.states[fileId] !== state) return;
          const requestStride = normalizeSampleStride(
            request && request.camera && request.camera.sampleStride,
          );
          if (requestStride !== this.detailSamplingStride()) {
            if (state.sortHandle && this.currentCamera && this.isFileWanted(fileId)) {
              state.sortHandle.request(this.sortCameraForFile(fileId));
            }
            return;
          }
          const residentResult = !!(request
            && request.camera
            && request.camera.reason === 'initial');
          if (!residentResult
            && request
            && request.camera
            && !cameraWithinSortCoverage(this.currentCamera, request.camera)) {
            if (this.onSortStale) this.onSortStale(fileId, request.camera);
            return;
          }
          if (residentResult) {
            state.residentIndexes = indexes;
            state.residentVersion += 1;
            state.residentStride = requestStride;
            state.useResidentFallback = true;
          } else {
            state.useResidentFallback = false;
          }
          state.sortedIndexes = indexes;
          state.sortedStride = requestStride;
          state.sortedCamera = request && request.camera
            ? {
              enableDepthSorting: request.camera.enableDepthSorting === true,
              position: request.camera.position.slice(),
              forward: request.camera.forward.slice(),
            }
            : null;
          state.sortedVersion += 1;
          state.sortFailed = false;
          state.lastSortCompletedAt = Date.now();
          state.lastUsedAt = Date.now();
          this.sortFailedFileIds.delete(fileId);
          if (this.isFileSelected(fileId)) this.applySelection();
          else this.evictInactiveStates();
          this.notifyResidentProgress();
          if (this.onStatus && this.isFileSelected(fileId) && this.residentReady) {
            this.onStatus('近景高清细化已就绪');
          }
        },
        onError: (error) => {
          if (this.disposed || this.states[fileId] !== state) return;
          state.sortReady = false;
          state.sortFailed = true;
          state.sortedIndexes = state.residentIndexes;
          state.sortedStride = state.residentStride;
          state.useResidentFallback = !!state.residentIndexes;
          state.sortedCamera = null;
          this.sortFailedFileIds.add(fileId);
          if (this.isFileSelected(fileId) && state.residentIndexes) this.applySelection();
          this.notifyResidentProgress();
          if (this.onError) this.onError(error);
        },
      });
    } catch (error) {
      state.sortFailed = true;
      this.sortFailedFileIds.add(fileId);
      this.notifyResidentProgress();
      if (this.onError) this.onError(error);
    }
  }

  queuePendingDecode(fileId, state) {
    if (!state
      || !state.payload
      || state.pendingAssets
      || state.renderer
      || state.loading
      || state.decoding
      || state.failed) return false;
    if (!this.pendingDecodeIds.includes(fileId)) {
      if (this.primaryFileIds.has(fileId)) this.pendingDecodeIds.unshift(fileId);
      else this.pendingDecodeIds.push(fileId);
    }
    this.pumpDecodes();
    return true;
  }

  pumpDecodes() {
    if (this.disposed) return;
    while (this.activeDecodes < MAX_CONCURRENT_DETAIL_DECODES
      && this.pendingDecodeIds.length
      && this.pendingInstallIds.length + this.activeDecodes < MAX_PENDING_DETAIL_INSTALLS) {
      let index = this.pendingDecodeIds.findIndex((fileId) => this.primaryFileIds.has(fileId));
      if (index < 0) index = 0;
      const [fileId] = this.pendingDecodeIds.splice(index, 1);
      const state = this.states[fileId];
      if (!state || !state.payload || !this.isFileWanted(fileId)) continue;
      if (!this.warmFileIds.has(fileId)) continue;
      state.decoding = true;
      this.activeDecodes += 1;
      const payload = state.payload;
      decodeSogPayload(
        this.canvas,
        state.detailScene,
        payload,
        null,
        { decodeConcurrency: 1 },
      ).then((assets) => {
        this.activeDecodes = Math.max(0, this.activeDecodes - 1);
        if (this.disposed || this.states[fileId] !== state) {
          cleanupAssets(assets);
          this.pumpDecodes();
          return;
        }
        state.decoding = false;
        state.payload = null;
        state.pendingAssets = assets;
        state.means = assets.sortData || assets.means;
        state.failed = false;
        if (this.warmFileIds.has(fileId)) {
          this.queuePendingInstall(fileId, state);
          this.ensureSortDataset(fileId);
          if (state.sortHandle && this.currentCamera) {
            state.sortHandle.request(this.sortCameraForFile(fileId));
          }
        }
        this.pumpDecodes();
        this.pumpFileLoads();
        if (!this.isFileWanted(fileId)) this.evictInactiveStates();
      }).catch((error) => {
        this.activeDecodes = Math.max(0, this.activeDecodes - 1);
        if (this.states[fileId] === state) {
          state.decoding = false;
          state.payload = null;
          state.failed = true;
          state.retryAt = Date.now() + RETRY_DELAY_MS;
        }
        this.pumpDecodes();
        if (!this.disposed) this.markFileLoadFailed(fileId, error);
      });
    }
  }

  bufferedPipelineCount() {
    return Object.values(this.states).reduce((count, state) => (
      count + Number(!!(
        state.loading
        || state.payload
        || state.decoding
        || state.pendingAssets
        || state.installing
      ))
    ), 0);
  }

  queuePendingInstall(fileId, state) {
    if (!state
      || state.renderer
      || state.pendingRenderer
      || !state.pendingAssets
      || state.loading
      || state.decoding
      || state.installing
      || state.failed) return false;
    state.installStage = 'create';
    state.installing = true;
    if (!this.pendingInstallIds.includes(fileId)) {
      if (this.primaryFileIds.has(fileId)) this.pendingInstallIds.unshift(fileId);
      else this.pendingInstallIds.push(fileId);
    }
    return true;
  }

  hasContinuityInstallWork() {
    return this.pendingInstallIds.some((fileId) => (
      this.isFileWanted(fileId)
      && (this.primaryFileIds.has(fileId) || this.warmFileIds.has(fileId))
    ));
  }

  async ensureFile(fileId) {
    if (this.disposed) return;
    const now = Date.now();
    const existing = this.states[fileId];
    if (existing) {
      if (!existing.failed || now < existing.retryAt) return;
      this.releaseState(fileId);
    }
    const descriptor = this.scene.nearLod.sogs[fileId];
    if (!descriptor) return;
    const state = {
      decoding: false,
      failed: false,
      fastPathAttempted: false,
      filterScratch: null,
      detailScene: null,
      installStage: '',
      installing: false,
      lastUsedAt: now,
      lastSortCompletedAt: 0,
      lastSortRequestedAt: 0,
      loading: true,
      means: null,
      pendingAssets: null,
      pendingRenderer: null,
      payload: null,
      renderer: null,
      retryAt: 0,
      sortFailed: false,
      sortHandle: null,
      sortReady: false,
      sortedIndexes: null,
      sortedStride: this.detailSamplingStride(),
      sortedCamera: null,
      sortedVersion: 0,
      residentIndexes: null,
      residentStride: this.detailSamplingStride(),
      residentVersion: 0,
      useResidentFallback: true,
      appliedKey: '',
      appliedRangesSignature: '',
      committedKey: '',
      committedRangesSignature: '',
      requestedKey: '',
      stagedRangesSignature: '',
      rangeMask: null,
      rangeMaskSignature: '',
    };
    this.states[fileId] = state;

    let payload = null;
    try {
      const detailScene = { ...this.scene, sog: descriptor };
      state.detailScene = detailScene;
      // Once interaction starts, every network miss is streamed to file cache
      // in small ranges. A newly selected block must never reintroduce the
      // multi-megabyte ArrayBuffer callback used behind the loading mask.
      const cacheInFileSystem = this.residentReady;
      payload = await (cacheInFileSystem
        ? cacheSogPayload(detailScene, {
          shouldContinue: () => !this.disposed && this.states[fileId] === state,
        })
        : fetchSogPayload(detailScene));
      if (this.disposed || this.states[fileId] !== state) {
        cleanupSogPayload(payload);
        return;
      }
      state.payload = payload;
      state.loading = false;
      state.failed = false;
      payload = null;
      delete this.fileRetryCounts[fileId];
      this.residentFailedFileIds.delete(fileId);
      if (this.warmFileIds.has(fileId)) {
        this.queuePendingDecode(fileId, state);
      }
      this.pumpFileLoads();
      if (!this.isFileWanted(fileId)) this.evictInactiveStates();
    } catch (error) {
      if (this.states[fileId] === state) {
        state.loading = false;
        state.installing = false;
        state.failed = true;
        state.retryAt = Date.now() + RETRY_DELAY_MS;
        if (!this.disposed) this.markFileLoadFailed(fileId, error);
      }
    }
  }

  failPendingInstall(fileId, state, error) {
    this.pendingInstallIds = this.pendingInstallIds.filter((id) => id !== fileId);
    if (state.pendingAssets) cleanupAssets(state.pendingAssets);
    if (state.pendingRenderer) state.pendingRenderer.dispose();
    state.pendingAssets = null;
    state.pendingRenderer = null;
    state.installing = false;
    state.loading = false;
    state.failed = true;
    state.retryAt = Date.now() + RETRY_DELAY_MS;
    this.pumpDecodes();
    this.pumpFileLoads();
    if (!this.disposed) this.markFileLoadFailed(fileId, error);
  }

  flushDeferredFastPath() {
    while (this.pendingFastPathIds.length) {
      let index = this.pendingFastPathIds.findIndex((fileId) => this.primaryFileIds.has(fileId));
      if (index < 0) index = 0;
      const [fileId] = this.pendingFastPathIds.splice(index, 1);
      const state = this.states[fileId];
      if (!state || !state.renderer || !this.shouldPrepareFastPath(fileId)) continue;
      if (state.renderer.prepareIndexDoubleBuffer) state.renderer.prepareIndexDoubleBuffer();
      const ready = state.renderer.prepareFastPath(64);
      const terminal = ready || state.renderer.fastDisabled;
      state.fastPathAttempted = terminal;
      if (!terminal && this.shouldPrepareFastPath(fileId)) {
        this.pendingFastPathIds.push(fileId);
      }
      if (terminal) this.notifyResidentProgress();
      return 1;
    }
    return 0;
  }

  flushResourceInstalls(maxSteps = 1, options = {}) {
    if (this.disposed) return 0;
    const budget = Math.max(1, Math.floor(Number(maxSteps) || 1));
    const allowFastPath = options.allowFastPath !== false;
    let completedSteps = 0;
    while (completedSteps < budget) {
      const hasPrimaryInstall = this.pendingInstallIds.some(
        (fileId) => this.primaryFileIds.has(fileId),
      );
      if (allowFastPath && !hasPrimaryInstall) {
        const fastPathSteps = this.flushDeferredFastPath();
        if (fastPathSteps) {
          completedSteps += fastPathSteps;
          continue;
        }
      }
      if (!this.pendingInstallIds.length) break;
      let installIndex = this.pendingInstallIds.findIndex(
        (fileId) => this.primaryFileIds.has(fileId),
      );
      if (installIndex < 0) installIndex = 0;
      const fileId = this.pendingInstallIds[installIndex];
      const state = this.states[fileId];
      if (!state) {
        this.pendingInstallIds.splice(installIndex, 1);
        this.pumpDecodes();
        continue;
      }
      if (!this.isFileWanted(fileId)) {
        this.releaseState(fileId);
        this.pumpDecodes();
        this.pumpFileLoads();
        continue;
      }
      try {
        if (state.installStage === 'create') {
          state.pendingRenderer = new SplatRenderer(this.gl, this.width, this.height, {
            enableGpuPredecode: true,
            enableProjectedFastPath: false,
            enableFallbackAvatar: false,
            indexStride: this.detailSamplingStride(),
            shareProgram: true,
          });
          state.pendingRenderer.beginLoad(
            state.detailScene,
            state.pendingAssets,
            { initiallyVisible: false },
          );
          state.installStage = 'textures';
        } else if (state.installStage === 'textures') {
          state.pendingRenderer.flushTextureUploads(1);
          if (state.pendingRenderer.isLoadComplete()) state.installStage = 'index-a';
        } else if (state.installStage === 'index-a') {
          state.pendingRenderer.prepareIndexBuffer(
            state.pendingRenderer.activeIndexTexture,
          );
          state.installStage = 'index-b';
        } else if (state.installStage === 'index-b') {
          state.pendingRenderer.prepareIndexBuffer(
            1 - state.pendingRenderer.activeIndexTexture,
          );
          // Commit the usable source renderer first. GPU predecode is a
          // separate quality-preserving acceleration upgrade and must not
          // block a newly available detail block.
          state.installStage = 'commit';
        } else if (state.installStage === 'fast-path') {
          // Migrate an install queued by an older state machine without
          // forcing a large texture allocation during active interaction.
          if (!allowFastPath) {
            state.installStage = 'commit';
          } else {
            const ready = state.pendingRenderer.prepareFastPath(64);
            if (ready || state.pendingRenderer.fastDisabled) {
              state.fastPathAttempted = true;
              state.installStage = 'commit';
            }
          }
        } else if (state.installStage === 'commit') {
          const renderer = state.pendingRenderer;
          state.pendingRenderer = null;
          state.renderer = renderer;
          cleanupAssets(state.pendingAssets);
          state.pendingAssets = null;
          state.detailScene = null;
          state.installStage = '';
          state.installing = false;
          state.loading = false;
          state.failed = false;
          this.pendingInstallIds.splice(installIndex, 1);
          this.prepareFastPathForState(fileId, state);
          if (state.sortedIndexes && this.isFileSelected(fileId)) this.applySelection();
          this.notifyResidentProgress();
          this.trimFastPaths();
          this.pumpDecodes();
          this.pumpFileLoads();
          if (!this.isFileWanted(fileId)) this.evictInactiveStates();
        } else {
          throw new Error(`Unknown detail install stage: ${state.installStage}`);
        }
        completedSteps += 1;
      } catch (error) {
        this.failPendingInstall(fileId, state, error);
        completedSteps += 1;
      }
    }
    return completedSteps;
  }

  render(matrices, cameraController) {
    const camera = this.currentCamera || (
      cameraController && cameraController.getCamera
        ? cameraController.getCamera()
        : null
    );
    const fileIds = Array.from(this.activeRenderFileIds);
    const depths = Object.create(null);
    fileIds.forEach((fileId) => {
      depths[fileId] = boundsFarDepth(camera, this.activeRenderBounds[fileId]);
    });
    fileIds.sort((left, right) => {
      const depthDelta = depths[right] - depths[left];
      return Math.abs(depthDelta) > 0.0001
        ? depthDelta
        : (String(left) < String(right) ? -1 : 1);
    });
    fileIds.forEach((fileId) => {
      const state = this.states[fileId];
      if (state && state.renderer && state.renderer.count) {
        state.renderer.render(matrices, cameraController, {
          clear: false,
          avatar: false,
          preserveState: true,
        });
      }
    });
  }

  cancelIndexFilter(filterId) {
    const job = this.pendingIndexFilters[filterId];
    if (!job) return;
    delete this.pendingIndexFilters[filterId];
    const index = this.pendingIndexFilterIds.indexOf(filterId);
    if (index >= 0) this.pendingIndexFilterIds.splice(index, 1);
    if (job.onDiscarded) job.onDiscarded(job.output);
  }

  queueIndexFilter(
    filterId,
    indexes,
    mask,
    keepMarked,
    scratch,
    onComplete,
    onDiscarded,
  ) {
    this.cancelIndexFilter(filterId);
    const output = scratch && scratch.length >= indexes.length
      ? scratch
      : new Uint32Array(indexes.length);
    this.pendingIndexFilters[filterId] = {
      count: 0,
      cursor: 0,
      indexes,
      keepMarked,
      mask,
      onComplete,
      onDiscarded,
      output,
    };
    this.pendingIndexFilterIds.push(filterId);
  }

  returnBaseFilterScratch(scratch) {
    if (!scratch || this.disposed) return;
    if (!this.baseFilterScratch || this.baseFilterScratch.length < scratch.length) {
      this.baseFilterScratch = scratch;
    }
  }

  returnStateFilterScratch(fileId, state, scratch) {
    if (!scratch || this.disposed || this.states[fileId] !== state) return;
    if (!state.filterScratch || state.filterScratch.length < scratch.length) {
      state.filterScratch = scratch;
    }
  }

  flushIndexFilters(maxItems = 98304, maxMilliseconds = 2) {
    let remaining = Math.max(0, Math.floor(maxItems));
    const initialBudget = remaining;
    const startedAt = Date.now();
    const chunkSize = 8192;
    while (remaining > 0 && this.pendingIndexFilterIds.length) {
      const filterId = this.pendingIndexFilterIds.shift();
      const job = this.pendingIndexFilters[filterId];
      if (!job) continue;
      const end = Math.min(
        job.indexes.length,
        job.cursor + Math.min(chunkSize, remaining),
      );
      for (let item = job.cursor; item < end; item += 1) {
        const sourceIndex = job.indexes[item];
        const marked = sourceIndex < job.mask.length && job.mask[sourceIndex] !== 0;
        if (marked === job.keepMarked) {
          job.output[job.count] = sourceIndex;
          job.count += 1;
        }
      }
      remaining -= end - job.cursor;
      job.cursor = end;
      if (job.cursor < job.indexes.length) {
        this.pendingIndexFilterIds.push(filterId);
      } else {
        delete this.pendingIndexFilters[filterId];
        job.onComplete(job.output.subarray(0, job.count), job.output);
      }
      if (Date.now() - startedAt >= maxMilliseconds) break;
    }
    return initialBudget - remaining;
  }

  flushIndexUploads(maxRows = 32) {
    // Filtering sorted arrays is also spread across frames; the renderer keeps
    // drawing the last complete index texture throughout this stage.
    this.flushIndexFilters();
    let remaining = Math.max(0, Math.floor(maxRows));
    const priorityIds = [
      ...this.activeRenderFileIds,
      ...this.selectedFileIds,
    ];
    new Set(priorityIds).forEach((fileId) => {
      if (remaining <= 0) return;
      const state = this.states[fileId];
      if (!state || !state.renderer) return;
      const used = state.renderer.flushIndexUpload(Math.min(8, remaining));
      remaining -= used;
    });
    this.applySelection();
    return maxRows - remaining;
  }

  hasPendingIndexWork() {
    if (this.pendingIndexFilterIds.length) return true;
    const visibleFileIds = new Set([
      ...this.primaryFileIds,
      ...this.activeRenderFileIds,
      ...this.committedFileIds,
    ]);
    for (const fileId of visibleFileIds) {
      const state = this.states[fileId];
      if (state
        && state.renderer
        && (state.renderer.pendingIndexUpload || state.renderer.hasStagedIndexes())) return true;
    }
    return false;
  }

  getDiagnostics() {
    const states = Object.values(this.states);
    return {
      activeFiles: this.activeRenderFileIds.size,
      cachedFiles: states.filter((state) => !!state.renderer).length,
      cpuCachedFiles: states.filter((state) => !!state.payload || !!state.pendingAssets).length,
      decodingFiles: this.activeDecodes,
      fastFiles: states.filter((state) => state.renderer && state.renderer.hasFastPath()).length,
      installingFiles: this.pendingInstallIds.length,
      loadingFiles: this.activeFileLoads,
      queuedFiles: this.pendingFileIds.length,
      queuedFastPaths: this.pendingFastPathIds.length,
      pendingIndexFilters: this.pendingIndexFilterIds.length,
      sampleStride: this.samplingStride,
      detailSampleStride: this.detailSamplingStride(),
      selectedFiles: this.selectedFileIds.size,
    };
  }

  dispose() {
    this.disposed = true;
    if (this.backgroundPreloadTimer) {
      clearTimeout(this.backgroundPreloadTimer);
      this.backgroundPreloadTimer = null;
    }
    this.pendingFileIds = [];
    Object.keys(this.states).forEach((fileId) => this.releaseState(fileId));
    this.states = {};
    this.baseIndexes = null;
    this.residentBaseIndexes = null;
    this.baseFilterScratch = null;
    this.pendingIndexFilters = Object.create(null);
    this.pendingIndexFilterIds = [];
    this.activeRenderBounds = Object.create(null);
  }
}

module.exports = {
  NearLodController,
  boundsDepthInterval,
  buildStartupPathFileOrder,
  buildStartupWarmFileOrder,
  sampleTrajectoryByDistance,
};
