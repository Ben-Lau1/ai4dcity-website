# AI4DCity LCCViewer Mini Program

This project is a native WeChat Mini Program prototype for rendering LCC2 data.
The earlier H5 `web-view` page is retained only as a fallback reference.

## Native Prototype

- Canvas-based Three.js r164 adapter
- LCC Web SDK 0.6.1 compatibility layer with WeChat's experimental Worker for CPU sorting
- One-finger rotation and two-finger zoom
- Free, first-person, and third-person camera presets
- Remote LCC2 scene loaded from `https://www.ai4dcity.com`

The Three.js adapter is in the main package. The LCC runtime and viewer page are
in the `native` subpackage so each package remains below WeChat's 2 MB limit.
The first frame is limited to 400,000 splats and then refines to the Web viewer's
700,000-splat performance preset. Collision BVH generation is disabled because
the current viewer does not use collision queries.

## Build

Regenerate the adapted vendor files after changing the adapter template or the
source H5 libraries:

```powershell
node scripts\build-native-vendor.mjs
```

Open this directory in WeChat DevTools and select the `原生验证` compile mode.

## Current Verification

The desktop simulator reaches the native Canvas page, but its Canvas runtime
reports WebGL 1.0 and rejects `getContext('webgl2')`. LCC2 and Three.js r164 need
WebGL2 APIs such as `texImage3D`, so the remaining compatibility test must run on
a physical phone. The page displays an explicit diagnostic instead of treating
this simulator limitation as a data-loading error.

## Real-device Requirements

1. Replace `touristappid` in `project.config.json` with the registered Mini
   Program AppID and sign in to WeChat DevTools with an authorized developer.
2. Add `https://www.ai4dcity.com` to the Mini Program request and download-file
   server domains. A `web-view` business domain is not required by this native
   route.
3. Preview or debug on at least one recent Android phone and one iPhone, then
   confirm the reported context is WebGL2 before testing the LCC2 loader.
4. Only after the one-scene loader succeeds, finish production tuning for the
   three camera modes, touch sensitivity, memory use, and scene switching.
