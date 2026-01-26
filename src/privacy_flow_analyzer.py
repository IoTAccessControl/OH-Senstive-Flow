#!/usr/bin/env python3
"""
隐私数据流分析器
分析鸿蒙应用中隐私数据从源头到终点的数据流
"""
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

# 导入tree_sitter_arkts
import tree_sitter_arkts as tsarkts
from tree_sitter import Parser, Language

# 添加src目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


class GetFuncImpl:
    """从src_old/tools/analyzer.py照搬"""
    def __init__(self, code_base_path: str):
        self.parser_ets = Parser(Language(tsarkts.language()))
        self.parsers = {".ets": self.parser_ets}
        self.code_base_path = code_base_path

    def run(self, func_name: str, root_dir: str | None = None) -> str:
        results = []
        search_dir = root_dir if root_dir is not None else self.code_base_path
        for root, _, files in os.walk(search_dir):
            for file in files:
                ext = os.path.splitext(file)[1]
                if ext not in self.parsers:
                    continue
                file_path = os.path.join(root, file)
                parser = self.parsers[ext]
                try:
                    with open(file_path, "rb") as f:
                        code = f.read()
                except Exception:
                    continue
                tree = parser.parse(code)
                matches = self._find_function_nodes(tree.root_node, code, func_name, ext)
                for node in matches:
                    func_text = self._extract_with_lineno(code, node)
                    results.append(f"File: {file_path}\n{func_text}\n")
        return "\n".join(results)

    def _find_function_nodes(self, node, code, func_name, ext):
        results = []
        if node.type == "build":
            if func_name == "build":
                results.append(node)
        elif node.type in ("function_declaration", "method_declaration"):
            for child in node.children:
                if child.type == "identifier":
                    name = code[child.start_byte:child.end_byte].decode()
                    if name == func_name:
                        results.append(node)
        for child in node.children:
            results.extend(self._find_function_nodes(child, code, func_name, ext))
        return results

    def _extract_with_lineno(self, code: bytes, node) -> str:
        source = code.decode("utf-8", errors="ignore")
        lines = source.splitlines()
        start_line = node.start_point[0]
        end_line = node.end_point[0]
        output = []
        for i in range(start_line, end_line + 1):
            output.append(f"{i + 1:5d}: {lines[i]}")
        return "\n".join(output)


class ReadDataFlowMemory:
    """从src_old/memory/memory.py照搬"""
    def __init__(self, memory_file: str):
        self.memory_file = memory_file

    def run(self) -> str:
        with open(self.memory_file, 'r', encoding='utf-8') as f:
            return f.read()


class WriteDataFlowMemory:
    def __init__(self, memory_file: str):
        self.memory_file = memory_file

    def run(self, content: str):
        with open(self.memory_file, 'w', encoding='utf-8') as f:
            f.write(content)


class ReadFuncImplMemory:
    def __init__(self, memory_file: str):
        self.memory_file = memory_file

    def run(self) -> str:
        with open(self.memory_file, 'r', encoding='utf-8') as f:
            return f.read()


class WriteFuncImplMemory:
    def __init__(self, memory_file: str):
        self.memory_file = memory_file

    def run(self, content: str):
        with open(self.memory_file, 'w', encoding='utf-8') as f:
            f.write(content)


class WriteResult:
    """从src_old/utils/write_result.py照搬"""
    def __init__(self, result_file: str):
        self.result_file = result_file

    def run(self, content: str):
        with open(self.result_file, 'w', encoding='utf-8') as f:
            f.write(content)


SYSTEM_PROMPT = """
[1.任务描述]
你正在执行隐私数据流分析任务。你的目标是根据给定的起始点和结束点，分析隐私变量在这两个点执行过程中的数据流动，识别关键的函数调用和数据流转移。

[2.隐私数据类型]
- 设备信息: deviceInfo相关API
- 网络信息: connection相关API
- 用户数据: router.getParams等
- 传感器信息: sensor相关API

[3.输出格式]
当你需要查看函数实现时，回复:
```json
{
  "action": "GetFuncImpl",
  "func_name": "函数名",
  "reason": "说明为什么需要查看该函数"
}
```

当你要记录数据流步骤时，回复:
```json
{
    "file": "文件路径",
    "line": 行号,
    "code": "代码行内容",
    "desc": "对该行代码的描述"
}
```

当到达终点时，回复:
```json
{
  "action": "stop"
}
```

[4.要求]
- 不要跳步，逐行分析
- 节点之间必须有数据依赖或控制依赖
- 只返回JSON，不要有其他内容
"""


