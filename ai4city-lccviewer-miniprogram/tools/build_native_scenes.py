"""Build compact native scene manifests from remote LCC2/SOG assets."""

from __future__ import annotations

import json
import os
import struct
import tempfile
import urllib.parse
import urllib.request
import zipfile
import zlib
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
OUTPUT_PATH = PROJECT_DIR / "native-v2" / "scenes" / "generated.js"
MANIFEST_OUTPUT_DIR = PROJECT_DIR / "tools" / "scene-manifests"
MANIFEST_PUBLIC_BASE = "https://www.ai4dcity.com/lccviewer/data/manifests/"
CACHE_DIR = Path(tempfile.gettempdir()) / "lccviewer-native-scenes"
SOURCE_ROOT = Path(os.environ.get("LCCVIEWER_SCENE_SOURCE_ROOT", "F:/"))
TRAJECTORY_DIR = PROJECT_DIR / "tools" / "scene-paths"

SCENES = [
    {
        "id": "KPJ-08-4",
        "label": "五园连通",
        "lcc2": "https://www.ai4dcity.com/lccviewer/data/KPJ-08-4/%E4%BA%94%E5%9B%AD%E8%BF%9E%E9%80%9A-4.lcc2",
        "trajectory": "https://www.ai4dcity.com/lccviewer/data/path/KPJ-08-4_path.json",
    },
    {
        "id": "KPJ-05-2",
        "label": "大学城",
        "lcc2": "https://www.ai4dcity.com/lccviewer/data/KPJ-05-2/KPJ-05-2.lcc2",
        "trajectory": "https://www.ai4dcity.com/lccviewer/data/path/KPJ-05-2_path.json",
    },
    {
        "id": "RCGY",
        "label": "人才公园",
        "lcc2": "https://www.ai4dcity.com/lccviewer/data/RCGY/render2/%E4%BA%BA%E6%89%8D%E5%85%AC%E5%9B%AD.lcc2",
        "source_lcc2": SOURCE_ROOT / "人才公园" / "render2" / "人才公园.lcc2",
        "trajectory": "https://www.ai4dcity.com/lccviewer/data/path/RCGY_path.json",
        "source_trajectory": TRAJECTORY_DIR / "RCGY_path.json",
    },
    {
        "id": "DSH-NQCG-1",
        "label": "大沙河至氮气茶馆 1",
        "lcc2": "https://www.ai4dcity.com/lccviewer/data/DSH-NQCG-1/render2/%E5%A4%A7%E6%B2%99%E6%B2%B3-%E6%B0%AE%E6%B0%94%E8%8C%B6%E9%A6%86-1.lcc2",
        "source_lcc2": SOURCE_ROOT / "大沙河至氮气茶馆1" / "render2" / "大沙河-氮气茶馆-1.lcc2",
        "trajectory": "https://www.ai4dcity.com/lccviewer/data/path/DSH-NQCG-1_path.json",
        "source_trajectory": TRAJECTORY_DIR / "DSH-NQCG-1_path.json",
    },
    {
        "id": "DSH-NQCG-2",
        "label": "大沙河至氮气茶馆 2",
        "lcc2": "https://www.ai4dcity.com/lccviewer/data/DSH-NQCG-2/render2/%E5%A4%A7%E6%B2%99%E6%B2%B3-%E6%B0%AE%E6%B0%94%E8%8C%B6%E9%A6%86-2.lcc2",
        "source_lcc2": SOURCE_ROOT / "大沙河至氮气茶馆2" / "render2" / "大沙河-氮气茶馆-2.lcc2",
        "trajectory": "https://www.ai4dcity.com/lccviewer/data/path/DSH-NQCG-2_path.json",
        "source_trajectory": TRAJECTORY_DIR / "DSH-NQCG-2_path.json",
    },
    {
        "id": "KPJ-06",
        "label": "鲲鹏径第 6 段",
        "lcc2": "https://www.ai4dcity.com/lccviewer/data/KPJ-06/render2/%E9%B2%B2%E9%B9%8F%E5%BE%84%E7%AC%AC6%E6%AE%B5.lcc2",
        "source_lcc2": SOURCE_ROOT / "鲲鹏径第6段" / "output" / "render2" / "鲲鹏径第6段.lcc2",
        "trajectory": "https://www.ai4dcity.com/lccviewer/data/path/KPJ-06_path.json",
        "source_trajectory": TRAJECTORY_DIR / "KPJ-06_path.json",
    },
]

