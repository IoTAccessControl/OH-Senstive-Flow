"""HTML生成工具"""
import json
import html
import os
from pathlib import PurePosixPath


class HtmlGenerator:
    """从privacy_flow_analyzer.py的generate_html_visualization迁移"""

    def normalize_path(self, path: str) -> str:
        return str(PurePosixPath(path)).lower()

    def generate(self, all_flows: list, output_path: str, module_name: str = ""):
        """生成HTML可视化页面"""
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

        title = f"隐私数据流可视化 - {module_name}" if module_name else "隐私数据流可视化"
        back_link_path = "../index.html" if module_name else "index.html"

        html_content = f"""
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
<style>
* {{
  box-sizing: border-box;
}}
body {{
  margin: 0;
  display: flex;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}}
#network {{
  width: 60%;
  height: 100vh;
  border-right: 1px solid #ccc;
}}
#detail {{
  width: 40%;
  padding: 16px;
  overflow: auto;
  background: #f9f9f9;
}}
pre {{
  background: #f0f0f0;
  padding: 12px;
  white-space: pre-wrap;
  font-size: 12px;
  border-radius: 4px;
}}
.node-info {{
  padding: 12px;
  border-bottom: 1px solid #ddd;
}}
.flow-header {{
  background: #4CAF50;
  color: white;
  padding: 8px 12px;
  margin: 8px 0;
  border-radius: 4px;
}}
.back-link {{
  display: inline-block;
  padding: 8px 16px;
  background: #2196F3;
  color: white;
  text-decoration: none;
  border-radius: 4px;
  margin-bottom: 16px;
}}
.back-link:hover {{
  background: #1976D2;
}}
.module-tag {{
  display: inline-block;
  background: #E8F5E9;
  color: #2E7D32;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-left: 8px;
}}
.node-link {{
  color: #2196F3;
  text-decoration: underline;
  cursor: pointer;
  margin: 0 1px;
}}
.node-link:hover {{
  color: #1976D2;
}}
</style>
</head>
<body>

<div id="network"></div>
<div id="detail">
  <a href="{back_link_path}" class="back-link">← 返回模块列表</a>
  <h2>节点详情 <span class="module-tag">{module_name}</span></h2>
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

// 根据flow_id和step找到节点ID
function findNodeIdByFlowAndStep(flowId, stepIndex) {{
  const allNodes = nodes.get();
  for (let i = 0; i < allNodes.length; i++) {{
    const node = allNodes[i];
    if (node.flow_id == flowId) {{
      // 计算这个flow的起始节点ID
      let currentFlowId = 1;
      let offset = 0;
      for (let f = 0; f < flowId - 1; f++) {{
        // 找到flow_id为f+1的节点数量
        const flowNodes = nodes.get().filter(n => n.flow_id == (f + 1));
        offset += flowNodes.length;
      }}
      return offset + stepIndex;
    }}
  }}
  return null;
}}

// 高亮并显示指定节点
function highlightNode(flowId, stepIndex) {{
  const nodeId = findNodeIdByFlowAndStep(flowId, stepIndex);
  if (nodeId !== null) {{
    network.selectNodes([nodeId]);
    network.focus(nodeId, {{ scale: 1.2, animation: true }});
    const node = nodes.get(nodeId);
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
  }}
}}

// 从URL参数获取flow和step并高亮
const urlParams = new URLSearchParams(window.location.search);
const flowParam = urlParams.get('flow');
const stepParam = urlParams.get('step');

if (flowParam !== null && stepParam !== null) {{
  highlightNode(parseInt(flowParam), parseInt(stepParam));
}}

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

    def generate_index_page(self, result_path: str, modules: list):
        """生成模块索引页面，展示所有模块的隐私报告"""
        module_cards = []

        for module in modules:
            module_name = module["name"]
            report_path = os.path.join(result_path, module_name, "report.md")
            data_flow_results = os.path.join(result_path, module_name, "data_flow_results.json")

            # 读取隐私报告
            report_content = ""
            if os.path.exists(report_path):
                with open(report_path, 'r', encoding='utf-8') as f:
                    report_content = f.read()
                # 转换markdown为HTML（简单处理）
                report_content = self._markdown_to_html(report_content, module_name)

            # 读取数据流统计
            flow_count = 0
            if os.path.exists(data_flow_results):
                with open(data_flow_results, 'r', encoding='utf-8') as f:
                    flows = json.load(f)
                    flow_count = len(flows)

            # 生成模块卡片
            module_cards.append(f"""
            <div class="module-card" onclick="location.href='{module_name}/data_flow_visualization.html'">
                <div class="module-header">
                    <h2>{module_name}</h2>
                    <span class="flow-count">{flow_count} 个数据流</span>
                </div>
                <div class="report-content">
                    {report_content}
                </div>
                <div class="view-flow-btn">查看数据流可视化 →</div>
            </div>
            """)

        html_content = f"""
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>隐私数据流分析报告</title>
<style>
* {{
  box-sizing: border-box;
}}
body {{
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f5f5f5;
}}
.header {{
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 24px 32px;
}}
.header h1 {{
  margin: 0;
  font-size: 24px;
}}
.header p {{
  margin: 8px 0 0 0;
  opacity: 0.9;
}}
.container {{
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}}
.module-card {{
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  margin-bottom: 24px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}}
.module-card:hover {{
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}}
.module-header {{
  background: #f8f9fa;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}}
.module-header h2 {{
  margin: 0;
  font-size: 18px;
  color: #333;
}}
.flow-count {{
  background: #E3F2FD;
  color: #1976D2;
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 14px;
}}
.report-content {{
  padding: 20px;
  max-height: 300px;
  overflow-y: auto;
}}
.report-content h3 {{
  color: #666;
  font-size: 14px;
  margin: 16px 0 8px 0;
}}
.report-content h3:first-child {{
  margin-top: 0;
}}
.report-content ul {{
  margin: 8px 0;
  padding-left: 20px;
}}
.report-content li {{
  margin: 4px 0;
  line-height: 1.6;
}}
.report-content p {{
  margin: 8px 0;
  line-height: 1.6;
}}
.view-flow-btn {{
  background: #4CAF50;
  color: white;
  text-align: center;
  padding: 12px;
  font-weight: 500;
}}
.view-flow-btn:hover {{
  background: #43A047;
}}
</style>
</head>
<body>

<div class="header">
  <h1>🔒 隐私数据流分析报告</h1>
  <p>点击下方模块查看其隐私声明详情及数据流可视化</p>
</div>

<div class="container">
  {"".join(module_cards)}
</div>

</body>
</html>
"""

        index_path = os.path.join(result_path, "index.html")
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"索引页面已生成: {index_path}")

    def _markdown_to_html(self, md_content: str, module_name: str = "") -> str:
        """简单将markdown转换为HTML，支持节点链接"""
        import re

        # 移除第一行标题（模块名），避免重复
        lines = md_content.strip().split('\n')
        if lines and lines[0].startswith('# '):
            lines = lines[1:]

        html_lines = []
        i = 0
        while i < len(lines):
            line = lines[i].rstrip()

            # 跳过纯数字或空行
            if not line or re.match(r'^\d+$', line):
                i += 1
                continue

            # 处理标题 ### 标题
            if line.startswith('### '):
                html_lines.append(f'<h3>{line[4:]}</h3>')
            # 处理标题 ## 标题
            elif line.startswith('## '):
                html_lines.append(f'<h2>{line[3:]}</h2>')
            # 处理标题 # 标题
            elif line.startswith('# '):
                html_lines.append(f'<h1>{line[2:]}</h1>')
            # 处理粗体 **文字**
            elif '**' in line:
                line = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', line)
                line = self._process_node_references(line, module_name)
                html_lines.append(f'<p>{line}</p>')
            # 处理列表 - 项
            elif line.startswith('- '):
                # 收集连续的列表项
                list_items = [line[2:].strip()]
                j = i + 1
                while j < len(lines) and lines[j].startswith('- '):
                    item_text = lines[j][2:].strip()
                    item_text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', item_text)
                    item_text = self._process_node_references(item_text, module_name)
                    list_items.append(item_text)
                    j += 1
                html_lines.append('<ul>' + ''.join(f'<li>{item}</li>' for item in list_items) + '</ul>')
                i = j
                continue
            # 处理普通段落
            elif line:
                line = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', line)
                line = self._process_node_references(line, module_name)
                html_lines.append(f'<p>{line}</p>')

            i += 1

        return '\n'.join(html_lines)

    def _process_node_references(self, text: str, module_name: str) -> str:
        """将节点引用嵌入到前一个词中"""
        import re
        # 匹配 [[flow_id:X, step:Y]] 并替换为链接图标
        def replace_ref(match):
            flow_id = match.group(1)
            step = match.group(2)
            return f'<a href="{module_name}/data_flow_visualization.html?flow={flow_id}&step={step}" class="node-link" data-flow="{flow_id}" data-step="{step}" onclick="event.stopPropagation();">🔗</a>'

        text = re.sub(r'\[\[flow_id:(\d+), step:(\d+)\]\]', replace_ref, text)
        return text
