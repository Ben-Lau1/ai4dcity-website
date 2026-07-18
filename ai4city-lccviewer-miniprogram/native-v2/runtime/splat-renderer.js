'use strict';

const VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform mat4 uView;
uniform mat4 uProjection;
uniform vec2 uViewport;
uniform int uTextureWidth;
uniform int uIndexWidth;
uniform int uCount;
uniform int uIndexStride;
uniform float uSampleCompensation;
uniform float uSampleFootprintScale;
uniform int uTransformPass;
uniform sampler2D uMeansLow;
uniform sampler2D uMeansHigh;
uniform sampler2D uQuats;
uniform sampler2D uScales;
uniform sampler2D uColors;
uniform highp usampler2D uIndexes;
uniform vec3 uMeansMin;
uniform vec3 uMeansMax;
uniform vec4 uScaleCodebook[64];
uniform vec4 uColorCodebook[64];

flat out vec3 vColor;
flat out float vOpacity;
out vec2 vLocal;
out vec4 tfClipCenter;
out vec4 tfAxes;
out vec4 tfColorOpacity;
out float tfCrop;

float scaleCode(uint index) {
  return uScaleCodebook[int(index >> 2u)][int(index & 3u)];
}

float colorCode(uint index) {
  return uColorCodebook[int(index >> 2u)][int(index & 3u)];
}

vec3 decodeCenter(ivec2 uv) {
  vec3 low = texelFetch(uMeansLow, uv, 0).rgb;
  vec3 high = texelFetch(uMeansHigh, uv, 0).rgb;
  vec3 normalized = (low + high * 256.0) / 257.0;
  vec3 encoded = mix(uMeansMin, uMeansMax, normalized);
  vec3 source = sign(encoded) * (exp(abs(encoded)) - 1.0);
  return vec3(-source.x, source.z, source.y);
}

vec4 decodeQuaternion(ivec2 uv) {
  uvec4 bytes = uvec4(round(texelFetch(uQuats, uv, 0) * 255.0));
  uint mode = (bytes.a - 252u) & 3u;
  vec3 abc = (vec3(bytes.rgb) / 255.0 - 0.5) * 1.41421356237;
  float d = sqrt(max(0.0, 1.0 - dot(abc, abc)));
  if (mode == 0u) return vec4(d, abc);
  if (mode == 1u) return vec4(abc.x, d, abc.yz);
  if (mode == 2u) return vec4(abc.xy, d, abc.z);
  return vec4(abc, d);
}

mat3 sourceCovariance(ivec2 uv) {
  uvec3 scaleBytes = uvec3(round(texelFetch(uScales, uv, 0).rgb * 255.0));
  vec3 scale = exp(vec3(scaleCode(scaleBytes.x), scaleCode(scaleBytes.y), scaleCode(scaleBytes.z)));
  vec4 q = decodeQuaternion(uv);
  float w = q.x, x = q.y, y = q.z, z = q.w;
  float x2 = x + x, y2 = y + y, z2 = z + z;
  float xx = x * x2, yy = y * y2, zz = z * z2;
  float xy = x * y2, xz = x * z2, yz = y * z2;
  float wx = w * x2, wy = w * y2, wz = w * z2;
  mat3 transform = mat3(
    scale.x * (1.0 - yy - zz), scale.y * (xy - wz), scale.z * (xz + wy),
    scale.x * (xy + wz), scale.y * (1.0 - xx - zz), scale.z * (yz - wx),
    scale.x * (xz - wy), scale.y * (yz + wx), scale.z * (1.0 - xx - yy)
  );
  return transpose(transform) * transform;
}

vec3 decodeColor(ivec2 uv, out float opacity) {
  vec4 sampleValue = texelFetch(uColors, uv, 0);
  uvec3 bytes = uvec3(round(sampleValue.rgb * 255.0));
  opacity = sampleValue.a;
  vec3 sh = vec3(colorCode(bytes.x), colorCode(bytes.y), colorCode(bytes.z));
  return clamp(sh * 0.28209479177 + 0.5, 0.0, 1.0);
}

vec2 quadCorner(int id) {
  if (id == 0) return vec2(-1.0, -1.0);
  if (id == 1) return vec2(1.0, -1.0);
  if (id == 2) return vec2(-1.0, 1.0);
  return vec2(1.0, 1.0);
}

