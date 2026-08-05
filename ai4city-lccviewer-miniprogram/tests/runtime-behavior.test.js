'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  QUALITY_OPTIONS,
  qualityProfile,
  sampleStrideMatches,
} = require('../native-v2/runtime/quality-policy');
const {
  cameraNeedsSort,
  cameraWithinSortCoverage,
} = require('../native-v2/runtime/camera-sort-policy');
const { createCameraController } = require('../native-v2/controls/camera-controller');
const {
  NearLodController,
  boundsDepthInterval,
  buildStartupPathFileOrder,
  buildStartupWarmFileOrder,
  sampleTrajectoryByDistance,
} = require('../native-v2/runtime/near-lod-controller');
const {
  CollisionController,
  buildTrajectoryCorridor,
  isWithinTrajectoryCorridor,
} = require('../native-v2/runtime/collision-controller');
const {
  cacheSogPayload,
  cleanupSogPayload,
  fetchNativePackPayload,
} = require('../native-v2/runtime/range-loader');
const { sampledSourceCount } = require('../native-v2/runtime/sample-stride');
const { createSortController } = require('../native-v2/runtime/sort-controller');
const { TrajectoryPlayer } = require('../native-v2/runtime/trajectory-player');

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function angleBetween(left, right) {
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function testQualityPolicy() {
  const sourceCount = 475542;
  const rootCounts = QUALITY_OPTIONS.map(
    (option) => sampledSourceCount(sourceCount, option.stride),
  );
  const detailCounts = QUALITY_OPTIONS.map(
    (option) => sampledSourceCount(sourceCount, option.detailStride),
  );
  for (let index = 1; index < QUALITY_OPTIONS.length; index += 1) {
    assert(rootCounts[index] > rootCounts[index - 1]);
    assert(detailCounts[index] > detailCounts[index - 1]);
  }
  assert(rootCounts[rootCounts.length - 1] > rootCounts[0] * 2.9);
  assert(detailCounts[detailCounts.length - 1] > detailCounts[0] * 5);
  assert.equal(qualityProfile(999).id, 3);
  assert.equal(qualityProfile(3).stride, 5.5);
  assert.equal(qualityProfile(3).detailStride, 1.5);
  assert.equal(qualityProfile(3).detailPointBudget, 1150000);
  assert.equal(qualityProfile(3).fineReserveRatio, 0.28);
  for (let index = 1; index < QUALITY_OPTIONS.length; index += 1) {
    assert(QUALITY_OPTIONS[index].fineReserveRatio
      >= QUALITY_OPTIONS[index - 1].fineReserveRatio);
  }
  assert(sampleStrideMatches(2.49, 2.5));
  assert(!sampleStrideMatches(2.5, 3));
}

function testCameraSortPolicy() {
  const base = {
    position: [0, 0, 0],
    forward: [0, 0, -1],
  };
  const rotate = (degrees) => {
    const radians = degrees * Math.PI / 180;
    return {
      position: [0, 0, 0],
      forward: [Math.sin(radians), 0, -Math.cos(radians)],
    };
  };
  assert.equal(cameraNeedsSort(rotate(4), base), false);
  assert.equal(cameraNeedsSort(rotate(10), base), true);
  assert.equal(cameraWithinSortCoverage(rotate(10), base), true);
  assert.equal(cameraWithinSortCoverage(rotate(18), base), false);
  assert.equal(cameraNeedsSort({ ...base, position: [2, 0, 0] }, base), true);
  const radialBase = { ...base, enableDepthSorting: false };
  const radialRotated = { ...rotate(180), enableDepthSorting: false };
  assert.equal(cameraNeedsSort(radialRotated, radialBase), false);
  assert.equal(cameraWithinSortCoverage(radialRotated, radialBase), true);
  assert.equal(cameraNeedsSort({
    ...radialRotated,
    position: [2, 0, 0],
  }, radialBase), true);
}

function testExactBoundsDepthInterval() {
  const interval = boundsDepthInterval({
    position: [0, 0, 0],
    forward: [1, 0, 0],
  }, {
    min: [-10, -1000, -1000],
    max: [2, 1000, 1000],
  });
  assert.equal(interval.near, -10);
  assert.equal(interval.far, 2);
}

function testAvatarRotationPreservesWorldAnchor() {
  const controller = createCameraController({
    start: [100, 20, -50],
    next: [110, 20, -50],
    trajectory: [
      [100, 20, -50],
      [110, 20, -50],
    ],
  });
  controller.setMode('avatar');
  controller.update(0);
  const actorBefore = controller.getActor();
  const cameraBefore = controller.getCamera().position.slice();

  controller.addGesture(160, 0, 0);
  controller.update(0);
  const actorAfter = controller.getActor();
  const cameraAfter = controller.getCamera().position;

  assert.deepEqual(actorAfter, actorBefore, 'camera rotation must not move the actor');
  assert.notDeepEqual(cameraAfter, cameraBefore, 'third-person camera should orbit the actor');
  assert(
    Math.hypot(cameraAfter[0], cameraAfter[1], cameraAfter[2]) > 50,
    'camera rotation must preserve the scene world offset instead of resetting to origin',
  );
}

function testRecenterPreservesWorldAnchor() {
  const scene = {
    start: [100, 20, -50],
    next: [110, 20, -50],
    trajectory: [
      [100, 20, -50],
      [110, 20, -50],
    ],
  };
  const controller = createCameraController(scene);

  controller.update(0);
  controller.addGesture(120, 80, 0);
  controller.update(0);
  const orbitAnchor = controller.getGroundPosition();
  assert(controller.recenterView());
  controller.update(0);
  assert.deepEqual(
    controller.getGroundPosition(),
    orbitAnchor,
    'orbit recenter must preserve its world-space focus',
  );

  controller.setMode('firstPerson');
  controller.setMovement(0, 1, false);
  controller.update(0.05);
  controller.setMovement(0, 0, false);
  controller.addGesture(100, 60, 0);
  controller.update(0);
  const firstPersonAnchor = controller.getGroundPosition();
  const firstPersonPosition = controller.getCamera().position.slice();
  assert(controller.recenterView());
  controller.update(0);
  assert.deepEqual(
    controller.getGroundPosition(),
    firstPersonAnchor,
    'first-person recenter must preserve its world-space position',
  );
  assert.deepEqual(controller.getCamera().position, firstPersonPosition);

  controller.setMode('avatar');
  controller.setMovement(0, 1, false);
  controller.update(0.05);
  controller.setMovement(0, 0, false);
  controller.addGesture(100, 60, 0);
  controller.update(0);
  const actor = controller.getActor();
  assert(controller.recenterView());
  controller.update(0);
  assert.deepEqual(
    controller.getActor(),
    actor,
    'third-person recenter must preserve the actor position',
  );
}

function testTrajectoryHeading() {
  const player = new TrajectoryPlayer([
    [0, 0, 0],
    [0.001, 0, 0],
    [10, 0, 0],
    [10, 0, 10],
  ], 5);
  assert.equal(player.points.length, 3);
  assert(player.play());

  const frames = [];
  const camera = {
    applyPlayback(position, target) {
      frames.push({
        direction: normalize([
          target[0] - position[0],
          target[1] - position[1],
          target[2] - position[2],
        ]),
        position: position.slice(),
      });
    },
  };
  player.update(0, camera);
  for (let frame = 0; frame < 70; frame += 1) player.update(0.05, camera);

  let maxHeadingStep = 0;
  for (let index = 1; index < frames.length; index += 1) {
    maxHeadingStep = Math.max(
      maxHeadingStep,
      angleBetween(frames[index - 1].direction, frames[index].direction),
    );
    const position = frames[index].position;
    const onFirstLeg = Math.abs(position[2]) < 0.001
      && position[0] >= -0.001
      && position[0] <= 10.001;
    const onSecondLeg = Math.abs(position[0] - 10) < 0.001
      && position[2] >= -0.001
      && position[2] <= 10.001;
    assert(onFirstLeg || onSecondLeg, 'playback position must remain on the source polyline');
  }
  assert(maxHeadingStep < 0.2, `heading step was ${maxHeadingStep}`);
  assert(frames.some((frame) => frame.direction[2] > 0.2));
}

function testFineLodReservation() {
  const controller = Object.create(NearLodController.prototype);
  controller.selectedIds = [];
  controller.selectedFineIds = [];
  controller.fineReserveRatio = qualityProfile(3).fineReserveRatio;
  controller.detailPointBudget = qualityProfile(3).detailPointBudget;
  const bounds = { min: [-10, -10, -10], max: [10, 10, 10] };
  const nodes = [0, 1, 2].map((id) => ({
    id: `node-${id}`,
    bounds,
    detail: [{
      id: `range-${id}`,
      start: id * 440000,
      count: 440000,
      bounds,
      finer: [{ file: id + 10, start: 0, count: 650000 }],
    }],
  }));
  const camera = { position: [0, 0, 0] };
  const selected = controller.selectNodes(camera, nodes);
  const fine = controller.selectFineRanges(camera, selected);
  assert.equal(selected.length, 1, 'clear mode must focus its raw budget on the nearest node');
  assert(fine.length >= 1, 'nearby finer ranges must fit inside the reserved budget');
}

function testLocalLodWinsBeforeDistantScreenBenefit() {
  const controller = Object.create(NearLodController.prototype);
  controller.selectedIds = [];
  controller.selectedFineIds = [];
  controller.samplingStride = qualityProfile(3).stride;
  controller.detailStride = qualityProfile(3).detailStride;
  controller.fineReserveRatio = qualityProfile(3).fineReserveRatio;
  controller.detailPointBudget = qualityProfile(3).detailPointBudget;
  controller.width = 1080;
  controller.height = 1920;
  const localBounds = { min: [-60, -20, -100], max: [60, 20, 20] };
  const distantBounds = { min: [-100, -100, -500], max: [100, 100, -250] };
  const local = {
    id: 'local',
    bounds: localBounds,
    base: { start: 0, count: 700000 },
    detail: [{
      id: 'local-detail',
      start: 0,
      count: 700000,
      bounds: localBounds,
      finer: [{ file: 3, start: 0, count: 900000, bounds: localBounds }],
    }],
  };
  const distant = {
    id: 'distant',
    bounds: distantBounds,
    base: { start: 0, count: 10000 },
    detail: [{
      id: 'distant-detail',
      start: 0,
      count: 500000,
      bounds: distantBounds,
      finer: [],
    }],
  };
  const camera = {
    position: [0, 0, 0],
    lodPosition: [0, 0, 0],
    forward: [0, 0, -1],
    aspect: 1080 / 1920,
  };
  const selected = controller.selectNodes(camera, [distant, local]);
  assert.equal(selected[0].id, 'local');
  assert(selected.some((node) => node.id === 'local'));
  controller.selectedIds = selected.map((node) => node.id);
  const fine = controller.selectFineRanges(camera, selected);
  assert(
    fine.some((candidate) => candidate.parentId === 'local'),
    'the camera-local fine range must be reserved before distant detail',
  );
}

function testSingleBaseRangeManifestShape() {
  const controller = Object.create(NearLodController.prototype);
  controller.selectedIds = [];
  controller.fineReserveRatio = 0;
  controller.detailPointBudget = 1100000;
  controller.samplingStride = 6;
  controller.detailStride = 2;
  controller.width = 1080;
  controller.height = 1920;
  const bounds = { min: [-10, -10, -30], max: [10, 10, -10] };
  const selected = controller.selectNodes({
    position: [0, 0, 0],
    forward: [0, 0, -1],
  }, [{
    id: 'single-base-range',
    bounds,
    base: { start: 0, count: 120000 },
    detail: [{ start: 0, count: 360000 }],
  }]);
  assert(Array.isArray(selected));
}

function testStableFineRangeReplacement() {
  const bounds = { min: [0, 0, 0], max: [1, 1, 1] };
  const detailRange = {
    file: 1,
    start: 10,
    count: 20,
    bounds,
    finer: [{ file: 2, start: 30, count: 40, bounds }],
  };
  const controller = Object.create(NearLodController.prototype);
  controller.scene = {
    nearLod: {
      nodes: [{
        id: 'node',
        base: { file: 0, start: 0, count: 5, bounds },
        detail: [detailRange],
      }],
    },
  };
  const clonedParent = { ...detailRange, finer: detailRange.finer.slice() };
  const plan = controller.buildPlan(['node'], [{
    id: 'fine',
    parentId: 'node',
    range: clonedParent,
  }]);
  assert.equal(plan.rangesByFile['1'], undefined);
  assert.equal(plan.rangesByFile['2'].length, 1);
}

function testVisibleLodWorkGate() {
  const controller = Object.create(NearLodController.prototype);
  controller.pendingIndexFilterIds = [];
  controller.primaryFileIds = new Set();
  controller.activeRenderFileIds = new Set();
  controller.committedFileIds = new Set();
  controller.states = {
    stale: {
      renderer: {
        hasStagedIndexes: () => true,
        pendingIndexUpload: null,
      },
    },
  };
  assert.equal(
    controller.hasPendingIndexWork(),
    false,
    'inactive staged indexes must not permanently block render-scale recovery',
  );
  controller.primaryFileIds.add('stale');
  assert.equal(controller.hasPendingIndexWork(), true);
}

function testStartupWarmBuffer() {
  assert.deepEqual(
    buildStartupWarmFileOrder(['a', 'b'], ['b', 'c', 'd', 'e']),
    ['a', 'b', 'c', 'd', 'e'],
    'small spawn sets should consume every available path-ahead file',
  );
  const primary = Array.from({ length: 12 }, (_, index) => `p${index}`);
  const prefetched = Array.from({ length: 20 }, (_, index) => `f${index}`);
  assert.equal(
    buildStartupWarmFileOrder(primary, prefetched).length,
    26,
    'startup expansion must stay capped to fourteen additional detail files',
  );
}

function testStartupPathPreload() {
  assert.deepEqual(
    sampleTrajectoryByDistance([
      [0, 0, 0],
      [0, 0, 10],
      [0, 0, 30],
    ], 25, 10),
    [
      [0, 0, 0],
      [0, 0, 10],
      [0, 0, 20],
    ],
  );
  const makeNode = (id, x, z) => ({
    id,
    bounds: {
      min: [x - 4, -2, z - 4],
      max: [x + 4, 2, z + 4],
    },
    detail: [{ file: id, start: 0, count: 10 }],
  });
  const scene = {
    trajectory: [
      [0, 0, 0],
      [0, 0, 180],
    ],
    nearLod: {
      nodes: [
        makeNode('a', 0, 0),
        makeNode('b', 0, 50),
        makeNode('c', 0, 100),
        makeNode('d', 0, 150),
        makeNode('off-path', 500, 0),
      ],
    },
  };
  assert.deepEqual(
    buildStartupPathFileOrder(scene, 4),
    ['a', 'b', 'c', 'd'],
    'startup path order should follow the trajectory without admitting distant blocks',
  );
}

function testTrajectoryCollisionCorridor() {
  const corridor = buildTrajectoryCorridor([
    [0, 0, 0],
    [20, 2, 0],
    [100, 2, 0],
  ]);
  assert.equal(isWithinTrajectoryCorridor(corridor, [10, 1, 4], 5), true);
  assert.equal(isWithinTrajectoryCorridor(corridor, [50, 1, 0], 5), false);

  const controller = new CollisionController({
    trajectory: [
      [0, 0, 0],
      [20, 0, 0],
    ],
    collision: {
      nodes: [{
        id: 'mesh',
        face: 1,
        url: 'https://example.invalid/mesh.ply',
        bounds: {
          min: [-10, -2, -10],
          max: [30, 2, 10],
        },
      }],
    },
  });
  controller.update([10, 0, 2], true);
  assert.equal(controller.pathGroundActive, true);
  assert.equal(controller.desiredIds.size, 0);
  assert.equal(
    controller.sampleGround([10, 0, 2], 0),
    null,
    'the camera controller should use its trajectory floor inside the path corridor',
  );
  controller.dispose();
}

function testStartupWarmLoadGate() {
  const controller = Object.create(NearLodController.prototype);
  controller.disposed = false;
  controller.residentReady = false;
  controller.activeFileLoads = 0;
  controller.pendingFileIds = ['ahead'];
  controller.pendingInstallIds = [];
  controller.startupWarmFileIds = new Set(['ahead']);
  controller.states = {};
  controller.isFileWanted = () => true;
  let started = '';
  controller.ensureFile = (fileId) => {
    started = fileId;
    return new Promise(() => {});
  };
  controller.pumpFileLoads();
  assert.equal(started, 'ahead', 'startup prefetch files must pass the pre-ready load gate');
}

function testInteractiveBackgroundLoadGate() {
  const controller = Object.create(NearLodController.prototype);
  controller.disposed = false;
  controller.residentReady = true;
  controller.interactionActive = true;
  controller.activeFileLoads = 0;
  controller.pendingFileIds = ['background'];
  controller.pendingInstallIds = [];
  controller.primaryFileIds = new Set();
  controller.warmFileIds = new Set();
  controller.selectedFileIds = new Set();
  controller.states = {};
  controller.isFileWanted = () => true;
  const started = [];
  controller.ensureFile = (fileId) => {
    started.push(fileId);
    return new Promise(() => {});
  };

  controller.pumpFileLoads();
  assert.deepEqual(
    started,
    [],
    'whole-scene background residency must pause during active interaction',
  );

  controller.pendingFileIds.push('urgent');
  controller.selectedFileIds.add('urgent');
  controller.pumpFileLoads();
  assert.deepEqual(
    started,
    ['urgent'],
    'current and look-ahead files must still load while the camera is moving',
  );
}

function testDownloadBufferIsIndependentFromGpuInstallQueue() {
  const controller = Object.create(NearLodController.prototype);
  controller.disposed = false;
  controller.residentReady = true;
  controller.interactionActive = false;
  controller.activeFileLoads = 0;
  controller.pendingFileIds = ['ahead'];
  controller.pendingInstallIds = ['install-a', 'install-b'];
  controller.primaryFileIds = new Set(['ahead']);
  controller.warmFileIds = new Set(['ahead']);
  controller.selectedFileIds = new Set(['ahead']);
  controller.startupWarmFileIds = new Set();
  controller.states = {
    'install-a': { installing: true },
    'install-b': { installing: true },
  };
  controller.isFileWanted = () => true;
  const started = [];
  controller.ensureFile = (fileId) => {
    started.push(fileId);
    return new Promise(() => {});
  };

  controller.pumpFileLoads();
  assert.deepEqual(
    started,
    ['ahead'],
    'two pending GPU installs must not stop path-ahead network buffering',
  );
}

function testDecodeQueueRespectsGpuInstallBackpressure() {
  const controller = Object.create(NearLodController.prototype);
  controller.disposed = false;
  controller.activeDecodes = 0;
  controller.pendingDecodeIds = ['ahead'];
  controller.pendingInstallIds = ['install-a', 'install-b'];
  controller.primaryFileIds = new Set(['ahead']);
  controller.warmFileIds = new Set(['ahead']);
  controller.states = {
    ahead: { payload: {} },
  };
  controller.isFileWanted = () => true;

  controller.pumpDecodes();
  assert.equal(controller.activeDecodes, 0);
  assert.deepEqual(
    controller.pendingDecodeIds,
    ['ahead'],
    'decoded image sets must remain capped while two GPU installs are pending',
  );
}

function testPrimaryInstallPriority() {
  const controller = Object.create(NearLodController.prototype);
  controller.pendingInstallIds = [];
  controller.primaryFileIds = new Set(['primary']);
  const state = () => ({
    decoding: false,
    failed: false,
    installing: false,
    loading: false,
    pendingAssets: {},
    pendingRenderer: null,
    renderer: null,
  });
  const prefetched = state();
  const primary = state();

  assert.equal(controller.queuePendingInstall('prefetched', prefetched), true);
  assert.equal(controller.queuePendingInstall('primary', primary), true);
  assert.deepEqual(
    controller.pendingInstallIds,
    ['primary', 'prefetched'],
    'the block under the camera must install before speculative look-ahead work',
  );
}

function testResidentPayloadPreloadDisabled() {
  const controller = Object.create(NearLodController.prototype);
  controller.disposed = false;
  controller.residentReady = true;
  controller.residentModeDegraded = false;
  controller.residentPayloadPreloadStarted = false;
  controller.residentFileIds = new Set(['near', 'middle', 'far']);
  controller.selectedFileIds = new Set();
  controller.committedFileIds = new Set();
  controller.residentFailedFileIds = new Set();
  controller.pendingFileIds = ['middle'];
  controller.states = { near: { renderer: {} } };
  controller.residentPayloadFileOrder = () => ['near', 'middle', 'far'];
  let pumps = 0;
  controller.pumpFileLoads = () => { pumps += 1; };

  assert.equal(
    controller.isFileWanted('far'),
    false,
    'interactive mode must not retain every unvisited scene payload',
  );
  controller.startResidentPayloadPreload();
  assert.deepEqual(
    controller.pendingFileIds,
    ['middle'],
    'whole-scene downloads must not start after the loading mask disappears',
  );
  assert.equal(pumps, 0);
}

async function testBackgroundPayloadUsesChunkedFileCache() {
  const previousWx = global.wx;
  const requestLengths = [];
  const writtenPaths = [];
  let appendCount = 0;
  let unlinkCount = 0;
  const fileSystem = {
    appendFile(options) {
      appendCount += 1;
      options.success();
    },
    unlink(options) {
      unlinkCount += 1;
      if (options.success) options.success();
    },
    writeFile(options) {
      writtenPaths.push(options.filePath);
      options.success();
    },
  };
  global.wx = {
    env: { USER_DATA_PATH: '/mock-cache' },
    getFileSystemManager: () => fileSystem,
    request(options) {
      const match = /bytes=(\d+)-(\d+)/.exec(options.header.Range);
      const length = Number(match[2]) - Number(match[1]) + 1;
      requestLengths.push(length);
      options.success({ data: new ArrayBuffer(length), statusCode: 206 });
    },
  };
  const names = [
    'means_l.webp',
    'means_u.webp',
    'quats.webp',
    'scales.webp',
    'sh0.webp',
  ];
  const entries = {};
  names.forEach((name, index) => {
    entries[name] = {
      length: 600 * 1024,
      offset: index * 700 * 1024,
    };
  });
  try {
    const payload = await cacheSogPayload({ sog: { entries, url: 'https://example.test/a.sog' } });
    assert.equal(requestLengths.length, 10);
    assert(Math.max(...requestLengths) <= 512 * 1024);
    assert.equal(writtenPaths.length, 5);
    assert.equal(new Set(writtenPaths).size, 5);
    assert.equal(appendCount, 5);
    cleanupSogPayload(payload);
    assert.equal(unlinkCount, 5);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

async function testNativePackUsesDownloadTransportAndPackedMeans() {
  const previousWx = global.wx;
  const downloadedUrls = [];
  const unlinkedPaths = [];
  global.wx = {
    downloadFile(options) {
      downloadedUrls.push(options.url);
      options.success({
        statusCode: 200,
        tempFilePath: `/native-temp/${downloadedUrls.length}.webp`,
      });
    },
    getFileSystemManager() {
      return {
        unlink(options) {
          unlinkedPaths.push(options.filePath);
          if (options.success) options.success();
        },
      };
    },
    request(options) {
      options.success({
        data: new ArrayBuffer(12),
        statusCode: 200,
      });
    },
  };
  const textureNames = [
    'means_l.webp',
    'means_u.webp',
    'quats.webp',
    'scales.webp',
    'sh0.webp',
  ];
  const textures = {};
  textureNames.forEach((name) => {
    textures[name] = { url: `https://example.test/native/${name}` };
  });
  const scene = {
    sog: {
      meta: { count: 2 },
      nativePack: {
        version: 1,
        means: {
          byteLength: 12,
          url: 'https://example.test/native/means.bin',
        },
        textures,
      },
    },
  };
  try {
    const payload = await fetchNativePackPayload(scene);
    assert.equal(downloadedUrls.length, 5);
    assert.equal(payload.meansBuffer.byteLength, 12);
    assert.equal(Object.keys(payload.files).length, 5);
    cleanupSogPayload(payload);
    assert.equal(unlinkedPaths.length, 5);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

async function testNativePackUsesPredecodedLinearSortCenters() {
  const previousWx = global.wx;
  global.wx = {
    downloadFile(options) {
      options.success({
        statusCode: 200,
        tempFilePath: `/native-temp/${encodeURIComponent(options.url)}.webp`,
      });
    },
    getFileSystemManager() {
      return { unlink() {} };
    },
    request(options) {
      options.success({
        data: new ArrayBuffer(12),
        statusCode: 200,
      });
    },
  };
  const textureNames = [
    'means_l.webp',
    'means_u.webp',
    'quats.webp',
    'scales.webp',
    'sh0.webp',
  ];
  const textures = {};
  textureNames.forEach((name) => {
    textures[name] = { url: `https://example.test/native/${name}` };
  });
  const scene = {
    sog: {
      meta: { count: 2 },
      nativePack: {
        version: 2,
        sortCenters: {
          byteLength: 12,
          format: 'uint16x3-linear',
          maxs: [10, 20, 30],
          mins: [-10, -20, -30],
          url: 'https://example.test/native/centers.bin',
        },
        textures,
      },
    },
  };
  try {
    const payload = await fetchNativePackPayload(scene);
    assert.equal(payload.sortDataBuffer.byteLength, 12);
    assert.deepEqual(payload.sortDataDescriptor, {
      format: 'uint16x3-linear',
      maxs: [10, 20, 30],
      mins: [-10, -20, -30],
    });
    assert.equal(payload.meansBuffer, undefined);
    cleanupSogPayload(payload);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

async function testNativePackFallsBackToPackedMeans() {
  const previousWx = global.wx;
  const requestedUrls = [];
  global.wx = {
    downloadFile(options) {
      options.success({
        statusCode: 200,
        tempFilePath: `/native-temp/${encodeURIComponent(options.url)}.webp`,
      });
    },
    getFileSystemManager() {
      return { unlink() {} };
    },
    request(options) {
      requestedUrls.push(options.url);
      if (options.url.endsWith('/centers.bin')) {
        options.fail({ errMsg: 'temporary centers failure' });
        return;
      }
      options.success({
        data: new ArrayBuffer(12),
        statusCode: 200,
      });
    },
  };
  const textures = {};
  [
    'means_l.webp',
    'means_u.webp',
    'quats.webp',
    'scales.webp',
    'sh0.webp',
  ].forEach((name) => {
    textures[name] = { url: `https://example.test/native/${name}` };
  });
  const scene = {
    sog: {
      meta: { count: 2 },
      nativePack: {
        version: 2,
        means: {
          byteLength: 12,
          url: 'https://example.test/native/means.bin',
        },
        sortCenters: {
          byteLength: 12,
          format: 'uint16x3-linear',
          maxs: [10, 20, 30],
          mins: [-10, -20, -30],
          url: 'https://example.test/native/centers.bin',
        },
        textures,
      },
    },
  };
  try {
    const payload = await fetchNativePackPayload(scene);
    assert.deepEqual(requestedUrls, [
      'https://example.test/native/centers.bin',
      'https://example.test/native/means.bin',
    ]);
    assert.equal(payload.sortDataBuffer, undefined);
    assert.equal(payload.meansBuffer.byteLength, 12);
    cleanupSogPayload(payload);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

function testLinearSortCentersWorkerPath() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../workers/native-splat-sort.js'),
    'utf8',
  );
  const messages = [];
  let onMessage = null;
  const context = {
    ArrayBuffer,
    Date,
    Float32Array,
    Math,
    Uint16Array,
    Uint32Array,
    Uint8Array,
    worker: {
      onMessage(callback) { onMessage = callback; },
      postMessage(message) { messages.push(message); },
    },
  };
  vm.runInNewContext(source, context);
  const centers = new Uint16Array([
    0, 0, 65535,
    0, 0, 49151,
  ]);
  onMessage({
    type: 'init',
    datasetId: 'linear',
    count: 2,
    format: 'uint16x3-linear',
    maxs: [0, 0, 10],
    mins: [0, 0, -10],
    sortDataBuffer: centers.buffer,
  });
  assert.equal(messages.shift().type, 'ready');
  onMessage({
    type: 'sort',
    datasetId: 'linear',
    generation: 1,
    requestId: 1,
    position: [0, 0, 0],
    forward: [0, 0, 1],
    predictedForward: [0, 0, 1],
    cullToFrustum: false,
    enableDepthSorting: false,
    sampleStride: 1,
    startedAt: Date.now(),
  });
  const started = messages.shift();
  assert.equal(started.type, 'sorted-start');
  assert.equal(started.visibleCount, 2);
  onMessage({
    type: 'result-chunk',
    datasetId: 'linear',
    generation: 1,
    requestId: 1,
    maxCount: 1,
  });
  const firstChunk = messages.shift();
  assert.equal(firstChunk.type, 'sorted-chunk');
  assert.equal(firstChunk.done, false);
  assert.deepEqual(Array.from(new Uint32Array(firstChunk.indexesBuffer)), [0]);
  onMessage({
    type: 'result-chunk',
    datasetId: 'linear',
    generation: 1,
    requestId: 1,
    maxCount: 1,
  });
  const secondChunk = messages.shift();
  assert.equal(secondChunk.done, true);
  assert.deepEqual(Array.from(new Uint32Array(secondChunk.indexesBuffer)), [1]);

  onMessage({
    type: 'sort',
    datasetId: 'linear',
    generation: 2,
    requestId: 2,
    position: [0, 0, 0],
    forward: [0, 0, -1],
    predictedForward: [0, 0, -1],
    cullToFrustum: false,
    enableDepthSorting: false,
    sampleStride: 1,
    startedAt: Date.now(),
  });
  assert.equal(messages.shift().type, 'sorted-start');
  onMessage({
    type: 'result-chunk',
    datasetId: 'linear',
    generation: 2,
    requestId: 2,
    maxCount: 2,
  });
  const reversedViewChunk = messages.shift();
  assert.equal(reversedViewChunk.done, true);
  assert.deepEqual(
    Array.from(new Uint32Array(reversedViewChunk.indexesBuffer)),
    [0, 1],
    'radial order must remain stable when only the view direction changes',
  );
}

function testSortControllerPullsResultAcrossFrames() {
  const previousWx = global.wx;
  const posted = [];
  let emitMessage = null;
  const fakeWorker = {
    onError() {},
    onMessage(callback) { emitMessage = callback; },
    onProcessKilled() {},
    postMessage(message) { posted.push(message); },
    terminate() {},
  };
  global.wx = {
    createWorker() { return fakeWorker; },
  };
  const scene = {
    sog: {
      meta: {
        count: 2,
        means: {
          maxs: [1, 1, 1],
          mins: [-1, -1, -1],
        },
      },
    },
  };
  const sortData = {
    format: 'uint16x3-linear',
    maxs: [1, 1, 1],
    mins: [-1, -1, -1],
    values: new Uint16Array(6),
  };
  const completed = [];
  const controller = createSortController(scene, sortData, {
    onSorted(indexes, stats) {
      completed.push({
        indexes: Array.from(indexes),
        transferChunks: stats.lastTransferChunks,
      });
    },
  });
  try {
    assert.equal(posted.shift().type, 'init');
    emitMessage({ type: 'ready', datasetId: 'root' });
    assert.equal(controller.request({
      position: [0, 0, 0],
      forward: [0, 0, 1],
    }), true);
    const sortRequest = posted.shift();
    assert.equal(sortRequest.type, 'sort');
    emitMessage({
      type: 'sorted-start',
      datasetId: 'root',
      generation: sortRequest.generation,
      requestId: sortRequest.requestId,
      duration: 4,
      workerDuration: 3,
      totalCount: 2,
      visibleCount: 2,
    });
    assert.equal(completed.length, 0);
    assert.equal(controller.getStats().transferRemaining, 2);

    assert.equal(controller.flushResultTransfer(1), 1);
    const firstPull = posted.shift();
    assert.equal(firstPull.type, 'result-chunk');
    emitMessage({
      type: 'sorted-chunk',
      datasetId: 'root',
      generation: sortRequest.generation,
      requestId: sortRequest.requestId,
      offset: 0,
      indexesBuffer: new Uint32Array([1]).buffer,
      done: false,
    });
    assert.equal(completed.length, 0);
    assert.equal(controller.getStats().transferRemaining, 1);

    assert.equal(controller.flushResultTransfer(1), 1);
    posted.shift();
    emitMessage({
      type: 'sorted-chunk',
      datasetId: 'root',
      generation: sortRequest.generation,
      requestId: sortRequest.requestId,
      offset: 1,
      indexesBuffer: new Uint32Array([0]).buffer,
      done: true,
    });
    assert.deepEqual(completed, [{
      indexes: [1, 0],
      transferChunks: 2,
    }]);
  } finally {
    controller.dispose();
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

function testStartupVisualReadiness() {
  let fastPathReady = true;
  const baseRenderer = {
    pendingIndexUpload: null,
    hasStagedIndexes: () => false,
  };
  const detailRenderer = {
    fastDisabled: false,
    hasFastPath: () => fastPathReady,
    pendingIndexUpload: null,
    hasStagedIndexes: () => false,
  };
  const controller = Object.create(NearLodController.prototype);
  controller.startupSelectionCaptured = true;
  controller.startupWarmFileIds = new Set(['detail']);
  controller.fastPathFileIds = new Set(['detail']);
  controller.residentFailedFileIds = new Set();
  controller.pendingIndexFilterIds = [];
  controller.baseRenderer = baseRenderer;
  controller.baseCommittedRangesSignature = '10:4';
  controller.committedFileIds = new Set(['detail']);
  controller.selectedIds = ['node'];
  controller.selectedFineRanges = [];
  controller.states = {
    detail: {
      committedRangesSignature: '0:8',
      fastPathAttempted: false,
      renderer: detailRenderer,
    },
  };
  controller.buildPlan = () => ({
    baseRanges: [{ start: 10, count: 4 }],
    fileIds: new Set(['detail']),
    signatures: { detail: '0:8' },
  });

  assert.equal(controller.startupVisualReady(), true);
  fastPathReady = false;
  assert.equal(
    controller.startupVisualReady(),
    false,
    'startup must keep its mask while scheduled detail GPU predecode is unfinished',
  );
  fastPathReady = true;
  detailRenderer.pendingIndexUpload = {};
  assert.equal(
    controller.startupVisualReady(),
    false,
    'startup must stay masked while a detail index upload is unfinished',
  );
  detailRenderer.pendingIndexUpload = null;
  controller.states.detail.committedRangesSignature = '';
  assert.equal(
    controller.startupVisualReady(),
    false,
    'startup must stay masked until the desired detail plan is committed',
  );
}

function testInteractiveFastPathGate() {
  let prepareCalls = 0;
  let progressCalls = 0;
  const controller = Object.create(NearLodController.prototype);
  controller.disposed = false;
  controller.pendingInstallIds = [];
  controller.pendingFastPathIds = ['detail'];
  controller.primaryFileIds = new Set();
  controller.states = {
    detail: {
      fastPathAttempted: false,
      renderer: {
        fastDisabled: false,
        hasFastPath: () => false,
        prepareFastPath() {
          prepareCalls += 1;
          return true;
        },
      },
    },
  };
  controller.shouldPrepareFastPath = () => true;
  controller.notifyResidentProgress = () => { progressCalls += 1; };

  assert.equal(
    controller.flushResourceInstalls(1, { allowFastPath: false }),
    0,
    'interactive frames must leave deferred GPU predecode untouched',
  );
  assert.equal(prepareCalls, 0);
  assert.deepEqual(controller.pendingFastPathIds, ['detail']);

  assert.equal(controller.flushResourceInstalls(1, { allowFastPath: true }), 1);
  assert.equal(prepareCalls, 1);
  assert.equal(progressCalls, 1);
  assert.equal(controller.states.detail.fastPathAttempted, true);
}

function testStartupVisualCommitRace() {
  const progress = [];
  const controller = Object.create(NearLodController.prototype);
  controller.startupSelectionCaptured = true;
  controller.startupWarmFileIds = new Set(['detail']);
  controller.residentFailedFileIds = new Set();
  controller.sortFailedFileIds = new Set();
  controller.states = {
    detail: {
      renderer: {},
      sortedIndexes: new Uint32Array([0]),
    },
  };
  controller.residentReady = true;
  controller.startupVisualCommitted = false;
  controller.lastResidentProgressKey = '';
  controller.onResidentProgress = (state) => progress.push(state);
  let rootReady = false;
  let forcedFlushes = 0;
  controller.startupVisualReady = () => rootReady;
  controller.flushResidentUploads = () => { forcedFlushes += 1; };

  controller.notifyResidentProgress();
  assert.equal(progress.at(-1).complete, false);
  assert.equal(forcedFlushes, 1);

  rootReady = true;
  controller.notifyResidentProgress();
  assert.equal(progress.at(-1).complete, true);
  assert.equal(controller.startupVisualCommitted, true);

  rootReady = false;
  controller.notifyResidentProgress();
  assert.equal(
    forcedFlushes,
    1,
    'later LOD changes must not trigger a synchronous startup flush',
  );
}

function testVisitedDetailRetention() {
  const controller = Object.create(NearLodController.prototype);
  controller.disposed = false;
  controller.residentModeDegraded = false;
  controller.selectedFileIds = new Set();
  controller.committedFileIds = new Set();
  controller.warmFileIds = new Set();
  controller.fastPathFileIds = new Set();
  controller.states = {};
  let releasedFastPaths = 0;
  let releasedProjectionStorage = 0;
  for (let index = 0; index < 12; index += 1) {
    controller.states[String(index)] = {
      decoding: false,
      installing: false,
      lastUsedAt: index,
      loading: false,
      renderer: {
        hasFastPath: () => true,
        releaseFastPath: () => { releasedFastPaths += 1; },
        releaseProjectionStorage: () => { releasedProjectionStorage += 1; },
      },
    };
  }
  const releasedStates = [];
  controller.releaseState = (fileId) => {
    releasedStates.push(fileId);
    delete controller.states[fileId];
  };

  controller.trimFastPaths();
  controller.evictInactiveStates();
  assert.equal(releasedFastPaths, 9);
  assert.equal(releasedProjectionStorage, 12);
  assert.equal(
    releasedStates.length,
    0,
    'normal movement may trim expanded caches but must retain compact visited renderers',
  );

  const releasesBeforeSoftTrim = releasedFastPaths;
  controller.trimFastPaths(true);
  assert.equal(
    releasedFastPaths - releasesBeforeSoftTrim,
    12,
    'a soft memory trim should release every inactive expanded fast path',
  );
  assert.equal(
    releasedStates.length,
    0,
    'a soft memory trim must still retain compact visited renderers',
  );

  controller.residentModeDegraded = true;
  controller.trimFastPaths();
  controller.evictInactiveStates();
  assert(releasedFastPaths > 0);
  assert(releasedProjectionStorage > 0);
  assert(Object.keys(controller.states).length <= 8);
}

function testInactiveDetailKeepsCommittedIndexes() {
  const controller = Object.create(NearLodController.prototype);
  controller.disposed = false;
  controller.selectedIds = [];
  controller.selectedFineRanges = [];
  controller.committedFileIds = new Set(['visited']);
  controller.activeRenderFileIds = new Set(['visited']);
  controller.pendingIndexFilters = Object.create(null);
  controller.pendingIndexFilterIds = [];
  controller.baseRenderer = { count: 0 };
  controller.onActiveCount = null;
  let pendingDiscards = 0;
  let stagedDiscards = 0;
  let detailQueues = 0;
  controller.states = {
    visited: {
      committedKey: 'resident:1/0:64/s1.5',
      committedRangesSignature: '0:64',
      renderer: {
        discardPendingIndexUpload() { pendingDiscards += 1; },
        discardStagedIndexes() { stagedDiscards += 1; },
        hasStagedIndexes: () => true,
      },
      requestedKey: 'pending-plan',
      sortedIndexes: new Uint32Array([0]),
      stagedRangesSignature: 'pending',
    },
  };
  controller.buildPlan = () => ({
    baseRanges: [],
    fileIds: new Set(),
    fine: [],
    nodes: [],
    rangesByFile: Object.create(null),
    signatures: Object.create(null),
  });
  controller.queueBaseIndexes = () => {};
  controller.queueDetailIndexes = () => { detailQueues += 1; };
  controller.commitPlan = (plan) => {
    controller.committedFileIds = new Set(plan.fileIds);
    controller.activeRenderFileIds = new Set(plan.fileIds);
    return true;
  };

  controller.applySelection();

  assert.equal(detailQueues, 0, 'inactive detail must not upload an empty index texture');
  assert.equal(pendingDiscards, 1);
  assert.equal(stagedDiscards, 1);
  assert.equal(controller.states.visited.committedRangesSignature, '0:64');
  assert.equal(
    controller.states.visited.requestedKey,
    controller.states.visited.committedKey,
    'backtracking must be able to reactivate the last committed texture',
  );
}

function testLodSelectionUsesStableGroundAnchor() {
  const controller = Object.create(NearLodController.prototype);
  controller.disposed = false;
  controller.width = 1080;
  controller.height = 1920;
  controller.currentCamera = null;
  controller.lastSelectionCamera = {
    position: [12, 0, -8],
    forward: [0, 0, -1],
  };
  controller.lastSelectionUpdateAt = 0;
  controller.prefetchDirection = [0, 0, -1];
  let selectionUpdates = 0;
  controller.visibleNodes = () => {
    selectionUpdates += 1;
    return [];
  };

  controller.update({
    position: [30, 8, 22],
    forward: [1, 0, 0],
    lodPosition: [12, 0, -8],
  });

  assert.equal(
    selectionUpdates,
    0,
    'orbiting around a stationary actor must not replace the active LOD plan',
  );
  assert.deepEqual(controller.currentCamera.position, [30, 8, 22]);
  assert.deepEqual(controller.currentCamera.lodPosition, [12, 0, -8]);
  assert.deepEqual(controller.lastSelectionCamera.position, [12, 0, -8]);
}

function testSceneRenderQualityReset(pageDefinition) {
  const calls = [];
  const page = {
    ...pageDefinition,
    basePixelRatio: 1.25,
    pixelRatio: 0.82,
    frameMsEma: 92,
    lastGpuMs: 50,
    lastGpuSampleAt: 10,
    lastGpuQueryAt: 10,
    lastGpuPollAt: 10,
    renderScaleRecoveryStartedAt: 10,
    renderScaleRecoveryTarget: 1.25,
    disposeGpuTimers() {
      calls.push('timers');
    },
    setRenderPixelRatio(ratio, now, force) {
      calls.push({ force, now, ratio });
      this.pixelRatio = ratio;
    },
  };
  page.resetSceneRenderQuality(5000);
  assert.equal(page.pixelRatio, 1.25);
  assert.equal(page.frameMsEma, 16.7);
  assert.equal(page.lastGpuMs, 0);
  assert.equal(page.renderScaleRecoveryStartedAt, 0);
  assert.deepEqual(calls, [
    'timers',
    { force: true, now: 5000, ratio: 1.25 },
  ]);
}

function testRenderScaleBusyGrace(pageDefinition) {
  const ratios = [];
  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data, phase: 'ready' },
    basePixelRatio: 1.25,
    interactivePixelRatio: 1.05,
    emergencyPixelRatio: 0.82,
    pixelRatio: 0.82,
    frameMsEma: 16.7,
    lastGpuMs: 0,
    lastGpuSampleAt: 0,
    lastRenderScaleChangeAt: 0,
    renderScaleRecoveryStartedAt: 1000,
    renderScaleRecoveryTarget: 1.25,
    sortController: { getStats: () => ({ busy: true }) },
    splatRenderer: { pendingIndexUpload: {} },
    nearLodController: { hasPendingIndexWork: () => true },
    setRenderPixelRatio(ratio) {
      ratios.push(ratio);
      this.pixelRatio = ratio;
    },
  };
  page.updateAdaptiveRenderScale(2500, 16.7);
  assert.deepEqual(ratios, []);
  page.updateAdaptiveRenderScale(4301, 16.7);
  assert.deepEqual(ratios, [1.25]);
}

function testHiddenDiagnosticsSkipRuntimeInstrumentation(pageDefinition) {
  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      diagnosticsVisible: false,
    },
    frameCount: 60,
    fpsWindowStarted: 0,
    gl: {
      createQuery() {
        throw new Error('hidden diagnostics must not create GPU queries');
      },
    },
    gpuTimerExtension: {},
    pendingGpuQueries: [{}],
    sortController: {
      getStats() {
        throw new Error('hidden diagnostics must not collect sort stats');
      },
    },
    setDataIfChanged() {
      throw new Error('hidden diagnostics must not bridge data to the view layer');
    },
  };

  assert.equal(page.beginGpuTimer(1001), false);
  page.pollGpuTimers(1001, true);
  page.updateDiagnostics(1001, true);
  assert.equal(page.frameCount, 0);
  assert.equal(page.fpsWindowStarted, 1001);
}

function testMovingSortFrameBudget(pageDefinition) {
  const camera = {
    position: [0, 0, 0],
    forward: [0, 0, -1],
  };
  const requests = [];
  const page = {
    ...pageDefinition,
    cameraController: { getCamera: () => camera },
    detailSortDirty: true,
    frameIntervalMsEma: 80,
    lastMotionAt: 0,
    lastMovingDetailSortAt: 0,
    lastMovingRootSortAt: 0,
    lastSortedCamera: null,
    nearLodController: { hasPendingIndexWork: () => false },
    residentReady: true,
    sortController: {
      getStats: () => ({ busy: false, lastWorkerDuration: 10 }),
    },
    sortDirty: true,
    sortRequestedCamera: null,
    splatRenderer: { pendingIndexUpload: null },
    wasCameraMoving: true,
    isCameraMoving: () => true,
    requestCameraSort(reason, options) {
      requests.push({ options, reason });
      if (options.includeRoot) this.sortDirty = false;
      if (options.includeDetails) this.detailSortDirty = false;
      return true;
    },
  };
  page.updateSortSchedule(1000);
  assert.equal(requests.length, 0, 'low frame rate must not schedule background sorting');
  page.sortDirty = true;
  page.detailSortDirty = true;
  page.frameIntervalMsEma = 20;
  page.updateSortSchedule(2000);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].options, {
    includeDetails: true,
    includeRoot: false,
    maxDetailDatasets: 1,
  }, 'only the most overdue sort class should run per moving frame');
  page.sortDirty = true;
  page.updateSortSchedule(3300);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].options, {
    includeDetails: false,
    includeRoot: true,
    maxDetailDatasets: 1,
  }, 'root and detail sorting must not compete in the same moving frame');
}

function testRadialRotationDoesNotScheduleSort(pageDefinition) {
  const requests = [];
  const sortedCamera = {
    enableDepthSorting: false,
    position: [10, 2, 20],
    forward: [0, 0, -1],
  };
  const page = {
    ...pageDefinition,
    cameraController: {
      getCamera: () => ({
        position: sortedCamera.position.slice(),
        forward: [0, 0, 1],
      }),
    },
    detailSortDirty: false,
    detailSortRequestedCamera: sortedCamera,
    frameIntervalMsEma: 16.7,
    lastMotionAt: 0,
    lastMovingDetailSortAt: 0,
    lastMovingRootSortAt: 0,
    lastSortedCamera: sortedCamera,
    nearLodController: { hasPendingIndexWork: () => false },
    residentReady: true,
    sortController: {
      getStats: () => ({ busy: false, lastWorkerDuration: 10, queued: 0 }),
    },
    sortDirty: false,
    sortRequestedCamera: sortedCamera,
    splatRenderer: { pendingIndexUpload: null },
    wasCameraMoving: false,
    isCameraMoving: () => true,
    requestCameraSort(reason, options) {
      requests.push({ options, reason });
      return true;
    },
  };
  page.updateSortSchedule(3000);
  assert.equal(requests.length, 0, 'pure rotation must preserve the current radial index order');
}

function testSourceGuards() {
  const root = path.resolve(__dirname, '..');
  const pageSource = fs.readFileSync(
    path.join(root, 'native-v2/index/index.js'),
    'utf8',
  );
  const lodSource = fs.readFileSync(
    path.join(root, 'native-v2/runtime/near-lod-controller.js'),
    'utf8',
  );
  const trajectorySource = fs.readFileSync(
    path.join(root, 'native-v2/runtime/trajectory-player.js'),
    'utf8',
  );
  const rendererSource = fs.readFileSync(
    path.join(root, 'native-v2/runtime/splat-renderer.js'),
    'utf8',
  );
  const sortControllerSource = fs.readFileSync(
    path.join(root, 'native-v2/runtime/sort-controller.js'),
    'utf8',
  );
  const workerSource = fs.readFileSync(
    path.join(root, 'workers/native-splat-sort.js'),
    'utf8',
  );
  const loadSceneSource = pageSource.slice(
    pageSource.indexOf('async loadScene(sceneId)'),
    pageSource.indexOf('switchScene(event)'),
  );
  assert(loadSceneSource.indexOf('await loadSceneManifest(sceneEntry)')
    < loadSceneSource.indexOf('this.disposeSceneResources()'));
  assert(loadSceneSource.includes('sceneLoadInFlight'));
  assert(loadSceneSource.includes('queuedSceneId'));
  assert(loadSceneSource.includes('this.resetSceneRenderQuality()'));
  assert(pageSource.includes('sampleStrideMatches(completedCamera.sampleStride'));
  assert(pageSource.includes('const BASE_PIXEL_RATIO = 1.25'));
  assert(pageSource.includes('const INTERACTIVE_PIXEL_RATIO = 1.05'));
  assert(pageSource.includes('const VERY_POOR_FRAME_TIME_MS = 68'));
  assert(pageSource.includes('const RENDER_SCALE_BUSY_GRACE_MS = 3200'));
  assert(!pageSource.includes('else if (activeWindow'));
  assert(lodSource.includes('requestStride !== this.detailSamplingStride()'));
  assert(lodSource.includes('const coarseBudget = this.detailPointBudget'));
  assert(lodSource.includes('this.fineReserveRatio'));
  assert(lodSource.includes('screenMetrics(camera, node.bounds'));
  assert(lodSource.includes('commitStagedIndexes()'));
  assert(lodSource.includes('state.renderer.discardStagedIndexes()'));
  assert(lodSource.includes('depths[fileId] = boundsFarDepth('));
  assert(lodSource.includes('new Set(fine.map((item) => rangeKey(item.range)))'));
  const applySelectionSource = lodSource.slice(
    lodSource.indexOf('  applySelection()'),
    lodSource.indexOf('  releaseState(fileId)'),
  );
  assert(!applySelectionSource.includes('Number.POSITIVE_INFINITY'));
  assert(pageSource.includes("require('../runtime/camera-sort-policy')"));
  assert(pageSource.includes('const SORT_MOVING_INTERVAL_MS = 1200'));
  assert(pageSource.includes('movingSortHasHeadroom'));
  assert(pageSource.includes('maxDetailDatasets: 1'));
  assert(pageSource.includes("this.requestCameraSort('moving'"));
  assert(pageSource.includes('MOVING_SORT_RESULT_CHUNK_INDICES = 24576'));
  assert(pageSource.includes('this.sortController.flushResultTransfer(resultChunkSize)'));
  assert(pageSource.includes('cullToFrustum: false'));
  assert(rendererSource.includes('clipCenter.z < -clipCenter.w'));
  assert(rendererSource.includes('smoothstep(2.5, 10.0, projectedSigma)'));
  assert(rendererSource.includes('min(uViewport.x, uViewport.y)'));
  assert(rendererSource.includes('mat3 covariance = axisSwap * sourceCovariance(uv)'));
  assert(rendererSource.includes('mat3 projected = jacobian * cameraCovariance'));
  assert(!rendererSource.includes('precision mediump float;'));
  assert(rendererSource.includes('(Math.sqrt(this.indexStride) - 1) * 0.28'));
  assert(rendererSource.includes('gl.RG32UI'));
  assert(rendererSource.includes('holdCommit'));
  assert(rendererSource.includes('this.sourceCount * 40'));
  assert(rendererSource.includes('options.holdCommit !== true'));
  assert(rendererSource.includes('options.enableGpuPredecode === true'));
  assert(rendererSource.includes('options.enableProjectedFastPath === true'));
  assert(rendererSource.includes("this.lastRenderPath = 'fast-tf28-float'"));
  assert(rendererSource.includes("this.lastRenderPath = 'fast-mrt32-batch128'"));
  assert(rendererSource.includes("'fast-direct-batch128'"));
  assert(rendererSource.includes("'source-direct-batch128'"));
  assert(rendererSource.includes('const SPLATS_PER_BATCH_INSTANCE = 128'));
  assert(rendererSource.includes('gl_InstanceID * ${SPLATS_PER_BATCH_INSTANCE}'));
  assert(rendererSource.includes('gl.drawElementsInstanced('));
  assert(rendererSource.includes('MRT_PROJECTION_FRAGMENT_SHADER'));
  assert(rendererSource.includes('out vec4 tfPackedData;'));
  assert(!rendererSource.includes('vertexAttribIPointer'));
  assert(rendererSource.includes('calibrateProjectionPath(matrices, cameraController'));
  assert(rendererSource.includes("PREFERRED_PROJECTION_BACKENDS.set(gl, 'direct')"));
  assert(rendererSource.includes('float covariance00 = uintBitsToFloat(decodedA.w);'));
  assert(rendererSource.includes('dot(uView[0].xyz, jacobianX)'));
  assert(rendererSource.includes('vec3 covarianceX = vec3('));
  assert(!rendererSource.includes('mat3 inverseViewRotation = transpose(mat3(uView));'));
  assert(pageSource.includes('enableGpuPredecode: true'));
  assert(pageSource.includes('enableProjectedFastPath: false'));
  assert(!pageSource.includes('calibrateProjectionPath('));
  assert(pageSource.includes('allowBackgroundGpuWork'));
  assert(pageSource.includes('allowFastPath: allowFastPathUpgrade'));
  assert(pageSource.includes('const FAST_PATH_IDLE_MS = 1200'));
  assert(pageSource.includes('setInteractionActive(this.isCameraMoving())'));
  assert(lodSource.includes('enableGpuPredecode: true'));
  assert(lodSource.includes('enableProjectedFastPath: false'));
  assert(lodSource.includes('startupVisualReady(hasIssues = false)'));
  assert(lodSource.includes('options.allowFastPath !== false'));
  assert(lodSource.includes("state.installStage = 'commit';"));
  const renderSource = rendererSource.slice(
    rendererSource.indexOf('  render(matrices, cameraController, options = {})'),
    rendererSource.indexOf('  renderAvatar(matrices, cameraController)'),
  );
  assert(renderSource.includes('const useFastPath = this.hasFastPath();'));
  assert(!renderSource.includes('this.prepareFastPath('));
  const indexUploadSource = rendererSource.slice(
    rendererSource.indexOf('  flushIndexUpload('),
    rendererSource.indexOf('  bindTexture('),
  );
  assert(!indexUploadSource.includes('this.prepareFastPath('));
  assert(rendererSource.includes('pending.textures.length < 3'));
  assert(lodSource.includes('if (keepWarm && !this.residentModeDegraded) {'));
  assert(lodSource.includes('MAX_BUFFERED_DETAIL_FILES = 10'));
  assert(lodSource.includes('hasContinuityInstallWork()'));
  assert(lodSource.includes('const RESIDENT_PAYLOAD_PRELOAD = false;'));
  assert(pageSource.includes('MOVING_DETAIL_INSTALL_INTERVAL_MS = 150'));
  assert(pageSource.includes('movingContinuityInstallDue'));
  assert(pageSource.includes('ROOT_NATIVE_PACK_DOWNLOAD_CONCURRENCY = 4'));
  assert(pageSource.includes('if (!this.data.diagnosticsVisible)'));
  assert(pageSource.includes('正在合成首屏高清画面'));
  assert(workerSource.includes('const stableHash = Math.imul'));
  assert(workerSource.includes("format !== 'uint16x3-linear'"));
  assert(workerSource.includes('quantized[offset] * scales[0]'));
  assert(workerSource.includes("type: 'sorted-start'"));
  assert(workerSource.includes("type: 'sorted-chunk'"));
  assert(workerSource.includes("data.type === 'result-chunk'"));
  assert(sortControllerSource.includes('function flushResultTransfer('));
  assert(sortControllerSource.includes("message.type === 'sorted-chunk'"));
  assert(workerSource.includes('const depth = enableDepthSorting'));
  assert(workerSource.includes('relativeX * forward[0]'));
  assert(workerSource.includes('relativeX * relativeX'));
  assert(pageSource.includes('enableDepthSorting: ENABLE_DIRECTIONAL_DEPTH_SORTING'));
  assert(pageSource.includes('lodPosition: this.cameraController.getGroundPosition()'));
  assert(lodSource.includes('const lodPosition = lodPositionOf(camera)'));
  assert(lodSource.includes('if (this.onSortStale) this.onSortStale'));
  assert(lodSource.includes('!cameraWithinSortCoverage(this.currentCamera, request.camera)'));
  assert(!trajectorySource.includes('LOOK_AHEAD_PROGRESS'));
  assert(trajectorySource.includes('LOOK_AHEAD_DISTANCE'));
}

async function testSceneSwitchSerialization() {
  let pageDefinition = null;
  let pendingRequest = null;
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {
    request(options) {
      pendingRequest = options;
    },
  };
  const pageModule = require.resolve('../native-v2/index/index');
  delete require.cache[pageModule];
  require(pageModule);
  assert(pageDefinition);

  let disposedScenes = 0;
  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      activeSceneId: 'KPJ-08-4',
      activeSceneLabel: '五园连通',
      phase: 'ready',
    },
    gl: {},
    canvas: {},
    currentScene: { id: 'KPJ-08-4', label: '五园连通' },
    splatRenderer: {},
    cameraController: {},
    disposed: false,
    loadGeneration: 1,
    sceneLoadInFlight: false,
    loadingSceneId: null,
    queuedSceneId: null,
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    resetTouchState() {},
    disposeSceneResources() {
      disposedScenes += 1;
    },
  };

  const firstLoad = page.loadScene('KPJ-05-2');
  assert.equal(page.sceneLoadInFlight, true);
  await page.loadScene('RCGY');
  assert.equal(page.queuedSceneId, 'RCGY');
  page.queuedSceneId = null;
  pendingRequest.fail({ errMsg: 'offline' });
  await firstLoad;

  assert.equal(disposedScenes, 0, 'old scene must survive manifest failure');
  assert.equal(page.data.activeSceneId, 'KPJ-08-4');
  assert.equal(page.data.phase, 'ready');
  assert.match(page.data.errorDetail, /场景切换失败/);
  assert.equal(page.sceneLoadInFlight, false);
  delete global.Page;
  delete global.wx;
}

