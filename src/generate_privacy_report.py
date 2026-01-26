"""
生成隐私声明报告
使用LLM为每个功能模块的data_flow_results.json生成隐私声明报告，
并合并所有报告到results/report.md
"""

import json
import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

# 加载环境变量
load_dotenv()

# 初始化DashScope客户端
client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

RESULT_PATH = os.getenv("RESULT_PATH", "./results")

def generate_privacy_report(flow_data: list, module_name: str) -> str:
    """使用LLM生成隐私声明报告"""
    # 构建prompt
    prompt = f"""请分析以下HarmonyOS应用的数据流信息，生成一份简短的隐私声明报告（用中文）。

功能模块：{module_name}

数据流信息：
{json.dumps(flow_data, ensure_ascii=False, indent=2)}

请生成一份简短的隐私声明报告，包括：
1. 该模块涉及的主要数据类型
2. 数据收集和使用目的
3. 隐私风险评估（低/中/高）
4. 简要的隐私保护建议

请用Markdown格式输出，保持简洁。"""

    response = client.chat.completions.create(
        model="qwen3-32b",
        messages=[
            {"role": "system", "content": "你是一个隐私分析专家，擅长分析应用的数据流并生成隐私声明报告。"},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3,
        extra_body={"enable_thinking": False}
    )

    return response.choices[0].message.content

def main():
    result_path = Path(RESULT_PATH)
    reports = []

    # 遍历所有功能模块目录
    for module_dir in result_path.iterdir():
        if module_dir.is_dir():
            data_flow_file = module_dir / "data_flow_results.json"
            report_file = module_dir / "report.md"

            if data_flow_file.exists():
                print(f"处理模块: {module_dir.name}")

                # 读取数据流结果
                with open(data_flow_file, 'r', encoding='utf-8') as f:
                    flow_data = json.load(f)

                # 生成隐私声明报告
                report = generate_privacy_report(flow_data, module_dir.name)

                # 保存模块报告
                with open(report_file, 'w', encoding='utf-8') as f:
                    f.write(f"# {module_dir.name} 隐私声明报告\n\n")
                    f.write(report)

                print(f"  -> 已生成报告: {report_file}")
                reports.append((module_dir.name, report))

    # 合并所有报告
    merged_report_path = result_path / "report.md"
    with open(merged_report_path, 'w', encoding='utf-8') as f:
        f.write("# 隐私声明完整报告\n\n")
        f.write("---\n\n")

        for module_name, report in reports:
            f.write(f"## {module_name}\n\n")
            f.write(report)
            f.write("\n\n---\n\n")

    print(f"\n已生成完整报告: {merged_report_path}")

if __name__ == "__main__":
    main()