class PrivacyDataFlowAgent:
    """从src_old/agent/agent.py照搬"""
    def __init__(self, client, system_prompt: str, model: str, tools: dict,
                 start: tuple, end: tuple, target_var: str, flow_id: int):
        self.client = client
        self.system_prompt = system_prompt
        self.model = model
        self.tools = tools
        self.start = start
        self.end = end
        self.target_var = target_var
        self.flow_id = flow_id

    def run(self) -> list:
        question = f"分析{self.target_var}从起点到终点的隐私数据流动。起点: {self.start}，终点: {self.end}"

        first_round = True
        round_idx = 0
        flow = []

        while round_idx < 30:
            round_idx += 1
            print(f"\n[Flow {self.flow_id}] ===== Round {round_idx} =====")

            if first_round:
                first_round = False
                self.tools["WriteDataFlowMemory"].run("[]")
                self.tools["WriteFuncImplMemory"].run("")

                start_file = self.start[0]
                start_dir = os.path.dirname(start_file)

                print(f"[Flow {self.flow_id}] Fetching build() implementation")
                build_impl = self.tools["GetFuncImpl"].run("build", start_dir)

                print(f"[Flow {self.flow_id}] Writing build() to memory")
                self.tools["WriteFuncImplMemory"].run(build_impl)
                continue

            memory_data_flow = self.tools["ReadDataFlowMemory"].run()
            memory_func_impl = self.tools["ReadFuncImplMemory"].run()

            user_prompt = f"""
[问题]
{question}
[已经分析的步骤]
{memory_data_flow}
[已知函数实现]
{memory_func_impl}
"""

            print(f"[Flow {self.flow_id}] Calling LLM...")
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": self.system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    stream=False,
                    temperature=0
                )
            except Exception as e:
                print(f"[Flow {self.flow_id}] LLM error: {e}")
                break

            content = response.choices[0].message.content
            content = content.replace("```json", "").replace("```", "").strip()
            print(f"[Flow {self.flow_id}] LLM output: {content[:200]}...")

            # 解析JSON
            try:
                data = json.loads(content)
            except json.JSONDecodeError:
                print(f"[Flow {self.flow_id}] Invalid JSON, continue")
                continue

            # 检查是否是获取函数实现的请求
            if data.get("action") == "GetFuncImpl":
                func_name = data.get("func_name")
                print(f"[Flow {self.flow_id}] Getting function: {func_name}")
                func_impl = self.tools["GetFuncImpl"].run(func_name)
                old_impl = self.tools["ReadFuncImplMemory"].run()
                new_impl = old_impl + "\n" + func_impl
                self.tools["WriteFuncImplMemory"].run(new_impl)
                continue

            # 检查是否是停止
            if data.get("action") == "stop":
                print(f"[Flow {self.flow_id}] Stopping as requested")
                break

            # 检查是否是数据流步骤
            if all(k in data for k in ("file", "line", "code", "desc")):
                flow.append(data)
                try:
                    current_flow = json.loads(memory_data_flow)
                except json.JSONDecodeError:
                    current_flow = []
                current_flow.append(data)
                self.tools["WriteDataFlowMemory"].run(json.dumps(current_flow, ensure_ascii=False, indent=2))

                current_tuple = (data["file"], data["line"], data["code"][:50] if len(data["code"]) > 50 else data["code"])
                end_tuple = (self.end[0], self.end[1], self.end[2][:50] if len(self.end[2]) > 50 else self.end[2])

                print(f"[Flow {self.flow_id}] Current: {current_tuple[:2]}, End: {end_tuple[:2]}")
                continue

        final_memory = self.tools["ReadDataFlowMemory"].run()
        try:
            flow = json.loads(final_memory)
        except json.JSONDecodeError:
            flow = []

        print(f"[Flow {self.flow_id}] Done. Found {len(flow)} steps.")
        return flow


