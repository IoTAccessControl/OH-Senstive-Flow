# 两阶段隐私合规文本生成 —— LoRA 微调

## 概述

将隐私合规报告生成拆分为两个专精阶段，各训练一个 LoRA adapter：

| 阶段 | 输入 | 输出 | Adapter 目录 |
|------|------|------|-------------|
| **Step1** `flow2desc` | 代码扫描数据流 JSON | 结构化隐私场景描述 | `output/step1_flow2desc` |
| **Step2** `desc2report` | 结构化隐私场景描述 | 合规隐私政策声明 | `output/step2_desc2report` |

推理时可单独使用，也可 **串联 (pipeline)** ：扫描数据 → Step1 → Step2 → 正式隐私声明。

## 项目结构

```
FineTuning2Phase/
├── firstphase.json              # ★ 原始数据 - Step1（需自行放入）
├── secondphase.json             # ★ 原始数据 - Step2（需自行放入）
├── train_step1.py               # Step1 训练脚本
├── train_step2.py               # Step2 训练脚本
├── run_all.sh                   # 一键运行（数据处理 + 两阶段训练）
├── requirements.txt
├── scripts/
│   ├── build_dataset_step1.py   # Step1 数据预处理
│   ├── build_dataset_step2.py   # Step2 数据预处理
│   └── inference.py             # 推理对比 (支持单阶段 / Pipeline)
├── data/                        # 预处理后的训练数据（自动生成）
│   ├── step1_train.jsonl
│   ├── step1_val.jsonl
│   ├── step2_train.jsonl
│   └── step2_val.jsonl
├── output/
│   ├── step1_flow2desc/         # Step1 LoRA adapter
│   └── step2_desc2report/       # Step2 LoRA adapter
└── models/Qwen/Qwen3-32B/      # 基座模型
```

## 环境配置

### 硬件要求

| 模型 | 显存需求 (4-bit QLoRA 训练) | 显存需求 (推理) | 推荐 GPU |
|------|---------------------------|----------------|----------|
| Qwen3-0.6B | ~4 GB | ~2 GB | RTX 3060 12G 及以上 |
| Qwen3-14B | ~20 GB | ~12 GB | RTX 4090 24G / A100 40G |
| Qwen3-32B | ~40 GB | ~20 GB | A100 80G / 2×RTX 4090 |

> Pipeline 串联推理时两个阶段顺序执行，Step1 模型会在 Step2 加载前释放显存，峰值显存等于单阶段推理。

### 软件依赖

**操作系统**：Linux (推荐 Ubuntu 22.04+)

**Python**：>= 3.10

**CUDA**：>= 12.1（需与 PyTorch 版本匹配）

**驱动**：NVIDIA Driver >= 535

### 安装步骤

```bash
# 1. 创建虚拟环境（推荐）
conda create -n finetune python=3.11 -y
conda activate finetune

# 2. 安装 PyTorch（根据 CUDA 版本选择，以下为 CUDA 12.1 示例）
pip install torch==2.4.0 --index-url https://download.pytorch.org/whl/cu121

# 3. 安装项目依赖
pip install -r requirements.txt

# 4. 验证环境
python -c "
import torch
print(f'PyTorch:        {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
print(f'GPU count:      {torch.cuda.device_count()}')
if torch.cuda.is_available():
    for i in range(torch.cuda.device_count()):
        name = torch.cuda.get_device_name(i)
        mem  = torch.cuda.get_device_properties(i).total_mem / 1024**3
        print(f'  GPU {i}: {name} ({mem:.1f} GB)')
    print(f'BF16 support:   {torch.cuda.is_bf16_supported()}')

import transformers, peft, trl, bitsandbytes
print(f'transformers:   {transformers.__version__}')
print(f'peft:           {peft.__version__}')
print(f'trl:            {trl.__version__}')
print(f'bitsandbytes:   {bitsandbytes.__version__}')
print('环境检查通过 ✓')
"
```

### 基座模型准备

将 Qwen3 模型下载到 `models/Qwen/` 目录下：

