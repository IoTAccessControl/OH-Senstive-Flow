#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

analyze_app() {
  local app="$1"
  echo "==> ${app}"
  npm run analyze -- \
    --appPath "input/app/${app}/" \
    --sdkPath input/sdk/default/openharmony/ets/ \
    --csvDir input/csv/ \
    --graphBackend cpg
}

export -f analyze_app
export REPO_ROOT

for gt in groundtruth/permission/*.txt; do
  basename "${gt}" .txt
done | xargs -I{} -P "${MAX_PARALLEL:-3}" bash -c 'cd "${REPO_ROOT}" && analyze_app "$1"' _ {}
