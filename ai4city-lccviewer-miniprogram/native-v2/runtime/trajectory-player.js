'use strict';

const EYE_HEIGHT = 1.7;
const LOOK_HEIGHT = 1.55;
const LOOK_AHEAD_DISTANCE = 7;
const HEADING_RESPONSE = 5;
const MAX_HEADING_DT = 0.1;
const MAX_VERTICAL_LOOK_SLOPE = 0.35;
const MIN_POINT_DISTANCE = 0.05;
const PLAYBACK_SPEED = 5;

function validPoint(point) {
  return Array.isArray(point)
    && point.length >= 3
    && point.slice(0, 3).every(Number.isFinite);
}

function normalize(vector, fallback = [0, 0, 1]) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 0.000001) return fallback.slice();
  return vector.map((value) => value / length);
}

function cleanPoints(points) {
  const cleaned = [];
  (points || []).filter(validPoint).forEach((point) => {
    const current = point.slice(0, 3);
    const previous = cleaned[cleaned.length - 1];
    if (previous && Math.hypot(
      current[0] - previous[0],
      current[1] - previous[1],
      current[2] - previous[2],
    ) < MIN_POINT_DISTANCE) return;
    cleaned.push(current);
  });
  return cleaned;
}

class TrajectoryPlayer {
  constructor(points, speed = PLAYBACK_SPEED) {
    this.points = cleanPoints(points);
    this.speed = Math.max(0.1, Number(speed) || PLAYBACK_SPEED);
    this.segments = [];
    this.cumulativeDistances = [0];
    this.totalDistance = 0;
    this.elapsed = 0;
    this.playing = false;
    this.smoothedForward = null;

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
      this.cumulativeDistances.push(this.totalDistance);
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
    this.smoothedForward = null;
  }

  toggle() {
    if (this.playing) {
      this.pause();
      return false;
    }
    return this.play();
  }

  sampleDistance(requestedDistance) {
    if (!this.canPlay()) return null;
    const distance = Math.max(
      0,
      Math.min(this.totalDistance, Number(requestedDistance) || 0),
    );
    let low = 0;
    let high = this.segments.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) * 0.5);
      if (this.cumulativeDistances[middle + 1] < distance) low = middle + 1;
      else high = middle;
    }
    const segmentIndex = low;
    const segmentDistance = this.segments[segmentIndex];
    const segmentStartDistance = this.cumulativeDistances[segmentIndex];
    const ratio = segmentDistance > 0
      ? Math.max(0, Math.min(1, (distance - segmentStartDistance) / segmentDistance))
      : 0;
    const start = this.points[segmentIndex];
    const end = this.points[segmentIndex + 1];
    return [
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
      start[2] + (end[2] - start[2]) * ratio,
    ];
  }

  sample(progress) {
    const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
    return this.sampleDistance(normalized * this.totalDistance);
  }

  update(dt, cameraController) {
    if (!this.playing || !cameraController || !this.canPlay()) return false;
    const duration = this.totalDistance / this.speed;
    const delta = Math.max(0, Number(dt) || 0);
    const nextElapsed = this.elapsed + delta;
    const wrapped = nextElapsed >= duration;
    this.elapsed = nextElapsed % duration;
    const distance = this.elapsed * this.speed;
    const current = this.sampleDistance(distance);
    const next = this.sampleDistance(Math.min(
      this.totalDistance,
      distance + LOOK_AHEAD_DISTANCE,
    ));
    const horizontalDistance = Math.hypot(next[0] - current[0], next[2] - current[2]);
    const desiredForward = normalize([
      next[0] - current[0],
      Math.max(
        -horizontalDistance * MAX_VERTICAL_LOOK_SLOPE,
        Math.min(
          horizontalDistance * MAX_VERTICAL_LOOK_SLOPE,
          next[1] - current[1],
        ),
      ),
      next[2] - current[2],
    ], this.smoothedForward || [0, 0, 1]);
    if (!this.smoothedForward || wrapped) {
      this.smoothedForward = desiredForward;
    } else {
      const headingDt = Math.min(MAX_HEADING_DT, Math.max(0, delta));
      const blend = 1 - Math.exp(-HEADING_RESPONSE * headingDt);
      this.smoothedForward = normalize([
        this.smoothedForward[0]
          + (desiredForward[0] - this.smoothedForward[0]) * blend,
        this.smoothedForward[1]
          + (desiredForward[1] - this.smoothedForward[1]) * blend,
        this.smoothedForward[2]
          + (desiredForward[2] - this.smoothedForward[2]) * blend,
      ], desiredForward);
    }
    current[1] += EYE_HEIGHT;
    const target = [
      current[0] + this.smoothedForward[0] * LOOK_AHEAD_DISTANCE,
      current[1]
        + this.smoothedForward[1] * LOOK_AHEAD_DISTANCE
        + LOOK_HEIGHT - EYE_HEIGHT,
      current[2] + this.smoothedForward[2] * LOOK_AHEAD_DISTANCE,
    ];
    cameraController.applyPlayback(current, target);
    return true;
  }

  getProgress() {
    if (!this.canPlay()) return 0;
    return this.elapsed / (this.totalDistance / this.speed);
  }
}

module.exports = { TrajectoryPlayer };
