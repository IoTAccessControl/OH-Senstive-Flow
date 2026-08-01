#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"
UNKNOWN_MARKERS = ("未识别", "尚未定位", "应用源码/配置声明")


def normalize_api(value: str) -> str:
    value = value.strip().split("(", 1)[0]
    value = value.replace("-->", ".").replace("->", ".").replace("#", ".")
    value = re.sub(r"[\s'\"`]", "", value)
    value = re.sub(r"\.{2,}", ".", value).strip(".;")
    return value


def latest_run(app: str) -> Path | None:
    app_dir = OUTPUT / app
    runs = sorted(p for p in app_dir.iterdir() if p.is_dir() and (p / "meta.json").is_file()) if app_dir.is_dir() else []
    return runs[-1] if runs else None


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def valid_text(value: object) -> bool:
    text = str(value or "").strip()
    return bool(text) and not any(marker in text for marker in UNKNOWN_MARKERS)


def element_quality(value: object) -> float:
    text = str(value or "").strip()
    if not text or text == "未识别":
        return 0.0
    if any(marker in text for marker in UNKNOWN_MARKERS) or "相关功能" in text:
        return 0.5
    return 1.0


def facts_from_run(run: Path | None) -> tuple[list[dict], list[dict]]:
    permissions: list[dict] = []
    data_practices: list[dict] = []
    if not run:
        return permissions, data_practices
    for path in run.rglob("privacy_facts.json"):
        raw = read_json(path)
        if not isinstance(raw, dict):
            continue
        content = raw.get("facts", raw)
        if not isinstance(content, dict):
            continue
        permissions.extend(item for item in content.get("permissionPractices", []) if isinstance(item, dict))
        data_practices.extend(item for item in content.get("dataPractices", []) if isinstance(item, dict))
    return permissions, data_practices


