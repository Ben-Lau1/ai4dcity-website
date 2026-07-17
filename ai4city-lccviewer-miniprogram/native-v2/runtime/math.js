'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function perspective(fovY, aspect, near, far, output = new Float32Array(16)) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  output.fill(0);
  output[0] = f / aspect;
  output[5] = f;
  output[10] = (far + near) * nf;
  output[11] = -1;
  output[14] = 2 * far * near * nf;
  return output;
}

function lookAt(eye, target, up = [0, 1, 0], output = new Float32Array(16)) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let inverse = 1 / (Math.hypot(zx, zy, zz) || 1);
  zx *= inverse;
  zy *= inverse;
  zz *= inverse;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  inverse = 1 / (Math.hypot(xx, xy, xz) || 1);
  xx *= inverse;
  xy *= inverse;
  xz *= inverse;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  output[0] = xx;
  output[1] = yx;
  output[2] = zx;
  output[3] = 0;
  output[4] = xy;
  output[5] = yy;
  output[6] = zy;
  output[7] = 0;
  output[8] = xz;
  output[9] = yz;
  output[10] = zz;
  output[11] = 0;
  output[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  output[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  output[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  output[15] = 1;
  return output;
}

module.exports = { clamp, cross, dot, lookAt, normalize, perspective, subtract };
