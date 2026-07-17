'use strict';

function createEventTarget(target = {}) {
  const listeners = Object.create(null);
  target.addEventListener = function(type, listener) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(listener);
  };
  target.removeEventListener = function(type, listener) {
    const group = listeners[type];
    if (!group) return;
    const index = group.indexOf(listener);
    if (index >= 0) group.splice(index, 1);
  };
  target.dispatchEvent = function(event = {}) {
    const group = listeners[event.type] || [];
    group.slice().forEach((listener) => listener.call(target, event));
  };
  return target;
}

function assignRuntimeProperties(target, values) {
  if (!target) return;
  Object.keys(values).forEach((key) => {
    const value = values[key];
    try {
      target[key] = value;
      return;
    } catch (error) {
      // Some Mini Program globals are getter-only during simulator hot reload.
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (!descriptor || descriptor.configurable) {
        Object.defineProperty(target, key, {
          configurable: true,
          writable: true,
          value,
        });
      }
    } catch (error) {
      // Keep the native property when it cannot be replaced.
    }
  });
}

function createFakeElement(tagName) {
  const element = createEventTarget({
    tagName: String(tagName || 'div').toUpperCase(),
    style: {},
    children: [],
    childNodes: [],
    className: '',
    innerHTML: '',
    textContent: '',
    parentElement: null,
  });
  element.appendChild = function(child) {
    if (child) child.parentElement = element;
    element.children.push(child);
    element.childNodes.push(child);
    return child;
  };
  element.removeChild = function(child) {
    element.children = element.children.filter((item) => item !== child);
    element.childNodes = element.childNodes.filter((item) => item !== child);
    return child;
  };
  element.insertBefore = element.appendChild;
  element.setAttribute = function(name, value) {
    element[name] = value;
  };
  element.getAttribute = function(name) {
    return element[name];
  };
  element.getBoundingClientRect = function() {
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  return element;
}

function encodeText(value) {
  const text = String(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes.buffer;
}

function decodeText(value) {
  if (typeof value === 'string') return value;
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let output = '';
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    output += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
  }
  try {
    return decodeURIComponent(escape(output));
  } catch (error) {
    return output;
  }
}

class MiniTextEncoder {
  encode(value) {
    const text = unescape(encodeURIComponent(String(value)));
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) {
      bytes[index] = text.charCodeAt(index);
    }
    return bytes;
  }
}

class MiniTextDecoder {
  decode(value) {
    return decodeText(value || new Uint8Array());
  }
}

class MiniURLSearchParams {
  constructor(search = '') {
    this.entries = String(search)
      .replace(/^\?/, '')
      .split('&')
      .filter(Boolean)
      .map((part) => part.split('='));
  }

  get(name) {
    const match = this.entries.find(([key]) => decodeURIComponent(key) === name);
    return match ? decodeURIComponent(match[1] || '') : null;
  }

  toString() {
    return this.entries.map((entry) => entry.join('=')).join('&');
  }
}

