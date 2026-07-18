'use strict';

const WORKER_PATH = 'workers/native-splat-sort.js';
const MAX_RESTARTS = 2;
const ROOT_FRUSTUM_PADDING = 24 * Math.PI / 180;
const DETAIL_FRUSTUM_PADDING = 16 * Math.PI / 180;
const MAX_CONSECUTIVE_ROOT_SORTS = 2;

function messagePayload(event) {
  return event && event.message && typeof event.message === 'object'
    ? event.message
    : event;
}

function meansBufferOf(means) {
  return means.byteOffset === 0 && means.byteLength === means.buffer.byteLength
    ? means.buffer
    : means.buffer.slice(means.byteOffset, means.byteOffset + means.byteLength);
}

function snapshot(camera) {
  return {
    position: camera.position.slice(),
    forward: camera.forward.slice(),
    predictedForward: (camera.predictedForward || camera.forward).slice(),
    aspect: Number(camera.aspect) || 1,
    fovY: Number(camera.fovY) || 55 * Math.PI / 180,
    far: Number(camera.far) || 3000,
    sampleStride: Math.max(1, Math.floor(Number(camera.sampleStride) || 1)),
    cullToFrustum: camera.cullToFrustum !== false,
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
  const datasets = {};
  const stats = {
    requests: 0,
    results: 0,
    lastDuration: 0,
    lastWorkerDuration: 0,
    lastVisibleCount: 0,
    lastTotalCount: 0,
    restarts: 0,
  };

  function makeDataset(id, datasetScene, datasetMeans, datasetCallbacks) {
    return {
      id,
      callbacks: datasetCallbacks || {},
      count: datasetScene.sog.meta.count,
      meansBuffer: meansBufferOf(datasetMeans),
      mins: datasetScene.sog.meta.means.mins,
      maxs: datasetScene.sog.meta.means.maxs,
      pending: null,
      queuedAt: 0,
      ready: false,
      released: false,
      requestId: 0,
      busy: false,
      failed: false,
    };
  }

  datasets.root = makeDataset('root', scene, means, callbacks);

  function postInit(dataset) {
    if (!worker || disposed || dataset.released) return;
    worker.postMessage({
      type: 'init',
      datasetId: dataset.id,
      count: dataset.count,
      meansBuffer: dataset.meansBuffer,
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
    return !!(active && active.datasetId === datasetId);
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
      if (message.type !== 'sorted') return;
      const completedRequest = active;
      dataset.busy = false;
      active = null;
      stats.results += 1;
      stats.lastDuration = message.duration || 0;
      stats.lastWorkerDuration = message.workerDuration || 0;
      stats.lastVisibleCount = message.visibleCount || 0;
      stats.lastTotalCount = message.totalCount || dataset.count;
      if (dataset.id === 'root') restartCount = 0;
      if (dataset.released) {
        releaseDataset(dataset.id);
        pump();
        return;
      }
      if (!completedRequest.cancelled && dataset.callbacks.onSorted) {
        dataset.callbacks.onSorted(new Uint32Array(message.indexesBuffer), stats, completedRequest);
      }
      // Give the renderer one event-loop turn to stage this result before the
      // worker starts consuming CPU for the next LOD dataset.
      setTimeout(pump, 0);
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
    Object.values(datasets).forEach((dataset) => {
      dataset.ready = false;
      dataset.busy = false;
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
        return { ...stats, busy: !!(active && active.datasetId === id), ready: dataset.ready };
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
      Object.values(datasets).forEach((dataset) => { dataset.pending = null; });
      if (worker) worker.terminate();
      worker = null;
    },
    getStats() {
      const root = datasets.root;
      return {
        ...stats,
        busy: !!active,
        failed,
        ready: !!(root && root.ready),
      };
    },
    request(camera) { return submit('root', camera); },
  };
}

module.exports = { createSortController };