function testRootSortStrideGate(pageDefinition) {
  const camera = {
    forward: [0, 0, 1],
    position: [0, 1.7, 0],
  };
  const commits = [];
  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      errorDetail: '',
      phase: 'ready',
      qualityLevel: 4,
    },
    disposed: false,
    loadGeneration: 7,
    firstSortComplete: true,
    residentReady: true,
    sortController: { getStats: () => ({ busy: false }) },
    cameraController: { getCamera: () => camera },
    nearLodController: {
      setBaseIndexes(indexes, options) {
        commits.push({ indexes, options });
      },
      update() {},
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    isCameraMoving: () => false,
    finishInitialLoad() {},
    updateDiagnostics() {},
  };
  const indexes = new Uint32Array([3, 2, 1]);
  page.handleSorted(7, indexes, {}, {
    camera: {
      ...camera,
      enableDepthSorting: false,
      reason: 'quality',
      sampleStride: 5,
    },
  });
  assert.equal(commits.length, 0);
  assert.equal(page.sortDirty, true);

  page.handleSorted(7, indexes, {}, {
    camera: {
      ...camera,
      enableDepthSorting: false,
      reason: 'quality',
      sampleStride: 4,
    },
  });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].options.sampleStride, 4);
}

function testLookDragCannotTriggerRecenter(pageDefinition) {
  let recenterCount = 0;
  let gestureCount = 0;
  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      phase: 'ready',
    },
    currentScene: {},
    trajectoryPlayer: null,
    moveTouchId: null,
    lookTouchId: null,
    lookPinchTouchId: null,
    lastLookTouch: null,
    lastPinchDistance: 0,
    lookGestureActive: false,
    lastLookTapAt: 0,
    lastLookTapX: 0,
    lastLookTapY: 0,
    lookTapCandidateId: null,
    lookTapStartedAt: 0,
    lookTapStartX: 0,
    lookTapStartY: 0,
    cameraController: {
      addGesture() {
        gestureCount += 1;
      },
      getMode: () => 'firstPerson',
      recenterView() {
        recenterCount += 1;
        return true;
      },
      update() {},
    },
    markCameraChanged() {},
    setDataIfChanged() {},
    updateDiagnostics() {},
  };
  const touch = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    const first = touch(1, 100, 100);
    page.handleLookStart({ type: 'touchstart', touches: [first], changedTouches: [first] });
    now = 1040;
    const firstMoved = touch(1, 135, 100);
    page.handleLookMove({
      type: 'touchmove',
      touches: [firstMoved],
      changedTouches: [firstMoved],
    });
    now = 1080;
    page.handleLookEnd({ type: 'touchend', touches: [], changedTouches: [firstMoved] });

    now = 1120;
    const second = touch(2, 105, 100);
    page.handleLookStart({ type: 'touchstart', touches: [second], changedTouches: [second] });
    now = 1160;
    const secondMoved = touch(2, 70, 100);
    page.handleLookMove({
      type: 'touchmove',
      touches: [secondMoved],
      changedTouches: [secondMoved],
    });
    now = 1200;
    page.handleLookEnd({ type: 'touchend', touches: [], changedTouches: [secondMoved] });

    assert(gestureCount > 0);
    assert.equal(
      recenterCount,
      0,
      'two quick look drags must never be mistaken for a double tap',
    );

    now = 2000;
    const tapOne = touch(3, 50, 50);
    page.handleLookStart({ type: 'touchstart', touches: [tapOne], changedTouches: [tapOne] });
    now = 2050;
    page.handleLookEnd({ type: 'touchend', touches: [], changedTouches: [tapOne] });
    now = 2160;
    const tapTwo = touch(4, 52, 51);
    page.handleLookStart({ type: 'touchstart', touches: [tapTwo], changedTouches: [tapTwo] });
    now = 2200;
    page.handleLookEnd({ type: 'touchend', touches: [], changedTouches: [tapTwo] });
    assert.equal(recenterCount, 1, 'two completed taps should still recenter the view');
  } finally {
    Date.now = originalNow;
  }
}