class MiniURL {
  constructor(input, base = '') {
    let value = String(input || '');
    if (!/^https?:\/\//i.test(value) && base) {
      const baseUrl = new MiniURL(base);
      value = value.startsWith('/')
        ? `${baseUrl.origin}${value}`
        : `${baseUrl.origin}${baseUrl.pathname.replace(/\/[^/]*$/, '/')}${value}`;
    }
    const match = value.match(/^(https?):\/\/([^/?#]+)([^?#]*)?(\?[^#]*)?(#.*)?$/i);
    if (!match) throw new TypeError(`Invalid URL: ${value}`);
    this.protocol = `${match[1]}:`;
    this.host = match[2];
    this.hostname = match[2].split(':')[0];
    this.origin = `${this.protocol}//${this.host}`;
    this.pathname = match[3] || '/';
    this.search = match[4] || '';
    this.hash = match[5] || '';
    this.href = `${this.origin}${this.pathname}${this.search}${this.hash}`;
    this.searchParams = new MiniURLSearchParams(this.search);
  }

  toString() {
    return this.href;
  }
}

MiniURL.createObjectURL = function() {
  throw new Error('Blob workers are unavailable in a native mini program.');
};
MiniURL.revokeObjectURL = function() {};

class MiniRequest {
  constructor(input, init = {}) {
    const source = typeof input === 'string' ? null : input;
    this.url = source ? source.url : String(input);
    this.method = init.method || (source && source.method) || 'GET';
    this.headers = init.headers || (source && source.headers) || {};
    this.body = init.body === undefined ? source && source.body : init.body;
  }

  toString() {
    return this.url;
  }
}

class MiniResponse {
  constructor(data, status, headers) {
    this.data = data;
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.headers = headers || {};
  }

  arrayBuffer() {
    if (this.data instanceof ArrayBuffer) return Promise.resolve(this.data);
    if (ArrayBuffer.isView(this.data)) {
      return Promise.resolve(this.data.buffer.slice(this.data.byteOffset, this.data.byteOffset + this.data.byteLength));
    }
    return Promise.resolve(encodeText(this.data));
  }

  text() {
    return Promise.resolve(decodeText(this.data));
  }

  json() {
    if (this.data && typeof this.data === 'object' && !(this.data instanceof ArrayBuffer)) {
      return Promise.resolve(this.data);
    }
    return this.text().then((value) => JSON.parse(value));
  }
}

class MiniBlob {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.type = options.type || '';
    this.size = parts.reduce((total, part) => total + MiniBlob.byteLength(part), 0);
  }

  static byteLength(part) {
    if (part instanceof ArrayBuffer) return part.byteLength;
    if (ArrayBuffer.isView(part)) return part.byteLength;
    return encodeText(part).byteLength;
  }

  arrayBufferSync() {
    const output = new Uint8Array(this.size);
    let offset = 0;
    this.parts.forEach((part) => {
      let bytes;
      if (part instanceof ArrayBuffer) bytes = new Uint8Array(part);
      else if (ArrayBuffer.isView(part)) {
        bytes = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
      } else bytes = new Uint8Array(encodeText(part));
      output.set(bytes, offset);
      offset += bytes.byteLength;
    });
    return output.buffer;
  }

  arrayBuffer() {
    return Promise.resolve(this.arrayBufferSync());
  }

  stream() {
    throw new Error('Compressed SOG streams are not supported by this Mini Program adapter.');
  }
}

class UnsupportedDecompressionStream {
  constructor(format) {
    throw new Error(`Compressed ${format} data is not supported by this Mini Program adapter.`);
  }
}

function describeRuntimeValue(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value;
  if (value.message) return value.message;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function installConsoleCapture(root) {
  if (root.__lccConsoleCaptureInstalled) return;
  const originalError = console.error.bind(console);
  console.error = function(...args) {
    root.__lccLastConsoleError = args.map(describeRuntimeValue).join(' ').slice(0, 1200);
    originalError(...args);
  };
  root.__lccConsoleCaptureInstalled = true;
}

function miniFetch(input, init = {}) {
  const request = input instanceof MiniRequest ? input : new MiniRequest(input, init);
  const method = String(request.method || 'GET').toUpperCase();
  const headers = request.headers || {};
  const contentType = headers['Content-Type'] || headers['content-type'] || '';
  const expectsText = method !== 'GET' && /json|text/i.test(contentType);
  const requestLabel = `${method} ${request.url}`;

  globalThis.__lccLastRequest = requestLabel;
  globalThis.__lccLastNetworkError = '';

  return new Promise((resolve, reject) => {
    wx.request({
      url: request.url,
      method,
      data: request.body,
      header: headers,
      responseType: expectsText ? 'text' : 'arraybuffer',
      timeout: 60000,
      success(result) {
        if (result.statusCode < 200 || result.statusCode >= 300) {
          globalThis.__lccLastNetworkError = `${requestLabel} -> HTTP ${result.statusCode}`;
        }
        resolve(new MiniResponse(result.data, result.statusCode, result.header));
      },
      fail(result) {
        const detail = describeRuntimeValue(result && (result.errMsg || result));
        const message = `${requestLabel} -> ${detail || 'wx.request failed'}`;
        globalThis.__lccLastNetworkError = message;
        reject(new Error(message));
      },
    });
  });
}

function createStorage() {
  const values = Object.create(null);
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      values[key] = String(value);
    },
    removeItem(key) {
      delete values[key];
    },
  };
}

function MiniCustomEvent(type, init = {}) {
  this.type = type;
  this.detail = init.detail;
}

function enqueueTask(callback) {
  Promise.resolve().then(callback);
}

function createInlineWorkerFactory(root) {
  const stats = root.__lccWorkerStats = root.__lccWorkerStats || {
    tasks: 0,
    results: 0,
    decodedResults: 0,
    failed: 0,
    lastError: '',
  };
  return function createInlineWorker(initializer, directHandler) {
    let terminated = false;
    const worker = createEventTarget({ onmessage: null, onerror: null });
    const scope = createEventTarget({ onmessage: null });

    function dispatchError(error) {
      stats.failed += 1;
      stats.lastError = error && error.message ? error.message : String(error);
      const event = { type: 'error', error, message: error && error.message };
      if (typeof worker.onerror === 'function') worker.onerror.call(worker, event);
      worker.dispatchEvent(event);
      console.error('[Native LCC] inline worker failed', error);
    }

    function runInScope(callback) {
      const previousScope = root.__activeInlineWorkerScope;
      root.__activeInlineWorkerScope = scope;
      try {
        return callback();
      } catch (error) {
        dispatchError(error);
        return undefined;
      } finally {
        root.__activeInlineWorkerScope = previousScope;
      }
    }

    scope.postMessage = function(data) {
      stats.results += 1;
      if (data && Number.isFinite(data.splatCount)) stats.decodedResults += 1;
      enqueueTask(() => {
        if (terminated) return;
        const event = { type: 'message', data, target: worker };
        if (typeof worker.onmessage === 'function') worker.onmessage.call(worker, event);
        worker.dispatchEvent(event);
      });
    };

    worker.postMessage = function(data) {
      stats.tasks += 1;
      enqueueTask(() => {
        if (terminated || typeof scope.onmessage !== 'function') return;
        runInScope(() => scope.onmessage.call(scope, { type: 'message', data, target: scope }));
      });
    };
    worker.terminate = function() {
      terminated = true;
      scope.onmessage = null;
      worker.onmessage = null;
    };

    runInScope(() => {
      if (directHandler) scope.onmessage = initializer;
      else initializer(scope);
    });

    return worker;
  };
}

function createMiniProgramWorker(root, workerKind) {
  const workerPaths = {
    'cpu-sort': 'workers/lcc-cpu-sort.js',
    'modern-sort': 'workers/lcc-modern-sort.js',
    bvh: 'workers/lcc-bvh.js',
  };
  const scriptPath = workerPaths[workerKind];
  if (!scriptPath || typeof wx.createWorker !== 'function') return null;
  const nativeStats = root.__lccNativeWorkerStats = root.__lccNativeWorkerStats || {};
  const stats = nativeStats[workerKind] = nativeStats[workerKind] || {
    created: 0,
    tasks: 0,
    results: 0,
    sortTasks: 0,
    sortResults: 0,
    resultIndexes: 0,
    failed: 0,
    lastError: '',
    lastTaskType: '',
  };

  try {
    const nativeWorker = wx.createWorker(scriptPath, { useExperimentalWorker: true });
    const facade = createEventTarget({ onmessage: null, onerror: null });
    stats.created += 1;

    nativeWorker.onMessage((data) => {
      stats.results += 1;
      if (data && data.indexesBuffer) {
        stats.sortResults += 1;
        stats.resultIndexes = Math.floor(data.indexesBuffer.byteLength / 4);
      }
      const event = { type: 'message', data, target: facade };
      if (typeof facade.onmessage === 'function') facade.onmessage.call(facade, event);
      facade.dispatchEvent(event);
    });
    if (typeof nativeWorker.onProcessKilled === 'function') {
      nativeWorker.onProcessKilled(() => {
        const error = new Error(`WeChat ${workerKind} worker was reclaimed by the system.`);
        stats.failed += 1;
        stats.lastError = error.message;
        const event = { type: 'error', error, message: error.message, target: facade };
        if (typeof facade.onerror === 'function') facade.onerror.call(facade, event);
        facade.dispatchEvent(event);
        root.__lccLastConsoleError = error.message;
      });
    }
    facade.postMessage = function(data) {
      stats.tasks += 1;
      stats.lastTaskType = data && data.type ? data.type : '';
      if (data && data.type === 'sss') stats.sortTasks += 1;
      const message = workerKind === 'modern-sort'
        && data
        && data.type === 'sss'
        && data.indexesBuffer
        ? { ...data, indexesBuffer: null }
        : data;
      nativeWorker.postMessage(message);
    };
    facade.terminate = function() {
      nativeWorker.terminate();
    };
    console.info(`[Native LCC] using WeChat worker: ${workerKind}`);
    return facade;
  } catch (error) {
    stats.failed += 1;
    stats.lastError = error && error.message ? error.message : String(error);
    console.warn(`[Native LCC] ${workerKind} worker unavailable; using main thread`, error);
    return null;
  }
}

function createLccWorkerFactory(root) {
  const createInlineWorker = createInlineWorkerFactory(root);
  return function createLccWorker(initializer, directHandler, workerKind) {
    return createMiniProgramWorker(root, workerKind)
      || createInlineWorker(initializer, directHandler);
  };
}

function installBrowserShim(canvas, baseUrl) {
  const root = globalThis;
  installConsoleCapture(root);
  root.__lccLastConsoleError = '';
  root.__lccLastNetworkError = '';
  root.__lccLastRequest = '';
  const system = typeof wx.getWindowInfo === 'function'
    ? { ...wx.getDeviceInfo(), ...wx.getWindowInfo() }
    : wx.getSystemInfoSync();
  const head = createFakeElement('head');
  const body = createFakeElement('body');
  const documentElement = createFakeElement('html');
  const document = createEventTarget({
    baseURI: baseUrl,
    head,
    body,
    documentElement,
    createElement(tagName) {
      if (tagName === 'canvas') return canvas;
      if (tagName === 'img' && canvas.createImage) return canvas.createImage();
      return createFakeElement(tagName);
    },
    createElementNS(namespace, tagName) {
      return this.createElement(tagName);
    },
    getElementsByTagName(tagName) {
      if (tagName === 'head') return [head];
      if (tagName === 'body') return [body];
      return [];
    },
    getElementById() {
      return null;
    },
  });
  const location = new MiniURL(baseUrl);
  const platform = String(system.platform || '').toLowerCase();
  const versionMatch = String(system.system || '').match(/\d+(?:\.\d+){0,2}/);
  const systemVersion = versionMatch ? versionMatch[0] : '16.0';
  let userAgent = `${platform || 'mobile'} MicroMessenger/8.0 MiniProgram`;
  if (platform === 'ios') {
    userAgent = `Mozilla/5.0 (iPhone; CPU iPhone OS ${systemVersion.replace(/\./g, '_')} like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0 MiniProgram`;
  } else if (platform === 'android') {
    userAgent = `Mozilla/5.0 (Linux; Android ${systemVersion}; Mobile) AppleWebKit/537.36 MicroMessenger/8.0 MiniProgram`;
  }
  const navigator = {
    userAgent,
    platform: system.platform || 'mobile',
    hardwareConcurrency: 4,
  };
  const screen = {
    width: system.screenWidth || system.windowWidth,
    height: system.screenHeight || system.windowHeight,
    availWidth: system.screenWidth || system.windowWidth,
    availHeight: system.screenHeight || system.windowHeight,
    orientation: {
      angle: 0,
      type: system.windowWidth > system.windowHeight
        ? 'landscape-primary'
        : 'portrait-primary',
    },
  };
  const performance = root.performance || { now: () => Date.now() };
  const Image = canvas.createImage
    ? function() { return canvas.createImage(); }
    : function() {};
  const imageBitmapInstances = new WeakSet();
  const ImageBitmap = function() {};
  Object.defineProperty(ImageBitmap, Symbol.hasInstance, {
    value(candidate) {
      return candidate !== null
        && (typeof candidate === 'object' || typeof candidate === 'function')
        && imageBitmapInstances.has(candidate);
    },
  });
  const decodeStats = root.__lccDecodeStats = {
    started: 0,
    completed: 0,
    failed: 0,
    lastError: '',
  };
  let bitmapSequence = 0;
  const OffscreenCanvas = function(width, height) {
    if (typeof wx.createOffscreenCanvas !== 'function') {
      throw new Error('wx.createOffscreenCanvas is unavailable.');
    }
    let offscreen;
    try {
      offscreen = wx.createOffscreenCanvas({ type: '2d', width, height });
    } catch (error) {
      offscreen = wx.createOffscreenCanvas();
    }
    offscreen.width = width;
    offscreen.height = height;
    return offscreen;
  };
  const createImageBitmap = function(blob) {
    decodeStats.started += 1;
    return new Promise((resolve, reject) => {
      if (!canvas.createImage) {
        const error = new Error('Canvas image decoding is unavailable.');
        decodeStats.failed += 1;
        decodeStats.lastError = error.message;
        reject(error);
        return;
      }

      const buffer = blob instanceof MiniBlob
        ? blob.arrayBufferSync()
        : new MiniBlob([blob]).arrayBufferSync();
      const image = canvas.createImage();
      const fileSystem = typeof wx.getFileSystemManager === 'function'
        ? wx.getFileSystemManager()
        : null;
      const mimeType = String(blob && blob.type || '').toLowerCase();
      const extension = mimeType.includes('png')
        ? 'png'
        : mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'webp';
      const suffix = `${Date.now()}-${bitmapSequence += 1}.${extension}`;
      const filePath = wx.env && wx.env.USER_DATA_PATH
        ? `${wx.env.USER_DATA_PATH}/lcc-${suffix}`
        : '';

      const cleanup = () => {
        if (!fileSystem || !filePath) return;
        fileSystem.unlink({
          filePath,
          fail() {},
        });
      };
      image.onload = () => {
        cleanup();
        imageBitmapInstances.add(image);
        if (typeof image.close !== 'function') image.close = function() {};
        decodeStats.completed += 1;
        resolve(image);
      };
      image.onerror = (reason) => {
        cleanup();
        const error = new Error(`WebP texture decode failed: ${describeRuntimeValue(reason)}`);
        decodeStats.failed += 1;
        decodeStats.lastError = error.message;
        root.__lccLastConsoleError = error.message;
        reject(error);
      };

      try {
        if (fileSystem && filePath) {
          fileSystem.writeFile({
            filePath,
            data: buffer,
            success() {
              image.src = filePath;
            },
            fail: image.onerror,
          });
        } else {
          image.src = `data:image/webp;base64,${wx.arrayBufferToBase64(buffer)}`;
        }
      } catch (reason) {
        image.onerror(reason);
      }
    });
  };
  const TextEncoder = root.TextEncoder || MiniTextEncoder;
  const TextDecoder = root.TextDecoder || MiniTextDecoder;
  const atob = root.atob || function(value) {
    const bytes = new Uint8Array(wx.base64ToArrayBuffer(String(value)));
    let output = '';
    for (let index = 0; index < bytes.length; index += 1) {
      output += String.fromCharCode(bytes[index]);
    }
    return output;
  };
  const btoa = root.btoa || function(value) {
    return wx.arrayBufferToBase64(encodeText(value));
  };
  const window = createEventTarget({
    document,
    navigator,
    location,
    screen,
    indexedDB: null,
    devicePixelRatio: system.pixelRatio || 1,
    innerWidth: canvas.__cssWidth || system.windowWidth,
    innerHeight: canvas.__cssHeight || system.windowHeight,
    performance,
    requestAnimationFrame: canvas.requestAnimationFrame.bind(canvas),
    cancelAnimationFrame: canvas.cancelAnimationFrame
      ? canvas.cancelAnimationFrame.bind(canvas)
      : function() {},
  });
  const localStorage = createStorage();
  const createLccWorker = createLccWorkerFactory(root);
  const postMessage = function(data) {
    const scope = root.__activeInlineWorkerScope;
    if (!scope || typeof scope.postMessage !== 'function') {
      throw new Error('postMessage called outside an inline LCC worker.');
    }
    scope.postMessage(data);
  };

  assignRuntimeProperties(root, {
    window,
    document,
    navigator,
    location,
    localStorage,
    Request: MiniRequest,
    Response: MiniResponse,
    URL: MiniURL,
    URLSearchParams: MiniURLSearchParams,
    fetch: miniFetch,
    performance,
    Image,
    ImageBitmap,
    Blob: MiniBlob,
    OffscreenCanvas,
    createImageBitmap,
    DecompressionStream: UnsupportedDecompressionStream,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    self: window,
    global: root,
    screen,
    indexedDB: null,
    getComputedStyle: (element) => (element && element.style) || {},
    CustomEvent: MiniCustomEvent,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    postMessage,
    __createLccWorker: createLccWorker,
  });
  const exposedWindow = root.window || window;
  assignRuntimeProperties(exposedWindow, {
    window: exposedWindow,
    self: exposedWindow,
    localStorage,
    Request: MiniRequest,
    Response: MiniResponse,
    URL: MiniURL,
    URLSearchParams: MiniURLSearchParams,
    fetch: miniFetch,
    performance,
    Image,
    ImageBitmap,
    Blob: MiniBlob,
    OffscreenCanvas,
    createImageBitmap,
    DecompressionStream: UnsupportedDecompressionStream,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    screen,
    indexedDB: null,
    getComputedStyle: root.getComputedStyle,
    CustomEvent: MiniCustomEvent,
  });
  assignRuntimeProperties(root, { self: exposedWindow });

  return { window: exposedWindow, document, navigator };
}

module.exports = { installBrowserShim };
