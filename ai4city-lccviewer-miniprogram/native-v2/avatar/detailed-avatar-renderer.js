'use strict';

const { createScopedThreejs } = require('../vendor/three-r164-miniprogram');
const { createAvatarController } = require('./glb-avatar-controller');

const AVATAR_URL = 'https://www.ai4dcity.com/lccviewer/models/lcc_girl.glb';

class DetailedAvatarRenderer {
  constructor({ canvas, gl, width, height, cssWidth, cssHeight, onReady, onError }) {
    this.canvas = canvas;
    this.gl = gl;
    canvas.__cssWidth = cssWidth || width;
    canvas.__cssHeight = cssHeight || height;
    canvas.__lccWebGLContext = gl;

    const THREE = createScopedThreejs(canvas);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      alpha: false,
      antialias: false,
    });
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x26303a, 1.45));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.65);
    keyLight.position.set(6, 10, 8);
    scene.add(keyLight);

    this.THREE = THREE;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(55, width / Math.max(height, 1), 0.1, 3000);
    this.avatar = createAvatarController({
      THREE,
      scene,
      canvas,
      modelUrl: AVATAR_URL,
      onReady,
      onError,
    });
  }

  setSize(width, height, cssWidth, cssHeight) {
    this.canvas.__cssWidth = cssWidth || width;
    this.canvas.__cssHeight = cssHeight || height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  render(cameraController, dt) {
    if (!cameraController || cameraController.getMode() !== 'avatar') {
      this.avatar.hide();
      return;
    }

    this.avatar.show();
    const avatarState = cameraController.getAvatarState();
    this.avatar.root.position.fromArray(avatarState.position);
    this.avatar.root.rotation.y = avatarState.heading;
    this.avatar.update(dt, {
      jumping: avatarState.airborne,
      moving: avatarState.motion > 0,
      sprint: avatarState.motion > 1,
    });

    const source = cameraController.getCamera();
    this.camera.position.fromArray(source.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(source.target[0], source.target[1], source.target[2]);
    this.camera.updateMatrixWorld();

    this.resetSharedContext();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  resetSharedContext() {
    const gl = this.gl;
    // The splat renderer uses transform feedback on the same context. Three.js
    // does not track those bindings, so clear them before it configures meshes.
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose() {
    this.avatar.dispose();
    this.renderer.dispose();
  }
}

module.exports = { DetailedAvatarRenderer };
