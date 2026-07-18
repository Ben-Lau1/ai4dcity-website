'use strict';

const { cleanupAssets, loadSogAssets } = require('./range-loader');
const { SplatRenderer } = require('./splat-renderer');

const DEFAULT_POINT_BUDGET = 1300000;
const DETAIL_RADIUS = 360;
const FINE_DETAIL_RADIUS = 220;
const PREFETCH_DISTANCE = 220;
const PREFETCH_RADIUS = 420;
const PREFETCH_NODE_COUNT = 4;
const DETAIL_FOV_Y = 55 * Math.PI / 180;
const DETAIL_FAR = 3000;
const WARM_FILE_COUNT = 2;
const MAX_CACHED_DETAIL_FILES = 8;
const MAX_WARM_FAST_PATHS = 3;
const MAX_CONCURRENT_DETAIL_LOADS = 2;
const RETRY_DELAY_MS = 2000;
const MAX_RESIDENT_LOAD_RETRIES = 3;
const SELECTION_UPDATE_INTERVAL_MS = 250;
const SELECTION_POSITION_THRESHOLD_SQ = 4;
const SORT_RESULT_POSITION_THRESHOLD_SQ = 256;
const SORT_RESULT_DIRECTION_DOT_THRESHOLD = Math.cos(18 * Math.PI / 180);
const FULL_RESIDENT_MODE = true;
const EMPTY_INDEXES = new Uint32Array(0);

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

function pointCount(node) {
  return node.detail.reduce((sum, range) => sum + range.count, 0);
}

function basePointCount(node) {
  const ranges = Array.isArray(node.base) ? node.base : (node.base ? [node.base] : []);
  return ranges.reduce((sum, range) => sum + range.count, 0);
}

function rangePointCount(ranges) {
  return (ranges || []).reduce((sum, range) => sum + range.count, 0);
}

