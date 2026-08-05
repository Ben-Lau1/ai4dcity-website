'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const manifestsDirectory = path.resolve(__dirname, '../tools/scene-manifests');

function contains(parent, child, epsilon = 1e-4) {
  return [0, 1, 2].every((axis) => (
    parent.min[axis] - epsilon <= child.min[axis]
      && parent.max[axis] + epsilon >= child.max[axis]
  ));
}

function validateRange(sceneId, sogs, range) {
  assert(range && Number.isInteger(range.file), `${sceneId}: range file is missing`);
  assert(Number.isInteger(range.start) && range.start >= 0, `${sceneId}: invalid range start`);
  assert(Number.isInteger(range.count) && range.count > 0, `${sceneId}: invalid range count`);
  const descriptor = sogs[String(range.file)];
  assert(descriptor, `${sceneId}: SOG ${range.file} is missing`);
  assert(
    range.start + range.count <= descriptor.meta.count,
    `${sceneId}: range exceeds SOG ${range.file}`,
  );
}

for (const filename of fs.readdirSync(manifestsDirectory).filter((name) => name.endsWith('.json'))) {
  test(`manifest contract: ${filename}`, () => {
    const scene = JSON.parse(
      fs.readFileSync(path.join(manifestsDirectory, filename), 'utf8'),
    );
    assert.equal(scene.schemaVersion, 2);
    assert.equal(scene.nearLod.schemaVersion, 2);
    assert(scene.nearLod.nodes.length > 0);
    scene.nearLod.nodes.forEach((node) => {
      assert(node.id && node.bounds && node.base);
      assert(node.detail.length > 0);
      node.detail.forEach((detail) => {
        assert(detail.id && detail.bounds);
        assert(contains(node.bounds, detail.bounds), `${scene.id}: detail escaped node`);
        validateRange(scene.id, scene.nearLod.sogs, detail);
        detail.finer.forEach((finer) => {
          assert(finer.id && finer.bounds && finer.level === 6);
          assert(contains(detail.bounds, finer.bounds), `${scene.id}: finer escaped detail`);
          validateRange(scene.id, scene.nearLod.sogs, finer);
        });
      });
    });
  });
}
