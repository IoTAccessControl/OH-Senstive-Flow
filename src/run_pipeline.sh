#!/bin/bash
# 隐私数据流分析完整流程
# 依次调用：API分析 -> 数据流分析 -> 分类分发 -> 生成报告

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_PATH="${PROJECT_DIR}/.venv"
PYTHON="${VENV_PATH}/bin/python"

echo "========================================"
echo "隐私数据流分析流程"
echo "========================================"
echo ""

# 检查虚拟环境
if [ ! -f "$PYTHON" ]; then
    echo "错误: 找不到虚拟环境 $VENV_PATH"
    echo "请先运行: cd $PROJECT_DIR && uv venv && uv pip install -r pyproject.toml"
    exit 1
fi

# 步骤1: 分析HarmonyOS API
echo "[1/4] 分析HarmonyOS API调用..."
cd "$PROJECT_DIR"
$PYTHON "${SCRIPT_DIR}/analyze_harmony_api.py"
echo ""

# 步骤2: 隐私数据流分析
echo "[2/4] 分析隐私数据流..."
$PYTHON "${SCRIPT_DIR}/privacy_flow_analyzer.py"
echo ""

# 步骤3: 分类与分发
echo "[3/4] 分类功能模块并分发数据流..."
$PYTHON "${SCRIPT_DIR}/classify_and_distribute.py"
echo ""

# 步骤4: 生成隐私声明报告
echo "[4/4] 生成隐私声明报告..."
$PYTHON "${SCRIPT_DIR}/generate_privacy_report.py"
echo ""

echo "========================================"
echo "流程完成！"
echo "========================================"
echo "生成的文件:"
echo "  - results/harmony_api_results.json"
echo "  - results/data_flow_results.json"
echo "  - results/device_info/data_flow_results.json"
echo "  - results/network_info/data_flow_results.json"
echo "  - results/device_info/report.md"
echo "  - results/network_info/report.md"
echo "  - results/report.md (完整报告)"