function rangesSignature(ranges) {
  return (ranges || []).slice()
    .sort((left, right) => left.start - right.start || left.count - right.count)
    .map((range) => `${range.start}:${range.count}`)
    .join('|');
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

function cameraWithinSortCoverage(current, sorted) {
  if (!current || !sorted) return false;
  const dx = current.position[0] - sorted.position[0];
  const dy = current.position[1] - sorted.position[1];
  const dz = current.position[2] - sorted.position[2];
  if (dx * dx + dy * dy + dz * dz > SORT_RESULT_POSITION_THRESHOLD_SQ) return false;
  const directionDot = current.forward[0] * sorted.forward[0]
    + current.forward[1] * sorted.forward[1]
    + current.forward[2] * sorted.forward[2];
  return directionDot >= SORT_RESULT_DIRECTION_DOT_THRESHOLD;
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
    this.samplingStride = 1;
    this.rootPointCount = Math.max(
      0,
      Math.floor(Number(this.scene.sog && this.scene.sog.meta.count) || 0),
    );
    this.pointBudget = Math.max(
      this.rootPointCount,
      Math.floor(Number(options.pointBudget) || DEFAULT_POINT_BUDGET),
    );
    this.onActiveCount = options.onActiveCount || null;
    this.onStatus = options.onStatus || null;
    this.onError = options.onError || null;
    this.onResidentProgress = options.onResidentProgress || null;
    this.states = {};
    this.selectedIds = [];
    this.selectedFineIds = [];
    this.selectedFineRanges = [];
    this.visibleIds = [];
    this.selectedFileIds = new Set();
    this.primaryFileIds = new Set();
    this.residentFileIds = new Set(Object.keys((this.scene.nearLod && this.scene.nearLod.sogs) || {}));
    this.startupPrimaryFileIds = FULL_RESIDENT_MODE
      ? new Set(this.residentFileIds)
      : new Set();
    this.startupSelectionCaptured = FULL_RESIDENT_MODE;
    this.residentFailedFileIds = new Set();
    this.sortFailedFileIds = new Set();
    this.fileRetryCounts = {};
    this.residentModeDegraded = false;
    this.residentReady = false;
    this.lastResidentProgressKey = '';
    this.activeRenderFileIds = new Set();
    this.activeRefinedCount = 0;
    this.pendingFileIds = [];
    this.activeFileLoads = 0;
    this.baseIndexes = null;
    this.baseIndexesVersion = 0;
    this.residentBaseIndexes = null;
    this.residentBaseIndexesVersion = 0;
    this.useResidentBaseFallback = false;
    this.baseAppliedKey = '';
    this.baseAppliedRangesSignature = '';
    this.baseRangeMask = null;
    this.baseRangeMaskSignature = '';
    this.baseFilterScratch = null;
    this.pendingIndexFilters = Object.create(null);
    this.pendingIndexFilterIds = [];
    this.currentCamera = null;
    this.lastSelectionCamera = null;
    this.lastSelectionUpdateAt = 0;
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
    });
  }

  detailSamplingStride() {
    return 1;
  }

  setSamplingStride() {
    if (this.samplingStride === 1) return false;
    this.samplingStride = 1;
    if (this.baseRenderer && this.baseRenderer.setIndexStride) {
      this.baseRenderer.setIndexStride(1);
    }
    const activeIds = new Set([
      ...this.activeRenderFileIds,
      ...this.selectedFileIds,
    ]);
    activeIds.forEach((fileId) => {
      const state = this.states[fileId];
      if (state && state.renderer && state.renderer.setIndexStride) {
        state.renderer.setIndexStride(1);
      }
    });
    if (this.onActiveCount) {
      let activeCount = this.baseRenderer ? this.baseRenderer.count : 0;
      this.activeRenderFileIds.forEach((fileId) => {
        const state = this.states[fileId];
        if (state && state.renderer) activeCount += state.renderer.count;
      });
      this.onActiveCount(activeCount, this.activeRefinedCount);
    }
    return true;
  }

  setPointBudget(pointBudget) {
    const normalized = Math.max(
      this.rootPointCount,
      Math.floor(Number(pointBudget) || DEFAULT_POINT_BUDGET),
    );
    if (normalized === this.pointBudget) return false;
    this.pointBudget = normalized;
    if (this.currentCamera) this.update(this.currentCamera, true);
    return true;
  }

  setBaseIndexes(indexes, options = {}) {
    this.baseIndexes = indexes;
    this.baseIndexesVersion += 1;
    if (options.resident) {
      this.residentBaseIndexes = indexes;
      this.residentBaseIndexesVersion += 1;
      this.useResidentBaseFallback = true;
    } else {
      this.useResidentBaseFallback = false;
    }
    this.applySelection();
  }

  isFileSelected(fileId) {
    return this.selectedFileIds.has(String(fileId));
  }

  isFileWanted(fileId) {
    const normalized = String(fileId);
    if (FULL_RESIDENT_MODE && !this.residentModeDegraded) {
      return this.residentFileIds.has(normalized);
    }
    return this.isFileSelected(normalized);
  }

  sortCameraForFile(fileId, requestedCamera) {
    const camera = requestedCamera || this.currentCamera;
    if (!camera) return null;
    // Keep every selected node complete. Culling during sort permanently bakes
    // the current view into the index list and exposes holes after a rotation.
    return {
      ...camera,
      predictedForward: camera.forward.slice(),
      cullToFrustum: false,
    };
  }

  shouldPrepareFastPath(fileId) {
    return this.isFileSelected(fileId);
  }

  prepareFastPathForState(fileId, state) {
    if (!state || !state.renderer || !this.shouldPrepareFastPath(fileId)) return false;
    if (state.renderer.prepareIndexDoubleBuffer) {
      state.renderer.prepareIndexDoubleBuffer();
    }
    return state.renderer.prepareFastPath();
  }

  trimFastPaths() {
    if (this.disposed) return;
    const warmFastPaths = Object.keys(this.states)
      .map((fileId) => ({ fileId, state: this.states[fileId] }))
      .filter(({ fileId, state }) => !this.isFileSelected(fileId)
        && state.renderer
        && state.renderer.hasFastPath())
      .sort((left, right) => (right.state.lastUsedAt || 0) - (left.state.lastUsedAt || 0));
    Object.keys(this.states).forEach((fileId) => {
      const state = this.states[fileId];
      if (!this.isFileSelected(fileId) && state.renderer) {
        state.renderer.releaseProjectionStorage();
      }
    });
    warmFastPaths.slice(MAX_WARM_FAST_PATHS).forEach(({ state }) => {
      state.renderer.releaseFastPath();
    });
  }

  flushResidentUploads() {
    if (this.baseRenderer) this.baseRenderer.flushIndexUpload(Number.POSITIVE_INFINITY);
    Object.values(this.states).forEach((state) => {
      if (state.renderer) state.renderer.flushIndexUpload(Number.POSITIVE_INFINITY);
    });
  }

  notifyResidentProgress() {
    const startupIds = Array.from(this.startupPrimaryFileIds);
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
    const complete = this.startupSelectionCaptured && startupComplete;
    const issueIds = new Set(this.residentFailedFileIds);
    startupIds.forEach((fileId) => {
      if (this.sortFailedFileIds.has(fileId)) issueIds.add(fileId);
    });
    if (complete && !this.residentReady) {
      this.residentReady = true;
      // The loading mask must not disappear while a replacement index texture
      // is only partially uploaded; otherwise the base/detail handoff exposes
      // a temporary black region.
      this.flushResidentUploads();
    }
    const progressKey = [
      complete ? 1 : 0,
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
    // Keep refinement anchored to the user's position. Direction-based LOD
    // changes caused large index uploads during every turn and exposed holes
    // before the newly-facing root ranges were restored.
    return lod.nodes;
  }

  selectNodes(camera, visibleNodes) {
    const previous = new Set(this.selectedIds);
    const exitRadiusSq = DETAIL_RADIUS * DETAIL_RADIUS * 1.21;
    const candidates = (visibleNodes || []).map((node) => ({
      node,
      distanceSq: distanceToBoundsSquared(camera.position, node.bounds),
    })).filter((candidate) => candidate.distanceSq <= (
      previous.has(candidate.node.id)
        ? exitRadiusSq
        : DETAIL_RADIUS * DETAIL_RADIUS
    )).sort((left, right) => {
      const leftScore = left.distanceSq * (previous.has(left.node.id) ? 0.8 : 1);
      const rightScore = right.distanceSq * (previous.has(right.node.id) ? 0.8 : 1);
      return leftScore - rightScore;
    });
    const selected = [];
    let points = this.rootPointCount;
    candidates.forEach((candidate) => {
      const count = pointCount(candidate.node);
      const delta = Math.max(0, count - basePointCount(candidate.node));
      if (count < 50 || points + delta > this.pointBudget) return;
      selected.push(candidate.node);
      points += delta;
    });
    return selected;
  }

  selectFineRanges(camera, selectedNodes) {
    let points = this.rootPointCount + (selectedNodes || []).reduce(
      (sum, node) => sum + Math.max(0, pointCount(node) - basePointCount(node)),
      0,
    );
    const candidates = [];
    (selectedNodes || []).forEach((node) => {
      (node.detail || []).forEach((range, rangeIndex) => {
        if (!range.bounds || !range.finer || !range.finer.length) return;
        const distanceSq = distanceToBoundsSquared(camera.position, range.bounds);
        if (distanceSq > FINE_DETAIL_RADIUS * FINE_DETAIL_RADIUS) return;
        const finerCount = rangePointCount(range.finer);
        const delta = finerCount - range.count;
        if (delta <= 0) return;
        candidates.push({
          id: `${node.id}/${range.id || rangeIndex}`,
          parentId: node.id,
          range,
          distanceSq,
          delta,
        });
      });
    });
    candidates.sort((left, right) => left.distanceSq - right.distanceSq);
    const selected = [];
    candidates.forEach((candidate) => {
      if (points + candidate.delta > this.pointBudget) return;
      selected.push(candidate);
      points += candidate.delta;
    });
    return selected;
  }

  prefetchNodes(camera, selectedNodes) {
    const selectedIds = new Set((selectedNodes || []).map((node) => node.id));
    const predicted = [
      camera.position[0] + camera.forward[0] * PREFETCH_DISTANCE,
      camera.position[1] + camera.forward[1] * PREFETCH_DISTANCE,
      camera.position[2] + camera.forward[2] * PREFETCH_DISTANCE,
    ];
    return (this.scene.nearLod.nodes || [])
      .filter((node) => !selectedIds.has(node.id))
      .map((node) => ({
        node,
        distanceSq: distanceToBoundsSquared(predicted, node.bounds),
      }))
      .filter((candidate) => candidate.distanceSq <= PREFETCH_RADIUS * PREFETCH_RADIUS)
      .sort((left, right) => left.distanceSq - right.distanceSq)
      .slice(0, PREFETCH_NODE_COUNT)
      .map((candidate) => candidate.node);
  }

  update(camera, force = false) {
    if (this.disposed || !camera) return;
    this.currentCamera = {
      position: camera.position.slice(),
      forward: camera.forward.slice(),
      aspect: Number(camera.aspect) || Math.max(1, this.width) / Math.max(1, this.height),
      fovY: Number(camera.fovY) || DETAIL_FOV_Y,
      far: Number(camera.far) || DETAIL_FAR,
    };
    const now = Date.now();
    let positionChanged = force || !this.lastSelectionCamera;
    if (!force && this.lastSelectionCamera) {
      const dx = this.currentCamera.position[0] - this.lastSelectionCamera.position[0];
      const dy = this.currentCamera.position[1] - this.lastSelectionCamera.position[1];
      const dz = this.currentCamera.position[2] - this.lastSelectionCamera.position[2];
      const movedSq = dx * dx + dy * dy + dz * dz;
      positionChanged = movedSq >= SELECTION_POSITION_THRESHOLD_SQ;
      if (now - this.lastSelectionUpdateAt < SELECTION_UPDATE_INTERVAL_MS
        || !positionChanged) return;
    }
    this.lastSelectionCamera = {
      position: this.currentCamera.position.slice(),
      forward: this.currentCamera.forward.slice(),
    };
    this.lastSelectionUpdateAt = now;
    const visible = this.visibleNodes(camera);
    const selected = this.selectNodes(camera, visible);
    const selectedFine = this.selectFineRanges(camera, selected);
    const prefetched = this.prefetchNodes(camera, selected);
    const nextVisibleIds = visible.map((node) => node.id).sort();
    const nextIds = selected.map((node) => node.id).sort();
    const nextFineIds = selectedFine.map((item) => item.id).sort();
    const visibilityChanged = nextVisibleIds.join('|') !== this.visibleIds.join('|');
    const selectionChanged = nextIds.join('|') !== this.selectedIds.join('|')
      || nextFineIds.join('|') !== this.selectedFineIds.join('|');
    const baseFallbackChanged = !!(selectionChanged
      && this.residentReady
      && this.residentBaseIndexes
      && !this.useResidentBaseFallback);
    if (baseFallbackChanged) this.useResidentBaseFallback = true;
    this.visibleIds = nextVisibleIds;
    this.selectedIds = nextIds;
    this.selectedFineIds = nextFineIds;
    this.selectedFineRanges = selectedFine;
    const currentDetailFileIds = new Set();
    const currentFineFileIds = new Set();
    const prefetchedFileIds = new Set();
    selected.forEach((node) => {
      node.detail.forEach((range) => currentDetailFileIds.add(String(range.file)));
    });
    // Load and sort the next depth-5 block before the camera reaches it. It
    // stays out of the draw list until selected.
    prefetched.forEach((node) => {
      node.detail.forEach((range) => prefetchedFileIds.add(String(range.file)));
    });
    // Depth 6 is queued after continuity-critical depth-5 files. Once ready it
    // replaces only its matching depth-5 ranges without creating a hole.
    selectedFine.forEach((item) => {
      item.range.finer.forEach((range) => currentFineFileIds.add(String(range.file)));
    });

    this.primaryFileIds = new Set([...currentDetailFileIds, ...currentFineFileIds]);
    this.selectedFileIds = new Set([
      ...currentDetailFileIds,
      ...currentFineFileIds,
      ...prefetchedFileIds,
    ]);
    let detailFallbackChanged = false;
    if (selectionChanged) {
      this.selectedFileIds.forEach((fileId) => {
        const state = this.states[fileId];
        if (state && state.residentIndexes && !state.useResidentFallback) {
          state.useResidentFallback = true;
          detailFallbackChanged = true;
        }
      });
    }
    if (!this.startupSelectionCaptured) {
      this.startupSelectionCaptured = true;
      this.startupPrimaryFileIds = new Set(this.primaryFileIds);
    }

    const residentLoadIds = FULL_RESIDENT_MODE && !this.residentModeDegraded
      ? Array.from(this.residentFileIds)
      : [];
    const loadOrder = [
      ...currentDetailFileIds,
      ...currentFineFileIds,
      ...prefetchedFileIds,
      ...residentLoadIds,
    ];
    this.pendingFileIds = this.pendingFileIds.filter((fileId) => this.isFileWanted(fileId));
    new Set(loadOrder).forEach((fileId) => {
      const state = this.states[fileId];
      if (state && this.isFileWanted(fileId)) {
        state.lastUsedAt = Date.now();
        this.prepareFastPathForState(fileId, state);
      }
      this.queueFile(fileId);
    });
    this.evictInactiveStates();
    this.trimFastPaths();
    if (selectionChanged
      || visibilityChanged
      || baseFallbackChanged
      || detailFallbackChanged) this.applySelection();
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
    targetFileIds.forEach((fileId) => {
      const state = this.states[fileId];
      if (!state || !state.renderer || state.failed || state.sortFailed) return;
      this.ensureSortDataset(fileId);
      const sortCamera = this.sortCameraForFile(fileId, camera) || camera;
      if (state.sortHandle) state.sortHandle.request(sortCamera);
    });
  }

  activeNodes() {
    const wanted = new Set(this.selectedIds);
    return (this.scene.nearLod.nodes || []).filter((node) => {
      if (!wanted.has(node.id)) return false;
      return node.detail.every((range) => {
        const state = this.states[String(range.file)];
        return !!(state && state.renderer && state.sortedIndexes);
      });
    });
  }

  activeFineRanges(activeNodes) {
    const activeParents = new Set((activeNodes || []).map((node) => node.id));
    return this.selectedFineRanges.filter((item) => {
      if (!activeParents.has(item.parentId)) return false;
      return item.range.finer.every((range) => {
        const state = this.states[String(range.file)];
        return !!(state && state.renderer && state.sortedIndexes);
      });
    });
  }

  applySelection() {
    if (this.disposed) return;
    const active = this.activeNodes();
    const activeFine = this.activeFineRanges(active);
    const activeBaseRanges = active.reduce(
      (ranges, node) => ranges.concat(node.base || []),
      [],
    );
    const baseRangesSignature = rangesSignature(activeBaseRanges);
    const baseRangesChanged = baseRangesSignature !== this.baseAppliedRangesSignature;
    if (!this.baseRangeMask || baseRangesSignature !== this.baseRangeMaskSignature) {
      this.baseRangeMask = makeRangeMask(
        activeBaseRanges,
        this.baseRenderer ? this.baseRenderer.sourceCount : 0,
      );
      this.baseRangeMaskSignature = baseRangesSignature;
    }
    const useResidentBase = this.useResidentBaseFallback && this.residentBaseIndexes;
    const sourceBaseIndexes = useResidentBase ? this.residentBaseIndexes : this.baseIndexes;
    const sourceBaseVersion = useResidentBase
      ? `resident:${this.residentBaseIndexesVersion}`
      : `sorted:${this.baseIndexesVersion}`;
    const baseKey = `${sourceBaseVersion}/${baseRangesSignature}`;
    if (sourceBaseIndexes && baseKey !== this.baseAppliedKey) {
      const filterScratch = this.baseFilterScratch;
      this.baseFilterScratch = null;
      const deferFilter = this.residentReady && !baseRangesChanged;
      if (deferFilter) {
        this.queueIndexFilter(
          'base',
          sourceBaseIndexes,
          this.baseRangeMask,
          false,
          filterScratch,
          (indexes, scratch) => {
            if (this.disposed || this.baseAppliedKey !== baseKey) {
              this.returnBaseFilterScratch(scratch);
              return;
            }
            const releaseScratch = () => this.returnBaseFilterScratch(scratch);
            this.baseRenderer.updateIndexes(indexes, {
              immediate: false,
              onCommitted: releaseScratch,
              onDiscarded: releaseScratch,
            });
          },
          (scratch) => this.returnBaseFilterScratch(scratch),
        );
      } else {
        this.cancelIndexFilter('base');
        const result = filterIndexesByMask(
          sourceBaseIndexes,
          this.baseRangeMask,
          false,
          filterScratch,
        );
        const releaseScratch = () => this.returnBaseFilterScratch(result.scratch);
        this.baseRenderer.updateIndexes(result.indexes, {
          // A real LOD hand-off stays atomic so root and detail never leave a hole.
          immediate: this.residentReady && baseRangesChanged,
          onCommitted: releaseScratch,
          onDiscarded: releaseScratch,
        });
      }
      this.baseAppliedKey = baseKey;
      this.baseAppliedRangesSignature = baseRangesSignature;
    }

    let activeCount = this.baseRenderer.count || 0;
    this.activeRenderFileIds = new Set();
    const replacedCoarseRanges = new Set(activeFine.map((item) => item.range));
    const rangesByFile = {};
    const addRange = (range) => {
      const fileId = String(range.file);
      if (!rangesByFile[fileId]) rangesByFile[fileId] = [];
      rangesByFile[fileId].push(range);
    };
    active.forEach((node) => {
      node.detail.forEach((range) => {
        if (!replacedCoarseRanges.has(range)) addRange(range);
      });
    });
    activeFine.forEach((item) => item.range.finer.forEach(addRange));
    Object.keys(this.states).forEach((fileId) => {
      const state = this.states[fileId];
      if (!state.renderer || !state.sortedIndexes) return;
      const ranges = rangesByFile[fileId] || [];
      const rangeSignature = rangesSignature(ranges);
      const rangesChanged = rangeSignature !== state.appliedRangesSignature;
      const useResident = state.useResidentFallback && state.residentIndexes;
      const sourceIndexes = useResident ? state.residentIndexes : state.sortedIndexes;
      const sourceVersion = useResident
        ? `resident:${state.residentVersion}`
        : `sorted:${state.sortedVersion}`;
      const stateKey = `${sourceVersion}/${rangeSignature}`;
      if (stateKey !== state.appliedKey) {
        if (!ranges.length) {
          this.cancelIndexFilter(`detail:${fileId}`);
          if (state.renderer.count || state.appliedRangesSignature) {
            state.renderer.updateIndexes(EMPTY_INDEXES, {
              immediate: this.residentReady && rangesChanged,
            });
          }
        } else {
          if (!state.rangeMask || rangeSignature !== state.rangeMaskSignature) {
            state.rangeMask = makeRangeMask(ranges, state.renderer.sourceCount);
            state.rangeMaskSignature = rangeSignature;
          }
          const filterScratch = state.filterScratch;
          state.filterScratch = null;
          const deferFilter = this.residentReady && !rangesChanged;
          if (deferFilter) {
            this.queueIndexFilter(
              `detail:${fileId}`,
              sourceIndexes,
              state.rangeMask,
              true,
              filterScratch,
              (indexes, scratch) => {
                if (this.disposed
                  || this.states[fileId] !== state
                  || state.appliedKey !== stateKey) {
                  this.returnStateFilterScratch(fileId, state, scratch);
                  return;
                }
                const releaseScratch = () => this.returnStateFilterScratch(
                  fileId,
                  state,
                  scratch,
                );
                state.renderer.updateIndexes(indexes, {
                  immediate: false,
                  onCommitted: releaseScratch,
                  onDiscarded: releaseScratch,
                });
              },
              (scratch) => this.returnStateFilterScratch(fileId, state, scratch),
            );
          } else {
            this.cancelIndexFilter(`detail:${fileId}`);
            const result = filterIndexesByMask(
              sourceIndexes,
              state.rangeMask,
              true,
              filterScratch,
            );
            const releaseScratch = () => this.returnStateFilterScratch(
              fileId,
              state,
              result.scratch,
            );
            state.renderer.updateIndexes(result.indexes, {
              immediate: this.residentReady && rangesChanged,
              onCommitted: releaseScratch,
              onDiscarded: releaseScratch,
            });
          }
        }
        state.appliedKey = stateKey;
        state.appliedRangesSignature = rangeSignature;
      }
      if (ranges.length) {
        if (state.renderer.setIndexStride) {
          state.renderer.setIndexStride(this.detailSamplingStride());
        }
        this.activeRenderFileIds.add(fileId);
        activeCount += state.renderer.count;
      }
    });
    this.activeRefinedCount = active.length + activeFine.length;
    if (this.onActiveCount) this.onActiveCount(activeCount, this.activeRefinedCount);
  }

  releaseState(fileId) {
    const state = this.states[fileId];
    if (!state) return;
    this.cancelIndexFilter(`detail:${fileId}`);
    delete this.states[fileId];
    if (state.sortHandle) state.sortHandle.dispose();
    if (state.renderer) state.renderer.dispose();
    state.means = null;
  }

  evictInactiveStates(keepWarm = true) {
    if (this.disposed) return;
    if (FULL_RESIDENT_MODE && !this.residentModeDegraded) return;
    const ids = Object.keys(this.states);
    const limit = keepWarm
      ? Math.max(MAX_CACHED_DETAIL_FILES, this.selectedFileIds.size + WARM_FILE_COUNT)
      : this.selectedFileIds.size;
    if (ids.length <= limit) return;
    const candidates = ids
      .map((fileId) => ({ fileId, state: this.states[fileId] }))
      .filter(({ fileId, state }) => !this.isFileSelected(fileId) && !state.loading)
      .sort((left, right) => (left.state.lastUsedAt || 0) - (right.state.lastUsedAt || 0));
    while (Object.keys(this.states).length > limit && candidates.length) {
      this.releaseState(candidates.shift().fileId);
    }
  }

  trimCache(force = false) {
    if (!force || this.disposed) return;
    this.residentModeDegraded = true;
    if (!this.residentReady) {
      this.startupPrimaryFileIds = new Set(this.selectedFileIds);
      this.startupSelectionCaptured = true;
    }
    this.pendingFileIds = this.pendingFileIds.filter((fileId) => this.isFileSelected(fileId));
    Object.keys(this.states).forEach((fileId) => {
      const state = this.states[fileId];
      if (!this.isFileSelected(fileId) && !state.loading) this.releaseState(fileId);
    });
    this.evictInactiveStates(false);
    this.notifyResidentProgress();
  }

  markSortingUnavailable() {
    this.startupPrimaryFileIds.forEach((fileId) => this.sortFailedFileIds.add(fileId));
    this.notifyResidentProgress();
  }

  queueFile(fileId) {
    const normalized = String(fileId);
    if (this.disposed
      || !this.isFileWanted(normalized)
      || this.residentFailedFileIds.has(normalized)) return;
    const state = this.states[normalized];
    if (state && (!state.failed || Date.now() < state.retryAt)) return;
    if (!this.pendingFileIds.includes(normalized)) this.pendingFileIds.push(normalized);
    this.pumpFileLoads();
  }

  pumpFileLoads() {
    if (this.disposed) return;
    while (this.activeFileLoads < MAX_CONCURRENT_DETAIL_LOADS && this.pendingFileIds.length) {
      const fileId = this.pendingFileIds.shift();
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
      if (!this.disposed && this.isFileWanted(fileId)) this.queueFile(fileId);
    }, RETRY_DELAY_MS);
  }

  ensureSortDataset(fileId) {
    const state = this.states[fileId];
    if (!state
      || !state.renderer
      || !state.means
      || state.loading
      || state.failed
      || state.sortFailed) return;
    this.prepareFastPathForState(fileId, state);
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
            state.sortHandle.request(this.sortCameraForFile(fileId));
          }
        },
        onSorted: (indexes, stats, request) => {
          if (this.disposed || this.states[fileId] !== state) return;
          const residentResult = !!(request
            && request.camera
            && request.camera.cullToFrustum === false);
          if (!residentResult
            && request
            && request.camera
            && !cameraWithinSortCoverage(this.currentCamera, request.camera)) {
            return;
          }
          if (residentResult) {
            state.residentIndexes = indexes;
            state.residentVersion += 1;
            state.useResidentFallback = true;
          } else {
            state.useResidentFallback = false;
          }
          state.sortedIndexes = indexes;
          state.sortedCamera = request && request.camera
            ? {
              position: request.camera.position.slice(),
              forward: request.camera.forward.slice(),
            }
            : null;
          state.sortedVersion += 1;
          state.sortFailed = false;
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
      failed: false,
      filterScratch: null,
      lastUsedAt: now,
      loading: true,
      means: null,
      renderer: null,
      retryAt: 0,
      sortFailed: false,
      sortHandle: null,
      sortReady: false,
      sortedIndexes: null,
      sortedCamera: null,
      sortedVersion: 0,
      residentIndexes: null,
      residentVersion: 0,
      useResidentFallback: true,
      appliedKey: '',
      appliedRangesSignature: '',
      rangeMask: null,
      rangeMaskSignature: '',
    };
    this.states[fileId] = state;

    let assets = null;
    let renderer = null;
    try {
      const detailScene = { ...this.scene, sog: descriptor };
      assets = await loadSogAssets(this.canvas, detailScene);
      if (this.disposed || this.states[fileId] !== state) {
        cleanupAssets(assets);
        return;
      }
      renderer = new SplatRenderer(this.gl, this.width, this.height, {
        enableFallbackAvatar: false,
      });
      renderer.load(detailScene, assets, { initiallyVisible: false });
      state.renderer = renderer;
      state.means = assets.means;
      this.prepareFastPathForState(fileId, state);
      state.loading = false;
      state.failed = false;
      renderer = null;
      cleanupAssets(assets);
      assets = null;
      delete this.fileRetryCounts[fileId];
      this.residentFailedFileIds.delete(fileId);
      if (this.isFileWanted(fileId)) {
        this.ensureSortDataset(fileId);
        if (state.sortHandle && this.currentCamera) {
          state.sortHandle.request(this.sortCameraForFile(fileId));
        }
      }
      this.notifyResidentProgress();
      this.trimFastPaths();
      if (!this.isFileWanted(fileId)) this.evictInactiveStates();
    } catch (error) {
      if (assets) cleanupAssets(assets);
      if (renderer) renderer.dispose();
      if (this.states[fileId] === state) {
        state.loading = false;
        state.failed = true;
        state.retryAt = Date.now() + RETRY_DELAY_MS;
      }
      if (!this.disposed) this.markFileLoadFailed(fileId, error);
    }
  }

  render(matrices, cameraController) {
    this.activeRenderFileIds.forEach((fileId) => {
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
    return maxRows - remaining;
  }

  getDiagnostics() {
    const states = Object.values(this.states);
    return {
      activeFiles: this.activeRenderFileIds.size,
      cachedFiles: states.filter((state) => !!state.renderer).length,
      fastFiles: states.filter((state) => state.renderer && state.renderer.hasFastPath()).length,
      loadingFiles: this.activeFileLoads,
      queuedFiles: this.pendingFileIds.length,
      pendingIndexFilters: this.pendingIndexFilterIds.length,
      pointBudget: this.pointBudget,
      sampleStride: this.samplingStride,
      detailSampleStride: this.detailSamplingStride(),
      selectedFiles: this.selectedFileIds.size,
    };
  }

  dispose() {
    this.disposed = true;
    this.pendingFileIds = [];
    Object.keys(this.states).forEach((fileId) => this.releaseState(fileId));
    this.states = {};
    this.baseIndexes = null;
    this.residentBaseIndexes = null;
    this.baseFilterScratch = null;
    this.pendingIndexFilters = Object.create(null);
    this.pendingIndexFilterIds = [];
  }
}

module.exports = { NearLodController };
