"""Create compact viewer trajectories from LCC fusion pose exports."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(os.environ.get("LCCVIEWER_SCENE_SOURCE_ROOT", "F:/"))
OUTPUT_DIR = PROJECT_DIR / "tools" / "scene-paths"
MIN_POINT_DISTANCE = 5.0

SCENES = [
    {
        "id": "RCGY",
        "poses": SOURCE_ROOT / "人才公园" / "render2" / "info" / "poses.json",
        "lcc2": SOURCE_ROOT / "人才公园" / "render2" / "人才公园.lcc2",
    },
    {
        "id": "DSH-NQCG-1",
        "poses": SOURCE_ROOT / "大沙河至氮气茶馆1" / "render2" / "info" / "poses.json",
        "lcc2": SOURCE_ROOT / "大沙河至氮气茶馆1" / "render2" / "大沙河-氮气茶馆-1.lcc2",
    },
    {
        "id": "DSH-NQCG-2",
        "poses": SOURCE_ROOT / "大沙河至氮气茶馆2" / "render2" / "info" / "poses.json",
        "lcc2": SOURCE_ROOT / "大沙河至氮气茶馆2" / "render2" / "大沙河-氮气茶馆-2.lcc2",
    },
    {
        "id": "KPJ-06",
        "poses": SOURCE_ROOT / "鲲鹏径第6段" / "output" / "render2" / "info" / "poses.json",
        "lcc2": SOURCE_ROOT / "鲲鹏径第6段" / "output" / "render2" / "鲲鹏径第6段.lcc2",
    },
]


def distance(left: list[float], right: list[float]) -> float:
    return math.sqrt(sum((left[index] - right[index]) ** 2 for index in range(3)))


def compact_trajectory(poses: list[dict]) -> list[dict[str, float]]:
    points = []
    for pose in poses:
        translation = pose.get("T") if isinstance(pose, dict) else None
        if not isinstance(translation, list) or len(translation) < 3:
            continue
        point = [float(translation[0]), float(translation[1]), float(translation[2])]
        if all(math.isfinite(value) for value in point):
            points.append(point)
    if len(points) < 2:
        raise ValueError("Pose export contains fewer than two valid translations")

    selected = [points[0]]
    for point in points[1:-1]:
        if distance(selected[-1], point) >= MIN_POINT_DISTANCE:
            selected.append(point)
    if distance(selected[-1], points[-1]) > 0.01:
        selected.append(points[-1])

    return [
        {"x": point[0], "y": point[1], "z": point[2]}
        for point in selected
    ]


def validate_bounds(trajectory: list[dict[str, float]], metadata: dict) -> None:
    bounds = metadata["root"]["boundingBox"]
    minimum = bounds["min"]
    maximum = bounds["max"]
    margin = 50.0
    for index, point in enumerate(trajectory):
        values = (point["x"], point["y"], point["z"])
        if any(values[axis] < minimum[axis] - margin
               or values[axis] > maximum[axis] + margin for axis in range(3)):
            raise ValueError(f"Trajectory point {index} is outside the LCC2 bounds: {values}")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for scene in SCENES:
        poses = json.loads(scene["poses"].read_text(encoding="utf-8"))
        metadata = json.loads(scene["lcc2"].read_text(encoding="utf-8"))
        fusion_poses = [
            pose
            for group in poses.get("fusionPoses", [])
            for pose in group
        ]
        trajectory = compact_trajectory(fusion_poses)
        validate_bounds(trajectory, metadata)
        output_path = OUTPUT_DIR / f"{scene['id']}_path.json"
        output_path.write_text(
            json.dumps(trajectory, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        print(f"{scene['id']}: {len(fusion_poses):,} poses -> {len(trajectory):,} path points")


if __name__ == "__main__":
    main()
