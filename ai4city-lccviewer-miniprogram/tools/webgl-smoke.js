'use strict';

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye, target) {
  const normalize = (vector) => {
    const length = Math.hypot(...vector) || 1;
    return vector.map((value) => value / length);
  };
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross([0, 1, 0], z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

async function loadManifest() {
  const source = await fetch('/native-v2/scenes/generated.js').then((response) => response.text());
  const marker = 'module.exports = ';
  const start = source.indexOf(marker) + marker.length;
  return JSON.parse(source.slice(start).trim().replace(/;$/, ''));
}

async function loadScene(entry) {
  const pathname = new URL(entry.manifestUrl).pathname;
  const response = await fetch(`/remote${pathname}`);
  if (!response.ok) throw new Error(`Manifest: HTTP ${response.status}`);
  return response.json();
}

async function decodeTexture(scene, name) {
  const entry = scene.sog.entries[name];
  const remotePath = new URL(scene.sog.url).pathname;
  const response = await fetch(`/remote${remotePath}`, {
    headers: { Range: `bytes=${entry.offset}-${entry.offset + entry.length - 1}` },
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const blob = new Blob([await response.arrayBuffer()], { type: 'image/webp' });
  let image;
  try {
    image = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch (error) {
    image = await createImageBitmap(blob);
  }
  return [name, { image }];
}

function imagePixels(image, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

function sortIndexes(scene, images, eye, target) {
  const startedAt = performance.now();
  const count = scene.sog.meta.count;
  const width = images['means_l.webp'].image.width;
  const height = images['means_l.webp'].image.height;
  const low = imagePixels(images['means_l.webp'].image, width, height);
  const high = imagePixels(images['means_u.webp'].image, width, height);
  const mins = scene.sog.meta.means.mins;
  const maxs = scene.sog.meta.means.maxs;
  const centers = new Float32Array(count * 3);
  const decode = (value) => Math.sign(value) * (Math.exp(Math.abs(value)) - 1);
  for (let index = 0; index < count; index += 1) {
    const rgba = index * 4;
    const targetIndex = index * 3;
    const nx = (low[rgba] + high[rgba] * 256) / 65535;
    const ny = (low[rgba + 1] + high[rgba + 1] * 256) / 65535;
    const nz = (low[rgba + 2] + high[rgba + 2] * 256) / 65535;
    centers[targetIndex] = -decode(mins[0] + (maxs[0] - mins[0]) * nx);
    centers[targetIndex + 1] = decode(mins[2] + (maxs[2] - mins[2]) * nz);
    centers[targetIndex + 2] = decode(mins[1] + (maxs[1] - mins[1]) * ny);
  }
  const forward = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const forwardLength = Math.hypot(...forward);
  forward[0] /= forwardLength;
  forward[1] /= forwardLength;
  forward[2] /= forwardLength;
  const depthAt = (index) => {
    const offset = index * 3;
    return (centers[offset] - eye[0]) * forward[0]
      + (centers[offset + 1] - eye[1]) * forward[1]
      + (centers[offset + 2] - eye[2]) * forward[2];
  };
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const depth = depthAt(index);
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
  }
  const bucketCount = 65536;
  const buckets = new Uint32Array(bucketCount);
  const offsets = new Uint32Array(bucketCount);
  const keys = new Uint16Array(count);
  const indexes = new Uint32Array(count);
  const scale = (bucketCount - 1) / Math.max(maxDepth - minDepth, 0.0001);
  for (let index = 0; index < count; index += 1) {
    const key = Math.max(0, Math.min(bucketCount - 1, Math.floor((depthAt(index) - minDepth) * scale)));
    keys[index] = key;
    buckets[key] += 1;
  }
  let cursor = 0;
  for (let bucket = bucketCount - 1; bucket >= 0; bucket -= 1) {
    offsets[bucket] = cursor;
    cursor += buckets[bucket];
  }
  for (let index = 0; index < count; index += 1) {
    const key = keys[index];
    indexes[offsets[key]] = index;
    offsets[key] += 1;
  }
  return { indexes, milliseconds: performance.now() - startedAt };
}

function readPixels(gl, width, height) {
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

function benchmarkRenderer(gl, renderer, matrices, camera, frames = 8) {
  renderer.render(matrices, camera);
  renderer.render(matrices, camera);
  gl.finish();
  const startedAt = performance.now();
  for (let frame = 0; frame < frames; frame += 1) {
    renderer.render(matrices, camera);
  }
  gl.finish();
  return (performance.now() - startedAt) / frames;
}

(async () => {
    const status = document.querySelector('#status');
  try {
    const scenes = await loadManifest();
    const search = new URLSearchParams(location.search);
    const sceneId = search.get('scene') || 'KPJ-08-4';
    const sampleStride = Math.max(1, Number(search.get('stride')) || 4);
    const entry = scenes[sceneId];
    if (!entry) throw new Error(`Unknown scene: ${sceneId}`);
    const scene = await loadScene(entry);
    const canvas = document.querySelector('#smoke');
    canvas.width = 488;
    canvas.height = 1055;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    const decoded = await Promise.all([
      'means_l.webp', 'means_u.webp', 'quats.webp', 'scales.webp', 'sh0.webp',
    ].map((name) => decodeTexture(scene, name)));
    const images = Object.fromEntries(decoded);
    const width = images['means_l.webp'].image.width;
    const height = images['means_l.webp'].image.height;
    const eye = [scene.start[0], scene.start[1] + 1.7, scene.start[2]];
    const target = [scene.next[0], scene.next[1] + 1.7, scene.next[2]];
    const sorted = sortIndexes(scene, images, eye, target);
    const sampledIndexes = new Uint32Array(
      Array.from(sorted.indexes).filter((index) => index % sampleStride === 0),
    );
    const renderer = new window.NativeSplatRenderer(gl, canvas.width, canvas.height, {
      enableGpuPredecode: false,
      indexStride: sampleStride,
    });
    renderer.load(scene, { count: scene.sog.meta.count, width, height, images });
    renderer.updateIndexes(sampledIndexes, { preSampled: true });
    const fullCount = renderer.count;
    const halfIndexes = sampledIndexes.subarray(0, Math.floor(sampledIndexes.length / 2));
    renderer.updateIndexes(halfIndexes, { preSampled: true });
    if (renderer.count !== fullCount) throw new Error('Deferred index upload swapped too early');
    renderer.flushIndexUpload(1);
    if (renderer.count !== fullCount) throw new Error('Partial index upload swapped too early');
    renderer.flushIndexUpload(Number.POSITIVE_INFINITY);
    if (renderer.count !== halfIndexes.length) throw new Error('Deferred index upload did not commit');
    renderer.updateIndexes(sampledIndexes, { immediate: true, preSampled: true });
    const matrices = {
      projection: perspective(55 * Math.PI / 180, canvas.width / canvas.height, 0.1, 3000),
      view: lookAt(eye, target),
    };
    renderer.render(matrices, { getMode: () => 'orbit' });
    gl.finish();
    const slowPixels = readPixels(gl, canvas.width, canvas.height);
    renderer.dispose();

    const fastRenderer = new window.NativeSplatRenderer(gl, canvas.width, canvas.height, {
      enableGpuPredecode: true,
      enableProjectedFastPath: true,
      indexStride: sampleStride,
    });
    fastRenderer.load(scene, { count: scene.sog.meta.count, width, height, images });
    fastRenderer.updateIndexes(sampledIndexes, { immediate: true, preSampled: true });
    for (let step = 0; step < 128 && !fastRenderer.hasFastPath(); step += 1) {
      fastRenderer.prepareFastPath(64);
    }
    if (!fastRenderer.hasFastPath()) throw new Error('GPU predecode fast path unavailable');
    const cameraStub = { getMode: () => 'orbit' };
    const calibration = fastRenderer.calibrateProjectionPath(matrices, cameraStub);
    fastRenderer.projectionPathEnabled = false;
    fastRenderer.render(matrices, cameraStub);
    gl.finish();
    const directPixels = readPixels(gl, canvas.width, canvas.height);
    const directMilliseconds = benchmarkRenderer(gl, fastRenderer, matrices, cameraStub);
    fastRenderer.projectionPathEnabled = true;
    fastRenderer.render(matrices, cameraStub);
    gl.finish();
    const pixels = readPixels(gl, canvas.width, canvas.height);
    const projectedMilliseconds = benchmarkRenderer(gl, fastRenderer, matrices, cameraStub);
    if (fastRenderer.getDiagnostics().path !== 'fast-tf28-float') {
      throw new Error(`Float TF path unavailable: ${fastRenderer.getDiagnostics().projectionError}`);
    }
    fastRenderer.releaseProjectionPath();
    fastRenderer.projectionBackend = 'mrt';
    fastRenderer.render(matrices, cameraStub);
    gl.finish();
    const mrtPixels = readPixels(gl, canvas.width, canvas.height);
    const mrtMilliseconds = benchmarkRenderer(gl, fastRenderer, matrices, cameraStub);
    if (fastRenderer.getDiagnostics().path !== 'fast-mrt32-batch128') {
      throw new Error(`MRT projection path unavailable: ${fastRenderer.getDiagnostics().projectionError}`);
    }
    const decodedTextures = fastRenderer.decodedTextures.slice();
    const reversedIndexes = sampledIndexes.slice().reverse();
    fastRenderer.updateIndexes(reversedIndexes, { immediate: true, preSampled: true });
    if (!fastRenderer.hasFastPath()
      || decodedTextures.some((texture, index) => (
        fastRenderer.decodedTextures[index] !== texture
      ))) {
      throw new Error('Camera re-sort rebuilt or disabled the stable GPU cache');
    }
    let changed = 0;
    let difference = 0;
    let projectionDifference = 0;
    let mrtDifference = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== 9 || pixels[index + 1] !== 11 || pixels[index + 2] !== 14) changed += 1;
      difference += Math.abs(pixels[index] - slowPixels[index]);
      difference += Math.abs(pixels[index + 1] - slowPixels[index + 1]);
      difference += Math.abs(pixels[index + 2] - slowPixels[index + 2]);
      projectionDifference += Math.abs(pixels[index] - directPixels[index]);
      projectionDifference += Math.abs(pixels[index + 1] - directPixels[index + 1]);
      projectionDifference += Math.abs(pixels[index + 2] - directPixels[index + 2]);
      mrtDifference += Math.abs(mrtPixels[index] - directPixels[index]);
      mrtDifference += Math.abs(mrtPixels[index + 1] - directPixels[index + 1]);
      mrtDifference += Math.abs(mrtPixels[index + 2] - directPixels[index + 2]);
    }
    const meanDifference = difference / (canvas.width * canvas.height * 3);
    const meanProjectionDifference = (
      projectionDifference / (canvas.width * canvas.height * 3)
    );
    const meanMrtDifference = mrtDifference / (canvas.width * canvas.height * 3);
    const diagnostics = fastRenderer.getDiagnostics();
    status.textContent = `OK\n${scene.sog.meta.count} splats\nTF + MRT validated\nauto ${calibration.backend} (${calibration.directMs.toFixed(2)}/${calibration.projectedMs.toFixed(2)}ms)\n${Math.round(sorted.milliseconds)}ms sort\n${directMilliseconds.toFixed(2)}ms direct\n${projectedMilliseconds.toFixed(2)}ms float TF\n${mrtMilliseconds.toFixed(2)}ms MRT\n${meanDifference.toFixed(3)} source RGB delta\n${meanProjectionDifference.toFixed(3)} TF RGB delta\n${meanMrtDifference.toFixed(3)} MRT RGB delta\n${changed} changed pixels`;
    document.title = changed > 500
      && meanDifference < 0.8
      && meanProjectionDifference < 0.8
      && meanMrtDifference < 0.8
      ? 'PASS Native Splat Smoke'
      : 'FAIL Native Splat Smoke';
  } catch (error) {
    status.textContent = error.stack || error.message;
    document.title = 'ERROR Native Splat Smoke';
    console.error(error);
  }
})();
