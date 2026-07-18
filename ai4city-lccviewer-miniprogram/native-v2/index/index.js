'use strict';

const { createCameraController } = require('../controls/camera-controller');
const { cleanupAssets, loadSogAssets } = require('../runtime/range-loader');
const { CollisionController } = require('../runtime/collision-controller');
const { createSortController } = require('../runtime/sort-controller');
const { NearLodController } = require('../runtime/near-lod-controller');
const { SplatRenderer } = require('../runtime/splat-renderer');
const { TrajectoryPlayer } = require('../runtime/trajectory-player');
const SCENES = require('../scenes/generated');

const SORT_IDLE_MS = 700;
const SORT_PREDICTION_HORIZON_MS = 700;
const JOYSTICK_RADIUS = 54;
const DOUBLE_TAP_INTERVAL_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 20;
const DIAGNOSTIC_INTERVAL_MS = 1000;
// Match the mobile H5 interaction policy by changing framebuffer resolution
// under load. Native geometry uses a separate, view-stable source sample because
// the mini-program renderer cannot sustain the H5 SDK's complete-node budgets.
const BASE_PIXEL_RATIO = 1.0;
const INTERACTIVE_PIXEL_RATIO = 0.75;
const EMERGENCY_PIXEL_RATIO = 0.65;
const INTERACTION_RENDER_WINDOW_MS = 1500;
const RENDER_SCALE_MIN_HOLD_MS = 400;
const POOR_FRAME_TIME_MS = 34;
const VERY_POOR_FRAME_TIME_MS = 48;
const POOR_FRAME_RECOVERY_MS = 30;
const VERY_POOR_FRAME_RECOVERY_MS = 42;
const SORT_DIRECTION_DOT_THRESHOLD = Math.cos(2.5 * Math.PI / 180);
const SORT_POSITION_THRESHOLD_SQ = 16;
const SORT_RESULT_DIRECTION_DOT_THRESHOLD = Math.cos(18 * Math.PI / 180);
const SORT_RESULT_POSITION_THRESHOLD_SQ = 256;
const SORT_FOV_Y = 55 * Math.PI / 180;
const SORT_FAR = 3000;
const DEFAULT_QUALITY_LEVEL = 3;

// Keep the geometry set stable while the camera moves. Runtime pressure is
// handled by framebuffer scale; splat density changes only on an explicit
// quality selection.
const QUALITY_OPTIONS = [
  { id: 0, label: '性能', stride: 12 },
  { id: 1, label: '流畅', stride: 11 },
  { id: 2, label: '平衡', stride: 10 },
  { id: 3, label: '清晰', stride: 9 },
  { id: 4, label: '质量', stride: 7 },
];

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

function qualityProfile(level) {
  return QUALITY_OPTIONS.find((option) => option.id === Number(level))
    || QUALITY_OPTIONS[DEFAULT_QUALITY_LEVEL];
}

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
    forward: camera.forward.slice(),
    position: camera.position.slice(),
  };
}

