"""数据流分析Agent"""
import json
import os


class DataFlowAgent:
    """从privacy_flow_analyzer.py的PrivacyDataFlowAgent迁移"""

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
