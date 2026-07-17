'use strict';

const MAX_IMAGE_DECODE_CONCURRENCY = 2;
let temporaryImageSequence = 0;

function requestRangeResponse(url, offset, length) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      header: { Range: `bytes=${offset}-${offset + length - 1}` },
      success(response) {
        if (response.statusCode !== 200 && response.statusCode !== 206) {
          reject(new Error(`Range request failed (${response.statusCode})`));
          return;
        }
        const received = response.data;
        if (!received || typeof received.byteLength !== 'number') {
          reject(new Error('Range response did not contain binary data'));
          return;
        }
        if (response.statusCode === 206 || received.byteLength === length) {
          if (received.byteLength !== length) {
            reject(new Error(`Range length mismatch: expected ${length}, got ${received.byteLength}`));
            return;
          }
          resolve({ buffer: received, fullBuffer: null });
          return;
        }
        if (received.byteLength < offset + length) {
          reject(new Error(`Full response is too short: ${received.byteLength} bytes`));
          return;
        }
        resolve({
          buffer: received.slice(offset, offset + length),
          fullBuffer: received,
        });
      },
      fail(error) { reject(new Error(error.errMsg || 'Range request failed')); },
    });
  });
}

async function requestRange(url, offset, length) {
  const response = await requestRangeResponse(url, offset, length);
  return response.buffer;
}

function writeTemporaryImage(name, buffer) {
  temporaryImageSequence += 1;
  const path = `${wx.env.USER_DATA_PATH}/native-splat-${Date.now()}-${temporaryImageSequence}-${name}`;
  const fileSystem = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fileSystem.writeFile({
      filePath: path,
      data: buffer,
      success() { resolve(path); },
      fail(error) { reject(new Error(error.errMsg || `Failed to write ${name}`)); },
    });
  });
}

async function decodeImage(canvas, name, buffer) {
  const path = await writeTemporaryImage(name, buffer);
  const image = canvas.createImage();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve({ image, path });
    image.onerror = (error) => {
      wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
      reject(new Error((error && error.errMsg) || `Failed to decode ${name}`));
    };
    image.src = path;
  });
}

function create2dCanvas(width, height) {
  let offscreen;
  try {
    offscreen = wx.createOffscreenCanvas({ type: '2d', width, height });
  } catch (error) {
    offscreen = wx.createOffscreenCanvas({ type: '2d' });
  }
  if (!offscreen) throw new Error('当前微信基础库不支持离屏 2D Canvas');
  offscreen.width = width;
  offscreen.height = height;
  return offscreen;
}

function decodeExistingImage(canvas, path, name) {
  if (!canvas || typeof canvas.createImage !== 'function') {
    return Promise.reject(new Error('当前微信基础库无法为 2D Canvas 创建图片'));
  }
  const image = canvas.createImage();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(new Error((error && error.errMsg) || `Failed to decode ${name} for 2D Canvas`));
    image.src = path;
  });
}

async function readMeansPixels(paths, width, height) {
  const offscreen = create2dCanvas(width, height);
  const context = offscreen.getContext('2d');
  if (!context || typeof context.getImageData !== 'function') {
    throw new Error('当前微信基础库无法读取 SOG 坐标纹理');
  }
  const read = async (name) => {
    const image = await decodeExistingImage(offscreen, paths[name], name);
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  return {
    high: await read('means_u.webp'),
    low: await read('means_l.webp'),
  };
}

function packMeans(lowPixels, highPixels, count) {
  const packed = new Uint8Array(count * 6);
  for (let index = 0; index < count; index += 1) {
    const rgba = index * 4;
    const target = index * 6;
    packed[target] = lowPixels[rgba];
    packed[target + 1] = lowPixels[rgba + 1];
    packed[target + 2] = lowPixels[rgba + 2];
    packed[target + 3] = highPixels[rgba];
    packed[target + 4] = highPixels[rgba + 1];
    packed[target + 5] = highPixels[rgba + 2];
  }
  return packed;
}

function removeTemporaryImages(items) {
  const fileSystem = wx.getFileSystemManager();
  (items || []).forEach((item) => {
    if (item && item.path) fileSystem.unlink({ filePath: item.path, fail() {} });
  });
}

function entryBufferFromEnvelope(envelope, entry) {
  const source = envelope.fullBuffer || envelope.buffer;
  const baseOffset = envelope.fullBuffer ? 0 : envelope.offset;
  const start = entry.offset - baseOffset;
  const end = start + entry.length;
  if (start < 0 || end > source.byteLength) {
    throw new Error(`SOG envelope does not contain ${entry.name || 'texture'}`);
  }
  return source.slice(start, end);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  const workers = [];
  for (let index = 0; index < Math.min(limit, items.length); index += 1) workers.push(run());
  await Promise.all(workers);
  return results;
}

async function requestSogEnvelope(scene, names) {
  const entries = names.map((name) => ({ ...scene.sog.entries[name], name }));
  const offset = Math.min(...entries.map((entry) => entry.offset));
  const end = Math.max(...entries.map((entry) => entry.offset + entry.length));
  const response = await requestRangeResponse(scene.sog.url, offset, end - offset);
  return { ...response, offset };
}

async function loadSogAssets(canvas, scene, onProgress) {
  const names = ['means_l.webp', 'means_u.webp', 'quats.webp', 'scales.webp', 'sh0.webp'];
  let completed = 0;
  const loaded = [];
  const decode = async (name, buffer) => {
    const result = await decodeImage(canvas, name, buffer);
    loaded.push(result);
    completed += 1;
    if (onProgress) onProgress(completed / names.length);
    return [name, result];
  };
  let decoded = [];
  try {
    const envelope = await requestSogEnvelope(scene, names);
    decoded = await mapWithConcurrency(names, MAX_IMAGE_DECODE_CONCURRENCY, (name) => {
      const entry = { ...scene.sog.entries[name], name };
      return decode(name, entryBufferFromEnvelope(envelope, entry));
    });
  } catch (error) {
    removeTemporaryImages(loaded);
    throw error;
  }
  try {
    const images = {};
    decoded.forEach(([name, value]) => { images[name] = value; });
    const width = images['means_l.webp'].image.width;
    const height = images['means_l.webp'].image.height;
    const count = scene.sog.meta.count;
    names.forEach((name) => {
      const image = images[name].image;
      if (image.width !== width || image.height !== height) {
        throw new Error(`SOG texture dimensions do not match: ${name}`);
      }
    });
    if (count > width * height) throw new Error('SOG point count exceeds texture capacity');
    const pixels = await readMeansPixels({
      'means_l.webp': images['means_l.webp'].path,
      'means_u.webp': images['means_u.webp'].path,
    }, width, height);
    const means = packMeans(pixels.low, pixels.high, count);
    return { count, height, images, means, width };
  } catch (error) {
    removeTemporaryImages(loaded);
    throw error;
  }
}

function cleanupAssets(assets) {
  removeTemporaryImages(Object.values((assets && assets.images) || {}));
}

module.exports = { cleanupAssets, loadSogAssets, requestRange };
