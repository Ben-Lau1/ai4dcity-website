import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const workspaceDir = resolve(projectDir, '..');
const templatePath = resolve(scriptDir, 'three-r164-adapter.template.js');
const threePath = resolve(workspaceDir, 'ai4city-website/public/lccviewer/libs/three.cjs');
const lccPath = resolve(workspaceDir, 'ai4city-website/public/lccviewer/libs/lcc-0.6.1.umd.js');
const threeOutput = resolve(projectDir, 'vendor/three-r164-miniprogram.js');
const lccOutput = resolve(projectDir, 'native/vendor/lcc-0.6.1-native.js');
const cpuSortWorkerOutput = resolve(projectDir, 'workers/lcc-cpu-sort.js');
const bvhWorkerOutput = resolve(projectDir, 'workers/lcc-bvh.js');
const modernSortWorkerOutput = resolve(projectDir, 'workers/lcc-modern-sort.js');

const [template, threeSource, lccSource] = await Promise.all([
  readFile(templatePath, 'utf8'),
  readFile(threePath, 'utf8'),
  readFile(lccPath, 'utf8'),
]);

if (!template.includes('__THREE_CJS__')) {
  throw new Error('Three adapter template token is missing.');
}

const workerConfigMatches = lccSource.match(/isUseWorker:!0/g) || [];
if (workerConfigMatches.length !== 2) {
  throw new Error(`Expected 2 LCC worker flags, found ${workerConfigMatches.length}.`);
}

const lccFactoryMarker = '}(this,function(t){';
if (!lccSource.includes(lccFactoryMarker)) {
  throw new Error('LCC UMD factory marker is missing.');
}

function replaceExactlyOnce(source, search, replacement, label) {
  const firstIndex = source.indexOf(search);
  const lastIndex = source.lastIndexOf(search);
  if (firstIndex < 0 || firstIndex !== lastIndex) {
    throw new Error(`Expected exactly one ${label}.`);
  }
  return source.replace(search, replacement);
}

