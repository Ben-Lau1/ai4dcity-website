/**
 * lcc-loader.js - LCC SDK Wrapper
 * Loads .lcc2 Gaussian Splatting scene data
 */
(function() {
  'use strict';

  let currentRenderer = null;
  let isLoaded = false;
  let userQualityLevel = 3;
  let performanceQualityLevel = null;
  let effectiveQualityLevel = null;

  function init() {
    if (typeof LCCRender === 'undefined') {
      console.error('[LCC] LCCRender not found. Make sure lcc-0.6.1.umd.js is loaded.');
      return;
    }
  }

  /**
   * Load a .lcc2 scene
   * @param {string} dataPath - URL to .lcc2 file or dataPath object
   * @param {object} callbacks - { onProgress(pct), onLoad(renderer), onError(err) }
   */
  function load(dataPath, callbacks) {
    init();
    const { onProgress, onLoad, onError } = callbacks || {};
    const scene = LCCScene ? LCCScene.scene : null;
    const camera = LCCScene ? LCCScene.camera : null;

    if (!scene || !camera) {
      console.error('[LCC] Scene or camera not ready');
      if (onError) onError('Scene not ready');
      return;
    }

    // Resolve relative paths to absolute URLs (required by SDK)
    let resolvedPath = dataPath;
    if (typeof dataPath === 'string' && !/^https?:\/\//.test(dataPath)) {
      resolvedPath = new URL(dataPath, window.location.href).href;
    }

    console.log('[LCC] Loading:', resolvedPath);

    // Auto-detect if dataPath is a string URL or an object
    const renderer = LCCScene.renderer;
    const config = typeof dataPath === 'string'
      ? { dataPath: resolvedPath, scene, camera, renderLib: THREE, libType: 0, canvas: renderer.domElement, renderer, modelMatrix: new THREE.Matrix4().set(-1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1) }
      : Object.assign({ scene, camera, renderLib: THREE, libType: 0, canvas: renderer.domElement, renderer }, dataPath);

    try {
      currentRenderer = LCCRender.load(
        config,
        // onLoad (mesh)
        function(mesh) {
          console.log('[LCC] Scene loaded successfully');
          isLoaded = true;
          LCCRender.setCamera(camera);
          if (onLoad) onLoad(currentRenderer);
        },
        // onProgress (percent)
        function(pct) {
          if (onProgress) onProgress(pct);
        },
        // onError
        function(err) {
          console.error('[LCC] Load error:', err);
          if (onError) onError(err);
        }
      );
    } catch (e) {
      console.error('[LCC] Exception loading scene:', e);
      if (onError) onError(e);
    }
  }

  function unload() {
    if (currentRenderer) {
      LCCRender.unload(currentRenderer);
      currentRenderer = null;
      isLoaded = false;
      effectiveQualityLevel = null;
    }
  }

  function getRenderer() { return currentRenderer; }

  function dispose() {
    unload();
    if (typeof LCCRender !== 'undefined' && LCCRender.dispose) {
      LCCRender.dispose();
    }
  }

  function raycast(screenX, screenY, maxDist, radius) {
    if (!isLoaded) return null;
    return LCCRender.raycast({
      evt: { x: screenX, y: screenY },
      maxDistance: maxDist || 100,
      radius: radius || 1.0,
    });
  }

  /**
   * 设置渲染质量等级 (0-4)
   * 0=性能  1  2=平衡  3  4=质量
   */
  function applyQualityLevel(level) {
    var obj = currentRenderer;
    if (!obj) return;

    var presets = [
      { useSH: false, pointsOnly: false, maxLoadSplatCount: 700000  },
      { useSH: false, pointsOnly: false, maxLoadSplatCount: 1400000 },
      { useSH: true,  pointsOnly: false, maxLoadSplatCount: 2200000 },
      { useSH: true,  pointsOnly: false, maxLoadSplatCount: 3200000 },
      { useSH: true,  pointsOnly: false, maxLoadSplatCount: 5000000 },
    ];

    var cfg = presets[level] || presets[2];
    var resolvedLevel = presets[level] ? level : 2;
    if (effectiveQualityLevel === resolvedLevel) return;

    if (typeof obj.updateCurrentConfig === 'function') {
      obj.updateCurrentConfig(cfg);
    }
    if (typeof obj.setMaxSplats === 'function') {
      obj.setMaxSplats(cfg.maxLoadSplatCount);
    }
    var nodeLimit = cfg.maxLoadSplatCount > 0 ? Math.ceil(cfg.maxLoadSplatCount / 50) : 0;
    if (typeof obj.setMaxNodeSplats === 'function') {
      obj.setMaxNodeSplats(nodeLimit);
    }
    if (typeof obj.setLodAutoLevelUp === 'function') {
      obj.setLodAutoLevelUp(true);
    }
    effectiveQualityLevel = resolvedLevel;
  }

  function applyEffectiveQuality() {
    var level = userQualityLevel;
    if (performanceQualityLevel !== null) {
      level = Math.min(userQualityLevel, performanceQualityLevel);
    }
    applyQualityLevel(level);
  }

  function setQualityLevel(level) {
    var n = parseInt(level, 10);
    if (!isFinite(n)) n = 2;
    userQualityLevel = Math.max(0, Math.min(4, n));
    applyEffectiveQuality();
  }

  function setPerformanceQualityLevel(level) {
    if (level === null || level === undefined) {
      performanceQualityLevel = null;
    } else {
      var n = parseInt(level, 10);
      if (!isFinite(n)) n = 2;
      performanceQualityLevel = Math.max(0, Math.min(4, n));
    }
    applyEffectiveQuality();
  }

  /**
   * 设置最大高斯点数限制
   * @param {number} count - 最大点数, 0 = 不限
   */
  function setMaxSplats(count) {
    var obj = currentRenderer;
    if (!obj) return;
    var n = parseInt(count, 10) || 0;
    if (typeof obj.setMaxSplats === 'function') {
      obj.setMaxSplats(n);
    }
    var nodeLimit = n > 0 ? Math.ceil(n / 50) : 0;
    if (typeof obj.setMaxNodeSplats === 'function') {
      obj.setMaxNodeSplats(nodeLimit);
    }
  }

  // Expose
  window.LCCLoader = {
    load, unload, dispose, raycast,
    getRenderer, isLoaded: function() { return isLoaded; },
    setQualityLevel,
    setPerformanceQualityLevel,
    getQualityLevel: function() { return userQualityLevel; },
    getEffectiveQualityLevel: function() { return effectiveQualityLevel; },
    setMaxSplats,
  };
})();
