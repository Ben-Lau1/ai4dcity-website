/**
 * ui.js - UI Manager
 * Toolbar, panels, help overlay, mode switching, loading progress
 *
 * v2026-06-22 fix: 恢复帮助页翻页逻辑（helpCur/helpShowPage/prev/next/close 事件）
 */
(function() {
  'use strict';

  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingBar = document.getElementById('loading-bar');
  const loadingPercent = document.getElementById('loading-percent');
  const helpOverlay = document.getElementById('help-overlay');
  const footer = document.getElementById('footer');

  // ---- Loading Progress ----
  function showLoading() {
    loadingOverlay.classList.remove('hidden');
    updateProgress(0);
  }

  function hideLoading() {
    loadingOverlay.classList.add('hidden');
  }

  function updateProgress(pct) {
    const p = Math.min(100, Math.max(0, pct || 0));
    loadingBar.style.width = p + '%';
    loadingPercent.textContent = Math.round(p) + '%';
  }

  function showError(msg) {
    loadingBar.style.width = '100%';
    loadingBar.style.background = '#e74c3c';
    loadingPercent.textContent = msg || '加载失败';
    loadingPercent.style.color = '#e74c3c';
  }

  // ---- Mode Buttons ----
  document.querySelectorAll('.tb-btn-mode').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const newMode = this.dataset.mode;
      // 通过 LCCamera 切换（CameraState 管理状态）
      if (typeof LCCamera !== 'undefined') {
        LCCamera.switchMode(newMode);
      }

      document.querySelectorAll('.tb-btn-mode').forEach(function(b) {
        b.classList.remove('active');
      });
      this.classList.add('active');

      updateMobileUI(newMode);
    });
  });

  function updateMobileUI(mode) {
    // 摇杆由 joystick.js 自行控制
    // 跳跃按钮仅移动端显示
    var jumpBtn = document.getElementById('btn-jump');
    if (!jumpBtn) return;
    var isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(navigator.userAgent);
    if (isMobile && (mode === 'firstPerson' || mode === 'avatar')) {
      jumpBtn.style.display = 'flex';
    } else {
      jumpBtn.style.display = 'none';
    }
  }

  // Origin reset button
  document.getElementById('btn-origin').addEventListener('click', function() {
    if (typeof resetToTrajectoryStart === 'function') {
      resetToTrajectoryStart();
    }
  });

  // Panel close buttons
  document.querySelectorAll('.panel-close').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var panelId = this.dataset.panel;
      if (panelId === 'settings') settingsPanel.classList.add('hidden');
    });
  });

  /**
   * 更新场景下拉里的"信息"区（仅场景名 + 描述）
   * 由 buildSceneMenu 在打开下拉时调用
   */
  function updateSceneInfoInDropdown() {
    var infoEl = document.getElementById('tb-scene-info');
    if (!infoEl || !window.SCENES) return;
    var sid = window.sceneState ? window.sceneState.currentSceneId : null;
    var cfg = sid && window.SCENES[sid];
    if (!cfg) return;

    infoEl.innerHTML =
      '<div class="tb-scene-info-title">' +
        '<span class="scene-dot"></span>' + cfg.label +
      '</div>' +
      '<div class="tb-scene-info-desc">' + (cfg.description || '') + '</div>';
  }

  // Help overlay — 翻页式（PC 1 页 + 移动端 1 页）
  var helpCur = 1;
  var helpTotal = 2;
  var helpPages = document.querySelectorAll('.help-page');
  var helpCurEl = document.getElementById('help-cur');
  var helpPrev = document.getElementById('help-prev');
  var helpNext = document.getElementById('help-next');
  var helpCloseBtn = document.getElementById('help-close');

  function helpShowPage(n) {
    helpCur = Math.max(1, Math.min(helpTotal, n));
    helpPages.forEach(function(p) {
      p.classList.toggle('hidden', parseInt(p.dataset.page, 10) !== helpCur);
    });
    if (helpCurEl) helpCurEl.textContent = helpCur;
    if (helpPrev) helpPrev.disabled = (helpCur === 1);
    if (helpNext) helpNext.classList.toggle('hidden', helpCur === helpTotal);
    if (helpCloseBtn) helpCloseBtn.classList.toggle('hidden', helpCur !== helpTotal);
  }

  document.getElementById('btn-help').addEventListener('click', function() {
    helpShowPage(1);
    helpOverlay.classList.remove('hidden');
  });
  if (helpPrev) helpPrev.addEventListener('click', function() { helpShowPage(helpCur - 1); });
  if (helpNext) helpNext.addEventListener('click', function() { helpShowPage(helpCur + 1); });
  if (helpCloseBtn) helpCloseBtn.addEventListener('click', function() {
    helpOverlay.classList.add('hidden');
  });
  var helpX = document.getElementById('help-x');
  if (helpX) helpX.addEventListener('click', function() {
    helpOverlay.classList.add('hidden');
  });
  helpOverlay.addEventListener('click', function(e) {
    if (e.target === helpOverlay) helpOverlay.classList.add('hidden');
  });

