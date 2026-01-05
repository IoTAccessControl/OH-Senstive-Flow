import json
import os


class Agent:

    def __init__(
        self, 
        client, 
        system_prompt: str, 
        model: str, 
        tools: list, 
        start: tuple,
        end: tuple,
        target_var: str
    ):
        self.client = client
        self.system_prompt = system_prompt
        self.model = model
        self.tools = {tool.__class__.__name__: tool for tool in tools}
        self.start = start
        self.end = end
        self.target_var = target_var

    def run(self):
        # 1. 构建问题
        question = f"分析{self.target_var}从 {self.start} 到 {self.end} 执行过程中的数据流动。"

        # 2. 循环控制
        first_round = True
        round_idx = 0

        while round_idx < 20:
            round_idx += 1
            print(f"\n[Agent] ===== Round {round_idx} =====")

            # 2.1 第一轮：初始化记忆 + 获取 build 实现
            if first_round:
                first_round = False

                # 清空记忆
                self.tools["WriteDataFlowMemory"].run("[]")
                self.tools["WriteFuncImplMemory"].run("")

                # 从 start 中获取目录
                start_file = self.start[0]
                start_dir = os.path.dirname(start_file)

                print("[Agent] Fetching build() implementation")
                # 获取 build 函数实现
                build_impl = self.tools["GetFuncImpl"].run(
                    "build", start_dir
                )

                print("[Agent] Writing build() implementation to memory")
                # 写入函数实现记忆
                self.tools["WriteFuncImplMemory"].run(build_impl)
                continue

            # 2.2 其他轮
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

            # print(user_prompt)
            # print("[已经分析的步骤]")
            # print(memory_data_flow)
            print("[Agent] Calling LLM")
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=False,
                temperature=0
            )

            content = (
                response.choices[0].message.content
                .replace("```json", "")
                .replace("```", "")
                .strip()
            )

            print("[Agent] LLM raw output:")
            print(content)

            try:
                data = json.loads(content)
            except Exception:
                # 2.2.3 非法 JSON，什么都不做
                continue

            # 2.2.1 请求新的函数实现
            if "func_name" in data and isinstance(data, dict):
                func_name = data["func_name"]
                print(f"[Agent] LLM requests function: {func_name}")

                func_impl = self.tools["GetFuncImpl"].run(func_name)

                # print("="*20)
                # print(func_impl)
                # print("="*20)

                # 追加写入函数实现记忆
                old_impl = self.tools["ReadFuncImplMemory"].run()
                new_impl = old_impl + "\n" + func_impl
                # new_impl = func_impl
                self.tools["WriteFuncImplMemory"].run(new_impl)
                continue

            # 2.2.2 记录数据流步骤
            if all(k in data for k in ("file", "line", "code", "desc")):
                try:
                    flow = json.loads(memory_data_flow)
                except Exception:
                    flow = []

                flow.append(data)
                self.tools["WriteDataFlowMemory"].run(
                    json.dumps(flow, ensure_ascii=False, indent=2)
                )

                # 2.2.4 判断是否到达 end
                current_tuple = (
                    data["file"],
                    data["line"],
                    data["code"],
                )
                if current_tuple == self.end:
                    print("[Agent] Reached end position, stopping loop")
                    break

                continue

            # 2.2.3 其他情况：什么也不做
            continue

        # 3. 保存最终结果
        print("[Agent] Writing final data flow result")
        final_memory_data_flow = self.tools["ReadDataFlowMemory"].run()
        self.tools["WriteResult"].run(final_memory_data_flow)

        print("[Agent] Done.")