void main() {
  int order = uTransformPass != 0 ? gl_VertexID : gl_InstanceID;
  vColor = vec3(0.0);
  vOpacity = 0.0;
  vLocal = vec2(0.0);
  tfClipCenter = vec4(2.0, 2.0, 2.0, 0.0);
  tfAxes = vec4(0.0);
  tfColorOpacity = vec4(0.0);
  tfCrop = 0.0;
  if (order >= uCount) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  int sourceOrder = order * uIndexStride;
  ivec2 orderUv = ivec2(sourceOrder % uIndexWidth, sourceOrder / uIndexWidth);
  uint index = texelFetch(uIndexes, orderUv, 0).r;
  ivec2 uv = ivec2(int(index) % uTextureWidth, int(index) / uTextureWidth);
  vec3 center = decodeCenter(uv);
  vec4 viewCenter = uView * vec4(center, 1.0);
  vec4 clipCenter = uProjection * viewCenter;
  if (clipCenter.w <= 0.0 || abs(clipCenter.x) > clipCenter.w * 1.25 || abs(clipCenter.y) > clipCenter.w * 1.25) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vOpacity = 0.0;
    return;
  }

  mat3 axisSwap = mat3(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0);
  mat3 covariance = axisSwap * sourceCovariance(uv) * transpose(axisSwap);
  mat3 viewRotation = mat3(uView);
  mat3 cameraCovariance = viewRotation * covariance * transpose(viewRotation);
  float depth = max(0.01, -viewCenter.z);
  float focalX = uProjection[0][0] * uViewport.x * 0.5;
  float focalY = uProjection[1][1] * uViewport.y * 0.5;
  mat3 jacobian = mat3(
    focalX / depth, 0.0, 0.0,
    0.0, focalY / depth, 0.0,
    focalX * viewCenter.x / (depth * depth), focalY * viewCenter.y / (depth * depth), 0.0
  );
  mat3 projected = jacobian * cameraCovariance * transpose(jacobian);
  float determinantBefore = max(
    projected[0][0] * projected[1][1] - projected[1][0] * projected[1][0],
    0.0
  );
  float a = projected[0][0] + 0.1;
  float b = projected[1][0];
  float c = projected[1][1] + 0.1;
  float determinantAfter = max(a * c - b * b, 0.000001);
  float lowPassOpacity = sqrt(
    determinantBefore / (determinantAfter + 0.000001) + 0.000001
  );
  float midpoint = 0.5 * (a + c);
  float radius = length(vec2(0.5 * (a - c), b));
  float lambda1 = max(0.1, midpoint + radius);
  float lambda2 = max(0.1, midpoint - radius);
  vColor = decodeColor(uv, vOpacity);
  vOpacity *= lowPassOpacity;
  vOpacity = 1.0 - pow(
    max(1.0 - clamp(vOpacity, 0.0, 0.999999), 0.000001),
    uSampleCompensation
  );
  if (vOpacity < 0.00392) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float crop = min(1.0, sqrt(max(-log(0.00392 / vOpacity), 0.0)) * 0.5);
  float extent1 = 2.0 * min(sqrt(2.0 * lambda1), 1024.0) * crop * uSampleFootprintScale;
  float extent2 = 2.0 * min(sqrt(2.0 * lambda2), 1024.0) * crop * uSampleFootprintScale;
  if (max(extent1, extent2) < 0.3) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 eigen1 = abs(b) > 0.00001
    ? normalize(vec2(b, lambda1 - a))
    : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 eigen2 = vec2(eigen1.y, -eigen1.x);
  vec2 axis1 = eigen1 * extent1;
  vec2 axis2 = eigen2 * extent2;
  tfClipCenter = clipCenter;
  tfAxes = vec4(axis1, axis2);
  tfColorOpacity = vec4(vColor, vOpacity);
  tfCrop = crop;
  if (uTransformPass != 0) {
    gl_Position = clipCenter;
    return;
  }
  vec2 corner = quadCorner(gl_VertexID);
  vec2 offset = (corner.x * axis1 + corner.y * axis2) / uViewport * 2.0;
  gl_Position = vec4(clipCenter.xy + offset * clipCenter.w, clipCenter.zw);
  vLocal = corner * 2.0 * crop;
}
`;

const PREDECODE_VERTEX_SHADER = `#version 300 es
precision highp float;
void main() {
  vec2 position;
  if (gl_VertexID == 0) position = vec2(-1.0, -1.0);
  else if (gl_VertexID == 1) position = vec2(3.0, -1.0);
  else position = vec2(-1.0, 3.0);
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const PREDECODE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform int uTextureWidth;
uniform int uCount;
uniform sampler2D uMeansLow;
uniform sampler2D uMeansHigh;
uniform sampler2D uQuats;
uniform sampler2D uScales;
uniform sampler2D uColors;
uniform vec3 uMeansMin;
uniform vec3 uMeansMax;
uniform vec4 uScaleCodebook[64];
uniform vec4 uColorCodebook[64];
uniform int uOutputPart;

layout(location = 0) out uvec4 outDecoded;

float scaleCode(uint index) {
  return uScaleCodebook[int(index >> 2u)][int(index & 3u)];
}

float colorCode(uint index) {
  return uColorCodebook[int(index >> 2u)][int(index & 3u)];
}

vec3 decodeCenter(ivec2 uv) {
  vec3 low = texelFetch(uMeansLow, uv, 0).rgb;
  vec3 high = texelFetch(uMeansHigh, uv, 0).rgb;
  vec3 normalized = (low + high * 256.0) / 257.0;
  vec3 encoded = mix(uMeansMin, uMeansMax, normalized);
  vec3 source = sign(encoded) * (exp(abs(encoded)) - 1.0);
  return vec3(-source.x, source.z, source.y);
}

vec4 decodeQuaternion(ivec2 uv) {
  uvec4 bytes = uvec4(round(texelFetch(uQuats, uv, 0) * 255.0));
  uint mode = (bytes.a - 252u) & 3u;
  vec3 abc = (vec3(bytes.rgb) / 255.0 - 0.5) * 1.41421356237;
  float d = sqrt(max(0.0, 1.0 - dot(abc, abc)));
  if (mode == 0u) return vec4(d, abc);
  if (mode == 1u) return vec4(abc.x, d, abc.yz);
  if (mode == 2u) return vec4(abc.xy, d, abc.z);
  return vec4(abc, d);
}

mat3 sourceCovariance(ivec2 uv) {
  uvec3 scaleBytes = uvec3(round(texelFetch(uScales, uv, 0).rgb * 255.0));
  vec3 scale = exp(vec3(scaleCode(scaleBytes.x), scaleCode(scaleBytes.y), scaleCode(scaleBytes.z)));
  vec4 q = decodeQuaternion(uv);
  float w = q.x, x = q.y, y = q.z, z = q.w;
  float x2 = x + x, y2 = y + y, z2 = z + z;
  float xx = x * x2, yy = y * y2, zz = z * z2;
  float xy = x * y2, xz = x * z2, yz = y * z2;
  float wx = w * x2, wy = w * y2, wz = w * z2;
  mat3 transform = mat3(
    scale.x * (1.0 - yy - zz), scale.y * (xy - wz), scale.z * (xz + wy),
    scale.x * (xy + wz), scale.y * (1.0 - xx - zz), scale.z * (yz - wx),
    scale.x * (xz - wy), scale.y * (yz + wx), scale.z * (1.0 - xx - yy)
  );
  return transpose(transform) * transform;
}

vec3 decodeColor(ivec2 uv, out float opacity) {
  vec4 sampleValue = texelFetch(uColors, uv, 0);
  uvec3 bytes = uvec3(round(sampleValue.rgb * 255.0));
  opacity = sampleValue.a;
  vec3 sh = vec3(colorCode(bytes.x), colorCode(bytes.y), colorCode(bytes.z));
  return clamp(sh * 0.28209479177 + 0.5, 0.0, 1.0);
}

uint packFiniteHalf2(vec2 value) {
  return packHalf2x16(clamp(value, vec2(-65504.0), vec2(65504.0)));
}

void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  int index = uv.y * uTextureWidth + uv.x;
  if (index >= uCount) {
    outDecoded = uvec4(0u);
    return;
  }

  vec3 center = decodeCenter(uv);
  mat3 axisSwap = mat3(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0);
  mat3 covariance = axisSwap * sourceCovariance(uv) * transpose(axisSwap);
  float opacity;
  vec3 color = decodeColor(uv, opacity);

  uvec4 decodedA = uvec4(
    floatBitsToUint(center),
    packFiniteHalf2(vec2(covariance[0][0], covariance[0][1]))
  );
  uvec4 decodedB = uvec4(
    packFiniteHalf2(vec2(covariance[0][2], covariance[1][1])),
    packFiniteHalf2(vec2(covariance[1][2], covariance[2][2])),
    packFiniteHalf2(color.rg),
    packFiniteHalf2(vec2(color.b, opacity))
  );
  outDecoded = uOutputPart == 0 ? decodedA : decodedB;
}
`;

const FAST_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform mat4 uView;
uniform mat4 uProjection;
uniform vec2 uViewport;
uniform int uTextureWidth;
uniform int uIndexWidth;
uniform int uCount;
uniform int uIndexStride;
uniform float uSampleCompensation;
uniform float uSampleFootprintScale;
uniform int uTransformPass;
uniform highp usampler2D uDecodedA;
uniform highp usampler2D uDecodedB;
uniform highp usampler2D uIndexes;

flat out vec3 vColor;
flat out float vOpacity;
out vec2 vLocal;
out vec4 tfClipCenter;
out vec4 tfAxes;
out vec4 tfColorOpacity;
out float tfCrop;

vec2 quadCorner(int id) {
  if (id == 0) return vec2(-1.0, -1.0);
  if (id == 1) return vec2(1.0, -1.0);
  if (id == 2) return vec2(-1.0, 1.0);
  return vec2(1.0, 1.0);
}

void main() {
  int order = uTransformPass != 0 ? gl_VertexID : gl_InstanceID;
  vColor = vec3(0.0);
  vOpacity = 0.0;
  vLocal = vec2(0.0);
  tfClipCenter = vec4(2.0, 2.0, 2.0, 0.0);
  tfAxes = vec4(0.0);
  tfColorOpacity = vec4(0.0);
  tfCrop = 0.0;
  if (order >= uCount) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  int sourceOrder = order * uIndexStride;
  ivec2 orderUv = ivec2(sourceOrder % uIndexWidth, sourceOrder / uIndexWidth);
  uint index = texelFetch(uIndexes, orderUv, 0).r;
  ivec2 uv = ivec2(int(index) % uTextureWidth, int(index) / uTextureWidth);
  uvec4 decodedA = texelFetch(uDecodedA, uv, 0);
  vec3 center = uintBitsToFloat(decodedA.xyz);
  vec4 viewCenter = uView * vec4(center, 1.0);
  vec4 clipCenter = uProjection * viewCenter;
  if (clipCenter.w <= 0.0 || abs(clipCenter.x) > clipCenter.w * 1.25 || abs(clipCenter.y) > clipCenter.w * 1.25) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vOpacity = 0.0;
    return;
  }

  uvec4 decodedB = texelFetch(uDecodedB, uv, 0);
  vec2 covariance0 = unpackHalf2x16(decodedA.w);
  vec2 covariance1 = unpackHalf2x16(decodedB.x);
  vec2 covariance2 = unpackHalf2x16(decodedB.y);
  mat3 covariance = mat3(
    covariance0.x, covariance0.y, covariance1.x,
    covariance0.y, covariance1.y, covariance2.x,
    covariance1.x, covariance2.x, covariance2.y
  );
  vec2 colorRg = unpackHalf2x16(decodedB.z);
  vec2 colorBo = unpackHalf2x16(decodedB.w);
  vColor = vec3(colorRg, colorBo.x);
  vOpacity = colorBo.y;

  float depth = max(0.01, -viewCenter.z);
  float focalX = uProjection[0][0] * uViewport.x * 0.5;
  float focalY = uProjection[1][1] * uViewport.y * 0.5;
  float inverseDepth = 1.0 / depth;
  float inverseDepthSquared = inverseDepth * inverseDepth;
  vec3 jacobianX = vec3(
    focalX * inverseDepth,
    0.0,
    focalX * viewCenter.x * inverseDepthSquared
  );
  vec3 jacobianY = vec3(
    0.0,
    focalY * inverseDepth,
    focalY * viewCenter.y * inverseDepthSquared
  );
  mat3 inverseViewRotation = transpose(mat3(uView));
  vec3 worldJacobianX = inverseViewRotation * jacobianX;
  vec3 worldJacobianY = inverseViewRotation * jacobianY;
  vec3 covarianceX = covariance * worldJacobianX;
  vec3 covarianceY = covariance * worldJacobianY;
  float projectedA = dot(worldJacobianX, covarianceX);
  float projectedB = dot(worldJacobianX, covarianceY);
  float projectedC = dot(worldJacobianY, covarianceY);
  float determinantBefore = max(projectedA * projectedC - projectedB * projectedB, 0.0);
  float a = projectedA + 0.1;
  float b = projectedB;
  float c = projectedC + 0.1;
  float determinantAfter = max(a * c - b * b, 0.000001);
  float lowPassOpacity = sqrt(
    determinantBefore / (determinantAfter + 0.000001) + 0.000001
  );
  float midpoint = 0.5 * (a + c);
  float radius = length(vec2(0.5 * (a - c), b));
  float lambda1 = max(0.1, midpoint + radius);
  float lambda2 = max(0.1, midpoint - radius);
  vOpacity *= lowPassOpacity;
  vOpacity = 1.0 - pow(
    max(1.0 - clamp(vOpacity, 0.0, 0.999999), 0.000001),
    uSampleCompensation
  );
  if (vOpacity < 0.00392) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float crop = min(1.0, sqrt(max(-log(0.00392 / vOpacity), 0.0)) * 0.5);
  float extent1 = 2.0 * min(sqrt(2.0 * lambda1), 1024.0) * crop * uSampleFootprintScale;
  float extent2 = 2.0 * min(sqrt(2.0 * lambda2), 1024.0) * crop * uSampleFootprintScale;
  if (max(extent1, extent2) < 0.3) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 eigen1 = abs(b) > 0.00001
    ? normalize(vec2(b, lambda1 - a))
    : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 eigen2 = vec2(eigen1.y, -eigen1.x);
  vec2 axis1 = eigen1 * extent1;
  vec2 axis2 = eigen2 * extent2;
  tfClipCenter = clipCenter;
  tfAxes = vec4(axis1, axis2);
  tfColorOpacity = vec4(vColor, vOpacity);
  tfCrop = crop;
  if (uTransformPass != 0) {
    gl_Position = clipCenter;
    return;
  }
  vec2 corner = quadCorner(gl_VertexID);
  vec2 offset = (corner.x * axis1 + corner.y * axis2) / uViewport * 2.0;
  gl_Position = vec4(clipCenter.xy + offset * clipCenter.w, clipCenter.zw);
  vLocal = corner * 2.0 * crop;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
flat in vec3 vColor;
flat in float vOpacity;
in vec2 vLocal;
out vec4 outColor;
void main() {
  float exponent = -dot(vLocal, vLocal);
  if (exponent < -4.0) discard;
  float alpha = exp(exponent) * vOpacity;
  if (alpha < 0.00392) discard;
  outColor = vec4(vColor, alpha);
}
`;

