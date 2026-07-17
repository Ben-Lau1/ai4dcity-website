'use strict';

const EYE_HEIGHT = 1.7;
const LOOK_HEIGHT = 1.55;
const LOOK_AHEAD_PROGRESS = 0.02;
const PLAYBACK_SPEED = 5;

function validPoint(point) {
  return Array.isArray(point)
    && point.length >= 3
    && point.slice(0, 3).every(Number.isFinite);
}

class TrajectoryPlayer {
  constructor(points, speed = PLAYBACK_SPEED) {
    this.points = (points || []).filter(validPoint).map((point) => point.slice(0, 3));
    this.speed = Math.max(0.1, Number(speed) || PLAYBACK_SPEED);
    this.segments = [];
    this.totalDistance = 0;
    this.elapsed = 0;
    this.playing = false;

    for (let index = 1; index < this.points.length; index += 1) {
      const previous = this.points[index - 1];
      const current = this.points[index];
      const distance = Math.hypot(
        current[0] - previous[0],
        current[1] - previous[1],
        current[2] - previous[2],
      );
      this.segments.push(distance);
      this.totalDistance += distance;
    }
  }

  canPlay() {
    return this.points.length > 1 && this.totalDistance > 0;
  }

  play() {
    if (!this.canPlay()) return false;
    this.playing = true;
    return true;
  }

  pause() {
    this.playing = false;
  }

  reset() {
    this.elapsed = 0;
    this.playing = false;
  }

  toggle() {
    if (this.playing) {
      this.pause();
      return false;
    }
    return this.play();
  }

  sample(progress) {
    if (!this.canPlay()) return null;
    let remaining = Math.max(0, Math.min(1, Number(progress) || 0)) * this.totalDistance;
    for (let index = 0; index < this.segments.length; index += 1) {
      const distance = this.segments[index];
      if (remaining <= distance || index === this.segments.length - 1) {
        const ratio = distance > 0 ? remaining / distance : 0;
        const start = this.points[index];
        const end = this.points[index + 1];
        return [
          start[0] + (end[0] - start[0]) * ratio,
          start[1] + (end[1] - start[1]) * ratio,
          start[2] + (end[2] - start[2]) * ratio,
        ];
      }
      remaining -= distance;
    }
    return this.points[this.points.length - 1].slice();
  }

  update(dt, cameraController) {
    if (!this.playing || !cameraController || !this.canPlay()) return false;
    const duration = this.totalDistance / this.speed;
    this.elapsed = (this.elapsed + Math.max(0, Number(dt) || 0)) % duration;
    const progress = this.elapsed / duration;
    const current = this.sample(progress);
    const next = this.sample(Math.min(1, progress + LOOK_AHEAD_PROGRESS));
    current[1] += EYE_HEIGHT;
    next[1] += LOOK_HEIGHT;
    cameraController.applyPlayback(current, next);
    return true;
  }

  getProgress() {
    if (!this.canPlay()) return 0;
    return this.elapsed / (this.totalDistance / this.speed);
  }
}

module.exports = { TrajectoryPlayer };
