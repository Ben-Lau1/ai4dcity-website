'use strict';

const TARGET_HEIGHT = 1.65;

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

function parseGlb(THREE, buffer) {
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
  const json = new TextDecoder().decode(jsonBytes).replace(/\u0000+$/g, '').trim();
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
    return { array, count: item.count, components };
  }

  const textures = (meta.textures || []).map((textureMeta, index) => {
    const texture = new THREE.Texture();
    const imageMeta = meta.images && meta.images[textureMeta.source];
    if (!imageMeta || imageMeta.bufferView === undefined) return texture;
    const view = meta.bufferViews[imageMeta.bufferView];
    const bytes = new Uint8Array(
      bin.buffer,
      bin.byteOffset + (view.byteOffset || 0),
      view.byteLength,
    );
    const blob = new Blob([bytes], { type: imageMeta.mimeType || 'image/png' });
    createImageBitmap(blob).then((image) => {
      texture.image = image;
      texture.name = imageMeta.name || `avatar_texture_${index}`;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.needsUpdate = true;
    }).catch((error) => {
      console.warn('[Avatar] texture decode failed', error);
    });
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
        geometry.setAttribute(
          'uv',
          new THREE.BufferAttribute(accessor(primitive.attributes.TEXCOORD_0).array, 2),
        );
      }
      if (primitive.indices !== undefined) {
        geometry.setIndex(new THREE.BufferAttribute(accessor(primitive.indices).array, 1));
      }
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      meshParts.push({
        geometry,
        material: materials[primitive.material]
          || new THREE.MeshStandardMaterial({ color: 0xcccccc }),
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
      mesh.bind(skeleton);
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
    rawHeight: Number.isFinite(maxY - minY) ? maxY - minY : TARGET_HEIGHT,
    rawMinY: Number.isFinite(minY) ? minY : 0,
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

function createAvatarController({ THREE, scene, modelUrl, onReady, onError }) {
  const root = new THREE.Group();
  const fallback = createFallbackAvatar(THREE);
  root.add(fallback);
  root.visible = false;
  scene.add(root);

  let loadingPromise = null;
  let mixer = null;
  let currentAction = null;
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
    loadingPromise = fetch(modelUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Avatar request failed with ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const parsed = parseGlb(THREE, buffer);
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
        if (onError) onError(error);
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
      scene.remove(root);
    },
  };
}

module.exports = { createAvatarController };