def select_privacy_flow_pairs(results_file: str) -> list:
    """根据隐私数据选择多组起点和终点"""
    with open(results_file, 'r', encoding='utf-8') as f:
        api_results = json.load(f)

    pairs = []

    # 查找隐私相关的API调用
    privacy_apis = []
    for result in api_results:
        code = result.get('call_code', '')
        file_path = result.get('file_path', '')

        # 设备信息
        if 'deviceInfo' in code:
            privacy_apis.append({
                'type': 'device_info',
                'file': file_path,
                'import_line': result.get('import_line'),
                'call_line': result.get('call_line'),
                'call_code': code
            })
        # 网络连接
        elif 'connection' in code and 'hasDefaultNetSync' in code:
            privacy_apis.append({
                'type': 'network_info',
                'file': file_path,
                'import_line': result.get('import_line'),
                'call_line': result.get('call_line'),
                'call_code': code
            })
        # 路由参数（用户数据）
        elif 'router.getParams' in code:
            privacy_apis.append({
                'type': 'user_data',
                'file': file_path,
                'import_line': result.get('import_line'),
                'call_line': result.get('call_line'),
                'call_code': code
            })
        # 传感器
        elif 'sensor.getSensorList' in code:
            privacy_apis.append({
                'type': 'sensor_info',
                'file': file_path,
                'import_line': result.get('import_line'),
                'call_line': result.get('call_line'),
                'call_code': code
            })

    # 为每种隐私类型创建起点-终点对
    # 起点: 隐私API调用
    # 终点: hilog输出或数据存储

    for i, api in enumerate(privacy_apis[:5]):  # 只取前2组
        if api['type'] == 'device_info':
            start = (api['file'], api['call_line'], api['call_code'])
            # 终点: 找到同一文件中后续的hilog调用
            end = (api['file'], api['call_line'] + 1, 'hilog.')
            target = "deviceInfo结果"
        elif api['type'] == 'network_info':
            start = (api['file'], api['call_line'], api['call_code'])
            end = (api['file'], api['call_line'] + 2, 'if ')
            target = "网络连接结果"
        elif api['type'] == 'user_data':
            start = (api['file'], api['call_line'], api['call_code'])
            end = (api['file'], api['call_line'] + 1, 'this.')
            target = "路由参数"
        elif api['type'] == 'sensor_info':
            start = (api['file'], api['call_line'], api['call_code'])
            end = (api['file'], api['call_line'] + 1, 'for ')
            target = "传感器列表"
        else:
            continue

        pairs.append({
            'flow_id': len(pairs) + 1,
            'start': start,
            'end': end,
            'target_var': target,
            'api_type': api['type']
        })

    return pairs


