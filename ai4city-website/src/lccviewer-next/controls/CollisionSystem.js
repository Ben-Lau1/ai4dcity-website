import { THREE } from '../render/SceneRuntime.js'

export class CollisionSystem {
  constructor(adapter) {
    this.adapter = adapter
    this.enabled = true
    this.available = false
    this.groundY = null
    this.probeTimer = 0
  }

  refresh() {
    this.available = this.adapter.hasCollision()
    return this.available
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled)
  }

  getGround(position, dt, force = false) {
    if (!this.enabled || !this.available) return this.groundY
    this.probeTimer -= dt
    if (!force && this.probeTimer > 0) return this.groundY
    this.probeTimer = 0.1
    const hit = this.adapter.groundAt(position)
    if (hit !== null) this.groundY = hit
    return this.groundY
  }

  sampleGround(position) {
    if (!this.enabled || !this.available) return null
    return this.adapter.groundAt(position)
  }

  resolveSphere(position, radius = 0.3) {
    if (!this.enabled || !this.available) return position
    const result = this.adapter.sphereCollision(position, radius)
    if (result?.delta) {
      const delta = new THREE.Vector3(result.delta.x || 0, result.delta.y || 0, result.delta.z || 0)
      if (Number.isFinite(delta.lengthSq())) {
        const maxCorrection = 0.4
        if (delta.length() > maxCorrection) delta.setLength(maxCorrection)
        position.add(delta)
      }
    }
    return position
  }

  resolveAvatarHorizontal(position, groundY, radius = 0.4) {
    if (!this.enabled || !this.available) return position
    const center = { x: position.x, y: groundY + 0.7, z: position.z }
    const result = this.adapter.sphereCollision(center, radius)
    if (!result?.delta) return position

    const rawX = Number(result.delta.x) || 0
    const rawZ = Number(result.delta.z) || 0
    if (!Number.isFinite(rawX) || !Number.isFinite(rawZ) || Math.hypot(rawX, rawZ) > radius * 2.5) return position

    const clampAxis = (value) => {
      if (!Number.isFinite(value) || Math.abs(value) < 0.05) return 0
      return THREE.MathUtils.clamp(value, -0.4, 0.4)
    }
    position.x += clampAxis(rawX)
    position.z += clampAxis(rawZ)
    return position
  }
}
