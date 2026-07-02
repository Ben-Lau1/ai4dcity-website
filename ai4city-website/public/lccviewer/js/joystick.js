/**
 * joystick.js - Virtual Joystick for Mobile
 * 首次触控才显示，锚点位于触摸位置
 */
(function() {
  'use strict';

  const zone = document.getElementById('joystick-zone');
  const base = document.getElementById('joystick-base');
  const thumb = document.getElementById('joystick-thumb');
  const container = document.getElementById('canvas-container');
  const btnJump = document.getElementById('btn-jump');

  let active = false;
  let visible = false;
  let touchId = null;
  let centerX = 0, centerY = 0;
  let maxRadius = 60;   // 摇杆半径 px
  let dx = 0, dy = 0;
  // 摇杆尺寸（在 zone 隐藏时无法 getBoundingClientRect）
  const ZONE_SIZE = 140;  // 与 CSS 20vmin ≈ 140px 一致

  function findTouch(e) {
    return Array.from(e.changedTouches || []).find(function(t) { return t.identifier === touchId; }) || null;
  }

  function ownsChangedTouch(e) {
    return !!findTouch(e);
  }

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function isJumpTarget(el) {
    return btnJump && (el === btnJump || btnJump.contains(el));
  }

  function showAt(x, y) {
    if (!zone) return;
    // 锚点 = 触控位置，摇杆居中于锚点
    zone.style.display = 'block';
    zone.style.left = (x - ZONE_SIZE / 2) + 'px';
    zone.style.top = (y - ZONE_SIZE / 2) + 'px';
    zone.style.bottom = 'auto';
    zone.style.position = 'fixed';
    centerX = x;
    centerY = y;
    maxRadius = ZONE_SIZE / 2;
    visible = true;
  }

  function hide() {
    if (!zone) return;
    zone.style.display = 'none';
    visible = false;
    active = false;
    touchId = null;
    dx = 0; dy = 0;
    if (thumb) {
      thumb.style.transform = 'translate(-50%, -50%)';
      thumb.classList.remove('active');
    }
  }

  function beginTouch(e) {
    if (active || isJumpTarget(e.target)) return;
    var t = Array.from(e.changedTouches || []).find(function(item) {
      // Left half is movement; right half remains available for camera look.
      return item.clientX <= window.innerWidth * 0.5;
    });
    if (!t) return;
    showAt(t.clientX, t.clientY);
    touchId = t.identifier;
    active = true;
    if (thumb) thumb.classList.add('active');
    moveThumb({ x: t.clientX, y: t.clientY });
    stop(e);
  }

  function onTouchMove(e) {
    if (!active) return;
    var t = findTouch(e);
    if (!t) return;
    moveThumb({ x: t.clientX, y: t.clientY });
    stop(e);
  }

  function onTouchEnd(e) {
    if (!active && !visible) return;
    if (!ownsChangedTouch(e)) return;
    active = false;
    touchId = null;
    dx = 0; dy = 0;
    if (thumb) {
      thumb.style.transform = 'translate(-50%, -50%)';
      thumb.classList.remove('active');
    }
    stop(e);
  }

  function moveThumb(pos) {
    var rx = pos.x - centerX;
    var ry = pos.y - centerY;
    var dist = Math.sqrt(rx*rx + ry*ry);
    if (dist > maxRadius) {
      rx = rx / dist * maxRadius;
      ry = ry / dist * maxRadius;
    }
    thumb.style.transform = 'translate(calc(-50% + ' + rx + 'px), calc(-50% + ' + ry + 'px))';
    dx = rx / maxRadius;
    dy = ry / maxRadius;
  }

  // 初始隐藏
  hide();

  // 只在移动/粗指针设备下绑定触控
  var isUA = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(navigator.userAgent)
    || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);

  if (isUA) {
    if (container) {
      container.addEventListener('touchstart', beginTouch, { passive: false });
      container.addEventListener('touchmove',  onTouchMove, { passive: false });
      container.addEventListener('touchend',   onTouchEnd, { passive: false });
      container.addEventListener('touchcancel', onTouchEnd, { passive: false });
    }
  }

  window.LCCJoystick = {
    getDirection: function() {
      if (!active) return { x: 0, y: 0 };
      return { x: dx, y: -dy };
    },
    isActive: function() { return active; },
    isVisible: function() { return visible; },
    // 外部可调用 reset 隐藏摇杆
    reset: function() { hide(); },
  };
})();
