'use strict';

// The source landscape uses survey-scale world units. A 2.15-unit character
// matches doors, railings, and the third-person camera framing in these scenes.
const TARGET_HEIGHT = 2.15;

function decodeUtf8(bytes) {
  let output = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    let codePoint;
    if (first < 0x80) {
      codePoint = first;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = ((first & 0x1f) << 6) | (bytes[index++] & 0x3f);
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = ((first & 0x0f) << 12)
        | ((bytes[index++] & 0x3f) << 6)
        | (bytes[index++] & 0x3f);
    } else {
      codePoint = ((first & 0x07) << 18)
        | ((bytes[index++] & 0x3f) << 12)
        | ((bytes[index++] & 0x3f) << 6)
        | (bytes[index++] & 0x3f);
    }
    if (codePoint <= 0xffff) {
      output += String.fromCharCode(codePoint);
    } else {
      const value = codePoint - 0x10000;
      output += String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
    }
  }
  return output;
}

function requestArrayBuffer(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Avatar request failed (${response.statusCode})`));
          return;
        }
        if (!response.data || typeof response.data.byteLength !== 'number') {
          reject(new Error('Avatar response did not contain binary data'));
          return;
        }
        resolve(response.data);
      },
      fail(error) {
        reject(new Error((error && error.errMsg) || 'Avatar request failed'));
      },
    });
  });
}

function exactArrayBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function decodeEmbeddedImage(canvas, bytes, mimeType, index) {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const path = `${wx.env.USER_DATA_PATH}/native-avatar-${Date.now()}-${index}.${extension}`;
  const fileSystem = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fileSystem.writeFile({
      filePath: path,
      data: exactArrayBuffer(bytes),
      success() {
        const image = canvas.createImage();
        image.onload = () => resolve({ image, path });
        image.onerror = (error) => {
          fileSystem.unlink({ filePath: path, fail() {} });
          reject(new Error((error && error.errMsg) || `Avatar texture ${index} decode failed`));
        };
        image.src = path;
      },
      fail(error) {
        reject(new Error((error && error.errMsg) || `Avatar texture ${index} write failed`));
      },
    });
  });
}

function componentArray(componentType) {
  return {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
  }[componentType];
}

function componentBytes(componentType) {
  return {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  }[componentType] || 4;
}

function typeComponents(type) {
  return {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
  }[type] || 1;
}

function parseGlb(THREE, canvas, buffer) {
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x46546c67) {
    throw new Error('Avatar asset is not a GLB file.');
  }

  let offset = 12;
  const jsonLength = header.getUint32(offset, true);
  offset += 4;
  const jsonType = header.getUint32(offset, true);
  offset += 4;
  if (jsonType !== 0x4e4f534a) throw new Error('Avatar GLB JSON chunk is missing.');

  const jsonBytes = new Uint8Array(buffer, offset, jsonLength);
  const json = decodeUtf8(jsonBytes).replace(/\u0000+$/g, '').trim();
  const meta = JSON.parse(json);
  offset += jsonLength;

  const binLength = header.getUint32(offset, true);
  offset += 4;
  const binType = header.getUint32(offset, true);
  offset += 4;
  if (binType !== 0x004e4942) throw new Error('Avatar GLB binary chunk is missing.');
  const bin = new Uint8Array(buffer, offset, binLength);
  const binView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  function readScalar(byteOffset, componentType) {
    switch (componentType) {
      case 5120: return binView.getInt8(byteOffset);
      case 5121: return binView.getUint8(byteOffset);
      case 5122: return binView.getInt16(byteOffset, true);
      case 5123: return binView.getUint16(byteOffset, true);
      case 5125: return binView.getUint32(byteOffset, true);
      case 5126: return binView.getFloat32(byteOffset, true);
      default: throw new Error(`Unsupported GLB component type ${componentType}`);
    }
  }

  function accessor(index) {
    const item = meta.accessors[index];
    const view = meta.bufferViews[item.bufferView];
    const components = typeComponents(item.type);
    const bytes = componentBytes(item.componentType);
    const ArrayType = componentArray(item.componentType);
    const byteOffset = (view.byteOffset || 0) + (item.byteOffset || 0);
    const stride = view.byteStride || components * bytes;

    if (stride === components * bytes) {
      return {
        array: new ArrayType(
          bin.buffer,
          bin.byteOffset + byteOffset,
          item.count * components,
        ),
        count: item.count,
        components,
        normalized: !!item.normalized,
      };
    }

    const array = new ArrayType(item.count * components);
    for (let row = 0; row < item.count; row += 1) {
      const rowOffset = byteOffset + row * stride;
      for (let column = 0; column < components; column += 1) {
        array[row * components + column] = readScalar(
          rowOffset + column * bytes,
          item.componentType,
        );
      }
    }
    return {
      array,
      count: item.count,
      components,
      normalized: !!item.normalized,
    };
  }

  const baseColorTextureIndexes = new Set();
  (meta.materials || []).forEach((materialMeta) => {
    const pbr = materialMeta.pbrMetallicRoughness || {};
    if (pbr.baseColorTexture) baseColorTextureIndexes.add(pbr.baseColorTexture.index);
  });
  const temporaryTexturePaths = [];
  const texturePromises = [];
  const textures = (meta.textures || []).map((textureMeta, index) => {
    const texture = new THREE.Texture();
    const imageMeta = meta.images && meta.images[textureMeta.source];
    if (!imageMeta || imageMeta.bufferView === undefined) return texture;
    texture.name = imageMeta.name || `avatar_texture_${index}`;
    texture.colorSpace = baseColorTextureIndexes.has(index)
      ? THREE.SRGBColorSpace
      : THREE.NoColorSpace;
    texture.flipY = false;
    const view = meta.bufferViews[imageMeta.bufferView];
    const bytes = new Uint8Array(
      bin.buffer,
      bin.byteOffset + (view.byteOffset || 0),
      view.byteLength,
    );
    texturePromises.push(
      decodeEmbeddedImage(canvas, bytes, imageMeta.mimeType || 'image/png', index)
        .then((decoded) => {
          temporaryTexturePaths.push(decoded.path);
          texture.image = decoded.image;
          texture.needsUpdate = true;
        }),
    );
    return texture;
  });

  const materials = (meta.materials || []).map((materialMeta, index) => {
    const pbr = materialMeta.pbrMetallicRoughness || {};
    const material = new THREE.MeshStandardMaterial({
      name: materialMeta.name || `avatar_material_${index}`,
      roughness: pbr.roughnessFactor === undefined ? 1 : pbr.roughnessFactor,
      metalness: pbr.metallicFactor === undefined ? 0 : pbr.metallicFactor,
      transparent: materialMeta.alphaMode === 'BLEND',
      alphaTest: materialMeta.alphaMode === 'MASK'
        ? materialMeta.alphaCutoff === undefined ? 0.5 : materialMeta.alphaCutoff
        : 0,
    });
    if (pbr.baseColorFactor) {
      material.color.fromArray(pbr.baseColorFactor);
      material.opacity = pbr.baseColorFactor[3] === undefined ? 1 : pbr.baseColorFactor[3];
    }
    if (pbr.baseColorTexture && textures[pbr.baseColorTexture.index]) {
      material.map = textures[pbr.baseColorTexture.index];
    }
    if (materialMeta.normalTexture && textures[materialMeta.normalTexture.index]) {
      material.normalMap = textures[materialMeta.normalTexture.index];
      if (materialMeta.normalTexture.scale !== undefined) {
        material.normalScale.setScalar(materialMeta.normalTexture.scale);
      }
    }
    material.side = materialMeta.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    return material;
  });

  const meshParts = [];
  (meta.meshes || []).forEach((meshMeta) => {
    meshMeta.primitives.forEach((primitive) => {
      const position = accessor(primitive.attributes.POSITION);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(position.array, 3));
      if (primitive.attributes.NORMAL !== undefined) {
        geometry.setAttribute(
          'normal',
          new THREE.BufferAttribute(accessor(primitive.attributes.NORMAL).array, 3),
        );
      }
      if (primitive.attributes.TEXCOORD_0 !== undefined) {
        const uv = accessor(primitive.attributes.TEXCOORD_0);
        geometry.setAttribute(
          'uv',
          new THREE.BufferAttribute(uv.array, uv.components, uv.normalized),
        );
      }
      if (primitive.attributes.COLOR_0 !== undefined) {
        const color = accessor(primitive.attributes.COLOR_0);
        geometry.setAttribute(
          'color',
          new THREE.BufferAttribute(color.array, color.components, color.normalized),
        );
      }
      if (primitive.indices !== undefined) {
        geometry.setIndex(new THREE.BufferAttribute(accessor(primitive.indices).array, 1));
      }
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = materials[primitive.material]
        || new THREE.MeshStandardMaterial({ color: 0xcccccc });
      if (primitive.attributes.COLOR_0 !== undefined) material.vertexColors = true;
      meshParts.push({
        geometry,
        material,
        primitive,
      });
    });
  });

  const bones = new Map();
  function buildBone(index) {
    if (bones.has(index)) return bones.get(index);
    const node = meta.nodes[index];
    const bone = new THREE.Bone();
    bone.name = node.name || `avatar_bone_${index}`;
    if (node.matrix) {
      bone.matrix.fromArray(node.matrix);
      bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
    } else {
      if (node.translation) bone.position.fromArray(node.translation);
      if (node.rotation) bone.quaternion.fromArray(node.rotation);
      if (node.scale) bone.scale.fromArray(node.scale);
    }
    bones.set(index, bone);
    (node.children || []).forEach((child) => bone.add(buildBone(child)));
    return bone;
  }

  const model = new THREE.Group();
  const sceneMeta = meta.scenes[meta.scene || 0];
  (sceneMeta.nodes || []).forEach((nodeIndex) => model.add(buildBone(nodeIndex)));
  model.updateMatrixWorld(true);

  if (meta.skins && meta.skins.length) {
    const skin = meta.skins[0];
    const joints = skin.joints.map((index) => bones.get(index) || buildBone(index));
    const inverses = [];
    if (skin.inverseBindMatrices !== undefined) {
      const values = accessor(skin.inverseBindMatrices).array;
      for (let index = 0; index < joints.length; index += 1) {
        inverses.push(new THREE.Matrix4().fromArray(values, index * 16));
      }
    } else {
      joints.forEach(() => inverses.push(new THREE.Matrix4()));
    }
    const skeleton = new THREE.Skeleton(joints, inverses);
    meshParts.forEach((part) => {
      if (part.primitive.attributes.JOINTS_0 !== undefined) {
        let values = accessor(part.primitive.attributes.JOINTS_0).array;
        if (!(values instanceof Float32Array)) values = Float32Array.from(values);
        part.geometry.setAttribute('skinIndex', new THREE.BufferAttribute(values, 4));
      }
      if (part.primitive.attributes.WEIGHTS_0 !== undefined) {
        let values = accessor(part.primitive.attributes.WEIGHTS_0).array;
        if (!(values instanceof Float32Array)) {
          const divisor = values.BYTES_PER_ELEMENT === 1 ? 255 : 65535;
          values = Float32Array.from(values, (value) => value / divisor);
        }
        part.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(values, 4));
      }
      const mesh = new THREE.SkinnedMesh(part.geometry, part.material);
      // The GLB already supplies inverse bind matrices. Passing an explicit
      // identity bind matrix prevents Three.js from overwriting them before
      // the skinned mesh has joined the scene graph.
      mesh.bind(skeleton, new THREE.Matrix4());
      mesh.normalizeSkinWeights();
      mesh.frustumCulled = true;
      model.add(mesh);
    });
  } else {
    meshParts.forEach((part) => {
      model.add(new THREE.Mesh(part.geometry, part.material));
    });
  }

  const animations = [];
  (meta.animations || []).forEach((animationMeta, animationIndex) => {
    const tracks = [];
    animationMeta.channels.forEach((channel) => {
      const sampler = animationMeta.samplers[channel.sampler];
      const times = accessor(sampler.input).array;
      const values = accessor(sampler.output).array;
      const node = meta.nodes[channel.target.node];
      const targetName = node.name || `avatar_bone_${channel.target.node}`;
      let track;
      if (channel.target.path === 'translation') {
        track = new THREE.VectorKeyframeTrack(`${targetName}.position`, times, values);
      } else if (channel.target.path === 'rotation') {
        track = new THREE.QuaternionKeyframeTrack(`${targetName}.quaternion`, times, values);
      } else if (channel.target.path === 'scale') {
        track = new THREE.VectorKeyframeTrack(`${targetName}.scale`, times, values);
      }
      if (track) tracks.push(track);
    });
    if (tracks.length) {
      animations.push(new THREE.AnimationClip(
        animationMeta.name || `avatar_animation_${animationIndex}`,
        -1,
        tracks,
      ));
    }
  });

  let minY = Infinity;
  let maxY = -Infinity;
  meshParts.forEach((part) => {
    const bounds = part.geometry.boundingBox;
    if (!bounds) return;
    minY = Math.min(minY, bounds.min.y);
    maxY = Math.max(maxY, bounds.max.y);
  });

  return {
    model,
    animations,
    geometries: meshParts.map((part) => part.geometry),
    materials,
    rawHeight: Number.isFinite(maxY - minY) ? maxY - minY : TARGET_HEIGHT,
    rawMinY: Number.isFinite(minY) ? minY : 0,
    textureReady: Promise.all(texturePromises.map((promise) => promise.then(
      () => null,
      (error) => error,
    ))).then((errors) => {
      const failure = errors.find((error) => error);
      if (failure) throw failure;
    }),
    textures,
    temporaryTexturePaths,
  };
}

function createFallbackAvatar(THREE) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c7a5, roughness: 0.75 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x3f82d1, roughness: 0.65 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x202a38, roughness: 0.8 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), skin);
  head.position.y = 1.48;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.48, 5, 10), jacket);
  body.position.y = 1.02;
  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.5, 4, 8), trousers);
  leftLeg.position.set(-0.1, 0.38, 0);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.1;
  group.add(head, body, leftLeg, rightLeg);
  return group;
}

function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  const skeletons = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => materials.add(material));
    } else if (object.material) {
      materials.add(object.material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
}

function removeTemporaryTextures(paths) {
  const fileSystem = wx.getFileSystemManager();
  (paths || []).forEach((path) => {
    fileSystem.unlink({ filePath: path, fail() {} });
  });
  if (paths) paths.length = 0;
}

function disposeParsedAsset(asset) {
  if (!asset) return;
  disposeObject(asset.model);
  (asset.textures || []).forEach((texture) => texture.dispose());
  removeTemporaryTextures(asset.temporaryTexturePaths);
}

function createAvatarController({ THREE, scene, canvas, modelUrl, onReady, onError }) {
  const root = new THREE.Group();
  const fallback = createFallbackAvatar(THREE);
  fallback.scale.setScalar(TARGET_HEIGHT / 1.65);
  root.add(fallback);
  root.visible = false;
  scene.add(root);

  let loadingPromise = null;
  let mixer = null;
  let currentAction = null;
  let parsedAsset = null;
  let disposed = false;
  const actions = {};

  function play(name) {
    const next = actions[name] || actions.stand || actions.idle;
    if (!next || next === currentAction) return;
    if (currentAction) currentAction.fadeOut(0.15);
    next.reset().fadeIn(0.15).play();
    currentAction = next;
  }

  function load() {
    if (loadingPromise) return loadingPromise;
    loadingPromise = requestArrayBuffer(modelUrl)
      .then(async (buffer) => {
        if (disposed) return fallback;
        const parsed = parseGlb(THREE, canvas, buffer);
        parsedAsset = parsed;
        await parsed.textureReady;
        if (disposed) {
          disposeParsedAsset(parsed);
          parsedAsset = null;
          return fallback;
        }
        const scale = parsed.rawHeight > 0 ? TARGET_HEIGHT / parsed.rawHeight : 1;
        parsed.model.scale.setScalar(scale);
        parsed.model.position.y = -parsed.rawMinY * scale;
        root.add(parsed.model);
        fallback.visible = false;

        mixer = new THREE.AnimationMixer(parsed.model);
        parsed.animations.forEach((clip) => {
          const name = clip.name.toLowerCase();
          const action = mixer.clipAction(clip);
          if (name.includes('stand') || name.includes('idle')) actions.stand = action;
          else if (name.includes('walk')) actions.walk = action;
          else if (name.includes('run')) actions.run = action;
          else if (name.includes('jump')) actions.jump = action;
        });
        play('stand');
        if (onReady) onReady();
        return parsed.model;
      })
      .catch((error) => {
        console.error('[Avatar] load failed', error);
        if (parsedAsset) {
          disposeParsedAsset(parsedAsset);
          parsedAsset = null;
        }
        if (!disposed && onError) onError(error);
        return fallback;
      });
    return loadingPromise;
  }

  return {
    root,
    height: TARGET_HEIGHT,
    load,
    show() {
      root.visible = true;
      load();
    },
    hide() {
      root.visible = false;
    },
    update(dt, motion) {
      if (mixer) mixer.update(Math.min(dt, 0.05));
      if (motion.jumping) play('jump');
      else if (motion.moving) play(motion.sprint ? 'run' : 'walk');
      else play('stand');
    },
    dispose() {
      disposed = true;
      if (mixer) {
        mixer.stopAllAction();
        if (parsedAsset) mixer.uncacheRoot(parsedAsset.model);
      }
      scene.remove(root);
      disposeObject(fallback);
      if (parsedAsset) {
        disposeParsedAsset(parsedAsset);
        parsedAsset = null;
      }
    },
  };
}

module.exports = { createAvatarController };