SOG_TEXTURES = ("means_l.webp", "means_u.webp", "quats.webp", "scales.webp", "sh0.webp")
ZIP_TAIL_SIZE = 65557


def download(location: str | Path, cache_name: str) -> Path:
    source_path = Path(location)
    if source_path.exists():
        return source_path
    url = str(location)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    destination = CACHE_DIR / cache_name
    if destination.exists() and destination.stat().st_size:
        return destination
    request = urllib.request.Request(url, headers={"User-Agent": "LCCViewer-Native-Builder/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        destination.write_bytes(response.read())
    return destination


def first_lod_file_index(metadata: dict) -> int:
    names = set()
    for child in metadata["root"].get("child", {}).values():
        data = child.get("data", {}).get("3dgs")
        if data:
            names.add(int(data["name"]))
    if len(names) != 1:
        raise ValueError(f"Expected one first-LOD SOG, found indexes {sorted(names)}")
    return names.pop()


def zip_data_offset(handle, info: zipfile.ZipInfo) -> int:
    handle.seek(info.header_offset)
    header = handle.read(30)
    fields = struct.unpack("<IHHHHHIIIHH", header)
    if fields[0] != 0x04034B50:
        raise ValueError(f"Bad ZIP local header for {info.filename}")
    return info.header_offset + 30 + fields[9] + fields[10]


def request_range(url: str, offset: int, length: int) -> tuple[bytes, str | None]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept-Encoding": "identity",
            "Range": f"bytes={offset}-{offset + length - 1}",
            "User-Agent": "LCCViewer-Native-Builder/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = response.read()
        status = getattr(response, "status", response.getcode())
        content_range = response.headers.get("Content-Range")
    if status == 206:
        if len(payload) != length:
            raise ValueError(f"Range length mismatch for {url}: expected {length}, got {len(payload)}")
        return payload, content_range
    if status == 200 and len(payload) >= offset + length:
        return payload[offset:offset + length], content_range
    if status == 200 and offset == 0 and len(payload) == length:
        return payload, content_range
    raise ValueError(f"Server did not honor byte range for {url} ({status}, {len(payload)} bytes)")


def remote_file_size(url: str) -> int:
    _, content_range = request_range(url, 0, 1)
    if not content_range or "/" not in content_range:
        raise ValueError(f"Missing Content-Range size for {url}")
    return int(content_range.rsplit("/", 1)[1])


def remote_zip_entries(url: str) -> dict[str, dict]:
    file_size = remote_file_size(url)
    tail_offset = max(0, file_size - ZIP_TAIL_SIZE)
    tail, _ = request_range(url, tail_offset, file_size - tail_offset)
    eocd_offset = tail.rfind(b"PK\x05\x06")
    if eocd_offset < 0 or eocd_offset + 22 > len(tail):
        raise ValueError(f"ZIP end record not found for {url}")
    eocd = struct.unpack_from("<IHHHHIIH", tail, eocd_offset)
    central_size = int(eocd[5])
    central_offset = int(eocd[6])
    central, _ = request_range(url, central_offset, central_size)
    entries = {}
    cursor = 0
    while cursor + 46 <= len(central):
        if central[cursor:cursor + 4] != b"PK\x01\x02":
            raise ValueError(f"Bad ZIP central directory entry for {url} at {cursor}")
        compression = struct.unpack_from("<H", central, cursor + 10)[0]
        compressed_size = struct.unpack_from("<I", central, cursor + 20)[0]
        uncompressed_size = struct.unpack_from("<I", central, cursor + 24)[0]
        name_length = struct.unpack_from("<H", central, cursor + 28)[0]
        extra_length = struct.unpack_from("<H", central, cursor + 30)[0]
        comment_length = struct.unpack_from("<H", central, cursor + 32)[0]
        header_offset = struct.unpack_from("<I", central, cursor + 42)[0]
        name_start = cursor + 46
        name = central[name_start:name_start + name_length].decode("utf-8")
        local_header, _ = request_range(url, header_offset, 30)
        if local_header[:4] != b"PK\x03\x04":
            raise ValueError(f"Bad ZIP local header for {url}/{name}")
        local_name_length = struct.unpack_from("<H", local_header, 26)[0]
        local_extra_length = struct.unpack_from("<H", local_header, 28)[0]
        entries[name] = {
            "compression": compression,
            "compressed_size": compressed_size,
            "file_size": uncompressed_size,
            "offset": header_offset + 30 + local_name_length + local_extra_length,
        }
        cursor += 46 + name_length + extra_length + comment_length
    return entries


def read_remote_zip_entry(url: str, entry: dict) -> bytes:
    payload, _ = request_range(url, int(entry["offset"]), int(entry["compressed_size"]))
    compression = int(entry["compression"])
    if compression == zipfile.ZIP_STORED:
        return payload
    if compression == zipfile.ZIP_DEFLATED:
        return zlib.decompress(payload, -zlib.MAX_WBITS)
    raise ValueError(f"Unsupported ZIP compression method {compression} for {url}")


def transform_point(point: dict) -> list[float]:
    return [-float(point["x"]), float(point["z"]), float(point["y"])]


def transform_bounds(bounds: dict) -> dict:
    minimum = bounds["min"]
    maximum = bounds["max"]
    return {
        "min": [-float(maximum[0]), float(minimum[2]), float(minimum[1])],
        "max": [-float(minimum[0]), float(maximum[2]), float(maximum[1])],
    }


def union_bounds(bounds_items: list[dict]) -> dict:
    if not bounds_items:
        raise ValueError("Cannot union an empty bounds list")
    return {
        "min": [
            min(bounds["min"][axis] for bounds in bounds_items)
            for axis in range(3)
        ],
        "max": [
            max(bounds["max"][axis] for bounds in bounds_items)
            for axis in range(3)
        ],
    }


def bounds_contains(parent: dict, child: dict, epsilon: float = 1e-4) -> bool:
    return all(
        parent["min"][axis] - epsilon <= child["min"][axis]
        and parent["max"][axis] + epsilon >= child["max"][axis]
        for axis in range(3)
    )


def build_sog_descriptor(
    scene_id: str,
    file_index: int,
    url: str,
    local_path: Path | None = None,
) -> dict:
    cache_path = CACHE_DIR / f"{scene_id}-lod-file-{file_index}.sog"
    archive_path = local_path if local_path and local_path.exists() else cache_path
    entries = {}
    if archive_path.exists() and archive_path.stat().st_size:
        with archive_path.open("rb") as raw, zipfile.ZipFile(raw) as archive:
            infos = {info.filename: info for info in archive.infolist()}
            sog_meta = json.loads(archive.read("meta.json"))
            for name in SOG_TEXTURES:
                info = infos[name]
                if info.compress_type != zipfile.ZIP_STORED:
                    raise ValueError(f"{scene_id}/{name} must be stored without ZIP compression")
                entries[name] = {
                    "offset": zip_data_offset(raw, info),
                    "length": info.file_size,
                }
    else:
        infos = remote_zip_entries(url)
        sog_meta = json.loads(read_remote_zip_entry(url, infos["meta.json"]))
        for name in SOG_TEXTURES:
            info = infos[name]
            if info["compression"] != zipfile.ZIP_STORED:
                raise ValueError(f"{scene_id}/{name} must be stored without ZIP compression")
            entries[name] = {
                "offset": int(info["offset"]),
                "length": int(info["file_size"]),
            }
    return {
        "url": url,
        "byteLength": archive_path.stat().st_size if archive_path.exists() else remote_file_size(url),
        "entries": entries,
        "meta": sog_meta,
    }


def build_near_lod(
    metadata: dict,
    lcc_url: str,
    scene_id: str,
    local_root: Path | None = None,
    cached_sogs: dict | None = None,
) -> dict:
    root = metadata["root"]
    nodes = []
    detail_file_indexes = set()
    for root_child in root.get("child", {}).values():
        base = root_child.get("data", {}).get("3dgs")
        frontier = [root_child]
        # Depth 5 is the first streamed replacement and depth 6 is its near
        # refinement. The old depth-4 replacement was visibly softer than H5.
        for _ in range(4):
            next_frontier = []
            expanded = False
            for node in frontier:
                descendants = list(node.get("child", {}).values())
                if descendants:
                    next_frontier.extend(descendants)
                    expanded = True
                else:
                    next_frontier.append(node)
            if not expanded:
                break
            frontier = next_frontier
        detail = []
        for descendant in frontier:
            data = descendant.get("data", {}).get("3dgs")
            if data:
                compact = {
                    "id": descendant["id"],
                    "bounds": transform_bounds(descendant["boundingBox"]),
                    "file": int(data["name"]),
                    "start": int(data["start"]),
                    "count": int(data["count"]),
                    "finer": [],
                }
                for fine_child in descendant.get("child", {}).values():
                    child_data = fine_child.get("data", {}).get("3dgs")
                    if not child_data:
                        continue
                    finer = {
                        "id": fine_child["id"],
                        "level": 6,
                        "bounds": transform_bounds(fine_child["boundingBox"]),
                        "file": int(child_data["name"]),
                        "start": int(child_data["start"]),
                        "count": int(child_data["count"]),
                    }
                    compact["finer"].append(finer)
                    detail_file_indexes.add(finer["file"])
                detail.append(compact)
                detail_file_indexes.add(compact["file"])
        if not base or not detail:
            continue
        node_bounds = union_bounds([item["bounds"] for item in detail])
        for item in detail:
            if not bounds_contains(node_bounds, item["bounds"]):
                raise ValueError(f"{scene_id}/{root_child['id']} has an invalid detail bounds")
            for finer in item["finer"]:
                if not bounds_contains(item["bounds"], finer["bounds"]):
                    raise ValueError(
                        f"{scene_id}/{item['id']} does not contain finer node {finer['id']}"
                    )
        nodes.append({
            "id": root_child["id"],
            "level": 1,
            "bounds": node_bounds,
            "base": {
                "file": int(base["name"]),
                "start": int(base["start"]),
                "count": int(base["count"]),
            },
            "detail": detail,
        })

    sogs = {}
    for file_index in sorted(detail_file_indexes):
        relative = root["splatFiles"][file_index]
        url = urllib.parse.urljoin(lcc_url, relative)
        local_path = local_root / Path(relative) if local_root else None
        cached = (cached_sogs or {}).get(str(file_index))
        if cached and cached.get("url") == url:
            sogs[str(file_index)] = cached
        else:
            sogs[str(file_index)] = build_sog_descriptor(
                scene_id,
                file_index,
                url,
                local_path,
            )
    for node in nodes:
        for detail_range in node["detail"]:
            for item in [detail_range, *detail_range["finer"]]:
                descriptor = sogs.get(str(item["file"]))
                if not descriptor:
                    raise ValueError(f"{scene_id}: missing SOG file {item['file']}")
                if item["start"] < 0 or item["start"] + item["count"] > descriptor["meta"]["count"]:
                    raise ValueError(
                        f"{scene_id}: range {item['start']}:{item['count']} "
                        f"exceeds SOG file {item['file']}"
                    )
    return {"schemaVersion": 2, "nodes": nodes, "sogs": sogs}


def build_collision(metadata: dict, lcc_url: str) -> dict:
    root = metadata["root"]
    mesh_files = root.get("meshFiles", [])
    nodes = []
    frontier = [root]
    while frontier:
        node = frontier.pop()
        frontier.extend(node.get("child", {}).values())
        mesh = node.get("data", {}).get("mesh")
        if not mesh:
            continue
        file_index = int(mesh["name"])
        if file_index < 0 or file_index >= len(mesh_files):
            continue
        nodes.append({
            "id": node["id"],
            "bounds": transform_bounds(node["boundingBox"]),
            "url": urllib.parse.urljoin(lcc_url, mesh_files[file_index]),
            "vertex": int(mesh.get("vertex", 0)),
            "face": int(mesh.get("face", 0)),
        })
    return {"nodes": nodes}


def build_scene(config: dict) -> dict:
    scene_id = config["id"]
    existing_manifest_path = MANIFEST_OUTPUT_DIR / f"{scene_id}.json"
    existing_manifest = (
        json.loads(existing_manifest_path.read_text(encoding="utf-8"))
        if existing_manifest_path.exists()
        else {}
    )
    local_lcc_path = config.get("source_lcc2")
    use_local_lcc = bool(local_lcc_path and local_lcc_path.exists())
    lcc_source = local_lcc_path if use_local_lcc else config["lcc2"]
    lcc_path = download(lcc_source, f"{scene_id}.lcc2")
    local_root = lcc_path.parent if use_local_lcc else None
    metadata = json.loads(lcc_path.read_text(encoding="utf-8"))
    first_file_index = first_lod_file_index(metadata)
    relative_sog = metadata["root"]["splatFiles"][first_file_index]
    sog_url = urllib.parse.urljoin(config["lcc2"], relative_sog)

    local_trajectory_path = config.get("source_trajectory")
    trajectory_source = (
        local_trajectory_path
        if local_trajectory_path and local_trajectory_path.exists()
        else config["trajectory"]
    )
    trajectory_path = download(trajectory_source, f"{scene_id}-path.json")
    trajectory = json.loads(trajectory_path.read_text(encoding="utf-8"))
    if len(trajectory) < 2:
        raise ValueError(f"Scene {scene_id} has no usable trajectory")

    base_local_path = local_root / Path(relative_sog) if local_root else None
    cached_base_sog = existing_manifest.get("sog")
    base_sog = (
        cached_base_sog
        if cached_base_sog and cached_base_sog.get("url") == sog_url
        else build_sog_descriptor(
            scene_id,
            first_file_index,
            sog_url,
            base_local_path,
        )
    )
    near_lod = build_near_lod(
        metadata,
        config["lcc2"],
        scene_id,
        local_root,
        existing_manifest.get("nearLod", {}).get("sogs", {}),
    )
    collision = build_collision(metadata, config["lcc2"])

    return {
        "schemaVersion": 2,
        "id": scene_id,
        "label": config["label"],
        "lcc2Version": metadata.get("version"),
        "bounds": metadata["root"]["boundingBox"],
        "start": transform_point(trajectory[0]),
        "next": transform_point(trajectory[1]),
        "trajectory": [transform_point(point) for point in trajectory],
        "sog": base_sog,
        "nearLod": near_lod,
        "collision": collision,
    }


def main() -> None:
    scenes = {config["id"]: build_scene(config) for config in SCENES}
    MANIFEST_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    catalog = {}
    for scene in scenes.values():
        manifest_path = MANIFEST_OUTPUT_DIR / f"{scene['id']}.json"
        manifest_path.write_text(
            json.dumps(scene, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        catalog[scene["id"]] = {
            "id": scene["id"],
            "label": scene["label"],
            "manifestUrl": urllib.parse.urljoin(
                MANIFEST_PUBLIC_BASE,
                urllib.parse.quote(f"{scene['id']}.json"),
            ),
        }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(catalog, ensure_ascii=False, separators=(",", ":"))
    OUTPUT_PATH.write_text(
        "'use strict';\n\n// Generated by tools/build_native_scenes.py.\n"
        f"module.exports = {payload};\n",
        encoding="utf-8",
    )
    for scene in scenes.values():
        count = scene["sog"]["meta"]["count"]
        print(f"{scene['id']}: {count:,} splats -> {scene['sog']['url']}")
    print(f"Generated {OUTPUT_PATH}")
    print(f"Generated manifests in {MANIFEST_OUTPUT_DIR}")


if __name__ == "__main__":
    main()
