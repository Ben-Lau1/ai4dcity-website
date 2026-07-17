'use strict';

const { clamp, lookAt, normalize, perspective } = require('../runtime/math');

const EYE_HEIGHT = 1.7;
const ORBIT_WALK_SPEED = 5;
const ORBIT_RUN_SPEED = 10;
const FIRST_PERSON_WALK_SPEED = 8;
const FIRST_PERSON_RUN_SPEED = 24;
const AVATAR_WALK_SPEED = 5;
const AVATAR_RUN_SPEED = 15;
const GRAVITY = 18;
const JUMP_SPEED = 6.2;
const GROUND_CLEARANCE = 0.04;
const AVATAR_LOOK_HEIGHT = 1.75;
const AVATAR_ENTRY_DISTANCE = 5;
const AVATAR_DEFAULT_HORIZONTAL_DISTANCE = 5.5;
const AVATAR_DEFAULT_HEIGHT_OFFSET = 1.2;
const AVATAR_DEFAULT_DISTANCE = Math.hypot(
  AVATAR_DEFAULT_HORIZONTAL_DISTANCE,
  AVATAR_DEFAULT_HEIGHT_OFFSET,
);
const AVATAR_DEFAULT_PITCH = Math.atan2(
  AVATAR_DEFAULT_HEIGHT_OFFSET,
  AVATAR_DEFAULT_HORIZONTAL_DISTANCE,
);
const AVATAR_MIN_PITCH = -0.08;
const AVATAR_MAX_PITCH = 0.9;
const MODE_SWITCH_FOCUS_DISTANCE = 5;
const GROUND_PATH_RADIUS = 45;
const MAX_GROUND_SEGMENT = 45;
const GROUND_FOLLOW_SPEED = 8;
const MAX_GROUND_STEP_UP = 0.65;
const UP = [0, 1, 0];

function createTrajectoryGroundSampler(scene) {
  const points = (scene.trajectory || []).filter((point) => (
    Array.isArray(point)
    && point.length >= 3
    && point.every(Number.isFinite)
  ));
  if (!points.length) return () => null;
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end[0] - start[0];
    const dz = end[2] - start[2];
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq > 0.0001 && lengthSq <= MAX_GROUND_SEGMENT * MAX_GROUND_SEGMENT) {
      segments.push({ start, end, dx, dz, lengthSq });
    }
  }

  return (position) => {
    let bestDistanceSq = GROUND_PATH_RADIUS * GROUND_PATH_RADIUS;
    let bestY = null;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const relativeX = position[0] - segment.start[0];
      const relativeZ = position[2] - segment.start[2];
      const ratio = clamp(
        (relativeX * segment.dx + relativeZ * segment.dz) / segment.lengthSq,
        0,
        1,
      );
      const x = segment.start[0] + segment.dx * ratio;
      const z = segment.start[2] + segment.dz * ratio;
      const distanceX = position[0] - x;
      const distanceZ = position[2] - z;
      const distanceSq = distanceX * distanceX + distanceZ * distanceZ;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestY = segment.start[1] + (segment.end[1] - segment.start[1]) * ratio;
      }
    }
    if (bestY !== null) return bestY;
    for (let index = 0; index < points.length; index += 1) {
      const dx = position[0] - points[index][0];
      const dz = position[2] - points[index][2];
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestY = points[index][1];
      }
    }
    return bestY;
  };
}

