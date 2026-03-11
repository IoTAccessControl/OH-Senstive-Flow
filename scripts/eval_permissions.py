#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PERM_RE = re.compile(r"ohos\.permission\.[A-Za-z0-9_]+")


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


def normalize_permission_token(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return ""
    # Remove optional hints like "（可选）"
    t = re.sub(r"（[^）]*）", "", t).strip()
    return t


def extract_permission_names(text: str) -> list[str]:
    if not text:
        return []
    return sorted(set(normalize_permission_token(m.group(0)) for m in PERM_RE.finditer(text) if m.group(0)))


def load_groundtruth(file_path: Path) -> set[str]:
    text = file_path.read_text(encoding="utf-8") if file_path.exists() else ""
    out: set[str] = set()
    for line in text.splitlines():
        t = line.strip()
        if not t:
            continue
        extracted = extract_permission_names(t)
        if extracted:
            out.update(extracted)
            continue
        norm = normalize_permission_token(t)
        if norm.startswith("ohos.permission."):
            out.add(norm)
    return out


def iter_privacy_facts_files(run_dir: Path) -> Iterable[Path]:
    for p in run_dir.rglob("privacy_facts.json"):
        if p.is_file():
            yield p


def collect_predicted_permissions(run_dir: Path) -> set[str]:
    perms: set[str] = set()
    for file_path in iter_privacy_facts_files(run_dir):
        try:
            parsed = json.loads(file_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        practices = (((parsed or {}).get("facts") or {}).get("permissionPractices")) if isinstance(parsed, dict) else None
        if not isinstance(practices, list):
            continue
        for p in practices:
            raw = ""
            if isinstance(p, dict):
                raw = str(p.get("permissionName") or "")
            raw = normalize_permission_token(raw)
            if not raw or raw == "未识别":
                continue
            extracted = extract_permission_names(raw)
            if extracted:
                perms.update(extracted)
            elif raw.startswith("ohos.permission."):
                perms.add(raw)
    return perms


@dataclass(frozen=True)
class EvalResult:
    gt: int
    pred: int
    tp: int
    fp: int
    fn: int
    recall: float | None
    precision: float | None
    false_positive_rate: float | None  # FP / Pred
    missing: list[str]
    extra: list[str]


def evaluate_sets(gt: set[str], pred: set[str]) -> EvalResult:
    missing = sorted([p for p in gt if p not in pred])
    extra = sorted([p for p in pred if p not in gt])
    tp = len(gt) - len(missing)
    fp = len(extra)
    fn = len(missing)

    gt_size = len(gt)
    pred_size = len(pred)
    recall = None if gt_size == 0 else tp / gt_size
    precision = None if pred_size == 0 else tp / pred_size
    fpr = None if pred_size == 0 else fp / pred_size

    return EvalResult(
        gt=gt_size,
        pred=pred_size,
        tp=tp,
        fp=fp,
        fn=fn,
        recall=recall,
        precision=precision,
        false_positive_rate=fpr,
        missing=missing,
        extra=extra,
    )


def resolve_run_dir(repo_root: Path, run_dir: str | None, run_id: str | None) -> Path:
    if run_dir and run_id:
        raise ValueError("Please provide only one of --run-dir or --run-id")
    if run_dir:
        p = Path(run_dir)
        return p if p.is_absolute() else (repo_root / p).resolve()
    if not run_id:
        raise ValueError("Missing --run-dir or --run-id")
    reg = repo_root / "output" / "_runs" / f"{run_id}.json"
    data = json.loads(reg.read_text(encoding="utf-8"))
    out_dir = str((data or {}).get("outputDir") or "").strip()
    if not out_dir:
        raise ValueError(f"Invalid run registry entry: {reg}")
    return (repo_root / out_dir).resolve()


def iter_groundtruth_apps(gt_dir: Path) -> Iterable[str]:
    for p in sorted(gt_dir.glob("*.txt")):
        if p.is_file():
            yield p.stem


def find_latest_run_dir(output_root: Path, app: str) -> Path | None:
    app_dir = output_root / app
    if not app_dir.is_dir():
        return None
    candidates: list[Path] = []
    for child in app_dir.iterdir():
        if not child.is_dir():
            continue
        # Runs are timestamp dirs that always contain meta.json.
        if (child / "meta.json").is_file():
            candidates.append(child)
    if not candidates:
        return None
    # Timestamp dirs are formatted as YYYYMMDD-HHMMSS, so lexicographic max matches latest.
    return max(candidates, key=lambda p: p.name)


@dataclass(frozen=True)
class AppEval:
    app: str
    run_dir: Path | None
    groundtruth_file: Path
    result: EvalResult


def sum_results(results: list[EvalResult]) -> EvalResult:
    gt = sum(r.gt for r in results)
    pred = sum(r.pred for r in results)
    tp = sum(r.tp for r in results)
    fp = sum(r.fp for r in results)
    fn = sum(r.fn for r in results)

    recall = None if gt == 0 else tp / gt
    precision = None if pred == 0 else tp / pred
    fpr = None if pred == 0 else fp / pred

    return EvalResult(
        gt=gt,
        pred=pred,
        tp=tp,
        fp=fp,
        fn=fn,
        recall=recall,
        precision=precision,
        false_positive_rate=fpr,
        missing=[],
        extra=[],
    )


def fmt_percent(v: float | None) -> str:
    if v is None:
        return "/"
    if not isinstance(v, float) or not (v == v):  # NaN check
        return "NaN"
    return f"{v*100:.2f}%"


def render_table(rows: list[AppEval], total: EvalResult) -> str:
    headers = ["App", "GT", "Pred", "TP", "FP", "FN", "Recall", "FPR"]
    data_rows: list[list[str]] = []
    for r in rows:
        recall_text = "/" if r.result.recall is None else f"{r.result.recall:.4f} ({fmt_percent(r.result.recall)})"
        fpr_text = "/" if r.result.false_positive_rate is None else f"{r.result.false_positive_rate:.4f} ({fmt_percent(r.result.false_positive_rate)})"
        data_rows.append(
            [
                r.app,
                str(r.result.gt),
                str(r.result.pred),
                str(r.result.tp),
                str(r.result.fp),
                str(r.result.fn),
                recall_text,
                fpr_text,
            ]
        )

    total_recall_text = "/" if total.recall is None else f"{total.recall:.4f} ({fmt_percent(total.recall)})"
    total_fpr_text = "/" if total.false_positive_rate is None else f"{total.false_positive_rate:.4f} ({fmt_percent(total.false_positive_rate)})"
    data_rows.append(
        [
            "TOTAL",
            str(total.gt),
            str(total.pred),
            str(total.tp),
            str(total.fp),
            str(total.fn),
            total_recall_text,
            total_fpr_text,
        ]
    )

    widths = [len(h) for h in headers]
    for row in data_rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def fmt_row(row: list[str]) -> str:
        return "  ".join((row[i] or "").ljust(widths[i]) for i in range(len(headers)))

    lines = [fmt_row(headers), fmt_row(["-" * w for w in widths])]
    lines += [fmt_row(r) for r in data_rows]
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate predicted permissions (from privacy_facts.json) against groundtruth/permission/<app>.txt. If --app is omitted, evaluate all groundtruth files in batch.",
    )
    parser.add_argument("--repo-root", default="", help="Repo root (default: auto-detect)")
    parser.add_argument("--app", default="", help="App name (groundtruth/permission/<app>.txt). If omitted, batch mode.")
    parser.add_argument("--run-dir", default="", help="(Single-app) Run directory path (absolute or relative to repo root)")
    parser.add_argument("--run-id", default="", help="(Single-app) Run id (output/_runs/<runId>.json)")
    parser.add_argument("--output-root", default="output", help="Output root dir for batch/latest lookup (default: output)")
    parser.add_argument("--groundtruth-dir", default="groundtruth/permission", help="Groundtruth directory (default: groundtruth/permission)")
    parser.add_argument("--format", default="text", choices=["text", "json"], help="Output format (default: text)")
    parser.add_argument("--details", action="store_true", help="Print missing/extra lists")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve() if args.repo_root else find_repo_root(Path.cwd())
    gt_dir = (repo_root / args.groundtruth_dir).resolve() if not os.path.isabs(args.groundtruth_dir) else Path(args.groundtruth_dir).resolve()
    output_root = (repo_root / args.output_root).resolve() if not os.path.isabs(args.output_root) else Path(args.output_root).resolve()

    app = args.app.strip() or None
    run_dir_arg = args.run_dir.strip() or None
    run_id_arg = args.run_id.strip() or None

    if (run_dir_arg or run_id_arg) and not app:
        raise ValueError("--run-dir/--run-id require --app (single-app mode)")

    # Single-app mode: keep backward compatible behavior, but allow auto-latest if run isn't specified.
    if app:
        if run_dir_arg or run_id_arg:
            run_dir = resolve_run_dir(repo_root, run_dir_arg, run_id_arg)
        else:
            run_dir = find_latest_run_dir(output_root, app)
            if run_dir is None:
                # Treat as empty prediction if no run exists.
                run_dir = Path("")

        gt_file = gt_dir / f"{app}.txt"
        gt = load_groundtruth(gt_file)
        pred = collect_predicted_permissions(run_dir) if run_dir and run_dir.exists() else set()
        res = evaluate_sets(gt, pred)

        if args.format == "json":
            payload = {
                "app": app,
                "runDir": str(run_dir) if run_dir and run_dir.exists() else None,
                "groundtruthFile": str(gt_file),
                "counts": {"gt": res.gt, "pred": res.pred, "tp": res.tp, "fp": res.fp, "fn": res.fn},
                "recall": res.recall,
                "precision": res.precision,
                "falsePositiveRate": res.false_positive_rate,
                "missing": res.missing if args.details else None,
                "extra": res.extra if args.details else None,
            }
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            return 0

        print(f"App: {app}")
        print(f"Run: {run_dir if run_dir and run_dir.exists() else '(missing)'}")
        print(f"Groundtruth: {gt_file}")
        print(f"Counts: GT={res.gt}, Pred={res.pred}, TP={res.tp}, FP={res.fp}, FN={res.fn}")
        recall_text = "/" if res.recall is None else f"{res.recall:.4f} ({fmt_percent(res.recall)})"
        fpr_text = "/" if res.false_positive_rate is None else f"{res.false_positive_rate:.4f} ({fmt_percent(res.false_positive_rate)})"
        print(f"Recall (TP/GT): {recall_text}")
        print(f"False Positive Rate (FP/Pred): {fpr_text}")

        if args.details:
            print("")
            print(f"Missing (FN, in GT but not Pred): {len(res.missing)}")
            for p in res.missing:
                print(f"  - {p}")
            print("")
            print(f"Extra (FP, in Pred but not GT): {len(res.extra)}")
            for p in res.extra:
                print(f"  - {p}")
        return 0

    # Batch mode: evaluate all groundtruth files, using latest run dir under output/<app>/.
    apps = list(iter_groundtruth_apps(gt_dir))
    if not apps:
        raise ValueError(f"No groundtruth permission files found under: {gt_dir}")

    rows: list[AppEval] = []
    for a in apps:
        gt_file = gt_dir / f"{a}.txt"
        run_dir = find_latest_run_dir(output_root, a)
        gt = load_groundtruth(gt_file)
        pred = collect_predicted_permissions(run_dir) if run_dir and run_dir.exists() else set()
        res = evaluate_sets(gt, pred)
        rows.append(AppEval(app=a, run_dir=run_dir, groundtruth_file=gt_file, result=res))

    totals = sum_results([r.result for r in rows])

    if args.format == "json":
        payload = {
            "repoRoot": str(repo_root),
            "groundtruthDir": str(gt_dir),
            "outputRoot": str(output_root),
            "results": [
                {
                    "app": r.app,
                    "runDir": str(r.run_dir) if r.run_dir else None,
                    "groundtruthFile": str(r.groundtruth_file),
                    "counts": {"gt": r.result.gt, "pred": r.result.pred, "tp": r.result.tp, "fp": r.result.fp, "fn": r.result.fn},
                    "recall": r.result.recall,
                    "precision": r.result.precision,
                    "falsePositiveRate": r.result.false_positive_rate,
                    "missing": r.result.missing if args.details else None,
                    "extra": r.result.extra if args.details else None,
                }
                for r in rows
            ],
            "totals": {
                "counts": {"gt": totals.gt, "pred": totals.pred, "tp": totals.tp, "fp": totals.fp, "fn": totals.fn},
                "recall": totals.recall,
                "precision": totals.precision,
                "falsePositiveRate": totals.false_positive_rate,
            },
        }
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    print(f"Repo: {repo_root}")
    print(f"Groundtruth: {gt_dir}")
    print(f"Output: {output_root}")
    print("")
    print(render_table(rows, totals))

    if args.details:
        for r in rows:
            print("")
            print(f"== {r.app} ==")
            print(f"Run: {r.run_dir or '(missing)'}")
            print(f"Groundtruth: {r.groundtruth_file}")
            print(f"Missing (FN, in GT but not Pred): {len(r.result.missing)}")
            for p in r.result.missing:
                print(f"  - {p}")
            print(f"Extra (FP, in Pred but not GT): {len(r.result.extra)}")
            for p in r.result.extra:
                print(f"  - {p}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
