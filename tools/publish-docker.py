#!/usr/bin/env python3
"""Build (and optionally publish) the bookmarksman Docker image."""

from __future__ import annotations

import argparse
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME_RE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
TAG_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("namespace", help="Docker Hub username or organization")
    result.add_argument("version", help="image version tag, such as 1.2.0 or 1.2.0-rc.1")
    result.add_argument("--repository", default="bookmarksman", help="Docker Hub repository (default: bookmarksman)")
    result.add_argument("--latest", action="store_true", help="also tag this release as latest")
    result.add_argument("--push", action="store_true", help="push after building; multi-platform builds require this")
    result.add_argument("--platforms", help="comma-separated buildx platforms, e.g. linux/amd64,linux/arm64")
    result.add_argument("--dry-run", action="store_true", help="print Docker commands without running them")
    return result


def validate(args: argparse.Namespace, command_parser: argparse.ArgumentParser) -> list[str]:
    if not NAME_RE.fullmatch(args.namespace) or len(args.namespace) > 255:
        command_parser.error("namespace must be a Docker Hub username or organization name")
    if not NAME_RE.fullmatch(args.repository) or len(args.repository) > 255:
        command_parser.error("repository must contain lowercase letters, digits, dots, underscores, or hyphens")
    if not TAG_RE.fullmatch(args.version):
        command_parser.error("version must be a valid Docker tag")
    if args.version == "latest":
        command_parser.error("use a stable version tag; pass --latest to add the latest alias explicitly")
    platforms = []
    if args.platforms:
        platforms = args.platforms.split(",")
        if any(not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", item) for item in platforms):
            command_parser.error("platforms must be comma-separated os/architecture values")
        if len(set(platforms)) != len(platforms):
            command_parser.error("platforms must not contain duplicates")
        if not args.push and len(platforms) > 1:
            command_parser.error("multi-platform builds require --push; Docker cannot load a multi-platform image locally")
    return platforms


def commands(args: argparse.Namespace, platforms: list[str]) -> list[list[str]]:
    image = f"{args.namespace}/{args.repository}"
    tags = [args.version] + (["latest"] if args.latest else [])
    dockerfile = ROOT / "server" / "Dockerfile"
    context = ROOT / "server"
    if platforms:
        build = ["docker", "buildx", "build", "--platform", ",".join(platforms)]
    else:
        build = ["docker", "build"]
    for tag in tags:
        build.extend(["--tag", f"{image}:{tag}"])
    build.extend(["--build-arg", f"BOOKMARKSMAN_VERSION={args.version}"])
    if platforms:
        build.append("--push" if args.push else "--load")
    build.extend(["--file", str(dockerfile), str(context)])
    plan = [build]
    if args.push and not platforms:
        plan.extend([["docker", "push", f"{image}:{tag}"] for tag in tags])
    return plan


def main(argv: list[str] | None = None) -> int:
    command_parser = parser()
    args = command_parser.parse_args(argv)
    platforms = validate(args, command_parser)
    plan = commands(args, platforms)
    if args.dry_run:
        for command in plan:
            print(shlex.join(command))
        return 0
    if not shutil.which("docker"):
        print("error: Docker CLI not found; install Docker Desktop or Docker Engine", file=sys.stderr)
        return 2
    try:
        for command in plan:
            completed = subprocess.run(command, check=False, cwd=ROOT)
            if completed.returncode:
                print(
                    f"error: Docker command failed with exit code {completed.returncode}; "
                    "check the Docker output above and confirm the Docker daemon is running",
                    file=sys.stderr,
                )
                return completed.returncode
    except OSError as exc:
        print(
            f"error: could not launch Docker: {exc}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
