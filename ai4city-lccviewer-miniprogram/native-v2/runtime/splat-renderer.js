'use strict';

const sampleStrideApi = typeof module !== 'undefined' && module.exports
  ? require('./sample-stride')
  : window.NativeSampleStride;
const {
  isSampledSourceIndex,
  normalizeSampleStride,
} = sampleStrideApi;

const SPLATS_PER_BATCH_INSTANCE = 128;

const VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 aCornerLane;
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
  int order = uTransformPass != 0
    ? gl_VertexID
    : gl_InstanceID * ${SPLATS_PER_BATCH_INSTANCE} + int(aCornerLane.z);
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
  int sourceOrder = order;
  ivec2 orderUv = ivec2(sourceOrder % uIndexWidth, sourceOrder / uIndexWidth);
  uint index = texelFetch(uIndexes, orderUv, 0).r;
  ivec2 uv = ivec2(int(index) % uTextureWidth, int(index) / uTextureWidth);
  vec3 center = decodeCenter(uv);
  vec4 viewCenter = uView * vec4(center, 1.0);
  vec4 clipCenter = uProjection * viewCenter;
  if (clipCenter.w <= 0.0
    || clipCenter.z < -clipCenter.w
    || clipCenter.z > clipCenter.w
    || abs(clipCenter.x) > clipCenter.w * 1.25
    || abs(clipCenter.y) > clipCenter.w * 1.25) {
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
    focalX * viewCenter.x / (depth * depth),
    focalY * viewCenter.y / (depth * depth),
    0.0
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
  float projectedSigma = sqrt(max(lambda1, lambda2));
  float sampleWeight = 1.0 - smoothstep(2.5, 10.0, projectedSigma);
  float effectiveCompensation = mix(1.0, uSampleCompensation, sampleWeight);
  float effectiveFootprint = mix(1.0, uSampleFootprintScale, sampleWeight);
  vOpacity = 1.0 - pow(
    max(1.0 - clamp(vOpacity, 0.0, 0.999999), 0.000001),
    effectiveCompensation
  );
  if (vOpacity < 0.00392) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float crop = min(1.0, sqrt(max(-log(0.00392 / vOpacity), 0.0)) * 0.5);
  float maxExtent = max(64.0, min(1024.0, min(uViewport.x, uViewport.y)));
  float extent1 = min(2.0 * sqrt(2.0 * lambda1), maxExtent) * crop * effectiveFootprint;
  float extent2 = min(2.0 * sqrt(2.0 * lambda2), maxExtent) * crop * effectiveFootprint;
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
  vec2 corner = aCornerLane.xy;
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

layout(location = 0) out uvec4 outDecodedA;
layout(location = 1) out uvec4 outDecodedB;
layout(location = 2) out uvec2 outDecodedC;

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

uint packColorOpacity(vec4 value) {
  uvec4 bytes = uvec4(round(clamp(value, 0.0, 1.0) * 255.0));
  return bytes.x | (bytes.y << 8u) | (bytes.z << 16u) | (bytes.w << 24u);
}

void main() {
  ivec2 outputUv = ivec2(gl_FragCoord.xy);
  int order = outputUv.y * uTextureWidth + outputUv.x;
  if (order >= uCount) {
    outDecodedA = uvec4(0u);
    outDecodedB = uvec4(0u);
    outDecodedC = uvec2(0u);
    return;
  }

  ivec2 uv = outputUv;
  vec3 center = decodeCenter(uv);
  mat3 axisSwap = mat3(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0);
  mat3 covariance = axisSwap * sourceCovariance(uv) * transpose(axisSwap);
  float opacity;
  vec3 color = decodeColor(uv, opacity);

  outDecodedA = uvec4(
    floatBitsToUint(center),
    floatBitsToUint(covariance[0][0])
  );
  outDecodedB = uvec4(
    floatBitsToUint(covariance[0][1]),
    floatBitsToUint(covariance[0][2]),
    floatBitsToUint(covariance[1][1]),
    floatBitsToUint(covariance[1][2])
  );
  outDecodedC = uvec2(
    floatBitsToUint(covariance[2][2]),
    packColorOpacity(vec4(color, opacity))
  );
}
`;

const FAST_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 aCornerLane;
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
uniform highp usampler2D uDecodedC;
uniform highp usampler2D uIndexes;

flat out vec3 vColor;
flat out float vOpacity;
out vec2 vLocal;
out vec3 tfNdcCenter;
out vec4 tfPackedData;

vec2 quadCorner(int id) {
  if (id == 0) return vec2(-1.0, -1.0);
  if (id == 1) return vec2(1.0, -1.0);
  if (id == 2) return vec2(-1.0, 1.0);
  return vec2(1.0, 1.0);
}

vec4 unpackColorOpacity(uint packed) {
  return vec4(
    float(packed & 255u),
    float((packed >> 8u) & 255u),
    float((packed >> 16u) & 255u),
    float((packed >> 24u) & 255u)
  ) / 255.0;
}

void main() {
  int order = uTransformPass != 0
    ? gl_VertexID
    : gl_InstanceID * ${SPLATS_PER_BATCH_INSTANCE} + int(aCornerLane.z);
  vColor = vec3(0.0);
  vOpacity = 0.0;
  vLocal = vec2(0.0);
  tfNdcCenter = vec3(2.0);
  tfPackedData = vec4(0.0);
  if (order >= uCount) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  ivec2 orderUv = ivec2(order % uIndexWidth, order / uIndexWidth);
  uint index = texelFetch(uIndexes, orderUv, 0).r;
  ivec2 uv = ivec2(int(index) % uTextureWidth, int(index) / uTextureWidth);
  uvec4 decodedA = texelFetch(uDecodedA, uv, 0);
  vec3 center = uintBitsToFloat(decodedA.xyz);
  vec4 viewCenter = uView * vec4(center, 1.0);
  vec4 clipCenter = uProjection * viewCenter;
  if (clipCenter.w <= 0.0
    || clipCenter.z < -clipCenter.w
    || clipCenter.z > clipCenter.w
    || abs(clipCenter.x) > clipCenter.w * 1.25
    || abs(clipCenter.y) > clipCenter.w * 1.25) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vOpacity = 0.0;
    return;
  }

  uvec4 decodedB = texelFetch(uDecodedB, uv, 0);
  uvec2 decodedC = texelFetch(uDecodedC, uv, 0).rg;
  float covariance00 = uintBitsToFloat(decodedA.w);
  float covariance01 = uintBitsToFloat(decodedB.x);
  float covariance02 = uintBitsToFloat(decodedB.y);
  float covariance11 = uintBitsToFloat(decodedB.z);
  float covariance12 = uintBitsToFloat(decodedB.w);
  float covariance22 = uintBitsToFloat(decodedC.x);
  vec4 colorOpacity = unpackColorOpacity(decodedC.y);
  vColor = colorOpacity.rgb;
  vOpacity = colorOpacity.a;

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
  vec3 worldJacobianX = vec3(
    dot(uView[0].xyz, jacobianX),
    dot(uView[1].xyz, jacobianX),
    dot(uView[2].xyz, jacobianX)
  );
  vec3 worldJacobianY = vec3(
    dot(uView[0].xyz, jacobianY),
    dot(uView[1].xyz, jacobianY),
    dot(uView[2].xyz, jacobianY)
  );
  vec3 covarianceX = vec3(
    covariance00 * worldJacobianX.x + covariance01 * worldJacobianX.y + covariance02 * worldJacobianX.z,
    covariance01 * worldJacobianX.x + covariance11 * worldJacobianX.y + covariance12 * worldJacobianX.z,
    covariance02 * worldJacobianX.x + covariance12 * worldJacobianX.y + covariance22 * worldJacobianX.z
  );
  vec3 covarianceY = vec3(
    covariance00 * worldJacobianY.x + covariance01 * worldJacobianY.y + covariance02 * worldJacobianY.z,
    covariance01 * worldJacobianY.x + covariance11 * worldJacobianY.y + covariance12 * worldJacobianY.z,
    covariance02 * worldJacobianY.x + covariance12 * worldJacobianY.y + covariance22 * worldJacobianY.z
  );
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
  float projectedSigma = sqrt(max(lambda1, lambda2));
  float sampleWeight = 1.0 - smoothstep(2.5, 10.0, projectedSigma);
  float effectiveCompensation = mix(1.0, uSampleCompensation, sampleWeight);
  float effectiveFootprint = mix(1.0, uSampleFootprintScale, sampleWeight);
  vOpacity = 1.0 - pow(
    max(1.0 - clamp(vOpacity, 0.0, 0.999999), 0.000001),
    effectiveCompensation
  );
  if (vOpacity < 0.00392) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float crop = min(1.0, sqrt(max(-log(0.00392 / vOpacity), 0.0)) * 0.5);
  float maxExtent = max(64.0, min(1024.0, min(uViewport.x, uViewport.y)));
  float extent1 = min(2.0 * sqrt(2.0 * lambda1), maxExtent) * crop * effectiveFootprint;
  float extent2 = min(2.0 * sqrt(2.0 * lambda2), maxExtent) * crop * effectiveFootprint;
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
  tfNdcCenter = clipCenter.xyz / clipCenter.w;
  tfPackedData = uintBitsToFloat(uvec4(
    packHalf2x16(axis1 / uViewport * 2.0),
    packHalf2x16(axis2 / uViewport * 2.0),
    decodedC.y & 0x00ffffffu,
    packHalf2x16(vec2(vOpacity, crop))
  ));
  if (uTransformPass != 0) {
    gl_Position = clipCenter;
    return;
  }
  vec2 corner = aCornerLane.xy;
  vec2 offset = (corner.x * axis1 + corner.y * axis2) / uViewport * 2.0;
  gl_Position = vec4(clipCenter.xy + offset * clipCenter.w, clipCenter.zw);
  vLocal = corner * 2.0 * crop;
}
`;

const MRT_PROJECTION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform mat4 uView;
uniform mat4 uProjection;
uniform vec2 uViewport;
uniform int uTextureWidth;
uniform int uIndexWidth;
uniform int uCount;
uniform float uSampleCompensation;
uniform float uSampleFootprintScale;
uniform highp usampler2D uDecodedA;
uniform highp usampler2D uDecodedB;
uniform highp usampler2D uDecodedC;
uniform highp usampler2D uIndexes;

layout(location = 0) out uvec4 outProjectedA;
layout(location = 1) out uvec4 outProjectedB;

void rejectSplat() {
  outProjectedA = uvec4(0u);
  outProjectedB = uvec4(0u);
}

void main() {
  ivec2 outputUv = ivec2(gl_FragCoord.xy);
  int order = outputUv.y * uIndexWidth + outputUv.x;
  rejectSplat();
  if (order >= uCount) return;

  ivec2 orderUv = ivec2(order % uIndexWidth, order / uIndexWidth);
  uint index = texelFetch(uIndexes, orderUv, 0).r;
  ivec2 uv = ivec2(int(index) % uTextureWidth, int(index) / uTextureWidth);
  uvec4 decodedA = texelFetch(uDecodedA, uv, 0);
  vec3 center = uintBitsToFloat(decodedA.xyz);
  vec4 viewCenter = uView * vec4(center, 1.0);
  vec4 clipCenter = uProjection * viewCenter;
  if (clipCenter.w <= 0.0
    || clipCenter.z < -clipCenter.w
    || clipCenter.z > clipCenter.w
    || abs(clipCenter.x) > clipCenter.w * 1.25
    || abs(clipCenter.y) > clipCenter.w * 1.25) return;

  uvec4 decodedB = texelFetch(uDecodedB, uv, 0);
  uvec2 decodedC = texelFetch(uDecodedC, uv, 0).rg;
  float covariance00 = uintBitsToFloat(decodedA.w);
  float covariance01 = uintBitsToFloat(decodedB.x);
  float covariance02 = uintBitsToFloat(decodedB.y);
  float covariance11 = uintBitsToFloat(decodedB.z);
  float covariance12 = uintBitsToFloat(decodedB.w);
  float covariance22 = uintBitsToFloat(decodedC.x);
  float opacity = float((decodedC.y >> 24u) & 255u) / 255.0;

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
  vec3 worldJacobianX = vec3(
    dot(uView[0].xyz, jacobianX),
    dot(uView[1].xyz, jacobianX),
    dot(uView[2].xyz, jacobianX)
  );
  vec3 worldJacobianY = vec3(
    dot(uView[0].xyz, jacobianY),
    dot(uView[1].xyz, jacobianY),
    dot(uView[2].xyz, jacobianY)
  );
  vec3 covarianceX = vec3(
    covariance00 * worldJacobianX.x + covariance01 * worldJacobianX.y + covariance02 * worldJacobianX.z,
    covariance01 * worldJacobianX.x + covariance11 * worldJacobianX.y + covariance12 * worldJacobianX.z,
    covariance02 * worldJacobianX.x + covariance12 * worldJacobianX.y + covariance22 * worldJacobianX.z
  );
  vec3 covarianceY = vec3(
    covariance00 * worldJacobianY.x + covariance01 * worldJacobianY.y + covariance02 * worldJacobianY.z,
    covariance01 * worldJacobianY.x + covariance11 * worldJacobianY.y + covariance12 * worldJacobianY.z,
    covariance02 * worldJacobianY.x + covariance12 * worldJacobianY.y + covariance22 * worldJacobianY.z
  );
  float projectedA = dot(worldJacobianX, covarianceX);
  float projectedB = dot(worldJacobianX, covarianceY);
  float projectedC = dot(worldJacobianY, covarianceY);
  float determinantBefore = max(projectedA * projectedC - projectedB * projectedB, 0.0);
  float a = projectedA + 0.1;
  float b = projectedB;
  float c = projectedC + 0.1;
  float determinantAfter = max(a * c - b * b, 0.000001);
  opacity *= sqrt(
    determinantBefore / (determinantAfter + 0.000001) + 0.000001
  );
  float midpoint = 0.5 * (a + c);
  float radius = length(vec2(0.5 * (a - c), b));
  float lambda1 = max(0.1, midpoint + radius);
  float lambda2 = max(0.1, midpoint - radius);
  float projectedSigma = sqrt(max(lambda1, lambda2));
  float sampleWeight = 1.0 - smoothstep(2.5, 10.0, projectedSigma);
  float effectiveCompensation = mix(1.0, uSampleCompensation, sampleWeight);
  float effectiveFootprint = mix(1.0, uSampleFootprintScale, sampleWeight);
  opacity = 1.0 - pow(
    max(1.0 - clamp(opacity, 0.0, 0.999999), 0.000001),
    effectiveCompensation
  );
  if (opacity < 0.00392) return;

  float crop = min(1.0, sqrt(max(-log(0.00392 / opacity), 0.0)) * 0.5);
  float maxExtent = max(64.0, min(1024.0, min(uViewport.x, uViewport.y)));
  float extent1 = min(2.0 * sqrt(2.0 * lambda1), maxExtent) * crop * effectiveFootprint;
  float extent2 = min(2.0 * sqrt(2.0 * lambda2), maxExtent) * crop * effectiveFootprint;
  if (max(extent1, extent2) < 0.3) return;

  vec2 eigen1 = abs(b) > 0.00001
    ? normalize(vec2(b, lambda1 - a))
    : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 eigen2 = vec2(eigen1.y, -eigen1.x);
  vec2 axis1 = eigen1 * extent1 / uViewport * 2.0;
  vec2 axis2 = eigen2 * extent2 / uViewport * 2.0;
  vec3 ndcCenter = clipCenter.xyz / clipCenter.w;

  outProjectedA = uvec4(
    floatBitsToUint(ndcCenter),
    decodedC.y & 0x00ffffffu
  );
  outProjectedB = uvec4(
    packHalf2x16(axis1),
    packHalf2x16(axis2),
    packHalf2x16(vec2(opacity, crop)),
    1u
  );
}
`;

const MRT_EXPAND_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 aCornerLane;
uniform int uCount;
uniform int uProjectionWidth;
uniform highp usampler2D uProjectedA;
uniform highp usampler2D uProjectedB;
flat out vec3 vColor;
flat out float vOpacity;
out vec2 vLocal;

void main() {
  int order = gl_InstanceID * ${SPLATS_PER_BATCH_INSTANCE} + int(aCornerLane.z);
  vColor = vec3(0.0);
  vOpacity = 0.0;
  vLocal = vec2(0.0);
  if (order >= uCount) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  ivec2 uv = ivec2(order % uProjectionWidth, order / uProjectionWidth);
  uvec4 projectedA = texelFetch(uProjectedA, uv, 0);
  uvec4 projectedB = texelFetch(uProjectedB, uv, 0);
  if (projectedB.w == 0u) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 ndcCenter = uintBitsToFloat(projectedA.xyz);
  vec4 axes = vec4(
    unpackHalf2x16(projectedB.x),
    unpackHalf2x16(projectedB.y)
  );
  vec2 opacityCrop = unpackHalf2x16(projectedB.z);
  uint packedColor = projectedA.w;
  vColor = vec3(
    float(packedColor & 255u),
    float((packedColor >> 8u) & 255u),
    float((packedColor >> 16u) & 255u)
  ) / 255.0;
  vOpacity = opacityCrop.x;
  vec2 corner = aCornerLane.xy;
  vec2 offset = corner.x * axes.xy + corner.y * axes.zw;
  gl_Position = vec4(ndcCenter.xy + offset, ndcCenter.z, 1.0);
  vLocal = corner * 2.0 * opacityCrop.y;
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

const SOURCE_TRANSFORM_FEEDBACK_VARYINGS = [
  'tfClipCenter',
  'tfAxes',
  'tfColorOpacity',
  'tfCrop',
];

const PACKED_TRANSFORM_FEEDBACK_VARYINGS = [
  'tfNdcCenter',
  'tfPackedData',
];

// Decode each source SOG once into full-precision integer textures. Camera
// sorting continues to update the small R32UI index texture, so view changes
// never trigger a covariance rebuild.
const ENABLE_COMPACT_GPU_PREDECODE = true;

// The compact projection pass evaluates each Gaussian once and writes 28 bytes
// per splat. The prior 52-byte path was bandwidth-bound on mobile GPUs.
const ENABLE_TRANSFORM_FEEDBACK_PROJECTION = true;

const EXPAND_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec3 aNdcCenter;
layout(location = 1) in vec4 aPackedData;
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
  uvec4 packedData = floatBitsToUint(aPackedData);
  vec2 opacityCrop = unpackHalf2x16(packedData.w);
  vec4 axes = vec4(
    unpackHalf2x16(packedData.x),
    unpackHalf2x16(packedData.y)
  );
  vColor = vec3(
    float(packedData.z & 255u),
    float((packedData.z >> 8u) & 255u),
    float((packedData.z >> 16u) & 255u)
  ) / 255.0;
  vOpacity = opacityCrop.x;
  vec2 corner = quadCorner(gl_VertexID);
  if (vOpacity < 0.00392 || opacityCrop.y <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLocal = vec2(0.0);
    return;
  }
  vec2 offset = corner.x * axes.xy + corner.y * axes.zw;
  gl_Position = vec4(
    aNdcCenter.xy + offset,
    aNdcCenter.z,
    1.0
  );
  vLocal = corner * 2.0 * opacityCrop.y;
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

// Detail chunks use identical source shaders. Keep one program per WebGL
// context so entering a new chunk never recompiles it on the render thread.
const SHARED_SOURCE_PROGRAMS = new WeakMap();
const SHARED_COMPACT_PROGRAMS = new WeakMap();
const SHARED_PACKED_PROJECTION_PROGRAMS = new WeakMap();
const SHARED_MRT_PROJECTION_RESOURCES = new WeakMap();
const SHARED_BATCH_GEOMETRIES = new WeakMap();
const VALIDATED_FLOAT_TF_CONTEXTS = new WeakSet();
const DISABLED_FLOAT_TF_CONTEXTS = new WeakSet();
const PREFERRED_PROJECTION_BACKENDS = new WeakMap();
const TEXTURE_UPLOAD_ROWS_PER_STEP = 64;

function sharedSourceProgram(gl) {
  const cached = SHARED_SOURCE_PROGRAMS.get(gl);
  if (cached && (!gl.isProgram || gl.isProgram(cached))) return cached;
  const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  SHARED_SOURCE_PROGRAMS.set(gl, program);
  return program;
}

function sharedCompactPrograms(gl) {
  const cached = SHARED_COMPACT_PROGRAMS.get(gl);
  if (cached
    && (!gl.isProgram || (gl.isProgram(cached.fast) && gl.isProgram(cached.predecode)))) {
    return cached;
  }
  const programs = {
    fast: createProgram(gl, FAST_VERTEX_SHADER, FRAGMENT_SHADER),
    predecode: createProgram(gl, PREDECODE_VERTEX_SHADER, PREDECODE_FRAGMENT_SHADER),
  };
  SHARED_COMPACT_PROGRAMS.set(gl, programs);
  return programs;
}

function sharedPackedProjectionPrograms(gl) {
  const cached = SHARED_PACKED_PROJECTION_PROGRAMS.get(gl);
  if (cached
    && (!gl.isProgram || (gl.isProgram(cached.fast) && gl.isProgram(cached.expand)))) {
    return cached;
  }
  const programs = {
    fast: createProgram(gl, FAST_VERTEX_SHADER, FRAGMENT_SHADER, {
      transformFeedbackVaryings: PACKED_TRANSFORM_FEEDBACK_VARYINGS,
    }),
    expand: createProgram(gl, EXPAND_VERTEX_SHADER, FRAGMENT_SHADER),
  };
  SHARED_PACKED_PROJECTION_PROGRAMS.set(gl, programs);
  return programs;
}

function cacheProgramUniforms(gl, program, names) {
  const uniforms = {};
  names.forEach((name) => { uniforms[name] = gl.getUniformLocation(program, name); });
  return uniforms;
}

function createBatchedQuadGeometry(gl) {
  const vertexData = new Float32Array(SPLATS_PER_BATCH_INSTANCE * 4 * 3);
  const indexData = new Uint16Array(SPLATS_PER_BATCH_INSTANCE * 6);
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  for (let lane = 0; lane < SPLATS_PER_BATCH_INSTANCE; lane += 1) {
    const vertexBase = lane * 4;
    corners.forEach((corner, cornerIndex) => {
      const offset = (vertexBase + cornerIndex) * 3;
      vertexData[offset] = corner[0];
      vertexData[offset + 1] = corner[1];
      vertexData[offset + 2] = lane;
    });
    const indexOffset = lane * 6;
    indexData[indexOffset] = vertexBase;
    indexData[indexOffset + 1] = vertexBase + 1;
    indexData[indexOffset + 2] = vertexBase + 2;
    indexData[indexOffset + 3] = vertexBase + 2;
    indexData[indexOffset + 4] = vertexBase + 1;
    indexData[indexOffset + 5] = vertexBase + 3;
  }

  const vao = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 3 * Float32Array.BYTES_PER_ELEMENT, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  return {
    indexCount: indexData.length,
    indexBuffer,
    vao,
    vertexBuffer,
  };
}

function sharedBatchedQuadGeometry(gl) {
  const cached = SHARED_BATCH_GEOMETRIES.get(gl);
  if (cached && (!gl.isVertexArray || gl.isVertexArray(cached.vao))) return cached;
  const geometry = createBatchedQuadGeometry(gl);
  SHARED_BATCH_GEOMETRIES.set(gl, geometry);
  return geometry;
}

function sharedMrtProjectionResources(gl) {
  const cached = SHARED_MRT_PROJECTION_RESOURCES.get(gl);
  if (cached
    && (!gl.isProgram || (
      gl.isProgram(cached.projectProgram)
      && gl.isProgram(cached.expandProgram)
    ))) return cached;

  const projectProgram = createProgram(
    gl,
    PREDECODE_VERTEX_SHADER,
    MRT_PROJECTION_FRAGMENT_SHADER,
  );
  const expandProgram = createProgram(gl, MRT_EXPAND_VERTEX_SHADER, FRAGMENT_SHADER);
  const resources = {
    batch: sharedBatchedQuadGeometry(gl),
    capacityRows: 0,
    expandProgram,
    expandUniforms: cacheProgramUniforms(gl, expandProgram, [
      'uCount', 'uProjectionWidth', 'uProjectedA', 'uProjectedB',
    ]),
    framebuffer: gl.createFramebuffer(),
    projectProgram,
    projectUniforms: cacheProgramUniforms(gl, projectProgram, [
      'uView', 'uProjection', 'uViewport', 'uTextureWidth', 'uIndexWidth',
      'uCount', 'uSampleCompensation', 'uSampleFootprintScale',
      'uDecodedA', 'uDecodedB', 'uDecodedC', 'uIndexes',
    ]),
    projectionWidth: 0,
    textures: [],
    vao: gl.createVertexArray(),
  };
  SHARED_MRT_PROJECTION_RESOURCES.set(gl, resources);
  return resources;
}

function ensureMrtProjectionSurface(gl, resources, width, rows) {
  const requiredRows = Math.max(1, Math.ceil(Number(rows) || 1));
  const requiredWidth = Math.max(1, Math.ceil(Number(width) || 1));
  if (resources.projectionWidth === requiredWidth
    && resources.capacityRows >= requiredRows
    && resources.textures.length === 2) return;

  const capacityRows = Math.ceil(requiredRows / 64) * 64;
  resources.textures.forEach((texture) => gl.deleteTexture(texture));
  resources.textures = [
    createUintTexture(gl, requiredWidth, capacityRows),
    createUintTexture(gl, requiredWidth, capacityRows),
  ];
  gl.bindFramebuffer(gl.FRAMEBUFFER, resources.framebuffer);
  resources.textures.forEach((texture, index) => {
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0 + index,
      gl.TEXTURE_2D,
      texture,
      0,
    );
  });
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    resources.textures.forEach((texture) => gl.deleteTexture(texture));
    resources.textures = [];
    resources.capacityRows = 0;
    resources.projectionWidth = 0;
    throw new Error(`MRT projection framebuffer incomplete (${status})`);
  }
  resources.capacityRows = capacityRows;
  resources.projectionWidth = requiredWidth;
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

function createEmptyImageTexture(gl, width, height, channels) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const format = channels === 4 ? gl.RGBA : gl.RGB;
  const internal = channels === 4 ? gl.RGBA8 : gl.RGB8;
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internal,
    width,
    height,
    0,
    format,
    gl.UNSIGNED_BYTE,
    null,
  );
  return texture;
}

function createTextureUploadCanvas(width, height) {
  if (typeof wx !== 'undefined' && typeof wx.createOffscreenCanvas === 'function') {
    let canvas;
    try {
      canvas = wx.createOffscreenCanvas({ type: '2d', width, height });
    } catch (error) {
      canvas = wx.createOffscreenCanvas({ type: '2d' });
    }
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  return null;
}

function createUintTexture(gl, width, height, channels = 4) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    channels === 2 ? gl.RG32UI : gl.RGBA32UI,
    width,
    height,
    0,
    channels === 2 ? gl.RG_INTEGER : gl.RGBA_INTEGER,
    gl.UNSIGNED_INT,
    null,
  );
  return texture;
}

function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) {
    return sign * (fraction / 1024) * (2 ** -14);
  }
  if (exponent === 0x1f) {
    return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  }
  return sign * (1 + fraction / 1024) * (2 ** (exponent - 15));
}

class SplatRenderer {
  constructor(gl, width, height, options = {}) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.sharedSourceProgram = options.shareProgram === true;
    this.program = this.sharedSourceProgram
      ? sharedSourceProgram(gl)
      : createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.vao = gl.createVertexArray();
    this.batchGeometry = sharedBatchedQuadGeometry(gl);
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
    this.pendingTextureUploads = null;
    this.pendingLoadOptions = null;
    this.sceneLoadComplete = false;
    this.textureUploadCanvas = null;
    this.chunkedTextureUploadDisabled = false;
    this.decodedTextures = [];
    this.fastProgram = null;
    this.fastUniforms = null;
    this.fastPredecode = null;
    this.fastAttempted = false;
    this.fastReady = false;
    this.fastPathEnabled = options.enableGpuPredecode === true;
    this.fastDisabled = !this.fastPathEnabled;
    this.fastError = this.fastPathEnabled ? '' : 'disabled by render policy';
    const preferredProjectionBackend = PREFERRED_PROJECTION_BACKENDS.get(gl);
    this.projectionPathEnabled = options.enableProjectedFastPath === true
      && preferredProjectionBackend !== 'direct';
    this.projectionBackend = options.projectionBackend === 'mrt'
      ? 'mrt'
      : 'tf-float28';
    this.projectionProgramsShared = false;
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
    this.mrtProjectionResources = null;
    this.projectionRows = 0;
    this.projectionCapacity = 0;
    this.projectionStride = 7 * Uint32Array.BYTES_PER_ELEMENT;
    this.projectionBenchmark = null;
    this.lastRenderPath = 'source-direct-batch128';
    this.count = 0;
    this.sourceCount = 0;
    this.indexCount = 0;
    this.indexStride = normalizeSampleStride(options.indexStride);
    this.indexWidth = 1024;
    this.indexTextures = [gl.createTexture(), gl.createTexture()];
    this.activeIndexTexture = 0;
    this.indexTexture = this.indexTextures[this.activeIndexTexture];
    this.indexRows = 0;
    this.indexTextureAllocated = [false, false];
    this.hasIndexData = false;
    this.pendingIndexUpload = null;
    this.stagedIndexUpload = null;
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
      transformFeedbackVaryings: fast
        ? PACKED_TRANSFORM_FEEDBACK_VARYINGS
        : SOURCE_TRANSFORM_FEEDBACK_VARYINGS,
    });
    const names = fast
      ? [
        'uView', 'uProjection', 'uViewport', 'uTextureWidth', 'uIndexWidth',
        'uCount', 'uIndexStride', 'uSampleCompensation', 'uSampleFootprintScale',
        'uDecodedA', 'uDecodedB', 'uDecodedC', 'uIndexes', 'uTransformPass',
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

  prepareTransformFeedbackProjectionPath() {
    if (!ENABLE_TRANSFORM_FEEDBACK_PROJECTION || !this.projectionPathEnabled) return false;
    if (!this.hasFastPath()) return false;
    if (this.projectionReady) return true;
    if (this.projectionAttempted) return false;
    this.projectionAttempted = true;
    this.projectionFastAttempted = true;
    const gl = this.gl;
    try {
      if (DISABLED_FLOAT_TF_CONTEXTS.has(gl)) {
        throw new Error('Float transform feedback is disabled for this WebGL context');
      }
      if (typeof gl.createTransformFeedback !== 'function') {
        throw new Error('Float projection requires WebGL2 transform feedback');
      }
      const programs = sharedPackedProjectionPrograms(gl);
      this.projectionFastProgram = programs.fast;
      this.projectionFastUniforms = this.cacheUniforms(this.projectionFastProgram, [
        'uView', 'uProjection', 'uViewport', 'uTextureWidth', 'uIndexWidth',
        'uCount', 'uIndexStride', 'uSampleCompensation', 'uSampleFootprintScale',
        'uDecodedA', 'uDecodedB', 'uDecodedC', 'uIndexes', 'uTransformPass',
      ]);
      this.expandProgram = programs.expand;
      this.expandUniforms = {};
      this.projectionProgramsShared = true;
      this.projectionBuffer = gl.createBuffer();
      this.transformFeedback = gl.createTransformFeedback();
      this.expandVao = gl.createVertexArray();
      gl.bindVertexArray(this.expandVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.projectionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
      const stride = this.projectionStride;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(
        1,
        4,
        gl.FLOAT,
        false,
        stride,
        3 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.vertexAttribDivisor(1, 1);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.projectionFastConfigured = false;
      this.projectionValidated = VALIDATED_FLOAT_TF_CONTEXTS.has(gl);
      this.projectionReady = true;
      return true;
    } catch (error) {
      this.projectionError = error && error.message ? error.message : String(error);
      console.warn('[Native v2] float transform feedback unavailable; using direct projection', error);
      this.releaseProjectionPath(false);
      return false;
    }
  }

  prepareProjectionPath() {
    return this.projectionBackend === 'mrt'
      ? this.prepareMrtProjectionPath()
      : this.prepareTransformFeedbackProjectionPath();
  }

  calibrateProjectionPath(matrices, cameraController, iterations = 3) {
    if (!this.hasFastPath() || !this.projectionPathEnabled || !matrices) {
      return { backend: 'direct', directMs: 0, projectedMs: 0 };
    }
    const gl = this.gl;
    const frameCount = Math.max(2, Math.min(5, Math.floor(Number(iterations) || 3)));
    const now = () => (
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    );
    const draw = (projected) => {
      this.projectionPathEnabled = projected;
      this.render(matrices, cameraController, {
        avatar: false,
        clear: true,
        projectedFastPath: projected,
      });
    };
    try {
      draw(false);
      if (typeof gl.finish === 'function') gl.finish();
      const directStartedAt = now();
      for (let frame = 0; frame < frameCount; frame += 1) draw(false);
      if (typeof gl.finish === 'function') gl.finish();
      const directMs = (now() - directStartedAt) / frameCount;

      draw(true);
      if (typeof gl.finish === 'function') gl.finish();
      const projectedPathReady = this.lastRenderPath === 'fast-tf28-float';
      const projectedStartedAt = now();
      for (let frame = 0; frame < frameCount; frame += 1) draw(true);
      if (typeof gl.finish === 'function') gl.finish();
      const projectedMs = (now() - projectedStartedAt) / frameCount;
      const useProjected = projectedPathReady
        && projectedMs > 0
        && projectedMs <= directMs * 0.95;
      const backend = useProjected ? 'tf-float28' : 'direct';
      PREFERRED_PROJECTION_BACKENDS.set(gl, backend);
      this.projectionPathEnabled = useProjected;
      if (!useProjected) this.releaseProjectionPath();
      this.projectionBenchmark = { backend, directMs, projectedMs };
      return this.projectionBenchmark;
    } catch (error) {
      PREFERRED_PROJECTION_BACKENDS.set(gl, 'direct');
      this.projectionPathEnabled = false;
      this.projectionError = error && error.message ? error.message : String(error);
      this.releaseProjectionPath();
      this.projectionBenchmark = {
        backend: 'direct',
        directMs: 0,
        projectedMs: 0,
      };
      return this.projectionBenchmark;
    }
  }

  prepareMrtProjectionPath() {
    if (!ENABLE_TRANSFORM_FEEDBACK_PROJECTION || !this.projectionPathEnabled) return false;
    if (!this.hasFastPath()) return false;
    if (this.projectionReady) return true;
    if (this.projectionAttempted) return false;
    this.projectionAttempted = true;
    this.projectionFastAttempted = true;
    const gl = this.gl;
    try {
      if (typeof gl.drawBuffers !== 'function'
        || typeof gl.drawElementsInstanced !== 'function'
        || gl.getParameter(gl.MAX_DRAW_BUFFERS) < 2
        || gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) < 2
        || gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 2) {
        throw new Error('MRT projection requires WebGL2 MRT and instanced indexed drawing');
      }
      this.mrtProjectionResources = sharedMrtProjectionResources(gl);
      this.projectionFastProgram = this.mrtProjectionResources.projectProgram;
      this.projectionFastUniforms = this.mrtProjectionResources.projectUniforms;
      this.expandProgram = this.mrtProjectionResources.expandProgram;
      this.expandUniforms = this.mrtProjectionResources.expandUniforms;
      this.projectionProgramsShared = true;
      this.projectionFastConfigured = false;
      this.projectionReady = true;
      return true;
    } catch (error) {
      this.projectionError = error && error.message ? error.message : String(error);
      console.warn('[Native v2] MRT projection unavailable; using direct projection', error);
      this.releaseProjectionPath(false);
      return false;
    }
  }

  prepareFastProjectionProgram() {
    return this.prepareProjectionPath();
  }

  releaseProjectionStorage() {
    if (this.projectionBuffer && this.projectionCapacity) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.projectionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    this.projectionRows = 0;
    this.projectionCapacity = 0;
  }

  releaseProjectionPath(allowRetry = true) {
    const gl = this.gl;
    if (!this.projectionProgramsShared) {
      if (this.projectionSourceProgram) gl.deleteProgram(this.projectionSourceProgram);
      if (this.projectionFastProgram) gl.deleteProgram(this.projectionFastProgram);
      if (this.expandProgram) gl.deleteProgram(this.expandProgram);
    }
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
    this.mrtProjectionResources = null;
    this.projectionRows = 0;
    this.projectionCapacity = 0;
    this.projectionReady = false;
    this.projectionValidated = false;
    this.projectionProgramsShared = false;
    if (allowRetry) this.projectionAttempted = false;
  }

  ensureProjectionCapacity(count) {
    if (this.projectionBackend === 'mrt') {
      if (!this.mrtProjectionResources) return;
      const rows = Math.max(1, Math.ceil(count / this.indexWidth));
      ensureMrtProjectionSurface(
        this.gl,
        this.mrtProjectionResources,
        this.indexWidth,
        rows,
      );
      this.projectionRows = rows;
      this.projectionCapacity = (
        this.mrtProjectionResources.projectionWidth
        * this.mrtProjectionResources.capacityRows
      );
      return;
    }
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
    if (this.projectionFastProgram && this.projectionFastUniforms) {
      this.gl.useProgram(this.projectionFastProgram);
      this.gl.uniform2f(this.projectionFastUniforms.uViewport, this.width, this.height);
    }
  }

  setFallbackAvatarEnabled(enabled) {
    this.fallbackAvatarEnabled = !!enabled;
  }

  releaseScene() {
    this.discardPendingIndexUpload();
    this.discardStagedIndexes();
    this.releaseFastPath();
    this.dataTextures.forEach((texture) => this.gl.deleteTexture(texture));
    this.dataTextures = [];
    this.pendingTextureUploads = null;
    this.pendingLoadOptions = null;
    this.sceneLoadComplete = false;
    this.textureUploadCanvas = null;
    this.chunkedTextureUploadDisabled = false;
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

  beginLoad(scene, assets, options = {}) {
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
    this.pendingTextureUploads = [
      { image: image('means_l.webp'), channels: 3, row: 0, texture: null },
      { image: image('means_u.webp'), channels: 3, row: 0, texture: null },
      { image: image('quats.webp'), channels: 4, row: 0, texture: null },
      { image: image('scales.webp'), channels: 3, row: 0, texture: null },
      { image: image('sh0.webp'), channels: 4, row: 0, texture: null },
    ];
    this.pendingLoadOptions = { initiallyVisible: options.initiallyVisible !== false };
    this.scaleCodebook = new Float32Array(scene.sog.meta.scales.codebook);
    this.colorCodebook = new Float32Array(scene.sog.meta.sh0.codebook);
  }

  finishSceneLoad() {
    const gl = this.gl;
    const options = this.pendingLoadOptions || { initiallyVisible: true };
    this.indexRows = Math.ceil(this.sourceCount / this.indexWidth);
    if (this.indexRows && options.initiallyVisible && this.indexCount) {
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
    gl.uniform1i(this.uniforms.uIndexStride, 1);
    gl.uniform1f(this.uniforms.uSampleCompensation, this.sampleCompensation());
    gl.uniform1f(this.uniforms.uSampleFootprintScale, this.sampleFootprintScale());
    gl.uniform3fv(this.uniforms.uMeansMin, this.scene.sog.meta.means.mins);
    gl.uniform3fv(this.uniforms.uMeansMax, this.scene.sog.meta.means.maxs);
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
    this.pendingTextureUploads = null;
    this.pendingLoadOptions = null;
    this.sceneLoadComplete = true;
    this.textureUploadCanvas = null;
  }

  flushTextureUploads(maxTextures = 1) {
    if (!this.pendingTextureUploads || !this.pendingTextureUploads.length) return 0;
    const gl = this.gl;
    if (gl.isContextLost && gl.isContextLost()) throw new Error('WebGL context is lost');
    const requested = Number(maxTextures);
    const limit = Number.isFinite(requested)
      ? Math.max(1, Math.floor(requested))
      : Number.POSITIVE_INFINITY;
    let uploaded = 0;
    try {
      while (uploaded < limit && this.pendingTextureUploads.length) {
        const pending = this.pendingTextureUploads[0];
        if (!this.chunkedTextureUploadDisabled && !this.textureUploadCanvas) {
          this.textureUploadCanvas = createTextureUploadCanvas(
            this.textureWidth,
            Math.min(TEXTURE_UPLOAD_ROWS_PER_STEP, this.textureHeight),
          );
          if (!this.textureUploadCanvas) this.chunkedTextureUploadDisabled = true;
        }

        if (this.chunkedTextureUploadDisabled) {
          this.dataTextures.push(createImageTexture(gl, pending.image, pending.channels));
          this.pendingTextureUploads.shift();
          uploaded += 1;
          continue;
        }

        let chunkError = null;
        try {
          if (!pending.texture) {
            pending.texture = createEmptyImageTexture(
              gl,
              this.textureWidth,
              this.textureHeight,
              pending.channels,
            );
            this.dataTextures.push(pending.texture);
          }
          const rows = Math.min(
            TEXTURE_UPLOAD_ROWS_PER_STEP,
            this.textureHeight - pending.row,
          );
          const uploadCanvas = this.textureUploadCanvas;
          if (uploadCanvas.width !== this.textureWidth) {
            uploadCanvas.width = this.textureWidth;
          }
          if (uploadCanvas.height !== rows) uploadCanvas.height = rows;
          const context = uploadCanvas.getContext('2d');
          if (!context
            || typeof context.drawImage !== 'function'
            || typeof context.getImageData !== 'function') {
            throw new Error('2D texture upload canvas is unavailable');
          }
          context.clearRect(0, 0, this.textureWidth, rows);
          context.drawImage(
            pending.image,
            0,
            pending.row,
            this.textureWidth,
            rows,
            0,
            0,
            this.textureWidth,
            rows,
          );
          const rgba = context.getImageData(
            0,
            0,
            this.textureWidth,
            rows,
          ).data;
          let pixels = rgba;
          if (pending.channels === 3) {
            const required = this.textureWidth * rows * 3;
            if (!pending.stripPixels || pending.stripPixels.length < required) {
              pending.stripPixels = new Uint8Array(
                this.textureWidth * TEXTURE_UPLOAD_ROWS_PER_STEP * 3,
              );
            }
            pixels = pending.stripPixels.subarray(0, required);
            for (let source = 0, target = 0; target < required; source += 4, target += 3) {
              pixels[target] = rgba[source];
              pixels[target + 1] = rgba[source + 1];
              pixels[target + 2] = rgba[source + 2];
            }
          }
          gl.bindTexture(gl.TEXTURE_2D, pending.texture);
          if (pending.row === 0) {
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
          }
          const format = pending.channels === 4 ? gl.RGBA : gl.RGB;
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            pending.row,
            this.textureWidth,
            rows,
            format,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          if (pending.row === 0) {
            const uploadError = gl.getError ? gl.getError() : gl.NO_ERROR;
            if (uploadError !== gl.NO_ERROR) {
              throw new Error(`Chunked texture upload failed (${uploadError})`);
            }
          }
          pending.row += rows;
          if (pending.row >= this.textureHeight) this.pendingTextureUploads.shift();
        } catch (error) {
          chunkError = error;
        }

        if (chunkError) {
          if (gl.isContextLost && gl.isContextLost()) throw chunkError;
          this.chunkedTextureUploadDisabled = true;
          this.textureUploadCanvas = null;
          if (pending.texture) {
            const textureIndex = this.dataTextures.indexOf(pending.texture);
            if (textureIndex >= 0) this.dataTextures.splice(textureIndex, 1);
            gl.deleteTexture(pending.texture);
            pending.texture = null;
          }
          console.warn('[Native v2] chunked texture upload unavailable; using direct upload', chunkError);
          this.dataTextures.push(createImageTexture(gl, pending.image, pending.channels));
          this.pendingTextureUploads.shift();
        }
        uploaded += 1;
      }
      if (!this.pendingTextureUploads.length) this.finishSceneLoad();
      return uploaded;
    } catch (error) {
      this.releaseScene();
      throw error;
    }
  }

  isLoadComplete() {
    return this.sceneLoadComplete && this.dataTextures.length === 5;
  }

  load(scene, assets, options = {}) {
    this.beginLoad(scene, assets, options);
    // The root renderer is installed behind the loading mask. Preserve its
    // fast direct upload; only background detail renderers use row slices.
    this.chunkedTextureUploadDisabled = true;
    this.flushTextureUploads(Number.POSITIVE_INFINITY);
  }

  hasFastPath() {
    return this.fastReady
      && this.fastProgram
      && this.decodedTextures.length === 3;
  }

  releaseFastPath() {
    const gl = this.gl;
    if (this.projectionReady || this.projectionFastProgram) {
      this.releaseProjectionPath();
    }
    if (this.fastPredecode) {
      this.fastPredecode.textures.forEach((texture) => gl.deleteTexture(texture));
      if (this.fastPredecode.framebuffer) {
        gl.deleteFramebuffer(this.fastPredecode.framebuffer);
      }
      if (this.fastPredecode.vao) gl.deleteVertexArray(this.fastPredecode.vao);
      this.fastPredecode = null;
    }
    this.decodedTextures.forEach((texture) => gl.deleteTexture(texture));
    this.decodedTextures = [];
    this.fastProgram = null;
    this.fastUniforms = null;
    this.fastPredecode = null;
    this.projectionFastProgram = null;
    this.projectionFastUniforms = null;
    this.projectionFastConfigured = false;
    this.projectionFastAttempted = false;
    this.fastAttempted = false;
    this.fastReady = false;
    this.fastDisabled = !this.fastPathEnabled;
    this.fastError = this.fastPathEnabled ? '' : 'disabled by render policy';
  }

  prepareFastPath(maxRows = 64) {
    if (!ENABLE_COMPACT_GPU_PREDECODE || !this.fastPathEnabled || this.fastDisabled) return false;
    if (this.hasFastPath()) return true;
    if (!this.scene
      || this.dataTextures.length !== 5
      || !this.sourceCount
      || !this.textureWidth
      || !this.textureHeight) return false;

    const gl = this.gl;
    this.fastAttempted = true;
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    const previousViewport = gl.getParameter(gl.VIEWPORT);
    const previousScissorBox = gl.getParameter(gl.SCISSOR_BOX);
    const previousColorMask = gl.getParameter(gl.COLOR_WRITEMASK);
    const previousBlend = gl.isEnabled(gl.BLEND);
    const previousCull = gl.isEnabled(gl.CULL_FACE);
    const previousDepth = gl.isEnabled(gl.DEPTH_TEST);
    const previousScissor = gl.isEnabled(gl.SCISSOR_TEST);

    try {
      for (let attempt = 0; attempt < 4 && gl.getError() !== gl.NO_ERROR; attempt += 1) {
        // Clear stale capability-probe errors before validating the predecode pass.
      }
      if (!this.fastPredecode) {
        if (typeof gl.drawBuffers !== 'function'
          || gl.getParameter(gl.MAX_DRAW_BUFFERS) < 3
          || gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) < 3
          || gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 6
          || gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 4) {
          throw new Error('GPU predecode requires WebGL2 MRT and four vertex texture units');
        }
        const programs = sharedCompactPrograms(gl);
        this.fastPredecode = {
          fastProgram: programs.fast,
          framebuffer: null,
          predecodeProgram: programs.predecode,
          row: 0,
          textures: [],
          uniforms: null,
          vao: null,
        };
      }

      const pending = this.fastPredecode;
      if (pending.textures.length < 3) {
        const channels = pending.textures.length === 2 ? 2 : 4;
        pending.textures.push(
          createUintTexture(gl, this.textureWidth, this.textureHeight, channels),
        );
        return false;
      }

      if (!pending.framebuffer) {
        const framebuffer = gl.createFramebuffer();
        pending.framebuffer = framebuffer;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        pending.textures.forEach((texture, index) => {
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0 + index,
            gl.TEXTURE_2D,
            texture,
            0,
          );
        });
        gl.drawBuffers([
          gl.COLOR_ATTACHMENT0,
          gl.COLOR_ATTACHMENT1,
          gl.COLOR_ATTACHMENT2,
        ]);
        const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (framebufferStatus !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(`GPU predecode framebuffer incomplete (${framebufferStatus})`);
        }
        const vao = gl.createVertexArray();
        const uniforms = this.cacheUniforms(pending.predecodeProgram, [
          'uTextureWidth', 'uCount',
          'uMeansMin', 'uMeansMax', 'uScaleCodebook[0]',
          'uColorCodebook[0]', 'uMeansLow', 'uMeansHigh', 'uQuats', 'uScales', 'uColors',
        ]);
        pending.uniforms = uniforms;
        pending.vao = vao;
        return false;
      }

      const requestedRows = Number(maxRows);
      const rowBudget = Number.isFinite(requestedRows)
        ? Math.max(1, Math.floor(requestedRows))
        : this.textureHeight;
      const rows = Math.min(rowBudget, this.textureHeight - pending.row);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pending.framebuffer);
      gl.drawBuffers([
        gl.COLOR_ATTACHMENT0,
        gl.COLOR_ATTACHMENT1,
        gl.COLOR_ATTACHMENT2,
      ]);
      gl.viewport(0, 0, this.textureWidth, this.textureHeight);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, pending.row, this.textureWidth, rows);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.useProgram(pending.predecodeProgram);
      gl.bindVertexArray(pending.vao);
      gl.uniform1i(pending.uniforms.uTextureWidth, this.textureWidth);
      gl.uniform1i(pending.uniforms.uCount, this.sourceCount);
      gl.uniform3fv(pending.uniforms.uMeansMin, this.scene.sog.meta.means.mins);
      gl.uniform3fv(pending.uniforms.uMeansMax, this.scene.sog.meta.means.maxs);
      gl.uniform4fv(pending.uniforms['uScaleCodebook[0]'], this.scaleCodebook);
      gl.uniform4fv(pending.uniforms['uColorCodebook[0]'], this.colorCodebook);
      this.bindTexture(0, this.dataTextures[0], pending.uniforms.uMeansLow);
      this.bindTexture(1, this.dataTextures[1], pending.uniforms.uMeansHigh);
      this.bindTexture(2, this.dataTextures[2], pending.uniforms.uQuats);
      this.bindTexture(3, this.dataTextures[3], pending.uniforms.uScales);
      this.bindTexture(4, this.dataTextures[4], pending.uniforms.uColors);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const predecodeError = gl.getError();
      if (predecodeError !== gl.NO_ERROR) {
        throw new Error(`GPU predecode failed (${predecodeError})`);
      }
      pending.row += rows;
      if (pending.row < this.textureHeight) return false;

      const oldDecodedTextures = this.decodedTextures;
      this.fastProgram = pending.fastProgram;
      this.fastUniforms = this.cacheUniforms(this.fastProgram, [
        'uView', 'uProjection', 'uViewport', 'uTextureWidth', 'uIndexWidth',
        'uCount', 'uIndexStride', 'uSampleCompensation', 'uSampleFootprintScale',
        'uDecodedA', 'uDecodedB', 'uDecodedC', 'uIndexes', 'uTransformPass',
      ]);
      this.decodedTextures = pending.textures;
      gl.deleteFramebuffer(pending.framebuffer);
      gl.deleteVertexArray(pending.vao);
      this.fastPredecode = null;
      this.fastReady = true;
      this.fastError = '';
      oldDecodedTextures.forEach((texture) => gl.deleteTexture(texture));
      if (this.projectionPathEnabled && this.prepareProjectionPath()) {
        this.ensureProjectionCapacity(this.count);
      }
      return true;
    } catch (error) {
      if (this.fastPredecode) {
        this.fastPredecode.textures.forEach((texture) => gl.deleteTexture(texture));
        if (this.fastPredecode.framebuffer) {
          gl.deleteFramebuffer(this.fastPredecode.framebuffer);
        }
        if (this.fastPredecode.vao) gl.deleteVertexArray(this.fastPredecode.vao);
        this.fastPredecode = null;
      }
      this.fastDisabled = true;
      this.fastError = error && error.message ? error.message : String(error);
      console.warn('[Native v2] GPU predecode unavailable; using source decode', error);
      return false;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.viewport(
        previousViewport[0],
        previousViewport[1],
        previousViewport[2],
        previousViewport[3],
      );
      gl.scissor(
        previousScissorBox[0],
        previousScissorBox[1],
        previousScissorBox[2],
        previousScissorBox[3],
      );
      gl.useProgram(previousProgram);
      gl.bindVertexArray(previousVao);
      gl.activeTexture(previousActiveTexture);
      gl.colorMask(
        previousColorMask[0],
        previousColorMask[1],
        previousColorMask[2],
        previousColorMask[3],
      );
      [
        [gl.BLEND, previousBlend],
        [gl.CULL_FACE, previousCull],
        [gl.DEPTH_TEST, previousDepth],
        [gl.SCISSOR_TEST, previousScissor],
      ].forEach(([capability, enabled]) => {
        if (enabled) gl.enable(capability);
        else gl.disable(capability);
      });
    }
  }

  sampleCompensation() {
    const footprint = this.sampleFootprintScale();
    return Math.min(2.2, this.indexStride / (footprint * footprint));
  }

  sampleFootprintScale() {
    return Math.min(
      1.45,
      1 + (Math.sqrt(this.indexStride) - 1) * 0.28,
    );
  }

  applySamplingUniforms(program, uniforms) {
    if (!program || !uniforms) return;
    const gl = this.gl;
    gl.useProgram(program);
    gl.uniform1i(uniforms.uIndexStride, 1);
    gl.uniform1f(uniforms.uSampleCompensation, this.sampleCompensation());
    gl.uniform1f(uniforms.uSampleFootprintScale, this.sampleFootprintScale());
  }

  setIndexStride(stride) {
    const normalized = normalizeSampleStride(stride);
    if (normalized === this.indexStride) return false;
    this.indexStride = normalized;
    this.applySamplingUniforms(this.program, this.uniforms);
    this.applySamplingUniforms(this.fastProgram, this.fastUniforms);
    this.applySamplingUniforms(this.projectionSourceProgram, this.projectionSourceUniforms);
    this.applySamplingUniforms(this.projectionFastProgram, this.projectionFastUniforms);
    return true;
  }

  setRendererCount(count) {
    const gl = this.gl;
    this.count = count;
    if (this.projectionReady && count > this.projectionCapacity) {
      this.ensureProjectionCapacity(count);
    }
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
    this.setRendererCount(this.indexCount);
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
    this.prepareIndexBuffer(this.activeIndexTexture);
    this.prepareIndexBuffer(1 - this.activeIndexTexture);
    this.indexTexture = this.indexTextures[this.activeIndexTexture];
    return true;
  }

  prepareIndexBuffer(index) {
    if (!this.sourceCount || !this.indexRows) return false;
    const normalized = Number(index) === 1 ? 1 : 0;
    this.ensureIndexTexture(normalized);
    if (normalized === this.activeIndexTexture) {
      this.indexTexture = this.indexTextures[this.activeIndexTexture];
    }
    return true;
  }

  discardPendingIndexUpload() {
    const upload = this.pendingIndexUpload;
    if (!upload) return;
    this.pendingIndexUpload = null;
    if (upload.onDiscarded) upload.onDiscarded();
  }

  discardStagedIndexes() {
    const staged = this.stagedIndexUpload;
    if (!staged) return false;
    this.stagedIndexUpload = null;
    if (staged.onDiscarded) staged.onDiscarded();
    return true;
  }

  hasStagedIndexes() {
    return !!this.stagedIndexUpload;
  }

  commitStagedIndexes() {
    const staged = this.stagedIndexUpload;
    if (!staged) return false;
    this.stagedIndexUpload = null;
    this.activeIndexTexture = staged.uploadIndex;
    this.indexTexture = this.indexTextures[this.activeIndexTexture];
    this.hasIndexData = staged.count > 0 || this.hasIndexData;
    this.setActiveIndexCount(staged.count);
    if (staged.onCommitted) staged.onCommitted();
    return true;
  }

  updateIndexes(indexes, options = {}) {
    if (!this.sourceCount || !indexes || indexes.length > this.sourceCount) {
      if (options.onDiscarded) options.onDiscarded();
      return;
    }
    this.discardPendingIndexUpload();
    this.discardStagedIndexes();
    if (!indexes.length) {
      if (options.holdCommit) {
        this.stagedIndexUpload = {
          count: 0,
          onCommitted: options.onCommitted || null,
          onDiscarded: options.onDiscarded || null,
          uploadIndex: this.hasIndexData
            ? 1 - this.activeIndexTexture
            : this.activeIndexTexture,
        };
      } else {
        this.setActiveIndexCount(0);
        if (options.onCommitted) options.onCommitted();
      }
      return;
    }
    let sampledIndexes = indexes;
    if (options.preSampled !== true && this.indexStride > 1) {
      let sampledCount = 0;
      for (let item = 0; item < indexes.length; item += 1) {
        if (isSampledSourceIndex(indexes[item], this.indexStride)) sampledCount += 1;
      }
      if (sampledCount !== indexes.length) {
        const sampled = new Uint32Array(sampledCount);
        let target = 0;
        for (let item = 0; item < indexes.length; item += 1) {
          const sourceIndex = indexes[item];
          if (!isSampledSourceIndex(sourceIndex, this.indexStride)) continue;
          sampled[target] = sourceIndex;
          target += 1;
        }
        sampledIndexes = sampled;
      }
    }
    if (!sampledIndexes.length) {
      this.setActiveIndexCount(0);
      if (options.onCommitted) options.onCommitted();
      return;
    }
    const uploadIndex = this.hasIndexData
      ? 1 - this.activeIndexTexture
      : this.activeIndexTexture;
    this.pendingIndexUpload = {
      count: sampledIndexes.length,
      indexes: sampledIndexes,
      totalRows: Math.ceil(sampledIndexes.length / this.indexWidth),
      uploadedRows: 0,
      uploadIndex,
      onCommitted: options.onCommitted || null,
      onDiscarded: options.onDiscarded || null,
      holdCommit: options.holdCommit === true,
    };
    this.ensureIndexTexture(uploadIndex);
    if ((!this.hasIndexData
        && options.deferInitial !== true
        && options.holdCommit !== true)
      || options.immediate === true) {
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
      this.pendingIndexUpload = null;
      if (upload.holdCommit) {
        this.stagedIndexUpload = {
          count: upload.count,
          onCommitted: upload.onCommitted,
          onDiscarded: upload.onDiscarded,
          uploadIndex: upload.uploadIndex,
        };
      } else {
        this.activeIndexTexture = upload.uploadIndex;
        this.indexTexture = texture;
        this.hasIndexData = true;
        this.setActiveIndexCount(upload.count);
        if (upload.onCommitted) upload.onCommitted();
      }
    }
    return endRow - startRow;
  }

  bindTexture(unit, texture, uniformLocation) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniformLocation, unit);
  }

  configureSharedSourceUniforms() {
    if (!this.sharedSourceProgram || !this.scene) return;
    const gl = this.gl;
    gl.uniform2f(this.uniforms.uViewport, this.width, this.height);
    gl.uniform1i(this.uniforms.uTextureWidth, this.textureWidth);
    gl.uniform1i(this.uniforms.uIndexWidth, this.indexWidth);
    gl.uniform1i(this.uniforms.uCount, this.count);
    gl.uniform1i(this.uniforms.uIndexStride, 1);
    gl.uniform1f(this.uniforms.uSampleCompensation, this.sampleCompensation());
    gl.uniform1f(this.uniforms.uSampleFootprintScale, this.sampleFootprintScale());
    gl.uniform3fv(this.uniforms.uMeansMin, this.scene.sog.meta.means.mins);
    gl.uniform3fv(this.uniforms.uMeansMax, this.scene.sog.meta.means.maxs);
    gl.uniform4fv(this.uniforms['uScaleCodebook[0]'], this.scaleCodebook);
    gl.uniform4fv(this.uniforms['uColorCodebook[0]'], this.colorCodebook);
  }

  configureTransformFeedbackProjectionProgram() {
    const gl = this.gl;
    const uniforms = this.projectionFastUniforms;
    gl.useProgram(this.projectionFastProgram);
    gl.uniform2f(uniforms.uViewport, this.width, this.height);
    gl.uniform1i(uniforms.uTextureWidth, this.textureWidth);
    gl.uniform1i(uniforms.uIndexWidth, this.indexWidth);
    gl.uniform1i(uniforms.uCount, this.count);
    gl.uniform1i(uniforms.uIndexStride, 1);
    gl.uniform1f(uniforms.uSampleCompensation, this.sampleCompensation());
    gl.uniform1f(uniforms.uSampleFootprintScale, this.sampleFootprintScale());
    gl.uniform1i(uniforms.uTransformPass, 1);
    this.bindTexture(0, this.decodedTextures[0], uniforms.uDecodedA);
    this.bindTexture(1, this.decodedTextures[1], uniforms.uDecodedB);
    this.bindTexture(2, this.decodedTextures[2], uniforms.uDecodedC);
    this.bindTexture(3, this.indexTexture, uniforms.uIndexes);
    this.projectionFastConfigured = true;
    return uniforms;
  }

  configureMrtProjectionProgram() {
    const gl = this.gl;
    const uniforms = this.projectionFastUniforms;
    gl.useProgram(this.projectionFastProgram);
    gl.uniform2f(uniforms.uViewport, this.width, this.height);
    gl.uniform1i(uniforms.uTextureWidth, this.textureWidth);
    gl.uniform1i(uniforms.uIndexWidth, this.indexWidth);
    gl.uniform1i(uniforms.uCount, this.count);
    gl.uniform1f(uniforms.uSampleCompensation, this.sampleCompensation());
    gl.uniform1f(uniforms.uSampleFootprintScale, this.sampleFootprintScale());
    this.bindTexture(0, this.decodedTextures[0], uniforms.uDecodedA);
    this.bindTexture(1, this.decodedTextures[1], uniforms.uDecodedB);
    this.bindTexture(2, this.decodedTextures[2], uniforms.uDecodedC);
    this.bindTexture(3, this.indexTexture, uniforms.uIndexes);
    this.projectionFastConfigured = true;
    return uniforms;
  }

  renderTransformFeedbackProjected(matrices, useFastPath) {
    if (!useFastPath || !this.hasFastPath()) return false;
    if (!this.prepareTransformFeedbackProjectionPath()) return false;
    const gl = this.gl;
    this.ensureProjectionCapacity(this.count);
    let transformStarted = false;
    try {
      if (!this.projectionValidated) {
        for (let attempt = 0; attempt < 4 && gl.getError() !== gl.NO_ERROR; attempt += 1) {
          // Drain stale errors before validating the float-only path once.
        }
      }
      const uniforms = this.configureTransformFeedbackProjectionProgram();
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
          throw new Error(`Float transform feedback failed (${projectionGlError})`);
        }
        if (typeof gl.getBufferSubData === 'function') {
          const sampleLength = Math.min(this.count, 32) * 7;
          const sample = new Float32Array(sampleLength);
          const sampleBits = new Uint32Array(sample.buffer);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.projectionBuffer);
          gl.getBufferSubData(gl.ARRAY_BUFFER, 0, sample);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
          for (let item = 0; item < sampleLength; item += 7) {
            const x = sample[item];
            const y = sample[item + 1];
            const z = sample[item + 2];
            const packedAxis1 = sampleBits[item + 3];
            const packedAxis2 = sampleBits[item + 4];
            const packedColor = sampleBits[item + 5];
            const packedOpacityCrop = sampleBits[item + 6];
            const projectedValues = [
              halfToFloat(packedAxis1 & 0xffff),
              halfToFloat(packedAxis1 >>> 16),
              halfToFloat(packedAxis2 & 0xffff),
              halfToFloat(packedAxis2 >>> 16),
              halfToFloat(packedOpacityCrop & 0xffff),
              halfToFloat(packedOpacityCrop >>> 16),
            ];
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)
              || Math.abs(x) > 2.01 || Math.abs(y) > 2.01 || Math.abs(z) > 2.01
              || projectedValues.some((value) => !Number.isFinite(value))
              || projectedValues.slice(0, 4).some((value) => Math.abs(value) > 4.01)
              || projectedValues[4] < 0 || projectedValues[4] > 1.01
              || projectedValues[5] < 0 || projectedValues[5] > 1.01
              || (packedColor & 0xff000000) !== 0) {
              throw new Error('Float transform feedback produced invalid packed projection data');
            }
          }
        }
        this.projectionValidated = true;
        VALIDATED_FLOAT_TF_CONTEXTS.add(gl);
      }

      gl.useProgram(this.expandProgram);
      gl.bindVertexArray(this.expandVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
      this.lastRenderPath = 'fast-tf28-float';
      return true;
    } catch (error) {
      if (transformStarted) {
        try { gl.endTransformFeedback(); } catch (endError) { /* already ended */ }
      }
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      this.projectionError = error && error.message ? error.message : String(error);
      DISABLED_FLOAT_TF_CONTEXTS.add(gl);
      PREFERRED_PROJECTION_BACKENDS.set(gl, 'direct');
      console.warn('[Native v2] float transform feedback render failed; using direct projection', error);
      this.releaseProjectionPath(false);
      return false;
    }
  }

  renderMrtProjected(matrices, useFastPath) {
    if (!useFastPath || !this.hasFastPath()) return false;
    if (!this.prepareProjectionPath()) return false;
    const gl = this.gl;
    this.ensureProjectionCapacity(this.count);
    const resources = this.mrtProjectionResources;
    try {
      if (!this.projectionValidated) {
        for (let attempt = 0; attempt < 4 && gl.getError() !== gl.NO_ERROR; attempt += 1) {
          // Drain stale capability-probe errors before validating the MRT path.
        }
      }
      const uniforms = this.configureMrtProjectionProgram();
      gl.uniformMatrix4fv(uniforms.uView, false, matrices.view);
      gl.uniformMatrix4fv(uniforms.uProjection, false, matrices.projection);
      gl.bindFramebuffer(gl.FRAMEBUFFER, resources.framebuffer);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, this.indexWidth, this.projectionRows);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.bindVertexArray(resources.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!this.projectionValidated) {
        const projectionGlError = gl.getError();
        if (projectionGlError !== gl.NO_ERROR) {
          throw new Error(`MRT projection failed (${projectionGlError})`);
        }
        this.projectionValidated = true;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      gl.useProgram(resources.expandProgram);
      gl.uniform1i(resources.expandUniforms.uCount, this.count);
      gl.uniform1i(resources.expandUniforms.uProjectionWidth, this.indexWidth);
      this.bindTexture(0, resources.textures[0], resources.expandUniforms.uProjectedA);
      this.bindTexture(1, resources.textures[1], resources.expandUniforms.uProjectedB);
      gl.bindVertexArray(resources.batch.vao);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        resources.batch.indexCount,
        gl.UNSIGNED_SHORT,
        0,
        Math.ceil(this.count / SPLATS_PER_BATCH_INSTANCE),
      );
      this.lastRenderPath = 'fast-mrt32-batch128';
      return true;
    } catch (error) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      this.projectionError = error && error.message ? error.message : String(error);
      console.warn('[Native v2] MRT projection render failed; using direct projection', error);
      this.releaseProjectionPath(false);
      return false;
    }
  }

  renderProjected(matrices, useFastPath) {
    return this.projectionBackend === 'mrt'
      ? this.renderMrtProjected(matrices, useFastPath)
      : this.renderTransformFeedbackProjected(matrices, useFastPath);
  }

  render(matrices, cameraController, options = {}) {
    if (!this.count || !this.scene || this.dataTextures.length !== 5) return;
    const gl = this.gl;
    // GPU predecode allocates three large integer textures. It must only be
    // driven by the explicit loading/idle scheduler, never by an interactive
    // render or index-commit frame.
    const useFastPath = this.hasFastPath();
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
    if (options.projectedFastPath !== false && this.renderProjected(matrices, useFastPath)) {
      if (options.avatar !== false) this.renderAvatar(matrices, cameraController);
      gl.bindVertexArray(null);
      return;
    }
    const program = useFastPath ? this.fastProgram : this.program;
    const uniforms = useFastPath ? this.fastUniforms : this.uniforms;
    gl.useProgram(program);
    gl.bindVertexArray(this.batchGeometry.vao);
    if (useFastPath) {
      gl.uniform2f(uniforms.uViewport, this.width, this.height);
      gl.uniform1i(uniforms.uTextureWidth, this.textureWidth);
      gl.uniform1i(uniforms.uIndexWidth, this.indexWidth);
      gl.uniform1i(uniforms.uCount, this.count);
      gl.uniform1i(uniforms.uIndexStride, 1);
      gl.uniform1f(uniforms.uSampleCompensation, this.sampleCompensation());
      gl.uniform1f(uniforms.uSampleFootprintScale, this.sampleFootprintScale());
      this.bindTexture(0, this.decodedTextures[0], uniforms.uDecodedA);
      this.bindTexture(1, this.decodedTextures[1], uniforms.uDecodedB);
      this.bindTexture(2, this.decodedTextures[2], uniforms.uDecodedC);
      this.bindTexture(3, this.indexTexture, uniforms.uIndexes);
    } else {
      this.configureSharedSourceUniforms();
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
    gl.drawElementsInstanced(
      gl.TRIANGLES,
      this.batchGeometry.indexCount,
      gl.UNSIGNED_SHORT,
      0,
      Math.ceil(this.count / SPLATS_PER_BATCH_INSTANCE),
    );
    this.lastRenderPath = useFastPath ? 'fast-direct-batch128' : 'source-direct-batch128';

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
      decodedBytes: this.hasFastPath() ? this.sourceCount * 40 : 0,
      fastPredecodeRows: this.fastPredecode
        ? `${this.fastPredecode.row}/${this.textureHeight}`
        : '',
      fastDisabled: this.fastDisabled,
      fastError: this.fastError,
      fastReady: this.hasFastPath(),
      indexCount: this.indexCount,
      indexStride: this.indexStride,
      indexUploadRows: pendingRows,
      stagedIndexes: this.hasStagedIndexes(),
      path: this.lastRenderPath,
      projectionCapacity: this.projectionCapacity,
      projectionBenchmark: this.projectionBenchmark,
      projectionBackend: this.projectionPathEnabled ? this.projectionBackend : 'direct',
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
    if (!this.sharedSourceProgram) gl.deleteProgram(this.program);
    if (this.avatarProgram) gl.deleteProgram(this.avatarProgram);
    if (this.avatarBuffer) gl.deleteBuffer(this.avatarBuffer);
    gl.deleteVertexArray(this.vao);
    if (this.avatarVao) gl.deleteVertexArray(this.avatarVao);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { SplatRenderer };
if (typeof window !== 'undefined') window.NativeSplatRenderer = SplatRenderer;
