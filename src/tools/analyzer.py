"""代码分析工具"""
import os
import tree_sitter_arkts as tsarkts
from tree_sitter import Parser, Language


class GetFuncImpl:
    """从src_old/tools/analyzer.py和privacy_flow_analyzer.py迁移"""

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
