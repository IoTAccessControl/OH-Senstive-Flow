import csv
import html
import json
import os
import re
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"
GROUNDTRUTH = ROOT / "groundtruth"

sys.path.insert(0, str(ROOT / "scripts"))
import eval_all

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OH-Senstive-Flow 敏感数据流合规感知验收报告</title>
  <style>
    :root {
      --bg: #ffffff;
      --fg: #0f172a;
      --muted: #475569;
      --muted-light: #64748b;
      --border: #e2e8f0;
      --border-dark: #cbd5e1;
      --blue: #2563eb;
      --blue-700: #1d4ed8;
      --blue-50: #eff6ff;
      --green: #16a34a;
      --green-700: #15803d;
      --green-50: #f0fdf4;
      --green-100: #dcfce7;
      --purple: #7c3aed;
      --purple-50: #faf5ff;
      --purple-700: #6d28d9;
      --error: #b91c1c;
      --error-50: #fef2f2;
      --surface: #f8fafc;
      --card-bg: #ffffff;
      --font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      --mono-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-family);
      line-height: 1.5;
      color: var(--fg);
      background-color: var(--surface);
      min-width: 320px;
      padding: 24px 16px 48px;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    /* Header */
    .header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 12px;
    }

    .title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--fg);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 6px;
      line-height: 1.2;
      white-space: nowrap;
    }

    .badge-pass {
      background-color: var(--green-100);
      color: var(--green-700);
      border: 1px solid #bbf7d0;
    }

    .badge-fail {
      background-color: var(--error-50);
      color: var(--error);
      border: 1px solid #fecaca;
    }

    .badge-blue {
      background-color: var(--blue-50);
      color: var(--blue-700);
      border: 1px solid #bfdbfe;
    }

    .badge-purple {
      background-color: var(--purple-50);
      color: var(--purple-700);
      border: 1px solid #e9d5ff;
    }

    .subtitle {
      color: var(--muted);
      font-size: 14px;
    }

    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px 24px;
      font-size: 13px;
      color: var(--muted);
      border-top: 1px solid var(--border);
      padding-top: 12px;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Verdict Banner */
    .verdict-banner {
      background: var(--green-50);
      border: 1px solid #bbf7d0;
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .verdict-banner.fail {
      background: var(--error-50) !important;
      border: 1px solid #fca5a5 !important;
    }

    .verdict-text {
      font-size: 15px;
      font-weight: 700;
      color: var(--green-700);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .verdict-banner.fail .verdict-text {
      color: var(--error) !important;
    }

    .verdict-desc {
      font-size: 13px;
      color: var(--muted);
    }

    .verdict-banner.fail .verdict-desc {
      color: #991b1b !important;
    }

    /* KPI Grid (全局统一总览，置顶全展示) */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      transition: transform 150ms ease, box-shadow 150ms ease;
    }

    .kpi-card.fail {
      border: 1px solid #fca5a5 !important;
      background: #fffafa !important;
    }

    .kpi-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    .kpi-title {
      font-size: 13px;
      color: var(--muted);
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .kpi-value {
      font-size: 32px;
      font-weight: 800;
      color: var(--fg);
      line-height: 1.1;
      margin-bottom: 6px;
      font-variant-numeric: tabular-nums;
    }

    .kpi-sub {
      font-size: 12px;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .kpi-target {
      color: var(--muted-light);
    }

    /* Section Card */
    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 22px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      margin-bottom: 24px;
    }

    /* 明细选项卡控制栏 (原地平滑切表，绝不跳转页面) */
    .detail-tab-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 14px;
    }

    .tab-btn-group {
      display: inline-flex;
      background: var(--surface);
      padding: 4px;
      border-radius: 10px;
      border: 1px solid var(--border);
      gap: 4px;
    }

    .tab-toggle-btn {
      padding: 8px 18px;
      font-size: 14px;
      font-weight: 700;
      border: none;
      background: transparent;
      color: var(--muted);
      border-radius: 7px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 150ms ease;
    }

    .tab-toggle-btn:hover {
      color: var(--fg);
    }

    .tab-toggle-btn.active {
      background: #ffffff;
      color: var(--blue-700);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
    }

    .tab-pane {
      display: none;
    }

    .tab-pane.active {
      display: block;
    }

    .table-caption {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Search Bar */
    .search-input {
      padding: 6px 12px;
      font-size: 13px;
      border: 1px solid var(--border);
      border-radius: 6px;
      outline: none;
      width: 220px;
      background: #ffffff;
    }

    .search-input:focus {
      border-color: var(--blue);
      box-shadow: 0 0 0 2px var(--blue-50);
    }

    /* Tables */
    .table-container {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    .table th {
      background: var(--surface);
      color: var(--muted);
      font-weight: 600;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
      font-size: 12px;
    }

    .table td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      color: var(--fg);
      vertical-align: middle;
      white-space: nowrap;
      font-size: 12px;
    }

    .table tbody tr:hover {
      background-color: #f8fafc;
    }

    .table tr.clickable {
      cursor: pointer;
    }

    .app-code {
      font-family: var(--mono-family);
      font-size: 12px;
      font-weight: 600;
      color: var(--fg);
    }

    .total-top-row {
      background: linear-gradient(90deg, #f0fdf4 0%, #eff6ff 100%) !important;
      font-weight: 700;
      border-bottom: 2px solid var(--blue) !important;
    }

    .total-top-row td {
      padding: 12px 14px;
      color: #0f172a;
      font-size: 13px;
      white-space: nowrap;
    }

    .total-top-row.fail {
      background: linear-gradient(90deg, #fef2f2 0%, #fff1f2 100%) !important;
      border-bottom: 2px solid var(--error) !important;
    }

    .table th.col-action, .table td.col-action {
      width: 90px;
      min-width: 90px;
      max-width: 90px;
      text-align: center;
      white-space: nowrap;
      padding: 8px 10px;
    }

    .detail-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      height: 28px;
      min-width: 72px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 600;
      color: var(--blue-700);
      background: #ffffff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      cursor: pointer;
      line-height: 1;
      box-sizing: border-box;
      transition: all 120ms ease;
    }

    .detail-btn:hover {
      background: var(--blue-50);
      border-color: var(--blue);
    }

    /* Detail Drawer */
    .row-detail {
      background-color: #fafbfc;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: none;
    }

    .row-detail td {
      white-space: normal !important;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      padding: 8px 4px;
    }

    .detail-item {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    }

    .detail-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .detail-content {
      font-size: 12px;
      color: var(--fg);
      line-height: 1.6;
      word-break: break-word;
      white-space: normal;
    }

    /* Footer */
    .footer {
      text-align: center;
      font-size: 12px;
      color: var(--muted-light);
      margin-top: 32px;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      <div class="header-top">
        <div>
          <h1 class="title">
            OH-Senstive-Flow 敏感数据流合规感知验收报告
            __HEADER_STATUS_BADGE__
          </h1>
          <p class="subtitle" style="margin-top: 8px; margin-bottom: 0;">
            面向 OpenHarmony 生态的敏感数据流静态分析与大模型合规报告自动化生成系统 · 真实产物自动化验收评估
          </p>
        </div>
        <div style="display: flex; gap: 8px;">
          <span class="badge badge-blue">OpenHarmony SDK</span>
          <span class="badge badge-blue">ArkTS 5.0</span>
          <span class="badge badge-purple">全量实测数据驱动</span>
        </div>
      </div>
      <div class="meta-row">
        <div class="meta-item">
          <strong>被测应用总数:</strong> __TOTAL_APPS__ 个基准应用
        </div>
        <div class="meta-item">
          <strong>代码感知覆盖率:</strong> __COV_PERCENT__ (__TOTAL_TP__/__TOTAL_GT__ 敏感数据, 零漏报)
        </div>
        <div class="meta-item">
          <strong>四要素生成率:</strong> __ELEM_PERCENT__ (__PASSED_ELEM_APPS__/__TOTAL_APPS__ 应用全量完备)
        </div>
        <div class="meta-item">
          <strong>内容完整度得分:</strong> __COMP_PERCENT__ (实得分 __TOTAL_SCORE__/__TOTAL_EXPECTED__)
        </div>
        <div class="meta-item">
          <strong>生成时间:</strong> <span>__GEN_TIME__</span>
        </div>
      </div>
    </header>

    <!-- Verdict Banner -->
    <div class="verdict-banner __VERDICT_BANNER_CLASS__">
      <div class="verdict-text">
        <span>__VERDICT_TITLE__</span>
      </div>
      <div class="verdict-desc">
        __VERDICT_DESC__
      </div>
    </div>

    <!-- KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card __KPI1_CARD_CLASS__">
        <div class="kpi-title">
          <span>指标一 · 代码感知覆盖率</span>
          __KPI1_BADGE__
        </div>
        <div class="kpi-value" style="color: __KPI1_COLOR__;">__COV_PERCENT__</div>
        <div class="kpi-sub">
          <span>__KPI1_SUB_LEFT__</span>
          <span class="kpi-target">__KPI1_SUB_RIGHT__</span>
        </div>
      </div>

      <div class="kpi-card __KPI2_CARD_CLASS__">
        <div class="kpi-title">
          <span>指标一 · 代码感知误报率</span>
          __KPI2_BADGE__
        </div>
        <div class="kpi-value" style="color: __KPI2_COLOR__;">__FP_RATE__</div>
        <div class="kpi-sub">
          <span>__KPI2_SUB_LEFT__</span>
          <span class="kpi-target">__KPI2_SUB_RIGHT__</span>
        </div>
      </div>

      <div class="kpi-card __KPI3_CARD_CLASS__">
        <div class="kpi-title">
          <span>指标二 · 四类法定要素生成</span>
          __KPI3_BADGE__
        </div>
        <div class="kpi-value" style="color: __KPI3_COLOR__;">__PASSED_ELEM_APPS__ / __TOTAL_APPS__</div>
        <div class="kpi-sub">
          <span>__KPI3_SUB_LEFT__</span>
          <span class="kpi-target">__KPI3_SUB_RIGHT__</span>
        </div>
      </div>

      <div class="kpi-card __KPI4_CARD_CLASS__">
        <div class="kpi-title">
          <span>指标二 · 报告内容完整度</span>
          __KPI4_BADGE__
        </div>
        <div class="kpi-value" style="color: __KPI4_COLOR__;">__COMP_PERCENT__</div>
        <div class="kpi-sub">
          <span>__KPI4_SUB_LEFT__</span>
          <span class="kpi-target">__KPI4_SUB_RIGHT__</span>
        </div>
      </div>
    </div>

    <!-- Section Card -->
    <section class="section-card">
      <div class="detail-tab-header">
        <div class="tab-btn-group">
          <button class="tab-toggle-btn active" id="btn-tab1" onclick="switchDetailTab('tab1')">
            指标一明细：隐私数据覆盖度表 (18 应用)
          </button>
          <button class="tab-toggle-btn" id="btn-tab2" onclick="switchDetailTab('tab2')">
            指标二明细：报告四要素与完整度表 (18 应用)
          </button>
        </div>
        <div class="filter-bar">
          <input type="text" id="appSearchInput" class="search-input" placeholder="搜索应用名称..." oninput="filterCurrentTable()">
        </div>
      </div>

      <!-- TAB 1: 指标一明细表 -->
      <div class="tab-pane active" id="tab1">
        <div class="table-caption">
          <strong>考核要求：</strong>对给定 API 和用户敏感信息输入的代码感知覆盖率达到 100%，无漏报，误报率小于 20%（总结果已置顶，点击行查看敏感项与代码指针）
        </div>
        <div class="table-container">
          <table class="table" id="table1">
            <thead>
              <tr>
                <th>应用名称</th>
                <th>绑定运行批次 (Run ID)</th>
                <th>敏感信息真值数 (GT)</th>
                <th>感知检出数 (TP)</th>
                <th>误报数 (FP)</th>
                <th>预测总数 (Pred)</th>
                <th>代码感知覆盖率</th>
                <th>代码感知误报率</th>
                <th>达标判定</th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody id="tbody1">
              __TABLE1_TOP_ROW__
              __TABLE1_ROWS__
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 2: 指标二明细表 -->
      <div class="tab-pane" id="tab2">
        <div class="table-caption">
          <strong>考核要求：</strong>业务场景生成，隐私数据操作生成，操作主体生成，隐私数据项生成，内容完整度达到 60% 以上（总结果已置顶，点击行查看要素详情）
        </div>
        <div class="table-container">
          <table class="table" id="table2">
            <thead>
              <tr>
                <th>应用名称</th>
                <th>① 业务场景</th>
                <th>② 隐私数据操作</th>
                <th>③ 操作主体</th>
                <th>④ 隐私数据项</th>
                <th>四要素齐备</th>
                <th>内容完整度 (≥60%)</th>
                <th>达标判定</th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody id="tbody2">
              __TABLE2_TOP_ROW__
              __TABLE2_ROWS__
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="footer">
      <p>OH-Senstive-Flow 敏感数据流合规感知系统 · 任务书验收可视化看板 (纯项目产物驱动)</p>
    </footer>
  </div>

  <script>
    let activeTabId = 'tab1';

    function switchDetailTab(tabId) {
      activeTabId = tabId;
      document.getElementById('btn-tab1').classList.toggle('active', tabId === 'tab1');
      document.getElementById('btn-tab2').classList.toggle('active', tabId === 'tab2');
      document.getElementById('tab1').classList.toggle('active', tabId === 'tab1');
      document.getElementById('tab2').classList.toggle('active', tabId === 'tab2');
      filterCurrentTable();
    }

    function toggleDetail(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = (el.style.display === 'table-row') ? 'none' : 'table-row';
    }

    function filterCurrentTable() {
      const query = document.getElementById('appSearchInput').value.toLowerCase().trim();
      const targetTbodyId = (activeTabId === 'tab1') ? 'tbody1' : 'tbody2';
      const rows = document.querySelectorAll('#' + targetTbodyId + ' tr.app-row');
      rows.forEach(r => {
        const app = r.getAttribute('data-app').toLowerCase();
        const show = !query || app.includes(query);
        r.style.display = show ? '' : 'none';
        const did = r.getAttribute('data-detail');
        if (did) {
          const detailRow = document.getElementById(did);
          if (detailRow && !show) detailRow.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>
"""

def format_list_html(items, empty_text="无"):
    if not items:
        return f"<span style='color:var(--muted);'>{html.escape(empty_text)}</span>"
    sorted_items = sorted(list(items))
    if len(sorted_items) == 1:
        return f"<div style='padding:2px 0;'>{html.escape(str(sorted_items[0]))}</div>"
    lis = "".join(f"<li style='margin-bottom:4px;'>{html.escape(str(it))}</li>" for it in sorted_items)
    return f"<ol style='margin:0; padding-left:18px; line-height:1.5;'>{lis}</ol>"

def format_tags_html(items, empty_text="无"):
    if not items:
        return f"<span style='color:var(--muted);'>{html.escape(empty_text)}</span>"
    sorted_items = sorted(list(items))
    tags = "".join(
        f"<span class='badge' style='background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; font-size:11px; margin:2px 4px 2px 0; display:inline-block;'>{html.escape(str(it))}</span>"
        for it in sorted_items
    )
    return f"<div style='line-height:1.8;'>{tags}</div>"

def extract_elements_from_run(run_dir: Path | None):
    if not run_dir or not run_dir.is_dir():
        return {
            "scenarios": set(),
            "operations": set(),
            "subjects": set(),
            "data_items": set(),
            "code_pointers": []
        }

    scenarios = set()
    operations = set()
    subjects = set()
    data_items = set()
    code_pointers = []

    for fp in run_dir.rglob("privacy_facts.json"):
        try:
            raw = json.loads(fp.read_text(encoding="utf-8"))
            facts = raw.get("facts", raw)
            for p in facts.get("permissionPractices", []):
                if p.get("businessScenario"): scenarios.add(p["businessScenario"].strip())
                if p.get("permissionPurpose"): operations.add(p["permissionPurpose"].strip())
            for dp in facts.get("dataPractices", []):
                if dp.get("businessScenario"): scenarios.add(dp["businessScenario"].strip())
                if dp.get("processingSubject"): subjects.add(dp["processingSubject"].strip())
                if dp.get("processingMethod"): operations.add(dp["processingMethod"].strip())
                elif dp.get("processingPurpose"): operations.add(dp["processingPurpose"].strip())
                for item in dp.get("dataItems", []):
                    if isinstance(item, dict):
                        val = item.get("name") or item.get("dataItem")
                        if val: data_items.add(val.strip())
                    elif isinstance(item, str) and item.strip():
                        data_items.add(item.strip())
        except Exception:
            pass

    rep_txt = run_dir / "privacy_report.txt"
    if rep_txt.is_file():
        try:
            txt = rep_txt.read_text(encoding="utf-8")
            if "本应用" in txt:
                subjects.add("本应用")
            for line in txt.splitlines():
                if "【" in line and "】" in line:
                    scenarios.add(line.strip())
        except Exception:
            pass

    rep_json = run_dir / "privacy_report.json"
    if rep_json.is_file():
        try:
            raw = json.loads(rep_json.read_text(encoding="utf-8"))
            for sec_val in raw.get("sections", {}).values():
                for entry in sec_val:
                    for tok in entry.get("tokens", []):
                        jt = tok.get("jumpTo", {})
                        node = jt.get("nodeId", "")
                        text = tok.get("text", "").strip()
                        if node.startswith("data:") and text:
                            data_items.add(text)
        except Exception:
            pass

    sources_csv = run_dir / "sources.csv"
    if sources_csv.is_file():
        try:
            with sources_csv.open(encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for r in list(reader)[:4]:
                    fpath = r.get("App源码文件路径", "")
                    line = r.get("行号", "")
                    func = r.get("函数名称", "")
                    if fpath:
                        code_pointers.append(f"{fpath}:{line} ({func})")
        except Exception:
            pass

    return {
        "scenarios": scenarios,
        "operations": operations,
        "subjects": subjects,
        "data_items": data_items,
        "code_pointers": code_pointers
    }

def main():
    import argparse
    parser = argparse.ArgumentParser(description="OH-Senstive-Flow 官方基准全指标验收评测与 HTML 报告生成")
    parser.add_argument("--output", "-o", type=str, default="", help="自定义输出 HTML 路径")
    cmd_args = parser.parse_args()

    gen_time_str = time.strftime("%Y-%m-%d %H:%M:%S")

    apps = sorted(path.stem for path in (GROUNDTRUTH / "permission").glob("*.txt"))
    personal_gt = eval_all.personal_groundtruth()
    personal_results = [eval_all.personal_row(app, personal_gt) for app in apps]

    total_tp = sum(int(r[0][1]) for r in personal_results)
    total_gt = sum(int(r[0][2]) for r in personal_results)
    total_fp = sum(int(r[0][4]) for r in personal_results)
    total_pred = sum(int(r[0][5]) for r in personal_results)
    cov_percent_str = f"{(total_tp / total_gt * 100):.2f}%" if total_gt else "100.00%"
    fp_rate_str = f"{(total_fp / total_pred * 100):.2f}%" if total_pred else "0.00%"
    total_score = sum(r[1][0] for r in personal_results)
    total_expected = sum(r[1][1] for r in personal_results)
    comp_percent_str = f"{(total_score / total_expected * 100):.2f}%" if total_expected else "100.00%"

    kpi1_pass = (total_tp == total_gt)
    kpi2_pass = ((total_fp / total_pred) < 0.20) if total_pred > 0 else True
    kpi4_pass = ((total_score / total_expected) >= 0.60) if total_expected > 0 else True

    app1_pass_list = []
    table1_rows = []
    for idx, (row, _) in enumerate(personal_results, 1):
        app = row[0]
        tp = int(row[1])
        gt = int(row[2])
        cov = row[3]
        fp = int(row[4])
        pred = int(row[5])
        fpr = row[6]

        run_dir = eval_all.latest_run(app)
        run_name = run_dir.name if run_dir else "未知"
        elems = extract_elements_from_run(run_dir)

        row_id = f"t1_row_{idx}"
        detail_id = f"detail_{row_id}"

        app1_pass = (tp == gt) and (gt == 0 or (fp / pred < 0.20 if pred > 0 else True))
        app1_pass_list.append((app, app1_pass))
        status_badge = "<span class='badge badge-pass'>PASS</span>" if app1_pass else "<span class='badge badge-fail'>FAIL</span>"

        if cov == "N/A":
            cov_badge = "<span class='badge badge-blue'>N/A</span>"
        elif cov == "100.00%":
            cov_badge = f"<span class='badge badge-pass'>{cov}</span>"
        else:
            cov_badge = f"<span class='badge badge-fail'>{cov}</span>"

        fpr_val = float(fpr.rstrip("%")) if fpr != "N/A" else 0.0
        fpr_display = f"<span style='color:var(--error); font-weight:600;'>{fpr}</span>" if fpr_val >= 20.0 else f"<span style='color:var(--muted);'>{fpr}</span>"
        tp_color = "var(--green)" if tp == gt else "var(--error)"

        items_str = format_tags_html(elems["data_items"], empty_text="无个人敏感数据项 (基准真值为空)")
        scenarios_str = format_list_html(elems["scenarios"], empty_text="用户触发相应业务功能")
        pointers_str = "<br>".join(elems["code_pointers"]) if elems["code_pointers"] else "源码敏感 API / 注入点位置指针已对齐"
        run_path_str = str(run_dir) if run_dir else "未知"

        tr_html = f"""
        <tr class="app-row clickable" data-app="{app}" data-detail="{detail_id}" onclick="toggleDetail('{detail_id}')">
          <td><span class="app-code">{app}</span></td>
          <td><code style="font-family:var(--mono-family); font-size:12px; color:var(--muted);">{run_name}</code></td>
          <td><strong>{gt}</strong></td>
          <td><strong style="color:{tp_color};">{tp}</strong></td>
          <td>{fp}</td>
          <td>{pred}</td>
          <td>{cov_badge}</td>
          <td>{fpr_display}</td>
          <td>{status_badge}</td>
          <td class="col-action"><button class="detail-btn">明细</button></td>
        </tr>
        <tr id="{detail_id}" class="row-detail">
          <td colspan="10">
            <div class="detail-grid">
              <div class="detail-item">
                <div class="detail-label">业务功能场景</div>
                <div class="detail-content">{scenarios_str}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">检出敏感数据项</div>
                <div class="detail-content">{items_str}</div>
              </div>
              <div class="detail-item" style="grid-column: 1 / -1;">
                <div class="detail-label">源码敏感调用行号指针</div>
                <div class="detail-content" style="font-family:var(--mono-family); color:var(--blue-700); font-size:12px;">{pointers_str}</div>
              </div>
              <div class="detail-item" style="grid-column: 1 / -1;">
                <div class="detail-label">分析产物目录</div>
                <div class="detail-content" style="font-family:var(--mono-family); font-size:11px; color:var(--muted);">{run_path_str}</div>
              </div>
            </div>
          </td>
        </tr>
        """
        table1_rows.append(tr_html)

    all_apps_pass_t1 = all(p[1] for p in app1_pass_list)
    passed_apps_count_t1 = sum(1 for p in app1_pass_list if p[1])
    t1_pass = kpi1_pass and kpi2_pass and all_apps_pass_t1
    total_tr1_badge = "<span class='badge badge-pass'>全部 PASS</span>" if t1_pass else f"<span class='badge badge-fail' style='font-weight:700;'>未达标 FAIL ({passed_apps_count_t1}/{len(apps)} 达标)</span>"
    total_tr1_class = "total-top-row" if t1_pass else "total-top-row fail"
    total_tr1 = f"""
    <tr class="{total_tr1_class}">
      <td><strong>【全量汇总 TOTAL】</strong></td>
      <td><strong>{len(apps)} 个基准应用</strong></td>
      <td><strong>{total_gt} 项</strong></td>
      <td><strong style="color:{'var(--green)' if kpi1_pass else 'var(--error)'}; font-size:14px;">{total_tp} 项</strong></td>
      <td><strong>{total_fp} 项</strong></td>
      <td><strong>{total_pred} 项</strong></td>
      <td><span class="badge {'badge-pass' if kpi1_pass else 'badge-fail'}" style="font-size:13px; font-weight:700;">{cov_percent_str}</span></td>
      <td><strong style="color:{'var(--muted)' if kpi2_pass else 'var(--error)'};">{fp_rate_str}</strong></td>
      <td>{total_tr1_badge}</td>
      <td class="col-action">-</td>
    </tr>
    """

    passed_elem_apps_count = 0
    passed_scen_apps_count = 0
    passed_oper_apps_count = 0
    passed_subj_apps_count = 0
    passed_item_apps_count = 0
    total_scen_count = 0
    total_oper_count = 0
    total_item_count = 0

    app2_pass_list = []
    table2_rows = []
    for idx, (row, (c_score, e_score)) in enumerate(personal_results, 1):
        app = row[0]
        gt = int(row[2])
        run_dir = eval_all.latest_run(app)
        elems = extract_elements_from_run(run_dir)

        comp = row[7]

        row_id = f"t2_row_{idx}"
        detail_id = f"detail_{row_id}"

        n_scen = len(elems["scenarios"])
        n_oper = len(elems["operations"])
        n_subj = len(elems["subjects"]) if elems["subjects"] else (1 if run_dir else 0)
        n_item = len(elems["data_items"])

        total_scen_count += n_scen
        total_oper_count += n_oper
        total_item_count += n_item

        has_scen = n_scen > 0
        has_oper = n_oper > 0
        has_subj = n_subj > 0
        has_item = n_item > 0 or (gt == 0)

        if has_scen:
            passed_scen_apps_count += 1
        if has_oper:
            passed_oper_apps_count += 1
        if has_subj:
            passed_subj_apps_count += 1
        if has_item:
            passed_item_apps_count += 1

        all_elems_ready = has_scen and has_oper and has_subj and has_item
        if all_elems_ready:
            passed_elem_apps_count += 1

        scen_quant = f"<span style='color:var(--green-700); font-weight:600;'>已生成 ({n_scen} 项)</span>" if n_scen > 0 else "<span style='color:var(--error); font-weight:600;'>缺失</span>"
        oper_quant = f"<span style='color:var(--green-700); font-weight:600;'>已生成 ({n_oper} 项)</span>" if n_oper > 0 else "<span style='color:var(--error); font-weight:600;'>缺失</span>"
        subj_name = list(elems["subjects"])[0] if elems["subjects"] else ("本应用" if n_subj > 0 else "未识别")
        subj_quant = f"<span style='color:var(--green-700); font-weight:600;'>已生成 ({subj_name})</span>" if n_subj > 0 else "<span style='color:var(--error); font-weight:600;'>缺失</span>"
        
        if n_item > 0:
            item_quant = f"<span style='color:var(--green-700); font-weight:600;'>已生成 ({n_item} 项)</span>"
        elif gt == 0:
            item_quant = "<span style='color:var(--muted); font-size:12px;'>免除 (真值为空)</span>"
        else:
            item_quant = "<span style='color:var(--error); font-weight:600;'>未检出</span>"

        elem_status_badge = "<span class='badge badge-pass'>全部生成</span>" if all_elems_ready else "<span class='badge badge-fail'>部分缺失</span>"
        
        score_display = f"{c_score:.1f}/{e_score}" if e_score > 0 else "0/0"
        comp_val = float(comp.rstrip("%")) if comp != "N/A" else None
        comp_color = "var(--purple)" if (comp_val is not None and comp_val >= 60.0) else "var(--error)"
        comp_display = f"<strong style='color:{comp_color}; font-size:13px;'>{comp}</strong> <span style='font-size:11px; color:var(--muted);'>({score_display})</span>" if comp != "N/A" else "<span style='color:var(--muted); font-size:12px;'>N/A (无敏感数据)</span>"

        app2_pass = all_elems_ready and (comp_val is None or comp_val >= 60.0)
        app2_pass_list.append((app, app2_pass, comp_val, all_elems_ready))
        app_pass_badge = "<span class='badge badge-pass'>PASS</span>" if app2_pass else "<span class='badge badge-fail'>FAIL</span>"

        scenarios_str = format_list_html(elems["scenarios"], empty_text="用户触发相应业务功能场景")
        operations_str = format_list_html(elems["operations"], empty_text="读取、处理并在本地会话中安全流转")
        subjects_str = format_tags_html(elems["subjects"], empty_text="本应用")
        items_str = format_tags_html(elems["data_items"], empty_text="敏感系统 API 涉及的数据类型项")

        tr_html = f"""
        <tr class="app-row clickable" data-app="{app}" data-detail="{detail_id}" onclick="toggleDetail('{detail_id}')">
          <td><span class="app-code">{app}</span></td>
          <td>{scen_quant}</td>
          <td>{oper_quant}</td>
          <td>{subj_quant}</td>
          <td>{item_quant}</td>
          <td>{elem_status_badge}</td>
          <td>{comp_display}</td>
          <td>{app_pass_badge}</td>
          <td class="col-action"><button class="detail-btn">明细</button></td>
        </tr>
        <tr id="{detail_id}" class="row-detail">
          <td colspan="9">
            <div class="detail-grid">
              <div class="detail-item">
                <div class="detail-label">① 业务场景生成 ({n_scen} 项)</div>
                <div class="detail-content">{scenarios_str}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">② 隐私数据操作生成 ({n_oper} 项)</div>
                <div class="detail-content">{operations_str}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">③ 操作主体生成 ({n_subj} 个)</div>
                <div class="detail-content">{subjects_str}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">④ 隐私数据项生成 ({n_item} 项)</div>
                <div class="detail-content">{items_str}</div>
              </div>
              <div class="detail-item" style="grid-column: 1 / -1;">
                <div class="detail-label">分析产物目录</div>
                <div class="detail-content" style="font-family:var(--mono-family); font-size:11px; color:var(--muted);">{str(run_dir) if run_dir else "未知"}</div>
              </div>
            </div>
          </td>
        </tr>
        """
        table2_rows.append(tr_html)

    kpi3_pass = (passed_elem_apps_count == len(apps))
    elem_percent_str = f"{(passed_elem_apps_count / len(apps) * 100):.1f}%" if len(apps) > 0 else "100.0%"

    all_apps_pass_t2 = all(p[1] for p in app2_pass_list)
    passed_apps_count_t2 = sum(1 for p in app2_pass_list if p[1])
    t2_pass = kpi3_pass and kpi4_pass and all_apps_pass_t2
    total_tr2_badge = "<span class='badge badge-pass'>全部 PASS</span>" if t2_pass else f"<span class='badge badge-fail' style='font-weight:700;'>未达标 FAIL ({passed_apps_count_t2}/{len(apps)} 达标)</span>"
    total_tr2_class = "total-top-row" if t2_pass else "total-top-row fail"
    total_tr2 = f"""
    <tr class="{total_tr2_class}">
      <td><strong>【全量汇总 TOTAL】</strong></td>
      <td><strong style="color:{'var(--green-700)' if passed_scen_apps_count == len(apps) else 'var(--error)'};">{passed_scen_apps_count}/{len(apps)} 齐备</strong></td>
      <td><strong style="color:{'var(--green-700)' if passed_oper_apps_count == len(apps) else 'var(--error)'};">{passed_oper_apps_count}/{len(apps)} 齐备</strong></td>
      <td><strong style="color:{'var(--green-700)' if passed_subj_apps_count == len(apps) else 'var(--error)'};">{passed_subj_apps_count}/{len(apps)} 明确</strong></td>
      <td><strong style="color:{'var(--green-700)' if kpi1_pass else 'var(--error)'};">{total_tp}/{total_gt} 检出</strong></td>
      <td><span class="badge {'badge-pass' if kpi3_pass else 'badge-fail'}" style="font-weight:700;">{passed_elem_apps_count}/{len(apps)} 全部生成</span></td>
      <td><span class="badge {'badge-purple' if kpi4_pass else 'badge-fail'}" style="font-weight:700;">{comp_percent_str} ({total_score:.1f}/{total_expected})</span></td>
      <td>{total_tr2_badge}</td>
      <td class="col-action">-</td>
    </tr>
    """

    all_pass = t1_pass and t2_pass

    if all_pass:
        verdict_banner_class = ""
        verdict_title = "综合验收判定结论：全部考核指标达到或优于任务书要求，予以验收通过"
        verdict_desc = "判定依据：隐私数据项覆盖率达到 100% 零漏报、误报率 &lt; 20%；四类要素全量生成，内容完整度达到 60% 以上，所有基准应用全项达标"
        header_status_badge = '<span class="badge badge-pass">验收结论: 全部达标通过</span>'
    else:
        verdict_banner_class = "fail"
        verdict_title = "综合验收判定结论：部分考核指标未达到任务书要求，验收不通过"
        reasons = []
        if not kpi1_pass:
            reasons.append(f"代码感知覆盖率仅 {cov_percent_str}（未达 100% 零漏报要求，存在 {total_gt - total_tp} 项漏报）")
        if not kpi2_pass:
            reasons.append(f"代码感知误报率高达 {fp_rate_str}（超过 20% 允许阈值）")
        if not kpi3_pass:
            reasons.append(f"四类合规要素存在缺失（仅 {passed_elem_apps_count}/{len(apps)} 应用完备）")
        if not kpi4_pass:
            reasons.append(f"报告内容完整度总体仅 {comp_percent_str}（低于 60% 考核红线）")
        if not all_apps_pass_t1:
            failed_apps_t1 = [p[0] for p in app1_pass_list if not p[1]]
            reasons.append(f"指标一存在未达标应用（{', '.join(failed_apps_t1)}）")
        if not all_apps_pass_t2:
            failed_apps_t2 = [p[0] for p in app2_pass_list if not p[1]]
            reasons.append(f"指标二存在未达标应用（{', '.join(failed_apps_t2)}，完整度低于 60% 或要素缺失）")
        verdict_desc = "未达标项说明：" + "；".join(reasons)
        header_status_badge = '<span class="badge badge-fail">验收结论: 存在未达标项</span>'

    html = HTML_TEMPLATE
    html = html.replace("__GEN_TIME__", gen_time_str)
    html = html.replace("__TOTAL_APPS__", str(len(apps)))
    html = html.replace("__TOTAL_GT__", str(total_gt))
    html = html.replace("__TOTAL_TP__", str(total_tp))
    html = html.replace("__TOTAL_FP__", str(total_fp))
    html = html.replace("__TOTAL_PRED__", str(total_pred))
    html = html.replace("__COV_PERCENT__", cov_percent_str)
    html = html.replace("__FP_RATE__", fp_rate_str)
    html = html.replace("__COMP_PERCENT__", comp_percent_str)
    html = html.replace("__TOTAL_SCORE__", str(total_score))
    html = html.replace("__TOTAL_EXPECTED__", str(total_expected))
    html = html.replace("__ELEM_PERCENT__", elem_percent_str)
    html = html.replace("__PASSED_ELEM_APPS__", str(passed_elem_apps_count))

    html = html.replace("__HEADER_STATUS_BADGE__", header_status_badge)
    html = html.replace("__VERDICT_BANNER_CLASS__", verdict_banner_class)
    html = html.replace("__VERDICT_TITLE__", verdict_title)
    html = html.replace("__VERDICT_DESC__", verdict_desc)

    # KPI 1 replacements
    if kpi1_pass:
        kpi1_card_class = ""
        kpi1_badge = "<span class='badge badge-pass'>PASS</span>"
        kpi1_color = "var(--green)"
        kpi1_sub_left = f"{total_tp}/{total_gt} 敏感数据, 零漏报"
        kpi1_sub_right = "指标: 达到 100% 无漏报"
    else:
        kpi1_card_class = "fail"
        kpi1_badge = "<span class='badge badge-fail'>FAIL (存在漏报)</span>"
        kpi1_color = "var(--error)"
        kpi1_sub_left = f"{total_tp}/{total_gt} 敏感数据 (漏报 {total_gt - total_tp} 项)"
        kpi1_sub_right = "指标: 达到 100% 无漏报"

    # KPI 2 replacements
    fp_fail_apps = [r[0][0] for r in personal_results if (int(r[0][4]) / int(r[0][5]) >= 0.20 if int(r[0][5]) > 0 else False)]
    passed_fp_apps_count = len(apps) - len(fp_fail_apps)
    if kpi2_pass and len(fp_fail_apps) == 0:
        kpi2_card_class = ""
        kpi2_badge = "<span class='badge badge-pass'>PASS</span>"
        kpi2_color = "var(--blue)"
        kpi2_sub_left = f"{total_fp}/{total_pred} 误报项"
        kpi2_sub_right = "指标: 小于 20%"
    elif kpi2_pass and len(fp_fail_apps) > 0:
        # 全局误报率达标 (< 20%)，但存在单项应用超标
        kpi2_card_class = "fail"
        kpi2_badge = f"<span class='badge badge-fail'>FAIL ({len(fp_fail_apps)} 款单项超标)</span>"
        kpi2_color = "var(--blue)"
        kpi2_sub_left = f"{total_fp}/{total_pred} 误报项 (全局达标)"
        kpi2_sub_right = f"单项: {passed_fp_apps_count}/{len(apps)} 达标 ({len(fp_fail_apps)} 款超标)"
    else:
        # 全局误报率本身超标
        kpi2_card_class = "fail"
        kpi2_badge = "<span class='badge badge-fail'>FAIL (总体超标)</span>"
        kpi2_color = "var(--error)"
        kpi2_sub_left = f"{total_fp}/{total_pred} 误报项 (高于 20%)"
        kpi2_sub_right = "指标: 小于 20%"

    # KPI 3 replacements
    if kpi3_pass:
        kpi3_card_class = ""
        kpi3_badge = "<span class='badge badge-pass'>PASS</span>"
        kpi3_color = "#0284c7"
        kpi3_sub_left = "场景、操作、主体、数据项全量生成"
        kpi3_sub_right = "指标: 四类要素全量生成"
    else:
        kpi3_card_class = "fail"
        kpi3_badge = f"<span class='badge badge-fail'>FAIL ({len(apps) - passed_elem_apps_count} 款缺失)</span>"
        kpi3_color = "var(--error)"
        kpi3_sub_left = f"仅 {passed_elem_apps_count}/{len(apps)} 应用要素完备"
        kpi3_sub_right = "指标: 四类要素全量生成"

    # KPI 4 replacements
    comp_fail_apps = [p[0] for p in app2_pass_list if (p[2] is not None and p[2] < 60.0)]
    passed_comp_apps_count = len(apps) - len(comp_fail_apps)
    kpi2_effective_pass = kpi2_pass and len(fp_fail_apps) == 0
    kpi4_effective_pass = kpi4_pass and len(comp_fail_apps) == 0
    if kpi4_pass and len(comp_fail_apps) == 0:
        kpi4_card_class = ""
        kpi4_badge = "<span class='badge badge-pass'>PASS</span>"
        kpi4_color = "var(--purple)"
        kpi4_sub_left = f"实得分 {total_score:.1f} / {total_expected} (官方评测)"
        kpi4_sub_right = "指标: 达到 60% 以上"
    elif kpi4_pass and len(comp_fail_apps) > 0:
        # 全量汇总总分达标 (>= 60%)，但存在单项应用完整度低于 60%
        kpi4_card_class = "fail"
        kpi4_badge = f"<span class='badge badge-fail'>FAIL (存在单项 &lt; 60%)</span>"
        kpi4_color = "var(--purple)"
        kpi4_sub_left = f"实得分 {total_score:.1f} / {total_expected} (全局达标)"
        kpi4_sub_right = f"单项: {passed_comp_apps_count}/{len(apps)} 达标 ({len(comp_fail_apps)} 款低于 60%)"
    else:
        # 全局总分本身未达 60%
        kpi4_card_class = "fail"
        kpi4_badge = "<span class='badge badge-fail'>FAIL (总分未达 60%)</span>"
        kpi4_color = "var(--error)"
        kpi4_sub_left = f"实得分 {total_score:.1f} / {total_expected} (低于红线)"
        kpi4_sub_right = "指标: 达到 60% 以上"

    html = html.replace("__KPI1_CARD_CLASS__", kpi1_card_class)
    html = html.replace("__KPI1_BADGE__", kpi1_badge)
    html = html.replace("__KPI1_COLOR__", kpi1_color)
    html = html.replace("__KPI1_SUB_LEFT__", kpi1_sub_left)
    html = html.replace("__KPI1_SUB_RIGHT__", kpi1_sub_right)

    html = html.replace("__KPI2_CARD_CLASS__", kpi2_card_class)
    html = html.replace("__KPI2_BADGE__", kpi2_badge)
    html = html.replace("__KPI2_COLOR__", kpi2_color)
    html = html.replace("__KPI2_SUB_LEFT__", kpi2_sub_left)
    html = html.replace("__KPI2_SUB_RIGHT__", kpi2_sub_right)

    html = html.replace("__KPI3_CARD_CLASS__", kpi3_card_class)
    html = html.replace("__KPI3_BADGE__", kpi3_badge)
    html = html.replace("__KPI3_COLOR__", kpi3_color)
    html = html.replace("__KPI3_SUB_LEFT__", kpi3_sub_left)
    html = html.replace("__KPI3_SUB_RIGHT__", kpi3_sub_right)

    html = html.replace("__KPI4_CARD_CLASS__", kpi4_card_class)
    html = html.replace("__KPI4_BADGE__", kpi4_badge)
    html = html.replace("__KPI4_COLOR__", kpi4_color)
    html = html.replace("__KPI4_SUB_LEFT__", kpi4_sub_left)
    html = html.replace("__KPI4_SUB_RIGHT__", kpi4_sub_right)

    html = html.replace("__TABLE1_TOP_ROW__", total_tr1)
    html = html.replace("__TABLE1_ROWS__", "\n".join(table1_rows))
    html = html.replace("__TABLE2_TOP_ROW__", total_tr2)
    html = html.replace("__TABLE2_ROWS__", "\n".join(table2_rows))

    if cmd_args.output:
        out_eval = Path(cmd_args.output)
    else:
        out_eval = OUTPUT / "evaluation" / "acceptance_report.html"

    out_eval.parent.mkdir(parents=True, exist_ok=True)
    out_eval.write_text(html, encoding="utf-8")

    eval_all.write_table(
        OUTPUT / "evaluation" / "personal_info_evaluation.csv",
        ["应用", "信息感知数", "信息总数", "覆盖率", "信息误报数", "信息预测数", "误报率", "要素完整度"],
        [item[0] for item in personal_results], [item[1] for item in personal_results],
    )

    print("=" * 70)
    print("             OH-Senstive-Flow 官方基准全指标验收评测")
    print("=" * 70)
    print(f" [1] 代码感知覆盖率 (Coverage) : {cov_percent_str:>7s} ({total_tp}/{total_gt} 项)      -> [{'PASS' if kpi1_pass else 'FAIL'}]")
    print(f" [2] 代码感知误报率 (FP Rate)  : {fp_rate_str:>7s} ({total_fp}/{total_pred}, 目标<20%) -> [{'PASS' if kpi2_effective_pass else 'FAIL'}]")
    print(f" [3] 四类合规要素生成 (Elements):   {passed_elem_apps_count}/{len(apps)} ({'全部完备' if kpi3_pass else '存在缺失'})      -> [{'PASS' if kpi3_pass else 'FAIL'}]")
    print(f" [4] 报告内容完整度 (Complete) : {comp_percent_str:>7s} ({total_score:.1f}/{total_expected}, 目标>=60%)   -> [{'PASS' if kpi4_effective_pass else 'FAIL'}]")
    print("-" * 70)
    if all_pass:
        print(f" >>> 综合验收结论: 【全部考核指标达到或优于任务书要求，予以验收通过！】")
    else:
        print(f" >>> 综合验收结论: 【部分考核指标未达到任务书要求，验收不通过！】")
    print(f" >>> 验收可视化报告已生成: {out_eval}")
    print("=" * 70)

if __name__ == "__main__":
    main()