def permission_names(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return set(re.findall(r"ohos\.permission\.[A-Za-z0-9_]+", path.read_text(encoding="utf-8")))


def normalize_data_item(value: object) -> str:
    text = re.sub(r"[\s（）()、，,。.!！？?；;：:]", "", str(value or "")).lower()
    aliases = [
        (("当前位置", "起始位置", "位置信息", "地理位置", "经纬度"), "位置信息"),
        (("步数", "计步器传感器"), "步数数据"),
        (("授权码", "authorizationcode"), "授权码"),
        (("匿名设备标识",), "匿名设备标识符"),
        (("运动健康", "健康记录", "运动序列"), "运动健康数据"),
        (("设备token", "devicetoken", "设备标识信息"), "设备标识信息"),
        (("设备品牌", "设备方向", "设备类型", "设备市场", "系统属性", "设备信息"), "设备信息"),
        (("登录账号", "账号"), "登录账号"),
        (("登录密码", "密码"), "登录密码"),
        (("出生日期", "生日"), "出生日期"),
        (("工作信息", "工作"), "工作信息"),
        (("家庭成员",), "家庭成员信息"),
        (("联系人", "通讯录"), "通讯录信息"),
        (("头像",), "头像图片"),
        (("聊天内容", "聊天消息"), "聊天内容"),
        (("搜索关键词", "搜索词", "用户搜索"), "搜索关键词"),
        (("用户身份",), "用户身份信息"),
        (("ip地址",), "IP地址"),
        (("唯一标识", "appuuid"), "应用唯一标识符"),
        (("cookie",), "Cookie"),
        (("商户号",), "商户号"),
        (("预支付交易会话", "prepayid"), "预支付交易会话标识"),
        (("授权标识", "authid"), "授权标识"),
        (("预签约编号", "presignno"), "预签约编号"),
        (("用户输入内容",), "用户输入内容"),
    ]
    for needles, canonical in aliases:
        if any(needle in text for needle in needles):
            return canonical
    return str(value or "").strip()


def personal_groundtruth() -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    path = ROOT / "groundtruth/personal_info.csv"
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            app = str(row.get("应用") or "").strip()
            item = normalize_data_item(row.get("数据项"))
            if app and item:
                out.setdefault(app, set()).add(item)
    return out


def percent(numerator: int, denominator: int) -> str:
    return f"{(numerator / denominator * 100):.2f}%" if denominator else "0.00%"


def evaluated_percent(numerator: int, denominator: int) -> str:
    return percent(numerator, denominator) if denominator else "N/A"


def permission_row(app: str) -> tuple[list[str], tuple[float, int]]:
    gt = permission_names(ROOT / "groundtruth/permission" / f"{app}.txt")
    practices, _ = facts_from_run(latest_run(app))
    by_name: dict[str, list[dict]] = {}
    for practice in practices:
        for name in re.findall(r"ohos\.permission\.[A-Za-z0-9_]+", str(practice.get("permissionName") or "")):
            by_name.setdefault(name, []).append(practice)
    predicted = set(by_name)
    tp = len(gt & predicted)
    fp = len(predicted - gt)
    complete = 0
    for name in predicted:
        candidates = by_name[name]
        best = max(
            (1 + element_quality(item.get("businessScenario")) + element_quality(item.get("permissionPurpose")) for item in candidates),
            default=0,
        )
        complete += best
    expected = len(predicted) * 3
    return [
        app, str(tp), str(len(gt)), evaluated_percent(tp, len(gt)), str(fp), str(len(predicted)),
        evaluated_percent(fp, len(predicted)), evaluated_percent(complete, expected) if gt else "N/A",
    ], (complete, expected) if gt else (0, 0)


def personal_row(app: str, groundtruth: dict[str, set[str]]) -> tuple[list[str], tuple[float, int]]:
    gt = groundtruth.get(app, set())
    run = latest_run(app)
    _, practices = facts_from_run(run)
    by_item: dict[str, list[dict]] = {}
    for practice in practices:
        for data_item in practice.get("dataItems", []) if isinstance(practice.get("dataItems"), list) else []:
            if not isinstance(data_item, dict):
                continue
            name = normalize_data_item(data_item.get("name"))
            if name:
                by_item.setdefault(name, []).append(practice)
    predicted = set(by_item)
    tp = len(gt & predicted)
    fp = len(predicted - gt)
    complete = 0
    for item in gt:
        candidates = by_item.get(item, [])
        best = max(
            (
                1 + element_quality(practice.get("businessScenario"))
                + element_quality(practice.get("processingMethod"))
                + element_quality(practice.get("processingSubject"))
                for practice in candidates
            ),
            default=0,
        )
        complete += best
    expected = len(gt) * 4
    return [
        app, str(tp), str(len(gt)), evaluated_percent(tp, len(gt)), str(fp), str(len(predicted)),
        evaluated_percent(fp, len(predicted)), evaluated_percent(complete, expected) if gt else "N/A",
    ], (complete, expected) if gt else (0, 0)


def write_table(path: Path, header: list[str], rows: list[list[str]], completeness: list[tuple[float, int]]) -> None:
    totals = [sum(int(row[index]) for row in rows) for index in (1, 2, 4, 5)]
    complete = sum(item[0] for item in completeness)
    expected = sum(item[1] for item in completeness)
    rows.append([
        "TOTAL", str(totals[0]), str(totals[1]), percent(totals[0], totals[1]),
        str(totals[2]), str(totals[3]), percent(totals[2], totals[3]), percent(complete, expected),
    ])
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def main() -> None:
    apps = sorted(path.stem for path in (ROOT / "groundtruth/permission").glob("*.txt"))
    permission_results = [permission_row(app) for app in apps]
    personal_gt = personal_groundtruth()
    personal_results = [personal_row(app, personal_gt) for app in apps]
    target = OUTPUT / "evaluation"
    write_table(
        target / "permission_evaluation.csv",
        ["应用", "权限感知数", "权限总数", "覆盖率", "权限误报数", "权限预测数", "误报率", "要素完整度"],
        [item[0] for item in permission_results], [item[1] for item in permission_results],
    )
    write_table(
        target / "personal_info_evaluation.csv",
        ["应用", "信息感知数", "信息总数", "覆盖率", "信息误报数", "信息预测数", "误报率", "要素完整度"],
        [item[0] for item in personal_results], [item[1] for item in personal_results],
    )
    print(target / "permission_evaluation.csv")
    print(target / "personal_info_evaluation.csv")


if __name__ == "__main__":
    main()