function replaceExpected(source, search, replacement, expectedCount, label) {
  const count = source.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} ${label}, found ${count}.`);
  }
  return source.split(search).join(replacement);
}

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker}.`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated ${marker}.`);
}

function createMiniProgramWorker(functionSource, functionName) {
  const workerFunction = replaceExactlyOnce(
    functionSource,
    'self.onmessage=',
    'lccScope.onmessage=',
    `${functionName} worker message handler`,
  );
  return `'use strict';\n\nconst lccScope = { onmessage: null };\n\nfunction postMessage(message) {\n  worker.postMessage(message);\n}\n\n${workerFunction}\n\n${functionName}(lccScope);\nworker.onMessage((data) => {\n  if (typeof lccScope.onmessage === 'function') {\n    lccScope.onmessage({ data });\n  }\n});\n`;
}

const workerFactorySource = 'var le=function(t,e="application/javascript"){const i=`onmessage=${String(t)}`,s=URL.createObjectURL(new Blob([i],{type:e}));return new Worker(s)},ce=function(t){return new Worker(URL.createObjectURL(new Blob(["(",t.toString(),")(self)"],{type:"application/javascript"})))}';
const inlineWorkerFactorySource = 'var le=function(t){return globalThis.__createLccWorker(t,!0)},ce=function(t,e){return globalThis.__createLccWorker(t,!1,e)}';
const cpuWorkerInitializer = 'function co(t){const e=new Int32Array(1e5);self.onmessage=';
const inlineCpuWorkerInitializer = 'function co(scope){const e=new Int32Array(1e5);scope.onmessage=';
const bvhWorkerFunction = 'function Ed(){const t=Math.pow(2,-24)';
const inlineBvhWorkerFunction = 'function Ed(scope){const t=Math.pow(2,-24)';
const bvhWorkerHandler = '}self.onmessage=t=>{const e=t.data.index';
const inlineBvhWorkerHandler = '}scope.onmessage=t=>{const e=t.data.index';
const swallowedFetchError = '.catch(()=>{r()})}catch(h){r()}';
const forwardedFetchError = '.catch(t=>{r(t)})}catch(h){r(h)}';
const swallowedMetaError = 'console.log("load file failed: "+r,"   error: "+t),i?.()';
const forwardedMetaError = 'console.log("load file failed: "+r,"   error: "+t),i?.(t)';
const rendererConfigGetter = 'getCurrentConfig(){return Rt(IT,this).getUserConfig()}';
const rendererDebugGetter = `${rendererConfigGetter}getDebugInfo(){const t=Rt(sF,this)?.getCurState(),e=Rt(oF,this),i=Rt(eF,this),s=Rt(pF,this),n=Rt(BT,this).performance2;return{metaReady:Rt(UT,this),loadComplete:Rt(jT,this),initPercent:e?.initPercent??-1,firstDataReady:!!e?.isFirstDataReady,rootChildren:Rt(RT,this)?.children?.length||0,rootVisible:Rt(RT,this)?.visible!==!1,drawReady:!!i?.isReady,uploadComplete:!!s?.isUploadComplete,sortReady:!!Rt(tF,this)?.isReady(),currentSplats:t?.splatCount||0,indexCount:t?.indexes?.length||0,collectionCount:t?.collections?.length||0,renderListCount:e?.getRenderList?.()?.length||0,totalPoints:n?.totalPoints||0,assetNum:n?.assetNum||0,nodeNum:n?.nodeNum||0}}`;
const copyOutputDeclaration = 'layout(location = 1) out uvec4 pc_fragColor1;';
const integerCopyOutputDeclarations = 'layout(location = 0) out uvec4 pc_fragColor;\\n    layout(location = 1) out uvec4 pc_fragColor1;';
const floatCopyAssignment = 'pc_fragColor = vec4(sampledTransform.x, sampledTransform.y, sampledTransform.z, \\n                            uintBitsToFloat(quatPack));';
const integerCopyAssignment = 'pc_fragColor = uvec4(floatBitsToUint(sampledTransform.x), floatBitsToUint(sampledTransform.y), \\n                            floatBitsToUint(sampledTransform.z), quatPack);';
const globalBasicSamplers = 'uniform highp sampler2D texBasic0;\\n    uniform highp usampler2D texBasic1;';
const integerGlobalBasicSamplers = 'uniform highp usampler2D texBasic0;\\n    uniform highp usampler2D texBasic1;';
const globalBasicDeclarations = 'vec4 basic0;\\n    uvec4 basic1;';
const integerGlobalBasicDeclarations = 'uvec4 basic0;\\n    uvec4 basic1;';
const globalCenterGetter = 'vec3 getCenter() {\\n        return basic0.xyz;\\n    }\\n        \\n    #if 1   // def LCC_OPT_COV';
const integerGlobalCenterGetter = 'vec3 getCenter() {\\n        return uintBitsToFloat(basic0.xyz);\\n    }\\n        \\n    #if 1   // def LCC_OPT_COV';
const globalPackedQuaternion = 'parseQuat(floatBitsToUint(basic0.w))';
const integerGlobalPackedQuaternion = 'parseQuat(basic0.w)';
const sogCopyMaterial = 'fragmentShader:jF(HF).copyShaderFrag,transparent:!1';
const integerSogCopyMaterial = 'fragmentShader:jF(HF).copyShaderFrag,glslVersion:Rt(KF,this).GLSL3,transparent:!1';
const spzCopyMaterial = 'fragmentShader:VF(HF).copySpzShaderFrag,transparent:!1';
const integerSpzCopyMaterial = 'fragmentShader:VF(HF).copySpzShaderFrag,glslVersion:Rt(KF,this).GLSL3,transparent:!1';
const floatBasicRenderTarget = 'Rt(_v,this).textures[0].format=Rt(bv,this).RGBAFormat,Rt(_v,this).textures[0].type=Rt(bv,this).FloatType,Rt(_v,this).textures[0].internalFormat="RGBA32F"';
const integerBasicRenderTarget = 'Rt(_v,this).textures[0].format=Rt(bv,this).RGBAIntegerFormat,Rt(_v,this).textures[0].type=Rt(bv,this).UnsignedIntType,Rt(_v,this).textures[0].internalFormat="RGBA32UI"';
const cpuSortFunction = extractFunction(lccSource, 'function co(t)');
const bvhFunction = extractFunction(lccSource, 'function Ed()');
const decompressorFunction = extractFunction(lccSource, 'function Oy(t)');
const modernSortFunction = extractFunction(lccSource, 'function Xx(t)');
const copyAwareModernSortFunction = replaceExactlyOnce(
  replaceExactlyOnce(
    replaceExactlyOnce(
      modernSortFunction,
      'let i=new Int32Array(1e5),s=new Int32Array(1e6);',
      'let i=new Int32Array(1e5),s=new Int32Array(1e6),f=new Int32Array(0);',
      'modern sorter persistent output buffer',
    ),
    'c=new Int32Array(t.data.idArrayBuffer),u=t.data.indexesBuffer,d=t.data.intervalsArray||[];let f;if(u&&u.byteLength>=4*o)f=new Int32Array(u);else{const t=Math.max(2e6,Math.ceil(.5*o));f=new Int32Array(o+t)}',
    'c=new Int32Array(t.data.idArrayBuffer),d=t.data.intervalsArray||[];f.length!==o&&(f=new Int32Array(o));',
    'modern sorter exact output buffer',
  ),
  'for(let e=t;e>=0;--e)',
  'for(let e=t-1;e>=0;--e)',
  'modern depth sorter output bounds',
);
const inlineDecompressorFunction = decompressorFunction
  .replace('function Oy(t)', 'function Oy(scope)')
  .replace('self.onmessage=', 'scope.onmessage=')
  .split('postMessage(')
  .join('scope.postMessage(');
const inlineModernSortFunction = copyAwareModernSortFunction
  .replace('function Xx(t)', 'function Xx(scope)')
  .replace('self.onmessage=', 'scope.onmessage=')
  .split('postMessage(')
  .join('scope.postMessage(');
const cpuSortWorker = createMiniProgramWorker(cpuSortFunction, 'co');
const bvhWorker = createMiniProgramWorker(bvhFunction, 'Ed');
const modernSortWorker = createMiniProgramWorker(copyAwareModernSortFunction, 'Xx');

const browserBindings = [
  'window',
  'document',
  'navigator',
  'location',
  'screen',
  'localStorage',
  'fetch',
  'Request',
  'Response',
  'URL',
  'URLSearchParams',
  'performance',
  'Image',
  'ImageBitmap',
  'Blob',
  'OffscreenCanvas',
  'createImageBitmap',
  'DecompressionStream',
  'TextDecoder',
  'TextEncoder',
  'atob',
  'btoa',
  'self',
  'global',
  'indexedDB',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'CustomEvent',
  'postMessage',
].map((name) => `${name}=globalThis.${name}`).join(',');

const threeAdapter = template.replace('__THREE_CJS__', () => threeSource);
let nativeLcc = lccSource
  .replace(lccFactoryMarker, `${lccFactoryMarker}var ${browserBindings};`)
  .replace(/isUseWorker:!0/g, 'isUseWorker:!1')
  .replace('isUseWorker:r=!0', 'isUseWorker:r=!1');
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  workerFactorySource,
  inlineWorkerFactorySource,
  'LCC worker factory',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  decompressorFunction,
  inlineDecompressorFunction,
  'asynchronous SOG decompressor worker',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  modernSortFunction,
  inlineModernSortFunction,
  'modern splat sorting worker',
);
nativeLcc = replaceExactlyOnce(nativeLcc, 'ce(co)', 'ce(co,"cpu-sort")', 'CPU worker call');
nativeLcc = replaceExactlyOnce(nativeLcc, 'ce(Ed)', 'ce(Ed,"bvh")', 'BVH worker call');
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  'ce(Xx)',
  'ce(Xx,"modern-sort")',
  'modern sorting worker call',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  cpuWorkerInitializer,
  inlineCpuWorkerInitializer,
  'CPU sorting worker initializer',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  bvhWorkerFunction,
  inlineBvhWorkerFunction,
  'BVH worker function',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  bvhWorkerHandler,
  inlineBvhWorkerHandler,
  'BVH worker message handler',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  swallowedFetchError,
  forwardedFetchError,
  'swallowed fetch error',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  swallowedMetaError,
  forwardedMetaError,
  'swallowed metadata error',
);
nativeLcc = replaceExpected(
  nativeLcc,
  'r.failureFunc=()=>{s&&s()}',
  'r.failureFunc=t=>{s&&s(t)}',
  2,
  'renderer failure callbacks',
);
nativeLcc = replaceExpected(
  nativeLcc,
  '()=>{n&&ot(n)}',
  't=>{n&&ot(n,t)}',
  2,
  'metadata failure relays',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  'this.useCollision=!0,!t)return;',
  'this.useCollision=!1,!t)return;',
  'native collision default',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  'this.CollBuildThreadNum=1,this.DecompressThreadNum=2',
  'this.CollBuildThreadNum=0,this.DecompressThreadNum=2',
  'mobile collision worker count',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  'this.maxLoadSplatCount=1e6,this.MaxLodDistance=30,this.LodLevelUpSpatsInNode=5e5,this.CpuSortThreadNum=2',
  'this.maxLoadSplatCount=5e5,this.MaxLodDistance=30,this.LodLevelUpSpatsInNode=2e5,this.CpuSortThreadNum=1',
  'mobile first-frame limits',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  rendererConfigGetter,
  rendererDebugGetter,
  'native renderer debug getter',
);
nativeLcc = replaceExpected(
  nativeLcc,
  copyOutputDeclaration,
  integerCopyOutputDeclarations,
  2,
  'copy shader integer outputs',
);
nativeLcc = replaceExpected(
  nativeLcc,
  floatCopyAssignment,
  integerCopyAssignment,
  2,
  'copy shader integer center writes',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  globalBasicSamplers,
  integerGlobalBasicSamplers,
  'global integer basic sampler',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  globalBasicDeclarations,
  integerGlobalBasicDeclarations,
  'global integer basic declaration',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  globalCenterGetter,
  integerGlobalCenterGetter,
  'global integer center decode',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  globalPackedQuaternion,
  integerGlobalPackedQuaternion,
  'global integer quaternion decode',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  sogCopyMaterial,
  integerSogCopyMaterial,
  'SOG integer copy material',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  spzCopyMaterial,
  integerSpzCopyMaterial,
  'SPZ integer copy material',
);
nativeLcc = replaceExactlyOnce(
  nativeLcc,
  floatBasicRenderTarget,
  integerBasicRenderTarget,
  'integer basic render target',
);

await Promise.all([
  mkdir(dirname(threeOutput), { recursive: true }),
  mkdir(dirname(lccOutput), { recursive: true }),
  mkdir(dirname(cpuSortWorkerOutput), { recursive: true }),
]);
await Promise.all([
  writeFile(threeOutput, threeAdapter),
  writeFile(lccOutput, nativeLcc),
  writeFile(cpuSortWorkerOutput, cpuSortWorker),
  writeFile(bvhWorkerOutput, bvhWorker),
  writeFile(modernSortWorkerOutput, modernSortWorker),
]);

console.log(`Generated ${threeOutput}`);
console.log(`Generated ${lccOutput}`);
console.log(`Generated ${cpuSortWorkerOutput}`);
console.log(`Generated ${bvhWorkerOutput}`);
console.log(`Generated ${modernSortWorkerOutput}`);
