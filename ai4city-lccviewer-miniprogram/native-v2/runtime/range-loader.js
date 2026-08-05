'use strict';

const MAX_IMAGE_DECODE_CONCURRENCY = 2;
const MAX_NATIVE_PACK_DOWNLOAD_CONCURRENCY = 4;
const MAX_MEANS_PIXELS_PER_SLICE = 32768;
const BACKGROUND_CACHE_CHUNK_BYTES = 512 * 1024;
const SOG_TEXTURE_NAMES = [
  'means_l.webp',
  'means_u.webp',
  'quats.webp',
  'scales.webp',
  'sh0.webp',
];
let temporaryImageSequence = 0;
const temporaryImageSession = Date.now();
let staleCacheCleanupStarted = false;
let activeImageDecodes = 0;
const imageDecodeWaiters = [];
let nativePackDownloadDisabled = false;

// Share the decoder budget across every concurrently downloading detail file.
async function withImageDecodeSlot(work) {
  if (activeImageDecodes >= MAX_IMAGE_DECODE_CONCURRENCY) {
    await new Promise((resolve) => imageDecodeWaiters.push(resolve));
  }
  activeImageDecodes += 1;
  try {
    return await work();
  } finally {
    activeImageDecodes = Math.max(0, activeImageDecodes - 1);
    const next = imageDecodeWaiters.shift();
    if (next) next();
  }
}

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