const TRANSFORM_FEEDBACK_VARYINGS = [
  'tfClipCenter',
  'tfAxes',
  'tfColorOpacity',
  'tfCrop',
];

// FP16 covariance predecode corrupts large outdoor splats. Keep the transform
// feedback projection pass, but decode source covariance at full precision.
const ENABLE_HALF_FLOAT_PREDECODE = false;

// A transform-feedback projection pass writes roughly 52 bytes per visible
// splat on every frame. On mobile GPUs that extra bandwidth is slower than the
// direct vertex path and can leak raw GL state into Three.js avatar rendering.
// The direct path keeps the original source precision and display quality.
const ENABLE_TRANSFORM_FEEDBACK_PROJECTION = false;

const EXPAND_VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aClipCenter;
layout(location = 1) in vec4 aAxes;
layout(location = 2) in vec4 aColorOpacity;
layout(location = 3) in float aCrop;
uniform vec2 uViewport;
flat out vec3 vColor;
flat out float vOpacity;
out vec2 vLocal;

vec2 quadCorner(int id) {
  if (id == 0) return vec2(-1.0, -1.0);
  if (id == 1) return vec2(1.0, -1.0);
  if (id == 2) return vec2(-1.0, 1.0);
  return vec2(1.0, 1.0);
}

void main() {
  vColor = aColorOpacity.rgb;
  vOpacity = aColorOpacity.a;
  vec2 corner = quadCorner(gl_VertexID);
  if (aClipCenter.w <= 0.0 || vOpacity < 0.00392 || aCrop <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLocal = vec2(0.0);
    return;
  }
  vec2 offset = (corner.x * aAxes.xy + corner.y * aAxes.zw) / uViewport * 2.0;
  gl_Position = vec4(
    aClipCenter.xy + offset * aClipCenter.w,
    aClipCenter.zw
  );
  vLocal = corner * 2.0 * aCrop;
}
`;

const AVATAR_VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aPart;
uniform mat4 uView;
uniform mat4 uProjection;
uniform vec3 uActor;
uniform float uHeading;
uniform float uMotion;
uniform float uAirborne;
uniform float uTime;
out vec3 vAvatarColor;
out float vLight;

vec3 rotateX(vec3 value, float angle) {
  float c = cos(angle), s = sin(angle);
  return vec3(value.x, value.y * c - value.z * s, value.y * s + value.z * c);
}

vec3 rotateY(vec3 value, float angle) {
  float c = cos(angle), s = sin(angle);
  return vec3(value.x * c + value.z * s, value.y, -value.x * s + value.z * c);
}

void main() {
  vec3 position = aPosition;
  vec3 normal = aNormal;
  float stride = sin(uTime * mix(3.4, 8.2, step(1.5, uMotion))) * min(uMotion, 1.0) * 0.72;
  float limbAngle = 0.0;
  vec3 pivot = vec3(0.0);
  if (aPart == 1.0) { limbAngle = stride; pivot = vec3(-0.15, 0.91, 0.0); }
  else if (aPart == 2.0) { limbAngle = -stride; pivot = vec3(0.15, 0.91, 0.0); }
  else if (aPart == 3.0) { limbAngle = -stride * 0.72; pivot = vec3(-0.37, 1.48, 0.0); }
  else if (aPart == 4.0) { limbAngle = stride * 0.72; pivot = vec3(0.37, 1.48, 0.0); }
  if (aPart >= 1.0 && aPart <= 4.0) {
    position = pivot + rotateX(position - pivot, limbAngle);
    normal = rotateX(normal, limbAngle);
  }
  if (uAirborne > 0.5 && (aPart == 1.0 || aPart == 2.0)) {
    position = vec3(position.x, position.y + 0.08, position.z - 0.08);
  }
  position = rotateY(position, uHeading);
  normal = rotateY(normal, uHeading);
  vec3 lightDirection = normalize(vec3(0.35, 0.85, 0.4));
  vLight = 0.42 + max(dot(normal, lightDirection), 0.0) * 0.58;
  vAvatarColor = aColor;
  gl_Position = uProjection * uView * vec4(uActor + position, 1.0);
}
`;

