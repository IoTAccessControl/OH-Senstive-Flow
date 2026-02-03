#!/usr/bin/env python3
"""隐私数据流分析主入口"""
import argparse
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent.system_prompt import SYSTEM_PROMPT
from agent.dataflow_agent import DataFlowAgent
from agent.report_agent import ReportAgent
from tools.analyzer import GetFuncImpl
from tools.harmony_api import HarmonyApiAnalyzer
from tools.flow_selector import FlowSelector
from tools.classifier import DataFlowClassifier
from memory.memory import ReadDataFlowMemory, WriteDataFlowMemory, ReadFuncImplMemory, WriteFuncImplMemory
from utils.html_generator import HtmlGenerator


def parse_args():
    parser = argparse.ArgumentParser(description="隐私数据流分析工具")

    parser.add_argument(
        "--code_base",
        type=str,
        required=True,
        help="Code base directory name (relative to data path)"
    )

    parser.add_argument(
        "--max_flows",
        type=int,
        default=5,
        help="Maximum number of privacy flows to analyze (default: 5)"
    )

    parser.add_argument(
        "--model",
        type=str,
        default="qwen3-coder-plus",
        help="Model name, e.g. qwen3-coder-plus, qwen-max"
    )

    return parser.parse_args()


def main():
    load_dotenv()
    api_key = os.getenv("DASHSCOPE_API_KEY")
    data_path = os.getenv("DATA_PATH", "./data")
    result_path = os.getenv("RESULT_PATH", "./results")

    if not api_key:
        print("错误: 未设置DASHSCOPE_API_KEY")
        sys.exit(1)

    args = parse_args()
    model = args.model
    code_base_path = Path(data_path) / args.code_base
    max_flows = args.max_flows

    os.makedirs(result_path, exist_ok=True)

    # ========== Step 1: analyze_harmony_api.py ==========
    print("\n" + "=" * 60)
    print("Step 1: 分析鸿蒙API调用")
    print("=" * 60)

    api_analyzer = HarmonyApiAnalyzer(str(code_base_path))
    api_results, file_count = api_analyzer.analyze_all()

    api_results_file = Path(result_path) / "harmony_api_results.json"
    with open(api_results_file, 'w', encoding='utf-8') as f:
        json.dump(api_results, f, ensure_ascii=False, indent=2)

    print(f"分析了 {file_count} 个文件")
    print(f"发现 {len(api_results)} 个HarmonyOS API调用")
    print(f"结果已保存: {api_results_file}")

    # ========== Step 2: privacy_flow_analyzer.py ==========
    print("\n" + "=" * 60)
    print("Step 2: 分析隐私数据流")
    print("=" * 60)

    if not api_results_file.exists():
        print(f"错误: 找不到 {api_results_file}")
        sys.exit(1)

    flow_selector = FlowSelector()
    flow_pairs = flow_selector.select_privacy_flow_pairs(str(api_results_file))
    print(f"共 {len(flow_pairs)} 组隐私数据流")

    if not flow_pairs:
        print("错误: 未找到隐私相关API调用")
        sys.exit(1)

    client = OpenAI(
        api_key=api_key,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
    )

    all_results = []

    for pair in flow_pairs[:max_flows]:
        print(f"\n{'='*50}")
        print(f"开始分析 Flow {pair['flow_id']}: {pair['api_type']}")
        print(f"起点: {pair['start']}")
        print(f"终点: {pair['end']}")
        print(f"{'='*50}")

        memory_data_flow_file = Path(result_path) / f"memory_data_flow_{pair['flow_id']}.json"
        memory_func_impl_file = Path(result_path) / f"memory_func_impl_{pair['flow_id']}.txt"

        tools = {
            "GetFuncImpl": GetFuncImpl(str(code_base_path)),
            "ReadDataFlowMemory": ReadDataFlowMemory(str(memory_data_flow_file)),
            "WriteDataFlowMemory": WriteDataFlowMemory(str(memory_data_flow_file)),
            "ReadFuncImplMemory": ReadFuncImplMemory(str(memory_func_impl_file)),
            "WriteFuncImplMemory": WriteFuncImplMemory(str(memory_func_impl_file)),
        }

        agent = DataFlowAgent(
            client=client,
            system_prompt=SYSTEM_PROMPT,
            model=model,
            tools=tools,
            start=pair['start'],
            end=pair['end'],
            target_var=pair['target_var'],
            flow_id=pair['flow_id']
        )

        flow_steps = agent.run()

        all_results.append({
            "flow_id": pair['flow_id'],
            "api_type": pair['api_type'],
            "target_var": pair['target_var'],
            "start": {"file": pair['start'][0], "line": pair['start'][1]},
            "end": {"file": pair['end'][0], "line": pair['end'][1]},
            "steps": flow_steps
        })

        # 清理临时文件
        if memory_data_flow_file.exists():
            memory_data_flow_file.unlink()
        if memory_func_impl_file.exists():
            memory_func_impl_file.unlink()

    # 保存数据流结果
    output_json = Path(result_path) / "data_flow_results.json"
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"\n数据流结果已保存: {output_json}")

    # 生成HTML可视化
    html_generator = HtmlGenerator()
    html_output = Path(result_path) / "data_flow_visualization.html"
    html_generator.generate(all_results, str(html_output))

    # ========== Step 3: classify_and_distribute.py ==========
    print("\n" + "=" * 60)
    print("Step 3: 分类数据流")
    print("=" * 60)

    classifier = DataFlowClassifier()
    classified_flows = classifier.distribute_data_flows(
        str(output_json),
        result_path
    )

    summary = classifier.generate_module_summary(str(code_base_path), classified_flows)
    summary_file = Path(result_path) / "module_summary.json"
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"模块摘要已生成: {summary_file}")

    # 为每个模块生成数据流可视化HTML
    print("\n" + "=" * 60)
    print("生成模块数据流可视化页面")
    print("=" * 60)

    for module_name in summary.get("modules_found", []):
        module_data_flow_file = Path(result_path) / module_name / "data_flow_results.json"
        if module_data_flow_file.exists():
            with open(module_data_flow_file, 'r', encoding='utf-8') as f:
                module_flows = json.load(f)
            module_html_output = Path(result_path) / module_name / "data_flow_visualization.html"
            html_generator.generate(module_flows, str(module_html_output), module_name)
            print(f"  -> {module_name} 可视化页面已生成")

    # ========== Step 4: generate_privacy_report.py ==========
    print("\n" + "=" * 60)
    print("Step 4: 生成隐私报告")
    print("=" * 60)

    report_agent = ReportAgent()
    reports = []

    for module_dir in Path(result_path).iterdir():
        if module_dir.is_dir():
            report = report_agent.generate_module_report(module_dir)
            if report:
                reports.append((module_dir.name, report))
                print(f"  -> 已生成报告: {module_dir.name}/report.md")

    merged_report_path = report_agent.merge_reports(Path(result_path), reports)
    print(f"\n完整报告已生成: {merged_report_path}")

    # ========== Step 5: 生成索引页面 ==========
    print("\n" + "=" * 60)
    print("Step 5: 生成模块索引页面")
    print("=" * 60)

    modules = [{"name": name} for name in summary.get("modules_found", [])]
    html_generator.generate_index_page(result_path, modules)

    print("\n" + "=" * 60)
    print("分析完成!")
    print("=" * 60)


if __name__ == "__main__":
    main()
