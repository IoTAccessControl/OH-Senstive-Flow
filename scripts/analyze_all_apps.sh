#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

: "${QWEN_API_KEY:?Please export QWEN_API_KEY before running this script.}"

for app in input/app/*/; do
  [ -d "${app}" ] || continue

  echo "==> $(basename "${app}")"

  npm run analyze -- \
    --appPath "${app}" \
    --sdkPath input/sdk/default/openharmony/ets/ \
    --csvDir input/csv/ \
    --graphBackend cpg \
    --llmProvider Qwen \
    --llmApiKey "${QWEN_API_KEY}" \
    --llmModel qwen3.5-plus \
    --uiLlmProvider Qwen \
    --uiLlmApiKey "${QWEN_API_KEY}" \
    --uiLlmModel qwen3.5-plus \
    --privacyReportLlmProvider Qwen \
    --privacyReportLlmApiKey "${QWEN_API_KEY}" \
    --privacyReportLlmModel qwen3.5-plus
done