// Play/Pause button — 轨迹播放（替代原来的角色模型 toggle）
document.getElementById('btn-play').addEventListener('click', function() {
  if (typeof LCCPlayback === 'undefined') return;
  var wasPlaying = LCCPlayback.isPlaying();
  LCCPlayback.toggle();
  var isPlaying = LCCPlayback.isPlaying();
  var icon = document.getElementById('play-icon');
  if (icon) {
    icon.src = isPlaying ? 'icons/img/pause.svg' : 'icons/img/play.svg';
  }
  this.classList.toggle('active', isPlaying);
});

// ===================================================================
// 场景切换菜单（动态从 window.SCENES 读取）
// ===================================================================
function buildSceneMenu() {
  var menu = document.getElementById('tb-scene-menu');
  if (!menu) return;
  menu.innerHTML = '';
  if (!window.SCENES) { console.warn('[UI] SCENES not found'); return; }

  // 上段：场景信息（动态填充）
  var infoBlock = document.createElement('div');
  infoBlock.className = 'tb-scene-info';
  infoBlock.id = 'tb-scene-info';
  menu.appendChild(infoBlock);
  updateSceneInfoInDropdown();

  // 分隔线
  var divider = document.createElement('div');
  divider.className = 'tb-scene-divider';
  menu.appendChild(divider);

  // 下段：场景列表
  var sectionTitle = document.createElement('div');
  sectionTitle.className = 'tb-scene-section-title';
  sectionTitle.textContent = '切换场景';
  menu.appendChild(sectionTitle);

  Object.keys(window.SCENES).forEach(function(id) {
    var cfg = window.SCENES[id];
    var item = document.createElement('button');
    item.className = 'tb-scene-item';
    item.type = 'button';
    item.dataset.scene = id;
    item.innerHTML = '<span class="dot"></span><span class="label">' + cfg.label + '</span>';
    item.addEventListener('click', function(e) {
      e.stopPropagation();
      if (window.sceneState && window.sceneState.loading) return;  // 切换中忽略
      if (typeof window.switchScene === 'function') {
        window.switchScene(id);
      }
      closeSceneMenu();
    });
    menu.appendChild(item);
  });
}

function markActiveScene(sceneId) {
  var menu = document.getElementById('tb-scene-menu');
  if (!menu) return;
  var items = menu.querySelectorAll('.tb-scene-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('active', items[i].dataset.scene === sceneId);
  }
}

function openSceneMenu() {
  var menu = document.getElementById('tb-scene-menu');
  if (menu) menu.classList.add('open');
}
function closeSceneMenu() {
  var menu = document.getElementById('tb-scene-menu');
  if (menu) menu.classList.remove('open');
}
function toggleSceneMenu() {
  var menu = document.getElementById('tb-scene-menu');
  if (menu) menu.classList.toggle('open');
}

