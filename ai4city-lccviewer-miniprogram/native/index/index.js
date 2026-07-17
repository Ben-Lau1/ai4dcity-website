'use strict';

const { createScopedThreejs } = require('../../vendor/three-r164-miniprogram');
const { installBrowserShim } = require('../runtime/browser-shim');
const { createCameraController } = require('../player/camera-controller');

const SCENE_URL = 'https://www.ai4dcity.com/lccviewer/data/KPJ-08-4/%E4%BA%94%E5%9B%AD%E8%BF%9E%E9%80%9A-4.lcc2';
const AVATAR_URL = 'https://www.ai4dcity.com/lccviewer/models/lcc_girl.glb';
const SCENE_VIEW = {
  // H5 transforms {x,y,z} to {-x,z,y} and adds the 1.7 m eye height.
  position: [1291.68913533708, -4.18265918733182, -796.729881269969],
  lookAt: [1298.90233161226, -4.18265918733182, -790.879817632871],
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function touchPoint(touch) {
  return {
    x: touch.clientX === undefined ? touch.x : touch.clientX,
    y: touch.clientY === undefined ? touch.y : touch.clientY,
  };
}

function touchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  const first = touchPoint(touches[0]);
  const second = touchPoint(touches[1]);
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function errorMessage(error) {
  const runtimeDetail = globalThis.__lccLastConsoleError
    || globalThis.__lccLastNetworkError
    || globalThis.__lccLastRequest;
  if (!error) return runtimeDetail || '未知错误';
  if (typeof error === 'string') return error;
  return error.errMsg || error.message || runtimeDetail || String(error);
}

Page({
  data: {
    activeMode: 'orbit',
    errorDetail: '',
    joystickActive: false,
    joystickCenterX: 0,
    joystickCenterY: 0,
    joystickThumbX: 0,
    joystickThumbY: 0,
    jumpActive: false,
    loading: true,
    modes: [
      { id: 'orbit', label: '自由' },
      { id: 'firstPerson', label: '第一人称' },
      { id: 'avatar', label: '第三人称' },
    ],
    phase: 'loading',
    progress: 0,
    statusText: '初始化原生画布',
  },

  onReady() {
    this.queryCanvas(0);
  },

  onShow() {
    if (!this.suspended || this.disposed || !this.canvas || this.frameId) return;
    this.suspended = false;
    this.renderFrame();
  },

  onHide() {
    this.suspended = true;
    if (this.canvas && this.frameId && this.canvas.cancelAnimationFrame) {
      this.canvas.cancelAnimationFrame(this.frameId);
    }
    this.frameId = null;
  },

  queryCanvas(attempt) {
    const query = typeof this.createSelectorQuery === 'function'
      ? this.createSelectorQuery()
      : wx.createSelectorQuery();
    query
      .select('#native-canvas')
      .fields({ node: true, size: true })
      .exec((result) => {
        const canvasInfo = result && result[0];
        if (!canvasInfo || !canvasInfo.node) {
          if (attempt < 5) {
            setTimeout(() => this.queryCanvas(attempt + 1), 120);
            return;
          }
          this.fail('未获取到小程序 WebGL Canvas');
          return;
        }
        this.initializeRenderer(canvasInfo.node, canvasInfo.width, canvasInfo.height);
      });
  },

  onUnload() {
    this.disposed = true;
    if (this.canvas && this.frameId && this.canvas.cancelAnimationFrame) {
      this.canvas.cancelAnimationFrame(this.frameId);
    }
    if (this.LCCRender && this.lccRenderer) {
      try {
        this.LCCRender.unload(this.lccRenderer);
      } catch (error) {
        console.warn('[Native LCC] unload failed', error);
      }
    }
    if (this.renderer && typeof this.renderer.dispose === 'function') {
      this.renderer.dispose();
    }
    if (this.cameraController) this.cameraController.dispose();
  },

  initializeRenderer(canvas, measuredWidth, measuredHeight) {
    try {
      const windowInfo = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const width = measuredWidth || windowInfo.windowWidth;
      const height = measuredHeight || windowInfo.windowHeight;

      canvas.__cssWidth = width;
      canvas.__cssHeight = height;

      const THREE = createScopedThreejs(canvas);
      installBrowserShim(canvas, SCENE_URL);
      const contextAttributes = {
        alpha: false,
        antialias: false,
        depth: true,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        desynchronized: true,
      };
      const context = canvas.getContext('webgl2', contextAttributes);

      if (!context || typeof context.texImage3D !== 'function') {
        throw new Error('当前环境未提供 WebGL2；开发者工具模拟器无法完成 LCC2 验证，请使用真机预览');
      }

      canvas.__lccWebGLContext = context;
      this.gpuCaps = {
        colorFloat: !!context.getExtension('EXT_color_buffer_float'),
        colorHalfFloat: !!context.getExtension('EXT_color_buffer_half_float'),
        floatLinear: !!context.getExtension('OES_texture_float_linear'),
        maxColorAttachments: context.getParameter(context.MAX_COLOR_ATTACHMENTS),
        maxDrawBuffers: context.getParameter(context.MAX_DRAW_BUFFERS),
      };

      console.info(
        '[Native LCC] WebGL context',
        context.getParameter(context.VERSION),
        context.getParameter(context.SHADING_LANGUAGE_VERSION),
        `maxTexture=${context.getParameter(context.MAX_TEXTURE_SIZE)}`,
      );

      const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false });
      renderer.setSize(width, height, false);
      renderer.setClearColor(0x090b0f, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x090b0f);
      const camera = new THREE.PerspectiveCamera(55, width / Math.max(height, 1), 0.1, 2500);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x26303a, 1.4));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
      keyLight.position.set(8, 12, 10);
      scene.add(keyLight);

      this.canvas = canvas;
      this.THREE = THREE;
      this.renderer = renderer;
      this.scene = scene;
      this.camera = camera;
      this.cameraController = createCameraController({
        THREE,
        scene,
        camera,
        initialPosition: SCENE_VIEW.position,
        initialTarget: SCENE_VIEW.lookAt,
        avatarUrl: AVATAR_URL,
        onAvatarReady: () => {
          if (this.data.activeMode === 'avatar') {
            this.setData({ statusText: '第三人称角色已就绪' });
          }
        },
        onAvatarError: () => {
          if (this.data.activeMode === 'avatar') {
            this.setData({ statusText: '第三人称简化角色' });
          }
        },
      });
      this.placeholder = this.createPlaceholder(THREE, scene);
      this.debugMarker = this.createDebugMarker(THREE, scene);
      this.lastFrameTime = Date.now();
      this.renderFrame();

      this.setData({
        phase: 'ready',
        progress: 5,
        statusText: '原生 WebGL 已就绪',
      });

      setTimeout(() => this.loadLccScene(), 50);
    } catch (error) {
      this.fail(`WebGL 初始化失败：${errorMessage(error)}`);
    }
  },

  createPlaceholder(THREE, scene) {
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const colors = [0x54d6a0, 0x69a9ff, 0xf2c15f, 0xe8edf2];
    const blocks = [
      [-2.1, 0.5, 0, 1.2, 1, 1.2],
      [-0.6, 1.1, -0.5, 1.1, 2.2, 1.1],
      [0.9, 0.8, 0.4, 1.3, 1.6, 1.3],
      [2.3, 1.5, -0.2, 0.9, 3, 0.9],
    ];
    blocks.forEach((block, index) => {
      const material = new THREE.MeshStandardMaterial({
        color: colors[index],
        metalness: 0.05,
        roughness: 0.72,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(block[0], block[1], block[2]);
      mesh.scale.set(block[3], block[4], block[5]);
      group.add(mesh);
    });
    scene.add(group);
    return group;
  },

  createDebugMarker(THREE, scene) {
    const geometry = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff3b78,
      depthTest: false,
      depthWrite: false,
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(...SCENE_VIEW.lookAt);
    marker.frustumCulled = false;
    marker.renderOrder = 10000;
    scene.add(marker);
    return marker;
  },

  loadLccScene() {
    try {
      const LCC = require('../vendor/lcc-0.6.1-native');
      const LCCRender = LCC && LCC.LCCRender;
      if (!LCCRender || typeof LCCRender.load !== 'function') {
        throw new Error('LCC SDK 没有正确导出 LCCRender');
      }

      this.LCCRender = LCCRender;
      this.sdkLoadComplete = false;
      this.postLoadRenderFrames = 0;
      this.setData({
        loading: true,
        phase: 'loading',
        statusText: '加载原生 LCC2 场景',
      });

      const THREE = this.THREE;
      const config = {
        dataPath: SCENE_URL,
        scene: this.scene,
        camera: this.camera,
        renderLib: THREE,
        libType: 0,
        useEnv: false,
        canvas: this.canvas,
        renderer: this.renderer,
        modelMatrix: new THREE.Matrix4().set(
          -1, 0, 0, 0,
          0, 0, 1, 0,
          0, 1, 0, 0,
          0, 0, 0, 1,
        ),
      };

      this.lccRenderer = LCCRender.load(
        config,
        () => {
          this.sdkLoadComplete = true;
          this.postLoadRenderFrames = 0;
          LCCRender.setCamera(this.camera);
          const qualityConfig = {
            useSH: true,
            pointsOnly: false,
            maxLoadSplatCount: 500000,
          };
          if (typeof this.lccRenderer.updateCurrentConfig === 'function') {
            this.lccRenderer.updateCurrentConfig(qualityConfig);
          }
          if (typeof this.lccRenderer.setMaxSplats === 'function') {
            this.lccRenderer.setMaxSplats(qualityConfig.maxLoadSplatCount);
          }
          if (typeof this.lccRenderer.setMaxNodeSplats === 'function') {
            this.lccRenderer.setMaxNodeSplats(
              Math.ceil(qualityConfig.maxLoadSplatCount / 50),
            );
          }
          if (typeof this.lccRenderer.setLodAutoLevelUp === 'function') {
            this.lccRenderer.setLodAutoLevelUp(true);
          }
          this.setData({
            errorDetail: '',
            loading: true,
            phase: 'loading',
            progress: 99,
            statusText: '数据已载入 · 生成首帧',
          });
        },
        (progress) => {
          const percent = clamp(Math.round(Number(progress || 0) * 100), 5, 99);
          const update = {};
          if (percent !== this.data.progress) update.progress = percent;
          if (percent >= 95 && this.data.statusText !== '后台线程整理首帧') {
            update.statusText = '后台线程整理首帧';
          }
          if (Object.keys(update).length) this.setData(update);
        },
        (error) => {
          this.fail(`LCC2 加载失败：${errorMessage(error)}`, true);
        },
      );
    } catch (error) {
      this.fail(`LCC SDK 适配失败：${errorMessage(error)}`, true);
    }
  },

  renderFrame() {
    if (this.disposed || this.suspended || !this.canvas) return;
    const now = Date.now();
    const dt = Math.min(Math.max((now - this.lastFrameTime) / 1000, 0.001), 0.05);
    this.lastFrameTime = now;
    this.cameraController.update(dt);
    if (this.LCCRender && this.lccRenderer) {
      try {
        this.LCCRender.update();
      } catch (error) {
        console.error('[Native LCC] update failed', error);
        this.LCCRender = null;
        this.fail(`LCC2 GPU 初始化失败：${errorMessage(error)}`, true);
      }
    } else if (this.placeholder) {
      this.placeholder.rotation.y += 0.0025;
    }
    this.renderer.render(this.scene, this.camera);
    this.checkFirstDrawableFrame();
    this.frameId = this.canvas.requestAnimationFrame(() => this.renderFrame());
  },

  checkFirstDrawableFrame() {
    if (this.firstFrameVisible || !this.lccRenderer) return;
    if (!this.sdkLoadComplete) return;

    // Reaching this point means LCCRender.update() and renderer.render() both
    // completed for this frame. SDK debug fields vary by runtime and must not
    // be treated as a required readiness contract.
    this.postLoadRenderFrames = (this.postLoadRenderFrames || 0) + 1;
    let lcc;
    try {
      lcc = typeof this.lccRenderer.getDebugInfo === 'function'
        ? this.lccRenderer.getDebugInfo()
        : null;
    } catch (error) {
      lcc = null;
    }

    const hasDrawableData = !!(lcc && (
      Number(lcc.currentSplats) > 0
      || Number(lcc.indexCount) > 0
      || Number(lcc.rootChildren) > 0
      || Number(lcc.listCount) > 0
    ));
    const debugConfirmsReady = hasDrawableData && lcc.drawReady !== false;
    const renderedAfterLoad = this.postLoadRenderFrames >= 2;
    const hasDrawableFrame = debugConfirmsReady || renderedAfterLoad;
    if (!hasDrawableFrame) return;

    this.firstFrameVisible = true;
    if (this.placeholder) this.placeholder.visible = false;
    if (this.debugMarker) this.debugMarker.visible = false;
    this.setData({
      errorDetail: '',
      loading: false,
      phase: 'ready',
      progress: 100,
      statusText: 'LCC2 流畅模式',
    });
  },

  selectMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!this.cameraController || !mode || mode === this.data.activeMode) return;
    this.cameraController.switchMode(mode);
    this.cameraController.setMovement(0, 0, false);
    this.setData({
      activeMode: mode,
      joystickActive: false,
      joystickThumbX: 0,
      joystickThumbY: 0,
      statusText: mode === 'avatar' ? '加载第三人称角色' : 'LCC2 流畅模式',
    });
  },

  handleTouchStart(event) {
    this.lastTouch = event.touches.length === 1 ? touchPoint(event.touches[0]) : null;
    this.lastPinchDistance = touchDistance(event.touches);
  },

  handleTouchMove(event) {
    if (event.touches.length >= 2) {
      const distance = touchDistance(event.touches);
      if (this.lastPinchDistance > 0) {
        this.cameraController.addGesture(0, 0, distance - this.lastPinchDistance);
      }
      this.lastPinchDistance = distance;
      return;
    }
    if (event.touches.length === 1) {
      const point = touchPoint(event.touches[0]);
      if (this.lastTouch) {
        this.cameraController.addGesture(
          point.x - this.lastTouch.x,
          point.y - this.lastTouch.y,
          0,
        );
      }
      this.lastTouch = point;
    }
  },

  handleTouchEnd(event) {
    this.lastTouch = event.touches && event.touches.length === 1
      ? touchPoint(event.touches[0])
      : null;
    this.lastPinchDistance = touchDistance(event.touches);
  },

  handleMoveStart(event) {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;
    const point = touchPoint(touch);
    this.moveTouchId = touch.identifier;
    this.moveCenterX = point.x;
    this.moveCenterY = point.y;
    this.cameraController.setMovement(0, 0, false);
    this.setData({
      joystickActive: true,
      joystickCenterX: Math.round(point.x),
      joystickCenterY: Math.round(point.y),
      joystickThumbX: 0,
      joystickThumbY: 0,
    });
  },

  handleMoveMove(event) {
    const touches = Array.from(event.touches || []);
    const touch = touches.find((item) => item.identifier === this.moveTouchId);
    if (!touch) return;
    const point = touchPoint(touch);
    let dx = point.x - this.moveCenterX;
    let dy = point.y - this.moveCenterY;
    const maxRadius = 55;
    const distance = Math.hypot(dx, dy);
    if (distance > maxRadius) {
      dx = dx / distance * maxRadius;
      dy = dy / distance * maxRadius;
    }
    this.cameraController.setMovement(dx / maxRadius, -dy / maxRadius, false);

    const now = Date.now();
    if (!this.lastJoystickUiUpdate || now - this.lastJoystickUiUpdate >= 50) {
      this.lastJoystickUiUpdate = now;
      this.setData({
        joystickThumbX: Math.round(dx),
        joystickThumbY: Math.round(dy),
      });
    }
  },

  handleMoveEnd(event) {
    const changed = Array.from(event.changedTouches || []);
    if (changed.length && !changed.some((item) => item.identifier === this.moveTouchId)) return;
    this.moveTouchId = null;
    this.cameraController.setMovement(0, 0, false);
    this.setData({
      joystickActive: false,
      joystickThumbX: 0,
      joystickThumbY: 0,
    });
  },

  handleJumpStart() {
    if (!this.cameraController || this.data.activeMode === 'orbit') return;
    this.cameraController.requestJump();
    this.setData({ jumpActive: true });
  },

  handleJumpEnd() {
    if (this.data.jumpActive) this.setData({ jumpActive: false });
  },

  fail(message, preserveCanvas = false) {
    console.error('[Native LCC]', message);
    this.setData({
      errorDetail: message,
      loading: false,
      phase: 'error',
      statusText: preserveCanvas ? 'LCC 兼容性待处理' : '原生渲染不可用',
    });
  },
});
