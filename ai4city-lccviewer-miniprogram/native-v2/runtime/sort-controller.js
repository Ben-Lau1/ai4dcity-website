'use strict';

const { normalizeSampleStride } = require('./sample-stride');

const WORKER_PATH = 'workers/native-splat-sort.js';
const MAX_RESTARTS = 2;
const MAX_CONSECUTIVE_ROOT_SORTS = 2;
const DETAIL_INIT_CHUNK_BYTES = 256 * 1024;
const DETAIL_INIT_INTERVAL_MS = 16;
const RESULT_TRANSFER_CHUNK_INDICES = 32768;
const RESULT_TRANSFER_MAX_CHUNK_INDICES = 65536;
const ROOT_FRUSTUM_PADDING = 24 * Math.PI / 180;
const DETAIL_FRUSTUM_PADDING = 16 * Math.PI / 180;

function messagePayload(event) {
  return event && event.message && typeof event.message === 'object'
    ? event.message
    : event;
}

function dataBufferOf(values) {
  return values.byteOffset === 0 && values.byteLength === values.buffer.byteLength
    ? values.buffer
    : values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength);
}

function sortPayloadOf(datasetScene, data) {
  const count = datasetScene.sog.meta.count;
  if (data
    && data.format === 'uint16x3-linear'
    && data.values
    && Array.isArray(data.mins)
    && Array.isArray(data.maxs)) {
    if (data.values.byteLength !== count * 6) {
      throw new Error(`Linear sort centers length mismatch for ${count} points`);
    }
    return {
      buffer: dataBufferOf(data.values),
      format: data.format,
      maxs: data.maxs.slice(),
      mins: data.mins.slice(),
    };
  }
  if (!data || data.byteLength !== count * 6) {
    throw new Error(`Packed sort coordinates length mismatch for ${count} points`);
  }
  return {
    buffer: dataBufferOf(data),
    format: 'packed-log-u8',
    maxs: datasetScene.sog.meta.means.maxs,
    mins: datasetScene.sog.meta.means.mins,
  };
}

function snapshot(camera) {
  return {
    position: camera.position.slice(),
    forward: camera.forward.slice(),
    predictedForward: (camera.predictedForward || camera.forward).slice(),
    aspect: Number(camera.aspect) || 1,
    fovY: Number(camera.fovY) || 55 * Math.PI / 180,
    far: Number(camera.far) || 3000,
    sampleStride: normalizeSampleStride(camera.sampleStride),
    cullToFrustum: camera.cullToFrustum !== false,
    enableDepthSorting: camera.enableDepthSorting === true,
    reason: camera.reason || 'settled',
  };
}

