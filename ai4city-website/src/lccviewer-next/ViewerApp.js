import { SCENES, getInitialScene } from './config/scenes.js'
import { SceneRuntime } from './render/SceneRuntime.js'
import { LccAdapter } from './render/LccAdapter.js'
import { InputManager } from './input/InputManager.js'
import { CollisionSystem } from './controls/CollisionSystem.js'
import { AvatarController } from './controls/AvatarController.js'
import { NavigationController } from './controls/NavigationController.js'
import { TrajectoryPlayer } from './features/TrajectoryPlayer.js'
import { ViewerUi } from './ui/ViewerUi.js'

export class ViewerApp {
  constructor() {
    this.runtime = new SceneRuntime(document.querySelector('#viewer-canvas'))
    this.adapter = new LccAdapter(this.runtime)
    this.collision = new CollisionSystem(this.adapter)
    this.avatar = new AvatarController(this.runtime.scene)
    this.navigation = new NavigationController(this.runtime.camera, this.collision, this.avatar)
    this.trajectory = new TrajectoryPlayer(this.navigation)
    this.input = new InputManager(
      this.runtime.canvas,
      document.querySelector('#joystick'),
      document.querySelector('#jump-button'),
    )
    this.ui = new ViewerUi(SCENES)
    this.scene = getInitialScene()
    this.loading = false
    this.lastFrame = performance.now()
    this.fpsTime = 0
    this.fpsFrames = 0
    this.loadGeneration = 0
    this.bindUi()
  }

  bindUi() {
    this.ui.on('mode', (mode) => {
      this.trajectory.stop()
      this.ui.setTrajectoryPlaying(false)
      this.navigation.setMode(mode)
      this.input.setMode(mode)
      this.ui.setMode(mode)
    })
    this.ui.on('reset', () => this.resetView())
    this.ui.on('trajectory', () => {
      const playing = this.trajectory.toggle()
      if (playing) {
        this.navigation.setMode('firstPerson')
        this.input.setMode('firstPerson')
        this.ui.setMode('firstPerson')
      }
      this.ui.setTrajectoryPlaying(playing)
    })
    this.ui.on('scene', (id) => this.loadScene(SCENES[id]))
    this.ui.on('retry', () => this.loadScene(this.scene))
    this.ui.on('collision', (enabled) => this.collision.setEnabled(enabled))
    this.ui.on('environment', (value) => this.runtime.setEnvironment(value))
    this.ui.on('quality', (level) => this.adapter.setQuality(level))
  }

  async start() {
    this.ui.setMode('firstPerson')
    this.input.setMode('firstPerson')
    requestAnimationFrame((time) => this.frame(time))
    this.avatar.load().catch((error) => console.warn('[LCCViewer] 角色模型加载失败', error))
    await this.loadScene(this.scene)
  }

  async loadScene(scene) {
    if (!scene || this.loading) return
    this.loading = true
    const generation = ++this.loadGeneration
    this.scene = scene
    this.trajectory.stop()
    this.ui.setTrajectoryPlaying(false)
    this.ui.setScene(scene)
    this.ui.showLoading(`加载 ${scene.label}`, 0)

    try {
      this.adapter.unload()
      this.ui.setProgress('读取场景轨迹', 0.02)
      await this.trajectory.load(scene.trajectory)
      const [start, next] = this.trajectory.getStart()
      if (start) this.navigation.setStart(start, next)
      await this.adapter.load(scene.lcc2, {
        onProgress: (progress) => {
          if (generation === this.loadGeneration) this.ui.setProgress('加载 LCC2 数据', 0.03 + progress * 0.91)
        },
      })
      if (generation !== this.loadGeneration) return
      this.ui.setProgress('初始化场景', 0.97)
      await this.avatar.load().catch(() => {})
      const available = this.collision.refresh()
      this.ui.setCollisionAvailable(available)
      this.resetView()
      this.ui.setProgress('完成', 1)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      this.ui.finishLoading()
    } catch (error) {
      if (generation === this.loadGeneration) this.ui.showError(error)
      console.error('[LCCViewer] 场景加载失败', error)
    } finally {
      if (generation === this.loadGeneration) this.loading = false
    }
  }

  resetView() {
    const [start, next] = this.trajectory.getStart()
    if (!start) return
    this.trajectory.stop()
    this.ui.setTrajectoryPlaying(false)
    this.navigation.setStart(start, next)
  }

  frame(time) {
    requestAnimationFrame((nextTime) => this.frame(nextTime))
    const dt = Math.min(0.05, Math.max(0.001, (time - this.lastFrame) / 1000))
    this.lastFrame = time
    const input = this.input.consume()
    if (this.trajectory.playing) this.trajectory.update(dt)
    else this.navigation.update(dt, input)
    this.adapter.update()
    this.runtime.render()

    this.fpsTime += dt
    this.fpsFrames += 1
    if (this.fpsTime >= 0.75) {
      this.ui.setFps(Math.round(this.fpsFrames / this.fpsTime))
      this.fpsTime = 0
      this.fpsFrames = 0
    }
  }
}
