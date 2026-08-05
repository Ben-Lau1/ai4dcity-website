'use strict';

const assert = require('assert');
const test = require('node:test');
const { SplatRenderer } = require('../native-v2/runtime/splat-renderer');

test('staged index upload does not become visible before commit', () => {
  const renderer = Object.create(SplatRenderer.prototype);
  renderer.activeIndexTexture = 0;
  renderer.indexTextures = [{ id: 0 }, { id: 1 }];
  renderer.indexTexture = renderer.indexTextures[0];
  renderer.hasIndexData = true;
  renderer.count = 12;
  let committed = 0;
  renderer.setActiveIndexCount = (count) => {
    renderer.count = count;
  };
  renderer.stagedIndexUpload = {
    count: 37,
    onCommitted: () => { committed += 1; },
    uploadIndex: 1,
  };

  assert.equal(renderer.count, 12);
  assert.equal(renderer.activeIndexTexture, 0);
  assert.equal(renderer.hasStagedIndexes(), true);
  assert.equal(renderer.commitStagedIndexes(), true);
  assert.equal(renderer.count, 37);
  assert.equal(renderer.activeIndexTexture, 1);
  assert.equal(renderer.indexTexture, renderer.indexTextures[1]);
  assert.equal(committed, 1);
});

test('discarding a staged upload preserves the active index texture', () => {
  const renderer = Object.create(SplatRenderer.prototype);
  renderer.activeIndexTexture = 0;
  renderer.indexTextures = [{ id: 0 }, { id: 1 }];
  renderer.indexTexture = renderer.indexTextures[0];
  let discarded = 0;
  renderer.stagedIndexUpload = {
    count: 37,
    onDiscarded: () => { discarded += 1; },
    uploadIndex: 1,
  };

  assert.equal(renderer.discardStagedIndexes(), true);
  assert.equal(renderer.activeIndexTexture, 0);
  assert.equal(renderer.indexTexture, renderer.indexTextures[0]);
  assert.equal(discarded, 1);
});

test('first held index upload respects the frame budget', () => {
  const renderer = Object.create(SplatRenderer.prototype);
  renderer.sourceCount = 64;
  renderer.indexStride = 1;
  renderer.indexWidth = 16;
  renderer.hasIndexData = false;
  renderer.activeIndexTexture = 0;
  renderer.pendingIndexUpload = null;
  renderer.stagedIndexUpload = null;
  renderer.ensureIndexTexture = () => ({ id: 0 });
  let immediateFlushes = 0;
  renderer.flushIndexUpload = () => {
    immediateFlushes += 1;
    return 0;
  };

  renderer.updateIndexes(new Uint32Array(32), {
    holdCommit: true,
    preSampled: true,
  });

  assert.equal(immediateFlushes, 0);
  assert.equal(renderer.pendingIndexUpload.totalRows, 2);
  assert.equal(renderer.pendingIndexUpload.holdCommit, true);
});