function testMemoryWarningUsesSoftTrimBeforeEviction(pageDefinition) {
  const calls = [];
  const page = {
    ...pageDefinition,
    disposed: false,
    lastMemoryWarningAt: 0,
    memoryWarningBurstCount: 0,
    collisionController: {
      trimCache() {
        calls.push('collision');
      },
    },
    nearLodController: {
      trimCache() {
        calls.push('hard');
      },
      trimTransientCache() {
        calls.push('soft');
      },
    },
    setDataIfChanged() {},
  };

  page.handleMemoryWarning({ level: 5 });
  assert.deepEqual(
    calls,
    ['collision', 'soft'],
    'a first mild warning must preserve compact visited detail state',
  );

  page.handleMemoryWarning({ level: 5 });
  assert.deepEqual(
    calls,
    ['collision', 'soft', 'collision', 'hard'],
    'a repeated warning may evict inactive detail to protect the process',
  );
}

async function main() {
  testQualityPolicy();
  testCameraSortPolicy();
  testExactBoundsDepthInterval();
  testAvatarRotationPreservesWorldAnchor();
  testRecenterPreservesWorldAnchor();
  testTrajectoryHeading();
  testFineLodReservation();
  testLocalLodWinsBeforeDistantScreenBenefit();
  testSingleBaseRangeManifestShape();
  testStableFineRangeReplacement();
  testVisibleLodWorkGate();
  testStartupWarmBuffer();
  testStartupPathPreload();
  testTrajectoryCollisionCorridor();
  testStartupWarmLoadGate();
  testInteractiveBackgroundLoadGate();
  testDownloadBufferIsIndependentFromGpuInstallQueue();
  testDecodeQueueRespectsGpuInstallBackpressure();
  testPrimaryInstallPriority();
  testResidentPayloadPreloadDisabled();
  await testBackgroundPayloadUsesChunkedFileCache();
  await testNativePackUsesDownloadTransportAndPackedMeans();
  await testNativePackUsesPredecodedLinearSortCenters();
  await testNativePackFallsBackToPackedMeans();
  testLinearSortCentersWorkerPath();
  testSortControllerPullsResultAcrossFrames();
  testStartupVisualReadiness();
  testInteractiveFastPathGate();
  testStartupVisualCommitRace();
  testVisitedDetailRetention();
  testInactiveDetailKeepsCommittedIndexes();
  testLodSelectionUsesStableGroundAnchor();
  testSourceGuards();
  let pageDefinition = null;
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {};
  const pageModule = require.resolve('../native-v2/index/index');
  delete require.cache[pageModule];
  require(pageModule);
  delete global.Page;
  delete global.wx;
  testSceneRenderQualityReset(pageDefinition);
  testRenderScaleBusyGrace(pageDefinition);
  testHiddenDiagnosticsSkipRuntimeInstrumentation(pageDefinition);
  testMovingSortFrameBudget(pageDefinition);
  testRadialRotationDoesNotScheduleSort(pageDefinition);
  testRootSortStrideGate(pageDefinition);
  testLookDragCannotTriggerRecenter(pageDefinition);
  testMemoryWarningUsesSoftTrimBeforeEviction(pageDefinition);
  await testSceneSwitchSerialization();
  process.stdout.write('runtime behavior tests passed\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
