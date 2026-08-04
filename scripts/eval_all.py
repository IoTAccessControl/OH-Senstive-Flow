#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"
UNKNOWN_MARKERS = ("未知", "未识别", "尚未定位", "应用源码/配置声明")
WEAK_MARKERS = (
    "相关功能",
    "相关页面",
    "相关模块",
    "对应功能",
    "具体功能",
    "用户输入或系统 API",
    "应用处理",
    "读取并使用",
    "用于实现与",
    "对应的系统能力",
    "系统API",
    "权限:",
    "数据:",
    " / ",
    "Promise方式",
)
TEMPLATE_QUALITY_CAP = 0.89
STANDARDIZED_SCENARIO_PREFIXES = (
    "用户填写或提交个人资料时",
    "用户登录或验证账号时",
    "用户输入并提交内容时",
    "用户编辑或发送聊天消息时",
    "用户发起支付、授权或签约操作时",
    "用户使用定位或地图服务时",
    "用户使用运动健康服务时",
    "应用识别当前设备并建立服务连接时",
    "应用访问网络服务并维持登录会话时",
    "用户查看或设置头像时",
    "用户查看身份或联系人信息时",
    "应用加载在线内容或检查网络连接时",
    "用户使用定位、地图或位置相关服务时",
    "用户拍摄、选择或保存图片和媒体内容时",
    "用户使用录音或语音功能时",
    "应用识别设备或连接设备服务时",
    "用户使用手机号码、短信或联系人服务时",
    "应用通过振动向用户提供操作反馈时",
    "应用执行需要",
)


def normalize_api(value: str) -> str:
    value = value.strip().split("(", 1)[0]
    value = value.replace("-->", ".").replace("->", ".").replace("#", ".")
    value = re.sub(r"[\s'\"`]", "", value)
    value = re.sub(r"\.{2,}", ".", value).strip(".;")
    return value


def latest_run(app: str) -> Path | None:
    run_info = os.environ.get("EVAL_RUN_INFO", "").strip()
    if run_info:
        selected: dict[str, str] = {}
        for line in Path(run_info).read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key not in {"provider", "model", "base_url"}:
                selected[key.strip()] = value.strip()
        stamp = selected.get(app)
        selected_run = OUTPUT / app / stamp if stamp else None
        if not selected_run or not (selected_run / "meta.json").is_file():
            raise FileNotFoundError(f"EVAL_RUN_INFO 未提供有效运行目录: {app}")
        return selected_run
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
    if any(marker in text for marker in UNKNOWN_MARKERS + WEAK_MARKERS):
        return 0.5
    if re.search(r"[A-Za-z]{3,}", text) and not re.search(r"[\u4e00-\u9fff]", text):
        return 0.5
    return 1.0


def text_list_quality(value: object) -> float:
    if not isinstance(value, list):
        return 0.0
    scores = [element_quality(item) for item in value if str(item or "").strip()]
    return sum(scores) / len(scores) if scores else 0.0


def refs_quality(value: object) -> float:
    if not isinstance(value, list):
        return 0.0
    for ref in value:
        if not isinstance(ref, dict):
            continue
        if str(ref.get("flowId") or "").strip() and str(ref.get("nodeId") or "").strip():
            return 1.0
    return 0.0


def dataflow_refs(path: Path) -> set[tuple[str, str]]:
    raw = read_json(path)
    if not isinstance(raw, dict):
        return set()
    refs: set[tuple[str, str]] = set()
    for flow in raw.get("flows", []):
        if not isinstance(flow, dict):
            continue
        flow_id = str(flow.get("flowId") or "").strip()
        for node in flow.get("nodes", []):
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("id") or "").strip()
            if flow_id and node_id:
                refs.add((flow_id, node_id))
    return refs


def valid_refs(value: object, known_refs: set[tuple[str, str]]) -> bool:
    if not isinstance(value, list):
        return False
    return any(
        isinstance(ref, dict)
        and (str(ref.get("flowId") or "").strip(), str(ref.get("nodeId") or "").strip()) in known_refs
        for ref in value
    )


def standardized_practice(practice: dict) -> bool:
    scenario = str(practice.get("businessScenario") or "").strip()
    return any(scenario.startswith(prefix) for prefix in STANDARDIZED_SCENARIO_PREFIXES)


def fallback_permission_practice(practice: dict) -> bool:
    scenario = str(practice.get("businessScenario") or "").strip()
    purpose = str(practice.get("permissionPurpose") or "").strip()
    deny = str(practice.get("denyImpact") or "").strip()
    return any(text.startswith(prefix) for text in (scenario, purpose, deny) for prefix in STANDARDIZED_SCENARIO_PREFIXES)


def practice_element_quality(practice: dict, field: str) -> float:
    quality = element_quality(practice.get(field))
    if field == "businessScenario" and len(str(practice.get(field) or "").strip()) < 8:
        quality = min(quality, 0.5)
    if standardized_practice(practice) or fallback_permission_practice(practice):
        return min(quality, TEMPLATE_QUALITY_CAP)
    return quality


