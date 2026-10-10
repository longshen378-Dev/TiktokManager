#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Cần cài Node.js 24.19 trở lên trước khi chạy.'
  exit 1
fi
if ! node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>24 || v[0]===24 && v[1]>=19 ? 0 : 1)"; then
  echo 'Node.js quá cũ. Hãy cài Node.js 24.19 trở lên.'
  exit 1
fi
node scripts/prepare.js
exec node --use-env-proxy launch.js
