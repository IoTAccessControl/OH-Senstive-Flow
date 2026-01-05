class ReadDataFlowMemory:
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