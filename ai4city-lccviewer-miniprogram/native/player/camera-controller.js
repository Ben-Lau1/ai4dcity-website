'use strict';

const { createAvatarController } = require('./avatar-controller');

const EYE_HEIGHT = 1.7;
const GRAVITY = 15;
const JUMP_FORCE = 6;
const WALK_SPEED = 5;
const ORBIT_MAX_PITCH = 1.5;
const AVATAR_MIN_PITCH = -0.25;
const AVATAR_MAX_PITCH = 0.85;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deriveYawPitch(direction) {
  const horizontal = Math.hypot(direction.x, direction.z);
  return {
    yaw: Math.atan2(-direction.x, -direction.z),
    pitch: Math.atan2(direction.y, Math.max(horizontal, 0.0001)),
  };
}

function createCameraController(options) {
  const {
    THREE,
    scene,
    camera,
    initialPosition,
    initialTarget,
    avatarUrl,
    onAvatarReady,
    onAvatarError,
  } = options;

  const position = new THREE.Vector3(...initialPosition);
  const target = new THREE.Vector3(...initialTarget);
  const offset = position.clone().sub(target);
  const initialDistance = Math.max(offset.length(), 0.1);
  const initialDirection = target.clone().sub(position).normalize();
  const initialLook = deriveYawPitch(initialDirection);
  const groundY = position.y - EYE_HEIGHT;

  const orbit = {
    target,
    yaw: Math.atan2(offset.x, offset.z),
    pitch: Math.asin(clamp(offset.y / initialDistance, -1, 1)),
    distance: initialDistance,
  };
  const firstPerson = {
    position: position.clone(),
    yaw: initialLook.yaw,
    pitch: initialLook.pitch,
    groundY,
    verticalVelocity: 0,
  };
  const avatar = {
    groundY,
    verticalVelocity: 0,
    camYaw: Math.atan2(initialDirection.x, -initialDirection.z),
    camPitch: 0,
    camDistance: 4,
    camHeight: 1.5,
  };
  const avatarController = createAvatarController({
    THREE,
    scene,
    modelUrl: avatarUrl,
    onReady: onAvatarReady,
    onError: onAvatarError,
  });

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const euler = new THREE.Euler();
  const gesture = { x: 0, y: 0, zoom: 0 };
  const movement = { x: 0, z: 0, sprint: false };
  let activeMode = 'orbit';
  let jumpRequested = false;

  camera.position.copy(position);
  camera.lookAt(target);

  function cameraDirection() {
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    else forward.normalize();
    return forward;
  }

  function placeAvatarFromCamera() {
    const direction = cameraDirection();
    avatar.groundY = firstPerson.groundY;
    avatar.verticalVelocity = 0;
    avatarController.root.position.set(
      camera.position.x + direction.x * 5,
      avatar.groundY + 0.05,
      camera.position.z + direction.z * 5,
    );
    avatarController.root.rotation.y = Math.atan2(direction.x, direction.z);
    avatar.camYaw = Math.atan2(direction.x, -direction.z);
    avatar.camPitch = 0;
  }

  function switchMode(mode) {
    if (!mode || mode === activeMode) return;
    const direction = camera.getWorldDirection(forward).clone();
    const look = deriveYawPitch(direction);

    if (mode === 'orbit') {
      orbit.target.copy(camera.position).addScaledVector(direction, 5);
      offset.copy(camera.position).sub(orbit.target);
      orbit.distance = Math.max(offset.length(), 0.5);
      orbit.yaw = Math.atan2(offset.x, offset.z);
      orbit.pitch = Math.asin(clamp(offset.y / orbit.distance, -1, 1));
      avatarController.hide();
    } else if (mode === 'firstPerson') {
      firstPerson.position.copy(camera.position);
      firstPerson.yaw = look.yaw;
      firstPerson.pitch = look.pitch;
      firstPerson.groundY = firstPerson.position.y - EYE_HEIGHT;
      firstPerson.verticalVelocity = 0;
      avatarController.hide();
    } else if (mode === 'avatar') {
      placeAvatarFromCamera();
      avatarController.show();
    }

    movement.x = 0;
    movement.z = 0;
    jumpRequested = false;
    activeMode = mode;
  }

  function applyGesture() {
    if (!gesture.x && !gesture.y && !gesture.zoom) return;
    if (activeMode === 'orbit') {
      orbit.yaw -= gesture.x * 0.008;
      orbit.pitch = clamp(orbit.pitch + gesture.y * 0.006, -1.15, ORBIT_MAX_PITCH);
      orbit.distance = clamp(orbit.distance - gesture.zoom * 0.018, 1.8, 500);
    } else if (activeMode === 'firstPerson') {
      firstPerson.yaw -= gesture.x * 0.004;
      firstPerson.pitch = clamp(
        firstPerson.pitch - gesture.y * 0.003,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01,
      );
    } else {
      avatar.camYaw -= gesture.x * 0.004;
      avatar.camPitch = clamp(
        avatar.camPitch - gesture.y * 0.002,
        AVATAR_MIN_PITCH,
        AVATAR_MAX_PITCH,
      );
    }
    gesture.x = 0;
    gesture.y = 0;
    gesture.zoom = 0;
  }

  function updateOrbit(dt) {
    const horizontal = Math.cos(orbit.pitch) * orbit.distance;
    camera.position.set(
      orbit.target.x + Math.sin(orbit.yaw) * horizontal,
      orbit.target.y + Math.sin(orbit.pitch) * orbit.distance,
      orbit.target.z + Math.cos(orbit.yaw) * horizontal,
    );
    camera.lookAt(orbit.target);

    if (Math.abs(movement.x) > 0.01 || Math.abs(movement.z) > 0.01) {
      cameraDirection();
      right.set(-forward.z, 0, forward.x);
      const speed = Math.max(5, orbit.distance * 0.8);
      orbit.target.addScaledVector(right, movement.x * speed * dt);
      orbit.target.addScaledVector(forward, movement.z * speed * dt);
    }
  }

  function updateFirstPerson(dt) {
    forward.set(-Math.sin(firstPerson.yaw), 0, -Math.cos(firstPerson.yaw));
    right.set(Math.cos(firstPerson.yaw), 0, -Math.sin(firstPerson.yaw));
    const moving = Math.abs(movement.x) > 0.01 || Math.abs(movement.z) > 0.01;
    if (moving) {
      const speed = WALK_SPEED * (movement.sprint ? 3 : 1);
      firstPerson.position.addScaledVector(forward, movement.z * speed * dt);
      firstPerson.position.addScaledVector(right, movement.x * speed * dt);
    }

    const floor = firstPerson.groundY + EYE_HEIGHT;
    if (jumpRequested && firstPerson.position.y <= floor + 0.02) {
      firstPerson.verticalVelocity = JUMP_FORCE;
    }
    if (firstPerson.verticalVelocity || firstPerson.position.y > floor) {
      firstPerson.verticalVelocity -= GRAVITY * dt;
      firstPerson.position.y += firstPerson.verticalVelocity * dt;
      if (firstPerson.position.y <= floor) {
        firstPerson.position.y = floor;
        firstPerson.verticalVelocity = 0;
      }
    } else {
      firstPerson.position.y = floor;
    }

    camera.position.copy(firstPerson.position);
    camera.quaternion.setFromEuler(
      euler.set(firstPerson.pitch, firstPerson.yaw, 0, 'YXZ'),
    );
  }

  function updateAvatar(dt) {
    const root = avatarController.root;
    const sin = Math.sin(avatar.camYaw);
    const cos = Math.cos(avatar.camYaw);
    const worldX = movement.x * cos + movement.z * sin;
    const worldZ = movement.x * sin - movement.z * cos;
    const moving = Math.abs(worldX) > 0.01 || Math.abs(worldZ) > 0.01;
    if (moving) {
      const speed = WALK_SPEED * (movement.sprint ? 3 : 1);
      root.position.x += worldX * speed * dt;
      root.position.z += worldZ * speed * dt;
      root.rotation.y = Math.atan2(worldX, worldZ);
    }

    const floor = avatar.groundY + 0.05;
    if (jumpRequested && root.position.y <= floor + 0.02) {
      avatar.verticalVelocity = JUMP_FORCE;
    }
    if (avatar.verticalVelocity || root.position.y > floor) {
      avatar.verticalVelocity -= GRAVITY * dt;
      root.position.y += avatar.verticalVelocity * dt;
      if (root.position.y <= floor) {
        root.position.y = floor;
        avatar.verticalVelocity = 0;
      }
    } else {
      root.position.y = floor;
    }

    desired.set(
      root.position.x - sin * avatar.camDistance,
      root.position.y + Math.max(0.9, avatar.camHeight + avatar.camPitch * 2),
      root.position.z + cos * avatar.camDistance,
    );
    const follow = 1 - Math.exp(-12 * dt);
    camera.position.lerp(desired, follow);
    lookTarget.set(
      root.position.x,
      root.position.y + avatarController.height * 0.5,
      root.position.z,
    );
    camera.lookAt(lookTarget);
    avatarController.update(dt, {
      moving,
      sprint: movement.sprint,
      jumping: avatar.verticalVelocity !== 0,
    });
  }

  return {
    switchMode,
    getMode() {
      return activeMode;
    },
    addGesture(x, y, zoom) {
      gesture.x += x || 0;
      gesture.y += y || 0;
      gesture.zoom += zoom || 0;
    },
    setMovement(x, z, sprint) {
      movement.x = clamp(x || 0, -1, 1);
      movement.z = clamp(z || 0, -1, 1);
      movement.sprint = !!sprint;
    },
    requestJump() {
      jumpRequested = true;
    },
    update(deltaSeconds) {
      const dt = Math.min(Math.max(deltaSeconds || 0.016, 0.001), 0.05);
      applyGesture();
      if (activeMode === 'orbit') updateOrbit(dt);
      else if (activeMode === 'firstPerson') updateFirstPerson(dt);
      else updateAvatar(dt);
      jumpRequested = false;
    },
    dispose() {
      avatarController.dispose();
    },
  };
}

module.exports = { createCameraController };
