"""
推理对比脚本 —— Base Model vs LoRA Adapter 输出对比
支持 Step1 和 Step2 两个阶段

用法:
    # Step1: 数据流 → 结构化隐私描述
    python scripts/inference.py \
        --adapter_path ./output/step1_flow2desc \
        --step 1 \
        --input_file test_input.json

    # Step2: 结构化隐私描述 → 合规隐私声明
    python scripts/inference.py \
        --adapter_path ./output/step2_desc2report \
        --step 2 \
        --input_file test_input.txt

    # 交互式
    python scripts/inference.py --adapter_path ./output/step1_flow2desc --step 1

    # 两阶段串联推理 (step1 输出自动传入 step2)
    python scripts/inference.py \
        --adapter_path_step1 ./output/step1_flow2desc \
        --adapter_path_step2 ./output/step2_desc2report \
        --pipeline \
        --input_file scan_data.json
"""

import argparse
import json
import re
import sys
import time
import torch
from peft import PeftModel, PeftConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TextStreamer


# ══════════════════════════════════════════════════════════════
# System Prompts
# ══════════════════════════════════════════════════════════════

SYSTEM_PROMPTS = {
    1: (
        "你是一名专业的隐私合规数据分析助手。"
        "你的任务是根据输入的代码静态扫描数据流结构化信息（包含数据类型、触发函数、数据流步骤等），"
        "生成对应的结构化隐私场景说明文本。"
        "输出应包含：场景标题、场景描述、收集信息说明、必要性说明、处理方式与安全措施等内容。"
        "请严格围绕输入中的数据流信息生成，不得虚构未出现的功能或数据类型。"
        "输出语言应准确、结构清晰，便于后续生成正式隐私政策文本。"
    ),
    2: (
        "你是一名专业的隐私合规文本重写助手。"
        "你的任务是根据输入的隐私场景说明文本，"
        "生成对应的标准化隐私政策输出文本。"
        "输入通常包含场景标题、场景描述、收集信息、必要性说明、处理方式与安全措施等结构化内容；"
        "输出应转换为\"我们如何收集和使用您的个人信息\"风格的正式隐私政策声明。"
        "请严格围绕输入内容生成，不得虚构未出现的业务功能，不得遗漏关键数据类型、用途、必要性、处理方式、安全措施和权限说明。"
        "输出语言应正式、准确、连贯，符合隐私政策写作习惯，"
        "可对原文进行结构整合和措辞规范化，但不得改变原意。"
    ),
}


# ══════════════════════════════════════════════════════════════
# 自定义 Streamer：过滤 <think>...</think>
# ══════════════════════════════════════════════════════════════

class NoThinkStreamer(TextStreamer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._buf      = ""
        self._in_think = False

    def on_finalized_text(self, text: str, stream_end: bool = False):
        self._buf += text
        while True:
            if self._in_think:
                end = self._buf.find("</think>")
                if end == -1:
                    break
                self._buf      = self._buf[end + len("</think>"):]
                self._in_think = False
            else:
                start = self._buf.find("<think>")
                if start == -1:
                    safe = self._buf if stream_end else self._buf[:-8]
                    if safe:
                        super().on_finalized_text(safe, stream_end=False)
                        self._buf = self._buf[len(safe):]
                    break
                else:
                    if start > 0:
                        super().on_finalized_text(self._buf[:start], stream_end=False)
                    self._buf      = self._buf[start + len("<think>"):]
                    self._in_think = True
        if stream_end and self._buf:
            super().on_finalized_text(self._buf, stream_end=True)
            self._buf = ""


# ══════════════════════════════════════════════════════════════
# 模型加载
# ══════════════════════════════════════════════════════════════

def load_base_and_lora(adapter_path: str):
    peft_config     = PeftConfig.from_pretrained(adapter_path)
    base_model_path = peft_config.base_model_name_or_path

    tokenizer = AutoTokenizer.from_pretrained(
        adapter_path, trust_remote_code=True, padding_side="left",
    )

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    print(f"  加载 base model: {base_model_path}")
    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_path,
        quantization_config=bnb_config,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
        attn_implementation="sdpa",
    )
    base_model.eval()

    print(f"  加载 LoRA adapter: {adapter_path}")
    lora_model = PeftModel.from_pretrained(base_model, adapter_path)
    lora_model.eval()

    return base_model, lora_model, tokenizer


