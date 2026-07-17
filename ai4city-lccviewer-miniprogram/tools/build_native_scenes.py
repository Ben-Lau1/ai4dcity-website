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
CACHE_DIR = Path(tempfile.gettempdir()) / "lccviewer-native-scenes"

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
]

SOG_TEXTURES = ("means_l.webp", "means_u.webp", "quats.webp", "scales.webp", "sh0.webp")
ZIP_TAIL_SIZE = 65557


def download(url: str, cache_name: str) -> Path:
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


def build_sog_descriptor(scene_id: str, file_index: int, url: str) -> dict:
    cache_path = CACHE_DIR / f"{scene_id}-lod-file-{file_index}.sog"
    entries = {}
    if cache_path.exists() and cache_path.stat().st_size:
        with cache_path.open("rb") as raw, zipfile.ZipFile(raw) as archive:
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
    return {"url": url, "entries": entries, "meta": sog_meta}


def build_near_lod(metadata: dict, lcc_url: str, scene_id: str) -> dict:
    root = metadata["root"]
    nodes = []
    detail_file_indexes = set()
    for child in root.get("child", {}).values():
        base = child.get("data", {}).get("3dgs")
        frontier = [child]
        # Depth 5 is the first streamed replacement and depth 6 is its near
        # refinement. The old depth-4 replacement was visibly softer than H5.
        for _ in range(4):
            next_frontier = [
                descendant
                for node in frontier
                for descendant in node.get("child", {}).values()
            ]
            if not next_frontier:
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
                for child in descendant.get("child", {}).values():
                    child_data = child.get("data", {}).get("3dgs")
                    if not child_data:
                        continue
                    finer = {
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
        nodes.append({
            "id": child["id"],
            "bounds": transform_bounds(child["boundingBox"]),
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
        sogs[str(file_index)] = build_sog_descriptor(scene_id, file_index, url)
    return {"nodes": nodes, "sogs": sogs}


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
    lcc_path = download(config["lcc2"], f"{scene_id}.lcc2")
    metadata = json.loads(lcc_path.read_text(encoding="utf-8"))
    first_file_index = first_lod_file_index(metadata)
    relative_sog = metadata["root"]["splatFiles"][first_file_index]
    sog_url = urllib.parse.urljoin(config["lcc2"], relative_sog)

    trajectory_path = download(config["trajectory"], f"{scene_id}-path.json")
    trajectory = json.loads(trajectory_path.read_text(encoding="utf-8"))
    if len(trajectory) < 2:
        raise ValueError(f"Scene {scene_id} has no usable trajectory")

    base_sog = build_sog_descriptor(scene_id, first_file_index, sog_url)
    near_lod = build_near_lod(metadata, config["lcc2"], scene_id)
    collision = build_collision(metadata, config["lcc2"])

    return {
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
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(scenes, ensure_ascii=False, separators=(",", ":"))
    OUTPUT_PATH.write_text(
        "'use strict';\n\n// Generated by tools/build_native_scenes.py.\n"
        f"module.exports = {payload};\n",
        encoding="utf-8",
    )
    for scene in scenes.values():
        count = scene["sog"]["meta"]["count"]
        print(f"{scene['id']}: {count:,} splats -> {scene['sog']['url']}")
    print(f"Generated {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
