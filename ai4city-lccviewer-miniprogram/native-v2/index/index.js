'use strict';

const { createCameraController } = require('../controls/camera-controller');
const {
  cleanupAssets,
  cleanupStaleSogCache,
  loadSogAssets,
} = require('../runtime/range-loader');
const { CollisionController } = require('../runtime/collision-controller');
const {
  cameraNeedsSort,
  cameraWithinSortCoverage,
} = require('../runtime/camera-sort-policy');
const { createSortController } = require('../runtime/sort-controller');
const { NearLodController } = require('../runtime/near-lod-controller');
const {
  DEFAULT_QUALITY_LEVEL,
  QUALITY_OPTIONS,
  qualityProfile,
  sampleStrideMatches,
} = require('../runtime/quality-policy');
const { SplatRenderer } = require('../runtime/splat-renderer');
const { TrajectoryPlayer } = require('../runtime/trajectory-player');
const SCENES = require('../scenes/generated');

const SORT_IDLE_MS = 180;
const ENABLE_DIRECTIONAL_DEPTH_SORTING = false;
const SORT_MOVING_INTERVAL_MS = 1200;
const SORT_MOVING_INTERVAL_MAX_MS = 2000;
const SORT_MOVING_FRAME_BUDGET_MS = 34;
const DETAIL_SORT_MOVING_INTERVAL_MS = 900;
const MOVING_ROOT_INDEX_UPLOAD_ROWS = 4;
const MOVING_DETAIL_INDEX_UPLOAD_ROWS = 8;
const MOVING_SORT_RESULT_CHUNK_INDICES = 24576;
const IDLE_SORT_RESULT_CHUNK_INDICES = 65536;
const CONGESTED_SORT_RESULT_CHUNK_INDICES = 8192;
const SORT_PREDICTION_HORIZON_MS = 700;
const JOYSTICK_RADIUS = 54;
const DOUBLE_TAP_INTERVAL_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 20;
const TAP_MAX_DURATION_MS = 260;
const TAP_MOVE_THRESHOLD_PX = 10;
const DIAGNOSTIC_INTERVAL_MS = 1000;
// Preserve mobile clarity while retaining a small emergency fallback for
// genuinely GPU-bound frames. Camera movement alone must not reduce resolution.
const BASE_PIXEL_RATIO = 1.25;
const INTERACTIVE_PIXEL_RATIO = 1.05;
const EMERGENCY_PIXEL_RATIO = 0.82;
const RENDER_SCALE_MIN_HOLD_MS = 700;
const RENDER_SCALE_UP_MIN_HOLD_MS = 2200;
const RENDER_SCALE_RECOVERY_HOLD_MS = 1200;
const RENDER_SCALE_BUSY_GRACE_MS = 3200;
const POOR_FRAME_TIME_MS = 55;
const VERY_POOR_FRAME_TIME_MS = 68;
const POOR_FRAME_RECOVERY_MS = 50;
const VERY_POOR_FRAME_RECOVERY_MS = 60;
const BACKGROUND_GPU_IDLE_MS = 220;
const FAST_PATH_IDLE_MS = 1200;
const BACKGROUND_GPU_HEADROOM_MS = 38;
const BACKGROUND_GPU_MOVING_INTERVAL = 8;
const MOVING_DETAIL_INSTALL_INTERVAL_MS = 150;
const GPU_TIMER_SAMPLE_INTERVAL_MS = 250;
const SORT_FOV_Y = 55 * Math.PI / 180;
const SORT_FAR = 3000;
const SCENE_MANIFEST_CACHE_VERSION = 'native-pack-v2';
const ROOT_NATIVE_PACK_DOWNLOAD_CONCURRENCY = 4;
const sceneManifestCache = new Map();
const sceneManifestRequests = new Map();
const ENVIRONMENT_OPTIONS = [
  { id: 'dark', label: '深色' },
  { id: 'sky', label: '天空' },
];

const SCENE_OPTIONS = Object.keys(SCENES).map((id) => ({
  id,
  label: SCENES[id].label,
}));

const MODE_OPTIONS = [
  { id: 'orbit', label: '自由', icon: '/native-v2/assets/ui/mode-orbit.svg' },
  { id: 'firstPerson', label: '第一人称', icon: '/native-v2/assets/ui/mode-first-person.svg' },
  { id: 'avatar', label: '第三人称', icon: '/native-v2/assets/ui/mode-avatar.svg' },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function touchPoint(touch) {
  if (!touch) return null;
  return {
    x: touch.clientX === undefined ? touch.x : touch.clientX,
    y: touch.clientY === undefined ? touch.y : touch.clientY,
  };
}

function touchId(touch) {
  return touch && touch.identifier !== undefined ? touch.identifier : 0;
}

function touchesOf(event) {
  return Array.from((event && event.touches) || []);
}

function loadSceneManifest(entry) {
  const cacheKey = `${entry.id}|${entry.manifestUrl}|${SCENE_MANIFEST_CACHE_VERSION}`;
  if (sceneManifestCache.has(cacheKey)) {
    return Promise.resolve(sceneManifestCache.get(cacheKey));
  }
  if (sceneManifestRequests.has(cacheKey)) return sceneManifestRequests.get(cacheKey);
  const separator = entry.manifestUrl.includes('?') ? '&' : '?';
  const request = new Promise((resolve, reject) => {
    wx.request({
      url: `${entry.manifestUrl}${separator}v=${SCENE_MANIFEST_CACHE_VERSION}`,
      method: 'GET',
      dataType: 'json',
      timeout: 120000,
      success: (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`场景清单请求失败 (${response.statusCode})`));
          return;
        }
        try {
          const scene = typeof response.data === 'string'
            ? JSON.parse(response.data)
            : response.data;
          if (!scene || scene.id !== entry.id || !scene.sog || !scene.trajectory) {
            throw new Error('场景清单格式不完整');
          }
          resolve(scene);
        } catch (error) {
          reject(error);
        }
      },
      fail: (error) => reject(new Error(errorMessage(error))),
    });
  });
  const tracked = request.then(
    (scene) => {
      sceneManifestCache.set(cacheKey, scene);
      sceneManifestRequests.delete(cacheKey);
      return scene;
    },
    (error) => {
      sceneManifestRequests.delete(cacheKey);
      throw error;
    },
  );
  sceneManifestRequests.set(cacheKey, tracked);
  return tracked;
}

function changedTouchesOf(event) {
  return Array.from((event && event.changedTouches) || []);
}

