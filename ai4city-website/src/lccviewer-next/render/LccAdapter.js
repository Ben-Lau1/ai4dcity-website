import { THREE } from './SceneRuntime.js'

const QUALITY = {
  2: { useSH: true, pointsOnly: false, maxLoadSplatCount: 2_200_000 },
  3: { useSH: true, pointsOnly: false, maxLoadSplatCount: 3_200_000 },
  4: { useSH: true, pointsOnly: false, maxLoadSplatCount: 5_000_000 },
}

export class LccAdapter {
  constructor(runtime) {
    this.runtime = runtime
    this.api = window.LCC?.LCCRender
    this.instance = null
    this.loaded = false
    this.quality = 4
    if (!this.api) throw new Error('LCC SDK 未加载')
  }

  load(url, { onProgress } = {}) {
    this.unload()
    this.loaded = false
    const { scene, camera, renderer, canvas } = this.runtime
    const config = {
      dataPath: new URL(url, window.location.href).href,
      scene,
      camera,
      renderLib: THREE,
      libType: 0,
      canvas,
      renderer,
      modelMatrix: new THREE.Matrix4().set(
        -1, 0, 0, 0,
         0, 0, 1, 0,
         0, 1, 0, 0,
         0, 0, 0, 1,
      ),
    }

    return new Promise((resolve, reject) => {
      try {
        this.instance = this.api.load(
          config,
          () => {
            this.loaded = true
            this.api.setCamera?.(camera)
            this.setQuality(this.quality)
            resolve(this.instance)
          },
          (progress) => onProgress?.(Math.max(0, Math.min(1, Number(progress) || 0))),
          (error) => reject(this.normalizeError(error)),
        )
      } catch (error) {
        reject(this.normalizeError(error))
      }
    })
  }

  normalizeError(error) {
    if (error instanceof Error) return error
    return new Error(typeof error === 'string' ? error : 'LCC2 数据加载失败')
  }

  setQuality(level) {
    this.quality = Number(level) || 4
    const config = QUALITY[this.quality] || QUALITY[4]
    if (!this.instance) return
    this.instance.updateCurrentConfig?.(config)
    this.instance.setMaxSplats?.(config.maxLoadSplatCount)
    this.instance.setMaxNodeSplats?.(Math.ceil(config.maxLoadSplatCount / 50))
    this.instance.setLodAutoLevelUp?.(true)
  }

  update() {
    // The SDK streams visible LOD nodes from update(), including before onLoad.
    if (this.instance) this.api.update?.()
  }

  unload() {
    if (this.instance) this.api.unload?.(this.instance)
    this.instance = null
    this.loaded = false
  }

  hasCollision() {
    try { return Boolean(this.instance?.hasCollision?.()) } catch { return false }
  }

  groundAt(position) {
    if (!this.hasCollision() || !this.instance?.raycastFromOrigin) return null
    try {
      const hit = this.instance.raycastFromOrigin({
        origin: { x: position.x, y: position.y - 1000, z: position.z },
        direction: { x: 0, y: 1, z: 0 },
        maxDistance: 2000,
        radius: 0.5,
      })
      return hit && Number.isFinite(hit.y) ? hit.y : null
    } catch { return null }
  }

  sphereCollision(center, radius = 0.3) {
    if (!this.instance?.intersectsSphere) return null
    try {
      const result = this.instance.intersectsSphere({ center, radius, noDelta: false })
      return result?.hit ? result : null
    } catch { return null }
  }

  capsuleCollision(start, end, radius = 0.5) {
    if (!this.instance?.intersectsCapsule) return null
    try {
      const result = this.instance.intersectsCapsule({ start, end, radius })
      return result?.hit ? result : null
    } catch { return null }
  }
}
