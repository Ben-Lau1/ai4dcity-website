import { THREE } from '../render/SceneRuntime.js'

const toThree = (point) => new THREE.Vector3(-point.x, point.z, point.y)

export class TrajectoryPlayer {
  constructor(navigation) {
    this.navigation = navigation
    this.points = []
    this.segments = []
    this.totalDistance = 0
    this.elapsed = 0
    this.speed = 5
    this.playing = false
  }

  async load(url) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`轨迹数据请求失败 (${response.status})`)
    const data = await response.json()
    if (!Array.isArray(data) || data.length < 2) throw new Error('轨迹数据为空')
    this.points = data.map(toThree)
    this.segments = []
    this.totalDistance = 0
    for (let index = 1; index < this.points.length; index += 1) {
      const distance = this.points[index].distanceTo(this.points[index - 1])
      this.segments.push(distance)
      this.totalDistance += distance
    }
    this.elapsed = 0
    this.playing = false
    return this.points
  }

  getStart() {
    return [this.points[0]?.clone(), this.points[1]?.clone()]
  }

  toggle() {
    if (!this.points.length) return false
    this.playing = !this.playing
    if (!this.playing) this.navigation.stopPlayback()
    return this.playing
  }

  stop() {
    this.playing = false
    this.navigation.stopPlayback()
  }

  sample(progress) {
    let remaining = Math.max(0, Math.min(1, progress)) * this.totalDistance
    for (let index = 0; index < this.segments.length; index += 1) {
      const distance = this.segments[index]
      if (remaining <= distance || index === this.segments.length - 1) {
        return this.points[index].clone().lerp(this.points[index + 1], distance ? remaining / distance : 0)
      }
      remaining -= distance
    }
    return this.points.at(-1).clone()
  }

  update(dt) {
    if (!this.playing || this.totalDistance <= 0) return
    const duration = this.totalDistance / this.speed
    this.elapsed = (this.elapsed + dt) % duration
    const progress = this.elapsed / duration
    const current = this.sample(progress)
    const next = this.sample(Math.min(1, progress + 0.002))
    current.y += 1.7
    next.y += 1.55
    this.navigation.applyPlayback(current, next)
  }
}

