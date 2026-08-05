import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { THREE } from '../render/SceneRuntime.js'

const MODEL_URL = '/lccviewer/models/lcc_girl.glb'

export class AvatarController {
  constructor(scene) {
    this.scene = scene
    this.root = new THREE.Group()
    this.root.visible = false
    this.scene.add(this.root)
    this.model = null
    this.mixer = null
    this.actions = new Map()
    this.activeAction = null
    this.ready = false
  }

  async load() {
    if (this.ready) return
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL)
    this.model = gltf.scene
    const bounds = new THREE.Box3().setFromObject(this.model)
    const size = bounds.getSize(new THREE.Vector3())
    const scale = 1.65 / Math.max(size.y, 0.01)
    this.model.scale.setScalar(scale)
    this.model.updateMatrixWorld(true)
    const scaledBounds = new THREE.Box3().setFromObject(this.model)
    this.model.position.y -= scaledBounds.min.y
    this.model.traverse((node) => {
      if (node.isMesh) {
        node.frustumCulled = true
        node.castShadow = false
      }
    })
    this.root.add(this.model)
    this.mixer = new THREE.AnimationMixer(this.model)
    for (const clip of gltf.animations) this.actions.set(clip.name.toLowerCase(), this.mixer.clipAction(clip))
    this.ready = true
    this.play('idle')
  }

  findAction(state) {
    const patterns = {
      idle: ['idle', 'stand', 'breath'],
      walk: ['walk'],
      run: ['run', 'sprint'],
      jump: ['jump'],
    }[state] || [state]
    for (const [name, action] of this.actions) {
      if (patterns.some((pattern) => name.includes(pattern))) return action
    }
    return this.actions.values().next().value || null
  }

  play(state) {
    if (!this.mixer) return
    const next = this.findAction(state)
    if (!next || next === this.activeAction) return
    next.reset().fadeIn(0.18).play()
    this.activeAction?.fadeOut(0.18)
    this.activeAction = next
  }

  setVisible(visible) {
    this.root.visible = Boolean(visible)
  }

  setPosition(position) {
    this.root.position.copy(position)
  }

  setHeading(yaw) {
    this.root.rotation.y = yaw
  }

  face(direction, dt) {
    if (direction.lengthSq() < 0.001) return this.root.rotation.y
    const target = Math.atan2(direction.x, direction.z)
    let delta = target - this.root.rotation.y
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    this.root.rotation.y += delta * Math.min(1, dt * 12)
    return this.root.rotation.y
  }

  update(dt) {
    this.mixer?.update(dt)
  }

  dispose() {
    this.scene.remove(this.root)
    this.mixer?.stopAllAction()
  }
}
