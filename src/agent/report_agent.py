"""报告生成Agent"""
import json
import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI


class ReportAgent:
    """从generate_privacy_report.py迁移"""

    def __init__(self, model: str = "qwen3-32b"):
        load_dotenv()
        self.model = model
        self.client = OpenAI(
            api_key=os.getenv("DASHSCOPE_API_KEY"),
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
        )

    def generate_privacy_report(self, flow_data: list, module_name: str) -> str:
        """使用LLM生成隐私声明报告"""
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

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "你是一个隐私分析专家，擅长分析应用的数据流并生成隐私声明报告。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            extra_body={"enable_thinking": False}
        )

        return response.choices[0].message.content

    def generate_module_report(self, module_dir: Path) -> str:
        """为单个模块生成报告"""
        data_flow_file = module_dir / "data_flow_results.json"
        report_file = module_dir / "report.md"

        if not data_flow_file.exists():
            return None

        with open(data_flow_file, 'r', encoding='utf-8') as f:
            flow_data = json.load(f)

        report = self.generate_privacy_report(flow_data, module_dir.name)

        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(f"# {module_dir.name} 隐私声明报告\n\n")
            f.write(report)

        return report

    def merge_reports(self, result_path: Path, reports: list) -> Path:
        """合并所有报告"""
        merged_report_path = result_path / "report.md"
        with open(merged_report_path, 'w', encoding='utf-8') as f:
            f.write("# 隐私声明完整报告\n\n")
            f.write("---\n\n")

            for module_name, report in reports:
                f.write(f"## {module_name}\n\n")
                f.write(report)
                f.write("\n\n---\n\n")

        return merged_report_path
