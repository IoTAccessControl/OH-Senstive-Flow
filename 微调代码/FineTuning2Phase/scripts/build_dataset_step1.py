"""
Step1 数据构建脚本
将 firstphase.json 转换为 SFT 训练格式 (data/step1_train.jsonl)

输入格式: JSON 数组, 每条包含:
  - input:  数据流结构化 JSON（含 id, data_type, description, flow_steps）
  - output: 结构化隐私场景描述文本

用法:
    python scripts/build_dataset_step1.py
    python scripts/build_dataset_step1.py --raw firstphase.json --out data --val_ratio 0.1
"""

import argparse
import json
import os
import random


def build_sample(raw: dict) -> dict:
    """
    将一条原始数据转为 input/output 文本对。
    input 侧: 将结构化数据流 JSON 序列化为文本
    output 侧: 直接使用目标隐私描述文本
    """
    inp = raw["input"]
    if isinstance(inp, dict):
        input_text = json.dumps(inp, ensure_ascii=False, indent=2)
    else:
        input_text = str(inp).strip()

    output_text = raw["output"].strip()

    return {"input": input_text, "output": output_text}


def process_dataset(raw_file: str, output_dir: str,
                    val_ratio: float = 0.0, seed: int = 42):
    os.makedirs(output_dir, exist_ok=True)

    with open(raw_file, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    print(f"原始数据量: {len(raw_data)} 条")

    samples = []
    for i, raw in enumerate(raw_data):
        try:
            samples.append(build_sample(raw))
        except KeyError as e:
            print(f"[WARN] 第 {i} 条数据缺少字段 {e}，已跳过")

    print(f"成功转换: {len(samples)} 条")

    random.seed(seed)
    random.shuffle(samples)

    if val_ratio > 0 and len(samples) > 1:
        val_size   = max(1, int(len(samples) * val_ratio))
        val_data   = samples[:val_size]
        train_data = samples[val_size:]
    else:
        train_data = samples
        val_data   = []

    def write_jsonl(path, data):
        with open(path, "w", encoding="utf-8") as f:
            for s in data:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")

    train_path = os.path.join(output_dir, "step1_train.jsonl")
    write_jsonl(train_path, train_data)
    print(f"训练集: {len(train_data)} 条 → {train_path}")

    if val_data:
        val_path = os.path.join(output_dir, "step1_val.jsonl")
        write_jsonl(val_path, val_data)
        print(f"验证集: {len(val_data)} 条 → {val_path}")

    # 预览
    if train_data:
        s = train_data[0]
        print("\n─── 预览第一条样本 ───")
        print("INPUT (前500字):")
        print(s["input"][:500], "...")
        print("\nOUTPUT (前400字):")
        print(s["output"][:400], "...")
        print("─────────────────────")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw",       default="firstphase.json", help="原始数据 JSON 文件")
    parser.add_argument("--out",       default="data",            help="输出目录")
    parser.add_argument("--val_ratio", type=float, default=0.0,   help="验证集比例")
    parser.add_argument("--seed",      type=int,   default=42)
    args = parser.parse_args()

    process_dataset(args.raw, args.out, args.val_ratio, args.seed)
