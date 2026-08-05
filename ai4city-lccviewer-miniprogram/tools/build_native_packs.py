"""Build mini-program-ready SOG textures and predecoded sort coordinates.

The compact WebP textures remain unchanged and are still decoded by the GPU
shader. CPU sort coordinates are decoded and linearly requantized offline,
which removes image readback and nonlinear coordinate decoding on the phone.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image

from build_native_scenes import PROJECT_DIR, SOG_TEXTURES, request_range


DEFAULT_MANIFEST_DIR = PROJECT_DIR / "tools" / "scene-manifests"
DEFAULT_OUTPUT_DIR = PROJECT_DIR / "tools" / "native-packs"
DEFAULT_PUBLIC_BASE = "https://www.ai4dcity.com/lccviewer/data/native-packs/"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def read_sog_entry(descriptor: dict, name: str, attempts: int = 3) -> bytes:
    entry = descriptor["entries"][name]
    last_error = None
    for attempt in range(attempts):
        try:
            payload, _ = request_range(
                descriptor["url"],
                int(entry["offset"]),
                int(entry["length"]),
            )
            if len(payload) != int(entry["length"]):
                raise ValueError(
                    f"{name}: expected {entry['length']} bytes, got {len(payload)}"
                )
            return payload
        except Exception as error:  # noqa: BLE001 - include network failures
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Unable to fetch {descriptor['url']}/{name}") from last_error


def public_url(base: str, scene_id: str, pack_id: str, filename: str) -> str:
    relative = "/".join(
        urllib.parse.quote(part, safe="")
        for part in (scene_id, pack_id, filename)
    )
    return f"{base.rstrip('/')}/{relative}"


def decode_rgb(payload: bytes, name: str) -> tuple[np.ndarray, int, int]:
    with Image.open(io.BytesIO(payload)) as image:
        rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError(f"{name} did not decode as RGB")
    height, width, _ = rgb.shape
    return rgb.reshape((-1, 3)), width, height


def build_pack(
    scene_id: str,
    pack_id: str,
    descriptor: dict,
    output_dir: Path,
    public_base: str,
    force: bool,
) -> dict:
    destination = output_dir / scene_id / pack_id
    destination.mkdir(parents=True, exist_ok=True)
    texture_payloads = {}
    texture_descriptors = {}

    for name in SOG_TEXTURES:
        path = destination / name
        expected_length = int(descriptor["entries"][name]["length"])
        if force or not path.exists() or path.stat().st_size != expected_length:
            write_bytes(path, read_sog_entry(descriptor, name))
        texture_payloads[name] = path.read_bytes() if name.startswith("means_") else None
        texture_descriptors[name] = {
            "url": public_url(public_base, scene_id, pack_id, name),
            "byteLength": path.stat().st_size,
            "sha256": sha256_file(path),
        }

    low, width, height = decode_rgb(texture_payloads["means_l.webp"], "means_l.webp")
    high, high_width, high_height = decode_rgb(
        texture_payloads["means_u.webp"],
        "means_u.webp",
    )
    if (width, height) != (high_width, high_height):
        raise ValueError(
            f"{scene_id}/{pack_id}: means texture dimensions do not match"
        )

    count = int(descriptor["meta"]["count"])
    if count > width * height:
        raise ValueError(
            f"{scene_id}/{pack_id}: {count} points exceed {width}x{height}"
        )
    means_path = destination / "means.bin"
    expected_means_bytes = count * 6
    if force or not means_path.exists() or means_path.stat().st_size != expected_means_bytes:
        packed = np.empty((count, 6), dtype=np.uint8)
        packed[:, :3] = low[:count]
        packed[:, 3:] = high[:count]
        temporary = means_path.with_suffix(".bin.tmp")
        packed.tofile(temporary)
        temporary.replace(means_path)

    source_mins = np.asarray(descriptor["meta"]["means"]["mins"], dtype=np.float64)
    source_maxs = np.asarray(descriptor["meta"]["means"]["maxs"], dtype=np.float64)
    normalized = (
        low[:count].astype(np.float64)
        + high[:count].astype(np.float64) * 256.0
    ) / 65535.0
    encoded = source_mins + (source_maxs - source_mins) * normalized
    decoded = np.sign(encoded) * np.expm1(np.abs(encoded))
    centers = np.empty_like(decoded)
    centers[:, 0] = -decoded[:, 0]
    centers[:, 1] = decoded[:, 2]
    centers[:, 2] = decoded[:, 1]
    center_mins = centers.min(axis=0)
    center_maxs = centers.max(axis=0)
    center_spans = center_maxs - center_mins
    safe_spans = np.where(center_spans > 0, center_spans, 1.0)
    quantized_centers = np.rint(
        np.clip((centers - center_mins) / safe_spans, 0.0, 1.0) * 65535.0
    ).astype("<u2")
    centers_path = destination / "centers.bin"
    expected_centers_bytes = count * 6
    if (
        force
        or not centers_path.exists()
        or centers_path.stat().st_size != expected_centers_bytes
    ):
        temporary = centers_path.with_suffix(".bin.tmp")
        quantized_centers.tofile(temporary)
        temporary.replace(centers_path)

    pack = {
        "version": 2,
        "count": count,
        "width": width,
        "height": height,
        "textures": texture_descriptors,
        "means": {
            "url": public_url(public_base, scene_id, pack_id, "means.bin"),
            "byteLength": means_path.stat().st_size,
            "sha256": sha256_file(means_path),
        },
        "sortCenters": {
            "format": "uint16x3-linear",
            "url": public_url(public_base, scene_id, pack_id, "centers.bin"),
            "byteLength": centers_path.stat().st_size,
            "mins": center_mins.tolist(),
            "maxs": center_maxs.tolist(),
            "sha256": sha256_file(centers_path),
        },
    }
    write_bytes(
        destination / "pack.json",
        json.dumps(pack, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
    )
    return pack


def descriptor_items(scene: dict):
    yield "root", scene["sog"]
    for file_id, descriptor in sorted(
        scene.get("nearLod", {}).get("sogs", {}).items(),
        key=lambda item: int(item[0]),
    ):
        yield str(file_id), descriptor


def build_scene_packs(
    manifest_path: Path,
    output_dir: Path,
    public_base: str,
    force: bool,
    max_packs: int | None,
    jobs: int,
) -> int:
    scene = json.loads(manifest_path.read_text(encoding="utf-8"))
    scene_id = scene["id"]
    items = list(descriptor_items(scene))
    if max_packs is not None:
        items = items[:max_packs]
    total = len(items)
    results = {}

    def run(position: int, item: tuple[str, dict]) -> tuple[str, dict]:
        pack_id, descriptor = item
        print(f"[{scene_id}] {position}/{total}: {pack_id}", flush=True)
        return pack_id, build_pack(
            scene_id,
            pack_id,
            descriptor,
            output_dir,
            public_base,
            force,
        )

    with ThreadPoolExecutor(max_workers=max(1, jobs)) as executor:
        pending = [
            executor.submit(run, position, item)
            for position, item in enumerate(items, start=1)
        ]
        for future in as_completed(pending):
            pack_id, pack = future.result()
            results[pack_id] = pack

    for pack_id, descriptor in descriptor_items(scene):
        if pack_id in results:
            descriptor["nativePack"] = results[pack_id]

    temporary = manifest_path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(scene, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(manifest_path)
    return len(results)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest-dir",
        type=Path,
        default=DEFAULT_MANIFEST_DIR,
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
    )
    parser.add_argument(
        "--public-base",
        default=DEFAULT_PUBLIC_BASE,
    )
    parser.add_argument(
        "--scene",
        action="append",
        help="Scene id to build. Repeat the option for multiple scenes.",
    )
    parser.add_argument(
        "--max-packs",
        type=int,
        default=None,
        help="Build at most this many packs per scene (useful for a smoke test).",
    )
    parser.add_argument(
        "--jobs",
        type=int,
        default=4,
        help="Number of packs to build concurrently.",
    )
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    requested = set(args.scene or [])
    manifests = sorted(args.manifest_dir.glob("*.json"))
    if requested:
        manifests = [path for path in manifests if path.stem in requested]
    missing = requested - {path.stem for path in manifests}
    if missing:
        raise SystemExit(f"Missing manifests: {', '.join(sorted(missing))}")
    if not manifests:
        raise SystemExit("No scene manifests found")

    total = 0
    for manifest in manifests:
        total += build_scene_packs(
            manifest,
            args.output_dir,
            args.public_base,
            args.force,
            args.max_packs,
            args.jobs,
        )
    print(f"Built {total} native packs in {args.output_dir}")


if __name__ == "__main__":
    main()