function createSortController(scene, means, callbacks = {}) {
  let worker = null;
  let disposed = false;
  let failed = false;
  let generation = 0;
  let restartCount = 0;
  let active = null;
  let consecutiveRootSorts = 0;
  let detailInitTimer = null;
  const detailInitQueue = [];
  const datasets = {};
  const stats = {
    requests: 0,
    results: 0,
    lastDuration: 0,
    lastTransferChunks: 0,
    lastTransferDuration: 0,
    lastWorkerDuration: 0,
    lastVisibleCount: 0,
    lastTotalCount: 0,
    restarts: 0,
  };

  function makeDataset(id, datasetScene, datasetMeans, datasetCallbacks) {
    const sortPayload = sortPayloadOf(datasetScene, datasetMeans);
    return {
      id,
      callbacks: datasetCallbacks || {},
      count: datasetScene.sog.meta.count,
      sortBuffer: sortPayload.buffer,
      sortFormat: sortPayload.format,
      mins: sortPayload.mins,
      maxs: sortPayload.maxs,
      pending: null,
      queuedAt: 0,
      ready: false,
      released: false,
      requestId: 0,
      busy: false,
      failed: false,
      initOffset: 0,
      initStarted: false,
    };
  }

  datasets.root = makeDataset('root', scene, means, callbacks);

  function scheduleDetailInit() {
    if (disposed || !worker || detailInitTimer || !detailInitQueue.length) return;
    detailInitTimer = setTimeout(flushDetailInitChunk, DETAIL_INIT_INTERVAL_MS);
  }

  function flushDetailInitChunk() {
    detailInitTimer = null;
    if (disposed || !worker) return;
    let dataset = null;
    while (detailInitQueue.length && !dataset) {
      const datasetId = detailInitQueue.shift();
      const candidate = datasets[datasetId];
      if (candidate && !candidate.released && !candidate.ready) dataset = candidate;
    }
    if (!dataset) return;
    try {
      if (!dataset.initStarted) {
        worker.postMessage({
          type: 'init-start',
          datasetId: dataset.id,
          byteLength: dataset.sortBuffer.byteLength,
          count: dataset.count,
          format: dataset.sortFormat,
          mins: dataset.mins,
          maxs: dataset.maxs,
        });
        dataset.initStarted = true;
        dataset.initOffset = 0;
      }
      const end = Math.min(
        dataset.sortBuffer.byteLength,
        dataset.initOffset + DETAIL_INIT_CHUNK_BYTES,
      );
      const chunkBuffer = dataset.sortBuffer.slice(dataset.initOffset, end);
      worker.postMessage({
        type: 'init-chunk',
        datasetId: dataset.id,
        offset: dataset.initOffset,
        sortDataBuffer: chunkBuffer,
      });
      dataset.initOffset = end;
      if (dataset.initOffset < dataset.sortBuffer.byteLength) {
        detailInitQueue.push(dataset.id);
      }
      scheduleDetailInit();
    } catch (error) {
      restartWorker(error);
    }
  }

  function postInit(dataset) {
    if (!worker || disposed || dataset.released) return;
    if (dataset.id !== 'root') {
      dataset.initOffset = 0;
      dataset.initStarted = false;
      if (!detailInitQueue.includes(dataset.id)) detailInitQueue.push(dataset.id);
      scheduleDetailInit();
      return;
    }
    worker.postMessage({
      type: 'init',
      datasetId: dataset.id,
      count: dataset.count,
      format: dataset.sortFormat,
      sortDataBuffer: dataset.sortBuffer,
      mins: dataset.mins,
      maxs: dataset.maxs,
    });
  }

  function nextPendingDataset() {
    const root = datasets.root;
    const details = Object.keys(datasets)
      .filter((id) => id !== 'root')
      .map((id) => datasets[id])
      .filter((dataset) => dataset.ready && dataset.pending && !dataset.failed && !dataset.released)
      .sort((left, right) => left.queuedAt - right.queuedAt);
    const rootPending = root && root.ready && root.pending && !root.failed;
    if (rootPending && (consecutiveRootSorts < MAX_CONSECUTIVE_ROOT_SORTS || !details.length)) {
      return root;
    }
    return details[0] || (rootPending ? root : null);
  }

  function pump() {
    if (disposed || failed || !worker || active) return;
    const dataset = nextPendingDataset();
    if (!dataset) return;
    const request = dataset.pending;
    dataset.pending = null;
    dataset.queuedAt = 0;
    dataset.busy = true;
    consecutiveRootSorts = dataset.id === 'root' ? consecutiveRootSorts + 1 : 0;
    generation += 1;
    active = {
      datasetId: dataset.id,
      camera: request.camera,
      generation,
      requestId: request.requestId,
    };
    stats.requests += 1;
    try {
      worker.postMessage({
        type: 'sort',
        datasetId: dataset.id,
        generation,
        requestId: request.requestId,
        position: request.camera.position,
        forward: request.camera.forward,
        predictedForward: request.camera.predictedForward,
        aspect: request.camera.aspect,
        fovY: request.camera.fovY,
        far: request.camera.far,
        sampleStride: request.camera.sampleStride,
        enableDepthSorting: request.camera.enableDepthSorting,
        // Sort the current and predicted view together. Padding covers large
        // splats at the edge without paying for the full front hemisphere.
        cullToFrustum: request.camera.cullToFrustum,
        frustumPadding: dataset.id === 'root'
          ? ROOT_FRUSTUM_PADDING
          : DETAIL_FRUSTUM_PADDING,
        startedAt: Date.now(),
      });
    } catch (error) {
      dataset.pending = request;
      restartWorker(error);
    }
  }

  function submit(datasetId, camera) {
    const dataset = datasets[datasetId];
    if (disposed || failed || !dataset || dataset.failed || !camera) return false;
    dataset.requestId += 1;
    if (!dataset.pending) dataset.queuedAt = Date.now();
    dataset.pending = { camera: snapshot(camera), requestId: dataset.requestId };
    pump();
    return true;
  }

  function notifyError(error) {
    failed = true;
    active = null;
    Object.values(datasets).forEach((dataset) => {
      dataset.ready = false;
      dataset.busy = false;
      dataset.pending = null;
      dataset.failed = true;
      if (dataset.callbacks.onError) dataset.callbacks.onError(error);
    });
  }

  function releaseDataset(id) {
    if (!id || id === 'root' || !datasets[id]) return;
    for (let index = detailInitQueue.length - 1; index >= 0; index -= 1) {
      if (detailInitQueue[index] === id) detailInitQueue.splice(index, 1);
    }
    if (worker) {
      try { worker.postMessage({ type: 'release', datasetId: id }); } catch (error) { /* worker is stopping */ }
    }
    delete datasets[id];
  }

  function cancelDetailRequests() {
    Object.keys(datasets).forEach((id) => {
      if (id === 'root') return;
      const dataset = datasets[id];
      dataset.pending = null;
      dataset.queuedAt = 0;
    });
    if (active && active.datasetId !== 'root') active.cancelled = true;
  }

  function discardWorkerResult(request) {
    if (!worker || !request || !request.resultMeta || !request.resultMeta.visibleCount) return;
    try {
      worker.postMessage({
        type: 'discard-result',
        datasetId: request.datasetId,
        generation: request.generation,
        requestId: request.requestId,
      });
    } catch (error) {
      // Worker restart will release its pending result.
    }
  }

  function finishActiveResult(dataset) {
    if (!active || active.datasetId !== dataset.id) return;
    const completedRequest = active;
    const metadata = completedRequest.resultMeta || {};
    const indexes = completedRequest.resultIndexes || new Uint32Array(0);
    dataset.busy = false;
    active = null;
    stats.results += 1;
    stats.lastDuration = metadata.duration || 0;
    stats.lastTransferChunks = completedRequest.resultChunks || 0;
    stats.lastTransferDuration = completedRequest.resultTransferStartedAt
      ? Date.now() - completedRequest.resultTransferStartedAt
      : 0;
    stats.lastWorkerDuration = metadata.workerDuration || 0;
    stats.lastVisibleCount = metadata.visibleCount || 0;
    stats.lastTotalCount = metadata.totalCount || dataset.count;
    if (dataset.id === 'root') restartCount = 0;
    if (dataset.released) {
      releaseDataset(dataset.id);
      pump();
      return;
    }
    if (!completedRequest.cancelled && dataset.callbacks.onSorted) {
      dataset.callbacks.onSorted(indexes, stats, completedRequest);
    }
    // Give rendering one event-loop turn before the next dataset consumes CPU.
    setTimeout(pump, 0);
  }

  function beginResultTransfer(dataset, message) {
    active.resultMeta = message;
    active.resultIndexes = new Uint32Array(Math.max(0, Number(message.visibleCount) || 0));
    active.resultReceived = 0;
    active.resultChunkRequested = false;
    active.resultChunks = 0;
    active.resultTransferStartedAt = Date.now();
    if (active.cancelled || dataset.released) {
      discardWorkerResult(active);
      finishActiveResult(dataset);
      return;
    }
    if (!active.resultIndexes.length) finishActiveResult(dataset);
  }

  function appendResultChunk(dataset, message) {
    if (!active.resultIndexes || !active.resultMeta) return;
    const chunk = new Uint32Array(message.indexesBuffer || new ArrayBuffer(0));
    const offset = Math.max(0, Math.floor(Number(message.offset) || 0));
    const expectedOffset = active.resultReceived || 0;
    if (offset !== expectedOffset || offset + chunk.length > active.resultIndexes.length) {
      restartWorker(new Error('Sort result chunk sequence is invalid'));
      return;
    }
    active.resultIndexes.set(chunk, offset);
    active.resultReceived += chunk.length;
    active.resultChunks += 1;
    active.resultChunkRequested = false;
    if (!message.done) return;
    if (active.resultReceived !== active.resultIndexes.length) {
      restartWorker(new Error('Sort result transfer ended before all indexes arrived'));
      return;
    }
    finishActiveResult(dataset);
  }

  function attach(nextWorker) {
    nextWorker.onMessage((event) => {
      if (disposed || worker !== nextWorker) return;
      const message = messagePayload(event);
      if (!message || !message.type) return;
      const dataset = datasets[message.datasetId || 'root'];
      if (!dataset) return;
      if (message.type === 'ready') {
        if (dataset.released) {
          releaseDataset(dataset.id);
          return;
        }
        dataset.ready = true;
        dataset.failed = false;
        if (dataset.callbacks.onReady) dataset.callbacks.onReady();
        pump();
        return;
      }
      if (!active
        || active.datasetId !== dataset.id
        || active.generation !== message.generation
        || active.requestId !== message.requestId) return;
      if (message.type === 'sorted-start') {
        beginResultTransfer(dataset, message);
      } else if (message.type === 'sorted-chunk') {
        appendResultChunk(dataset, message);
      }
    });
    nextWorker.onError((error) => {
      if (disposed || worker !== nextWorker) return;
      if (restartCount < MAX_RESTARTS) restartWorker(error);
      else notifyError(error);
    });
    if (typeof nextWorker.onProcessKilled === 'function') {
      nextWorker.onProcessKilled((event) => {
        if (disposed || worker !== nextWorker) return;
        restartWorker(event || new Error('Sort worker was reclaimed'));
      });
    }
  }

  function createWorker() {
    let nextWorker;
    try {
      nextWorker = wx.createWorker(WORKER_PATH, { useExperimentalWorker: true });
    } catch (experimentalError) {
      nextWorker = wx.createWorker(WORKER_PATH);
    }
    worker = nextWorker;
    failed = false;
    active = null;
    if (detailInitTimer) clearTimeout(detailInitTimer);
    detailInitTimer = null;
    detailInitQueue.length = 0;
    Object.values(datasets).forEach((dataset) => {
      dataset.ready = false;
      dataset.busy = false;
      dataset.initOffset = 0;
      dataset.initStarted = false;
    });
    attach(nextWorker);
    Object.values(datasets).forEach(postInit);
  }

  function restartWorker(reason) {
    if (disposed) return;
    if (active) {
      const dataset = datasets[active.datasetId];
      if (dataset && dataset.released) {
        delete datasets[active.datasetId];
      } else if (dataset && !dataset.pending) {
        dataset.pending = { camera: active.camera, requestId: active.requestId };
        dataset.queuedAt = Date.now();
      }
    }
    active = null;
    const previous = worker;
    worker = null;
    if (previous) {
      try { previous.terminate(); } catch (error) { /* already stopped */ }
    }
    restartCount += 1;
    stats.restarts = restartCount;
    if (restartCount > MAX_RESTARTS) {
      notifyError(reason || new Error('Sort worker could not be restored'));
      return;
    }
    try {
      createWorker();
    } catch (error) {
      notifyError(error);
    }
  }

  function flushResultTransfer(maxIndices = RESULT_TRANSFER_CHUNK_INDICES) {
    if (disposed
      || failed
      || !worker
      || !active
      || !active.resultIndexes
      || active.resultChunkRequested) return 0;
    const dataset = datasets[active.datasetId];
    if (!dataset) return 0;
    if (active.cancelled || dataset.released) {
      discardWorkerResult(active);
      finishActiveResult(dataset);
      return 0;
    }
    const remaining = active.resultIndexes.length - (active.resultReceived || 0);
    if (remaining <= 0) {
      finishActiveResult(dataset);
      return 0;
    }
    const count = Math.min(
      remaining,
      RESULT_TRANSFER_MAX_CHUNK_INDICES,
      Math.max(1, Math.floor(Number(maxIndices) || RESULT_TRANSFER_CHUNK_INDICES)),
    );
    active.resultChunkRequested = true;
    try {
      worker.postMessage({
        type: 'result-chunk',
        datasetId: active.datasetId,
        generation: active.generation,
        requestId: active.requestId,
        offset: active.resultReceived || 0,
        maxCount: count,
      });
      return count;
    } catch (error) {
      active.resultChunkRequested = false;
      restartWorker(error);
      return 0;
    }
  }

  function addDataset(id, datasetScene, datasetMeans, datasetCallbacks = {}) {
    if (disposed || !id || id === 'root') throw new Error('Invalid sort dataset id');
    if (datasets[id]) throw new Error(`Sort dataset already exists: ${id}`);
    const dataset = makeDataset(id, datasetScene, datasetMeans, datasetCallbacks);
    datasets[id] = dataset;
    postInit(dataset);
    return {
      dispose() {
        if (!datasets[id]) return;
        datasets[id].released = true;
        datasets[id].callbacks = {};
        datasets[id].pending = null;
        if (active && active.datasetId === id) {
          return;
        }
        releaseDataset(id);
      },
      getStats() {
        return {
          ...stats,
          busy: !!(active && active.datasetId === id),
          queued: !!dataset.pending,
          ready: dataset.ready,
        };
      },
      request(camera) { return submit(id, camera); },
    };
  }

  try {
    createWorker();
  } catch (error) {
    setTimeout(() => {
      if (!disposed) notifyError(error);
    }, 0);
  }

  return {
    addDataset,
    cancelDetailRequests,
    dispose() {
      disposed = true;
      active = null;
      if (detailInitTimer) clearTimeout(detailInitTimer);
      detailInitTimer = null;
      detailInitQueue.length = 0;
      Object.values(datasets).forEach((dataset) => { dataset.pending = null; });
      if (worker) worker.terminate();
      worker = null;
    },
    flushResultTransfer,
    getStats() {
      const root = datasets.root;
      return {
        ...stats,
        activeDatasetId: active ? active.datasetId : null,
        busy: !!active,
        failed,
        queued: Object.values(datasets).filter((dataset) => !!dataset.pending).length,
        ready: !!(root && root.ready),
        transferRemaining: active && active.resultIndexes
          ? Math.max(0, active.resultIndexes.length - (active.resultReceived || 0))
          : 0,
        transferring: !!(active && active.resultIndexes),
      };
    },
    request(camera) { return submit('root', camera); },
  };
}

module.exports = { createSortController };
