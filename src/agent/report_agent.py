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
        # 为每个flow准备节点摘要信息
        flow_summary = []
        for flow in flow_data:
            flow_id = flow.get('flow_id', 1)
            steps = flow.get('steps', [])
            step_summaries = []
            for idx, step in enumerate(steps):
                step_summaries.append(f"  节点{idx}: {step.get('desc', '')} (文件:{step.get('file', '').split('/')[-1]}, 行:{step.get('line', '')})")
            flow_summary.append(f"数据流{flow_id}:\n" + "\n".join(step_summaries))

        prompt = f"""请分析以下HarmonyOS应用的数据流信息，生成一份简短的隐私声明报告（用中文）。

功能模块：{module_name}

数据流信息：
{json.dumps(flow_data, ensure_ascii=False, indent=2)}

节点详情摘要：
{chr(10).join(flow_summary)}

请生成一份简短的隐私声明报告，包括：

## 1 我们如何收集和使用您的个人信息

[开场白]

### 1.1 功能名称

为了[提供什么服务]，在您授权的情况下，我们会[收集内容]。这些信息[处理方式]。

**重要**：在描述数据流时，请为每个关键描述句子添加节点引用标记，格式为 `[[flow_id:X, step:Y]]`，其中X是数据流编号，Y是该数据流中的步骤索引（从0开始）。例如：`为了展示设备信息，我们会读取设备型号 [[flow_id:1, step:0]]`。

[如有风险，添加提醒]

### 1.2 功能名称

...

## 2 设备权限调用

权限名称：当您使用【什么功能】，我们需要【什么权限】读取【什么信息】以便【用途】。关闭后【影响】。

**重要**：同样请为涉及数据流描述的句子添加节点引用标记。

请用Markdown格式输出，保持简洁。只在真正描述数据流处理的句子中添加引用，不要过度添加。
"""

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
