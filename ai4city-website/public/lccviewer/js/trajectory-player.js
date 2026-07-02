/**
 * trajectory-player.js — 轨迹播放器（简化版：仅第一人称）
 *
 * 功能：点 play 按钮后强制切到第一人称，相机沿轨迹匀速移动。
 * - 视角朝前进方向
 * - 键盘/触控仍可控制左右转头（yaw）
 * - 无小人（确保 hide）
 * - 再点 play 切换为暂停
 * - 到终点自动循环
 *
 * 依赖：CameraState, LCCScene, LCCPlayer (用于强制隐藏小人)
 * 数据源：通过 setPathURL() 注入（由 app.js 的 sceneState.path 提供）
 */
(function() {
  'use strict';

  // ===================================================================
  // 内部状态
  // ===================================================================

  var _path = null;           // [{x, y, z}] — 原始轨迹点（LCC 坐标）
  var _pathURL = null;        // 当前缓存的轨迹 URL
  var _playing = false;       // 是否正在播放
  var _time = 0;              // 当前已播时间（秒）
  var _speed = 1.0;           // 速度倍率

  // 沿路径匀速行走速度（米/秒）
  var WALK_SPEED = 5.0;

  // 路径分段距离缓存（匀速插值用）
  var _segDists = [];
  var _totalDist = 0;
  var _totalTime = 0;

  // 方向插值步长
  var LOOK_AHEAD = 0.02;

  // ===================================================================
  // 加载轨迹数据
  // ===================================================================

  function loadPath(callback) {
    if (!_pathURL) {
      console.warn('[Playback] No pathURL set. Call setPathURL() first.');
      return;
    }
    if (_path) { if (callback) callback(_path); return; }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', _pathURL);
    xhr.responseType = 'json';
    xhr.onload = function() {
      if (xhr.status === 200 && xhr.response && xhr.response.length > 1) {
        _path = _buildCache(xhr.response);
        console.log('[Playback] Path loaded (' + _pathURL + '): ' + _path.length + ' points, ' +
          _totalDist.toFixed(0) + 'm, ~' + _totalTime.toFixed(0) + 's');
        if (callback) callback(_path);
      } else {
        console.warn('[Playback] Failed to load path:', xhr.status, _pathURL);
      }
    };
    xhr.onerror = function() {
      console.warn('[Playback] Failed to load trajectory path:', _pathURL);
    };
    xhr.send();
  }

  /**
   * 注入轨迹 URL（场景切换时由 app.js 调用）
   * 清掉旧缓存，下次 play() 重新加载新 URL 的 path
   */
  function setPathURL(url) {
    if (_pathURL === url) return;
    _pathURL = url;
    _path = null;
    _time = 0;
    console.log('[Playback] PathURL set:', url);
  }

  /**
   * 清缓存（场景切换时由 app.js 调用）
   */
  function clearCache() {
    _path = null;
    _time = 0;
  }

  function _buildCache(path) {
    _segDists = [];
    _totalDist = 0;
    for (var i = 1; i < path.length; i++) {
      var dx = path[i].x - path[i - 1].x;
      var dy = path[i].y - path[i - 1].y;
      var dz = path[i].z - path[i - 1].z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      _segDists.push(d);
      _totalDist += d;
    }
    _totalTime = _totalDist / WALK_SPEED;
    return path;
  }

  // ===================================================================
  // 轨迹插值（匀速沿路径）
  // ===================================================================

  function _getInterpolated(t) {
    t = Math.max(0, Math.min(1, t));

    if (t >= 1) {
      var last = _path[_path.length - 1];
      var prev = _path[_path.length - 2];
      return {
        x: last.x, y: last.y, z: last.z,
        dx: last.x - prev.x, dy: last.y - prev.y, dz: last.z - prev.z,
      };
    }

    var targetDist = t * _totalDist;
    var accum = 0;
    for (var i = 0; i < _segDists.length; i++) {
      if (accum + _segDists[i] >= targetDist || i === _segDists.length - 1) {
        var segT = _segDists[i] > 0
          ? (targetDist - accum) / _segDists[i]
          : 0;
        var p0 = _path[i];
        var p1 = _path[i + 1];
        return {
          x: p0.x + (p1.x - p0.x) * segT,
          y: p0.y + (p1.y - p0.y) * segT,
          z: p0.z + (p1.z - p0.z) * segT,
          dx: p1.x - p0.x, dy: p1.y - p0.y, dz: p1.z - p0.z,
        };
      }
      accum += _segDists[i];
    }
    return { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
  }

  // LCC 坐标 → Three.js 坐标
  // JSON {x, y, z} → Three.js {-x, z, y}
  function _toThree(p) { return { x: -p.x, y: p.z, z: p.y }; }

  // ===================================================================
  // 播放控制
  // ===================================================================

  function play() {
    if (!_path) {
      loadPath(_doPlay);
      return;
    }
    _doPlay();
  }

  function _doPlay() {
    if (_time >= _totalTime) _time = 0;
    _playing = true;

    // 强制切到第一人称
    if (typeof LCCamera !== 'undefined' && LCCamera.switchMode) {
      LCCamera.switchMode('firstPerson');
    }
    // 同步 UI 按钮高亮
    document.querySelectorAll('.tb-btn-mode').forEach(function(b) {
      b.classList.toggle('active', b.dataset.mode === 'firstPerson');
    });

    // 隐藏小人
    if (typeof LCCPlayer !== 'undefined') {
      LCCPlayer.hide();
    }

    // 锁 fp 输入（播放时相机方向由播放器控制）
    if (typeof CameraState !== 'undefined' && CameraState.setPlaybackLock) {
      CameraState.setPlaybackLock(true);
    }

    console.log('[Playback] ▶ Play started');
  }

  function pause() {
    _playing = false;

    // 解锁 fp 输入
    if (typeof CameraState !== 'undefined' && CameraState.setPlaybackLock) {
      CameraState.setPlaybackLock(false);
    }

    // ★ 只固化位置和 yaw/pitch（不调 lookAt，避免低头）
    if (typeof LCCScene !== 'undefined' && LCCScene.camera && typeof CameraState !== 'undefined') {
      var cam = LCCScene.camera;
      var euler = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
      if (CameraState.syncFPPositionOnly) {
        CameraState.syncFPPositionOnly(cam.position.x, cam.position.y, cam.position.z, euler.y, euler.x);
      }
    }

    // 调试日志
    if (typeof LCCScene !== 'undefined' && LCCScene.camera) {
      var cam2 = LCCScene.camera;
      console.log('[Playback] ⏸ Paused. cam.pos:', cam2.position.x.toFixed(1), cam2.position.y.toFixed(1), cam2.position.z.toFixed(1),
        '| _fp.pos:', CameraState && CameraState.dump && JSON.stringify(CameraState.dump().fp.position));
    }
    console.log('[Playback] ⏸ Paused at ' + _time.toFixed(1) + 's');
  }

  function toggle() {
    if (_playing) { pause(); }
    else { play(); }
  }

  function isPlaying() { return _playing; }

  // ===================================================================
  // 每帧更新（由 scene.js 在 CameraState.animate 之后调用）
  // ===================================================================

  function update(dt) {
    if (!_playing || !_path || _totalTime <= 0) return;

    // 推进时间
    _time += dt * _speed;
    if (_time >= _totalTime) _time = 0;  // 循环

    var t = _time / _totalTime;
    var cur = _getInterpolated(t);
    var next = _getInterpolated(Math.min(1, t + LOOK_AHEAD));

    var tc = _toThree(cur);
    var tn = _toThree(next);

    // ★ 把相机放到路径上 + 看向前方（用 lookAt 算出 yaw/pitch，避免低头看 y=-5）
    var camera = LCCScene.camera;
    var eyeY = tc.y + 1.7;  // EYE_HEIGHT
    camera.position.set(tc.x, eyeY, tc.z);
    camera.lookAt(tn.x, tn.y + 1.5, tn.z);

    // 提取当前 camera 实际方向，写到 _fp（不调 resetToPosition 避免它内部 y=-5 改低头）
    if (typeof CameraState !== 'undefined' && CameraState.syncFPPositionOnly) {
      var eu = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      CameraState.syncFPPositionOnly(camera.position.x, camera.position.y, camera.position.z, eu.y, eu.x);
    }

    // DEBUG: 每秒记录一次
    if (Math.floor(_time) !== Math.floor(_time - dt * _speed)) {
      console.log('[Playback] tick t=' + _time.toFixed(2) + 's, cam=(' +
        camera.position.x.toFixed(1) + ',' + camera.position.y.toFixed(1) + ',' + camera.position.z.toFixed(1) + ')');
    }
  }

  // ===================================================================
  // Export
  // ===================================================================

  window.LCCPlayback = {
    toggle: toggle,
    play: play,
    pause: pause,
    isPlaying: isPlaying,
    update: update,
    setSpeed: function(s) { _speed = Math.max(0.1, Math.min(10, s)); },
    getSpeed: function() { return _speed; },
    getProgress: function() { return _totalTime > 0 ? _time / _totalTime : 0; },
    getTime: function() { return _time; },
    getTotalTime: function() { return _totalTime; },
    getTotalDist: function() { return _totalDist; },
    loadPath: loadPath,
    setPathURL: setPathURL,
    clearCache: clearCache,
    getPathURL: function() { return _pathURL; },
  };
})();