def build_prompt(tokenizer, user_input: str, step: int) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPTS[step]},
        {"role": "user",   "content": user_input},
    ]
    return tokenizer.apply_chat_template(
        messages, tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )


def generate_stream(model, tokenizer, prompt: str,
                    max_new_tokens: int = 4096,
                    temperature: float = 0.1,
                    stream: bool = True) -> str:
    device = next(model.parameters()).device
    inputs = tokenizer(prompt, return_tensors="pt").to(device)

    streamer = None
    if stream:
        streamer = NoThinkStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=(temperature > 0),
            temperature=temperature,
            top_p=0.9,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
            streamer=streamer,
        )

    new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
    response   = tokenizer.decode(new_tokens, skip_special_tokens=True)
    response   = re.sub(r"<think>.*?</think>\s*", "", response, flags=re.DOTALL).strip()
    return response


# ══════════════════════════════════════════════════════════════
# 单阶段对比推理
# ══════════════════════════════════════════════════════════════

def run_comparison(adapter_path: str, step: int, user_input: str,
                   max_new_tokens: int = 4096, temperature: float = 0.1):
    print(f"\n{'='*60}")
    print(f"  Step{step} 推理对比")
    print(f"{'='*60}")

    base_model, lora_model, tokenizer = load_base_and_lora(adapter_path)
    prompt = build_prompt(tokenizer, user_input, step)

    # ── Base Model ──
    print(f"\n{'─'*60}")
    print(f"【Base Model 输出】(Step{step})")
    print(f"{'─'*60}\n")
    t0 = time.time()
    with lora_model.disable_adapter():
        base_response = generate_stream(
            lora_model, tokenizer, prompt,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
        )
    base_time = time.time() - t0

    # ── LoRA Model ──
    print(f"\n\n{'─'*60}")
    print(f"【LoRA Fine-tuned Model 输出】(Step{step})")
    print(f"{'─'*60}\n")
    t0 = time.time()
    lora_response = generate_stream(
        lora_model, tokenizer, prompt,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
    )
    lora_time = time.time() - t0

    # ── 统计 ──
    print(f"\n\n{'='*60}")
    print(f"【对比统计】Step{step}")
    print(f"{'='*60}")
    print(f"  Base Model : {len(base_response)} 字 | {base_time:.1f}s")
    print(f"  LoRA Model : {len(lora_response)} 字 | {lora_time:.1f}s")

    return base_response, lora_response, tokenizer, lora_model


# ══════════════════════════════════════════════════════════════
# 两阶段串联推理
# ══════════════════════════════════════════════════════════════

