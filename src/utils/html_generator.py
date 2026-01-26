"""HTML生成工具"""
import json
import html
import re
from pathlib import PurePosixPath


class HtmlGenerator:
    """从privacy_flow_analyzer.py的generate_html_visualization迁移"""

    def normalize_path(self, path: str) -> str:
        return str(PurePosixPath(path)).lower()

    def generate(self, all_flows: list, output_path: str):
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
                file_norm = self.normalize_path(step["file"])

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
