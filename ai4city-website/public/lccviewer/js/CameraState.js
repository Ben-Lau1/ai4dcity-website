/**
 * CameraState.js — 相机状态中央引擎
 *
 * 借鉴 LCCViewer Cesium 版 MapState 架构：
 * 1. 每种模式有独立的状态槽，切换模式不丢状态
 * 2. 控制层只写状态，不碰相机
 * 3. animate() 是唯一写相机的地方
 * 4. 单向数据流：InputSnapshot → CameraState → camera
 *
 * 三种模式：
 * - orbit:       环绕观察，鼠标旋转/缩放/右键平移
 * - firstPerson: 第一人称漫游，WASD 移动，鼠标视角
 * - avatar:      第三人称跟随，键盘控制模型，相机环绕
 */

(function() {
  'use strict';

  const MODES = { ORBIT: 'orbit', FIRST_PERSON: 'firstPerson', AVATAR: 'avatar' };

  let camera = null;
  let activeMode = MODES.ORBIT;

  // ---- 临时向量（复用，避免每帧 new）----
  const _d  = new THREE.Vector3();  // direction / general
  const _r  = new THREE.Vector3();  // right
  const _u  = new THREE.Vector3();  // up
  const _t  = new THREE.Vector3();  // temp
  const _q  = new THREE.Quaternion();
  const _e  = new THREE.Euler();

  // ===================================================================
  // Per-Mode State Slots（切换模式时保留）
  // ===================================================================

  const _orbit = {
    target:    new THREE.Vector3(),
    spherical: new THREE.Spherical(),
    yaw:       0,               // 平滑 yaw
    pitch:     Math.PI / 3,     // 平滑 pitch
    minDist:   0.5,
    maxDist:   500,
  };

  const _fp = {
    position:        new THREE.Vector3(),
    velocity:        new THREE.Vector3(),
    yaw:             0,
    pitch:           -0.09,
    groundLevel:     0,
    jumpVelocity:    0,
    hasMoveInput:    false,
    baseSpeed:       8,
    sprintMultiplier: 3,
    damping:         0.85,
  };
  const GRAVITY       = 15;
  const JUMP_FORCE    = 6;
  const EYE_HEIGHT    = 1.7;
  const FP_STEPS      = 2;    // 碰撞多步物理步数
  const ORBIT_MAX_PITCH = Math.PI * 0.48;
  const AVATAR_MIN_PITCH = -0.25;
  const AVATAR_MAX_PITCH = 0.85;
  const FP_GROUND_PROBE_MOVE_INTERVAL = 0.08;
  const FP_GROUND_PROBE_IDLE_INTERVAL = 0.25;
  const FP_GROUND_PROBE_MOVE_DIST_SQ = 0.25;

  let _fpGroundProbeTimer = 0;
  let _fpGroundProbeX = Infinity;
  let _fpGroundProbeZ = Infinity;

  const _avatar = {
    camYaw:    Math.PI,     // 默认相机在模型背后（+Z 方向，GLB 模型 +Z 是前方）
    camPitch:  0,           // 平视（pitch > 0 抬高俯视，pitch < 0 降低仰视）
    camDist:   4,           // 相机距离模型 4 米
    camHeight: 1.5,         // 相机基础高度（看向模型 1.65m 身高时 1.5m 比较舒服）
    camSmooth: 0.18,        // 跟随平滑系数（0.18 ≈ 每帧 18% 接近目标）
    modelRef:  null,
    initialized: false,
    pendingPlace: null,
  };

  // ===================================================================
  // Init
  // ===================================================================

  function init(cam, dom) {
    camera = cam;

    // 从当前相机初始化所有模式状态
    _d.copy(camera.position).sub(_orbit.target);
    _orbit.spherical.setFromVector3(_d);
    _orbit.yaw   = _orbit.spherical.theta;
    _orbit.pitch = _orbit.spherical.phi;

    _fp.position.copy(camera.position);
    _e.setFromQuaternion(camera.quaternion, 'YXZ');
    _fp.yaw   = _e.y;
    _fp.pitch = _e.x;

    if (dom) {
      dom.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    }
  }

  // ===================================================================
  // Mode Switching
  // ===================================================================

  function switchMode(newMode) {
    if (newMode === activeMode) return;

    if (!camera) { activeMode = newMode; return; }

    if (newMode === MODES.ORBIT) {
      // 从当前相机推算 pivot（视野前方 5 米）
      camera.getWorldDirection(_d);
      _orbit.target.copy(camera.position).addScaledVector(_d, 5);
      _t.copy(camera.position).sub(_orbit.target);
      _orbit.spherical.setFromVector3(_t);
      _orbit.yaw   = _orbit.spherical.theta;
      _orbit.pitch = _orbit.spherical.phi;

    } else if (newMode === MODES.FIRST_PERSON) {
      _fp.position.copy(camera.position);
      _fp.velocity.set(0, 0, 0);
      _fp.jumpVelocity = 0;
      _fp.groundLevel  = _fp.position.y - EYE_HEIGHT;
      _fpGroundProbeTimer = 0;
      _fpGroundProbeX = Infinity;
      _fpGroundProbeZ = Infinity;
      _e.setFromQuaternion(camera.quaternion, 'YXZ');
      _fp.yaw   = _e.y;
      _fp.pitch = _e.x;

    } else if (newMode === MODES.AVATAR) {
      // ★ 相机位置固定，根据相机朝向往前 5 米放小人
      camera.getWorldDirection(_d);
      _d.y = 0;
      _d.normalize();
      var px = camera.position.x + _d.x * 5;
      var py = _fp.groundLevel + 0.05;
      var pz = camera.position.z + _d.z * 5;
      var cy = Math.atan2(_d.x, -_d.z);
      _avatar.pendingPlace = { x: px, y: py, z: pz, camYaw: cy, camPitch: 0 };

      if (_avatar.modelRef) {
        // modelRef 已就绪，直接放置
        _avatar.modelRef.position.set(px, py, pz);
        _avatar.camYaw   = cy;
        _avatar.camPitch  = 0;
        _avatar.initialized = true;
        _avatar.pendingPlace = null;
      }
    }

    activeMode = newMode;
  }

  function getMode() { return activeMode; }

  // ===================================================================
  // Input Processing（每帧在 animate 之前调用）
  // ===================================================================

  // 轨迹播放锁：播放时禁用 _inputFP 的 yaw/pitch 修改（保留 _fp 输入以便暂停后继续）
  var _playbackLock = false;
  function setPlaybackLock(on) { _playbackLock = !!on; }

  function processInput(snapshot) {
    if (!snapshot || !camera) return;

    // T 键重置视角（所有模式通用）
    if (snapshot.resetView) {
      if (activeMode === MODES.AVATAR) {
        _avatar.camYaw   = Math.PI;
        _avatar.camPitch  = 0;
      } else if (typeof window.resetToTrajectoryStart === 'function') {
        window.resetToTrajectoryStart();
      }
      return;
    }

    // ★ 播放期间不更新 fp.yaw/pitch（轨迹 player 自己写相机方向）
    if (_playbackLock && activeMode === MODES.FIRST_PERSON) {
      // 但仍允许 WASD（移动）走 _inputFP 的速度累积？
      // 简化：播放时完全忽略输入（暂停后恢复手动控制）
      return;
    }

    switch (activeMode) {
      case MODES.ORBIT:       _inputOrbit(snapshot); break;
      case MODES.FIRST_PERSON: _inputFP(snapshot);    break;
      case MODES.AVATAR:      _inputAvatar(snapshot); break;
    }
  }

  // ---- Orbit Input ----
  function _inputOrbit(snap) {
    // 左键/触控旋转
    if (snap.lookActive && (Math.abs(snap.yawDelta) > 0.0001 || Math.abs(snap.pitchDelta) > 0.0001)) {
      _orbit.yaw   += snap.yawDelta;
      _orbit.pitch += snap.pitchDelta;
      _orbit.pitch = Math.max(0.05, Math.min(ORBIT_MAX_PITCH, _orbit.pitch));
    }

    // 右键平移
    if (snap.mouseButton === 2 && (Math.abs(snap.yawDelta) > 0.0001 || Math.abs(snap.pitchDelta) > 0.0001)) {
      const panSpeed = _orbit.spherical.radius * 0.001;
      camera.getWorldDirection(_d);                      // _d = forward
      _r.crossVectors(camera.up, _d).normalize();        // _r = right (up × forward)
      _u.crossVectors(_r, _d).normalize();               // _u = up (right × forward)
      _orbit.target.addScaledVector(_r, -snap.yawDelta * 200 * panSpeed);
      _orbit.target.addScaledVector(_u,  snap.pitchDelta * 200 * panSpeed);
    }

    // 滚轮缩放
    if (Math.abs(snap.scrollDelta) > 0) {
      _orbit.spherical.radius += snap.scrollDelta * 0.01;
      _orbit.spherical.radius = Math.max(_orbit.minDist, Math.min(_orbit.maxDist, _orbit.spherical.radius));
    }

    // 键盘/摇杆平移自由视角。保持当前观察角度，只整体移动 orbit target。
    if (Math.abs(snap.moveX) > 0.01 || Math.abs(snap.moveZ) > 0.01) {
      camera.getWorldDirection(_d);
      _d.y = 0;
      if (_d.lengthSq() < 0.0001) _d.set(0, 0, -1);
      else _d.normalize();

      _r.set(-_d.z, 0, _d.x).normalize();
      const moveSpeed = Math.max(5, _orbit.spherical.radius * 0.8);
      _orbit.target.addScaledVector(_r, snap.moveX * moveSpeed * snap.dt);
      _orbit.target.addScaledVector(_d, snap.moveZ * moveSpeed * snap.dt);
    }
  }

  // ---- FirstPerson Input ----
  function _inputFP(snap) {
    // 鼠标/触控视角旋转
    if (snap.lookActive && (Math.abs(snap.yawDelta) > 0.0001 || Math.abs(snap.pitchDelta) > 0.0001)) {
      _fp.yaw   += snap.yawDelta * 0.4;
      _fp.pitch += snap.pitchDelta * 0.4;
      _fp.pitch  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, _fp.pitch));
    }

    // Q/E 水平旋转，R/F 垂直旋转
    if (snap.qe !== 0) _fp.yaw += snap.qe * 2.5 * snap.dt;
    if (snap.rf !== 0) {
      _fp.pitch += snap.rf * 2.5 * snap.dt;
      _fp.pitch  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, _fp.pitch));
    }

    // WASD → 速度累积（方向基于 yaw）
    const sprint = snap.sprint ? _fp.sprintMultiplier : 1;
    const speed  = _fp.baseSpeed * sprint;

    // forward = -Z 绕 Y 轴旋转 yaw；right = +X 绕 Y 轴旋转 yaw
    _q.setFromEuler(_e.set(0, _fp.yaw, 0));
    _d.set(0, 0, -1).applyQuaternion(_q);
    _r.set(1, 0, 0).applyQuaternion(_q);

    // 直接使用目标速度。原来的加速度式累积会被每帧阻尼压得很慢。
    _fp.hasMoveInput = Math.abs(snap.moveX) > 0.01 || Math.abs(snap.moveZ) > 0.01;
    if (_fp.hasMoveInput) {
      _fp.velocity.x = (_d.x * snap.moveZ + _r.x * snap.moveX) * speed;
      _fp.velocity.z = (_d.z * snap.moveZ + _r.z * snap.moveX) * speed;
    }

    // 跳跃
    if (snap.jump && _fp.position.y <= _fp.groundLevel + EYE_HEIGHT) {
      _fp.jumpVelocity = JUMP_FORCE;
    }
  }

  // ---- Avatar Input ----
  function _inputAvatar(snap) {
    // 与 fp 模式相同的 0.4 系数（InputController 已经按设备缩放过）
    if (snap.lookActive && (Math.abs(snap.yawDelta) > 0.0001 || Math.abs(snap.pitchDelta) > 0.0001)) {
      _avatar.camYaw   += snap.yawDelta * 0.4;
      _avatar.camPitch += snap.pitchDelta * 0.4;
      _avatar.camPitch  = Math.max(AVATAR_MIN_PITCH, Math.min(AVATAR_MAX_PITCH, _avatar.camPitch));
    }

    if (snap.qe !== 0) _avatar.camYaw -= snap.qe * 2.5 * snap.dt;
    if (snap.rf !== 0) {
      _avatar.camPitch += snap.rf * 1.0 * snap.dt;
      _avatar.camPitch  = Math.max(AVATAR_MIN_PITCH, Math.min(AVATAR_MAX_PITCH, _avatar.camPitch));
    }
  }

  // ===================================================================
  // Animate（唯一写相机的地方）
  // ===================================================================

  function animate(dt) {
    if (!camera) return;
    dt = Math.min(dt || 0.016, 0.1);

    switch (activeMode) {
      case MODES.ORBIT:       _animOrbit(); break;
      case MODES.FIRST_PERSON: _animFP(dt);  break;
      case MODES.AVATAR:      _animAvatar(); break;
    }
  }

  function _animOrbit() {
    _orbit.spherical.theta = _orbit.yaw;
    _orbit.spherical.phi   = _orbit.pitch;
    camera.position.copy(_orbit.target).add(_d.setFromSpherical(_orbit.spherical));
    camera.lookAt(_orbit.target);
  }

  function _animFP(dt) {
    // ---- 垂直物理 ----
    if (_fp.jumpVelocity !== 0 || _fp.position.y > _fp.groundLevel + EYE_HEIGHT) {
      _fp.jumpVelocity -= GRAVITY * dt;
      _fp.position.y   += _fp.jumpVelocity * dt;
      if (_fp.position.y <= _fp.groundLevel + EYE_HEIGHT) {
        _fp.position.y   = _fp.groundLevel + EYE_HEIGHT;
        _fp.jumpVelocity = 0;
      }
    } else {
      _fp.position.y = _fp.groundLevel + EYE_HEIGHT;
    }

    // ---- 水平移动 + 碰撞检测（多步物理，参考 XGRIDS 模式）----
    const hasColl = (typeof LCCollision !== 'undefined' && LCCollision.isEnabled());
    const movingHoriz = Math.abs(_fp.velocity.x) > 0.001 || Math.abs(_fp.velocity.z) > 0.001;
    const steps   = hasColl && movingHoriz ? FP_STEPS : 1;
    const stepDt  = dt / steps;

    for (let s = 0; s < steps; s++) {
      let mx = _fp.velocity.x * stepDt;
      let mz = _fp.velocity.z * stepDt;

      if (hasColl && movingHoriz) {
        const cr      = 0.3;
        // XGRIDS: physicsBody.center = camera.position + moveDelta
        const testPos = { x: _fp.position.x + mx, y: _fp.position.y, z: _fp.position.z + mz };
        const result  = LCCollision.sphereCheck(testPos, cr);
        if (result && result.hit && result.delta) {
          // XGRIDS: apply all 3 axes of delta push-out
          mx += result.delta.x || 0;
          mz += result.delta.z || 0;
          _fp.position.y += result.delta.y || 0;
        }
      }

      _fp.position.x += mx;
      _fp.position.z += mz;
    }

    // 松开移动键后再做阻尼。按住移动时保持目标速度，避免实际速度过低。
    if (!_fp.hasMoveInput) {
      const damp = Math.max(0, 1 - _fp.damping * dt * 8);
      _fp.velocity.x *= damp;
      _fp.velocity.z *= damp;
    }

    // ---- 地面检测 ----
    if (hasColl) {
      _fpGroundProbeTimer -= dt;
      const probeDx = _fp.position.x - _fpGroundProbeX;
      const probeDz = _fp.position.z - _fpGroundProbeZ;
      const probeMovedSq = probeDx * probeDx + probeDz * probeDz;
      const shouldProbeGround =
        _fpGroundProbeTimer <= 0 ||
        probeMovedSq > FP_GROUND_PROBE_MOVE_DIST_SQ ||
        _fp.jumpVelocity !== 0;

      if (shouldProbeGround) {

      const gh = LCCollision.getGroundHeight({
        x: _fp.position.x, y: _fp.position.y, z: _fp.position.z
      });
      if (gh && typeof gh.groundY === 'number') {
        const targetY = gh.groundY + EYE_HEIGHT;
        _fp.groundLevel = gh.groundY;
        _fpGroundProbeX = _fp.position.x;
        _fpGroundProbeZ = _fp.position.z;
        if (_fp.position.y < targetY) {
          _fp.position.y = targetY;
          _fp.jumpVelocity = 0;
        }
      } else {
        const fallbackY = _fp.groundLevel + EYE_HEIGHT;
        if (_fp.position.y < fallbackY) {
          _fp.position.y = fallbackY;
          _fp.jumpVelocity = 0;
        }
      }
      _fpGroundProbeTimer = movingHoriz ? FP_GROUND_PROBE_MOVE_INTERVAL : FP_GROUND_PROBE_IDLE_INTERVAL;
      }

      const cachedTargetY = _fp.groundLevel + EYE_HEIGHT;
      if (_fp.position.y < cachedTargetY) {
        _fp.position.y = cachedTargetY;
        _fp.jumpVelocity = 0;
      }
    } else {
      const targetY = _fp.groundLevel + EYE_HEIGHT;
      if (_fp.position.y < targetY) {
        _fp.position.y = targetY;
        _fp.jumpVelocity = 0;
      }
    }

    // ---- 写相机 ----
    camera.position.copy(_fp.position);
    camera.quaternion.setFromEuler(_e.set(_fp.pitch, _fp.yaw, 0, 'YXZ'));
  }

  function _animAvatar() {
    if (!_avatar.modelRef) return;

    const mp = _avatar.modelRef.position;
    const mh = _avatar.modelRef.height || 1.65;

    // ★ 相机位置：模型背后 camDist 米，高度 camHeight + pitch 调整
    //   pitch > 0 → 相机抬高（俯视）
    //   pitch < 0 → 相机降低（仰视）
    const bx = -Math.sin(_avatar.camYaw) * _avatar.camDist;
    const by = Math.max(0.9, _avatar.camHeight + _avatar.camPitch * 2);
    const bz =  Math.cos(_avatar.camYaw) * _avatar.camDist;

    _d.set(mp.x + bx, mp.y + by, mp.z + bz);
    camera.position.lerp(_d, _avatar.camSmooth);

    // ★ 看向模型身体中部（不是头顶），避免相机低时看不到人
    _u.set(mp.x, mp.y + mh * 0.5, mp.z);
    // 用 lookAt 硬切（lerp 位置已让相机稳定，不再需要 slerp 抖）
    camera.lookAt(_u);
  }

  // ===================================================================
  // External API
  // ===================================================================

  /** 重置到轨迹起点（同步所有模式状态） */
  function resetToPosition(x, y, z, lookX, lookZ) {
    if (!camera) return;

    // 直接写相机
    camera.position.set(x, y + EYE_HEIGHT, z);
    _d.set(lookX - x, 0, lookZ - z).normalize();
    if (_d.lengthSq() < 0.0001) _d.set(0, 0, -1);
    _t.copy(camera.position).addScaledVector(_d, 20);
    camera.lookAt(_t);

    // 同步 fp state
    _fp.position.set(x, y + EYE_HEIGHT, z);
    _fp.groundLevel  = y;
    _fp.velocity.set(0, 0, 0);
    _fp.jumpVelocity = 0;
    _fpGroundProbeTimer = 0;
    _fpGroundProbeX = Infinity;
    _fpGroundProbeZ = Infinity;
    _e.setFromQuaternion(camera.quaternion, 'YXZ');
    _fp.yaw   = _e.y;
    _fp.pitch = _e.x;

    // 同步 orbit state
    _orbit.target.set(x, y, z);
    _d.copy(camera.position).sub(_orbit.target);
    _orbit.spherical.setFromVector3(_d);
    _orbit.yaw   = _orbit.spherical.theta;
    _orbit.pitch = _orbit.spherical.phi;
  }

  function setOrbitTarget(pos)   { _orbit.target.copy(pos); }
  function setGroundLevel(y)     { _fp.groundLevel = y; }
  function getGroundLevel()      { return _fp.groundLevel; }
  function getPosition()         { return camera ? camera.position.clone() : new THREE.Vector3(); }
  function getFPPosition()       { return _fp.position.clone(); }

  /** 获取 fp 模式用户当前累积的 yaw/pitch（轨迹播放时叠加转头偏移） */
  function getFPYawPitch()       { return { yaw: _fp.yaw, pitch: _fp.pitch }; }

  function setFPSpeed(s)         { _fp.baseSpeed = s; }
  function setFPParams(params)   {
    if (params.speed     !== undefined) _fp.baseSpeed = params.speed;
    if (params.sprint    !== undefined) _fp.sprintMultiplier = params.sprint;
    if (params.damping   !== undefined) _fp.damping = params.damping;
  }

  /**
   * 全模式重置（场景切换时调用）
   * - 清所有速度/跳跃/动画 lock
   * - 把 orbit/fp/avatar 状态回 0（或当前位置重派生）
   * - 相机位置清零（让 resetToPosition 接管）
   * - 写回 camera
   */
  function resetAll() {
    if (!camera) return;

    // FP：清速度/跳跃，地面高度回 0
    _fp.velocity.set(0, 0, 0);
    _fp.jumpVelocity = 0;
    _fp.hasMoveInput = false;
    _fp.groundLevel = 0;
    _fp.position.set(0, EYE_HEIGHT, 0);
    _fpGroundProbeTimer = 0;
    _fpGroundProbeX = Infinity;
    _fpGroundProbeZ = Infinity;
    _fp.yaw = 0;
    _fp.pitch = -0.09;

    // Orbit：target 回原点，yaw/pitch 用球坐标
    _orbit.target.set(0, 0, 0);
    _d.copy(camera.position).sub(_orbit.target);
    if (_d.lengthSq() < 0.0001) _d.set(15, 15, 25);
    _orbit.spherical.setFromVector3(_d);
    _orbit.yaw = _orbit.spherical.theta;
    _orbit.pitch = _orbit.spherical.phi;

    // Avatar：清 pending 放置（下次 setModelRef 时才生效）
    _avatar.pendingPlace = null;
    _avatar.initialized = false;
    _avatar.camYaw = Math.PI;
    _avatar.camPitch = 0;

    // 写回相机
    camera.position.set(0, EYE_HEIGHT, 0);
    camera.quaternion.setFromEuler(_e.set(_fp.pitch, _fp.yaw, 0, 'YXZ'));

    console.log('[CameraState] resetAll done');
  }

  function setModelRef(ref) {
    _avatar.modelRef = ref;
    if (ref && camera) {
      if (_avatar.pendingPlace) {
        // switchMode 时已算好位置，直接应用
        ref.position.set(_avatar.pendingPlace.x, _avatar.pendingPlace.y, _avatar.pendingPlace.z);
        _avatar.camYaw   = _avatar.pendingPlace.camYaw;
        _avatar.camPitch  = _avatar.pendingPlace.camPitch;
        _avatar.initialized = true;
        _avatar.pendingPlace = null;
      } else if (!_avatar.initialized) {
        // 纯首次加载（非切换模式进入），默认背后平视
        _avatar.camYaw   = Math.PI;
        _avatar.camPitch  = 0;
        _avatar.initialized = true;
      }
    }
  }

  /**
   * 返回 avatar 模式下相机相对模型的水平方向
   * forward = 相机 → 模型 的水平投影（小人按 W 沿此方向走）
   * right   = forward 的水平右侧（小人按 D 沿此方向走）
   */
  function getAvatarCameraDir() {
    const sf = Math.sin(_avatar.camYaw);
    const cf = Math.cos(_avatar.camYaw);
    // 相机位置相对模型：(-sin*dist, _, +cos*dist)
    // 相机→模型方向 = -相机位置相对模型 = (sin, -cos)
    const forwardX =  sf;
    const forwardZ = -cf;
    // 与屏幕方向对齐：D/摇杆右应该向画面右侧移动。
    const rightX = cf;
    const rightZ = sf;
    return { forwardX, forwardZ, rightX, rightZ };
  }

  let _isTouch = null;
  function isTouchDevice() {
    if (_isTouch !== null) return _isTouch;
    _isTouch = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(navigator.userAgent)
      || window.matchMedia('(pointer:coarse)').matches;
    return _isTouch;
  }

  /**
   * 轨迹播放时同步 _fp 状态（保持暂停后恢复一致性）
   */
  function syncFPState(x, eyeY, z, lookX, lookZ) {
    _fp.position.set(x, eyeY, z);
    _fp.groundLevel = eyeY - EYE_HEIGHT;

    // 从 lookAt 方向推算 yaw
    var dx = lookX - x;
    var dz = lookZ - z;
    _fp.yaw = Math.atan2(dx, dz);

    _fp.velocity.set(0, 0, 0);
    _fp.jumpVelocity = 0;
    _fp.hasMoveInput = false;
  }

  /**
   * 直接同步 _fp 位置 + yaw/pitch（不通过 lookAt，避免改方向）
   * 用于 pause 时固化当前 camera 状态
   */
  function syncFPPositionOnly(x, y, z, yaw, pitch) {
    _fp.position.set(x, y, z);
    _fp.groundLevel = y - EYE_HEIGHT;
    _fp.yaw = yaw;
    _fp.pitch = pitch;
    _fp.velocity.set(0, 0, 0);
    _fp.jumpVelocity = 0;
    _fp.hasMoveInput = false;
  }

  /**
   * 轨迹播放时同步 orbit 状态
   */
  function syncOrbitState(tx, ty, tz, lookX, lookZ) {
    _orbit.target.set(tx, ty, tz);
    var dx = -tx, dy = 3 - ty, dz = -tz;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 0.01) {
      _orbit.spherical.setFromVector3(new THREE.Vector3(dx, dy, dz));
      _orbit.yaw   = _orbit.spherical.theta;
      _orbit.pitch = _orbit.spherical.phi;
    }
  }

  /** 内部状态快照（调试用） */
  function dump() {
    return {
      mode: activeMode,
      orbit: { target: _orbit.target.toArray(), radius: _orbit.spherical.radius, yaw: _orbit.yaw, pitch: _orbit.pitch },
      fp:    { position: _fp.position.toArray(), yaw: _fp.yaw, pitch: _fp.pitch, groundLevel: _fp.groundLevel, velY: _fp.jumpVelocity },
      avatar: { camYaw: _avatar.camYaw, camPitch: _avatar.camPitch },
    };
  }

  // ===================================================================
  // Export
  // ===================================================================

  window.CameraState = {
    MODES,
    init,
    switchMode,
    getMode,
    get activeMode() { return activeMode; },

    processInput,
    animate,
    setPlaybackLock,

    // Position API
    resetToPosition,
    resetAll,
    setOrbitTarget,
    setGroundLevel,
    getGroundLevel,
    getPosition,
    getFPPosition,
    getFPYawPitch,

    // FP settings
    setFPSpeed,
    setFPParams,

    // Avatar
    setModelRef,
    getAvatarCameraDir,

    // Utility
    isTouchDevice,

    // ★ 轨迹播放同步接口
    syncFPState,
    syncFPPositionOnly,
    syncOrbitState,

    // Internal（调试用）
    dump,
  };
})();