def run_pipeline(adapter_path_step1: str, adapter_path_step2: str,
                 user_input: str, max_new_tokens: int = 4096,
                 temperature: float = 0.1):
    print(f"\n{'='*60}")
    print("  两阶段串联推理 Pipeline")
    print(f"{'='*60}")

    # ── Step1 ──
    print(f"\n>>> 加载 Step1 模型...")
    _, lora_model_1, tokenizer_1 = load_base_and_lora(adapter_path_step1)

    prompt_1 = build_prompt(tokenizer_1, user_input, step=1)

    print(f"\n{'─'*60}")
    print("【Step1: 数据流 → 结构化隐私描述】")
    print(f"{'─'*60}\n")
    step1_output = generate_stream(
        lora_model_1, tokenizer_1, prompt_1,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
    )

    # 释放 Step1 模型显存
    del lora_model_1
    torch.cuda.empty_cache()

    # ── Step2 ──
    print(f"\n\n>>> 加载 Step2 模型...")
    _, lora_model_2, tokenizer_2 = load_base_and_lora(adapter_path_step2)

    prompt_2 = build_prompt(tokenizer_2, step1_output, step=2)

    print(f"\n{'─'*60}")
    print("【Step2: 结构化描述 → 合规隐私声明】")
    print(f"{'─'*60}\n")
    step2_output = generate_stream(
        lora_model_2, tokenizer_2, prompt_2,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
    )

    # ── 汇总 ──
    print(f"\n\n{'='*60}")
    print("【Pipeline 汇总】")
    print(f"{'='*60}")
    print(f"  Step1 输出: {len(step1_output)} 字")
    print(f"  Step2 输出: {len(step2_output)} 字")
    print(f"\n--- Step1 中间结果 (前 300 字) ---")
    print(step1_output[:300], "...")
    print(f"\n--- Step2 最终结果 (前 500 字) ---")
    print(step2_output[:500], "...")

    return step1_output, step2_output


# ══════════════════════════════════════════════════════════════
# 读取输入
# ══════════════════════════════════════════════════════════════

def read_input(input_file: str = None) -> str:
    if input_file:
        with open(input_file, "r", encoding="utf-8") as f:
            content = f.read()
        try:
            parsed = json.loads(content)
            return json.dumps(parsed, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            return content.strip()
    else:
        print("请输入（Ctrl+D 结束）：")
        return sys.stdin.read().strip()


# ══════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="两阶段推理对比脚本")

    # 单阶段模式
    parser.add_argument("--adapter_path", default=None,
                        help="LoRA adapter 目录 (单阶段模式)")
    parser.add_argument("--step", type=int, choices=[1, 2], default=None,
                        help="阶段编号: 1=数据流→描述, 2=描述→声明")

    # Pipeline 模式
    parser.add_argument("--pipeline", action="store_true",
                        help="启用两阶段串联推理")
    parser.add_argument("--adapter_path_step1", default="./output/step1_flow2desc",
                        help="Step1 LoRA adapter 目录")
    parser.add_argument("--adapter_path_step2", default="./output/step2_desc2report",
                        help="Step2 LoRA adapter 目录")

    # 通用参数
    parser.add_argument("--input_file",     default=None)
    parser.add_argument("--max_new_tokens", type=int,   default=4096)
    parser.add_argument("--temperature",    type=float, default=0.1)

    # 保存结果
    parser.add_argument("--save_results",   default=None,
                        help="保存结果到 JSON 文件")

    args = parser.parse_args()

    user_input = read_input(args.input_file)

    if args.pipeline:
        # ── 两阶段串联 ──
        step1_out, step2_out = run_pipeline(
            args.adapter_path_step1,
            args.adapter_path_step2,
            user_input,
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
        )
        if args.save_results:
            results = {
                "input": user_input,
                "step1_output": step1_out,
                "step2_output": step2_out,
            }
            with open(args.save_results, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
            print(f"\n结果已保存至 {args.save_results}")

    else:
        # ── 单阶段对比 ──
        if not args.adapter_path:
            parser.error("单阶段模式需要 --adapter_path")
        if not args.step:
            # 自动推断 step
            if "step1" in args.adapter_path or "flow2desc" in args.adapter_path:
                args.step = 1
            elif "step2" in args.adapter_path or "desc2report" in args.adapter_path:
                args.step = 2
            else:
                parser.error("无法自动推断 --step，请手动指定 --step 1 或 --step 2")
            print(f"  自动推断: Step {args.step}")

        base_resp, lora_resp, _, _ = run_comparison(
            args.adapter_path,
            args.step,
            user_input,
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
        )
        if args.save_results:
            results = {
                "input": user_input,
                "step": args.step,
                "base_response": base_resp,
                "lora_response": lora_resp,
            }
            with open(args.save_results, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
            print(f"\n结果已保存至 {args.save_results}")
