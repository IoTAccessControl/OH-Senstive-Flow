"""文件写入工具"""
import os


class WriteResult:
    """从src_old/utils/write_result.py和privacy_flow_analyzer.py迁移"""

    def __init__(self, result_file: str):
        self.result_file = result_file

    def run(self, content: str):
        with open(self.result_file, 'w', encoding='utf-8') as f:
            f.write(content)
