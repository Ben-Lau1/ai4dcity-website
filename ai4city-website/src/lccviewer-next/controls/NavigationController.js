import { THREE } from '../render/SceneRuntime.js'

const EYE_HEIGHT = 1.7
const WALK_SPEED = 5
const RUN_SPEED = 10
const GRAVITY = 18
const JUMP_SPEED = 6.2
const UP = new THREE.Vector3(0, 1, 0)

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export class NavigationController {
  constructor(camera, collision, avatar) {
    this.camera = camera
    this.collision = collision
    this.avatar = avatar
    this.mode = 'firstPerson'
    this.position = new THREE.Vector3(0, 0, 0)
    this.yaw = 0
    this.avatarYaw = 0
    this.pitch = 0
    this.verticalVelocity = 0
    this.grounded = false
    this.fallbackGround = 0
    this.playbackLocked = false
    this.orbit = { target: new THREE.Vector3(), yaw: 0.8, pitch: 0.45, distance: 20 }
    this.thirdPersonDistance = 5.5
    this.cameraGround = null
    this.cameraProbeTimer = 0
    this.avatar.setVisible(false)
  }

  setStart(position, nextPosition = null) {
    this.position.copy(position)
    this.fallbackGround = position.y
    if (nextPosition) {
      const direction = nextPosition.clone().sub(position)
      if (direction.lengthSq() > 0.001) {
        this.yaw = Math.atan2(-direction.x, -direction.z)
        this.avatarYaw = Math.atan2(direction.x, direction.z)
      }
    }
    this.pitch = 0
    this.verticalVelocity = 0
    this.grounded = true
    this.cameraGround = null
    this.cameraProbeTimer = 0
    this.orbit.target.copy(position).add(new THREE.Vector3(0, 1, 0))
    this.orbit.yaw = this.yaw + Math.PI
    this.orbit.pitch = 0.45
    this.orbit.distance = 18
    this.avatar.setPosition(this.position)
    this.avatar.setHeading(this.avatarYaw)
    this.applyCamera(1)
  }

  setMode(mode) {
    if (!['orbit', 'firstPerson', 'avatar'].includes(mode)) return
    if (this.mode === 'firstPerson') this.position.copy(this.camera.position).addScaledVector(UP, -EYE_HEIGHT)
    if (this.mode === 'orbit') this.position.copy(this.orbit.target).addScaledVector(UP, -1)
    this.mode = mode
    this.playbackLocked = false
    this.avatar.setVisible(mode === 'avatar')
    this.avatar.setPosition(this.position)
    if (mode === 'avatar') this.avatar.setHeading(this.avatarYaw)
    if (mode === 'orbit') this.orbit.target.copy(this.position).addScaledVector(UP, 1)
    this.applyCamera(1)
  }

  update(dt, input) {
    if (this.playbackLocked) return
    this.yaw += input.yaw
    const minPitch = this.mode === 'avatar' ? -0.1 : -1.35
    const maxPitch = this.mode === 'avatar' ? 1.1 : 1.35
    this.pitch = clamp(this.pitch + input.pitch, minPitch, maxPitch)

    if (this.mode === 'orbit') this.updateOrbit(input)
    else this.updateWalking(dt, input)
    this.applyCamera(dt)
    this.avatar.update(dt)
  }

  updateOrbit(input) {
    this.orbit.yaw += input.yaw
    this.orbit.pitch = clamp(this.orbit.pitch + input.pitch, -1.35, 1.35)
    this.orbit.distance = clamp(this.orbit.distance * Math.exp(input.zoom), 1.5, 400)
    if (input.panX || input.panY) {
      const scale = this.orbit.distance * 0.0015
      const forward = new THREE.Vector3(-Math.sin(this.orbit.yaw), 0, -Math.cos(this.orbit.yaw))
      const right = new THREE.Vector3().crossVectors(forward, UP).normalize()
      this.orbit.target.addScaledVector(right, -input.panX * scale)
      this.orbit.target.y += input.panY * scale
    }
  }

  updateWalking(dt, input) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize()
    if (this.mode === 'avatar') {
      this.avatarYaw = Math.atan2(forward.x, forward.z)
      this.avatar.setHeading(this.avatarYaw)
    }
    const direction = forward.clone().multiplyScalar(input.moveZ).addScaledVector(right, input.moveX)
    if (direction.lengthSq() > 1) direction.normalize()
    const moving = direction.lengthSq() > 0.001
    const speed = input.sprint ? RUN_SPEED : WALK_SPEED
    const ground = this.collision.getGround(this.position, dt)
    if (ground !== null && ground !== undefined) {
      const difference = ground - this.fallbackGround
      const limitedDifference = THREE.MathUtils.clamp(difference, -0.5, 0.5)
      this.fallbackGround += limitedDifference * (1 - Math.exp(-dt * 10))
    }
    const floor = this.fallbackGround
    const proposed = this.position.clone().addScaledVector(direction, speed * dt)

    if (moving && this.mode === 'avatar') this.collision.resolveAvatarHorizontal(proposed, floor)
    else if (moving) {
      const eye = proposed.clone().addScaledVector(UP, EYE_HEIGHT)
      this.collision.resolveSphere(eye)
      proposed.copy(eye).addScaledVector(UP, -EYE_HEIGHT)
    }

    const horizontalStep = new THREE.Vector2(proposed.x - this.position.x, proposed.z - this.position.z)
    const maxHorizontalStep = speed * dt + 0.05
    if (!Number.isFinite(horizontalStep.lengthSq())) {
      proposed.x = this.position.x
      proposed.z = this.position.z
    } else if (horizontalStep.length() > maxHorizontalStep) {
      horizontalStep.setLength(maxHorizontalStep)
      proposed.x = this.position.x + horizontalStep.x
      proposed.z = this.position.z + horizontalStep.y
    }
    if (this.grounded && input.jump) {
      this.verticalVelocity = JUMP_SPEED
      this.grounded = false
    }
    this.verticalVelocity -= GRAVITY * dt
    proposed.y += this.verticalVelocity * dt
    if (proposed.y <= floor + 0.04) {
      proposed.y = floor + 0.04
      this.verticalVelocity = 0
      this.grounded = true
    }
    this.position.copy(proposed)

    if (this.mode === 'avatar') {
      this.avatar.setPosition(this.position)
      this.avatar.play(!this.grounded ? 'jump' : moving ? (input.sprint ? 'run' : 'walk') : 'idle')
    }
  }

  applyCamera(dt) {
    if (this.mode === 'orbit') {
      const cosPitch = Math.cos(this.orbit.pitch)
      this.camera.position.set(
        this.orbit.target.x + Math.sin(this.orbit.yaw) * cosPitch * this.orbit.distance,
        this.orbit.target.y + Math.sin(this.orbit.pitch) * this.orbit.distance,
        this.orbit.target.z + Math.cos(this.orbit.yaw) * cosPitch * this.orbit.distance,
      )
      this.camera.lookAt(this.orbit.target)
      return
    }
    if (this.mode === 'firstPerson') {
      this.camera.position.copy(this.position).addScaledVector(UP, EYE_HEIGHT)
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
      return
    }

    const target = this.position.clone().addScaledVector(UP, 1.35)
    const cosPitch = Math.cos(this.pitch)
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.yaw) * cosPitch * this.thirdPersonDistance,
      target.y + Math.sin(this.pitch) * this.thirdPersonDistance + 1.2,
      target.z + Math.cos(this.yaw) * cosPitch * this.thirdPersonDistance,
    )
    this.cameraProbeTimer -= dt
    if (this.cameraProbeTimer <= 0) {
      this.cameraProbeTimer = 0.12
      const ground = this.collision.sampleGround(desired)
      if (ground !== null) this.cameraGround = ground
    }
    if (this.cameraGround !== null) desired.y = Math.max(desired.y, this.cameraGround + 0.55)
    const blend = 1 - Math.exp(-Math.max(dt, 0.016) * 10)
    this.camera.position.lerp(desired, blend)
    this.camera.lookAt(target)
  }

  applyPlayback(position, lookAt) {
    this.playbackLocked = true
    this.mode = 'firstPerson'
    this.avatar.setVisible(false)
    this.camera.position.copy(position)
    this.camera.lookAt(lookAt)
    this.position.copy(position).addScaledVector(UP, -EYE_HEIGHT)
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ')
    this.pitch = euler.x
    this.yaw = euler.y
  }

  stopPlayback() {
    this.playbackLocked = false
    this.position.copy(this.camera.position).addScaledVector(UP, -EYE_HEIGHT)
  }
}
