const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export class InputManager {
  constructor(canvas, joystick, jumpButton) {
    this.canvas = canvas
    this.joystick = joystick
    this.thumb = joystick.querySelector('.joystick-thumb')
    this.jumpButton = jumpButton
    this.keys = new Set()
    this.pointers = new Map()
    this.lookPointer = null
    this.joystickPointer = null
    this.joystickOrigin = { x: 0, y: 0 }
    this.pinchDistance = null
    this.mode = 'firstPerson'
    this.move = { x: 0, z: 0 }
    this.frame = { yaw: 0, pitch: 0, panX: 0, panY: 0, zoom: 0, jump: false }
    this.enabled = true
    this.bind()
  }

  bind() {
    window.addEventListener('keydown', (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
      this.keys.add(event.code)
      if (event.code === 'Space' && !event.repeat) this.frame.jump = true
    }, { passive: false })
    window.addEventListener('keyup', (event) => this.keys.delete(event.code))
    window.addEventListener('blur', () => this.reset())

    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event))
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event))
    this.canvas.addEventListener('pointerup', (event) => this.onPointerUp(event))
    this.canvas.addEventListener('pointercancel', (event) => this.onPointerUp(event))
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault())
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault()
      this.frame.zoom += event.deltaY * 0.002
    }, { passive: false })

    this.jumpButton.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.frame.jump = true
      this.jumpButton.classList.add('pressed')
    })
    this.jumpButton.addEventListener('pointerup', () => this.jumpButton.classList.remove('pressed'))
    this.jumpButton.addEventListener('pointercancel', () => this.jumpButton.classList.remove('pressed'))
  }

  onPointerDown(event) {
    if (!this.enabled) return
    this.canvas.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType, button: event.button })
    const useJoystick = this.mode !== 'orbit' && event.pointerType === 'touch' && event.clientX < window.innerWidth * 0.46 && event.clientY > window.innerHeight * 0.42
    if (useJoystick && this.joystickPointer === null) {
      this.joystickPointer = event.pointerId
      this.joystickOrigin = { x: event.clientX, y: event.clientY }
      this.joystick.style.left = `${event.clientX}px`
      this.joystick.style.top = `${event.clientY}px`
      this.joystick.classList.remove('hidden')
    } else if (this.lookPointer === null) {
      this.lookPointer = event.pointerId
    }
  }

  onPointerMove(event) {
    const previous = this.pointers.get(event.pointerId)
    if (!previous) return
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    previous.x = event.clientX
    previous.y = event.clientY

    if (event.pointerType === 'touch') {
      const touches = [...this.pointers.entries()].filter(([id, pointer]) => id !== this.joystickPointer && pointer.type === 'touch')
      if (touches.length >= 2) {
        const a = touches[0][1]
        const b = touches[1][1]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (this.pinchDistance !== null) this.frame.zoom += (this.pinchDistance - distance) * 0.006
        this.pinchDistance = distance
        return
      }
      this.pinchDistance = null
    }

    if (event.pointerId === this.joystickPointer) {
      const radius = 44
      const rawX = event.clientX - this.joystickOrigin.x
      const rawY = event.clientY - this.joystickOrigin.y
      const length = Math.hypot(rawX, rawY) || 1
      const scale = Math.min(radius, length) / length
      const x = rawX * scale
      const y = rawY * scale
      this.thumb.style.transform = `translate(${x}px, ${y}px)`
      const amount = Math.min(1, length / radius)
      const deadzone = 0.16
      const strength = amount <= deadzone ? 0 : (amount - deadzone) / (1 - deadzone)
      this.move.x = (rawX / length) * strength
      this.move.z = (-rawY / length) * strength
      return
    }

    if (event.pointerId === this.lookPointer) {
      const mousePan = event.pointerType === 'mouse' && previous.button === 2
      if (mousePan) {
        this.frame.panX += dx
        this.frame.panY += dy
      } else {
        const sensitivity = event.pointerType === 'touch' ? 0.0042 : 0.003
        this.frame.yaw -= dx * sensitivity
        this.frame.pitch -= dy * sensitivity
      }
    }
  }

  onPointerUp(event) {
    this.pointers.delete(event.pointerId)
    if (event.pointerType === 'touch') this.pinchDistance = null
    if (event.pointerId === this.joystickPointer) {
      this.joystickPointer = null
      this.move.x = 0
      this.move.z = 0
      this.thumb.style.transform = 'translate(0, 0)'
      this.joystick.classList.add('hidden')
    }
    if (event.pointerId === this.lookPointer) this.lookPointer = null
  }

  consume() {
    const keyboardX = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0)
    const keyboardZ = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
    const snapshot = {
      moveX: clamp(this.move.x + keyboardX, -1, 1),
      moveZ: clamp(this.move.z + keyboardZ, -1, 1),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      ...this.frame,
    }
    this.frame = { yaw: 0, pitch: 0, panX: 0, panY: 0, zoom: 0, jump: false }
    return snapshot
  }

  setMode(mode) {
    this.mode = mode
    const mobileControls = (matchMedia('(pointer: coarse)').matches || window.innerWidth <= 760) && mode !== 'orbit'
    this.jumpButton.classList.toggle('hidden', !mobileControls)
    if (!mobileControls) this.joystick.classList.add('hidden')
  }

  reset() {
    this.keys.clear()
    this.pointers.clear()
    this.lookPointer = null
    this.joystickPointer = null
    this.pinchDistance = null
    this.move.x = 0
    this.move.z = 0
    this.frame = { yaw: 0, pitch: 0, panX: 0, panY: 0, zoom: 0, jump: false }
    this.joystick.classList.add('hidden')
  }
}