```bash
# 方式一：Hugging Face Hub（需联网）
pip install huggingface_hub
huggingface-cli download Qwen/Qwen3-32B --local-dir models/Qwen/Qwen3-32B

# 方式二：ModelScope（国内推荐）
pip install modelscope
modelscope download --model Qwen/Qwen3-32B --local_dir models/Qwen/Qwen3-32B

# 方式三：手动下载后放入对应目录
# models/Qwen/Qwen3-32B/
#   ├── config.json
#   ├── tokenizer.json
#   ├── tokenizer_config.json
#   ├── model-00001-of-00017.safetensors
#   └── ...
```

### 常见问题

**Q: `bitsandbytes` 安装报错**
```bash
# 确保 CUDA toolkit 已安装，或使用预编译版本
pip install bitsandbytes --prefer-binary
```

**Q: OOM (显存不足)**
```bash
# 方案 1：降低 batch size 和序列长度
python train_step1.py --batch_size 1 --grad_accum 8 --max_length 2048

# 方案 2：换用更小的基座模型
python train_step1.py --model models/Qwen/Qwen3-14B

# 方案 3：减小 LoRA rank
python train_step1.py --lora_r 16 --lora_alpha 32
```

**Q: `flash_attn` 未安装**
脚本默认使用 `sdpa` 注意力实现（PyTorch 原生），无需额外安装 Flash Attention。如需启用：
```bash
pip install flash-attn --no-build-isolation
# 然后修改训练脚本中 attn_implementation="sdpa" → "flash_attention_2"
```

## 快速开始

### 1. 放入数据

将 `firstphase.json` 和 `secondphase.json` 放到项目根目录。

### 2. 一键训练

```bash
chmod +x run_all.sh
./run_all.sh
```

### 3. 分步运行

```bash
# 数据预处理
python scripts/build_dataset_step1.py --raw firstphase.json --out data --val_ratio 0.1
python scripts/build_dataset_step2.py --raw secondphase.json --out data --val_ratio 0.1

# 训练 Step1
python train_step1.py --model models/Qwen/Qwen3-32B --epochs 3

# 训练 Step2
python train_step2.py --model models/Qwen/Qwen3-32B --epochs 3
```

## 推理

### 单阶段对比（Base vs LoRA）

```bash
# Step1 对比
python scripts/inference.py \
    --adapter_path ./output/step1_flow2desc \
    --step 1 \
    --input_file test_scan.json

# Step2 对比
python scripts/inference.py \
    --adapter_path ./output/step2_desc2report \
    --step 2 \
    --input_file test_desc.txt

# 保存结果
python scripts/inference.py \
    --adapter_path ./output/step1_flow2desc \
    --step 1 \
    --input_file test.json \
    --save_results results_step1.json
```

### 两阶段串联 (Pipeline)

```bash
python scripts/inference.py \
    --pipeline \
    --adapter_path_step1 ./output/step1_flow2desc \
    --adapter_path_step2 ./output/step2_desc2report \
    --input_file scan.json \
    --save_results pipeline_result.json
```

## 数据格式

### firstphase.json（Step1 训练数据）

```json
[
  {
    "input": {
      "id": "FLOW_XXX",
      "data_type": "...",
      "description": "...",
      "flow_steps": [
        {"step": "Trigger", "function": "...", "file": "...", "line": 1, "code": "...", "details": "..."},
        ...
      ]
    },
    "output": "场景标题... 场景描述... 收集信息... 必要性说明... 处理方式..."
  }
]
```

### secondphase.json（Step2 训练数据）

```json
[
  {
    "input": "结构化隐私场景描述文本...",
    "output": "我们如何收集和使用您的个人信息... 正式隐私声明..."
  }
]
```

## 超参数调整

可通过命令行参数覆盖默认配置：

```bash
python train_step1.py \
    --model models/Qwen/Qwen3-14B \   # 换小模型
    --epochs 5 \
    --lr 3e-5 \
    --lora_r 16 \
    --lora_alpha 32 \
    --max_length 8192
```