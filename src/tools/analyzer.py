from tree_sitter import Parser, Language
import tree_sitter_typescript as tstypescript
import tree_sitter_arkts as tsarkts
import tree_sitter_c as tsc
import os


class GetFuncImpl:
    def __init__(self, code_base_path: str):
        # 初始化 parser（不使用 set_language）
        self.parser_ts = Parser(Language(tstypescript.language_typescript()))
        self.parser_ets = Parser(Language(tsarkts.language()))
        self.parser_c = Parser(Language(tsc.language()))

        self.parsers = {
            ".c": self.parser_c,
            ".h": self.parser_c,
            ".ts": self.parser_ts,
            ".ets": self.parser_ets,
        }

        self.code_base_path = code_base_path

    def run(self, func_name: str, root_dir: str | None = None) -> str:
        """
        在目录中查找指定函数
        返回：包含文件路径 + 带行号的函数实现 的字符串
        """
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
                matches = self._find_function_nodes(
                    tree.root_node, code, func_name, ext
                )

                for node in matches:
                    func_text = self._extract_with_lineno(code, node)
                    results.append(
                        f"File: {file_path}\n{func_text}\n"
                    )

        return "\n".join(results)

    def _find_function_nodes(self, node, code, func_name, ext):
        """
        递归查找函数定义节点
        """
        results = []

        # C / H
        if ext in (".c", ".h"):
            if node.type == "function_definition":
                declarator = node.child_by_field_name("declarator")
                if declarator:
                    name_node = self._find_identifier(declarator)
                    if name_node:
                        name = code[name_node.start_byte:name_node.end_byte].decode()
                        if name == func_name:
                            results.append(node)

        # TS / ETS
        if ext in (".ts"):
            if node.type in ("function_declaration", "method_definition"):
                name_node = node.child_by_field_name("name")
                if name_node:
                    name = code[name_node.start_byte:name_node.end_byte].decode()
                    if name == func_name:
                        results.append(node)

        if ext == ".ets":
            if node.type == "build_method":
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

    def _find_identifier(self, node):
        """
        从 declarator 中提取函数名（C）
        """
        if node.type == "identifier":
            return node
        for child in node.children:
            result = self._find_identifier(child)
            if result:
                return result
        return None

    def _extract_with_lineno(self, code: bytes, node) -> str:
        """
        提取函数源码并加上行号
        """
        source = code.decode("utf-8", errors="ignore")
        lines = source.splitlines()

        start_line = node.start_point[0]
        end_line = node.end_point[0]

        output = []
        for i in range(start_line, end_line + 1):
            output.append(f"{i + 1:5d}: {lines[i]}")

        return "\n".join(output)