def generate_html_visualization(all_flows: list, output_path: str):
    """生成HTML可视化页面"""
    import html
    import re
    from pathlib import PurePosixPath

    def normalize_path(path: str) -> str:
        return str(PurePosixPath(path)).lower()

    # 收集所有节点和边
    nodes = []
    edges = []
    node_id_offset = 0

    for flow in all_flows:
        flow_id = flow.get('flow_id', 1)
        flow_steps = flow.get('steps', [])

        if not flow_steps:
            continue

        for idx, step in enumerate(flow_steps):
            node_id = node_id_offset + idx
            file_norm = normalize_path(step["file"])

            # 获取代码上下文
            context_lines = []
            try:
                with open(step["file"], 'r', encoding='utf-8') as f:
                    all_lines = f.readlines()
                target_line = step["line"]
                for i in range(max(0, target_line - 4), min(len(all_lines), target_line + 3)):
                    prefix = "👉 " if i + 1 == target_line else "   "
                    context_lines.append(f"{prefix}{i + 1}: {all_lines[i].rstrip()}")
            except Exception:
                context_lines = ["无法读取文件"]

            context = html.escape("\n".join(context_lines))

            nodes.append({
                "id": node_id,
                "label": step["code"][:30] + "..." if len(step["code"]) > 30 else step["code"],
                "file": step["file"],
                "line": step["line"],
                "desc": step.get("desc", ""),
                "context": context,
                "flow_id": flow_id
            })

            if idx > 0:
                edges.append({
                    "from": node_id_offset + idx - 1,
                    "to": node_id,
                    "arrows": "to"
                })

        node_id_offset += len(flow_steps)

    html_content = f"""
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>隐私数据流可视化</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
<style>
body {{
  margin: 0;
  display: flex;
  font-family: monospace;
}}
#network {{
  width: 60%;
  height: 100vh;
  border-right: 1px solid #ccc;
}}
#detail {{
  width: 40%;
  padding: 12px;
  overflow: auto;
  background: #f9f9f9;
}}
pre {{
  background: #f0f0f0;
  padding: 10px;
  white-space: pre-wrap;
  font-size: 12px;
}}
.node-info {{
  padding: 10px;
  border-bottom: 1px solid #ddd;
}}
.flow-header {{
  background: #4CAF50;
  color: white;
  padding: 5px 10px;
  margin: 5px 0;
}}
</style>
</head>
<body>

<div id="network"></div>
<div id="detail">
  <h2>节点详情</h2>
  <div id="info">点击左侧节点查看源码</div>
</div>

<script>
const nodes = new vis.DataSet({json.dumps(nodes, ensure_ascii=False)});
const edges = new vis.DataSet({json.dumps(edges)});

const options = {{
  interaction: {{ hover: true }},
  physics: {{ enabled: true }},
  nodes: {{
    shape: "box",
    font: {{ size: 12 }}
  }},
  edges: {{
    arrows: {{
      to: {{ enabled: true, scaleFactor: 1 }}
    }},
    smooth: {{
      type: "cubicBezier"
    }}
  }}
}};

const network = new vis.Network(
  document.getElementById("network"),
  {{ nodes, edges }},
  options
);

network.on("click", function (params) {{
  if (!params.nodes.length) return;
  const node = nodes.get(params.nodes[0]);

  document.getElementById("info").innerHTML = `
    <div class="node-info">
      <p><b>数据流编号：</b>${{node.flow_id || 1}}</p>
      <p><b>文件：</b>${{node.file}}</p>
      <p><b>行号：</b>${{node.line}}</p>
      <p><b>描述：</b>${{node.desc}}</p>
    </div>
    <h3>代码上下文（中心行号：${{node.line}}）</h3>
    <pre>${{node.context}}</pre>
  `;
}});
</script>

</body>
</html>
"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"HTML已生成: {output_path}")


def main():
    load_dotenv()
    api_key = os.getenv("DASHSCOPE_API_KEY")
    data_path = os.getenv("DATA_PATH", "./data")
    result_path = os.getenv("RESULT_PATH", "./results")

    if not api_key:
        print("错误: 未设置DASHSCOPE_API_KEY")
        sys.exit(1)

    model = "qwen3-coder-plus"
    code_base_path = Path(data_path) / "Wechat_HarmonyOS"

    # 读取API结果文件
    api_results_file = Path(result_path) / "harmony_api_results.json"
    if not api_results_file.exists():
        print(f"错误: 找不到 {api_results_file}")
        sys.exit(1)

    # 选择隐私数据流起点终点对
    flow_pairs = select_privacy_flow_pairs(str(api_results_file))
    print(f"选择了 {len(flow_pairs)} 组隐私数据流:")
    for pair in flow_pairs:
        print(f"  Flow {pair['flow_id']}: {pair['api_type']} - {pair['target_var']}")

    if not flow_pairs:
        print("错误: 未找到隐私相关API调用")
        sys.exit(1)

    # 创建OpenAI客户端
    client = OpenAI(
        api_key=api_key,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
    )

    # 所有数据流结果
    all_results = []

    # 为每组起点终点运行分析
    for pair in flow_pairs[:5]:  # 只分析前2组
        print(f"\n{'='*50}")
        print(f"开始分析 Flow {pair['flow_id']}: {pair['api_type']}")
        print(f"起点: {pair['start']}")
        print(f"终点: {pair['end']}")
        print(f"{'='*50}")

        # 设置临时记忆文件
        memory_data_flow_file = Path(result_path) / f"memory_data_flow_{pair['flow_id']}.json"
        memory_func_impl_file = Path(result_path) / f"memory_func_impl_{pair['flow_id']}.txt"

        tools = {
            "GetFuncImpl": GetFuncImpl(code_base_path),
            "ReadDataFlowMemory": ReadDataFlowMemory(str(memory_data_flow_file)),
            "WriteDataFlowMemory": WriteDataFlowMemory(str(memory_data_flow_file)),
            "ReadFuncImplMemory": ReadFuncImplMemory(str(memory_func_impl_file)),
            "WriteFuncImplMemory": WriteFuncImplMemory(str(memory_func_impl_file)),
        }

        agent = PrivacyDataFlowAgent(
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

    # 保存结果到JSON
    output_json = Path(result_path) / "data_flow_results.json"
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"\n结果已保存: {output_json}")

    # 生成HTML可视化
    html_output = Path(result_path) / "data_flow_visualization.html"
    generate_html_visualization(all_results, str(html_output))

    print(f"\n分析完成!")


if __name__ == "__main__":
    main()
