'use strict';

const eventRegistry = new WeakMap();

class MiniEventTarget {
  addEventListener(type, listener) {
    let events = eventRegistry.get(this);
    if (!events) {
      events = Object.create(null);
      eventRegistry.set(this, events);
    }
    if (!events[type]) events[type] = [];
    events[type].push(listener);
  }

  removeEventListener(type, listener) {
    const events = eventRegistry.get(this);
    const listeners = events && events[type];
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  dispatchEvent(event = {}) {
    const events = eventRegistry.get(this);
    const listeners = events && events[event.type];
    if (!listeners) return;
    if (!event.preventDefault) event.preventDefault = function() {};
    if (!event.stopPropagation) event.stopPropagation = function() {};
    listeners.slice().forEach((listener) => listener.call(this, event));
  }

  dispatchTouchEvent(event = {}) {
    const normalizeTouch = (touch) => ({
      identifier: touch.identifier,
      force: touch.force === undefined ? 1 : touch.force,
      pageX: touch.pageX === undefined ? touch.x : touch.pageX,
      pageY: touch.pageY === undefined ? touch.y : touch.pageY,
      clientX: touch.clientX === undefined ? touch.x : touch.clientX,
      clientY: touch.clientY === undefined ? touch.y : touch.clientY,
      screenX: touch.pageX === undefined ? touch.x : touch.pageX,
      screenY: touch.pageY === undefined ? touch.y : touch.pageY,
    });
    this.dispatchEvent({
      type: event.type,
      changedTouches: (event.changedTouches || []).map(normalizeTouch),
      touches: (event.touches || []).map(normalizeTouch),
      targetTouches: (event.touches || []).map(normalizeTouch),
      timeStamp: event.timeStamp,
      target: this,
      currentTarget: this,
    });
  }
}

function copyPrototype(target, source) {
  Object.getOwnPropertyNames(source).forEach((key) => {
    if (key === 'constructor' || key in target) return;
    Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
  });
}

class MiniXMLHttpRequest extends MiniEventTarget {
  constructor() {
    super();
    this.readyState = 0;
    this.response = null;
    this.responseText = '';
    this.responseType = '';
    this.status = 0;
    this.headers = {};
  }

  open(method, url) {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(data) {
    this.task = wx.request({
      url: this.url,
      method: this.method || 'GET',
      data,
      header: this.headers,
      responseType: this.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
      success: (result) => {
        this.status = result.statusCode;
        this.response = result.data;
        this.responseText = typeof result.data === 'string' ? result.data : '';
        this.readyState = 4;
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload({ target: this });
        this.dispatchEvent({ type: 'load', target: this });
      },
      fail: (error) => {
        if (this.onerror) this.onerror(error);
        this.dispatchEvent({ type: 'error', target: this, error });
      },
    });
  }

  abort() {
    if (this.task) this.task.abort();
  }
}

function decodeBase64(value) {
  const bytes = new Uint8Array(wx.base64ToArrayBuffer(value));
  let output = '';
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    output += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
  }
  return output;
}

function createScopedThreejs(canvas) {
  const style = {};
  const nativeGetContext = canvas.getContext.bind(canvas);

  if (!canvas.__lccContextAdapted) {
    canvas.getContext = function(type, attributes) {
      const isWebGL = type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl';
      if (isWebGL && canvas.__lccWebGLContext) return canvas.__lccWebGLContext;

      const requestedType = type === 'experimental-webgl' ? 'webgl2' : type;
      const context = nativeGetContext(requestedType, attributes);
      if (isWebGL && context) canvas.__lccWebGLContext = context;
      return context;
    };
    canvas.__lccContextAdapted = true;
  }

  try {
    Object.defineProperty(canvas, 'style', { configurable: true, get: () => style });
    Object.defineProperty(canvas, 'clientWidth', {
      configurable: true,
      get: () => canvas.__cssWidth || canvas.width,
    });
    Object.defineProperty(canvas, 'clientHeight', {
      configurable: true,
      get: () => canvas.__cssHeight || canvas.height,
    });
  } catch (error) {
    console.warn('[Three adapter] canvas dimensions already defined', error);
  }

  copyPrototype(canvas.constructor.prototype, MiniEventTarget.prototype);

  const document = {
    createElementNS(namespace, type) {
      if (type === 'canvas') return canvas;
      if (type === 'img' && canvas.createImage) return canvas.createImage();
      return { style: {}, addEventListener() {}, removeEventListener() {} };
    },
    createElement(type) {
      return this.createElementNS('', type);
    },
  };
  const window = new MiniEventTarget();
  const windowInfo = typeof wx.getWindowInfo === 'function'
    ? wx.getWindowInfo()
    : wx.getSystemInfoSync();
  window.document = document;
  window.devicePixelRatio = windowInfo.pixelRatio || 1;
  window.innerWidth = canvas.__cssWidth || canvas.width;
  window.innerHeight = canvas.__cssHeight || canvas.height;
  window.requestAnimationFrame = canvas.requestAnimationFrame.bind(canvas);
  window.cancelAnimationFrame = canvas.cancelAnimationFrame
    ? canvas.cancelAnimationFrame.bind(canvas)
    : function() {};
  window.AudioContext = function() {};
  window.URL = {};

  const self = window;
  const navigator = {
    userAgent: 'MicroMessenger MiniProgram',
    hardwareConcurrency: 4,
  };
  const atob = decodeBase64;
  const XMLHttpRequest = MiniXMLHttpRequest;
  const HTMLCanvasElement = undefined;
  const exports = {};

  __THREE_CJS__

  return exports;
}

module.exports = { createScopedThreejs };