// 点击场景按钮：展开/收起
document.getElementById('btn-scene').addEventListener('click', function(e) {
  e.stopPropagation();
  toggleSceneMenu();
});
// 点击其它地方关闭
document.addEventListener('click', function(e) {
  var wrap = document.getElementById('tb-scene-wrap');
  if (wrap && !wrap.contains(e.target)) closeSceneMenu();
});
// ESC 关闭
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeSceneMenu();
});

  // Settings panel
  const settingsPanel = document.getElementById('settings-panel');
  document.getElementById('btn-settings').addEventListener('click', function() {
    settingsPanel.classList.toggle('hidden');
  });

  // Helper: segmented control
  function bindSegment(parentId, callback) {
    const parent = document.getElementById(parentId);
    if (!parent) return;
    parent.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        parent.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        if (callback) callback(this.dataset.value);
      });
    });
  }

  // 环境背景
  bindSegment('setting-env', function(val) {
    console.log('[Settings] background =', val);
    if (typeof LCCScene !== 'undefined' && LCCScene.setBackground) {
      LCCScene.setBackground(val);
    }
  });

  // 渲染质量 (dots) — 调用 LCCLoader.setQualityLevel
  (function() {
    const parent = document.getElementById('setting-quality');
    if (!parent) return;
    parent.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        parent.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        const val = parseInt(this.dataset.value, 10);
        console.log('[Settings] quality =', val);
        if (typeof LCCLoader !== 'undefined' && LCCLoader.setQualityLevel) {
          LCCLoader.setQualityLevel(val);
        }
      });
    });
  })();

  // 单位系统
  bindSegment('setting-unit', function(val) {
    console.log('[Settings] unit =', val);
    window._settingUnit = val;
  });

  // 长度
  bindSegment('setting-length', function(val) {
    console.log('[Settings] length =', val);
    window._settingLength = val;
  });

  // Toggle switches
  document.querySelectorAll('.setting-switch input[type="checkbox"]').forEach(function(sw) {
    sw.addEventListener('change', function() {
      const id = this.id;
      const on = this.checked;
      console.log('[Settings]', id, '=', on);
      // 碰撞检测 — SDK v0.6.1 通过 LCCObject 控制
      // hasCollision 是只读属性，碰撞由 SDK 内部管理
      if (id === 'setting-collision') {
        if (typeof LCCollision !== 'undefined') {
          LCCollision.setEnabled(on);
        }
      }
      if (id === 'setting-trajectory' && typeof LCCRender !== 'undefined' && LCCRender.setTrajectory) {
        LCCRender.setTrajectory(on);
      }
      if (id === 'setting-pro-data' && typeof LCCRender !== 'undefined' && LCCRender.setProData) {
        LCCRender.setProData(on);
      }

    });
  });

  // Update footer（场景状态 / 相机模式 / SDK 版本，周期性刷新）
  var footerSceneEl = document.getElementById('footer-scene-state');
  var footerCamEl   = document.getElementById('footer-camera-mode');
  var footerVerEl   = document.getElementById('footer-version');
  if (footerVerEl && typeof LCCRender !== 'undefined' && LCCRender.getVersion) {
    try { footerVerEl.textContent = LCCRender.getVersion(); } catch(e) {}
  }
  function updateFooter() {
    if (footerSceneEl) {
      var loading = window.sceneState && window.sceneState.loading;
      var loaded  = (typeof LCCLoader !== 'undefined' && LCCLoader.isLoaded());
      footerSceneEl.textContent = loading ? '加载中…' : (loaded ? '已加载' : '未加载');
    }
    if (footerCamEl && typeof CameraState !== 'undefined' && CameraState.getMode) {
      footerCamEl.textContent = CameraState.getMode();
    }
  }
  updateFooter();
  setInterval(updateFooter, 500);  // 每 0.5s 刷新一次（场景状态/相机模式）

  // Initial mobile detection
  updateMobileUI('orbit');

  /**
   * 重置工具栏播放按钮 UI（icon → play.svg, 移除 active）
   * 供 app.js / camera-transition.js 在调 LCCPlayback.pause() 后调用
   */
  function resetPlayButtonUI() {
    var playIcon = document.getElementById('play-icon');
    if (playIcon) playIcon.src = 'icons/img/play.svg';
    var playBtn  = document.getElementById('btn-play');
    if (playBtn)  playBtn.classList.remove('active');
  }

  // Export
  window.LCCUI = {
    showLoading, hideLoading, updateProgress, showError, updateSceneInfoInDropdown,
    buildSceneMenu, markActiveScene, resetPlayButtonUI,
  };

  // 版本号, 控制台可见, 方便调试确认代码版本
  console.log('%c[LCCUI] v2026-06-22-fix help pagination', 'color:#4facfe;font-weight:bold');
})();
