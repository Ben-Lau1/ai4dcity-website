/**
 * keyboard.js - PC Keyboard State Manager
 * Tracks key press state, used by controls
 */
(function() {
  'use strict';

  const keys = {};
  let shiftDown = false;

  const ACTION_KEYS = [
    'KeyW', 'KeyA', 'KeyS', 'KeyD',   // movement
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', // arrows
    'KeyQ', 'KeyE',                     // Q/E 转头
    'KeyT',                             // T 视角回正
    'Space',                            // jump
    'ShiftLeft', 'ShiftRight',          // sprint
  ];

  function onKeyDown(e) {
    // Prevent browser default for game keys (before repeat check!)
    if (ACTION_KEYS.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftDown = true;
  }

  function onKeyUp(e) {
    keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftDown = false;
  }

  // 阻止 keypress 事件（某些浏览器/扩展通过 keypress 触发输入法）
  window.addEventListener('keypress', function(e) {
    if (ACTION_KEYS.includes(e.code)) e.preventDefault();
  });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Reset on window blur
  window.addEventListener('blur', function() {
    for (const k in keys) keys[k] = false;
    shiftDown = false;
  });

  window.LCCKeyboard = {
    isDown: function(code) { return !!keys[code]; },
    isShift: function() { return shiftDown; },
    /**
     * Returns movement vector in camera-local space
     * @returns {{x:number, y:number, z:number}}
     */
    getMovement: function() {
      let x=0, y=0, z=0;
      if (keys['KeyW'] || keys['ArrowUp']) z -= 1;
      if (keys['KeyS'] || keys['ArrowDown']) z += 1;
      if (keys['KeyA'] || keys['ArrowLeft']) x -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) x += 1;
      const len = Math.sqrt(x*x + z*z);
      if (len > 0) { x /= len; z /= len; }
      return { x, y: 0, z };
    },
    // Q/E 返回偏航角变化：-1=右转, 0=无, 1=左转
    getQE: function() {
      if (keys['KeyQ']) return 1;
      if (keys['KeyE']) return -1;
      return 0;
    },
    // R/F 返回俯仰角变化：-1=抬头, 0=无, 1=低头
    getRF: function() {
      if (keys['KeyR']) return 1;
      if (keys['KeyF']) return -1;
      return 0;
    },
    isJump: function() { return !!keys['Space']; },
    isResetView: function() { return !!keys['KeyT']; },
  };
})();
