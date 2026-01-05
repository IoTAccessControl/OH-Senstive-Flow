class WriteResult:
    def __init__(self, result_file: str):
        self.result_file = result_file

    def run(self, content: str):
        with open(self.result_file, 'w', encoding='utf-8') as f:
            f.write(content)