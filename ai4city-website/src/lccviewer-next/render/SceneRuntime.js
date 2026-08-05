import * as THREE from 'three'

const SKYBOX_PATHS = [1, 2, 3, 4, 5, 6].map((index) => `/lccviewer/textures/skybox/${index}.jpg`)

export class SceneRuntime {
  constructor(canvas) {
    this.canvas = canvas
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000)
    this.camera.rotation.order = 'YXZ'
    this.camera.position.set(0, 15, 25)

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25))

    this.darkColor = new THREE.Color(0x080b0e)
    this.scene.background = this.darkColor
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x26313a, 1.4))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(10, 30, 10)
    this.scene.add(key)

    this.skybox = null
    this.environment = 'dark'
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas.parentElement)
    this.resize()
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  async setEnvironment(value) {
    this.environment = value
    if (value === 'sky') {
      if (!this.skybox) {
        this.skybox = await new THREE.CubeTextureLoader().loadAsync(SKYBOX_PATHS)
        this.skybox.colorSpace = THREE.SRGBColorSpace
      }
      this.scene.background = this.skybox
      return
    }
    this.scene.background = this.darkColor
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.resizeObserver.disconnect()
    this.renderer.dispose()
    this.skybox?.dispose()
  }
}

export { THREE }