const AVATAR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vAvatarColor;
in float vLight;
out vec4 outColor;
void main() {
  outColor = vec4(vAvatarColor * vLight, 1.0);
}
`;

function appendBox(target, center, size, color, part) {
  const x0 = center[0] - size[0] * 0.5;
  const x1 = center[0] + size[0] * 0.5;
  const y0 = center[1] - size[1] * 0.5;
  const y1 = center[1] + size[1] * 0.5;
  const z0 = center[2] - size[2] * 0.5;
  const z1 = center[2] + size[2] * 0.5;
  const faces = [
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
  ];
  const order = [0, 1, 2, 0, 2, 3];
  faces.forEach((face) => {
    order.forEach((index) => {
      target.push(...face[index], ...face[4], ...color, part);
    });
  });
}

function createAvatarGeometry(gl, vao) {
  const values = [];
  appendBox(values, [0, 1.2, 0], [0.58, 0.64, 0.3], [0.82, 0.18, 0.38], 0);
  appendBox(values, [0, 1.69, 0], [0.36, 0.36, 0.34], [0.94, 0.69, 0.52], 0);
  appendBox(values, [0, 1.82, -0.06], [0.39, 0.16, 0.36], [0.18, 0.11, 0.08], 0);
  appendBox(values, [-0.15, 0.48, 0], [0.22, 0.86, 0.25], [0.12, 0.16, 0.22], 1);
  appendBox(values, [0.15, 0.48, 0], [0.22, 0.86, 0.25], [0.12, 0.16, 0.22], 2);
  appendBox(values, [-0.4, 1.17, 0], [0.18, 0.68, 0.2], [0.94, 0.69, 0.52], 3);
  appendBox(values, [0.4, 1.17, 0], [0.18, 0.68, 0.2], [0.94, 0.69, 0.52], 4);
  const data = new Float32Array(values);
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = 10 * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 9 * 4);
  gl.bindVertexArray(null);
  return { buffer, count: data.length / 10 };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function createProgram(gl, vertex, fragment, options = {}) {
  const program = gl.createProgram();
  const vertexShader = compile(gl, gl.VERTEX_SHADER, vertex);
  let fragmentShader;
  try {
    fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragment);
  } catch (error) {
    gl.deleteShader(vertexShader);
    gl.deleteProgram(program);
    throw error;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  if (options.transformFeedbackVaryings && options.transformFeedbackVaryings.length) {
    gl.transformFeedbackVaryings(
      program,
      options.transformFeedbackVaryings,
      gl.INTERLEAVED_ATTRIBS,
    );
  }
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

function createImageTexture(gl, image, channels) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const format = channels === 4 ? gl.RGBA : gl.RGB;
  const internal = channels === 4 ? gl.RGBA8 : gl.RGB8;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, format, gl.UNSIGNED_BYTE, image);
  return texture;
}

function createUintTexture(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32UI,
    width,
    height,
    0,
    gl.RGBA_INTEGER,
    gl.UNSIGNED_INT,
    null,
  );
  return texture;
}

class SplatRenderer {
  constructor(gl, width, height, options = {}) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.vao = gl.createVertexArray();
    this.avatarProgram = null;
    this.avatarVao = null;
    this.avatarBuffer = null;
    this.avatarVertexCount = 0;
    this.avatarResourcesEnabled = options.enableFallbackAvatar !== false;
    if (this.avatarResourcesEnabled) {
      this.avatarProgram = createProgram(gl, AVATAR_VERTEX_SHADER, AVATAR_FRAGMENT_SHADER);
      this.avatarVao = gl.createVertexArray();
      const avatarGeometry = createAvatarGeometry(gl, this.avatarVao);
      this.avatarBuffer = avatarGeometry.buffer;
      this.avatarVertexCount = avatarGeometry.count;
    }
    this.dataTextures = [];
    this.decodedTextures = [];
    this.fastProgram = null;
    this.fastUniforms = null;
    this.fastAttempted = false;
    this.fastReady = false;
    this.fastError = '';
    this.projectionAttempted = false;
    this.projectionReady = false;
    this.projectionValidated = false;
    this.projectionError = '';
    this.projectionSourceProgram = null;
    this.projectionSourceUniforms = null;
    this.projectionSourceConfigured = false;
    this.projectionFastProgram = null;
    this.projectionFastUniforms = null;
    this.projectionFastConfigured = false;
    this.projectionFastAttempted = false;
    this.expandProgram = null;
    this.expandUniforms = null;
    this.expandVao = null;
    this.projectionBuffer = null;
    this.transformFeedback = null;
    this.projectionCapacity = 0;
    this.projectionStride = 13 * Float32Array.BYTES_PER_ELEMENT;
    this.lastRenderPath = 'source-direct';
    this.count = 0;
    this.sourceCount = 0;
    this.indexCount = 0;
    this.indexStride = 1;
    this.indexWidth = 1024;
    this.indexTextures = [gl.createTexture(), gl.createTexture()];
    this.activeIndexTexture = 0;
    this.indexTexture = this.indexTextures[this.activeIndexTexture];
    this.indexRows = 0;
    this.indexTextureAllocated = [false, false];
    this.hasIndexData = false;
    this.pendingIndexUpload = null;
    this.uniforms = this.cacheUniforms(this.program, [
      'uView', 'uProjection', 'uViewport', 'uTextureWidth', 'uIndexWidth',
      'uCount', 'uIndexStride', 'uSampleCompensation', 'uSampleFootprintScale',
      'uMeansMin', 'uMeansMax', 'uScaleCodebook[0]',
      'uColorCodebook[0]', 'uMeansLow', 'uMeansHigh', 'uQuats', 'uScales',
      'uColors', 'uIndexes', 'uTransformPass',
    ]);
    this.avatarUniforms = this.avatarProgram ? this.cacheUniforms(this.avatarProgram, [
      'uView', 'uProjection', 'uActor', 'uHeading', 'uMotion', 'uAirborne', 'uTime',
    ]) : null;
    this.fallbackAvatarEnabled = this.avatarResourcesEnabled;
  }

  cacheUniforms(program, names) {
    const uniforms = {};
    names.forEach((name) => { uniforms[name] = this.gl.getUniformLocation(program, name); });
    return uniforms;
  }

  createProjectionProgram(vertexShader, fast) {
    const program = createProgram(this.gl, vertexShader, FRAGMENT_SHADER, {
      transformFeedbackVaryings: TRANSFORM_FEEDBACK_VARYINGS,
    });
    const names = fast
      ? [
        'uView', 'uProjection', 'uViewport', 'uTextureWidth', 'uIndexWidth',
        'uCount', 'uIndexStride', 'uSampleCompensation', 'uSampleFootprintScale',
        'uDecodedA', 'uDecodedB', 'uIndexes', 'uTransformPass',
      ]
      : [
        'uView', 'uProjection', 'uViewport', 'uTextureWidth', 'uIndexWidth',
        'uCount', 'uIndexStride', 'uSampleCompensation', 'uSampleFootprintScale',
        'uMeansMin', 'uMeansMax', 'uScaleCodebook[0]',
        'uColorCodebook[0]', 'uMeansLow', 'uMeansHigh', 'uQuats', 'uScales',
        'uColors', 'uIndexes', 'uTransformPass',
      ];
    return { program, uniforms: this.cacheUniforms(program, names) };
  }

  prepareProjectionPath() {
    if (!ENABLE_TRANSFORM_FEEDBACK_PROJECTION) return false;
    if (this.projectionReady) return true;
    if (this.projectionAttempted) return false;
    this.projectionAttempted = true;
    const gl = this.gl;
    try {
      const source = this.createProjectionProgram(VERTEX_SHADER, false);
      this.projectionSourceProgram = source.program;
      this.projectionSourceUniforms = source.uniforms;
      this.expandProgram = createProgram(gl, EXPAND_VERTEX_SHADER, FRAGMENT_SHADER);
      this.expandUniforms = this.cacheUniforms(this.expandProgram, ['uViewport']);
      this.projectionBuffer = gl.createBuffer();
      this.transformFeedback = gl.createTransformFeedback();
      this.expandVao = gl.createVertexArray();
      gl.bindVertexArray(this.expandVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.projectionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
      const stride = this.projectionStride;
      [
        [0, 4, 0],
        [1, 4, 4 * Float32Array.BYTES_PER_ELEMENT],
        [2, 4, 8 * Float32Array.BYTES_PER_ELEMENT],
        [3, 1, 12 * Float32Array.BYTES_PER_ELEMENT],
      ].forEach(([location, size, offset]) => {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
        gl.vertexAttribDivisor(location, 1);
      });
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(this.expandProgram);
      gl.uniform2f(this.expandUniforms.uViewport, this.width, this.height);
      this.projectionReady = true;
      return true;
    } catch (error) {
      this.projectionError = error && error.message ? error.message : String(error);
      console.warn('[Native v2] transform feedback unavailable; using direct projection', error);
      this.releaseProjectionPath(false);
      return false;
    }
  }

  prepareFastProjectionProgram() {
    if (!this.hasFastPath()) return false;
    if (this.projectionFastProgram) return true;
    if (this.projectionFastAttempted) return false;
    this.projectionFastAttempted = true;
    try {
      const fast = this.createProjectionProgram(FAST_VERTEX_SHADER, true);
      this.projectionFastProgram = fast.program;
      this.projectionFastUniforms = fast.uniforms;
      this.projectionFastConfigured = false;
      return true;
    } catch (error) {
      console.warn('[Native v2] fast transform program unavailable', error);
      return false;
    }
  }

  releaseProjectionStorage() {
    if (!this.projectionBuffer || !this.projectionCapacity) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.projectionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.projectionCapacity = 0;
  }

  releaseProjectionPath(allowRetry = true) {
    const gl = this.gl;
    if (this.projectionSourceProgram) gl.deleteProgram(this.projectionSourceProgram);
    if (this.projectionFastProgram) gl.deleteProgram(this.projectionFastProgram);
    if (this.expandProgram) gl.deleteProgram(this.expandProgram);
    if (this.projectionBuffer) gl.deleteBuffer(this.projectionBuffer);
    if (this.transformFeedback) gl.deleteTransformFeedback(this.transformFeedback);
    if (this.expandVao) gl.deleteVertexArray(this.expandVao);
    this.projectionSourceProgram = null;
    this.projectionSourceUniforms = null;
    this.projectionFastProgram = null;
    this.projectionFastUniforms = null;
    this.expandProgram = null;
    this.expandUniforms = null;
    this.projectionBuffer = null;
    this.transformFeedback = null;
    this.expandVao = null;
    this.projectionCapacity = 0;
    this.projectionReady = false;
    this.projectionValidated = false;
    if (allowRetry) this.projectionAttempted = false;
  }

  ensureProjectionCapacity(count) {
    if (!this.projectionBuffer || count <= this.projectionCapacity) return;
    const gl = this.gl;
    const capacity = Math.ceil(count / 65536) * 65536;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.projectionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * this.projectionStride, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.projectionCapacity = capacity;
  }

  setSize(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.uniforms.uViewport, this.width, this.height);
    if (this.fastProgram && this.fastUniforms) {
      this.gl.useProgram(this.fastProgram);
      this.gl.uniform2f(this.fastUniforms.uViewport, this.width, this.height);
    }
    if (this.projectionSourceProgram && this.projectionSourceUniforms) {
      this.gl.useProgram(this.projectionSourceProgram);
      this.gl.uniform2f(this.projectionSourceUniforms.uViewport, this.width, this.height);
    }
    if (this.projectionFastProgram && this.projectionFastUniforms) {
      this.gl.useProgram(this.projectionFastProgram);
      this.gl.uniform2f(this.projectionFastUniforms.uViewport, this.width, this.height);
    }
    if (this.expandProgram && this.expandUniforms) {
      this.gl.useProgram(this.expandProgram);
      this.gl.uniform2f(this.expandUniforms.uViewport, this.width, this.height);
    }
  }

  setFallbackAvatarEnabled(enabled) {
    this.fallbackAvatarEnabled = !!enabled;
  }

  releaseScene() {
    this.discardPendingIndexUpload();
    this.releaseFastPath();
    this.dataTextures.forEach((texture) => this.gl.deleteTexture(texture));
    this.dataTextures = [];
    this.activeIndexTexture = 0;
    this.indexTexture = this.indexTextures[this.activeIndexTexture];
    this.indexRows = 0;
    this.indexTextureAllocated = [false, false];
    this.hasIndexData = false;
    this.count = 0;
    this.indexCount = 0;
    this.sourceCount = 0;
    this.textureWidth = 0;
    this.textureHeight = 0;
    this.scene = null;
    this.projectionSourceConfigured = false;
    this.projectionFastConfigured = false;
    this.releaseProjectionStorage();
  }

  load(scene, assets, options = {}) {
    const gl = this.gl;
    this.releaseScene();
    if (gl.isContextLost && gl.isContextLost()) throw new Error('WebGL context is lost');
    if (scene.sog.meta.scales.codebook.length !== 256
      || scene.sog.meta.sh0.codebook.length !== 256) {
      throw new Error('SOG codebook must contain exactly 256 values');
    }
    if (assets.count !== scene.sog.meta.count || assets.count > assets.width * assets.height) {
      throw new Error('SOG texture capacity does not match its point count');
    }
    if (assets.width > gl.getParameter(gl.MAX_TEXTURE_SIZE)
      || assets.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
      throw new Error('SOG texture exceeds this device\'s WebGL texture limit');
    }
    for (let attempt = 0; attempt < 4 && gl.getError() !== gl.NO_ERROR; attempt += 1) {
      // Drain errors left by capability probing before validating our uploads.
    }
    this.scene = scene;
    this.sourceCount = assets.count;
    this.indexCount = options.initiallyVisible === false ? 0 : assets.count;
    this.count = Math.ceil(this.indexCount / this.indexStride);
    this.textureWidth = assets.width;
    this.textureHeight = assets.height;
    const image = (name) => assets.images[name].image;
    this.dataTextures.push(createImageTexture(gl, image('means_l.webp'), 3));
    this.dataTextures.push(createImageTexture(gl, image('means_u.webp'), 3));
    this.dataTextures.push(createImageTexture(gl, image('quats.webp'), 4));
    this.dataTextures.push(createImageTexture(gl, image('scales.webp'), 3));
    this.dataTextures.push(createImageTexture(gl, image('sh0.webp'), 4));
    this.scaleCodebook = new Float32Array(scene.sog.meta.scales.codebook);
    this.colorCodebook = new Float32Array(scene.sog.meta.sh0.codebook);
    this.indexRows = Math.ceil(this.sourceCount / this.indexWidth);
    if (this.indexRows && this.indexCount) {
      // Allocate both sides of the index double buffer while the loading mask is
      // visible. Later camera sorts only upload data and atomically swap textures.
      this.prepareIndexDoubleBuffer();
    }
    if (this.indexCount) {
      const initial = new Uint32Array(this.sourceCount);
      for (let index = 0; index < this.sourceCount; index += 1) initial[index] = index;
      this.updateIndexes(initial);
    }
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.uViewport, this.width, this.height);
    gl.uniform1i(this.uniforms.uTextureWidth, this.textureWidth);
    gl.uniform1i(this.uniforms.uIndexWidth, this.indexWidth);
    gl.uniform1i(this.uniforms.uCount, this.count);
    gl.uniform1i(this.uniforms.uIndexStride, this.indexStride);
    gl.uniform1f(this.uniforms.uSampleCompensation, this.sampleCompensation());
    gl.uniform1f(this.uniforms.uSampleFootprintScale, this.sampleFootprintScale());
    gl.uniform3fv(this.uniforms.uMeansMin, scene.sog.meta.means.mins);
    gl.uniform3fv(this.uniforms.uMeansMax, scene.sog.meta.means.maxs);
    gl.uniform4fv(this.uniforms['uScaleCodebook[0]'], this.scaleCodebook);
    gl.uniform4fv(this.uniforms['uColorCodebook[0]'], this.colorCodebook);
    this.bindTexture(0, this.dataTextures[0], this.uniforms.uMeansLow);
    this.bindTexture(1, this.dataTextures[1], this.uniforms.uMeansHigh);
    this.bindTexture(2, this.dataTextures[2], this.uniforms.uQuats);
    this.bindTexture(3, this.dataTextures[3], this.uniforms.uScales);
    this.bindTexture(4, this.dataTextures[4], this.uniforms.uColors);
    this.bindTexture(5, this.indexTexture, this.uniforms.uIndexes);
    gl.uniform1i(this.uniforms.uTransformPass, 0);
    this.projectionSourceConfigured = false;
    this.projectionFastConfigured = false;
    const uploadError = gl.getError();
    if (uploadError !== gl.NO_ERROR) throw new Error(`WebGL texture upload failed (${uploadError})`);
  }

  hasFastPath() {
    return this.fastReady && this.fastProgram && this.decodedTextures.length === 2;
  }

  releaseFastPath() {
    const gl = this.gl;
    this.decodedTextures.forEach((texture) => gl.deleteTexture(texture));
    this.decodedTextures = [];
    if (this.fastProgram) gl.deleteProgram(this.fastProgram);
    if (this.projectionFastProgram) gl.deleteProgram(this.projectionFastProgram);
    this.fastProgram = null;
    this.fastUniforms = null;
    this.projectionFastProgram = null;
    this.projectionFastUniforms = null;
    this.projectionFastConfigured = false;
    this.projectionFastAttempted = false;
    this.fastAttempted = false;
    this.fastReady = false;
    this.fastError = '';
  }

  prepareFastPath() {
    if (!ENABLE_HALF_FLOAT_PREDECODE) return false;
    if (this.hasFastPath()) return true;
    if (this.fastAttempted
      || !this.scene
      || this.dataTextures.length !== 5
      || !this.sourceCount
      || !this.textureWidth
      || !this.textureHeight) return false;

    const gl = this.gl;
    this.fastAttempted = true;
    let predecodeProgram = null;
    let predecodeVao = null;
    let framebuffer = null;
    let fastProgram = null;
    let decodedA = null;
    let decodedB = null;
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    const previousViewport = gl.getParameter(gl.VIEWPORT);

    try {
      for (let attempt = 0; attempt < 4 && gl.getError() !== gl.NO_ERROR; attempt += 1) {
        // Clear stale capability-probe errors before validating the predecode pass.
      }
      fastProgram = createProgram(gl, FAST_VERTEX_SHADER, FRAGMENT_SHADER);
      predecodeProgram = createProgram(gl, PREDECODE_VERTEX_SHADER, PREDECODE_FRAGMENT_SHADER);
      decodedA = createUintTexture(gl, this.textureWidth, this.textureHeight);
      decodedB = createUintTexture(gl, this.textureWidth, this.textureHeight);
      framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        decodedA,
        0,
      );
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      let framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (framebufferStatus !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`GPU predecode framebuffer A incomplete (${framebufferStatus})`);
      }

      gl.viewport(0, 0, this.textureWidth, this.textureHeight);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.useProgram(predecodeProgram);
      predecodeVao = gl.createVertexArray();
      gl.bindVertexArray(predecodeVao);
      const predecodeUniforms = this.cacheUniforms(predecodeProgram, [
        'uTextureWidth', 'uCount', 'uMeansMin', 'uMeansMax', 'uScaleCodebook[0]',
        'uColorCodebook[0]', 'uMeansLow', 'uMeansHigh', 'uQuats', 'uScales', 'uColors',
        'uOutputPart',
      ]);
      gl.uniform1i(predecodeUniforms.uTextureWidth, this.textureWidth);
      gl.uniform1i(predecodeUniforms.uCount, this.sourceCount);
      gl.uniform3fv(predecodeUniforms.uMeansMin, this.scene.sog.meta.means.mins);
      gl.uniform3fv(predecodeUniforms.uMeansMax, this.scene.sog.meta.means.maxs);
      gl.uniform4fv(predecodeUniforms['uScaleCodebook[0]'], this.scaleCodebook);
      gl.uniform4fv(predecodeUniforms['uColorCodebook[0]'], this.colorCodebook);
      this.bindTexture(0, this.dataTextures[0], predecodeUniforms.uMeansLow);
      this.bindTexture(1, this.dataTextures[1], predecodeUniforms.uMeansHigh);
      this.bindTexture(2, this.dataTextures[2], predecodeUniforms.uQuats);
      this.bindTexture(3, this.dataTextures[3], predecodeUniforms.uScales);
      this.bindTexture(4, this.dataTextures[4], predecodeUniforms.uColors);
      gl.uniform1i(predecodeUniforms.uOutputPart, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        decodedB,
        0,
      );
      framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (framebufferStatus !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`GPU predecode framebuffer B incomplete (${framebufferStatus})`);
      }
      gl.uniform1i(predecodeUniforms.uOutputPart, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const predecodeError = gl.getError();
      if (predecodeError !== gl.NO_ERROR) {
        throw new Error(`GPU predecode failed (${predecodeError})`);
      }

      this.fastProgram = fastProgram;
      this.fastUniforms = this.cacheUniforms(fastProgram, [
        'uView', 'uProjection', 'uViewport', 'uTextureWidth', 'uIndexWidth',
        'uCount', 'uIndexStride', 'uSampleCompensation', 'uSampleFootprintScale',
        'uDecodedA', 'uDecodedB', 'uIndexes', 'uTransformPass',
      ]);
      this.decodedTextures = [decodedA, decodedB];
      this.fastReady = true;
      this.fastError = '';
      fastProgram = null;
      decodedA = null;
      decodedB = null;

      gl.useProgram(this.fastProgram);
      gl.uniform2f(this.fastUniforms.uViewport, this.width, this.height);
      gl.uniform1i(this.fastUniforms.uTextureWidth, this.textureWidth);
      gl.uniform1i(this.fastUniforms.uIndexWidth, this.indexWidth);
      gl.uniform1i(this.fastUniforms.uCount, this.count);
      gl.uniform1i(this.fastUniforms.uIndexStride, this.indexStride);
      gl.uniform1f(this.fastUniforms.uSampleCompensation, this.sampleCompensation());
      gl.uniform1f(this.fastUniforms.uSampleFootprintScale, this.sampleFootprintScale());
      this.bindTexture(0, this.decodedTextures[0], this.fastUniforms.uDecodedA);
      this.bindTexture(1, this.decodedTextures[1], this.fastUniforms.uDecodedB);
      this.bindTexture(2, this.indexTexture, this.fastUniforms.uIndexes);
      gl.uniform1i(this.fastUniforms.uTransformPass, 0);
      return true;
    } catch (error) {
      if (decodedA) gl.deleteTexture(decodedA);
      if (decodedB) gl.deleteTexture(decodedB);
      if (fastProgram) gl.deleteProgram(fastProgram);
      this.fastReady = false;
      this.fastError = error && error.message ? error.message : String(error);
      console.warn('[Native v2] GPU predecode unavailable; using source decode', error);
      return false;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (predecodeVao) gl.deleteVertexArray(predecodeVao);
      if (predecodeProgram) gl.deleteProgram(predecodeProgram);
      gl.viewport(
        previousViewport[0],
        previousViewport[1],
        previousViewport[2],
        previousViewport[3],
      );
      gl.useProgram(previousProgram);
      gl.bindVertexArray(previousVao);
      gl.activeTexture(previousActiveTexture);
    }
  }

  sampleCompensation() {
    return 1;
  }

  sampleFootprintScale() {
    return 1;
  }

  applySamplingUniforms(program, uniforms) {
    if (!program || !uniforms) return;
    const gl = this.gl;
    gl.useProgram(program);
    gl.uniform1i(uniforms.uIndexStride, this.indexStride);
    gl.uniform1f(uniforms.uSampleCompensation, this.sampleCompensation());
    gl.uniform1f(uniforms.uSampleFootprintScale, this.sampleFootprintScale());
  }

  setIndexStride() {
    const normalized = 1;
    if (normalized === this.indexStride) return false;
    this.indexStride = normalized;
    this.setRendererCount(Math.ceil(this.indexCount / this.indexStride));
    this.applySamplingUniforms(this.program, this.uniforms);
    this.applySamplingUniforms(this.fastProgram, this.fastUniforms);
    this.applySamplingUniforms(this.projectionSourceProgram, this.projectionSourceUniforms);
    this.applySamplingUniforms(this.projectionFastProgram, this.projectionFastUniforms);
    return true;
  }

  setRendererCount(count) {
    const gl = this.gl;
    this.count = count;
    gl.useProgram(this.program);
    gl.uniform1i(this.uniforms.uCount, count);
    if (this.fastProgram && this.fastUniforms) {
      gl.useProgram(this.fastProgram);
      gl.uniform1i(this.fastUniforms.uCount, count);
    }
    if (this.projectionSourceProgram && this.projectionSourceUniforms) {
      gl.useProgram(this.projectionSourceProgram);
      gl.uniform1i(this.projectionSourceUniforms.uCount, count);
    }
    if (this.projectionFastProgram && this.projectionFastUniforms) {
      gl.useProgram(this.projectionFastProgram);
      gl.uniform1i(this.projectionFastUniforms.uCount, count);
    }
  }

  setActiveIndexCount(count) {
    this.indexCount = Math.max(0, Math.floor(Number(count) || 0));
    this.setRendererCount(Math.ceil(this.indexCount / this.indexStride));
  }

  ensureIndexTexture(uploadIndex) {
    const gl = this.gl;
    const texture = this.indexTextures[uploadIndex];
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (!this.indexTextureAllocated[uploadIndex]) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32UI,
        this.indexWidth,
        this.indexRows,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        null,
      );
      this.indexTextureAllocated[uploadIndex] = true;
    }
    return texture;
  }

  prepareIndexDoubleBuffer() {
    if (!this.sourceCount || !this.indexRows) return false;
    this.ensureIndexTexture(this.activeIndexTexture);
    this.ensureIndexTexture(1 - this.activeIndexTexture);
    this.indexTexture = this.indexTextures[this.activeIndexTexture];
    return true;
  }

  discardPendingIndexUpload() {
    const upload = this.pendingIndexUpload;
    if (!upload) return;
    this.pendingIndexUpload = null;
    if (upload.onDiscarded) upload.onDiscarded();
  }

  updateIndexes(indexes, options = {}) {
    if (!this.sourceCount || !indexes || indexes.length > this.sourceCount) {
      if (options.onDiscarded) options.onDiscarded();
      return;
    }
    this.discardPendingIndexUpload();
    if (!indexes.length) {
      this.setActiveIndexCount(0);
      if (options.onCommitted) options.onCommitted();
      return;
    }
    const uploadIndex = this.hasIndexData
      ? 1 - this.activeIndexTexture
      : this.activeIndexTexture;
    this.pendingIndexUpload = {
      count: indexes.length,
      indexes,
      totalRows: Math.ceil(indexes.length / this.indexWidth),
      uploadedRows: 0,
      uploadIndex,
      onCommitted: options.onCommitted || null,
      onDiscarded: options.onDiscarded || null,
    };
    this.ensureIndexTexture(uploadIndex);
    if (!this.hasIndexData || options.immediate === true) {
      this.flushIndexUpload(Number.POSITIVE_INFINITY);
    }
  }

  flushIndexUpload(maxRows = 192) {
    const upload = this.pendingIndexUpload;
    if (!upload) return 0;
    const gl = this.gl;
    const rowBudget = Number.isFinite(maxRows)
      ? Math.max(1, Math.floor(maxRows))
      : upload.totalRows;
    const startRow = upload.uploadedRows;
    const endRow = Math.min(upload.totalRows, startRow + rowBudget);
    const fullRows = Math.floor(upload.count / this.indexWidth);
    const fullEndRow = Math.min(endRow, fullRows);
    const texture = this.ensureIndexTexture(upload.uploadIndex);

    if (fullEndRow > startRow) {
      const startIndex = startRow * this.indexWidth;
      const endIndex = fullEndRow * this.indexWidth;
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        startRow,
        this.indexWidth,
        fullEndRow - startRow,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        upload.indexes.subarray(startIndex, endIndex),
      );
    }

    const remaining = upload.count - fullRows * this.indexWidth;
    if (remaining > 0 && startRow <= fullRows && endRow > fullRows) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        fullRows,
        remaining,
        1,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        upload.indexes.subarray(fullRows * this.indexWidth, upload.count),
      );
    }

    const contextLost = !!(gl.isContextLost && gl.isContextLost());
    const uploadError = gl.getError ? gl.getError() : gl.NO_ERROR;
    if (contextLost || uploadError !== gl.NO_ERROR) {
      this.pendingIndexUpload = null;
      this.indexTextureAllocated[upload.uploadIndex] = false;
      if (upload.onDiscarded) upload.onDiscarded();
      return 0;
    }

    upload.uploadedRows = endRow;
    if (upload.uploadedRows >= upload.totalRows) {
      this.activeIndexTexture = upload.uploadIndex;
      this.indexTexture = texture;
      this.hasIndexData = true;
      this.pendingIndexUpload = null;
      this.setActiveIndexCount(upload.count);
      if (upload.onCommitted) upload.onCommitted();
    }
    return endRow - startRow;
  }

  bindTexture(unit, texture, uniformLocation) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniformLocation, unit);
  }

  configureProjectionProgram(useFastPath) {
    const gl = this.gl;
    const program = useFastPath ? this.projectionFastProgram : this.projectionSourceProgram;
    const uniforms = useFastPath ? this.projectionFastUniforms : this.projectionSourceUniforms;
    const configured = useFastPath
      ? this.projectionFastConfigured
      : this.projectionSourceConfigured;
    gl.useProgram(program);
    if (!configured) {
      gl.uniform2f(uniforms.uViewport, this.width, this.height);
      gl.uniform1i(uniforms.uTextureWidth, this.textureWidth);
      gl.uniform1i(uniforms.uIndexWidth, this.indexWidth);
      gl.uniform1i(uniforms.uCount, this.count);
      gl.uniform1i(uniforms.uIndexStride, this.indexStride);
      gl.uniform1f(uniforms.uSampleCompensation, this.sampleCompensation());
      gl.uniform1f(uniforms.uSampleFootprintScale, this.sampleFootprintScale());
      gl.uniform1i(uniforms.uTransformPass, 1);
      if (!useFastPath) {
        gl.uniform3fv(uniforms.uMeansMin, this.scene.sog.meta.means.mins);
        gl.uniform3fv(uniforms.uMeansMax, this.scene.sog.meta.means.maxs);
        gl.uniform4fv(uniforms['uScaleCodebook[0]'], this.scaleCodebook);
        gl.uniform4fv(uniforms['uColorCodebook[0]'], this.colorCodebook);
      }
      if (useFastPath) this.projectionFastConfigured = true;
      else this.projectionSourceConfigured = true;
    }
    if (useFastPath) {
      this.bindTexture(0, this.decodedTextures[0], uniforms.uDecodedA);
      this.bindTexture(1, this.decodedTextures[1], uniforms.uDecodedB);
      this.bindTexture(2, this.indexTexture, uniforms.uIndexes);
    } else {
      this.bindTexture(0, this.dataTextures[0], uniforms.uMeansLow);
      this.bindTexture(1, this.dataTextures[1], uniforms.uMeansHigh);
      this.bindTexture(2, this.dataTextures[2], uniforms.uQuats);
      this.bindTexture(3, this.dataTextures[3], uniforms.uScales);
      this.bindTexture(4, this.dataTextures[4], uniforms.uColors);
      this.bindTexture(5, this.indexTexture, uniforms.uIndexes);
    }
    return uniforms;
  }

  renderProjected(matrices, useFastPath) {
    if (!this.prepareProjectionPath()) return false;
    const fastProjection = useFastPath && this.prepareFastProjectionProgram();
    const gl = this.gl;
    this.ensureProjectionCapacity(this.count);
    let transformStarted = false;
    try {
      if (!this.projectionValidated) {
        for (let attempt = 0; attempt < 4 && gl.getError() !== gl.NO_ERROR; attempt += 1) {
          // Drain stale errors before validating transform feedback once.
        }
      }
      const uniforms = this.configureProjectionProgram(fastProjection);
      gl.uniformMatrix4fv(uniforms.uView, false, matrices.view);
      gl.uniformMatrix4fv(uniforms.uProjection, false, matrices.projection);
      gl.bindVertexArray(this.vao);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedback);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.projectionBuffer);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      transformStarted = true;
      gl.drawArrays(gl.POINTS, 0, this.count);
      gl.endTransformFeedback();
      transformStarted = false;
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

      if (!this.projectionValidated) {
        const projectionGlError = gl.getError();
        if (projectionGlError !== gl.NO_ERROR) {
          throw new Error(`Transform feedback failed (${projectionGlError})`);
        }
        this.projectionValidated = true;
      }

      gl.useProgram(this.expandProgram);
      gl.bindVertexArray(this.expandVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
      this.lastRenderPath = fastProjection ? 'fast-tf' : 'source-tf';
      return true;
    } catch (error) {
      if (transformStarted) {
        try { gl.endTransformFeedback(); } catch (endError) { /* already ended */ }
      }
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      this.projectionError = error && error.message ? error.message : String(error);
      console.warn('[Native v2] transform feedback render failed; using direct projection', error);
      this.releaseProjectionPath(false);
      return false;
    }
  }

  render(matrices, cameraController, options = {}) {
    if (!this.count || !this.scene || this.dataTextures.length !== 5) return;
    const gl = this.gl;
    if (!options.preserveState) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      if (options.clear !== false) {
        const clearColor = Array.isArray(options.clearColor)
          ? options.clearColor
          : [0.035, 0.045, 0.055, 1];
        gl.clearColor(
          Number(clearColor[0]) || 0,
          Number(clearColor[1]) || 0,
          Number(clearColor[2]) || 0,
          clearColor[3] === undefined ? 1 : Number(clearColor[3]),
        );
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    const useFastPath = this.hasFastPath();
    if (this.renderProjected(matrices, useFastPath)) {
      if (options.avatar !== false) this.renderAvatar(matrices, cameraController);
      gl.bindVertexArray(null);
      return;
    }
    const program = useFastPath ? this.fastProgram : this.program;
    const uniforms = useFastPath ? this.fastUniforms : this.uniforms;
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    if (useFastPath) {
      this.bindTexture(0, this.decodedTextures[0], uniforms.uDecodedA);
      this.bindTexture(1, this.decodedTextures[1], uniforms.uDecodedB);
      this.bindTexture(2, this.indexTexture, uniforms.uIndexes);
    } else {
      this.bindTexture(0, this.dataTextures[0], uniforms.uMeansLow);
      this.bindTexture(1, this.dataTextures[1], uniforms.uMeansHigh);
      this.bindTexture(2, this.dataTextures[2], uniforms.uQuats);
      this.bindTexture(3, this.dataTextures[3], uniforms.uScales);
      this.bindTexture(4, this.dataTextures[4], uniforms.uColors);
      this.bindTexture(5, this.indexTexture, uniforms.uIndexes);
    }
    gl.uniformMatrix4fv(uniforms.uView, false, matrices.view);
    gl.uniformMatrix4fv(uniforms.uProjection, false, matrices.projection);
    gl.uniform1i(uniforms.uTransformPass, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    this.lastRenderPath = useFastPath ? 'fast-direct' : 'source-direct';

    if (options.avatar !== false) this.renderAvatar(matrices, cameraController);
    gl.bindVertexArray(null);
  }

  renderAvatar(matrices, cameraController) {
    if (!this.fallbackAvatarEnabled || !this.avatarProgram || cameraController.getMode() !== 'avatar') return;
    const gl = this.gl;
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(this.avatarProgram);
      gl.bindVertexArray(this.avatarVao);
      gl.uniformMatrix4fv(this.avatarUniforms.uView, false, matrices.view);
      gl.uniformMatrix4fv(this.avatarUniforms.uProjection, false, matrices.projection);
      const avatarState = cameraController.getAvatarState();
      gl.uniform3fv(this.avatarUniforms.uActor, avatarState.position);
      gl.uniform1f(this.avatarUniforms.uHeading, avatarState.heading);
      gl.uniform1f(this.avatarUniforms.uMotion, avatarState.motion);
      gl.uniform1f(this.avatarUniforms.uAirborne, avatarState.airborne ? 1 : 0);
      gl.uniform1f(this.avatarUniforms.uTime, avatarState.time);
      gl.drawArrays(gl.TRIANGLES, 0, this.avatarVertexCount);
    gl.bindVertexArray(null);
  }

  getDiagnostics() {
    const pendingRows = this.pendingIndexUpload
      ? this.pendingIndexUpload.totalRows - this.pendingIndexUpload.uploadedRows
      : 0;
    return {
      count: this.count,
      fastError: this.fastError,
      fastReady: this.hasFastPath(),
      indexCount: this.indexCount,
      indexStride: this.indexStride,
      indexUploadRows: pendingRows,
      path: this.lastRenderPath,
      projectionCapacity: this.projectionCapacity,
      projectionError: this.projectionError,
      projectionReady: this.projectionReady,
      sampleFootprintScale: this.sampleFootprintScale(),
      sourceCount: this.sourceCount,
    };
  }

  dispose() {
    const gl = this.gl;
    this.releaseScene();
    this.releaseProjectionPath(false);
    this.indexTextures.forEach((texture) => gl.deleteTexture(texture));
    gl.deleteProgram(this.program);
    if (this.avatarProgram) gl.deleteProgram(this.avatarProgram);
    if (this.avatarBuffer) gl.deleteBuffer(this.avatarBuffer);
    gl.deleteVertexArray(this.vao);
    if (this.avatarVao) gl.deleteVertexArray(this.avatarVao);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { SplatRenderer };
if (typeof window !== 'undefined') window.NativeSplatRenderer = SplatRenderer;
