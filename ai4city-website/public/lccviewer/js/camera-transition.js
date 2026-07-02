/**
 * camera-transition.js — 模式切换调度器
 * 只负责：调用 CameraState.switchMode + 管理第三人称模型显隐
 * 相机状态管理完全由 CameraState.js 负责
 */
(function() {
  'use strict';

  var currentMode = 'orbit';

  function switchMode(newMode, onEnd) {
    if (newMode === currentMode) {
      if (onEnd) onEnd();
      return;
    }

    var oldMode = currentMode;

    // ★ 播放中切到第三人称 = 暂停播放（播放和自由观察互斥）
    if (newMode === 'avatar' && typeof LCCPlayback !== 'undefined' && LCCPlayback.isPlaying && LCCPlayback.isPlaying()) {
      LCCPlayback.pause();
      if (typeof LCCUI !== 'undefined' && LCCUI.resetPlayButtonUI) LCCUI.resetPlayButtonUI();
    }

    // ★ 先管理第三人称模型显隐，确保 modelRef 就绪
    //    CameraState.switchMode 需要 modelRef 来计算相机过渡参数
    if (typeof LCCPlayer !== 'undefined') {
      if (oldMode === 'avatar' && newMode !== 'avatar') {
        LCCPlayer.hide();       // 离开第三人称
      } else if (newMode === 'avatar' && oldMode !== 'avatar') {
        if (!LCCPlayer.isLoaded()) LCCPlayer.loadModel();
        else LCCPlayer.show();   // 进入第三人称（会调用 setModelRef）
      }
    }

    // 然后切换 CameraState 模式
    if (typeof CameraState !== 'undefined') {
      CameraState.switchMode(newMode);
    }

    currentMode = newMode;

    if (onEnd) onEnd();
  }

  window.LCCamera = {
    MODES: CameraState.MODES,
    switchMode: switchMode,
    getCurrentMode: function() { return currentMode; },
    isTransitioning: function() { return false; },
    syncMode: function(mode) { currentMode = mode; },
    update: function() {},  // 无过渡动画，空函数
  };
})();
