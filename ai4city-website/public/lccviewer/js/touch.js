/**
 * touch.js - Mobile Touch Gesture Handler
 * Single finger rotate, double finger pinch-zoom & pan
 * 非移动端不绑定事件，只提供空实现
 *
 * 输出语义：consume() 返回本帧**增量**（dx/dy/zoom），调用后清零。
 * 避免"按住滑动 → 松手再点"时 dx 累积爆炸的问题。
 */
(function() {
  'use strict';

  var isMobileUA = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(navigator.userAgent)
    || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);

  if (!isMobileUA) {
    // PC 端空实现
    window.LCCTouch = {
      consume: function() { return { dx:0, dy:0, zoom:0, rotating:false, pinching:false, doubleTap:false }; },
      isActive: function() { return false; },
    };
    return;
  }

  // ---- 以下只在移动端执行 ----
  const container = document.getElementById('canvas-container');
  const joystickZone = document.getElementById('joystick-zone');
  const btnJump = document.getElementById('btn-jump');
  const TOUCH_EXCLUDE = [joystickZone, btnJump];

  // touches: { [identifier]: { lastX, lastY } }
  let touches = {};
  let activeCount = 0;
  let prevDist = 0;
  let deltaX = 0, deltaY = 0, zoomDelta = 0;
  let isRotating = false, isPinching = false;

  // 灵敏度系数（单帧像素 → 弧度）
  const ROTATE_SENS = 0.005;
  const ZOOM_SENS   = 0.01;

  // 双击检测（视角回正手势）
  let lastTapTime = 0;
  let lastTapX = 0, lastTapY = 0;
  let doubleTap = false;
  const DOUBLE_TAP_INTERVAL = 300;
  const DOUBLE_TAP_MOVE_TOL = 20;

  function isExcluded(el) {
    for (var i = 0; i < TOUCH_EXCLUDE.length; i++) {
      var exc = TOUCH_EXCLUDE[i];
      if (exc && (el === exc || exc.contains(el))) return true;
    }
    return false;
  }

  function getTouchDist() {
    var arr = [];
    for (var k in touches) arr.push(touches[k]);
    if (arr.length < 2) return 0;
    var dx = arr[0].lastX - arr[1].lastX;
    var dy = arr[0].lastY - arr[1].lastY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  container.addEventListener('touchstart', function(e) {
    if (isExcluded(e.target)) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      touches[t.identifier] = { lastX: t.clientX, lastY: t.clientY };
    }
    activeCount = Object.keys(touches).length;
    if (activeCount >= 2) { prevDist = getTouchDist(); isPinching = true; isRotating = false; }
    else { isRotating = true; isPinching = false; }

    // 双击检测：单指、间隔 < 300ms、位移 < 20px
    if (activeCount === 1 && e.touches.length === 1) {
      var t0 = e.touches[0];
      var now = Date.now();
      var dx = t0.clientX - lastTapX;
      var dy = t0.clientY - lastTapY;
      if (now - lastTapTime < DOUBLE_TAP_INTERVAL &&
          Math.sqrt(dx*dx + dy*dy) < DOUBLE_TAP_MOVE_TOL) {
        doubleTap = true;
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapX = t0.clientX;
        lastTapY = t0.clientY;
      }
    }

    e.preventDefault();
  }, { passive: false });

  container.addEventListener('touchmove', function(e) {
    // ★ 单帧增量：每帧用 lastX/lastY 与上次位置求差
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var info = touches[t.identifier];
      if (!info) continue;
      var moveDx = t.clientX - info.lastX;
      var moveDy = t.clientY - info.lastY;
      info.lastX = t.clientX;
      info.lastY = t.clientY;

      if (activeCount >= 2 && isPinching) {
        // 缩放由 dist 统一处理（见下方）
        // 不在单 touch 增量里加
      } else if (activeCount === 1 && isRotating) {
        deltaX += moveDx * ROTATE_SENS;
        deltaY += moveDy * ROTATE_SENS;
      }
    }

    // 双指缩放：用两指距离变化
    if (activeCount >= 2 && isPinching) {
      var dist = getTouchDist();
      if (prevDist > 0 && dist > 0) zoomDelta += (dist - prevDist) * ZOOM_SENS;
      prevDist = dist;
    }
    e.preventDefault();
  }, { passive: false });

  container.addEventListener('touchend', function(e) {
    for (var i = 0; i < e.changedTouches.length; i++) delete touches[e.changedTouches[i].identifier];
    activeCount = Object.keys(touches).length;
    if (activeCount < 2) { isPinching = false; prevDist = 0; }
    if (activeCount === 0) isRotating = false;
  });

  container.addEventListener('touchcancel', function(e) {
    touches = {}; activeCount = 0; isRotating = false; isPinching = false; prevDist = 0;
  });

  window.LCCTouch = {
    consume: function() {
      var result = { dx: deltaX, dy: deltaY, zoom: zoomDelta, rotating: isRotating, pinching: isPinching, doubleTap: doubleTap };
      deltaX = 0; deltaY = 0; zoomDelta = 0; doubleTap = false;
      return result;
    },
    isActive: function() { return isRotating || isPinching; },
  };
})();
