#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    while True:
        pkg = cur / "package.json"
        if pkg.exists():
            try:
                data = json.loads(pkg.read_text(encoding="utf-8"))
                if isinstance(data, dict) and "workspaces" in data and isinstance(data["workspaces"], list) and "server" in data["workspaces"]:
                    return cur
            except Exception:
                pass
        if cur.parent == cur:
            return start.resolve()
        cur = cur.parent


def run_node_infer(repo_root: Path, app: str | None, mode: str) -> dict:
    cmd = [
        "node",
        "--import",
        "tsx",
        "server/src/cli/inferAppPermissions.ts",
        "--format",
        "json",
        "--mode",
        mode,
        "--details",
    ]
    if app:
        cmd += ["--app", app]

    proc = subprocess.run(
        cmd,
        cwd=str(repo_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Node inference failed (exit={proc.returncode}).\nSTDERR:\n{proc.stderr}\nSTDOUT:\n{proc.stdout}")

    try:
        return json.loads(proc.stdout)
    except Exception as e:
        raise RuntimeError(f"Failed to parse JSON from Node output: {e}\nOutput:\n{proc.stdout}") from e


def write_groundtruth(out_dir: Path, app: str, permissions: list[str]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    file_path = out_dir / f"{app}.txt"
    lines = [p.strip() for p in permissions if isinstance(p, str) and p.strip()]
    text = "\n".join(lines) + ("\n" if lines else "")
    file_path.write_text(text, encoding="utf-8")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Generate groundtruth/permission/*.txt by combining declared permissions and SDK API inference (CSV + SDK @permission).",
    )
    parser.add_argument("--repo-root", default="", help="Repo root (default: auto-detect)")
    parser.add_argument("--app", default="", help="Only generate for one app (folder name under input/app)")
    parser.add_argument(
        "--mode",
        default="union",
        choices=["declared", "inferred", "union", "intersection"],
        help="Permission set mode (default: union)",
    )
    parser.add_argument(
        "--out-dir",
        default="groundtruth/permission",
        help="Output dir relative to repo root (default: groundtruth/permission)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Only print results; do not write files")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve() if args.repo_root else find_repo_root(Path.cwd())
    out_dir = (repo_root / args.out_dir).resolve() if not os.path.isabs(args.out_dir) else Path(args.out_dir).resolve()
    app = args.app.strip() or None

    payload = run_node_infer(repo_root=repo_root, app=app, mode=args.mode)
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise RuntimeError(f"Unexpected payload from Node: {payload}")

    results = payload.get("results", [])
    if not isinstance(results, list):
        raise RuntimeError(f"Unexpected results type: {type(results)}")

    wrote = 0
    for item in results:
        if not isinstance(item, dict):
            continue
        app_name = str(item.get("app", "")).strip()
        perms = item.get("permissions", [])
        if not app_name or not isinstance(perms, list):
            continue

        if args.dry_run:
            counts = item.get("counts") if isinstance(item.get("counts"), dict) else {}
            declared_n = counts.get("declared")
            inferred_n = counts.get("inferred")
            combined_n = counts.get("combined")
            sinks_n = counts.get("sinks")
            files_n = counts.get("files")
            print(
                f"{app_name}: permissions={len(perms)} (declared={declared_n}, inferred={inferred_n}, combined={combined_n}, sinks={sinks_n}, files={files_n})"
            )
            for p in perms:
                print(f"  - {p}")
            print()
            continue

        write_groundtruth(out_dir, app_name, perms)
        wrote += 1

    if not args.dry_run:
        print(f"Wrote {wrote} groundtruth file(s) under: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