function requestBinary(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Binary request failed (${response.statusCode})`));
          return;
        }
        if (!response.data || typeof response.data.byteLength !== 'number') {
          reject(new Error('Binary request did not contain an ArrayBuffer'));
          return;
        }
        resolve(response.data);
      },
      fail(error) { reject(new Error(error.errMsg || 'Binary request failed')); },
    });
  });
}

function downloadTemporaryFile(url) {
  return new Promise((resolve, reject) => {
    if (typeof wx.downloadFile !== 'function') {
      reject(new Error('wx.downloadFile is unavailable'));
      return;
    }
    wx.downloadFile({
      url,
      success(response) {
        if (typeof response.statusCode === 'number'
          && (response.statusCode < 200 || response.statusCode >= 300)) {
          reject(new Error(`Native pack download failed (${response.statusCode})`));
          return;
        }
        if (!response.tempFilePath) {
          reject(new Error('Native pack download returned no temporary file'));
          return;
        }
        resolve(response.tempFilePath);
      },
      fail(error) { reject(new Error(error.errMsg || 'Native pack download failed')); },
    });
  });
}

function nativePackDescriptor(scene) {
  const pack = scene && scene.sog && scene.sog.nativePack;
  const version = Number(pack && pack.version);
  if (!pack
    || (version !== 1 && version !== 2)
    || ((!pack.means || !pack.means.url)
      && (!pack.sortCenters || !pack.sortCenters.url))
    || !pack.textures) return null;
  if (SOG_TEXTURE_NAMES.some((name) => (
    !pack.textures[name] || !pack.textures[name].url
  ))) return null;
  return pack;
}

function shouldDisableNativePackDownload(error) {
  const message = String((error && error.message) || error || '');
  return /domain list|合法域名|downloadFile is unavailable/i.test(message);
}

async function fetchNativePackPayload(scene, options = {}) {
  const pack = nativePackDescriptor(scene);
  if (!pack) throw new Error('Native pack descriptor is missing');
  const shouldContinue = typeof options.shouldContinue === 'function'
    ? options.shouldContinue
    : null;
  const downloadConcurrency = Math.max(1, Math.min(
    MAX_NATIVE_PACK_DOWNLOAD_CONCURRENCY,
    Math.floor(Number(options.downloadConcurrency) || MAX_IMAGE_DECODE_CONCURRENCY),
  ));
  const files = {};
  const sortDataPromise = fetchNativeSortData(scene);
  try {
    const downloaded = await mapWithConcurrency(
      SOG_TEXTURE_NAMES,
      downloadConcurrency,
      async (name) => {
        if (shouldContinue && !shouldContinue()) throw new Error('Native pack download cancelled');
        const path = await downloadTemporaryFile(pack.textures[name].url);
        if (shouldContinue && !shouldContinue()) {
          wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
          throw new Error('Native pack download cancelled');
        }
        files[name] = { path };
        return [name, files[name]];
      },
    );
    downloaded.forEach(([name, file]) => { files[name] = file; });
    const sortPayload = await sortDataPromise;
    return {
      files,
      ...(sortPayload || {}),
      names: SOG_TEXTURE_NAMES,
      nativePack: true,
    };
  } catch (error) {
    await sortDataPromise.catch(() => null);
    removeTemporaryImages(Object.values(files));
    throw error;
  }
}

async function fetchNativeSortData(scene) {
  const pack = nativePackDescriptor(scene);
  if (!pack) return null;
  if (pack.sortCenters
    && pack.sortCenters.url
    && pack.sortCenters.format === 'uint16x3-linear') {
    try {
      const buffer = await requestBinary(pack.sortCenters.url);
      const expectedLength = Number(pack.sortCenters.byteLength)
        || scene.sog.meta.count * 6;
      if (buffer.byteLength === expectedLength
        && buffer.byteLength === scene.sog.meta.count * 6) {
        return {
          sortDataBuffer: buffer,
          sortDataDescriptor: {
            format: pack.sortCenters.format,
            maxs: pack.sortCenters.maxs,
            mins: pack.sortCenters.mins,
          },
        };
      }
    } catch (error) {
      // Continue with the legacy means payload before falling back to Canvas decode.
    }
  }
  if (!pack.means || !pack.means.url) return null;
  try {
    const buffer = await requestBinary(pack.means.url);
    return buffer.byteLength === scene.sog.meta.count * 6
      ? { meansBuffer: buffer }
      : null;
  } catch (error) {
    return null;
  }
}

function temporaryImagePath(name) {
  temporaryImageSequence += 1;
  return `${wx.env.USER_DATA_PATH}/native-splat-${temporaryImageSession}-${temporaryImageSequence}-${name}`;
}

function cleanupStaleSogCache() {
  if (staleCacheCleanupStarted
    || typeof wx === 'undefined'
    || !wx.env
    || !wx.env.USER_DATA_PATH
    || typeof wx.getFileSystemManager !== 'function') return;
  staleCacheCleanupStarted = true;
  const fileSystem = wx.getFileSystemManager();
  if (!fileSystem || typeof fileSystem.readdir !== 'function') return;
  const currentPrefix = `native-splat-${temporaryImageSession}-`;
  fileSystem.readdir({
    dirPath: wx.env.USER_DATA_PATH,
    success(result) {
      (result.files || [])
        .filter((name) => name.startsWith('native-splat-') && !name.startsWith(currentPrefix))
        .forEach((name) => {
          fileSystem.unlink({
            filePath: `${wx.env.USER_DATA_PATH}/${name}`,
            fail() {},
          });
        });
    },
    fail() {},
  });
}

function writeFileBuffer(path, buffer, append = false) {
  const fileSystem = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    const method = append ? 'appendFile' : 'writeFile';
    fileSystem[method]({
      filePath: path,
      data: buffer,
      success() { resolve(); },
      fail(error) { reject(new Error(error.errMsg || `Failed to write ${path}`)); },
    });
  });
}

async function writeTemporaryImage(name, buffer) {
  const path = temporaryImagePath(name);
  await writeFileBuffer(path, buffer);
  return path;
}

async function cacheRangeToFile(url, offset, length, name, shouldContinue = null) {
  const path = temporaryImagePath(name);
  let written = 0;
  try {
    while (written < length) {
      if (shouldContinue && !shouldContinue()) throw new Error('SOG cache cancelled');
      const chunkLength = Math.min(BACKGROUND_CACHE_CHUNK_BYTES, length - written);
      let buffer = await requestRange(url, offset + written, chunkLength);
      await writeFileBuffer(path, buffer, written > 0);
      buffer = null;
      written += chunkLength;
      await yieldToMainThread();
    }
    return path;
  } catch (error) {
    wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
    throw error;
  }
}

async function decodeImage(canvas, name, buffer) {
  const path = await writeTemporaryImage(name, buffer);
  return withImageDecodeSlot(() => new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve({ image, path });
    image.onerror = (error) => {
      wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
      reject(new Error((error && error.errMsg) || `Failed to decode ${name}`));
    };
    image.src = path;
  }));
}

function decodeExistingImage(canvas, path, name) {
  if (!canvas || typeof canvas.createImage !== 'function') {
    return Promise.reject(new Error('Canvas image decoding is unavailable'));
  }
  return withImageDecodeSlot(() => new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(new Error((error && error.errMsg) || `Failed to decode ${name} for 2D Canvas`));
    image.src = path;
  }));
}

function create2dCanvas(width, height) {
  let offscreen;
  try {
    offscreen = wx.createOffscreenCanvas({ type: '2d', width, height });
  } catch (error) {
    offscreen = wx.createOffscreenCanvas({ type: '2d' });
  }
  if (!offscreen) throw new Error('Offscreen 2D Canvas is unavailable');
  offscreen.width = width;
  offscreen.height = height;
  return offscreen;
}

function yieldToMainThread() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function readAndPackMeans(paths, width, height, count) {
  const offscreen = create2dCanvas(width, height);
  const context = offscreen.getContext('2d');
  if (!context || typeof context.getImageData !== 'function') {
    throw new Error('当前微信基础库无法读取 SOG 坐标纹理');
  }
  const packed = new Uint8Array(count * 6);
  const rowsPerSlice = Math.max(1, Math.floor(MAX_MEANS_PIXELS_PER_SLICE / width));
  const copyChannels = async (name, targetOffset) => {
    const image = await decodeExistingImage(offscreen, paths[name], name);
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    for (let row = 0; row < height && row * width < count; row += rowsPerSlice) {
      const rows = Math.min(rowsPerSlice, height - row);
      const pixels = context.getImageData(0, row, width, rows).data;
      const sourceStart = row * width;
      const pixelsToCopy = Math.min(pixels.length / 4, count - sourceStart);
      for (let index = 0; index < pixelsToCopy; index += 1) {
        const source = index * 4;
        const target = (sourceStart + index) * 6 + targetOffset;
        packed[target] = pixels[source];
        packed[target + 1] = pixels[source + 1];
        packed[target + 2] = pixels[source + 2];
      }
      if ((row + rows) * width < count) await yieldToMainThread();
    }
  };
  await copyChannels('means_l.webp', 0);
  await yieldToMainThread();
  await copyChannels('means_u.webp', 3);
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

async function fetchSogPayload(scene, options = {}) {
  if (!nativePackDownloadDisabled && nativePackDescriptor(scene)) {
    try {
      return await fetchNativePackPayload(scene, options);
    } catch (error) {
      if (shouldDisableNativePackDownload(error)) nativePackDownloadDisabled = true;
      console.warn('[Native v2] direct native pack unavailable; using SOG fallback', error);
    }
  }
  const [envelope, sortPayload] = await Promise.all([
    requestSogEnvelope(scene, SOG_TEXTURE_NAMES),
    fetchNativeSortData(scene),
  ]);
  return {
    envelope,
    ...(sortPayload || {}),
    names: SOG_TEXTURE_NAMES,
  };
}

function cleanupSogPayload(payload) {
  if (!payload || !payload.files) return;
  removeTemporaryImages(Object.values(payload.files).map((file) => (
    typeof file === 'string' ? { path: file } : file
  )));
  payload.files = null;
}

async function cacheSogPayload(scene, options = {}) {
  if (!nativePackDownloadDisabled && nativePackDescriptor(scene)) {
    try {
      return await fetchNativePackPayload(scene, options);
    } catch (error) {
      if (shouldDisableNativePackDownload(error)) nativePackDownloadDisabled = true;
      console.warn('[Native v2] direct native pack cache unavailable; using SOG fallback', error);
    }
  }
  const files = {};
  const shouldContinue = typeof options.shouldContinue === 'function'
    ? options.shouldContinue
    : null;
  const sortDataPromise = fetchNativeSortData(scene);
  const payload = {
    files,
    names: SOG_TEXTURE_NAMES,
  };
  try {
    for (const name of SOG_TEXTURE_NAMES) {
      if (shouldContinue && !shouldContinue()) throw new Error('SOG cache cancelled');
      const entry = scene.sog.entries[name];
      files[name] = {
        path: await cacheRangeToFile(
          scene.sog.url,
          entry.offset,
          entry.length,
          name,
          shouldContinue,
        ),
      };
    }
    Object.assign(payload, (await sortDataPromise) || {});
    return payload;
  } catch (error) {
    cleanupSogPayload(payload);
    throw error;
  }
}

async function decodeSogPayload(canvas, scene, payload, onProgress, options = {}) {
  const names = payload.names || SOG_TEXTURE_NAMES;
  const decodeConcurrency = Math.max(1, Math.min(
    MAX_IMAGE_DECODE_CONCURRENCY,
    Math.floor(Number(options.decodeConcurrency) || MAX_IMAGE_DECODE_CONCURRENCY),
  ));
  let completed = 0;
  const loaded = [];
  const decode = async (name, buffer) => {
    const result = await decodeImage(canvas, name, buffer);
    loaded.push(result);
    completed += 1;
    if (onProgress) onProgress(completed / names.length);
    return [name, result];
  };
  const decodeCached = async (name, file) => {
    const path = typeof file === 'string' ? file : file.path;
    const image = await decodeExistingImage(canvas, path, name);
    const result = { image, path };
    loaded.push(result);
    completed += 1;
    if (onProgress) onProgress(completed / names.length);
    return [name, result];
  };
  let decoded = [];
  try {
    decoded = payload.files
      ? await mapWithConcurrency(
        names,
        decodeConcurrency,
        (name) => decodeCached(name, payload.files[name]),
      )
      : await mapWithConcurrency(names, decodeConcurrency, (name) => {
        const entry = { ...scene.sog.entries[name], name };
        return decode(name, entryBufferFromEnvelope(payload.envelope, entry));
      });
  } catch (error) {
    if (payload.files) cleanupSogPayload(payload);
    else removeTemporaryImages(loaded);
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
    let means = null;
    let sortData = null;
    if (payload.sortDataBuffer && payload.sortDataDescriptor) {
      const source = payload.sortDataBuffer instanceof Uint8Array
        ? payload.sortDataBuffer
        : new Uint8Array(payload.sortDataBuffer);
      if (source.byteLength !== count * 6) {
        throw new Error(
          `Linear sort centers length mismatch: expected ${count * 6}, got ${source.byteLength}`,
        );
      }
      const buffer = source.byteOffset === 0
        && source.byteLength === source.buffer.byteLength
        ? source.buffer
        : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
      const descriptor = payload.sortDataDescriptor;
      if (descriptor.format !== 'uint16x3-linear'
        || !Array.isArray(descriptor.mins)
        || !Array.isArray(descriptor.maxs)
        || descriptor.mins.length !== 3
        || descriptor.maxs.length !== 3) {
        throw new Error('Linear sort centers descriptor is invalid');
      }
      sortData = {
        format: descriptor.format,
        maxs: descriptor.maxs.map(Number),
        mins: descriptor.mins.map(Number),
        values: new Uint16Array(buffer),
      };
    } else if (payload.meansBuffer) {
      const source = payload.meansBuffer instanceof Uint8Array
        ? payload.meansBuffer
        : new Uint8Array(payload.meansBuffer);
      if (source.byteLength !== count * 6) {
        throw new Error(`Packed means length mismatch: expected ${count * 6}, got ${source.byteLength}`);
      }
      means = source;
    } else {
      means = await readAndPackMeans({
        'means_l.webp': images['means_l.webp'].path,
        'means_u.webp': images['means_u.webp'].path,
      }, width, height, count);
    }
    if (payload.files) payload.files = null;
    return { count, height, images, means, sortData, width };
  } catch (error) {
    if (payload.files) cleanupSogPayload(payload);
    else removeTemporaryImages(loaded);
    throw error;
  }
}

async function loadSogAssets(canvas, scene, onProgress, options = {}) {
  const payload = await fetchSogPayload(scene, options);
  return decodeSogPayload(canvas, scene, payload, onProgress, options);
}

function cleanupAssets(assets) {
  removeTemporaryImages(Object.values((assets && assets.images) || {}));
}

module.exports = {
  cacheSogPayload,
  cleanupAssets,
  cleanupSogPayload,
  cleanupStaleSogCache,
  decodeSogPayload,
  fetchNativePackPayload,
  fetchSogPayload,
  loadSogAssets,
  requestRange,
};