def practice_text_list_quality(practice: dict, field: str) -> float:
    quality = text_list_quality(practice.get(field))
    return min(quality, TEMPLATE_QUALITY_CAP) if standardized_practice(practice) else quality


def facts_from_run(run: Path | None, include_fallback: bool = False) -> tuple[list[dict], list[dict]]:
    permissions: list[dict] = []
    data_practices: list[dict] = []
    if not run:
        return permissions, data_practices
    paths = (
        list(run.rglob("privacy_facts.json"))
        if include_fallback
        else [*run.glob("pages/*/features/*/privacy_facts.json"), run / "app_permissions/privacy_facts.json"]
    )
    for path in paths:
        if not path.is_file():
            continue
        if not include_fallback:
            relative = path.relative_to(run)
            if relative.parts[0] == "pages" and (
                relative.parts[1] == "_app_permissions" or relative.parts[3] == "__app_permissions"
            ):
                continue
        known_refs = dataflow_refs(path.with_name("dataflows.json"))
        if not known_refs:
            continue
        raw = read_json(path)
        if not isinstance(raw, dict):
            continue
        content = raw.get("facts", raw)
        if not isinstance(content, dict):
            continue
        app_level_fallback = path.relative_to(run).parts[0] == "app_permissions"
        permissions.extend(
            item
            for item in content.get("permissionPractices", [])
            if isinstance(item, dict)
            and (not include_fallback or app_level_fallback or valid_refs(item.get("refs"), known_refs))
        )
        for practice in content.get("dataPractices", []):
            if not isinstance(practice, dict):
                continue
            items = [
                item
                for item in practice.get("dataItems", [])
                if isinstance(item, dict)
                and (not include_fallback or app_level_fallback or valid_refs(item.get("refs"), known_refs))
            ]
            if items:
                data_practices.append({**practice, "dataItems": items})
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
    run = latest_run(app)
    coverage_practices, _ = facts_from_run(run, include_fallback=True)
    quality_practices, _ = facts_from_run(run)
    coverage_by_name: dict[str, list[dict]] = {}
    quality_by_name: dict[str, list[dict]] = {}
    for practice in coverage_practices:
        for name in re.findall(r"ohos\.permission\.[A-Za-z0-9_]+", str(practice.get("permissionName") or "")):
            coverage_by_name.setdefault(name, []).append(practice)
    for practice in quality_practices:
        for name in re.findall(r"ohos\.permission\.[A-Za-z0-9_]+", str(practice.get("permissionName") or "")):
            quality_by_name.setdefault(name, []).append(practice)
    predicted = set(coverage_by_name)
    tp = len(gt & predicted)
    fp = len(predicted - gt)
    complete = 0
    evaluated = 0
    for name in gt:
        candidates = quality_by_name.get(name, [])
        if not candidates:
            continue
        best = max(
            (
                practice_element_quality(item, "businessScenario")
                + practice_element_quality(item, "permissionPurpose")
                + practice_element_quality(item, "denyImpact")
                for item in candidates
            ),
            default=0,
        )
        complete += best
        evaluated += 1
    expected = evaluated * 3
    return [
        app, str(tp), str(len(gt)), evaluated_percent(tp, len(gt)), str(fp), str(len(predicted)),
        evaluated_percent(fp, len(predicted)), evaluated_percent(complete, expected) if gt else "N/A",
    ], (complete, expected) if gt else (0, 0)


def personal_row(app: str, groundtruth: dict[str, set[str]]) -> tuple[list[str], tuple[float, int]]:
    gt = groundtruth.get(app, set())
    run = latest_run(app)
    _, coverage_practices = facts_from_run(run, include_fallback=True)
    _, quality_practices = facts_from_run(run)
    coverage_by_item: dict[str, list[tuple[dict, dict]]] = {}
    quality_by_item: dict[str, list[tuple[dict, dict]]] = {}
    for practice in coverage_practices:
        for data_item in practice.get("dataItems", []) if isinstance(practice.get("dataItems"), list) else []:
            if not isinstance(data_item, dict):
                continue
            name = normalize_data_item(data_item.get("name"))
            if name:
                coverage_by_item.setdefault(name, []).append((practice, data_item))
    for practice in quality_practices:
        for data_item in practice.get("dataItems", []) if isinstance(practice.get("dataItems"), list) else []:
            if not isinstance(data_item, dict):
                continue
            name = normalize_data_item(data_item.get("name"))
            if name:
                quality_by_item.setdefault(name, []).append((practice, data_item))
    predicted = set(coverage_by_item)
    tp = len(gt & predicted)
    fp = len(predicted - gt)
    complete = 0
    evaluated = 0
    for item in gt:
        candidates = quality_by_item.get(item, [])
        if not candidates:
            continue
        best = max(
            (
                practice_element_quality(practice, "businessScenario")
                + practice_element_quality(practice, "processingMethod")
                + element_quality(practice.get("processingSubject"))
                + practice_text_list_quality(practice, "dataSources")
                + practice_element_quality(practice, "storageMethod")
                + practice_element_quality(practice, "processingPurpose")
                for practice, data_item in candidates
            ),
            default=0,
        )
        complete += best
        evaluated += 1
    expected = evaluated * 6
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
