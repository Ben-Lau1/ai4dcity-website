/**
 * InputController.js — 输入控制器
 * 每帧轮询所有输入源，合成 InputSnapshot
 * 各 mode handler 只读 snapshot，不直接读输入
 */
(function() {
  'use strict';

  function InputController() {
    this.snapshot = new InputSnapshot();

    // 鼠标状态
    this.mouseDown = false;
    this.mouseButton = -1;
    this.lastMouse = { x: 0, y: 0 };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;
    this.jumpButtonDown = false;

    // 是否需要初始化 DOM 监听
    this._domReady = false;
  }

  InputController.prototype.initDOM = function(domElement) {
    if (this._domReady) return;
    this._domReady = true;

    var self = this;
    domElement.addEventListener('mousedown', function(e) {
      self.mouseDown = true;
      self.mouseButton = e.button;
      self.lastMouse.x = e.clientX;
      self.lastMouse.y = e.clientY;
    });
    window.addEventListener('mousemove', function(e) {
      self.mouseDeltaX = e.clientX - self.lastMouse.x;
      self.mouseDeltaY = e.clientY - self.lastMouse.y;
      self.lastMouse.x = e.clientX;
      self.lastMouse.y = e.clientY;
    });
    window.addEventListener('mouseup', function() {
      self.mouseDown = false;
      self.mouseButton = -1;
    });
    domElement.addEventListener('wheel', function(e) {
      e.preventDefault();
      self.wheelDelta += e.deltaY;
    }, { passive: false });
    domElement.addEventListener('contextmenu', function(e) { e.preventDefault(); });

    // Mobile jump button. Keep this inside InputController so every mode reads
    // the same per-frame snapshot instead of querying DOM state separately.
    var jumpBtn = document.getElementById('btn-jump');
    if (jumpBtn) {
      var setJump = function(on, e) {
        self.jumpButtonDown = !!on;
        if (e) {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
      };

      jumpBtn.addEventListener('pointerdown', function(e) { setJump(true, e); }, { passive: false });
      jumpBtn.addEventListener('pointerup', function(e) { setJump(false, e); }, { passive: false });
      jumpBtn.addEventListener('pointercancel', function(e) { setJump(false, e); }, { passive: false });
      jumpBtn.addEventListener('pointerleave', function(e) { setJump(false, e); }, { passive: false });

      // iOS fallback for older WebKit builds.
      jumpBtn.addEventListener('touchstart', function(e) { setJump(true, e); }, { passive: false });
      jumpBtn.addEventListener('touchend', function(e) { setJump(false, e); }, { passive: false });
      jumpBtn.addEventListener('touchcancel', function(e) { setJump(false, e); }, { passive: false });
    }
  };

  InputController.prototype.update = function(dt) {
    var s = this.snapshot;
    s.dt = Math.min(dt || 0.016, 0.05);
    s.reset();

    // 设备类型
    s.isTouchDevice = (typeof CameraState !== 'undefined')
      ? CameraState.isTouchDevice() : false;

    // 鼠标增量
    if (this.mouseDown) {
      s.yawDelta = -this.mouseDeltaX * 0.005;
      s.pitchDelta = -this.mouseDeltaY * 0.005;
      s.lookActive = this.mouseButton === 0;
    }
    s.mouseButton = this.mouseButton;
    s.scrollDelta = this.wheelDelta;

    // 每帧重置鼠标增量（已消费）
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;

    // 键盘移动 (WASD)
    if (typeof LCCKeyboard !== 'undefined') {
      var mov = LCCKeyboard.getMovement();
      s.moveX = mov.x;
      s.moveZ = -mov.z;

      s.jump = LCCKeyboard.isJump() || this.jumpButtonDown;
      s.sprint = LCCKeyboard.isShift();
      s.qe = LCCKeyboard.getQE();
      s.rf = LCCKeyboard.getRF();
      s.resetView = LCCKeyboard.isResetView();
    } else {
      s.jump = this.jumpButtonDown;
    }

    // 摇杆移动 (移动端)
    if (s.isTouchDevice && typeof LCCJoystick !== 'undefined') {
      var joy = LCCJoystick.getDirection();
      if (Math.abs(joy.x) > 0.05 || Math.abs(joy.y) > 0.05) {
        s.moveX = joy.x;
        s.moveZ = joy.y;
      }
    }

    // 触控旋转/缩放
    if (typeof LCCTouch !== 'undefined') {
      var touch = LCCTouch.consume();
      if (touch.rotating) {
        s.yawDelta = -touch.dx * (s.isTouchDevice ? 2 : 1);
        s.pitchDelta = -touch.dy;
        s.lookActive = true;
      }
      if (touch.pinching) {
        s.scrollDelta = -touch.zoom;
      }
      // 双击屏幕 = 视角回正（移动端 T 键的替代手势）
      if (touch.doubleTap) {
        s.resetView = true;
      }
    }

    return s;
  };

  InputController.prototype.resetState = function() {
    this.mouseDown = false;
    this.mouseButton = -1;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;
    this.jumpButtonDown = false;
    if (this.snapshot && this.snapshot.reset) this.snapshot.reset();
  };

  window.InputController = InputController;
})();
