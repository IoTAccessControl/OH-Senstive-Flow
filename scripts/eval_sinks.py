#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    while True:
        pkg = cur / "package.json"
        if pkg.exists():
            try:
                data = json.loads(pkg.read_text(encoding="utf-8"))
                if (
                    isinstance(data, dict)
                    and "workspaces" in data
                    and isinstance(data["workspaces"], list)
                    and "server" in data["workspaces"]
                ):
                    return cur
            except Exception:
                pass
        if cur.parent == cur:
            return start.resolve()
        cur = cur.parent


@dataclass(frozen=True, order=True)
class SinkKey:
    file: str
    line: int
    api_key: str


def normalize_path(text: str) -> str:
    return (text or "").strip().replace("\\", "/")


def parse_int(value: object) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    try:
        return int(str(value).strip())
    except Exception:
        return 0


def to_sink_key(record: dict) -> SinkKey | None:
    file_path = normalize_path(str(record.get("App源码文件路径") or ""))
    call_line = parse_int(record.get("调用行号"))
    api_key = str(record.get("__apiKey") or "").strip()
    if not file_path or call_line <= 0 or not api_key:
        return None
    return SinkKey(file=file_path, line=call_line, api_key=api_key)


def load_sink_records(file_path: Path) -> list[dict]:
    if not file_path.exists():
        return []
    parsed = json.loads(file_path.read_text(encoding="utf-8"))
    if not isinstance(parsed, list):
        raise ValueError(f"Expected JSON array in {file_path}")
    out: list[dict] = []
    for item in parsed:
        if isinstance(item, dict):
            out.append(item)
    return out


def collect_keys(records: list[dict]) -> tuple[set[SinkKey], dict[SinkKey, dict], int]:
    keys: set[SinkKey] = set()
    mapping: dict[SinkKey, dict] = {}
    invalid = 0
    for r in records:
        k = to_sink_key(r)
        if not k:
            invalid += 1
            continue
        keys.add(k)
        mapping.setdefault(k, r)
    return keys, mapping, invalid


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
    missing: list[SinkKey]
    extra: list[SinkKey]
    invalid_gt_records: int
    invalid_pred_records: int


def evaluate_sets(gt_records: list[dict], pred_records: list[dict]) -> EvalResult:
    gt, gt_map, invalid_gt = collect_keys(gt_records)
    pred, pred_map, invalid_pred = collect_keys(pred_records)

    missing = sorted([k for k in gt if k not in pred])
    extra = sorted([k for k in pred if k not in gt])
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
        invalid_gt_records=invalid_gt,
        invalid_pred_records=invalid_pred,
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


def find_latest_pred_sinks(output_root: Path, app: str) -> Path | None:
    app_dir = output_root / app
    if not app_dir.is_dir():
        return None
    candidates: list[Path] = []
    for child in app_dir.iterdir():
        if not child.is_dir():
            continue
        f = child / "sinks.json"
        if f.is_file():
            candidates.append(f)
    if not candidates:
        return None
    # Timestamp directories are formatted as YYYYMMDD-HHMMSS, so lexicographic max matches latest.
    return max(candidates, key=lambda p: p.parent.name)


def fmt_percent(v: float | None) -> str:
    if v is None:
        return "/"
    if not isinstance(v, float) or not (v == v):  # NaN check
        return "NaN"
    return f"{v*100:.2f}%"


def key_to_human(k: SinkKey, mapping: dict[SinkKey, dict] | None = None) -> str:
    base = f"{k.file}:{k.line} {k.api_key}"
    if not mapping:
        return base
    r = mapping.get(k)
    if not isinstance(r, dict):
        return base
    call_code = str(r.get("调用代码") or "").strip()
    return f"{base} | {call_code}" if call_code else base


def iter_groundtruth_apps(gt_dir: Path) -> Iterable[str]:
    for p in sorted(gt_dir.glob("*.json")):
        if p.is_file():
            yield p.stem


@dataclass(frozen=True)
class AppEval:
    app: str
    groundtruth_file: Path
    pred_sinks_file: Path | None
    result: EvalResult
    gt_map: dict[SinkKey, dict]
    pred_map: dict[SinkKey, dict]