function createCameraController(scene) {
  const start = scene.start.slice();
  const next = scene.next.slice();
  const initialDirection = normalize([next[0] - start[0], 0, next[2] - start[2]]);
  const sampleTrajectoryGround = createTrajectoryGroundSampler(scene);
  let preciseGroundSampler = null;

  function sampleGround(position) {
    if (preciseGroundSampler) {
      const precise = preciseGroundSampler(position);
      if (precise !== null && precise !== undefined && Number.isFinite(precise)) return precise;
    }
    return sampleTrajectoryGround(position);
  }
  const initialHeading = Math.atan2(initialDirection[0], initialDirection[2]);
  let actorHeading = initialHeading;
  let firstPersonHeading = initialHeading;
  let firstPersonPitch = 0;
  let avatarCameraHeading = initialHeading;
  let avatarCameraPitch = AVATAR_DEFAULT_PITCH;
  let avatarCameraDistance = AVATAR_DEFAULT_DISTANCE;
  let mode = 'orbit';
  let movementX = 0;
  let movementZ = 0;
  let sprint = false;
  let jumpRequested = false;
  let verticalVelocity = 0;
  let elapsedTime = 0;
  let groundY = start[1];
  let actor = [start[0], groundY + GROUND_CLEARANCE, start[2]];
  let firstPerson = [start[0], groundY + EYE_HEIGHT, start[2]];
  let orbitTarget = [start[0], groundY + 1, start[2]];
  let orbitDistance = 18;
  let orbitHeading = initialHeading + Math.PI;
  let orbitPitch = 0.45;
  let camera = {
    position: firstPerson.slice(),
    target: [firstPerson[0] + initialDirection[0], firstPerson[1], firstPerson[2] + initialDirection[2]],
    forward: initialDirection.slice(),
  };
  const matrices = {
    projection: new Float32Array(16),
    view: new Float32Array(16),
  };

  function forwardFromHeading(value) {
    return [Math.sin(value), 0, Math.cos(value)];
  }

  function horizontalDirection(direction, fallbackHeading) {
    const length = Math.hypot(direction[0], direction[2]);
    if (length > 0.000001) return [direction[0] / length, 0, direction[2] / length];
    return forwardFromHeading(fallbackHeading);
  }

  function currentCameraDirection() {
    let direction = camera.forward;
    let length = direction && Math.hypot(direction[0], direction[1], direction[2]);
    if (!Number.isFinite(length) || length < 0.000001) {
      direction = [
        camera.target[0] - camera.position[0],
        camera.target[1] - camera.position[1],
        camera.target[2] - camera.position[2],
      ];
      length = Math.hypot(direction[0], direction[1], direction[2]);
    }
    if (!Number.isFinite(length) || length < 0.000001) {
      return forwardFromHeading(firstPersonHeading);
    }
    return [direction[0] / length, direction[1] / length, direction[2] / length];
  }

  function setOrbitFromCamera(position, direction) {
    orbitDistance = MODE_SWITCH_FOCUS_DISTANCE;
    orbitTarget = [
      position[0] + direction[0] * orbitDistance,
      position[1] + direction[1] * orbitDistance,
      position[2] + direction[2] * orbitDistance,
    ];
    const offsetX = position[0] - orbitTarget[0];
    const offsetY = position[1] - orbitTarget[1];
    const offsetZ = position[2] - orbitTarget[2];
    orbitHeading = Math.atan2(offsetX, offsetZ);
    orbitPitch = Math.atan2(offsetY, Math.hypot(offsetX, offsetZ));
  }

  function setFirstPersonFromCamera(position, direction) {
    firstPerson = position.slice();
    const horizontal = horizontalDirection(direction, firstPersonHeading);
    firstPersonHeading = Math.atan2(horizontal[0], horizontal[2]);
    firstPersonPitch = Math.atan2(
      direction[1],
      Math.max(Math.hypot(direction[0], direction[2]), 0.000001),
    );

    const foot = [position[0], position[1] - EYE_HEIGHT, position[2]];
    const sampledGround = sampleGround(foot);
    groundY = sampledGround !== null && Number.isFinite(sampledGround)
      ? sampledGround
      : foot[1] - GROUND_CLEARANCE;
    actor = [position[0], groundY + GROUND_CLEARANCE, position[2]];
  }

  function placeAvatarFromCamera(position, direction) {
    const forward = horizontalDirection(direction, actorHeading);
    const nextHeading = Math.atan2(forward[0], forward[2]);
    const actorX = position[0] + forward[0] * AVATAR_ENTRY_DISTANCE;
    const actorZ = position[2] + forward[2] * AVATAR_ENTRY_DISTANCE;
    const sampledGround = sampleGround([actorX, position[1] - EYE_HEIGHT, actorZ]);
    if (sampledGround !== null && Number.isFinite(sampledGround)) groundY = sampledGround;

    actor = [actorX, groundY + GROUND_CLEARANCE, actorZ];
    actorHeading = nextHeading;
    avatarCameraHeading = nextHeading;

    const targetY = actor[1] + AVATAR_LOOK_HEIGHT;
    const horizontalDistance = Math.hypot(actor[0] - position[0], actor[2] - position[2]);
    const heightOffset = position[1] - targetY;
    avatarCameraDistance = Math.max(
      Math.hypot(horizontalDistance, heightOffset),
      0.001,
    );
    avatarCameraPitch = Math.atan2(heightOffset, Math.max(horizontalDistance, 0.000001));
  }

  function reset(newScene = scene) {
    const origin = newScene.start;
    const ahead = newScene.next;
    const direction = normalize([ahead[0] - origin[0], 0, ahead[2] - origin[2]]);
    const nextHeading = Math.atan2(direction[0], direction[2]);
    actorHeading = nextHeading;
    firstPersonHeading = nextHeading;
    firstPersonPitch = 0;
    avatarCameraHeading = nextHeading;
    avatarCameraPitch = AVATAR_DEFAULT_PITCH;
    avatarCameraDistance = AVATAR_DEFAULT_DISTANCE;
    groundY = sampleGround(origin) ?? origin[1];
    actor = [origin[0], groundY + GROUND_CLEARANCE, origin[2]];
    firstPerson = [origin[0], groundY + EYE_HEIGHT, origin[2]];
    orbitTarget = [origin[0], groundY + 1, origin[2]];
    orbitDistance = 18;
    orbitHeading = nextHeading + Math.PI;
    orbitPitch = 0.45;
    verticalVelocity = 0;
    jumpRequested = false;
    movementX = 0;
    movementZ = 0;
    sprint = false;
  }

  function setMode(nextMode) {
    if (!['orbit', 'firstPerson', 'avatar'].includes(nextMode) || mode === nextMode) return;
    const position = camera.position.slice();
    const direction = currentCameraDirection();
    if (nextMode === 'orbit') setOrbitFromCamera(position, direction);
    if (nextMode === 'firstPerson') setFirstPersonFromCamera(position, direction);
    if (nextMode === 'avatar') placeAvatarFromCamera(position, direction);
    mode = nextMode;
    movementX = 0;
    movementZ = 0;
    sprint = false;
    verticalVelocity = 0;
    jumpRequested = false;
  }

  function addGesture(dx, dy, zoom) {
    if (mode === 'orbit') {
      orbitHeading -= (dx || 0) * 0.006;
      orbitPitch = clamp(orbitPitch - (dy || 0) * 0.004, -0.1, 1.35);
      orbitDistance = clamp(orbitDistance - (zoom || 0) * 0.02, 2, 400);
      return;
    }
    if (mode === 'avatar') {
      avatarCameraHeading -= (dx || 0) * 0.004;
      avatarCameraPitch = clamp(
        avatarCameraPitch - (dy || 0) * 0.003,
        AVATAR_MIN_PITCH,
        AVATAR_MAX_PITCH,
      );
      return;
    }
    firstPersonHeading -= (dx || 0) * 0.004;
    firstPersonPitch = clamp(firstPersonPitch - (dy || 0) * 0.003, -1.45, 1.45);
  }

  function setMovement(x, z, isSprinting) {
    movementX = clamp(Number(x) || 0, -1, 1);
    movementZ = clamp(Number(z) || 0, -1, 1);
    sprint = !!isSprinting;
  }

  function applyPlayback(position, target) {
    if (!Array.isArray(position) || !Array.isArray(target)) return;
    const direction = normalize([
      target[0] - position[0],
      target[1] - position[1],
      target[2] - position[2],
    ]);
    const horizontal = horizontalDirection(direction, firstPersonHeading);
    const horizontalLength = Math.hypot(direction[0], direction[2]);
    firstPersonHeading = Math.atan2(horizontal[0], horizontal[2]);
    firstPersonPitch = Math.atan2(direction[1], Math.max(horizontalLength, 0.000001));
    actorHeading = firstPersonHeading;
    avatarCameraHeading = firstPersonHeading;
    groundY = position[1] - EYE_HEIGHT;
    firstPerson = position.slice(0, 3);
    actor = [position[0], groundY + GROUND_CLEARANCE, position[2]];
    orbitTarget = [position[0], groundY + 1, position[2]];
    movementX = 0;
    movementZ = 0;
    verticalVelocity = 0;
    jumpRequested = false;
    mode = 'firstPerson';
    camera = {
      position: firstPerson.slice(),
      target: target.slice(0, 3),
      forward: direction,
    };
  }

  function recenterView() {
    if (mode !== 'avatar') return false;
    avatarCameraHeading = actorHeading;
    avatarCameraPitch = AVATAR_DEFAULT_PITCH;
    avatarCameraDistance = AVATAR_DEFAULT_DISTANCE;
    return true;
  }

  function updateVertical(position, dt) {
    const wasGrounded = position[1] <= groundY + GROUND_CLEARANCE + 0.08
      && Math.abs(verticalVelocity) < 0.05;
    let sampledGround = sampleGround(position);
    if (wasGrounded
      && !jumpRequested
      && sampledGround !== null
      && Number.isFinite(sampledGround)
      && sampledGround - groundY > MAX_GROUND_STEP_UP) {
      const trajectoryGround = sampleTrajectoryGround(position);
      sampledGround = trajectoryGround !== null
        && Number.isFinite(trajectoryGround)
        && trajectoryGround - groundY <= MAX_GROUND_STEP_UP
        ? trajectoryGround
        : null;
    }
    if (sampledGround !== null && Number.isFinite(sampledGround)) {
      if (wasGrounded && !jumpRequested && sampledGround >= groundY) {
        groundY = sampledGround;
      } else {
        const maxChange = Math.max(0.04, GROUND_FOLLOW_SPEED * dt);
        groundY += clamp(sampledGround - groundY, -maxChange, maxChange);
      }
    }
    const floorY = groundY + GROUND_CLEARANCE;
    if (wasGrounded && !jumpRequested) position[1] = floorY;
    if (jumpRequested && position[1] <= floorY + 0.06) verticalVelocity = JUMP_SPEED;
    verticalVelocity -= GRAVITY * dt;
    position[1] += verticalVelocity * dt;
    if (position[1] <= floorY) {
      position[1] = floorY;
      verticalVelocity = 0;
    }
  }

  function update(dt) {
    dt = clamp(Number(dt) || 0, 0, 0.05);
    elapsedTime += dt;
    const walkSpeed = mode === 'firstPerson'
      ? FIRST_PERSON_WALK_SPEED
      : mode === 'avatar'
        ? AVATAR_WALK_SPEED
        : ORBIT_WALK_SPEED;
    const runSpeed = mode === 'firstPerson'
      ? FIRST_PERSON_RUN_SPEED
      : mode === 'avatar'
        ? AVATAR_RUN_SPEED
        : ORBIT_RUN_SPEED;
    const speed = sprint ? runSpeed : walkSpeed;
    const inputLength = Math.hypot(movementX, movementZ);
    const scale = inputLength > 1 ? 1 / inputLength : 1;

    if (mode === 'orbit') {
      const forward = [Math.sin(orbitHeading + Math.PI), 0, Math.cos(orbitHeading + Math.PI)];
      const right = [-forward[2], 0, forward[0]];
      orbitTarget[0] += (forward[0] * movementZ + right[0] * movementX) * speed * dt * scale;
      orbitTarget[2] += (forward[2] * movementZ + right[2] * movementX) * speed * dt * scale;
      const horizontal = Math.cos(orbitPitch) * orbitDistance;
      const position = [
        orbitTarget[0] + Math.sin(orbitHeading) * horizontal,
        orbitTarget[1] + Math.sin(orbitPitch) * orbitDistance,
        orbitTarget[2] + Math.cos(orbitHeading) * horizontal,
      ];
      camera = {
        position,
        target: orbitTarget.slice(),
        forward: normalize([orbitTarget[0] - position[0], orbitTarget[1] - position[1], orbitTarget[2] - position[2]]),
      };
    } else if (mode === 'avatar') {
      const forward = forwardFromHeading(avatarCameraHeading);
      const right = [-forward[2], 0, forward[0]];
      const worldX = (forward[0] * movementZ + right[0] * movementX) * scale;
      const worldZ = (forward[2] * movementZ + right[2] * movementX) * scale;
      actor[0] += worldX * speed * dt;
      actor[2] += worldZ * speed * dt;
      if (inputLength > 0.01) {
        actorHeading = Math.atan2(worldX, worldZ);
      }

      updateVertical(actor, dt);
      const horizontal = Math.cos(avatarCameraPitch) * avatarCameraDistance;
      const target = [actor[0], actor[1] + AVATAR_LOOK_HEIGHT, actor[2]];
      const position = [
        actor[0] - forward[0] * horizontal,
        target[1] + Math.sin(avatarCameraPitch) * avatarCameraDistance,
        actor[2] - forward[2] * horizontal,
      ];
      camera = {
        position,
        target,
        forward: normalize([target[0] - position[0], target[1] - position[1], target[2] - position[2]]),
      };
    } else {
      const forward = forwardFromHeading(firstPersonHeading);
      const right = [-forward[2], 0, forward[0]];
      firstPerson[0] += (forward[0] * movementZ + right[0] * movementX) * speed * dt * scale;
      firstPerson[2] += (forward[2] * movementZ + right[2] * movementX) * speed * dt * scale;

      const foot = [firstPerson[0], firstPerson[1] - EYE_HEIGHT, firstPerson[2]];
      updateVertical(foot, dt);
      firstPerson[1] = foot[1] + EYE_HEIGHT;
      const direction = normalize([
        forward[0] * Math.cos(firstPersonPitch),
        Math.sin(firstPersonPitch),
        forward[2] * Math.cos(firstPersonPitch),
      ]);
      camera = {
        position: firstPerson.slice(),
        target: [firstPerson[0] + direction[0], firstPerson[1] + direction[1], firstPerson[2] + direction[2]],
        forward: direction,
      };
    }
    jumpRequested = false;
    return camera;
  }

  return {
    addGesture,
    applyPlayback,
    getActor() { return actor.slice(); },
    getGroundPosition() {
      if (mode === 'avatar') return actor.slice();
      if (mode === 'firstPerson') return [firstPerson[0], firstPerson[1] - EYE_HEIGHT, firstPerson[2]];
      return [orbitTarget[0], orbitTarget[1] - 1, orbitTarget[2]];
    },
    getAvatarState() {
      const moving = Math.hypot(movementX, movementZ) > 0.01;
      return {
        airborne: Math.abs(actor[1] - (groundY + GROUND_CLEARANCE)) > 0.03
          || Math.abs(verticalVelocity) > 0.03,
        heading: actorHeading,
        motion: moving ? (sprint ? 2 : 1) : 0,
        position: actor.slice(),
        time: elapsedTime,
      };
    },
    getCamera() { return camera; },
    getHeading() { return mode === 'avatar' ? actorHeading : firstPersonHeading; },
    getMode() { return mode; },
    getMatrices(aspect) {
      perspective(55 * Math.PI / 180, aspect, 0.1, 3000, matrices.projection);
      lookAt(camera.position, camera.target, UP, matrices.view);
      return matrices;
    },
    isMoving() { return Math.hypot(movementX, movementZ) > 0.01 || verticalVelocity !== 0; },
    recenterView,
    requestJump() { jumpRequested = true; },
    reset,
    setGroundSampler(sampler) {
      preciseGroundSampler = typeof sampler === 'function' ? sampler : null;
    },
    setMode,
    setMovement,
    update,
  };
}

module.exports = { createCameraController };