function cameraNeedsSort(current, previous) {
  if (!previous) return true;
  const dx = current.position[0] - previous.position[0];
  const dy = current.position[1] - previous.position[1];
  const dz = current.position[2] - previous.position[2];
  if (dx * dx + dy * dy + dz * dz >= SORT_POSITION_THRESHOLD_SQ) return true;
  const directionDot = current.forward[0] * previous.forward[0]
    + current.forward[1] * previous.forward[1]
    + current.forward[2] * previous.forward[2];
  return directionDot < SORT_DIRECTION_DOT_THRESHOLD;
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
    this.disposed = false;
    this.suspended = false;
    this.renderFailed = false;
    this.frameId = null;
    this.loadGeneration = 0;
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
    this.lastMotionAt = 0;
    this.wasCameraMoving = false;
    this.cameraPredictionSample = null;
    this.predictedForward = null;
    this.lastFrameCpuMs = 0;
    this.lastGpuMs = 0;
    this.frameMsEma = 16.7;
    this.lastRenderScaleChangeAt = 0;
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
    this.memoryWarningHandler = () => this.handleMemoryWarning();
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

  updateAdaptiveRenderScale(now, frameMs) {
    if (!this.basePixelRatio || this.data.phase !== 'ready') return;

    const boundedFrameMs = clamp(Number(frameMs) || 16.7, 1, 120);
    this.frameMsEma = this.frameMsEma * 0.9 + boundedFrameMs * 0.1;

    const activeWindow = this.isCameraMoving()
      || now - this.lastMotionAt < INTERACTION_RENDER_WINDOW_MS;
    const currentRatio = this.pixelRatio || this.basePixelRatio;
    const currentlyEmergency = currentRatio <= this.emergencyPixelRatio + 0.01;
    const currentlyInteractive = currentRatio <= this.interactivePixelRatio + 0.01;
    let targetRatio = this.basePixelRatio;

    if (this.frameMsEma > VERY_POOR_FRAME_TIME_MS
      || (currentlyEmergency && this.frameMsEma > VERY_POOR_FRAME_RECOVERY_MS)) {
      targetRatio = this.emergencyPixelRatio;
    } else if (activeWindow
      || this.frameMsEma > POOR_FRAME_TIME_MS
      || (currentlyInteractive && this.frameMsEma > POOR_FRAME_RECOVERY_MS)) {
      targetRatio = this.interactivePixelRatio;
    }

    if (Math.abs(currentRatio - targetRatio) < 0.01) return;
    if (now - this.lastRenderScaleChangeAt < RENDER_SCALE_MIN_HOLD_MS) return;
    if (targetRatio > currentRatio) {
      const sortBusy = !!(this.sortController && this.sortController.getStats().busy);
      const rootUploadBusy = !!(this.splatRenderer && this.splatRenderer.pendingIndexUpload);
      const lodWorkBusy = !!(this.nearLodController
        && this.nearLodController.hasPendingIndexWork());
      if (sortBusy || rootUploadBusy || lodWorkBusy) return;
    }
    this.setRenderPixelRatio(targetRatio, now, false);
  },

  async loadScene(sceneId) {
    const scene = SCENES[sceneId];
    if (!scene || !this.gl || !this.canvas || this.disposed) return;
    const defaultMode = 'firstPerson';

    const generation = this.loadGeneration + 1;
    this.loadGeneration = generation;
    this.disposeSceneResources();
    this.resetTouchState(false);
    this.currentScene = scene;
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
    this.lastMotionAt = 0;
    this.wasCameraMoving = false;
    this.cameraPredictionSample = null;
    this.predictedForward = null;
    this.lastFrameCpuMs = 0;
    this.lastGpuMs = 0;

    this.setData({
      activeMode: defaultMode,
      activeSceneId: scene.id,
      activeSceneLabel: scene.label,
      errorDetail: '',
      fps: 0,
      cpuTimeText: '--',
      gpuTimeText: '--',
      helpOpen: false,
      joystickActive: false,
      joystickThumbX: 0,
      joystickThumbY: 0,
      jumpActive: false,
      loading: true,
      phase: 'loading',
      progress: 8,
      sceneMenuOpen: false,
      settingsOpen: false,
      sortDurationText: '--',
      sortRequests: 0,
      sortResults: 0,
      sortState: '等待首排',
      splatCountText: formatSplatCount(scene.sog.meta.count),
      renderPathText: '--',
      visibleRatioText: '--',
      lodCacheText: '--',
      statusText: `正在加载 ${scene.label}`,
      trajectoryPlaying: false,
    });

    let assets = null;
    let pendingRenderer = null;
    try {
      assets = await loadSogAssets(this.canvas, scene, (ratio) => {
        if (generation !== this.loadGeneration || this.disposed) return;
        const completed = clamp(Math.round(Number(ratio || 0) * 5), 0, 5);
        const progress = clamp(Math.round(8 + Number(ratio || 0) * 72), 8, 80);
        this.setDataIfChanged({
          progress,
          statusText: `加载场景资源 ${completed}/5`,
        });
      });

      if (generation !== this.loadGeneration || this.disposed) {
        cleanupAssets(assets);
        assets = null;
        return;
      }

      this.setData({ progress: 86, statusText: '正在创建 GPU 资源' });
      pendingRenderer = new SplatRenderer(this.gl, this.renderWidth, this.renderHeight, {
        indexStride: qualityProfile(this.data.qualityLevel).stride,
      });
      pendingRenderer.load(scene, assets);
      pendingRenderer.prepareFastPath();

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
      cameraController.setGroundSampler((position) => (
        this.data.collisionEnabled ? collisionController.sampleGround(position) : null
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
      this.sortController = createSortController(scene, assets.means, {
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
        this.nearLodController = new NearLodController({
          canvas: this.canvas,
          gl: this.gl,
          width: this.renderWidth,
          height: this.renderHeight,
          scene,
          baseRenderer: this.splatRenderer,
          sortController: this.sortController,
          samplingStride: qualityProfile(this.data.qualityLevel).stride,
          onActiveCount: (count, refinedNodes) => {
            if (generation !== this.loadGeneration || this.disposed) return;
            this.setDataIfChanged({
              splatCountText: `${formatSplatCount(count)} / LOD ${refinedNodes}`,
            });
          },
          onStatus: (statusText) => {
            if (generation !== this.loadGeneration || this.disposed) return;
            if (this.data.phase === 'loading' && !this.residentReady) return;
            this.setDataIfChanged({ statusText });
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
              const progress = clamp(90 + Math.floor(ratio * 9), 90, 99);
              let statusText = `全量数据加载 ${loadedDone}/${progressState.total}`;
              if (progressState.loaded + progressState.failed >= progressState.total
                && progressState.sorted < progressState.sortTotal) {
                statusText = `全量索引构建 ${sortedDone}/${progressState.sortTotal}`;
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
      this.setData({ progress: 90, statusText: '正在准备全量高清数据' });

      // The first request is submitted immediately; the controller holds it
      // until its worker has decoded the packed means.
      this.requestCameraSort('initial');
    } catch (error) {
      if (assets) cleanupAssets(assets);
      if (pendingRenderer) pendingRenderer.dispose();
      if (generation !== this.loadGeneration || this.disposed) return;
      this.loadGeneration += 1;
      this.disposeSceneResources();
      this.fail(`场景加载失败：${errorMessage(error)}`);
    }
  },

  switchScene(event) {
    const sceneId = event.currentTarget.dataset.sceneId;
    this.closeSceneMenu();
    if (!SCENES[sceneId] || sceneId === this.data.activeSceneId || !this.gl) return;
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
      predictedForward: (this.predictedForward || sourceCamera.forward).slice(),
      aspect: Math.max(1, this.renderWidth) / Math.max(1, this.renderHeight),
      fovY: SORT_FOV_Y,
      far: SORT_FAR,
      sampleStride: qualityProfile(this.data.qualityLevel).stride,
      // Keep the sampled source set complete across camera directions. The
      // vertex shader performs visibility rejection without baking the current
      // view into the persistent index texture.
      cullToFrustum: false,
      reason,
    };
    const includeDetails = options.includeDetails !== false;
    const rootNeedsSort = options.force === true
      || !this.firstSortComplete
      || cameraNeedsSort(camera, this.lastSortedCamera);
    if (!rootNeedsSort) {
      if (includeDetails && this.detailSortDirty && this.nearLodController) {
        this.nearLodController.requestSort(camera, {
          activeOnly: reason !== 'initial',
        });
        this.detailSortDirty = false;
        return true;
      }
      this.sortDirty = false;
      return false;
    }

    this.sortRequestInFlight = true;
    this.sortRequestRevision = this.cameraRevision;
    this.sortDirty = false;
    this.sortFailed = false;
    this.sortRequestedCamera = cameraSnapshot(camera);
    this.sortController.request(camera);
    if (includeDetails && this.nearLodController) {
      this.nearLodController.requestSort(camera, {
        activeOnly: reason !== 'initial',
      });
      this.detailSortDirty = false;
    }
    if (reason !== 'moving') this.updateDiagnostics(Date.now(), true);
    return true;
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
    const currentCamera = this.cameraController ? this.cameraController.getCamera() : null;
    const completedCamera = completedRequest && completedRequest.camera
      ? completedRequest.camera
      : this.sortRequestedCamera;
    const completedReason = completedCamera && completedCamera.reason
      ? completedCamera.reason
      : 'settled';
    const stale = !currentCamera || !completedCamera
      || cameraNeedsSort(currentCamera, completedCamera);
    const outsideCoverage = !cameraWithinSortCoverage(currentCamera, completedCamera);

    // Continuous moving sorts may complete behind the latest camera. Keep only
    // results whose padded visibility cone still covers the current view.
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
        });
        this.nearLodController.update(this.cameraController.getCamera());
      } else {
        this.splatRenderer.updateIndexes(indexes, { preSampled: true });
      }
    } catch (error) {
      this.handleRuntimeFailure(`排序纹理更新失败：${errorMessage(error)}`);
      return;
    }

    this.sortDirty = stale;
    this.sortFailed = false;
    this.lastSortedCamera = completedCamera;
    if (stale && this.isCameraMoving()) this.lastMotionAt = now;
    const firstResult = !this.firstSortComplete;
    this.firstSortComplete = true;
    const patch = {};
    if (firstResult) {
      this.rootSortReady = true;
    }
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
    this.sortDirty = true;
    this.detailSortDirty = true;
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
    if (moving) {
      if (!this.wasCameraMoving) {
        this.cameraRevision += 1;
        this.sortDirty = true;
        this.detailSortDirty = true;
        if (this.sortController.cancelDetailRequests) {
          this.sortController.cancelDetailRequests();
        }
      }
      this.lastMotionAt = now;
      this.sortDirty = true;
      this.detailSortDirty = true;
    } else if (this.wasCameraMoving) {
      this.lastMotionAt = now;
    }
    this.wasCameraMoving = moving;

    if (!moving
      && (this.sortDirty || this.detailSortDirty)
      && now - this.lastMotionAt >= SORT_IDLE_MS) {
      this.requestCameraSort('settled');
    }
  },

  updateSamplingPolicy() {
    if (!this.nearLodController) return;
    const profile = qualityProfile(this.data.qualityLevel);
    this.nearLodController.setSamplingStride(profile.stride);
  },

  beginGpuTimer() {
    const gl = this.gl;
    const extension = this.gpuTimerExtension;
    if (!gl || !extension || this.activeGpuQuery || this.pendingGpuQueries.length >= 2) return false;
    try {
      const query = gl.createQuery();
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      this.activeGpuQuery = query;
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

  pollGpuTimers() {
    const gl = this.gl;
    const extension = this.gpuTimerExtension;
    if (!gl || !extension || !this.pendingGpuQueries.length) return;
    try {
      const query = this.pendingGpuQueries[0];
      const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
      if (!available) return;
      this.pendingGpuQueries.shift();
      const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
      if (!disjoint) {
        this.lastGpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1000000;
      }
      gl.deleteQuery(query);
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
    if (!force && now - this.lastDiagnosticAt < DIAGNOSTIC_INTERVAL_MS) return;
    this.lastDiagnosticAt = now;
    this.pollGpuTimers();

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
    const rawFrameMs = clamp(now - this.lastFrameTime, 1, 120);
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
        if (this.nearLodController) this.nearLodController.update(camera);
        this.updateSortSchedule(now);
        this.updateSamplingPolicy();
        this.updateAdaptiveRenderScale(now, rawFrameMs);
      }
      if (this.splatRenderer && this.cameraController) {
        const residentPreloading = this.nearLodController
          && this.data.phase === 'loading'
          && !this.nearLodController.residentReady;
        if (residentPreloading) {
          this.clearCanvas();
        } else {
          this.splatRenderer.flushIndexUpload(24);
          if (this.nearLodController) this.nearLodController.flushIndexUploads(32);
          gpuTimerStarted = this.beginGpuTimer();
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

  handleMemoryWarning() {
    if (this.disposed) return;
    if (this.collisionController) this.collisionController.trimCache();
    if (this.nearLodController) this.nearLodController.trimCache(true);
    this.setDataIfChanged({ statusText: '内存压力较高，已保留当前高清区域' });
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

    if (mode === 'avatar') {
      if (typeof this.cameraController.recenterView !== 'function') return;
      this.resetLookTouchState();
      this.cameraController.recenterView();
      this.cameraController.update(0);
      this.markCameraChanged(Date.now());
      this.setDataIfChanged({ statusText: '第三人称视角已回正' });
      this.updateDiagnostics(Date.now(), true);
      return;
    }

    this.stopTrajectory(false);
    this.cameraController.setMovement(0, 0, false);
    let appliedTrajectoryStart = false;
    if (this.trajectoryPlayer) {
      this.trajectoryPlayer.reset();
      if (this.trajectoryPlayer.play()) {
        appliedTrajectoryStart = this.trajectoryPlayer.update(0, this.cameraController);
        this.trajectoryPlayer.pause();
      }
    }
    if (!appliedTrajectoryStart) this.cameraController.reset(this.currentScene);
    this.cameraController.setMode(mode);
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
      trajectoryPlaying: false,
      statusText: '已回到轨迹起点',
    });
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
      const now = Date.now();
      const distance = Math.hypot(point.x - this.lastLookTapX, point.y - this.lastLookTapY);
      if (this.lastLookTapAt
        && now - this.lastLookTapAt <= DOUBLE_TAP_INTERVAL_MS
        && distance <= DOUBLE_TAP_DISTANCE_PX) {
        this.lastLookTapAt = 0;
        this.recenterCamera();
        return;
      }
      this.lastLookTapAt = now;
      this.lastLookTapX = point.x;
      this.lastLookTapY = point.y;
    } else if (touches.length > 1) {
      this.lastLookTapAt = 0;
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
    const ended = new Set(changedTouchesOf(event).map((touch) => touchId(touch)));
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
