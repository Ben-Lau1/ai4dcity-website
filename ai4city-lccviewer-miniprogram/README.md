# AI4DCity LCCViewer Mini Program

This is the native WeChat Mini Program implementation of LCCViewer. The H5
viewer remains the behavioral and rendering reference, but it is not embedded
with `web-view`.

## Runtime layout

- `native-v2/index`: main-package entry and WebGL2 viewer
- `native-v2/runtime`: renderer, LOD, sorting, collision, and playback runtime
- `workers/native-splat-sort.js`: stable radial splat sorting worker
- `tools/scene-manifests`: generated spatial LOD manifests

The default renderer matches the H5 data path: it uploads compressed SOG
textures once and decodes Gaussian attributes in the vertex shader. Camera
sorting only replaces an `R32UI` index texture; it does not rebuild Gaussian
attributes. A full-precision predecoded GPU cache remains available as an
explicit diagnostic path, but is disabled by default because mobile tile-based
GPUs can be slower when reading its expanded 40-byte records.

Near detail uses screen-space error, a forward prefetch window, and a
desired/staged/committed LOD protocol. Base, detail, and finer index textures are
committed together after every participant is ready, so the previous complete
view remains visible during background loading.

## Scene data

The package contains scene metadata only. SOG payloads and generated manifests
are served from:

```text
https://www.ai4dcity.com/lccviewer/data/
```

Rebuild local manifests from the LCC2 exports on `F:\`:

```powershell
python tools\build_scene_trajectories.py
python tools\build_native_scenes.py
```

The manifest builder validates source ranges and emits schema version 2 bounds
for depth-5 and depth-6 LOD selections.

Build the optional native transport packs after generating the manifests:

```powershell
python tools\build_native_packs.py
```

Each pack keeps the original compact WebP GPU textures and adds a 6-byte/point
`means.bin` used by the sort worker. On device, `wx.downloadFile` hands the
textures directly to Canvas image decoding and the packed means bypass the
second Canvas2D decode/readback pass. If the download-file domain is not
configured or a pack is unavailable, the runtime automatically falls back to
the original ranged SOG path and still attempts to use the prepacked means.

## Verification

Run static and contract tests:

```powershell
node --test tests/*.test.js
```

Run the browser WebGL2 pixel smoke test:

```powershell
node tools/webgl-smoke-server.js
```

Then open `http://127.0.0.1:8791/tools/webgl-smoke.html`. A passing run compares
the source decoder and predecoded fast path and requires a mean RGB delta below
the configured tolerance.

## Real-device test

Open this directory in WeChat DevTools with AppID
`wxbad82ea1621498bf`, compile `native-v2/index/index`, and preview on a physical
phone. The desktop simulator may expose WebGL 1 and cannot validate this
renderer.

Before uploading a release, verify:

1. Initial loading reaches the scene without a black frame.
2. Pure camera rotation does not start a new sort.
3. Walking across an LOD boundary does not expose a hole or a one-frame stall.
4. All quality levels change the root/detail sample counts.
5. Free, first-person, third-person, playback, collision, and scene switching
   still work.
