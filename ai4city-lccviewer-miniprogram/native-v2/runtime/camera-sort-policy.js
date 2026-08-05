'use strict';

const SORT_POSITION_THRESHOLD_SQ = 4;
const SORT_RESULT_POSITION_THRESHOLD_SQ = 64;
const SORT_DIRECTION_DOT_THRESHOLD = Math.cos(6 * Math.PI / 180);
const SORT_RESULT_DIRECTION_DOT_THRESHOLD = Math.cos(14 * Math.PI / 180);

function usesDirectionalDepth(camera) {
  // Preserve the legacy directional policy when the caller does not specify a
  // mode. Native v2 explicitly disables it to match the H5 SDK default.
  return !camera || camera.enableDepthSorting !== false;
}

function forwardDot(left, right) {
  if (!left || !right) return 1;
  const leftLength = Math.hypot(left[0], left[1], left[2]) || 1;
  const rightLength = Math.hypot(right[0], right[1], right[2]) || 1;
  return (
    left[0] * right[0]
      + left[1] * right[1]
      + left[2] * right[2]
  ) / (leftLength * rightLength);
}

function cameraNeedsSort(current, previous) {
  if (!previous) return true;
  const dx = current.position[0] - previous.position[0];
  const dy = current.position[1] - previous.position[1];
  const dz = current.position[2] - previous.position[2];
  if (dx * dx + dy * dy + dz * dz >= SORT_POSITION_THRESHOLD_SQ) return true;
  if (usesDirectionalDepth(current) !== usesDirectionalDepth(previous)) return true;
  if (!usesDirectionalDepth(current)) return false;
  return forwardDot(current.forward, previous.forward) <= SORT_DIRECTION_DOT_THRESHOLD;
}

function cameraWithinSortCoverage(current, sorted) {
  if (!current || !sorted) return false;
  const dx = current.position[0] - sorted.position[0];
  const dy = current.position[1] - sorted.position[1];
  const dz = current.position[2] - sorted.position[2];
  if (dx * dx + dy * dy + dz * dz > SORT_RESULT_POSITION_THRESHOLD_SQ) return false;
  if (usesDirectionalDepth(current) !== usesDirectionalDepth(sorted)) return false;
  if (!usesDirectionalDepth(current)) return true;
  return forwardDot(current.forward, sorted.forward)
    >= SORT_RESULT_DIRECTION_DOT_THRESHOLD;
}

module.exports = {
  SORT_DIRECTION_DOT_THRESHOLD,
  SORT_POSITION_THRESHOLD_SQ,
  SORT_RESULT_DIRECTION_DOT_THRESHOLD,
  SORT_RESULT_POSITION_THRESHOLD_SQ,
  cameraNeedsSort,
  cameraWithinSortCoverage,
  forwardDot,
  usesDirectionalDepth,
};
