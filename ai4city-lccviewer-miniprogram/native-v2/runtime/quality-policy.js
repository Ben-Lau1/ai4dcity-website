'use strict';

const { normalizeSampleStride } = require('./sample-stride');

const DEFAULT_QUALITY_LEVEL = 3;

// Root splats provide stable far-field coverage. Near-LOD splats carry most of
// the visible detail, so their stride decreases faster at the upper levels.
const QUALITY_OPTIONS = [
  {
    id: 0,
    label: '性能',
    stride: 12,
    detailStride: 9,
    detailPointBudget: 1200000,
    fineReserveRatio: 0.10,
  },
  {
    id: 1,
    label: '流畅',
    stride: 9,
    detailStride: 6,
    detailPointBudget: 1200000,
    fineReserveRatio: 0.14,
  },
  {
    id: 2,
    label: '平衡',
    stride: 7,
    detailStride: 4,
    detailPointBudget: 1250000,
    fineReserveRatio: 0.20,
  },
  {
    id: 3,
    label: '清晰',
    stride: 5.5,
    detailStride: 1.5,
    detailPointBudget: 1150000,
    fineReserveRatio: 0.28,
  },
  {
    id: 4,
    label: '质量',
    stride: 4,
    detailStride: 1,
    detailPointBudget: 1350000,
    fineReserveRatio: 0.35,
  },
];

function qualityProfile(level) {
  return QUALITY_OPTIONS.find((option) => option.id === Number(level))
    || QUALITY_OPTIONS[DEFAULT_QUALITY_LEVEL];
}

function sampleStrideMatches(actual, expected) {
  return normalizeSampleStride(actual) === normalizeSampleStride(expected);
}

module.exports = {
  DEFAULT_QUALITY_LEVEL,
  QUALITY_OPTIONS,
  qualityProfile,
  sampleStrideMatches,
};
