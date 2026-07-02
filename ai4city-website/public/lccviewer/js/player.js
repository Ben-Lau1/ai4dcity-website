/**
 * player.js — 第三人称角色控制器（模型专用）
 * 只管理模型加载/动画/移动/跳跃，不再操控相机
 * 相机跟随逻辑已迁移到 CameraState.js
 */
(function() {
  'use strict';

  const MODEL_PATH = 'models/lcc_girl.glb';

  let model   = null;
  let mixer   = null;
  let actions = {};
  let currentAction = null;
  let MODEL_HEIGHT  = 1.65;  // 目标身高

  const WALK_SPEED = 5;
  const RUN_SPEED  = 15;
  const GRAVITY    = 15;
  const JUMP_FORCE = 6;
  const GROUND_Y   = 0;
  const GROUND_PROBE_MOVE_INTERVAL = 0.08;
  const GROUND_PROBE_IDLE_INTERVAL = 0.25;
  const GROUND_PROBE_MOVE_DIST_SQ = 0.25;
  // ★ 小人脚部抬高常量（避免脚部进入地面）
  //   原因：rawMinY 估算 + 碰撞射线采样都存在厘米级误差
  //   5cm 足以让脚"刚好"踩在地面，看起来自然
  const FOOT_LIFT  = 0.05;

  var jumpVel    = 0;
  var groundY    = 0;
  var animLocked = null;  // 锁定动画名（跳跃期间禁止覆盖）
  var jumpTimeout = 0;    // 跳跃持续时间（防 animLocked 卡死）
  var _enabled   = false;
  var _groundProbeTimer = 0;
  var _lastProbeX = Infinity;
  var _lastProbeZ = Infinity;
  var _cachedGroundY = null;

  function resetMotionState() {
    jumpVel = 0;
    groundY = 0;
    animLocked = null;
    jumpTimeout = 0;
    _groundProbeTimer = 0;
    _lastProbeX = Infinity;
    _lastProbeZ = Infinity;
    _cachedGroundY = null;
  }

  // ===================================================================
  // GLB 加载器（与原先相同，无修改）
  // ===================================================================

  function loadGLB(url, onLoad, onError) {
    var req = new XMLHttpRequest();
    req.responseType = 'arraybuffer';
    req.onload = function() {
      try {
        var data = parseGLB(req.response);
        if (data) onLoad(data);
        else onError('Parse failed');
      } catch(e) { onError(e); }
    };
    req.onerror = function() { onError('Network error'); };
    req.open('GET', url);
    req.send();
  }

  function parseGLB(buffer) {
    var dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('Not a GLB file');
    var offset = 12;
    var chunkLen = dv.getUint32(offset, true); offset += 4;
    var chunkType = dv.getUint32(offset, true); offset += 4;
    if (chunkType !== 0x4E4F534A) throw new Error('First chunk not JSON');
    var jsonStr = '';
    for (var i = 0; i < chunkLen; i++) {
      jsonStr += String.fromCharCode(dv.getUint8(offset + i));
    }
    var meta = JSON.parse(jsonStr);

    var binOffset = offset + chunkLen;
    var binLen = dv.getUint32(binOffset, true);
    var binData = new Uint8Array(buffer, binOffset + 8, binLen);

    var scene = new THREE.Group();
    scene.name = meta.scenes[0].name || 'scene';

    // 辅助：从 bufferView 读取图像数据
    function getImageViewData(imgIdx) {
      var img = meta.images[imgIdx];
      if (!img) return null;
      if (img.uri) {
        var basePath = MODEL_PATH.lastIndexOf('/') >= 0 ? MODEL_PATH.substring(0, MODEL_PATH.lastIndexOf('/') + 1) : '';
        return { type: 'url', data: basePath + img.uri };
      }
      if (img.bufferView !== undefined) {
        var bv = meta.bufferViews[img.bufferView];
        var data = new Uint8Array(binData.buffer, binData.byteOffset + (bv.byteOffset || 0), bv.byteLength);
        var mime = img.mimeType || 'image/png';
        var blob = new Blob([data], { type: mime });
        return { type: 'blob', mime: mime, data: URL.createObjectURL(blob) };
      }
      return null;
    }

    // 加载贴图
    var textures = {};
    var _texWait = 0;
    if (meta.textures) {
      meta.textures.forEach(function(t, i) {
        var src = getImageViewData(t.source);
        if (!src) return;
        _texWait++;
        var tex = new THREE.Texture();
        tex.name = (meta.images[t.source] && meta.images[t.source].name) || ('tex_' + i);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        var img = new Image();
        img.onload = function() { tex.image = img; tex.needsUpdate = true; _texWait--; };
        img.onerror = function() { _texWait--; };
        img.src = src.data;
        textures[i] = tex;
      });
    }

    // 加载材质
    var materials = [];
    if (meta.materials) {
      meta.materials.forEach(function(m, i) {
        var mat = new THREE.MeshStandardMaterial({
          name: m.name || ('mat_' + i),
          roughness: m.pbrMetallicRoughness ? m.pbrMetallicRoughness.roughness || 1 : 1,
          metalness: m.pbrMetallicRoughness ? m.pbrMetallicRoughness.metallicness || 0 : 0,
        });
        var pbr = m.pbrMetallicRoughness || {};
        if (pbr.baseColorTexture && textures[pbr.baseColorTexture.index]) {
          mat.map = textures[pbr.baseColorTexture.index];
        }
        if (pbr.baseColorFactor) { mat.color.fromArray(pbr.baseColorFactor); }
        materials[i] = mat;
      });
    }

    // 字节读取工具
    var _srcView = new DataView(binData.buffer);
    function componentByteSize(ct) {
      return { 5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4 }[ct] || 4;
    }
    function readScalar(byteOff, ct) {
      switch (ct) {
        case 5120: return _srcView.getInt8(byteOff);
        case 5121: return _srcView.getUint8(byteOff);
        case 5122: return _srcView.getInt16(byteOff, true);
        case 5123: return _srcView.getUint16(byteOff, true);
        case 5125: return _srcView.getUint32(byteOff, true);
        case 5126: return _srcView.getFloat32(byteOff, true);
        default: throw new Error('Unknown component type ' + ct);
      }
    }

    function getAccessor(idx) {
      var acc  = meta.accessors[idx];
      var bv   = meta.bufferViews[acc.bufferView];
      var count = acc.count;
      var nc = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT2:4, MAT3:9, MAT4:16 }[acc.type] || 3;
      var elemSz  = componentByteSize(acc.componentType);
      var stride  = bv.byteStride || 0;
      var byteOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
      var CT = { 5120:Int8Array, 5121:Uint8Array, 5122:Int16Array, 5123:Uint16Array, 5125:Uint32Array, 5126:Float32Array }[acc.componentType];

      if (!stride || stride <= nc * elemSz) {
        return { array: new CT(binData.buffer, binData.byteOffset + byteOff, count * nc), count: count, numComponents: nc };
      }
      var total = count * nc;
      var arr = new CT(total);
      for (var v = 0; v < count; v++) {
        var base = byteOff + v * stride;
        for (var c = 0; c < nc; c++) {
          arr[v * nc + c] = readScalar(base + c * elemSz, acc.componentType);
        }
      }
      return { array: arr, count: count, numComponents: nc };
    }

    var meshes = [];
    if (meta.meshes) {
      meta.meshes.forEach(function(mesh) {
        mesh.primitives.forEach(function(prim) {
          var pos = getAccessor(prim.attributes.POSITION);
          var hasNan = false;
          for (var ci = 0; ci < Math.min(pos.array.length, 30); ci++) { if (isNaN(pos.array[ci]) || !isFinite(pos.array[ci])) { hasNan = true; break; } }
          if (hasNan || pos.array.length < 3) return;
          var geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(pos.array, 3));
          if (prim.attributes.NORMAL !== undefined) {
            var norm = getAccessor(prim.attributes.NORMAL);
            geo.setAttribute('normal', new THREE.BufferAttribute(norm.array, 3));
          }
          if (prim.attributes.TEXCOORD_0 !== undefined) {
            var uv = getAccessor(prim.attributes.TEXCOORD_0);
            geo.setAttribute('uv', new THREE.BufferAttribute(uv.array, 2));
          }
          if (prim.indices !== undefined) {
            var idx = getAccessor(prim.indices);
            geo.setIndex(new THREE.BufferAttribute(idx.array, 1));
          }
          var mat = materials[prim.material] || new THREE.MeshStandardMaterial({ color: 0xcccccc });
          var m = new THREE.Mesh(geo, mat);
          try { m.geometry.computeBoundingSphere(); } catch(e) { return; }
          if (isNaN(m.geometry.boundingSphere.radius) || !isFinite(m.geometry.boundingSphere.radius)) return;
          m.frustumCulled = true;
          meshes.push({ mesh: m, prim: prim });
        });
      });
    }

    // 构建骨骼树
    var boneMap = {}, allBones = [], boneRoot = null;
    function buildBone(idx) {
      if (boneMap[idx]) return boneMap[idx];
      var nd = meta.nodes[idx];
      var bone = new THREE.Bone();
      bone.name = nd.name || 'bone_' + idx;
      if (nd.matrix) {
        bone.matrix.fromArray(nd.matrix);
        bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
      } else {
        if (nd.translation) bone.position.fromArray(nd.translation);
        if (nd.rotation)    bone.quaternion.fromArray(nd.rotation);
        if (nd.scale)       bone.scale.fromArray(nd.scale);
      }
      boneMap[idx] = bone;
      if (nd.children) { nd.children.forEach(function(cid) { bone.add(buildBone(cid)); }); }
      return bone;
    }

    if (meta.nodes) {
      var rootIdxs = meta.scenes[meta.scene || 0].nodes || [];
      rootIdxs.forEach(function(rid) { var b = buildBone(rid); scene.add(b); if (!boneRoot) boneRoot = b; });
      var _stack = rootIdxs.slice();
      while (_stack.length > 0) {
        var nid = _stack.pop();
        var bn = boneMap[nid];
        if (bn && allBones.indexOf(bn) < 0) allBones.push(bn);
        var nd = meta.nodes[nid];
        if (nd && nd.children) { for (var ci = 0; ci < nd.children.length; ci++) _stack.push(nd.children[ci]); }
      }
    }

    // 蒙皮
    if (meta.skins && meta.skins.length > 0 && meta.nodes) {
      var skinData = meta.skins[0];
      if (boneRoot) boneRoot.updateMatrixWorld();
      var joints = [];
      for (var ji = 0; ji < skinData.joints.length; ji++) {
        var b = boneMap[skinData.joints[ji]];
        if (!b) console.warn('[Player] Missing bone for joint node', skinData.joints[ji]);
        joints.push(b || boneRoot);
      }
      var boneInverses = [];
      var ibmAcc = meta.accessors[skinData.inverseBindMatrices];
      if (ibmAcc) {
        var ibmData = getAccessor(skinData.inverseBindMatrices);
        for (var ji2 = 0; ji2 < skinData.joints.length; ji2++) {
          var m = new THREE.Matrix4();
          m.fromArray(ibmData.array, ji2 * 16);
          boneInverses.push(m);
        }
      } else {
        for (var ji2 = 0; ji2 < joints.length; ji2++) boneInverses.push(new THREE.Matrix4().identity());
      }
      var skeleton = new THREE.Skeleton(joints, boneInverses);
      meshes.forEach(function(item) {
        var m = item.mesh, prim = item.prim, geo = m.geometry, mat = m.material;
        if (prim.attributes && prim.attributes.JOINTS_0 !== undefined) {
          var jAcc = getAccessor(prim.attributes.JOINTS_0);
          var jointsArr = jAcc.array;
          if (jointsArr.BYTES_PER_ELEMENT <= 2) { var jf32 = new Float32Array(jointsArr.length); for (var j = 0; j < jointsArr.length; j++) jf32[j] = jointsArr[j]; jointsArr = jf32; }
          geo.setAttribute('skinIndex', new THREE.BufferAttribute(jointsArr, 4));
        }
        if (prim.attributes && prim.attributes.WEIGHTS_0 !== undefined) {
          var wAcc = getAccessor(prim.attributes.WEIGHTS_0);
          var weightsArr = wAcc.array;
          if (weightsArr.BYTES_PER_ELEMENT <= 2) { var wf = new Float32Array(weightsArr.length); for (var w = 0; w < weightsArr.length; w++) wf[w] = weightsArr[w] / 255.0; weightsArr = wf; }
          geo.setAttribute('skinWeight', new THREE.BufferAttribute(weightsArr, 4));
        }
        var skinned = new THREE.SkinnedMesh(geo, mat);
        skinned.bind(skeleton);
        skinned.normalizeSkinWeights();
        scene.add(skinned);
        item.mesh = skinned;
      });
    } else {
      meshes.forEach(function(item) { if (boneRoot) boneRoot.add(item.mesh); else scene.add(item.mesh); });
    }

    // 加载动画
    var clips = [];
    if (meta.animations) {
      meta.animations.forEach(function(anim) {
        try {
          var tracks = [];
          anim.channels.forEach(function(ch) {
            var sampler = anim.samplers[ch.sampler];
            var input  = getAccessor(sampler.input);
            var output = getAccessor(sampler.output);
            var nodeName = meta.nodes && ch.target.node !== undefined ? meta.nodes[ch.target.node].name || '' : '';
            var times  = input.array, values = output.array;
            var track;
            if (ch.target.path === 'translation') track = new THREE.VectorKeyframeTrack(nodeName + '.position', times, values);
            else if (ch.target.path === 'rotation') track = new THREE.QuaternionKeyframeTrack(nodeName + '.quaternion', times, values);
            else if (ch.target.path === 'scale') track = new THREE.VectorKeyframeTrack(nodeName + '.scale', times, values);
            if (track) tracks.push(track);
          });
          if (tracks.length > 0) clips.push(new THREE.AnimationClip(anim.name || 'anim_' + clips.length, -1, tracks));
        } catch(e) { console.warn('[Player] Skip animation:', anim.name, String(e)); }
      });
    }

    // 计算网格包围盒高度（用于自动缩放）
    var meshMinY = Infinity, meshMaxY = -Infinity;
    meshes.forEach(function(item) {
      var m = item.mesh;
      m.geometry.computeBoundingBox();
      var bb = m.geometry.boundingBox;
      if (bb && isFinite(bb.min.y) && isFinite(bb.max.y)) {
        if (bb.min.y < meshMinY) meshMinY = bb.min.y;
        if (bb.max.y > meshMaxY) meshMaxY = bb.max.y;
      }
    });
    var rawHeight = (isFinite(meshMinY) && isFinite(meshMaxY)) ? (meshMaxY - meshMinY) : 0;
    var rawMinY   = isFinite(meshMinY) ? meshMinY : 0;

    var flatMeshes = meshes.map(function(item) { return item.mesh; });
    return { scene: scene, animations: clips, meshes: flatMeshes, rawHeight: rawHeight, rawMinY: rawMinY };
  }

  // ===================================================================
  // 模型加载 & 动画
  // ===================================================================

  function loadModel() {
    if (!LCCScene) return;
    loadGLB(MODEL_PATH, function(result) {
      model = result.scene;

      var rawH = result.rawHeight || 1.7;
      var rawMinY = result.rawMinY || 0;
      var autoScale = rawH > 0 ? MODEL_HEIGHT / rawH : 0.3;
      MODEL_HEIGHT = rawH * autoScale;
      console.log('[Player] Raw height:', rawH.toFixed(2), '→ scale:', autoScale.toFixed(3), '→ rendered:', MODEL_HEIGHT.toFixed(2), 'm');

      // 模型放到相机前方
      if (LCCScene && LCCScene.camera) {
        var dir = new THREE.Vector3();
        LCCScene.camera.getWorldDirection(dir);
        // dir 是相机看向的方向（世界坐标）
        // 模型放在相机前方 5 米
        model.position.set(
          CameraState.getPosition().x + dir.x * 5,
          0 - rawMinY * autoScale,
          CameraState.getPosition().z + dir.z * 5
        );
        // ★ GLB 模型 +Z 是前方
        //   Three.js rotation.y = atan2(worldX, worldZ) 让 +Z 指向 (worldX, worldZ) 方向
        //   我们要让模型 +Z 指向 dir（相机看向的方向），所以：
        model.rotation.y = Math.atan2(dir.x, dir.z);
      } else {
        model.position.set(0, 0, 0);
      }
      LCCScene.scene.add(model);

      // 静默缺失骨骼的 warn
      var _origWarn = console.warn;
      console.warn = function(msg) {
        if (typeof msg === 'string' && msg.indexOf('No target node found') >= 0) return;
        _origWarn.apply(console, arguments);
      };

      mixer = new THREE.AnimationMixer(model);
      result.animations.forEach(function(clip) {
        var name = clip.name.toLowerCase();
        var action = mixer.clipAction(clip);
        if (name.indexOf('idle') >= 0 || name.indexOf('stand') >= 0) actions.idle = action;
        else if (name.indexOf('walk') >= 0) actions.walk = action;
        else if (name.indexOf('run') >= 0) actions.run = action;
        else if (name.indexOf('jump') >= 0) actions.jump = action;
        else if (!actions.idle && !actions.walk && !actions.run && !actions.jump) { actions.idle = action; }
      });

      resetMotionState();
      playAnim('idle');
      _enabled = true;

      // ★ 注册模型引用到 CameraState（avatar 模式相机跟随用）
      if (typeof CameraState !== 'undefined') {
        CameraState.setModelRef({
          position: model.position,
          height: MODEL_HEIGHT
        });
      }

      console.log('[Player] Model loaded, animations:', Object.keys(actions).join(', '));
    }, function(err) {
      console.error('[Player] Load failed:', err);
    });
  }

  function playAnim(name, fadeIn) {
    if (animLocked && name !== animLocked) return;
    fadeIn = fadeIn || 0.2;
    var next = actions[name];
    if (!next || next === currentAction) return;
    if (currentAction) currentAction.fadeOut(fadeIn);
    next.reset().fadeIn(fadeIn).play();
    currentAction = next;
  }

  // ===================================================================
  // Update（仅模型动画 + 移动 + 跳跃，不碰相机）
  // ===================================================================

  function update(dt) {
    if (!_enabled || !model || !LCCScene) return;
    dt = Math.min(dt, 0.05);

    if (mixer && currentAction) mixer.update(dt);

    // 移动输入：优先使用 InputController 合成后的快照，避免键盘/摇杆
    // 在不同模块里被重复读取后产生方向和松手状态不一致。
    var localX = 0, localZ = 0;
    var snap = (window.__inputCtrl && window.__inputCtrl.snapshot) ? window.__inputCtrl.snapshot : null;
    if (snap) {
      localX = snap.moveX;
      localZ = snap.moveZ;
    } else {
      var mov = LCCKeyboard ? LCCKeyboard.getMovement() : { x: 0, y: 0, z: 0 };
      localX = mov.x;
      localZ = -mov.z;
    }

    var isShift = snap ? snap.sprint : (LCCKeyboard ? LCCKeyboard.isShift() : false);
    var isJump  = snap ? snap.jump   : (LCCKeyboard ? LCCKeyboard.isJump()  : false);

    var moving = Math.abs(localX) > 0.01 || Math.abs(localZ) > 0.01;
    var speed  = isShift ? RUN_SPEED : WALK_SPEED;

    // 相机相对方向 → 世界位移
    var dir = (typeof CameraState !== 'undefined') ? CameraState.getAvatarCameraDir() : null;
    var worldX = 0, worldZ = 0;
    if (dir) {
      worldX = localX * dir.rightX + localZ * dir.forwardX;
      worldZ = localX * dir.rightZ + localZ * dir.forwardZ;
    } else {
      worldX = localX;
      worldZ = localZ;
    }

    // 动画状态机
    if (animLocked !== 'jump') {
      if (moving) {
        // ★ 让模型 +Z 指向移动方向 (worldX, worldZ)
        //   注意 atan2 是 (sin 分量, cos 分量)，Three.js rotation.y 用 (x, z)
        model.rotation.y = Math.atan2(worldX, worldZ);
        playAnim(isShift ? 'run' : 'walk');
      } else {
        playAnim('idle');
      }
    }

    // ===== 垂直物理（先算 groundY，给 sphere 起点用）=====
    var collisionEnabled = (typeof LCCollision !== 'undefined' && LCCollision.isEnabled());
    var realGroundY = null;
    if (collisionEnabled) {
      _groundProbeTimer -= dt;
      var pdx = model.position.x - _lastProbeX;
      var pdz = model.position.z - _lastProbeZ;
      var shouldProbeGround =
        _cachedGroundY === null ||
        _groundProbeTimer <= 0 ||
        (pdx * pdx + pdz * pdz) > GROUND_PROBE_MOVE_DIST_SQ ||
        animLocked === 'jump';

      if (shouldProbeGround) {
      var gY = LCCollision.getGroundHeight({ x: model.position.x, y: model.position.y, z: model.position.z });
      if (gY && typeof gY.groundY === 'number') {
        _cachedGroundY = gY.groundY;
        _lastProbeX = model.position.x;
        _lastProbeZ = model.position.z;
      }
      _groundProbeTimer = moving ? GROUND_PROBE_MOVE_INTERVAL : GROUND_PROBE_IDLE_INTERVAL;
      }
      if (_cachedGroundY !== null) {
        realGroundY = _cachedGroundY;
      }
    }

    // ===== 水平移动 =====
    model.position.x += worldX * speed * dt;
    model.position.z += worldZ * speed * dt;

    // ===== 水平碰撞（d 反推，避免逐轴走不动的死锁）=====
    // ★ 关键：保留"先走再推回"模式，但**d 抖动治理**只取 d 的"方向"部分
    //   - |d| < 0.05：忽略（mesh 边界微漂移）
    //   - |d| > 0.4：截到 0.4（避免 d=1.5 的大跳）
    //   - 中间值：原样用
    //   抖动来源被夹紧后视觉上是稳定的"沿 mesh 滑行"
    if (moving && realGroundY !== null && collisionEnabled) {
      var sp = LCCollision.sphereCheck(
        { x: model.position.x, y: realGroundY + 0.7, z: model.position.z },
        0.4
      );
      if (sp && sp.hit && sp.delta) {
        var sdx = sp.delta.x || 0;
        var sdz = sp.delta.z || 0;
        // 夹紧：< 0.05 忽略，> 0.4 截到 0.4
        if (Math.abs(sdx) < 0.05) sdx = 0;
        else if (Math.abs(sdx) > 0.4) sdx = Math.sign(sdx) * 0.4;
        if (Math.abs(sdz) < 0.05) sdz = 0;
        else if (Math.abs(sdz) > 0.4) sdz = Math.sign(sdz) * 0.4;
        model.position.x += sdx;
        model.position.z += sdz;
      }
    }

    // ===== 垂直物理（getGroundHeight 重新算一次，因为 model.position 可能被 capsule 推过）=====
    if (realGroundY === null && typeof CameraState !== 'undefined') {
      // 碰撞系统无数据时兜底（用 fp 模式 groundLevel，零碎场景）
      realGroundY = CameraState.getGroundLevel();
    }

    // 触发新跳跃（仅在地面上）
    if (isJump && jumpVel === 0 && animLocked !== 'jump' && realGroundY !== null) {
      // ★ 必须脚部已经贴地才能跳（防止空中再次跳跃）
      if (Math.abs(model.position.y - (realGroundY + FOOT_LIFT)) < 0.1) {
        jumpVel = JUMP_FORCE;
        animLocked = 'jump';
        playAnim('jump');
      }
    }
    if (animLocked === 'jump') {
      jumpVel -= GRAVITY * dt;
      model.position.y += jumpVel * dt;
      // ★ 落地条件：用真实地面高度（realGroundY）而不是 groundY
      if (realGroundY !== null && model.position.y <= realGroundY + FOOT_LIFT) {
        model.position.y = realGroundY + FOOT_LIFT;
        jumpVel = 0;
        animLocked = null;
      } else if (realGroundY === null) {
        // 兜底：碰撞系统无数据时按 GROUND_Y 落地
        if (model.position.y <= GROUND_Y + FOOT_LIFT) {
          model.position.y = GROUND_Y + FOOT_LIFT;
          jumpVel = 0;
          animLocked = null;
        }
      }
      // ★ 保险：跳跃超过 1.5 秒强制解锁（防卡死）
      jumpTimeout = (jumpTimeout || 0) + dt;
      if (jumpTimeout > 1.5) {
        animLocked = null;
        jumpTimeout = 0;
      }
    } else {
      jumpTimeout = 0;
      // ★ 非跳跃：保持 model 脚部贴地
      if (realGroundY !== null) {
        model.position.y = realGroundY + FOOT_LIFT;
      } else {
        // 兜底：fp groundLevel
        var fpGL = (typeof CameraState !== 'undefined') ? CameraState.getGroundLevel() : GROUND_Y;
        model.position.y = fpGL + FOOT_LIFT;
      }
    }

    // ★ 相机跟随已移除 → CameraState.animate() 负责
  }

  function isLoaded()  { return model !== null; }
  function isPlaying() { return _enabled; }

  // ===================================================================
  // Export
  // ===================================================================

  window.LCCPlayer = {
    /**
     * 加载模型（如果未加载）
     * 已加载则不做事。
     * 返回 _enabled 状态。
     */
    toggle: function() {
      if (!model) { loadModel(); return true; }
      // 已加载就什么也不做（用 show/hide 控制）
      return _enabled;
    },
    isPlaying: isPlaying,
    isLoaded:  isLoaded,
    loadModel: loadModel,
    update:    update,

    show: function() {
      if (!model) return;
      resetMotionState();
      model.visible = true;
      _enabled = true;
      playAnim('idle', 0.1);
      if (typeof CameraState !== 'undefined') {
        CameraState.setModelRef({ position: model.position, height: MODEL_HEIGHT });
      }
    },
    hide: function() {
      resetMotionState();
      if (model) { model.visible = false; _enabled = false; }
      if (typeof CameraState !== 'undefined') {
        CameraState.setModelRef(null);
      }
    },

    // 旧 API 兼容（不再使用，由 CameraState 内置）
    addOrbitDelta: function() {},
  };
})();