def evaluate_app(app: str, gt_file: Path, pred_file: Path | None) -> AppEval:
    gt_records = load_sink_records(gt_file)
    pred_records = load_sink_records(pred_file) if pred_file and pred_file.exists() else []

    gt_keys, gt_map, _ = collect_keys(gt_records)
    pred_keys, pred_map, _ = collect_keys(pred_records)
    res = evaluate_sets(gt_records, pred_records)

    # Ensure maps contain only comparable keys (used for --details rendering).
    gt_map = {k: gt_map[k] for k in gt_keys if k in gt_map}
    pred_map = {k: pred_map[k] for k in pred_keys if k in pred_map}

    return AppEval(app=app, groundtruth_file=gt_file, pred_sinks_file=pred_file, result=res, gt_map=gt_map, pred_map=pred_map)


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
        invalid_gt_records=sum(r.invalid_gt_records for r in results),
        invalid_pred_records=sum(r.invalid_pred_records for r in results),
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Batch evaluate sink recognition (sinks.json) against groundtruth/sink/*.json",
    )
    parser.add_argument("--repo-root", default="", help="Repo root (default: auto-detect)")
    parser.add_argument("--app", default="", help="Evaluate only one app (groundtruth/sink/<app>.json)")
    parser.add_argument("--output-root", default="output", help="Output root dir (default: output)")
    parser.add_argument("--groundtruth-dir", default="groundtruth/sink", help="Groundtruth dir (default: groundtruth/sink)")
    parser.add_argument("--run-dir", default="", help="(Single-app) Use a specific run directory (absolute or relative)")
    parser.add_argument("--run-id", default="", help="(Single-app) Use output/_runs/<runId>.json to locate run directory")
    parser.add_argument("--format", default="text", choices=["text", "json"], help="Output format (default: text)")
    parser.add_argument("--details", action="store_true", help="Print missing/extra sink lists")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve() if args.repo_root else find_repo_root(Path.cwd())
    output_root = (repo_root / args.output_root).resolve() if not os.path.isabs(args.output_root) else Path(args.output_root).resolve()
    gt_dir = (repo_root / args.groundtruth_dir).resolve() if not os.path.isabs(args.groundtruth_dir) else Path(args.groundtruth_dir).resolve()

    single_app = args.app.strip() or None
    run_dir_arg = args.run_dir.strip() or None
    run_id_arg = args.run_id.strip() or None
    if (run_dir_arg or run_id_arg) and not single_app:
        raise ValueError("--run-dir/--run-id require --app (single-app mode)")

    apps: list[str]
    if single_app:
        apps = [single_app]
    else:
        apps = list(iter_groundtruth_apps(gt_dir))
        if not apps:
            raise ValueError(f"No groundtruth sink files found under: {gt_dir}")

    rows: list[AppEval] = []
    for app in apps:
        gt_file = gt_dir / f"{app}.json"
        if not gt_file.exists():
            raise FileNotFoundError(f"Missing groundtruth file: {gt_file}")

        pred_file: Path | None
        if single_app and (run_dir_arg or run_id_arg):
            run_dir = resolve_run_dir(repo_root, run_dir_arg, run_id_arg)
            pred_file = run_dir / "sinks.json"
        else:
            pred_file = find_latest_pred_sinks(output_root, app)

        rows.append(evaluate_app(app, gt_file, pred_file))

    totals = sum_results([r.result for r in rows])

    if args.format == "json":
        payload = {
            "repoRoot": str(repo_root),
            "groundtruthDir": str(gt_dir),
            "outputRoot": str(output_root),
            "results": [
                {
                    "app": r.app,
                    "groundtruthFile": str(r.groundtruth_file),
                    "predSinksFile": str(r.pred_sinks_file) if r.pred_sinks_file else None,
                    "counts": {"gt": r.result.gt, "pred": r.result.pred, "tp": r.result.tp, "fp": r.result.fp, "fn": r.result.fn},
                    "recall": r.result.recall,
                    "precision": r.result.precision,
                    "falsePositiveRate": r.result.false_positive_rate,
                    "invalidRecords": {"groundtruth": r.result.invalid_gt_records, "predicted": r.result.invalid_pred_records},
                    "missing": (
                        [
                            {"file": k.file, "line": k.line, "apiKey": k.api_key, "callCode": (r.gt_map.get(k, {}) or {}).get("调用代码")}
                            for k in r.result.missing
                        ]
                        if args.details
                        else None
                    ),
                    "extra": (
                        [
                            {
                                "file": k.file,
                                "line": k.line,
                                "apiKey": k.api_key,
                                "callCode": (r.pred_map.get(k, {}) or {}).get("调用代码"),
                            }
                            for k in r.result.extra
                        ]
                        if args.details
                        else None
                    ),
                }
                for r in rows
            ],
            "totals": {
                "counts": {"gt": totals.gt, "pred": totals.pred, "tp": totals.tp, "fp": totals.fp, "fn": totals.fn},
                "recall": totals.recall,
                "precision": totals.precision,
                "falsePositiveRate": totals.false_positive_rate,
                "invalidRecords": {"groundtruth": totals.invalid_gt_records, "predicted": totals.invalid_pred_records},
            },
        }
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    print(f"Repo: {repo_root}")
    print(f"Groundtruth: {gt_dir}")
    print(f"Output: {output_root}")
    print("")
    print(render_table(rows, totals))

    invalid_gt = sum(r.result.invalid_gt_records for r in rows)
    invalid_pred = sum(r.result.invalid_pred_records for r in rows)
    if invalid_gt or invalid_pred:
        print("")
        print(f"Invalid records ignored: groundtruth={invalid_gt}, predicted={invalid_pred}")

    if args.details:
        for r in rows:
            print("")
            print(f"== {r.app} ==")
            print(f"GT: {r.groundtruth_file}")
            print(f"Pred: {r.pred_sinks_file or '(missing)'}")
            print(f"Missing (FN, in GT but not Pred): {len(r.result.missing)}")
            for k in r.result.missing:
                print(f"  - {key_to_human(k, r.gt_map)}")
            print(f"Extra (FP, in Pred but not GT): {len(r.result.extra)}")
            for k in r.result.extra:
                print(f"  - {key_to_human(k, r.pred_map)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
