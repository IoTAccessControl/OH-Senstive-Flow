#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 两阶段微调一键运行脚本
# ═══════════════════════════════════════════════════════════
set -e

# 配置 —— 按需修改
MODEL_PATH="models/Qwen/Qwen3-32B"       # 基座模型路径
EPOCHS=3
BATCH_SIZE=1
GRAD_ACCUM=4
LR=5e-5
MAX_LENGTH=4096
VAL_RATIO=0.0                              # 0 = 不拆分验证集

echo "══════════════════════════════════════════════"
echo "  Step 0: 数据预处理"
echo "══════════════════════════════════════════════"

# 确认原始数据文件存在
if [ ! -f "firstphase.json" ]; then
    echo "[ERROR] 找不到 firstphase.json，请将文件放在项目根目录"
    exit 1
fi
if [ ! -f "secondphase.json" ]; then
    echo "[ERROR] 找不到 secondphase.json，请将文件放在项目根目录"
    exit 1
fi

python scripts/build_dataset_step1.py \
    --raw firstphase.json \
    --out data \
    --val_ratio $VAL_RATIO

python scripts/build_dataset_step2.py \
    --raw secondphase.json \
    --out data \
    --val_ratio $VAL_RATIO


echo ""
echo "══════════════════════════════════════════════"
echo "  Step 1: 训练 数据流 → 结构化隐私描述"
echo "══════════════════════════════════════════════"

python train_step1.py \
    --model $MODEL_PATH \
    --train_file data/step1_train.jsonl \
    --val_file   data/step1_val.jsonl \
    --output_dir ./output/step1_flow2desc \
    --epochs     $EPOCHS \
    --batch_size $BATCH_SIZE \
    --grad_accum $GRAD_ACCUM \
    --lr         $LR \
    --max_length $MAX_LENGTH


echo ""
echo "══════════════════════════════════════════════"
echo "  Step 2: 训练 结构化描述 → 合规隐私声明"
echo "══════════════════════════════════════════════"

python train_step2.py \
    --model $MODEL_PATH \
    --train_file data/step2_train.jsonl \
    --val_file   data/step2_val.jsonl \
    --output_dir ./output/step2_desc2report \
    --epochs     $EPOCHS \
    --batch_size $BATCH_SIZE \
    --grad_accum $GRAD_ACCUM \
    --lr         $LR \
    --max_length $MAX_LENGTH


echo ""
echo "══════════════════════════════════════════════"
echo "  训练完成！"
echo "══════════════════════════════════════════════"
echo "  Step1 LoRA adapter: ./output/step1_flow2desc"
echo "  Step2 LoRA adapter: ./output/step2_desc2report"
echo ""
echo "推理示例:"
echo "  # Step1 单阶段对比"
echo "  python scripts/inference.py --adapter_path ./output/step1_flow2desc --step 1 --input_file test.json"
echo ""
echo "  # Step2 单阶段对比"
echo "  python scripts/inference.py --adapter_path ./output/step2_desc2report --step 2 --input_file test.txt"
echo ""
echo "  # 两阶段串联"
echo "  python scripts/inference.py --pipeline --input_file test.json"
