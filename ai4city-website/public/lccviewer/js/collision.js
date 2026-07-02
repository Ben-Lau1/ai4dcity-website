/**
 * collision.js — 碰撞检测（对齐官网 API）
 * LCCObject: intersectsSphere({center, radius, noDelta}) → {hit, delta}
 * LCCObject: intersectsRayFromOrigin({origin, direction, maxDistance}) → {x,y,z} | null
 * LCCObject: intersectsCapsule({start, end, radius}) → {hit, delta}
 */
(function() {
  'use strict';

  var ENABLED = true;
  var obj = null; // LCCObject

  function init() {
    obj = LCCLoader ? LCCLoader.getRenderer() : null;
    if (obj && typeof obj.hasCollision === 'function') {
      try {
        var has = obj.hasCollision();
        if (!has) { console.warn('[Collision] Data not in scene'); ENABLED = false; }
        else { console.log('[Collision] Available'); }
      } catch(e) { console.warn('[Collision] Check failed'); ENABLED = false; }
    } else {
      console.warn('[Collision] hasCollision not found');
      ENABLED = false;
    }
    var cb = document.getElementById('setting-collision');
    if (cb) {
      if (!ENABLED) { cb.checked = false; cb.disabled = true; }
      else ENABLED = cb.checked;
    }
  }

  function setEnabled(on) { ENABLED = on; }
  function isEnabled() { return ENABLED; }

  /**
   * 地面射线检测（从地下向上打，避免命中树冠/枝叶导致"上树"）
   */
  function getGroundHeight(position) {
    if (!ENABLED || !obj || typeof obj.raycastFromOrigin !== 'function') return null;
    try {
      // 从角色下方 1000m 向上射线 → 第一个命中的一定是真实地面，树在更上方不会被首次命中
      var hit = obj.raycastFromOrigin({
        origin: { x: position.x, y: position.y - 1000, z: position.z },
        direction: { x: 0, y: 1, z: 0 },
        maxDistance: 2000,
        radius: 0.5,
      });
      if (hit && typeof hit.x === 'number') {
        return { groundY: hit.y, onGround: (position.y - hit.y) < 0.5 };
      }
    } catch(e) {}
    return null;
  }

  /**
   * 球体碰撞检测（适用于 FPS 相机）
   * @returns {{hit, delta}} | null
   */
  function sphereCheck(center, radius) {
    if (!ENABLED || !obj || typeof obj.intersectsSphere !== 'function') return null;
    radius = radius || 0.3;
    try {
      var result = obj.intersectsSphere({ center: center, radius: radius, noDelta: false });
      if (result && result.hit) return result;
    } catch(e) {}
    return null;
  }

  /**
   * 胶囊碰撞检测（适用于 Avatar 角色）
   * XGRIDS reference: capsule = { start:(0,0.3,0), end:(0,1.35,0), radius:0.5 }
   */
  function capsuleCheck(start, end, radius) {
    if (!ENABLED || !obj || typeof obj.intersectsCapsule !== 'function') return null;
    radius = radius || 0.5;
    try {
      var result = obj.intersectsCapsule({ start: start, end: end, radius: radius });
      if (result && result.hit) return result;
    } catch(e) {}
    return null;
  }

  window.LCCollision = {
    init: init,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    getGroundHeight: getGroundHeight,
    sphereCheck: sphereCheck,
    capsuleCheck: capsuleCheck,
  };
})();
