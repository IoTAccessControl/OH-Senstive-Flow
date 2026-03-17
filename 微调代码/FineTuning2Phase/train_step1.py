"""
Step1: 数据流 → 结构化隐私描述  LoRA SFT 训练脚本
基于 Qwen3 QLoRA, trl >= 0.29

启动: python train_step1.py
可选: python train_step1.py --model models/Qwen/Qwen3-14B --epochs 5
"""

import argparse
import os
import json
import re
import torch
from datasets import Dataset
from peft import LoraConfig, TaskType
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
)
from trl import SFTConfig, SFTTrainer

# ══════════════════════════════════════════════════════════════
# ★ 默认配置
# ══════════════════════════════════════════════════════════════

DEFAULTS = {
    "model_path":   "models/Qwen/Qwen3-32B",
    "train_file":   "data/step1_train.jsonl",
    "val_file":     "data/step1_val.jsonl",
    "output_dir":   "./output/step1_flow2desc",
    "lora_r":       32,
    "lora_alpha":   64,
    "num_epochs":   3,
    "batch_size":   1,
    "grad_accum":   4,
    "lr":           5e-5,
    "max_length":   4096,
}

SYSTEM_PROMPT = (
    "你是一名专业的隐私合规数据分析助手。"
    "你的任务是根据输入的代码静态扫描数据流结构化信息（包含数据类型、触发函数、数据流步骤等），"
    "生成对应的结构化隐私场景说明文本。"
    "输出应包含：场景标题、场景描述、收集信息说明、必要性说明、处理方式与安全措施等内容。"
    "请严格围绕输入中的数据流信息生成，不得虚构未出现的功能或数据类型。"
    "输出语言应准确、结构清晰，便于后续生成正式隐私政策文本。"
)

# ══════════════════════════════════════════════════════════════


def parse_args():
    p = argparse.ArgumentParser(description="Step1 LoRA SFT: 数据流 → 结构化隐私描述")
    p.add_argument("--model",      default=DEFAULTS["model_path"])
    p.add_argument("--train_file", default=DEFAULTS["train_file"])
    p.add_argument("--val_file",   default=DEFAULTS["val_file"])
    p.add_argument("--output_dir", default=DEFAULTS["output_dir"])
    p.add_argument("--lora_r",     type=int,   default=DEFAULTS["lora_r"])
    p.add_argument("--lora_alpha", type=int,   default=DEFAULTS["lora_alpha"])
    p.add_argument("--epochs",     type=int,   default=DEFAULTS["num_epochs"])
    p.add_argument("--batch_size", type=int,   default=DEFAULTS["batch_size"])
    p.add_argument("--grad_accum", type=int,   default=DEFAULTS["grad_accum"])
    p.add_argument("--lr",         type=float, default=DEFAULTS["lr"])
    p.add_argument("--max_length", type=int,   default=DEFAULTS["max_length"])
    return p.parse_args()


def load_jsonl_or_json(path: str) -> list:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    if content.startswith("["):
        return json.loads(content)
    return [json.loads(line) for line in content.splitlines() if line.strip()]


def main():
    args = parse_args()

    # ── 1. 分词器 ──
    print(">>> [1/4] 加载分词器...")
    tokenizer = AutoTokenizer.from_pretrained(
        args.model, trust_remote_code=True, padding_side="right",
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token    = tokenizer.eos_token
        tokenizer.pad_token_id = tokenizer.eos_token_id

    # ── 2. 数据集 ──
    print(">>> [2/4] 加载并格式化数据集...")

    def format_sample(example: dict) -> dict:
        if "messages" in example:
            msgs = example["messages"]
            if msgs[0]["role"] != "system":
                msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + msgs
        else:
            msgs = [
                {"role": "system",    "content": SYSTEM_PROMPT},
                {"role": "user",      "content": example["input"]},
                {"role": "assistant", "content": example["output"]},
            ]
        text = tokenizer.apply_chat_template(
            msgs, tokenize=False,
            add_generation_prompt=False,
            enable_thinking=False,
        )
        return {"text": text}

    train_raw = load_jsonl_or_json(args.train_file)
    train_dataset = Dataset.from_list(train_raw).map(
        format_sample,
        remove_columns=Dataset.from_list(train_raw[:1]).column_names,
    )

    eval_dataset = None
    if os.path.exists(args.val_file):
        val_raw = load_jsonl_or_json(args.val_file)
        eval_dataset = Dataset.from_list(val_raw).map(
            format_sample,
            remove_columns=Dataset.from_list(val_raw[:1]).column_names,
        )

    print(f"    训练集: {len(train_dataset)} 条")
    if eval_dataset:
        print(f"    验证集: {len(eval_dataset)} 条")

    # 打印样本
    sample_text = train_dataset[0]["text"]
    print("\n    样本预览 (前 500 字):")
    print(sample_text[:500])

    non_empty_think = bool(re.search(r"<think>\s*\S+.*?</think>", sample_text, re.DOTALL))
    print(f"    含非空 <think> 块: {non_empty_think}")

    # Token 长度统计
    lengths = [len(tokenizer.encode(s["text"])) for s in train_dataset]
    print(f"    Token 统计: min={min(lengths)}, max={max(lengths)}, avg={sum(lengths)/len(lengths):.0f}")
    print(f"    超过 {args.max_length} 的样本: {sum(1 for l in lengths if l > args.max_length)} / {len(lengths)}")

    # ── 3. 模型 ──
    print("\n>>> [3/4] 加载模型（4-bit QLoRA）...")
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=bnb_config,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
        attn_implementation="sdpa",
    )
    model.enable_input_require_grads()

    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        use_rslora=True,
    )

    # ── 4. 训练 ──
    print(">>> [4/4] 开始训练...")
    sft_config = SFTConfig(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,

        optim="paged_adamw_8bit",
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        weight_decay=0.01,
        max_grad_norm=1.0,

        bf16=True,
        tf32=True,

        max_length=args.max_length,
        dataset_text_field="text",
        packing=False,

        eval_strategy="steps" if eval_dataset else "no",
        eval_steps=5,
        save_strategy="steps",
        save_steps=5,
        save_total_limit=3,
        load_best_model_at_end=(eval_dataset is not None),

        logging_steps=1,
        logging_first_step=True,
        report_to="tensorboard",

        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        seed=42,
        dataloader_num_workers=4,
        remove_unused_columns=False,
    )

    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
        peft_config=lora_config,
    )

    trainer.model.print_trainable_parameters()
    trainer.train()

    print(f"\n>>> 保存 Step1 LoRA adapter 到 {args.output_dir}")
    trainer.save_model(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)
    print(">>> Step1 训练完成。")


if __name__ == "__main__":
    main()