function distanceBetweenTouches(touches) {
  if (!touches || touches.length < 2) return 0;
  const first = touchPoint(touches[0]);
  const second = touchPoint(touches[1]);
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function errorMessage(error) {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  return error.errMsg || error.message || String(error);
}

function getWindowInfo() {
  if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo();
  return wx.getSystemInfoSync();
}

function formatSplatCount(count) {
  const numeric = Number(count) || 0;
  if (numeric >= 10000) return `${(numeric / 10000).toFixed(1)}万`;
  return String(numeric);
}

function cameraSnapshot(camera) {
  return {
    enableDepthSorting: camera.enableDepthSorting === true,
    forward: camera.forward.slice(),
    position: camera.position.slice(),
  };
}

function predictForward(current, previousSample, now) {
  const forward = current.forward.slice();
  if (!previousSample) return forward;
  const elapsed = Math.max(16, now - previousSample.at);
  const horizonScale = clamp(SORT_PREDICTION_HORIZON_MS / elapsed, 0, 3);
  const predicted = [
    forward[0] + (forward[0] - previousSample.forward[0]) * horizonScale,
    forward[1] + (forward[1] - previousSample.forward[1]) * horizonScale,
    forward[2] + (forward[2] - previousSample.forward[2]) * horizonScale,
  ];
  const length = Math.hypot(predicted[0], predicted[1], predicted[2]);
  if (length < 0.000001) return forward;
  return predicted.map((value) => value / length);
}

Page({
  data: {
    activeMode: 'firstPerson',
    activeSceneId: SCENE_OPTIONS[0].id,
    activeSceneLabel: SCENE_OPTIONS[0].label,
    collisionEnabled: true,
    diagnosticsVisible: false,
    environment: 'dark',
    environments: ENVIRONMENT_OPTIONS,
    errorDetail: '',
    fps: 0,
    cpuTimeText: '--',
    gpuTimeText: '--',
    headerTop: 32,
    panelTop: 86,
    helpOpen: false,
    joystickActive: false,
    joystickCenterX: 0,
    joystickCenterY: 0,
    joystickThumbX: 0,
    joystickThumbY: 0,
    jumpActive: false,
    loading: true,
    modes: MODE_OPTIONS,
    phase: 'booting',
    progress: 0,
    qualityLabel: qualityProfile(DEFAULT_QUALITY_LEVEL).label,
    qualityLevel: DEFAULT_QUALITY_LEVEL,
    qualityOptions: QUALITY_OPTIONS,
    sceneMenuOpen: false,
    scenes: SCENE_OPTIONS,
    settingsOpen: false,
    sortDurationText: '--',
    sortRequests: 0,
    sortResults: 0,
    sortState: '等待首排',
    splatCountText: '--',
    renderPathText: '--',
    sampleStrideText: '1/1',
    visibleRatioText: '--',
    lodCacheText: '--',
    statusText: '正在初始化 WebGL2',
    sprintEnabled: false,
    trajectoryPlaying: false,
  },

  onLoad(options) {
    cleanupStaleSogCache();
    this.disposed = false;
    this.suspended = false;
    this.renderFailed = false;
    this.frameId = null;
    this.loadGeneration = 0;
    this.sceneLoadInFlight = false;
    this.loadingSceneId = null;
    this.queuedSceneId = null;
    this.cameraRevision = 0;
    this.sortRequestRevision = -1;
    this.sortRequestInFlight = false;
    this.sortDirty = false;
    this.detailSortDirty = false;
    this.sortFailed = false;
    this.firstSortComplete = false;
    this.rootSortReady = false;
    this.residentReady = false;
    this.residentProgress = null;
    this.lastSortedCamera = null;
    this.sortRequestedCamera = null;
    this.detailSortRequestedCamera = null;
    this.lastMotionAt = 0;
    this.lastMovingDetailInstallAt = 0;
    this.lastMovingRootSortAt = 0;
    this.lastMovingDetailSortAt = 0;
    this.wasCameraMoving = false;
    this.cameraPredictionSample = null;
    this.predictedForward = null;
    this.lastFrameCpuMs = 0;
    this.lastGpuMs = 0;
    this.lastGpuSampleAt = 0;
    this.lastGpuQueryAt = 0;
    this.lastGpuPollAt = 0;
    this.frameMsEma = 16.7;
    this.frameIntervalMsEma = 16.7;
    this.lastRenderScaleChangeAt = 0;
    this.renderScaleRecoveryStartedAt = 0;
    this.renderScaleRecoveryTarget = 0;
    this.frameCount = 0;
    this.fpsWindowStarted = Date.now();
    this.lastDiagnosticAt = 0;
    this.gpuTimerExtension = null;
    this.activeGpuQuery = null;
    this.pendingGpuQueries = [];
    this.detailedAvatarRenderer = null;
    this.detailedAvatarInitAttempted = false;
    this.collisionController = null;
    this.nearLodController = null;
    this.trajectoryPlayer = null;
    this.movementX = 0;
    this.movementZ = 0;
    this.lastLookTapAt = 0;
    this.lastLookTapX = 0;
    this.lastLookTapY = 0;
    this.lookTapCandidateId = null;
    this.lookTapStartedAt = 0;
    this.lookTapStartX = 0;
    this.lookTapStartY = 0;
    this.lastMemoryWarningAt = 0;
    this.memoryWarningBurstCount = 0;
    this.memoryWarningHandler = (warning) => this.handleMemoryWarning(warning);
    if (typeof wx.onMemoryWarning === 'function') wx.onMemoryWarning(this.memoryWarningHandler);

    const requestedSceneId = options && options.scene;
    const initialScene = SCENES[requestedSceneId] || SCENES[SCENE_OPTIONS[0].id];
    this.setData({
      activeSceneId: initialScene.id,
      activeSceneLabel: initialScene.label,
      diagnosticsVisible: !!(options && options.debug === '1'),
    });
    this.refreshChromeMetrics();
  },

  onReady() {
    this.queryCanvas(0);
  },

  onShow() {
    this.refreshChromeMetrics();
    if (!this.suspended || this.disposed) return;
    this.suspended = false;
    this.lastFrameTime = Date.now();
    this.frameMsEma = 16.7;
    this.renderScaleRecoveryStartedAt = 0;
    this.renderScaleRecoveryTarget = 0;
    this.frameCount = 0;
    this.fpsWindowStarted = this.lastFrameTime;
    this.startRenderLoop();
  },

  onHide() {
    this.suspended = true;
    this.stopTrajectory();
    this.resetTouchState(false);
    this.stopRenderLoop();
    if (this.collisionController) this.collisionController.trimCache();
    if (this.nearLodController) this.nearLodController.trimCache();
  },

  onUnload() {
    this.disposed = true;
    this.loadGeneration += 1;
    this.queuedSceneId = null;
    if (this.canvasRetryTimer) clearTimeout(this.canvasRetryTimer);
    this.stopRenderLoop();
    if (this.memoryWarningHandler && typeof wx.offMemoryWarning === 'function') {
      wx.offMemoryWarning(this.memoryWarningHandler);
    }
    this.disposeSceneResources();
    this.disposeDetailedAvatarRenderer();
    this.disposeGpuTimers();
    this.canvas = null;
    this.gl = null;
  },

  onResize(event) {
    const size = event && event.size;
    this.refreshChromeMetrics(size);
    if (!size || !this.canvas) return;
    const changed = this.resizeCanvas(size.windowWidth, size.windowHeight);
    if (changed && this.cameraController) this.markCameraChanged(Date.now());
  },

  refreshChromeMetrics() {
    const windowInfo = getWindowInfo();
    const menuButton = typeof wx.getMenuButtonBoundingClientRect === 'function'
      ? wx.getMenuButtonBoundingClientRect()
      : null;
    const statusBarBottom = (Number(windowInfo.statusBarHeight) || 24) + 8;
    const menuBottom = menuButton && Number(menuButton.bottom)
      ? Number(menuButton.bottom) + 8
      : 0;
    const headerTop = Math.max(statusBarBottom, menuBottom);
    this.setDataIfChanged({
      headerTop,
      panelTop: headerTop + 50,
    });
  },

  queryCanvas(attempt) {
    if (this.disposed) return;
    const query = typeof this.createSelectorQuery === 'function'
      ? this.createSelectorQuery()
      : wx.createSelectorQuery();
    query
      .select('#native-v2-canvas')
      .fields({ node: true, size: true })
      .exec((result) => {
        if (this.disposed) return;
        const canvasInfo = result && result[0];
        if (!canvasInfo || !canvasInfo.node) {
          if (attempt < 5) {
            this.canvasRetryTimer = setTimeout(() => this.queryCanvas(attempt + 1), 120);
            return;
          }
          this.fail('未获取到原生 WebGL Canvas');
          return;
        }
        this.initializeCanvas(canvasInfo.node, canvasInfo.width, canvasInfo.height);
      });
  },

  initializeCanvas(canvas, measuredWidth, measuredHeight) {
    try {
      const windowInfo = getWindowInfo();
      this.canvas = canvas;
      const devicePixelRatio = Math.max(Number(windowInfo.pixelRatio) || 1, 0.5);
      this.basePixelRatio = Math.min(devicePixelRatio, BASE_PIXEL_RATIO);
      this.interactivePixelRatio = Math.min(devicePixelRatio, INTERACTIVE_PIXEL_RATIO);
      this.emergencyPixelRatio = Math.min(devicePixelRatio, EMERGENCY_PIXEL_RATIO);
      this.pixelRatio = this.basePixelRatio;
      this.resizeCanvas(
        measuredWidth || windowInfo.windowWidth,
        measuredHeight || windowInfo.windowHeight,
      );

      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: true,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
      if (!gl
        || typeof gl.createVertexArray !== 'function'
        || typeof gl.drawArraysInstanced !== 'function'
        || typeof gl.drawElementsInstanced !== 'function'
        || gl.R32UI === undefined) {
        throw new Error('当前环境未提供完整 WebGL2，请使用支持 WebGL2 的真机预览');
      }

      this.gl = gl;
      this.gpuTimerExtension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      this.frameCallback = () => this.renderFrame();
      this.lastFrameTime = Date.now();
      this.frameCount = 0;
      this.fpsWindowStarted = this.lastFrameTime;
      this.clearCanvas();
      console.info(
        '[Native v2] WebGL',
        gl.getParameter(gl.VERSION),
        `viewport=${this.renderWidth}x${this.renderHeight}`,
      );

      this.setData({
        errorDetail: '',
        phase: 'loading',
        progress: 4,
        statusText: 'WebGL2 已就绪',
      });
      this.startRenderLoop();
      this.loadScene(this.data.activeSceneId);
    } catch (error) {
      this.fail(`WebGL2 初始化失败：${errorMessage(error)}`);
    }
  },

  resizeCanvas(width, height) {
    const cssWidth = Math.max(1, Math.round(Number(width) || 1));
    const cssHeight = Math.max(1, Math.round(Number(height) || 1));
    const ratio = this.pixelRatio || 1;
    const renderWidth = Math.max(1, Math.round(cssWidth * ratio));
    const renderHeight = Math.max(1, Math.round(cssHeight * ratio));
    const changed = this.renderWidth !== renderWidth
      || this.renderHeight !== renderHeight
      || (this.canvas && (this.canvas.width !== renderWidth || this.canvas.height !== renderHeight));

    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.renderWidth = renderWidth;
    this.renderHeight = renderHeight;
    if (this.canvas && changed) {
      this.canvas.width = renderWidth;
      this.canvas.height = renderHeight;
    }
    if (this.splatRenderer) {
      this.splatRenderer.setSize(renderWidth, renderHeight);
    }
    if (this.nearLodController) {
      this.nearLodController.setSize(renderWidth, renderHeight);
    }
    if (this.detailedAvatarRenderer) {
      this.detailedAvatarRenderer.setSize(renderWidth, renderHeight, cssWidth, cssHeight);
    }
    return changed;
  },

  setRenderPixelRatio(ratio, now, force) {
    const nextRatio = Number(ratio) || this.basePixelRatio || 1;
    if (!force && Math.abs((this.pixelRatio || 0) - nextRatio) < 0.01) return false;
    this.pixelRatio = nextRatio;
    this.lastRenderScaleChangeAt = now || Date.now();
    return this.resizeCanvas(this.cssWidth, this.cssHeight);
  },

  resetSceneRenderQuality(now = Date.now()) {
    this.disposeGpuTimers();
    this.lastGpuMs = 0;
    this.lastGpuSampleAt = 0;
    this.lastGpuQueryAt = 0;
    this.lastGpuPollAt = 0;
    this.frameMsEma = 16.7;
    this.renderScaleRecoveryStartedAt = 0;
    this.renderScaleRecoveryTarget = 0;
    this.lastFrameTime = now;
    this.frameCount = 0;
    this.fpsWindowStarted = now;
    this.setRenderPixelRatio(this.basePixelRatio, now, true);
  },

  updateAdaptiveRenderScale(now, frameMs) {
    if (!this.basePixelRatio || this.data.phase !== 'ready') return;

    const gpuSampleFresh = this.lastGpuMs > 0
      && now - this.lastGpuSampleAt < 1500;
    const measuredFrameMs = gpuSampleFresh ? this.lastGpuMs : frameMs;
    const boundedFrameMs = clamp(Number(measuredFrameMs) || 16.7, 1, 120);
    this.frameMsEma = this.frameMsEma * 0.9 + boundedFrameMs * 0.1;

    const currentRatio = this.pixelRatio || this.basePixelRatio;
    const currentlyEmergency = currentRatio <= this.emergencyPixelRatio + 0.01;
    const currentlyInteractive = currentRatio <= this.interactivePixelRatio + 0.01;
    let targetRatio = this.basePixelRatio;

    if (this.frameMsEma > VERY_POOR_FRAME_TIME_MS
      || (currentlyEmergency && this.frameMsEma > VERY_POOR_FRAME_RECOVERY_MS)) {
      targetRatio = this.emergencyPixelRatio;
    } else if (this.frameMsEma > POOR_FRAME_TIME_MS
      || (currentlyInteractive && this.frameMsEma > POOR_FRAME_RECOVERY_MS)) {
      targetRatio = this.interactivePixelRatio;
    }

    if (Math.abs(currentRatio - targetRatio) < 0.01) {
      this.renderScaleRecoveryStartedAt = 0;
      this.renderScaleRecoveryTarget = 0;
      return;
    }
    if (targetRatio > currentRatio) {
      const sortBusy = !!(this.sortController && this.sortController.getStats().busy);
      const rootUploadBusy = !!(this.splatRenderer && this.splatRenderer.pendingIndexUpload);
      const lodWorkBusy = !!(this.nearLodController
        && this.nearLodController.hasPendingIndexWork());
      if (Math.abs(this.renderScaleRecoveryTarget - targetRatio) >= 0.01) {
        this.renderScaleRecoveryTarget = targetRatio;
        this.renderScaleRecoveryStartedAt = now;
        return;
      }
      const recoveryElapsed = now - this.renderScaleRecoveryStartedAt;
      if (recoveryElapsed < RENDER_SCALE_RECOVERY_HOLD_MS) return;
      if ((sortBusy || rootUploadBusy || lodWorkBusy)
        && recoveryElapsed < RENDER_SCALE_BUSY_GRACE_MS) return;
      if (now - this.lastRenderScaleChangeAt < RENDER_SCALE_UP_MIN_HOLD_MS) return;
    } else {
      this.renderScaleRecoveryStartedAt = 0;
      this.renderScaleRecoveryTarget = 0;
      if (now - this.lastRenderScaleChangeAt < RENDER_SCALE_MIN_HOLD_MS) return;
    }
    this.setRenderPixelRatio(targetRatio, now, false);
    this.renderScaleRecoveryStartedAt = 0;
    this.renderScaleRecoveryTarget = 0;
  },

  async loadScene(sceneId) {
    const sceneEntry = SCENES[sceneId];
    if (!sceneEntry || !this.gl || !this.canvas || this.disposed) return;
    if (this.sceneLoadInFlight) {
      if (sceneId !== this.loadingSceneId) this.queuedSceneId = sceneId;
      return;
    }
    const defaultMode = 'firstPerson';
    const previousSceneId = this.currentScene
      ? this.currentScene.id
      : this.data.activeSceneId;
    const previousSceneLabel = this.currentScene
      ? this.currentScene.label
      : this.data.activeSceneLabel;
    const previousSceneReady = !!(this.currentScene
      && this.splatRenderer
      && this.cameraController);

    this.sceneLoadInFlight = true;
    this.loadingSceneId = sceneId;
    this.queuedSceneId = null;
    this.resetTouchState(false);
    this.setData({
      activeSceneId: sceneEntry.id,
      activeSceneLabel: sceneEntry.label,
      errorDetail: '',
      helpOpen: false,
      joystickActive: false,
      joystickThumbX: 0,
      joystickThumbY: 0,
      jumpActive: false,
      loading: true,
      phase: 'loading',
      progress: 3,
      sceneMenuOpen: false,
      settingsOpen: false,
      statusText: `正在读取 ${sceneEntry.label} 清单`,
      trajectoryPlaying: false,
    });

    let generation = 0;
    let scene = null;
    let assets = null;
    let pendingRenderer = null;
    try {
      scene = await loadSceneManifest(sceneEntry);
      if (this.disposed) return;

      // Keep the old renderer alive until the new manifest is known-good. From
      // this point onward the load is serialized and owns a new generation.
      generation = this.loadGeneration + 1;
      this.loadGeneration = generation;
      this.disposeSceneResources();
      this.resetSceneRenderQuality();
      this.cameraRevision = 0;
      this.sortRequestRevision = -1;
      this.sortRequestInFlight = false;
      this.sortDirty = false;
      this.detailSortDirty = true;
      this.sortFailed = false;
      this.firstSortComplete = false;
      this.rootSortReady = false;
      this.residentReady = !scene.nearLod;
      this.residentProgress = null;
      this.lastSortedCamera = null;
      this.sortRequestedCamera = null;
      this.detailSortRequestedCamera = null;
      this.lastMotionAt = 0;
      this.lastMovingDetailInstallAt = 0;
      this.lastMovingRootSortAt = 0;
      this.lastMovingDetailSortAt = 0;
      this.wasCameraMoving = false;
      this.cameraPredictionSample = null;
      this.predictedForward = null;
      this.lastFrameCpuMs = 0;
      this.lastGpuMs = 0;
      this.lastGpuSampleAt = 0;
      this.lastGpuPollAt = 0;
      this.frameIntervalMsEma = 16.7;
      this.currentScene = scene;
      this.setData({
        activeMode: defaultMode,
        activeSceneId: scene.id,
        activeSceneLabel: scene.label,
        cpuTimeText: '--',
        fps: 0,
        gpuTimeText: '--',
        lodCacheText: '--',
        progress: 8,
        renderPathText: '--',
        sortDurationText: '--',
        sortRequests: 0,
        sortResults: 0,
        sortState: '等待首排',
        splatCountText: formatSplatCount(scene.sog.meta.count),
        statusText: `正在加载 ${scene.label}`,
        visibleRatioText: '--',
      });

      assets = await loadSogAssets(this.canvas, scene, (ratio) => {
        if (generation !== this.loadGeneration || this.disposed) return;
        const completed = clamp(Math.round(Number(ratio || 0) * 5), 0, 5);
        const progress = clamp(Math.round(8 + Number(ratio || 0) * 72), 8, 80);
        this.setDataIfChanged({
          progress,
          statusText: `加载场景资源 ${completed}/5`,
        });
      }, {
        downloadConcurrency: ROOT_NATIVE_PACK_DOWNLOAD_CONCURRENCY,
      });

      if (generation !== this.loadGeneration || this.disposed) {
        cleanupAssets(assets);
        assets = null;
        return;
      }

      this.setData({ progress: 86, statusText: '正在创建 GPU 资源' });
      pendingRenderer = new SplatRenderer(this.gl, this.renderWidth, this.renderHeight, {
        enableGpuPredecode: true,
        enableProjectedFastPath: false,
        indexStride: qualityProfile(this.data.qualityLevel).stride,
      });
      pendingRenderer.load(scene, assets);
      let fastPathReady = pendingRenderer.prepareFastPath(64);
      while (!fastPathReady && !pendingRenderer.fastDisabled) {
        const diagnostics = pendingRenderer.getDiagnostics();
        const completedRows = Number(String(diagnostics.fastPredecodeRows || '').split('/')[0]) || 0;
        const totalRows = Number(String(diagnostics.fastPredecodeRows || '').split('/')[1]) || 1;
        this.setDataIfChanged({
          progress: clamp(Math.round(86 + (completedRows / totalRows) * 3), 86, 89),
          statusText: '正在预解码高清高斯数据',
        });
        await new Promise((resolve) => this.canvas.requestAnimationFrame(resolve));
        if (generation !== this.loadGeneration || this.disposed) {
          pendingRenderer.dispose();
          pendingRenderer = null;
          cleanupAssets(assets);
          assets = null;
          return;
        }
        fastPathReady = pendingRenderer.prepareFastPath(64);
      }

      const cameraController = createCameraController(scene);
      cameraController.setMode(defaultMode);
      cameraController.update(0);
      const collisionController = new CollisionController(scene, {
        onError: (error) => {
          if (generation === this.loadGeneration && !this.disposed) {
            console.warn('[Native v2] collision mesh unavailable', error);
          }
        },
      });
      cameraController.setGroundSampler((position, referenceY) => (
        this.data.collisionEnabled
          ? collisionController.sampleGround(position, referenceY)
          : null
      ));
      if (this.data.collisionEnabled) {
        collisionController.update(cameraController.getGroundPosition(), true);
      }

      this.splatRenderer = pendingRenderer;
      pendingRenderer = null;
      this.cameraController = cameraController;
      this.setDataIfChanged({ activeMode: cameraController.getMode() });
      this.collisionController = collisionController;
      this.trajectoryPlayer = new TrajectoryPlayer(scene.trajectory);
      if (this.detailedAvatarRenderer) {
        this.splatRenderer.setFallbackAvatarEnabled(false);
      } else if (this.data.activeMode === 'avatar') {
        this.ensureDetailedAvatarRenderer();
      }
      this.sortController = createSortController(scene, assets.sortData || assets.means, {
        onReady: () => this.handleSortReady(generation),
        onSorted: (indexes, stats, request) => this.handleSorted(
          generation,
          indexes,
          stats,
          request,
        ),
        onError: (error) => this.handleSortError(generation, error),
      });
      if (scene.nearLod) {
        const activeQuality = qualityProfile(this.data.qualityLevel);
        this.nearLodController = new NearLodController({
          canvas: this.canvas,
          gl: this.gl,
          width: this.renderWidth,
          height: this.renderHeight,
          scene,
          baseRenderer: this.splatRenderer,
          sortController: this.sortController,
          samplingStride: activeQuality.stride,
          detailSamplingStride: activeQuality.detailStride,
          detailPointBudget: activeQuality.detailPointBudget,
          fineReserveRatio: activeQuality.fineReserveRatio,
          onActiveCount: (count, refinedNodes) => {
            if (generation !== this.loadGeneration || this.disposed) return;
            if (!this.data.diagnosticsVisible) return;
            this.setDataIfChanged({
              splatCountText: `${formatSplatCount(count)} / LOD ${refinedNodes}`,
            });
          },
          onStatus: (statusText) => {
            if (generation !== this.loadGeneration || this.disposed) return;
            if (this.data.phase === 'loading' && !this.residentReady) return;
            this.setDataIfChanged({ statusText });
          },
          onSortStale: () => {
            if (generation !== this.loadGeneration || this.disposed) return;
            this.detailSortDirty = true;
          },
          onResidentProgress: (progressState) => {
            if (generation !== this.loadGeneration || this.disposed) return;
            this.residentProgress = progressState;
            if (progressState.complete) this.residentReady = true;
            if (this.data.phase === 'loading') {
              const loadedDone = progressState.loaded + progressState.failed;
              const sortedDone = progressState.sorted + progressState.sortFailed;
              const loadRatio = progressState.total ? loadedDone / progressState.total : 1;
              const sortRatio = progressState.sortTotal ? sortedDone / progressState.sortTotal : 1;
              const ratio = loadRatio * 0.55 + sortRatio * 0.45;
              let progress = clamp(90 + Math.floor(ratio * 9), 90, 99);
              let statusText = `首屏高清加载 ${loadedDone}/${progressState.total}`;
              if (progressState.loaded + progressState.failed >= progressState.total
                && progressState.sorted < progressState.sortTotal) {
                statusText = `首屏高清索引 ${sortedDone}/${progressState.sortTotal}`;
              }
              if (progressState.dataReady && !progressState.complete) {
                progress = 99;
                statusText = '正在合成首屏高清画面';
              }
              this.setDataIfChanged({ progress, statusText });
            }
            this.finishInitialLoad();
          },
          onError: (error) => {
            if (generation !== this.loadGeneration || this.disposed) return;
            console.warn('[Native v2] near LOD refinement failed', error);
          },
        });
      }

      cleanupAssets(assets);
      assets = null;
      this.setData({ progress: 90, statusText: '正在准备首屏高清数据' });

      // The first request is submitted immediately; the controller holds it
      // until its worker has decoded the packed means.
      this.requestCameraSort('initial');
    } catch (error) {
      if (assets) cleanupAssets(assets);
      if (pendingRenderer) pendingRenderer.dispose();
      if (this.disposed) return;
      if (!generation) {
        if (previousSceneReady) {
          this.setData({
            activeSceneId: previousSceneId,
            activeSceneLabel: previousSceneLabel,
            errorDetail: `场景切换失败：${errorMessage(error)}`,
            loading: false,
            phase: 'ready',
            progress: 100,
            statusText: `${previousSceneLabel} 已就绪`,
          });
        } else {
          this.fail(`场景加载失败：${errorMessage(error)}`);
        }
      } else if (generation === this.loadGeneration) {
        this.loadGeneration += 1;
        this.disposeSceneResources();
        this.fail(`场景加载失败：${errorMessage(error)}`);
      }
    } finally {
      if (this.loadingSceneId === sceneId) {
        this.sceneLoadInFlight = false;
        this.loadingSceneId = null;
      }
      const queuedSceneId = this.queuedSceneId;
      this.queuedSceneId = null;
      if (!this.disposed
        && queuedSceneId
        && queuedSceneId !== this.data.activeSceneId) {
        setTimeout(() => this.loadScene(queuedSceneId), 0);
      }
    }
  },

  switchScene(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    const sceneId = dataset && (dataset.sceneId || dataset.sceneid);
    this.closeSceneMenu();
    if (!SCENES[sceneId] || !this.gl) return;
    if (this.sceneLoadInFlight) {
      if (sceneId !== this.loadingSceneId) this.queuedSceneId = sceneId;
      return;
    }
    if (sceneId === this.data.activeSceneId) return;
    this.loadScene(sceneId);
  },

  retryLoad() {
    this.renderFailed = false;
    if (!this.gl) {
      this.setData({ loading: true, phase: 'booting', progress: 0, errorDetail: '' });
      this.queryCanvas(0);
      return;
    }
    this.startRenderLoop();
    this.loadScene(this.data.activeSceneId);
  },

  disposeSceneResources() {
    if (this.trajectoryPlayer) this.trajectoryPlayer.pause();
    if (this.cameraController) this.cameraController.setMovement(0, 0, false);
    if (this.collisionController) {
      try {
        this.collisionController.dispose();
      } catch (error) {
        console.warn('[Native v2] collision dispose failed', error);
      }
    }
    if (this.nearLodController) {
      try {
        this.nearLodController.dispose();
      } catch (error) {
        console.warn('[Native v2] near LOD dispose failed', error);
      }
    }
    if (this.sortController) {
      try {
        this.sortController.dispose();
      } catch (error) {
        console.warn('[Native v2] sort worker dispose failed', error);
      }
    }
    if (this.splatRenderer) {
      try {
        this.splatRenderer.dispose();
      } catch (error) {
        console.warn('[Native v2] renderer dispose failed', error);
      }
    }
    this.sortController = null;
    this.collisionController = null;
    this.nearLodController = null;
    this.splatRenderer = null;
    this.cameraController = null;
    this.trajectoryPlayer = null;
    this.currentScene = null;
    this.sortRequestInFlight = false;
    this.sortRequestedCamera = null;
  },

  ensureDetailedAvatarRenderer() {
    if (this.detailedAvatarRenderer) return this.detailedAvatarRenderer;
    if (this.detailedAvatarInitAttempted || !this.canvas || !this.gl) return null;
    this.detailedAvatarInitAttempted = true;
    try {
      const { DetailedAvatarRenderer } = require('../avatar/detailed-avatar-renderer');
      this.detailedAvatarRenderer = new DetailedAvatarRenderer({
        canvas: this.canvas,
        gl: this.gl,
        width: this.renderWidth,
        height: this.renderHeight,
        cssWidth: this.cssWidth,
        cssHeight: this.cssHeight,
        onReady: () => {
          if (this.disposed) return;
          this.avatarLoadError = '';
          if (this.data.activeMode === 'avatar' && this.data.phase === 'ready') {
            this.setDataIfChanged({ statusText: '精细人物已就绪' });
          }
        },
        onError: (error) => {
          if (this.disposed) return;
          this.avatarLoadError = `精细人物加载失败：${errorMessage(error)}`;
          if (this.data.activeMode === 'avatar' && this.data.phase === 'ready') {
            this.setDataIfChanged({
              errorDetail: this.avatarLoadError,
              statusText: '精细人物加载失败',
            });
          }
        },
      });
      if (this.splatRenderer) this.splatRenderer.setFallbackAvatarEnabled(false);
      return this.detailedAvatarRenderer;
    } catch (error) {
      console.error('[Native v2] detailed avatar initialization failed', error);
      this.avatarLoadError = `精细人物初始化失败：${errorMessage(error)}`;
      if (this.splatRenderer) this.splatRenderer.setFallbackAvatarEnabled(true);
      if (!this.disposed && this.data.activeMode === 'avatar') {
        this.setDataIfChanged({
          errorDetail: this.avatarLoadError,
          statusText: '精细人物不可用',
        });
      }
      return null;
    }
  },

  disposeDetailedAvatarRenderer() {
    if (!this.detailedAvatarRenderer) return;
    try {
      this.detailedAvatarRenderer.dispose();
    } catch (error) {
      console.warn('[Native v2] detailed avatar dispose failed', error);
    }
    this.detailedAvatarRenderer = null;
  },

  handleSortReady(generation) {
    if (generation !== this.loadGeneration || this.disposed) return;
    if (this.residentReady) this.setDataIfChanged({ statusText: '正在生成首帧排序' });
    this.updateDiagnostics(Date.now(), true);
  },

  requestCameraSort(reason, options = {}) {
    if (!this.sortController || !this.cameraController || this.disposed) return false;
    const sourceCamera = this.cameraController.getCamera();
    const camera = {
      ...sourceCamera,
      lodPosition: this.cameraController.getGroundPosition(),
      predictedForward: (this.predictedForward || sourceCamera.forward).slice(),
      aspect: Math.max(1, this.renderWidth) / Math.max(1, this.renderHeight),
      fovY: SORT_FOV_Y,
      far: SORT_FAR,
      sampleStride: qualityProfile(this.data.qualityLevel).stride,
      // Match the H5 SDK default: radial ordering is stable while looking
      // around and avoids replacing a clear view with mixed sort directions.
      enableDepthSorting: ENABLE_DIRECTIONAL_DEPTH_SORTING,
      // Keep the sampled source set complete so turning back never exposes a
      // culled hole. Direction-aware depth sorting refreshes its order.
      cullToFrustum: false,
      reason,
    };
    const includeRoot = options.includeRoot !== false;
    const includeDetails = options.includeDetails !== false;
    const rootNeedsSort = includeRoot && (
      options.force === true
        || !this.firstSortComplete
        || cameraNeedsSort(camera, this.sortRequestedCamera || this.lastSortedCamera)
    );
    const detailNeedsSort = includeDetails
      && this.nearLodController
      && (
        options.force === true
          || reason === 'initial'
          || this.detailSortDirty
          || cameraNeedsSort(
            camera,
            this.detailSortRequestedCamera || this.lastSortedCamera,
          )
      );
    if (!rootNeedsSort && !detailNeedsSort) {
      if (includeRoot) this.sortDirty = false;
      if (includeDetails) this.detailSortDirty = false;
      return false;
    }

    this.sortFailed = false;
    let requested = false;
    if (rootNeedsSort) {
      this.sortRequestInFlight = true;
      this.sortRequestRevision = this.cameraRevision;
      this.sortDirty = false;
      this.sortRequestedCamera = cameraSnapshot(camera);
      if (this.sortController.request(camera)) requested = true;
    }
    if (detailNeedsSort) {
      const detailRequests = this.nearLodController.requestSort(camera, {
        activeOnly: reason !== 'initial',
        maxDatasets: options.maxDetailDatasets,
      });
      if (detailRequests > 0) {
        this.detailSortRequestedCamera = cameraSnapshot(camera);
        this.detailSortDirty = false;
        requested = true;
      }
    }
    if (reason !== 'moving') this.updateDiagnostics(Date.now(), true);
    return requested;
  },

  finishInitialLoad() {
    if (this.disposed
      || this.data.phase !== 'loading'
      || !this.rootSortReady
      || !this.residentReady) return;
    const failed = this.residentProgress
      ? this.residentProgress.issues
      : 0;
    let statusText = `${this.currentScene.label} 高清区域已就绪`;
    if (failed) statusText = `${this.currentScene.label} 已就绪，${failed} 个高清块使用基础层兜底`;
    if (this.sortFailed) statusText = '高清数据已加载，排序不可用';
    this.setData({
      loading: false,
      phase: 'ready',
      progress: 100,
      statusText,
    });
  },

  handleSorted(generation, indexes, stats, completedRequest) {
    if (generation !== this.loadGeneration || this.disposed) return;
    this.sortRequestInFlight = !!(this.sortController && this.sortController.getStats().busy);
    const now = Date.now();
    const currentCamera = this.cameraController
      ? {
        ...this.cameraController.getCamera(),
        enableDepthSorting: ENABLE_DIRECTIONAL_DEPTH_SORTING,
      }
      : null;
    const completedCamera = completedRequest && completedRequest.camera
      ? completedRequest.camera
      : this.sortRequestedCamera;
    const completedReason = completedCamera && completedCamera.reason
      ? completedCamera.reason
      : 'settled';
    const expectedStride = qualityProfile(this.data.qualityLevel).stride;
    if (!completedCamera
      || !sampleStrideMatches(completedCamera.sampleStride, expectedStride)) {
      this.sortDirty = true;
      this.detailSortDirty = true;
      this.updateDiagnostics(now, true, stats);
      return;
    }
    const stale = !currentCamera || !completedCamera
      || cameraNeedsSort(currentCamera, completedCamera);
    const outsideCoverage = !cameraWithinSortCoverage(currentCamera, completedCamera);

    if (completedReason !== 'initial' && outsideCoverage) {
      this.sortDirty = true;
      this.detailSortDirty = true;
      if (this.isCameraMoving()) this.lastMotionAt = now;
      this.updateDiagnostics(now, completedReason !== 'moving', stats);
      return;
    }

    try {
      if (this.nearLodController) {
        this.nearLodController.setBaseIndexes(indexes, {
          resident: completedReason === 'initial',
          sampleStride: completedCamera.sampleStride,
        });
        this.nearLodController.update(this.cameraController.getCamera());
      } else {
        this.splatRenderer.setIndexStride(completedCamera.sampleStride);
        this.splatRenderer.updateIndexes(indexes, { preSampled: true });
      }
    } catch (error) {
      this.handleRuntimeFailure(`排序纹理更新失败：${errorMessage(error)}`);
      return;
    }

    this.sortDirty = stale;
    this.sortFailed = false;
    this.lastSortedCamera = completedCamera;
    if (stale && this.isCameraMoving()) {
      this.lastMotionAt = now;
    }
    const firstResult = !this.firstSortComplete;
    this.firstSortComplete = true;
    const patch = {};
    if (firstResult) this.rootSortReady = true;
    if (this.data.errorDetail.indexOf('排序失败') === 0) patch.errorDetail = '';
    if (Object.keys(patch).length) this.setData(patch);
    this.finishInitialLoad();
    this.updateDiagnostics(now, completedReason !== 'moving', stats);
  },

  handleSortError(generation, error) {
    if (generation !== this.loadGeneration || this.disposed) return;
    this.sortRequestInFlight = false;
    this.sortRequestedCamera = null;
    this.sortDirty = false;
    this.sortFailed = true;
    const detail = `排序失败：${errorMessage(error)}`;
    console.error('[Native v2]', detail);
    if (this.nearLodController) this.nearLodController.markSortingUnavailable();

    const patch = { errorDetail: detail };
    if (!this.firstSortComplete) {
      this.firstSortComplete = true;
      this.rootSortReady = true;
    }
    this.setData(patch);
    this.finishInitialLoad();
    this.updateDiagnostics(Date.now(), true);
  },

  markCameraChanged(now) {
    this.cameraRevision += 1;
    this.lastMotionAt = now || Date.now();
  },

  isCameraMoving() {
    return !!((this.trajectoryPlayer && this.trajectoryPlayer.playing)
      || this.lookGestureActive
      || (this.cameraController && this.cameraController.isMoving()));
  },

  updateSortSchedule(now) {
    if (!this.sortController || !this.cameraController) return;
    const moving = this.isCameraMoving();
    const camera = {
      ...this.cameraController.getCamera(),
      enableDepthSorting: ENABLE_DIRECTIONAL_DEPTH_SORTING,
    };
    if (moving) {
      if (!this.wasCameraMoving) {
        this.cameraRevision += 1;
      }
      if (cameraNeedsSort(camera, this.sortRequestedCamera || this.lastSortedCamera)) {
        this.sortDirty = true;
      }
      if (cameraNeedsSort(
        camera,
        this.detailSortRequestedCamera || this.lastSortedCamera,
      )) {
        this.detailSortDirty = true;
      }
      this.lastMotionAt = now;
    } else if (this.wasCameraMoving) {
      this.lastMotionAt = now;
    }
    this.wasCameraMoving = moving;

    const detailCanSort = this.detailSortDirty && this.residentReady;
    const sortStats = this.sortController.getStats();
    const pendingIndexWork = !!(this.nearLodController
      && this.nearLodController.hasPendingIndexWork());
    const movingSortHasHeadroom = this.frameIntervalMsEma <= SORT_MOVING_FRAME_BUDGET_MS
      && !sortStats.busy
      && !sortStats.queued
      && !(this.splatRenderer && this.splatRenderer.pendingIndexUpload)
      && !pendingIndexWork;
    const movingSortInterval = clamp(
      (Number(sortStats.lastWorkerDuration) || 0) * 2,
      SORT_MOVING_INTERVAL_MS,
      SORT_MOVING_INTERVAL_MAX_MS,
    );
    const movingDetailSortDue = detailCanSort
      && movingSortHasHeadroom
      && now - this.lastMovingDetailSortAt >= DETAIL_SORT_MOVING_INTERVAL_MS;
    const movingRootSortDue = this.sortDirty
      && movingSortHasHeadroom
      && now - this.lastMovingRootSortAt >= movingSortInterval;
    if (moving
      && this.residentReady
      && (movingRootSortDue || movingDetailSortDue)) {
      let includeRoot = movingRootSortDue;
      let includeDetails = movingDetailSortDue;
      if (includeRoot && includeDetails) {
        const rootUrgency = (now - this.lastMovingRootSortAt) / movingSortInterval;
        const detailUrgency = (now - this.lastMovingDetailSortAt)
          / DETAIL_SORT_MOVING_INTERVAL_MS;
        includeRoot = rootUrgency >= detailUrgency;
        includeDetails = !includeRoot;
      }
      const requested = this.requestCameraSort('moving', {
        includeRoot,
        includeDetails,
        maxDetailDatasets: 1,
      });
      if (requested && includeRoot) this.lastMovingRootSortAt = now;
      if (requested && includeDetails) this.lastMovingDetailSortAt = now;
    } else if (!moving
      && (this.sortDirty || detailCanSort)
      && now - this.lastMotionAt >= SORT_IDLE_MS) {
      this.requestCameraSort('settled', {
        includeRoot: this.sortDirty,
        includeDetails: detailCanSort,
      });
    }
  },

  updateSamplingPolicy() {
    if (!this.nearLodController) return;
    const profile = qualityProfile(this.data.qualityLevel);
    this.nearLodController.setSamplingStride(
      profile.stride,
      profile.detailStride,
      profile.fineReserveRatio,
      profile.detailPointBudget,
    );
  },

  beginGpuTimer(now = Date.now()) {
    const gl = this.gl;
    const extension = this.gpuTimerExtension;
    if (!this.data.diagnosticsVisible
      || !gl
      || !extension
      || this.activeGpuQuery
      || this.pendingGpuQueries.length >= 2
      || now - this.lastGpuQueryAt < GPU_TIMER_SAMPLE_INTERVAL_MS) return false;
    try {
      const query = gl.createQuery();
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      this.activeGpuQuery = query;
      this.lastGpuQueryAt = now;
      return true;
    } catch (error) {
      this.gpuTimerExtension = null;
      return false;
    }
  },

  endGpuTimer() {
    if (!this.gl || !this.gpuTimerExtension || !this.activeGpuQuery) return;
    try {
      this.gl.endQuery(this.gpuTimerExtension.TIME_ELAPSED_EXT);
      this.pendingGpuQueries.push(this.activeGpuQuery);
      this.activeGpuQuery = null;
    } catch (error) {
      this.gpuTimerExtension = null;
      this.activeGpuQuery = null;
    }
  },

  pollGpuTimers(now = Date.now(), force = false) {
    const gl = this.gl;
    const extension = this.gpuTimerExtension;
    if (!this.data.diagnosticsVisible
      || !gl
      || !extension
      || !this.pendingGpuQueries.length) return;
    if (!force && now - this.lastGpuPollAt < 100) return;
    this.lastGpuPollAt = now;
    try {
      while (this.pendingGpuQueries.length) {
        const query = this.pendingGpuQueries[0];
        const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
        if (!available) break;
        this.pendingGpuQueries.shift();
        const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
        if (!disjoint) {
          this.lastGpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1000000;
          this.lastGpuSampleAt = now;
        }
        gl.deleteQuery(query);
      }
    } catch (error) {
      this.gpuTimerExtension = null;
    }
  },

  disposeGpuTimers() {
    if (!this.gl) return;
    if (this.activeGpuQuery) {
      try { this.gl.deleteQuery(this.activeGpuQuery); } catch (error) { /* context is closing */ }
    }
    (this.pendingGpuQueries || []).forEach((query) => {
      try { this.gl.deleteQuery(query); } catch (error) { /* context is closing */ }
    });
    this.activeGpuQuery = null;
    this.pendingGpuQueries = [];
  },

  updateDiagnostics(now, force, providedStats) {
    if (!this.data.diagnosticsVisible) {
      if (now - this.fpsWindowStarted >= DIAGNOSTIC_INTERVAL_MS) {
        this.frameCount = 0;
        this.fpsWindowStarted = now;
      }
      return;
    }
    if (!force && now - this.lastDiagnosticAt < DIAGNOSTIC_INTERVAL_MS) return;
    this.lastDiagnosticAt = now;
    this.pollGpuTimers(now, true);

    let fps = this.data.fps;
    const elapsed = now - this.fpsWindowStarted;
    if (elapsed >= DIAGNOSTIC_INTERVAL_MS) {
      fps = Math.round(this.frameCount * 1000 / Math.max(elapsed, 1));
      this.frameCount = 0;
      this.fpsWindowStarted = now;
    }

    const stats = providedStats
      || (this.sortController ? this.sortController.getStats() : null)
      || { requests: 0, results: 0, lastDuration: 0, busy: false };
    const rendererState = this.splatRenderer
      ? this.splatRenderer.getDiagnostics()
      : { path: '--' };
    const lodState = this.nearLodController
      ? this.nearLodController.getDiagnostics()
      : null;
    const visibleRatio = stats.lastTotalCount
      ? Math.round((stats.lastVisibleCount || 0) * 100 / stats.lastTotalCount)
      : 100;
    let sortState = '等待首排';
    if (this.sortFailed) sortState = '排序错误';
    else if (stats.busy) {
      sortState = this.firstSortComplete ? '排序中' : '首帧排序';
    } else if (this.isCameraMoving()) sortState = '沿用旧序';
    else if (this.sortDirty) sortState = '静止确认';
    else if (this.firstSortComplete) sortState = '已同步';

    this.setDataIfChanged({
      fps,
      cpuTimeText: this.lastFrameCpuMs ? `${this.lastFrameCpuMs.toFixed(1)}ms` : '--',
      gpuTimeText: this.lastGpuMs
        ? `${this.lastGpuMs.toFixed(1)}ms`
        : (this.gpuTimerExtension ? '--' : 'ON'),
      renderPathText: `${rendererState.path || '--'} · R${(this.pixelRatio || 1).toFixed(2)}`,
      sampleStrideText: lodState
        ? `1/${lodState.sampleStride} · N1/${lodState.detailSampleStride}`
        : '1/1 · N1/1',
      visibleRatioText: `${visibleRatio}%`,
      lodCacheText: lodState
        ? `${lodState.activeFiles}/${lodState.cachedFiles}`
          + ` F${lodState.fastFiles}`
          + ` I${lodState.pendingIndexFilters}`
        : '0/0',
      sortDurationText: stats.lastDuration ? `${Math.round(stats.lastDuration)}ms` : '--',
      sortRequests: stats.requests || 0,
      sortResults: stats.results || 0,
      sortState,
    });
  },

  startRenderLoop() {
    if (this.disposed
      || this.suspended
      || this.renderFailed
      || !this.canvas
      || !this.frameCallback
      || this.frameId !== null) return;
    this.frameId = this.canvas.requestAnimationFrame(this.frameCallback);
  },

  stopRenderLoop() {
    if (this.canvas && this.frameId !== null && this.canvas.cancelAnimationFrame) {
      this.canvas.cancelAnimationFrame(this.frameId);
    }
    this.frameId = null;
  },

  renderFrame() {
    this.frameId = null;
    if (this.disposed || this.suspended || this.renderFailed || !this.canvas || !this.gl) return;

    const now = Date.now();
    const frameCpuStarted = now;
    let gpuTimerStarted = false;
    this.pollGpuTimers(now);
    const rawFrameMs = clamp(now - this.lastFrameTime, 1, 120);
    this.frameIntervalMsEma = this.frameIntervalMsEma * 0.9 + rawFrameMs * 0.1;
    const dt = Math.min(Math.max(rawFrameMs / 1000, 0.001), 0.05);
    this.lastFrameTime = now;
    try {
      if (this.cameraController) {
        const playbackUpdated = !!(this.trajectoryPlayer
          && this.trajectoryPlayer.playing
          && this.trajectoryPlayer.update(dt, this.cameraController));
        if (!playbackUpdated && this.collisionController && this.data.collisionEnabled) {
          this.collisionController.update(this.cameraController.getGroundPosition());
        }
        if (!playbackUpdated) this.cameraController.update(dt);
        if (playbackUpdated && this.collisionController && this.data.collisionEnabled) {
          this.collisionController.update(this.cameraController.getGroundPosition());
        }
        const camera = this.cameraController.getCamera();
        this.predictedForward = predictForward(camera, this.cameraPredictionSample, now);
        this.cameraPredictionSample = { forward: camera.forward.slice(), at: now };
        if (this.nearLodController) {
          this.nearLodController.setInteractionActive(this.isCameraMoving());
          this.nearLodController.update({
            ...camera,
            lodPosition: this.cameraController.getGroundPosition(),
          });
        }
        if (this.sortController && this.sortController.flushResultTransfer) {
          const moving = this.isCameraMoving();
          const resultChunkSize = rawFrameMs > SORT_MOVING_FRAME_BUDGET_MS
            ? CONGESTED_SORT_RESULT_CHUNK_INDICES
            : (moving
              ? MOVING_SORT_RESULT_CHUNK_INDICES
              : IDLE_SORT_RESULT_CHUNK_INDICES);
          this.sortController.flushResultTransfer(resultChunkSize);
        }
        this.updateSortSchedule(now);
        this.updateAdaptiveRenderScale(now, rawFrameMs);
      }
      if (this.splatRenderer && this.cameraController) {
        const moving = this.isCameraMoving();
        const backgroundGpuHeadroom = rawFrameMs <= BACKGROUND_GPU_HEADROOM_MS
          && this.frameCount % BACKGROUND_GPU_MOVING_INTERVAL === 0;
        const backgroundGpuIdle = !moving
          && now - this.lastMotionAt >= BACKGROUND_GPU_IDLE_MS;
        const allowFastPathUpgrade = this.data.phase === 'loading'
          || (!moving && now - this.lastMotionAt >= FAST_PATH_IDLE_MS);
        const allowBackgroundGpuWork = this.data.phase === 'loading'
          || backgroundGpuIdle
          || backgroundGpuHeadroom;
        const movingContinuityInstallDue = moving
          && this.nearLodController
          && this.nearLodController.hasContinuityInstallWork()
          && now - this.lastMovingDetailInstallAt >= MOVING_DETAIL_INSTALL_INTERVAL_MS;
        const allowDetailInstall = allowBackgroundGpuWork || movingContinuityInstallDue;
        const detailInstallSteps = this.nearLodController && allowDetailInstall
          ? this.nearLodController.flushResourceInstalls(1, {
            allowFastPath: allowFastPathUpgrade && !movingContinuityInstallDue,
          })
          : 0;
        if (detailInstallSteps && movingContinuityInstallDue) {
          this.lastMovingDetailInstallAt = now;
        }
        const residentPreloading = this.nearLodController
          && this.data.phase === 'loading'
          && !this.nearLodController.residentReady;
        if (residentPreloading) {
          this.clearCanvas();
        } else {
          if (!detailInstallSteps && moving) {
            this.splatRenderer.flushIndexUpload(MOVING_ROOT_INDEX_UPLOAD_ROWS);
            if (this.nearLodController) {
              this.nearLodController.flushIndexUploads(MOVING_DETAIL_INDEX_UPLOAD_ROWS);
            }
          } else if (!detailInstallSteps && allowBackgroundGpuWork) {
            this.splatRenderer.flushIndexUpload(24);
            if (this.nearLodController) this.nearLodController.flushIndexUploads(32);
          }
          gpuTimerStarted = this.beginGpuTimer(now);
          const aspect = this.renderWidth / Math.max(this.renderHeight, 1);
          const matrices = this.cameraController.getMatrices(aspect);
          this.splatRenderer.render(matrices, this.cameraController, {
            clear: true,
            clearColor: this.backgroundClearColor(),
            avatar: false,
          });
          if (this.nearLodController) {
            this.nearLodController.render(matrices, this.cameraController);
          }
          this.splatRenderer.renderAvatar(matrices, this.cameraController);
          this.renderDetailedAvatar(dt);
          if (gpuTimerStarted) this.endGpuTimer();
        }
      } else {
        this.clearCanvas();
      }
    } catch (error) {
      if (gpuTimerStarted) this.endGpuTimer();
      this.handleRuntimeFailure(`渲染失败：${errorMessage(error)}`);
      return;
    }

    this.lastFrameCpuMs = Date.now() - frameCpuStarted;
    this.frameCount += 1;
    this.updateDiagnostics(now, false);
    this.startRenderLoop();
  },

  renderDetailedAvatar(dt) {
    if (!this.detailedAvatarRenderer
      || !this.cameraController
      || this.cameraController.getMode() !== 'avatar') return;
    try {
      this.detailedAvatarRenderer.render(this.cameraController, dt);
    } catch (error) {
      console.error('[Native v2] detailed avatar render failed', error);
      this.avatarLoadError = `精细人物渲染失败：${errorMessage(error)}`;
      this.disposeDetailedAvatarRenderer();
      if (this.splatRenderer) this.splatRenderer.setFallbackAvatarEnabled(true);
      this.setDataIfChanged({
        errorDetail: this.avatarLoadError,
        statusText: '精细人物渲染失败',
      });
    }
  },

  clearCanvas() {
    if (!this.gl) return;
    const color = this.backgroundClearColor();
    this.gl.viewport(0, 0, this.renderWidth, this.renderHeight);
    this.gl.clearColor(color[0], color[1], color[2], color[3]);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  },

  backgroundClearColor() {
    return this.data.environment === 'sky'
      ? [0.34, 0.49, 0.64, 1]
      : [0.025, 0.031, 0.038, 1];
  },

  handleMemoryWarning(warning) {
    if (this.disposed) return;
    const now = Date.now();
    if (now - this.lastMemoryWarningAt > 30000) this.memoryWarningBurstCount = 0;
    this.lastMemoryWarningAt = now;
    this.memoryWarningBurstCount += 1;
    const level = Number(warning && warning.level) || 0;
    const hardTrim = level >= 15 || this.memoryWarningBurstCount >= 2;
    if (this.collisionController) this.collisionController.trimCache();
    if (this.nearLodController) {
      if (hardTrim) this.nearLodController.trimCache(true);
      else this.nearLodController.trimTransientCache();
    }
    this.setDataIfChanged({
      statusText: hardTrim
        ? '内存压力持续偏高，已保留当前高清区域'
        : '正在释放临时缓存，已访问场景继续保留',
    });
  },

  handleRuntimeFailure(message) {
    console.error('[Native v2]', message);
    this.renderFailed = true;
    this.loadGeneration += 1;
    this.disposeSceneResources();
    this.fail(message);
  },

  toggleSettings() {
    if (this.data.phase !== 'ready') return;
    const settingsOpen = !this.data.settingsOpen;
    const patch = { settingsOpen };
    if (settingsOpen) {
      patch.helpOpen = false;
      patch.sceneMenuOpen = false;
    }
    this.setData(patch);
  },

  closeSettings() {
    if (this.data.settingsOpen) this.setData({ settingsOpen: false });
  },

  toggleHelp() {
    if (this.data.phase !== 'ready') return;
    const helpOpen = !this.data.helpOpen;
    const patch = { helpOpen };
    if (helpOpen) {
      patch.sceneMenuOpen = false;
      patch.settingsOpen = false;
    }
    this.setData(patch);
  },

  closeHelp() {
    if (this.data.helpOpen) this.setData({ helpOpen: false });
  },

  toggleSceneMenu() {
    if (this.data.phase !== 'ready') return;
    const sceneMenuOpen = !this.data.sceneMenuOpen;
    const patch = { sceneMenuOpen };
    if (sceneMenuOpen) {
      patch.helpOpen = false;
      patch.settingsOpen = false;
    }
    this.setData(patch);
  },

  closeSceneMenu() {
    if (this.data.sceneMenuOpen) this.setData({ sceneMenuOpen: false });
  },

  swallowTap() {},

  setSprintEnabled(enabled) {
    if (!this.cameraController || this.data.phase !== 'ready') return;
    const sprintEnabled = !!enabled;
    if (sprintEnabled === this.data.sprintEnabled) return;
    this.cameraController.setMovement(
      this.movementX || 0,
      this.movementZ || 0,
      sprintEnabled,
    );
    this.setData({
      sprintEnabled,
      statusText: sprintEnabled ? '移动加速已开启' : '已切换为步行速度',
    });
  },

  toggleSprint() {
    this.setSprintEnabled(!this.data.sprintEnabled);
  },

  handleSprintChange(event) {
    this.setSprintEnabled(!!(event && event.detail && event.detail.value));
  },

  selectQuality(event) {
    const level = Number(event.currentTarget.dataset.quality);
    const profile = qualityProfile(level);
    if (profile.id === this.data.qualityLevel) return;
    this.setData({
      qualityLabel: profile.label,
      qualityLevel: profile.id,
      statusText: `高斯细粒度：${profile.label}`,
    }, () => {
      this.updateSamplingPolicy();
      this.requestCameraSort('quality', { force: true });
      this.updateDiagnostics(Date.now(), true);
    });
  },

  toggleCollision(event) {
    const collisionEnabled = !!(event && event.detail && event.detail.value);
    if (collisionEnabled === this.data.collisionEnabled) return;
    this.setData({
      collisionEnabled,
      statusText: collisionEnabled ? '碰撞与地面贴合已开启' : '碰撞已关闭',
    });
    if (collisionEnabled && this.collisionController && this.cameraController) {
      this.collisionController.update(this.cameraController.getGroundPosition(), true);
    }
  },

  selectEnvironment(event) {
    const environment = event.currentTarget.dataset.environment;
    if (!ENVIRONMENT_OPTIONS.some((option) => option.id === environment)
      || environment === this.data.environment) return;
    this.setData({
      environment,
      statusText: environment === 'sky' ? '天空背景已开启' : '深色背景已开启',
    });
  },

  stopTrajectory(updateData = true) {
    if (!this.trajectoryPlayer || !this.trajectoryPlayer.playing) return false;
    this.trajectoryPlayer.pause();
    if (updateData) this.setData({ trajectoryPlaying: false });
    return true;
  },

  toggleTrajectory() {
    if (!this.cameraController
      || !this.trajectoryPlayer
      || this.data.phase !== 'ready') return;
    if (this.trajectoryPlayer.playing) {
      this.trajectoryPlayer.pause();
      this.setData({
        trajectoryPlaying: false,
        statusText: '轨迹播放已暂停',
      });
      return;
    }
    if (!this.trajectoryPlayer.play()) {
      this.setDataIfChanged({ statusText: '当前场景没有可播放轨迹' });
      return;
    }
    this.resetTouchState(false);
    this.cameraController.setMovement(0, 0, false);
    this.cameraController.setMode('firstPerson');
    this.trajectoryPlayer.update(0, this.cameraController);
    this.markCameraChanged(Date.now());
    this.setData({
      activeMode: 'firstPerson',
      joystickActive: false,
      joystickThumbX: 0,
      joystickThumbY: 0,
      jumpActive: false,
      trajectoryPlaying: true,
      statusText: '正在沿轨迹播放',
    });
  },

  selectMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!this.cameraController
      || this.data.phase !== 'ready'
      || mode === this.data.activeMode
      || !MODE_OPTIONS.some((item) => item.id === mode)) return;

    this.stopTrajectory(false);
    this.cameraController.setMovement(0, 0, false);
    this.cameraController.setMode(mode);
    this.cameraController.update(0);
    this.resetTouchState(false);
    this.markCameraChanged(Date.now());
    this.setData({
      activeMode: mode,
      joystickActive: false,
      joystickThumbX: 0,
      joystickThumbY: 0,
      jumpActive: false,
      trajectoryPlaying: false,
    });
    if (mode === 'avatar') {
      this.ensureDetailedAvatarRenderer();
      this.setDataIfChanged({
        statusText: this.avatarLoadError || '正在加载精细人物',
      });
    }
    this.updateDiagnostics(Date.now(), true);
  },

  resetCamera() {
    if (!this.cameraController || !this.currentScene || this.data.phase !== 'ready') return;
    if (this.trajectoryPlayer) this.trajectoryPlayer.reset();
    this.cameraController.setMovement(0, 0, false);
    this.cameraController.reset(this.currentScene);
    this.cameraController.update(0);
    if (this.collisionController) {
      this.collisionController.update(this.cameraController.getGroundPosition(), true);
    }
    this.resetTouchState(false);
    this.markCameraChanged(Date.now());
    this.setData({
      joystickActive: false,
      joystickThumbX: 0,
      joystickThumbY: 0,
      jumpActive: false,
      statusText: `${this.currentScene.label} 已重置`,
      trajectoryPlaying: false,
    });
    this.updateDiagnostics(Date.now(), true);
  },

  recenterCamera() {
    if (!this.cameraController || !this.currentScene || this.data.phase !== 'ready') return;
    const mode = this.cameraController.getMode();
    this.lastLookTapAt = 0;
    if (typeof this.cameraController.recenterView !== 'function') return;
    this.resetLookTouchState();
    if (!this.cameraController.recenterView()) return;
    this.cameraController.update(0);
    this.markCameraChanged(Date.now());
    const modeLabel = mode === 'avatar'
      ? '第三人称'
      : mode === 'firstPerson'
        ? '第一人称'
        : '自由';
    this.setDataIfChanged({ statusText: `${modeLabel}视角已回正` });
    this.updateDiagnostics(Date.now(), true);
  },

  handleLookStart(event) {
    if (!this.cameraController
      || this.data.phase !== 'ready'
      || (this.trajectoryPlayer && this.trajectoryPlayer.playing)) return;
    const touches = touchesOf(event);
    const changed = changedTouchesOf(event);
    const lookStarts = changed.filter((touch) => touchId(touch) !== this.moveTouchId);
    if (touches.length === 1 && lookStarts.length === 1) {
      const point = touchPoint(lookStarts[0]);
      this.lookTapCandidateId = touchId(lookStarts[0]);
      this.lookTapStartedAt = Date.now();
      this.lookTapStartX = point.x;
      this.lookTapStartY = point.y;
    } else if (touches.length > 1) {
      this.lastLookTapAt = 0;
      this.lookTapCandidateId = null;
      this.lookTapStartedAt = 0;
    }
    changed.forEach((touch) => {
      const id = touchId(touch);
      if (id === this.moveTouchId) return;
      if (this.lookTouchId === null || this.lookTouchId === undefined) {
        this.lookTouchId = id;
        this.lastLookTouch = touchPoint(touch);
        this.lookGestureActive = false;
      } else if ((this.lookPinchTouchId === null || this.lookPinchTouchId === undefined)
        && id !== this.lookTouchId) {
        this.lookPinchTouchId = id;
      }
    });
    const primary = touches.find((touch) => touchId(touch) === this.lookTouchId);
    const secondary = touches.find((touch) => touchId(touch) === this.lookPinchTouchId);
    if (primary && secondary) {
      this.lastLookTapAt = 0;
      this.lookTapCandidateId = null;
      this.lookTapStartedAt = 0;
      this.lastPinchDistance = distanceBetweenTouches([primary, secondary]);
      this.lastLookTouch = null;
    }
  },

  handleLookMove(event) {
    if (!this.cameraController
      || this.data.phase !== 'ready'
      || (this.trajectoryPlayer && this.trajectoryPlayer.playing)) return;
    const touches = touchesOf(event);
    const primary = touches.find((touch) => touchId(touch) === this.lookTouchId);
    const secondary = touches.find((touch) => touchId(touch) === this.lookPinchTouchId);
    if (primary && secondary) {
      this.lastLookTapAt = 0;
      this.lookTapCandidateId = null;
      this.lookTapStartedAt = 0;
      const distance = distanceBetweenTouches([primary, secondary]);
      if (this.lastPinchDistance > 0) {
        const zoom = distance - this.lastPinchDistance;
        if (Math.abs(zoom) > 0.05) {
          this.cameraController.addGesture(0, 0, zoom);
          this.lookGestureActive = true;
          this.markCameraChanged(Date.now());
        }
      }
      this.lastPinchDistance = distance;
      this.lastLookTouch = null;
      return;
    }

    if (primary) {
      const point = touchPoint(primary);
      if (touchId(primary) === this.lookTapCandidateId
        && Math.hypot(
          point.x - this.lookTapStartX,
          point.y - this.lookTapStartY,
        ) > TAP_MOVE_THRESHOLD_PX) {
        this.lastLookTapAt = 0;
        this.lookTapCandidateId = null;
        this.lookTapStartedAt = 0;
      }
      if (this.lastLookTouch) {
        const dx = point.x - this.lastLookTouch.x;
        const dy = point.y - this.lastLookTouch.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.05) {
          this.cameraController.addGesture(dx, dy, 0);
          this.lookGestureActive = true;
          this.markCameraChanged(Date.now());
        }
      }
      this.lastLookTouch = point;
      this.lastPinchDistance = 0;
    }
  },

  handleLookEnd(event) {
    const touches = touchesOf(event);
    const changed = changedTouchesOf(event);
    const ended = new Set(changed.map((touch) => touchId(touch)));
    const completedTap = changed.find(
      (touch) => touchId(touch) === this.lookTapCandidateId,
    );
    let shouldRecenter = false;
    if (completedTap) {
      const point = touchPoint(completedTap);
      const now = Date.now();
      const duration = now - this.lookTapStartedAt;
      const moved = Math.hypot(
        point.x - this.lookTapStartX,
        point.y - this.lookTapStartY,
      );
      const isTap = (!event || event.type !== 'touchcancel')
        && duration >= 0
        && duration <= TAP_MAX_DURATION_MS
        && moved <= TAP_MOVE_THRESHOLD_PX;
      if (isTap) {
        const distance = Math.hypot(
          point.x - this.lastLookTapX,
          point.y - this.lastLookTapY,
        );
        shouldRecenter = !!(this.lastLookTapAt
          && now - this.lastLookTapAt <= DOUBLE_TAP_INTERVAL_MS
          && distance <= DOUBLE_TAP_DISTANCE_PX);
        if (shouldRecenter) {
          this.lastLookTapAt = 0;
        } else {
          this.lastLookTapAt = now;
          this.lastLookTapX = point.x;
          this.lastLookTapY = point.y;
        }
      } else {
        this.lastLookTapAt = 0;
      }
      this.lookTapCandidateId = null;
      this.lookTapStartedAt = 0;
    }
    if (ended.has(this.lookPinchTouchId)) this.lookPinchTouchId = null;
    if (ended.has(this.lookTouchId)) {
      const promoted = touches.find((touch) => touchId(touch) === this.lookPinchTouchId);
      this.lookTouchId = promoted ? touchId(promoted) : null;
      this.lookPinchTouchId = null;
      this.lastLookTouch = promoted ? touchPoint(promoted) : null;
    }

    const primary = touches.find((touch) => touchId(touch) === this.lookTouchId);
    const secondary = touches.find((touch) => touchId(touch) === this.lookPinchTouchId);
    if (primary && secondary) {
      this.lastPinchDistance = distanceBetweenTouches([primary, secondary]);
      this.lastLookTouch = null;
    } else if (primary) {
      this.lastLookTouch = touchPoint(primary);
      this.lastPinchDistance = 0;
    }

    if (this.lookTouchId === null || this.lookTouchId === undefined) {
      if (this.lookGestureActive) this.lastMotionAt = Date.now();
      this.lookGestureActive = false;
      this.lastLookTouch = null;
      this.lastPinchDistance = 0;
    }
    if (shouldRecenter) this.recenterCamera();
  },

  handleMoveStart(event) {
    if (!this.cameraController || this.data.phase !== 'ready') return;
    if (this.trajectoryPlayer && this.trajectoryPlayer.playing) return;
    if (this.moveTouchId !== null && this.moveTouchId !== undefined) return;
    const touch = (event.changedTouches && event.changedTouches[0]) || touchesOf(event)[0];
    if (!touch) return;
    const point = touchPoint(touch);
    this.moveTouchId = touchId(touch);
    this.moveCenterX = point.x;
    this.moveCenterY = point.y;
    this.joystickMoving = false;
    this.movementX = 0;
    this.movementZ = 0;
    this.cameraController.setMovement(0, 0, this.data.sprintEnabled);
    this.setData({
      joystickActive: true,
      joystickCenterX: Math.round(point.x),
      joystickCenterY: Math.round(point.y),
      joystickThumbX: 0,
      joystickThumbY: 0,
    });
  },

  handleMoveMove(event) {
    if (!this.cameraController
      || (this.trajectoryPlayer && this.trajectoryPlayer.playing)
      || this.moveTouchId === null
      || this.moveTouchId === undefined) return;
    const touch = touchesOf(event).find((item) => touchId(item) === this.moveTouchId);
    if (!touch) return;

    const point = touchPoint(touch);
    let dx = point.x - this.moveCenterX;
    let dy = point.y - this.moveCenterY;
    const distance = Math.hypot(dx, dy);
    if (distance > JOYSTICK_RADIUS) {
      dx = dx / distance * JOYSTICK_RADIUS;
      dy = dy / distance * JOYSTICK_RADIUS;
    }

    const movementX = dx / JOYSTICK_RADIUS;
    const movementZ = -dy / JOYSTICK_RADIUS;
    const moving = Math.hypot(movementX, movementZ) > 0.01;
    this.movementX = movementX;
    this.movementZ = movementZ;
    this.cameraController.setMovement(movementX, movementZ, this.data.sprintEnabled);
    if (moving || this.joystickMoving) this.markCameraChanged(Date.now());
    this.joystickMoving = moving;

    const now = Date.now();
    if (!this.lastJoystickUiUpdate || now - this.lastJoystickUiUpdate >= 80) {
      this.lastJoystickUiUpdate = now;
      this.setData({
        joystickThumbX: Math.round(dx),
        joystickThumbY: Math.round(dy),
      });
    }
  },

  handleMoveEnd(event) {
    if (this.moveTouchId === null || this.moveTouchId === undefined) return;
    const stillActive = touchesOf(event).some((item) => touchId(item) === this.moveTouchId);
    if (stillActive) return;

    this.moveTouchId = null;
    this.joystickMoving = false;
    this.movementX = 0;
    this.movementZ = 0;
    if (this.cameraController) this.cameraController.setMovement(0, 0, false);
    this.lastMotionAt = Date.now();
    this.setData({
      joystickActive: false,
      joystickThumbX: 0,
      joystickThumbY: 0,
    });
  },

  handleJumpStart() {
    if (!this.cameraController
      || this.data.phase !== 'ready'
      || (this.trajectoryPlayer && this.trajectoryPlayer.playing)
      || this.data.activeMode === 'orbit') return;
    this.cameraController.requestJump();
    this.markCameraChanged(Date.now());
    this.setData({ jumpActive: true });
  },

  handleJumpEnd() {
    if (this.data.jumpActive) this.setData({ jumpActive: false });
  },

  resetLookTouchState() {
    this.lookTouchId = null;
    this.lookPinchTouchId = null;
    this.lastLookTouch = null;
    this.lastPinchDistance = 0;
    this.lookGestureActive = false;
    this.lastLookTapAt = 0;
    this.lastLookTapX = 0;
    this.lastLookTapY = 0;
    this.lookTapCandidateId = null;
    this.lookTapStartedAt = 0;
    this.lookTapStartX = 0;
    this.lookTapStartY = 0;
  },

  resetTouchState(updateData) {
    if (this.cameraController) this.cameraController.setMovement(0, 0, false);
    this.moveTouchId = null;
    this.moveCenterX = 0;
    this.moveCenterY = 0;
    this.joystickMoving = false;
    this.movementX = 0;
    this.movementZ = 0;
    this.resetLookTouchState();
    this.wasCameraMoving = false;
    if (updateData !== false) {
      this.setData({
        joystickActive: false,
        joystickThumbX: 0,
        joystickThumbY: 0,
        jumpActive: false,
      });
    }
  },

  setDataIfChanged(patch) {
    const changed = {};
    Object.keys(patch).forEach((key) => {
      if (this.data[key] !== patch[key]) changed[key] = patch[key];
    });
    if (Object.keys(changed).length) this.setData(changed);
  },

  fail(message) {
    console.error('[Native v2]', message);
    this.setData({
      errorDetail: message,
      loading: false,
      phase: 'error',
      statusText: '原生渲染不可用',
    });
  },
});
