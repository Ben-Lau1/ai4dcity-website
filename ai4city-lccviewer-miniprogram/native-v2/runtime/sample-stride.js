'use strict';

(function registerSampleStride(root) {
  const MIN_SAMPLE_STRIDE = 1;
  const MAX_SAMPLE_STRIDE = 12;
  const SAMPLE_STRIDE_SCALE = 2;

  function normalizeSampleStride(value, fallback = MIN_SAMPLE_STRIDE) {
    const numeric = Number(value);
    const fallbackNumeric = Number(fallback);
    const resolved = Number.isFinite(numeric) && numeric > 0
      ? numeric
      : (Number.isFinite(fallbackNumeric) && fallbackNumeric > 0
        ? fallbackNumeric
        : MIN_SAMPLE_STRIDE);
    return Math.max(
      MIN_SAMPLE_STRIDE,
      Math.min(
        MAX_SAMPLE_STRIDE,
        Math.round(resolved * SAMPLE_STRIDE_SCALE) / SAMPLE_STRIDE_SCALE,
      ),
    );
  }

  function strideUnits(stride) {
    return Math.round(normalizeSampleStride(stride) * SAMPLE_STRIDE_SCALE);
  }

  function sampledSourceIndex(sampleIndex, stride) {
    const sample = Math.max(0, Math.floor(Number(sampleIndex) || 0));
    return Math.floor(sample * strideUnits(stride) / SAMPLE_STRIDE_SCALE);
  }

  function sampledSourceCount(sourceCount, stride) {
    const count = Math.max(0, Math.floor(Number(sourceCount) || 0));
    return Math.ceil(count * SAMPLE_STRIDE_SCALE / strideUnits(stride));
  }

  function ceilDivide(numerator, denominator) {
    return Math.floor((numerator + denominator - 1) / denominator);
  }

  function isSampledSourceIndex(sourceIndex, stride) {
    const index = Math.floor(Number(sourceIndex));
    if (!Number.isFinite(index) || index < 0) return false;
    const units = strideUnits(stride);
    return ceilDivide((index + 1) * SAMPLE_STRIDE_SCALE, units)
      > ceilDivide(index * SAMPLE_STRIDE_SCALE, units);
  }

  const SAMPLE_STRIDE_API = {
    isSampledSourceIndex,
    normalizeSampleStride,
    sampledSourceCount,
    sampledSourceIndex,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SAMPLE_STRIDE_API;
  if (root) root.NativeSampleStride = SAMPLE_STRIDE_API;
}(typeof window !== 'undefined' ? window : null));
