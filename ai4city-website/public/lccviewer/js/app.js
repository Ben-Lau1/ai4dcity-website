/**
 * app.js - LCC Viewer H5 - Main Entry
 * Parses URL params, initializes scene, loads data, starts render loop
 *
 * URL params:
 *   ?data=URL_TO_LCC2_FILE    (override scene's default lcc2)
 *   ?scene=SCENE_ID           (select a scene from SCENES table)
 *   ?mode=orbit|firstPerson   (optional, default per-scene)
 *
 * 场景切换（window.switchScene）会硬切+全重置：
 *   1. 暂停 playback / 解锁 fp 输入
 *   2. 卸载 LCC 渲染器（释放 GPU + 关闭碰撞）
 *   3. 清 trajectory 缓存（每个 scene 各自的 path json）
 *   4. 重置 CameraState 槽位（fp/orbit/avatar 都重置）
 *   5. 重置 player 模型位置
 *   6. 加载新 lcc2 → onLoad → 初始化 collision → resetToTrajectoryStart
 */
(function() {
  'use strict';

  // ===================================================================
  // SCENES 配置表（添加新场景只改这里）
  // ===================================================================
  var SCENES = {
    'KPJ-08-4': {
      id: 'KPJ-08-4',
      label: '五园连通-4',
      description: '场景描述待补充',
      lcc2:  'data/KPJ-08-4/五园连通-4.lcc2',
      path:  'data/path/KPJ-08-4_path.json',
      defaultMode: 'firstPerson',
    },
    'KPJ-05-2': {
      id: 'KPJ-05-2',
      label: '大学城',
      description: '场景描述待补充',
      lcc2:  'data/KPJ-05-2/KPJ-05-2.lcc2',
      path:  'data/path/KPJ-05-2_path.json',
      defaultMode: 'firstPerson',
    },
  };
  var DEFAULT_SCENE_ID = 'KPJ-08-4';
  window.SCENES = SCENES;  // 暴露给 UI 动态生成按钮

  // ---- Parse URL Params ----
  function getParam(name) {
    return new URL(window.location.href).searchParams.get(name) || '';
  }
  var dataURL    = getParam('data');                      // 可选：覆盖 lcc2
  var sceneId    = getParam('scene') || DEFAULT_SCENE_ID; // 可选：选场景
  var sceneCfg   = SCENES[sceneId] || SCENES[DEFAULT_SCENE_ID];
  if (dataURL) sceneCfg = Object.assign({}, sceneCfg, { lcc2: dataURL });
  var initialMode = getParam('mode') || sceneCfg.defaultMode;

  // ---- 运行时状态（场景切换共享） ----
  window.sceneState = {
    currentSceneId: sceneCfg.id,
    lcc2:           sceneCfg.lcc2,
    path:           sceneCfg.path,
    loading:        false,   // 切换中锁
  };

  // ===================================================================
  // 初始化（只跑一次）
  // ===================================================================
  function init() {
    if (typeof THREE === 'undefined')           { showFatal('Three.js 未加载'); return; }
    if (typeof LCCScene === 'undefined')         { showFatal('场景模块未加载'); return; }
    if (typeof CameraState === 'undefined')     { showFatal('相机状态模块未加载'); return; }
    if (typeof LCCLoader === 'undefined')       { showFatal('LCC 加载模块未加载'); return; }

    // 1. Show loading overlay
    if (typeof LCCUI !== 'undefined') LCCUI.showLoading();

    // 2. Init CameraState（中央状态引擎）
    CameraState.init(LCCScene.camera, LCCScene.renderer.domElement);
    CameraState.switchMode(initialMode);
    if (typeof LCCamera !== 'undefined' && LCCamera.syncMode) LCCamera.syncMode(initialMode);

    // Mark active mode button
    var modeBtns = document.querySelectorAll('.tb-btn-mode');
    for (var i = 0; i < modeBtns.length; i++) {
      modeBtns[i].classList.toggle('active', modeBtns[i].dataset.mode === initialMode);
    }

    // 3. Start render loop
    LCCScene.start();

    // 3a. 构建场景菜单（SCENES 已就绪）
    if (typeof LCCUI !== 'undefined' && LCCUI.buildSceneMenu) {
      LCCUI.buildSceneMenu();
    }

    // 4. Load initial scene
    console.log('[App] Init scene:', sceneCfg.id, '→', sceneCfg.lcc2);
    // 提前把 pathURL 注入 trajectory-player（onLoad 时再注入也可，但首次 resetToTrajectoryStart 需要它）
    if (typeof LCCPlayback !== 'undefined' && LCCPlayback.setPathURL) {
      LCCPlayback.setPathURL(sceneCfg.path);
    }
    _loadScene(sceneCfg.lcc2, sceneCfg.path, function() {
      // onLoad 后通知 UI 高亮当前场景按钮
      if (typeof LCCUI !== 'undefined' && LCCUI.markActiveScene) {
        LCCUI.markActiveScene(sceneCfg.id);
      }
    });
  }

  // ===================================================================
  // 加载 / 切换场景
  // ===================================================================
  function _loadScene(lcc2URL, pathURL, onLoaded) {
    if (typeof LCCUI !== 'undefined') LCCUI.showLoading();
    window.sceneState.loading = true;

    LCCLoader.load(lcc2URL, {
      onProgress: function(pct) {
        if (typeof LCCUI !== 'undefined') LCCUI.updateProgress(Math.round(pct * 100));
      },
      onLoad: function() {
        console.log('[App] Scene loaded:', lcc2URL);

        // 同步路径给 trajectory-player
        window.sceneState.path = pathURL;
        if (typeof LCCPlayback !== 'undefined' && LCCPlayback.setPathURL) {
          LCCPlayback.setPathURL(pathURL);
        }

        // 初始化碰撞检测（必须用新 obj）
        if (typeof LCCollision !== 'undefined') LCCollision.init();

        // 默认质量等级 3：介于平衡和质量之间，保留演示清晰度。
        if (typeof LCCLoader !== 'undefined' && LCCLoader.setQualityLevel) {
          LCCLoader.setQualityLevel(3);
        }

        // 同步碰撞开关到 UI checkbox
        var cb = document.getElementById('setting-collision');
        if (cb && typeof LCCollision !== 'undefined') {
          cb.disabled = false;
          cb.checked = LCCollision.isEnabled();
        }

        // 把相机/玩家放到轨迹起点
        resetToTrajectoryStart();

        setTimeout(function() {
          try {
            if (typeof LCCUI !== 'undefined') LCCUI.hideLoading();
            if (typeof CameraState !== 'undefined' && THREE) {
              CameraState.setOrbitTarget(new THREE.Vector3(0, 0, 0));
            }
            window.sceneState.loading = false;
            if (onLoaded) onLoaded();
          } catch(e) { console.error('[App] Post-load error:', e); }
        }, 100);
      },
      onError: function(err) {
        window.sceneState.loading = false;
        if (typeof LCCUI !== 'undefined') {
          LCCUI.showError('加载失败: ' + (err && err.message ? err.message : err));
        }
        console.error('[App] Failed to load:', err);
      },
    });
  }

  /**
   * 场景切换（硬切 + 全重置）
   * @param {string} newSceneId - SCENES 表的 key
   */
  window.switchScene = function(newSceneId) {
    var cfg = SCENES[newSceneId];
    if (!cfg) { console.warn('[App] Unknown scene:', newSceneId); return; }
    if (cfg.id === window.sceneState.currentSceneId) {
      console.log('[App] Scene unchanged:', cfg.id);
      return;
    }
    if (window.sceneState.loading) {
      console.warn('[App] Already loading, ignore switch');
      return;
    }

    console.log('[App] switchScene:', window.sceneState.currentSceneId, '→', cfg.id);
    window.sceneState.currentSceneId = cfg.id;
    window.sceneState.lcc2 = cfg.lcc2;

    // 1. 暂停 playback / 解锁 fp / 同步播放按钮 UI
    if (typeof LCCPlayback !== 'undefined' && LCCPlayback.isPlaying && LCCPlayback.isPlaying()) {
      LCCPlayback.pause();
      if (typeof LCCUI !== 'undefined' && LCCUI.resetPlayButtonUI) LCCUI.resetPlayButtonUI();
    }
    if (typeof CameraState !== 'undefined' && CameraState.setPlaybackLock) {
      CameraState.setPlaybackLock(false);
    }

    // 2. 卸载当前 LCC 渲染器（释放 GPU + 关闭碰撞）
    if (typeof LCCLoader !== 'undefined' && LCCLoader.unload) {
      try { LCCLoader.unload(); } catch(e) { console.warn('[App] unload error:', e); }
    }

    // 3. 清 trajectory 缓存（player + app 两处都要清，避免老 scene 的 path 残留）
    if (typeof LCCPlayback !== 'undefined' && LCCPlayback.clearCache) {
      LCCPlayback.clearCache();
    }
    _cachedPath = null;
    _cachedPathURL = null;

    // 4. 重置 CameraState 槽位（fp / orbit / avatar 都重置）
    if (typeof CameraState !== 'undefined' && CameraState.resetAll) {
      CameraState.resetAll();
    }

    // 场景切换后回到场景默认模式，避免 avatar 模式残留导致再次点击第三人称无效。
    var resetMode = cfg.defaultMode || 'firstPerson';
    if (typeof CameraState !== 'undefined' && CameraState.switchMode) {
      CameraState.switchMode(resetMode);
    }
    if (typeof LCCCamera !== 'undefined' && LCCCamera.syncMode) {
      LCCCamera.syncMode(resetMode);
    }
    var modeBtns = document.querySelectorAll('.tb-btn-mode');
    for (var mi = 0; mi < modeBtns.length; mi++) {
      modeBtns[mi].classList.toggle('active', modeBtns[mi].dataset.mode === resetMode);
    }
    if (window.__inputCtrl && window.__inputCtrl.resetState) {
      window.__inputCtrl.resetState();
    }

    // 5. 重置 player 模型（隐藏 → 下一帧 loadModel 时从新位置起步）
    if (typeof LCCPlayer !== 'undefined' && LCCPlayer.hide) {
      LCCPlayer.hide();
    }

    // 6. 加载新场景
    _loadScene(cfg.lcc2, cfg.path, function() {
      if (typeof LCCUI !== 'undefined') {
        if (LCCUI.markActiveScene)        LCCUI.markActiveScene(cfg.id);
        if (LCCUI.buildSceneMenu)         LCCUI.buildSceneMenu();   // 刷新下拉信息区
      }
    });
  };

  // ===================================================================
  // 轨迹路径加载（每个 scene 各自 path）
  // ===================================================================
  var _cachedPath = null;
  var _cachedPathURL = null;

  function loadTrajectoryPath(callback) {
    var url = window.sceneState.path;
    if (_cachedPath && _cachedPathURL === url) { callback(_cachedPath); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'json';
    xhr.onload = function() {
      if (xhr.status === 200 && xhr.response) {
        _cachedPath = xhr.response;
        _cachedPathURL = url;
        callback(_cachedPath);
      } else {
        console.warn('[Reset] Bad path response:', xhr.status, url);
      }
    };
    xhr.onerror = function() { console.warn('[Reset] Failed to load trajectory path:', url); };
    xhr.send();
  }

  function applyTrajectoryStart(pathData) {
    if (!pathData || pathData.length < 2) return;
    var p0 = pathData[0], p1 = pathData[1];
    if (isNaN(p0.x) || isNaN(p0.y) || isNaN(p0.z)) return;

    var startX = -p0.x, startY = p0.z, startZ = p0.y;
    var lookX = -p1.x, lookZ = p1.y;

    if (typeof CameraState !== 'undefined') {
      CameraState.resetToPosition(startX, startY, startZ, lookX, lookZ);
    } else {
      LCCScene.camera.position.set(startX, startY + 1.7, startZ);
      var lookDir = new THREE.Vector3(lookX - startX, 0, lookZ - startZ).normalize();
      if (lookDir.lengthSq() < 0.0001) lookDir.set(0, 0, -1);
      LCCScene.camera.lookAt(
        new THREE.Vector3(startX, startY + 1.7, startZ).add(lookDir.multiplyScalar(20))
      );
    }
    console.log('[Reset] to trajectory start:', startX.toFixed(1), (startY+1.7).toFixed(1), startZ.toFixed(1));
  }

  window.resetToTrajectoryStart = function() {
    try {
      loadTrajectoryPath(applyTrajectoryStart);
    } catch(e) { console.warn('[Reset] failed:', e); }
  };

  function showFatal(msg) {
    var el = document.getElementById('loading-percent');
    if (el) { el.textContent = msg; el.style.color = '#e74c3c'; }
    console.error('[App] Fatal:', msg);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
