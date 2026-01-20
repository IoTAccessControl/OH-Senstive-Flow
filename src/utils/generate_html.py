import json
import sys
import html
import re
from pathlib import PurePosixPath


# -----------------------------
# 工具函数：路径归一化
# -----------------------------
def normalize_path(path: str) -> str:
    return str(PurePosixPath(path)).lower()


# -----------------------------
# 解析 TXT（支持同一 file 多次出现）
# -----------------------------
def parse_code_txt(txt_path):
    code_map = {}
    current_file = None

    file_pattern = re.compile(r'^File:\s+(.*)')
    line_pattern = re.compile(r'^\s*(\d+):\s+(.*)')

    with open(txt_path, 'r', encoding='utf-8') as f:
        for raw_line in f:
            line = raw_line.rstrip("\n")

            file_match = file_pattern.match(line)
            if file_match:
                current_file = normalize_path(file_match.group(1))
                if current_file not in code_map:
                    code_map[current_file] = []
                continue

            line_match = line_pattern.match(line)
            if line_match and current_file:
                line_no = int(line_match.group(1))
                code = line_match.group(2)
                code_map[current_file].append((line_no, code))

    # 行号排序 + 去重
    for file in code_map:
        seen = set()
        unique = []
        for ln, code in sorted(code_map[file], key=lambda x: x[0]):
            if ln not in seen:
                unique.append((ln, code))
                seen.add(ln)
        code_map[file] = unique

    return code_map


# -----------------------------
# 获取代码上下文
# -----------------------------
def get_code_context(code_map, file, target_line, context=5):
    if file not in code_map:
        return f"⚠ 未找到文件：{file}"

    lines = code_map[file]
    if not lines:
        return "⚠ 文件存在但无代码"

    hit = False
    result = []

    for line_no, code in lines:
        if abs(line_no - target_line) <= context:
            hit = True
            prefix = "👉 " if line_no == target_line else "   "
            result.append(f"{prefix}{line_no}: {code}")

    if not hit:
        return f"⚠ 行号 {target_line} 不在 TXT 代码范围内"

    return "\n".join(result)


# -----------------------------
# 生成 HTML（带箭头）
# -----------------------------
def generate_html(flow, code_map, output_path):
    nodes = []
    edges = []

    for idx, item in enumerate(flow):
        file_norm = normalize_path(item["file"])
        line_no = item["line"]

        context = get_code_context(code_map, file_norm, line_no)

        nodes.append({
            "id": idx,
            "label": item["code"],
            "file": item["file"],
            "line": line_no,
            "desc": item.get("desc", ""),
            "context": html.escape(context)
        })

        if idx > 0:
            edges.append({
                "from": idx - 1,
                "to": idx,
                "arrows": "to"   # ✅ 箭头关键点
            })

    html_content = f"""
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>数据流可视化</title>
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
}}
pre {{
  background: #f7f7f7;
  padding: 10px;
  white-space: pre-wrap;
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
    <p><b>文件：</b>${{node.file}}</p>
    <p><b>行号：</b>${{node.line}}</p>
    <p><b>描述：</b>${{node.desc}}</p>
    <h3>代码上下文</h3>
    <pre>${{node.context}}</pre>
  `;
}});
</script>

</body>
</html>
"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_content)


# -----------------------------
# 主入口
# -----------------------------
def main():
    if len(sys.argv) != 4:
        print("用法: python generate_flow_html.py flow.json code.txt output.html")
        sys.exit(1)

    flow_json, code_txt, output_html = sys.argv[1:]

    with open(flow_json, 'r', encoding='utf-8') as f:
        flow = json.load(f)

    code_map = parse_code_txt(code_txt)
    generate_html(flow, code_map, output_html)

    print(f"✅ HTML 已生成：{output_html}")


if __name__ == "__main__":
    main()
