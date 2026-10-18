#!/usr/bin/env python3
"""Create browser-specific loadable archives without changing source manifests."""
from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension"
DIST = ROOT / "dist"


def build(target: str, manifest_name: str) -> Path:
    DIST.mkdir(exist_ok=True)
    stage = DIST / f"bookmarksman-{target}"
    if stage.exists():
        shutil.rmtree(stage)
    shutil.copytree(SOURCE, stage, ignore=shutil.ignore_patterns("manifest.firefox.json", "manifest.chrome.json", "tests", "__pycache__"))
    manifest = json.loads((SOURCE / manifest_name).read_text())
    (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    archive = DIST / f"bookmarksman-{target}.zip"
    archive.unlink(missing_ok=True)
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                output.write(path, path.relative_to(stage))
    return archive


if __name__ == "__main__":
    print(build("chrome", "manifest.json"))
    print(build("firefox", "manifest.firefox.json"))
