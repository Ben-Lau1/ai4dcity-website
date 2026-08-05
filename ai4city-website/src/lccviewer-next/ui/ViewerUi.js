import {
  createIcons,
  Orbit,
  ScanFace,
  PersonStanding,
  LocateFixed,
  Play,
  Pause,
  Map,
  CircleHelp,
  Settings2,
  X,
  MousePointer2,
  Move,
  ChevronsUp,
  Gauge,
  TriangleAlert,
} from 'lucide'

const icons = {
  Orbit,
  ScanFace,
  PersonStanding,
  LocateFixed,
  Play,
  Pause,
  Map,
  CircleHelp,
  Settings2,
  X,
  MousePointer2,
  Move,
  ChevronsUp,
  Gauge,
  TriangleAlert,
}

const MODE_LABELS = { orbit: '自由', firstPerson: '第一人称', avatar: '第三人称' }

export class ViewerUi {
  constructor(scenes) {
    this.scenes = scenes
    this.callbacks = {}
    this.elements = {
      sceneTitle: document.querySelector('#scene-title'),
      sceneMenu: document.querySelector('#scene-menu'),
      settings: document.querySelector('#settings-panel'),
      help: document.querySelector('#help-panel'),
      loadState: document.querySelector('#load-state'),
      modeState: document.querySelector('#mode-state'),
      fpsState: document.querySelector('#fps-state'),
      loading: document.querySelector('#loading-overlay'),
      loadingStage: document.querySelector('#loading-stage'),
      loadingPercent: document.querySelector('#loading-percent'),
      loadingProgress: document.querySelector('#loading-progress'),
      error: document.querySelector('#error-panel'),
      errorMessage: document.querySelector('#error-message'),
      play: document.querySelector('#trajectory-toggle'),
      collision: document.querySelector('#collision-toggle'),
    }
    this.buildSceneMenu()
    this.bind()
    createIcons({ icons })
  }

  on(name, callback) {
    this.callbacks[name] = callback
  }

  emit(name, value) {
    this.callbacks[name]?.(value)
  }

  bind() {
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => this.emit('mode', button.dataset.mode))
    })
    document.querySelector('#reset-view').addEventListener('click', () => this.emit('reset'))
    this.elements.play.addEventListener('click', () => this.emit('trajectory'))
    document.querySelector('#retry-load').addEventListener('click', () => this.emit('retry'))

    document.querySelector('#scene-menu-toggle').addEventListener('click', (event) => {
      event.stopPropagation()
      this.togglePanel(this.elements.sceneMenu)
    })
    document.querySelector('#settings-toggle').addEventListener('click', (event) => {
      event.stopPropagation()
      this.togglePanel(this.elements.settings)
    })
    document.querySelector('#help-toggle').addEventListener('click', (event) => {
      event.stopPropagation()
      this.togglePanel(this.elements.help)
    })
    document.querySelectorAll('.panel-close').forEach((button) => {
      button.addEventListener('click', () => button.closest('.side-panel, .help-panel')?.classList.add('hidden'))
    })
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#scene-menu, #scene-menu-toggle')) this.elements.sceneMenu.classList.add('hidden')
    })

    this.elements.collision.addEventListener('change', () => this.emit('collision', this.elements.collision.checked))
    document.querySelectorAll('#environment-control [data-value]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectValue('#environment-control', button.dataset.value)
        this.emit('environment', button.dataset.value)
      })
    })
    document.querySelectorAll('#quality-control [data-value]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectValue('#quality-control', button.dataset.value)
        this.emit('quality', Number(button.dataset.value))
      })
    })
  }

  togglePanel(panel) {
    const willOpen = panel.classList.contains('hidden')
    this.elements.sceneMenu.classList.add('hidden')
    this.elements.settings.classList.add('hidden')
    this.elements.help.classList.add('hidden')
    if (willOpen) panel.classList.remove('hidden')
  }

  selectValue(selector, value) {
    document.querySelectorAll(`${selector} [data-value]`).forEach((button) => button.classList.toggle('active', button.dataset.value === String(value)))
  }

  buildSceneMenu() {
    this.elements.sceneMenu.replaceChildren()
    Object.values(this.scenes).forEach((scene) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'scene-option'
      button.dataset.scene = scene.id
      const marker = document.createElement('i')
      marker.className = 'scene-marker'
      const copy = document.createElement('span')
      const name = document.createElement('strong')
      const description = document.createElement('small')
      name.textContent = scene.label
      description.textContent = scene.description
      copy.append(name, description)
      button.append(marker, copy)
      button.addEventListener('click', () => {
        this.elements.sceneMenu.classList.add('hidden')
        this.emit('scene', scene.id)
      })
      this.elements.sceneMenu.append(button)
    })
  }

  setScene(scene) {
    this.elements.sceneTitle.textContent = scene.label
    this.elements.sceneMenu.querySelectorAll('[data-scene]').forEach((button) => button.classList.toggle('active', button.dataset.scene === scene.id))
  }

  setMode(mode) {
    document.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === mode
      button.classList.toggle('active', active)
      button.setAttribute('aria-selected', String(active))
    })
    this.elements.modeState.textContent = MODE_LABELS[mode]
  }

  setTrajectoryPlaying(playing) {
    this.elements.play.classList.toggle('active', playing)
    this.elements.play.setAttribute('aria-label', playing ? '暂停轨迹' : '播放轨迹')
    this.elements.play.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}"></i>`
    createIcons({ icons, attrs: { 'aria-hidden': 'true' } })
  }

  setCollisionAvailable(available) {
    this.elements.collision.disabled = !available
    if (!available) this.elements.collision.checked = false
  }

  showLoading(stage = '准备场景', progress = 0) {
    this.elements.error.classList.add('hidden')
    this.elements.loading.classList.remove('hidden')
    this.setProgress(stage, progress)
  }

  setProgress(stage, progress) {
    const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100)
    this.elements.loadingStage.textContent = stage
    this.elements.loadingPercent.textContent = `${percent}%`
    this.elements.loadingProgress.style.width = `${percent}%`
    this.elements.loadState.innerHTML = '<b class="status-dot"></b>加载场景'
  }

  finishLoading() {
    this.elements.loading.classList.add('hidden')
    this.elements.loadState.innerHTML = '<b class="status-dot ready"></b>LCC2 原生渲染'
  }

  showError(error) {
    this.elements.loading.classList.add('hidden')
    this.elements.error.classList.remove('hidden')
    this.elements.errorMessage.textContent = error?.message || String(error)
    this.elements.loadState.innerHTML = '<b class="status-dot error"></b>加载失败'
  }

  setFps(fps) {
    this.elements.fpsState.textContent = `${fps} FPS`
  }
}
