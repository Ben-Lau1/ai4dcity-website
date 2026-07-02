/**
 * scene.js - Three.js Scene Setup
 * Creates renderer, scene, camera, and render loop
 */
(function() {
  'use strict';

  const canvas = document.getElementById('render-canvas');
  const container = document.getElementById('canvas-container');

  // Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    desynchronized: true,
  });
  const isCoarsePointer = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const basePixelRatio = Math.min(devicePixelRatio, isCoarsePointer ? 1.0 : 1.25);
  const interactivePixelRatio = Math.min(devicePixelRatio, isCoarsePointer ? 0.75 : 0.95);
  const emergencyPixelRatio = Math.min(devicePixelRatio, isCoarsePointer ? 0.65 : 0.8);
  let activePixelRatio = 0;

  function setRenderPixelRatio(ratio) {
    if (Math.abs(activePixelRatio - ratio) < 0.01) return;
    activePixelRatio = ratio;
    renderer.setPixelRatio(ratio);
    if (container) {
      renderer.setSize(container.clientWidth, container.clientHeight, false);
    }
  }

  setRenderPixelRatio(basePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11151c);
  scene.fog = new THREE.Fog(0x11151c, 50, 500);

  // Camera
  const camera = new THREE.PerspectiveCamera(55, 2, 0.1, 2000);
  camera.position.set(0, 15, 25);
  camera.lookAt(0, 0, 0);

  // ---- Lighting: suitable for both Gaussian splats and PBR models ----
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  hemiLight.position.set(0, 50, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(10, 30, 10);
  scene.add(dirLight);

  // Optional grid (debug)
  // scene.add(new THREE.GridHelper(100, 100, 0x333344, 0x222233));

  // 输入控制器实例
  var inputCtrl = null;
  if (typeof InputController !== 'undefined') {
    inputCtrl = new InputController();
  }
  // 初始化输入控制器 DOM 监听
  if (inputCtrl && renderer && renderer.domElement) {
    inputCtrl.initDOM(renderer.domElement);
  }
  window.__inputCtrl = inputCtrl;

  // Render loop — only starts after scene is ready
  let lastTime = performance.now();
  let running = false;
  let rafId = null;
  let frameMsEMA = 16.7;
  let lastInteractionTime = -Infinity;
  let adaptiveQualityLevel = null;

  function hasActiveInput(snap) {
    if (!snap) return false;
    return Math.abs(snap.moveX) > 0.01 ||
      Math.abs(snap.moveZ) > 0.01 ||
      Math.abs(snap.yawDelta) > 0.0001 ||
      Math.abs(snap.pitchDelta) > 0.0001 ||
      Math.abs(snap.scrollDelta) > 0.01 ||
      snap.lookActive ||
      snap.jump ||
      snap.qe !== 0 ||
      snap.rf !== 0;
  }

  function setAdaptiveQuality(level) {
    if (adaptiveQualityLevel !== level) {
      adaptiveQualityLevel = level;
    }
    if (typeof LCCLoader !== 'undefined' && LCCLoader.setPerformanceQualityLevel) {
      LCCLoader.setPerformanceQualityLevel(level);
    }
  }

  function updateAdaptivePerformance(time, dt, snap) {
    const frameMs = Math.min(120, Math.max(1, dt * 1000));
    frameMsEMA = frameMsEMA * 0.9 + frameMs * 0.1;

    if (hasActiveInput(snap)) {
      lastInteractionTime = time;
    }

    const activeWindow = (time - lastInteractionTime) < 650;
    const poorFrameTime = frameMsEMA > 34;
    const veryPoorFrameTime = frameMsEMA > 48;

    if (veryPoorFrameTime) {
      setRenderPixelRatio(emergencyPixelRatio);
      setAdaptiveQuality(1);
    } else if (activeWindow || poorFrameTime) {
      setRenderPixelRatio(interactivePixelRatio);
      setAdaptiveQuality(2);
    } else {
      setRenderPixelRatio(basePixelRatio);
      setAdaptiveQuality(null);
    }

    window.__perfStats = {
      fps: Math.round(1000 / Math.max(frameMsEMA, 1)),
      frameMs: Math.round(frameMsEMA * 10) / 10,
      pixelRatio: activePixelRatio,
      quality: (typeof LCCLoader !== 'undefined' && LCCLoader.getEffectiveQualityLevel) ? LCCLoader.getEffectiveQualityLevel() : null,
    };
  }

  function animate(time) {
    if (!running) return;
    rafId = requestAnimationFrame(animate);

    const dt = (time - lastTime) / 1000;
    lastTime = time;

    // 1. 输入控制器（每帧轮询）→ InputSnapshot
    if (window.__inputCtrl) window.__inputCtrl.update(dt);
    const snap = window.__inputCtrl ? window.__inputCtrl.snapshot : null;
    updateAdaptivePerformance(time, dt, snap);

    // 2. CameraState: InputSnapshot → 更新模式状态
    if (typeof CameraState !== 'undefined') {
      CameraState.processInput(snap);
    }

    // 3. 玩家模型：动画 + 移动（不碰相机）
    if (typeof LCCPlayer !== 'undefined') {
      LCCPlayer.update(dt);
    }

    // 4. CameraState: 状态 → 写相机（avatar 模式读模型位置）
    if (typeof CameraState !== 'undefined') {
      CameraState.animate(dt);
    }

    // ★ 4a. 轨迹播放模式覆盖相机/模型位置
    if (typeof LCCPlayback !== 'undefined' && LCCPlayback.isPlaying()) {
      LCCPlayback.update(dt);
    }

    // 5. LCC 渲染器
    if (typeof LCCRender !== 'undefined' && typeof LCCRender.update === 'function') {
      LCCRender.update();
    }

    renderer.render(scene, camera);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(animate);
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Environment Background ----
  const DARK_COLOR = 0x11151c;
  // 天空球固定在世界原点（不跟随相机），半径足够大确保相机始终在内部
  const SKY_RADIUS = 5000;
  const SKY_POS = new THREE.Vector3(0, 0, 0);
  // 天空球朝向 — 绕 X 轴（上下）和 Y 轴（水平）
  // 当前设 0 表示穹顶指向 Three.js 的 +Y 方向（上）
  // 如果数据使用不同轴向，请调整这两个值
  const SKY_PITCH = 0;  // 绕 X 轴: 0=穹顶朝上（Y为上；modelMatrix 已将 Z-up 转为 Y-up）
  const SKY_YAW   = 0;            // 绕 Y 轴: 水平旋转纹理朝向，不对再调

  let skySphere = null;

  function createSkyTexture() {
    const loader = new THREE.TextureLoader();
    const texture = loader.load('textures/skybox/5.jpg');
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function createSkySphere() {
    if (skySphere) {
      scene.remove(skySphere);
      skySphere.geometry.dispose();
      skySphere.material.dispose();
      skySphere = null;
    }

    const texture = createSkyTexture();

    const geo = new THREE.SphereGeometry(SKY_RADIUS, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0x8899bb,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    skySphere = new THREE.Mesh(geo, mat);
    skySphere.renderOrder = -999;
    skySphere.name = 'skySphere';
    skySphere.frustumCulled = false;
    // ★ 固定在世界原点，不跟随相机
    skySphere.position.copy(SKY_POS);
    // ★ 旋转对齐 3DGS 数据的"上"方向
    skySphere.rotation.x = SKY_PITCH;
    skySphere.rotation.y = SKY_YAW;
    return skySphere;
  }

  var _skyTex = null;

  function setBackground(type) {
    if (type === 'sky') {
      if (!_skyTex) {
        _skyTex = createSkyTexture();
        _skyTex.mapping = THREE.EquirectangularReflectionMapping;
      }
      scene.background = _skyTex;
      scene.fog = null;
    } else {
      if (_skyTex) { _skyTex.dispose(); _skyTex = null; }
      scene.background = new THREE.Color(DARK_COLOR);
      scene.fog = new THREE.Fog(DARK_COLOR, 50, 500);
    }
  }

  // Expose
  window.LCCScene = { scene, camera, renderer, start, stop, resize, setBackground };
})();
