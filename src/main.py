import argparse
from dotenv import load_dotenv
import os
from pathlib import Path
from openai import OpenAI
from memory.memory import ReadDataFlowMemory, WriteDataFlowMemory, ReadFuncImplMemory, WriteFuncImplMemory
from tools.analyzer import GetFuncImpl
from utils.write_result import WriteResult
from agent.agent import Agent


def parse_args():
    parser = argparse.ArgumentParser(description="")

    parser.add_argument(
        "--model",
        type=str,
        default="qwen3-coder-plus",
        help="Model name, e.g. qwen3-coder-plus, qwen-max"
    )

    parser.add_argument(
        "--code_base",
        type=str,
        required=True,
        help="Code base directory name"
    )

    parser.add_argument(
        "--result_file",
        type=str,
        required=True,
        help="Target file name (relative to result path)"
    )

    return parser.parse_args()


def run_agent(args):

    load_dotenv()
    api_key = os.getenv("DASHSCOPE_API_KEY")
    data_path = os.getenv("DATA_PATH", "./data")
    result_path = os.getenv("RESULT_PATH", "./results")

    model = args.model
    code_base_path = Path(data_path) / args.code_base
    result_file = Path(result_path) / args.result_file

    memory_data_flow_file = Path(data_path) / "memory_data_flow.json"
    memory_func_impl_file = Path(data_path) / "memory_func_impl.txt"

    from agent.system_prompt import system_prompt

    client = OpenAI(
        api_key=api_key,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
    )

    tools = [
        GetFuncImpl(code_base_path),
        ReadDataFlowMemory(memory_data_flow_file),
        ReadFuncImplMemory(memory_func_impl_file),
        WriteDataFlowMemory(memory_data_flow_file),
        WriteFuncImplMemory(memory_func_impl_file),
        WriteResult(result_file)
    ]

    start = ("data/Wechat_HarmonyOS/entry/src/main/ets/pages/mine/Mine.ets", 22, "PhotoPickerUtils.openGallery(")
    end = ("data/Wechat_HarmonyOS/entry/src/main/ets/pages/mine/Mine.ets", 24, "this.imgPath = uri;")
    target_var = "uri"

    agent = Agent(
        client=client,
        system_prompt=system_prompt,
        model=model,
        tools=tools,
        start=start,
        end=end,
        target_var=target_var
    )

    agent.run()


def main():
    args = parse_args()
    run_agent(args)


if __name__ == "__main__":
    main()