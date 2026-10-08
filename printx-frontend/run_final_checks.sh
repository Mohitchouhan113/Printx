#!/bin/bash
set -o pipefail
cd "$(dirname "$0")"
echo "RUNNING: npm run build"
npm run build > /tmp/buildfinal_full.log 2>&1
BUILD_EXIT=$?
echo "BUILD_EXIT=$BUILD_EXIT"
if [ $BUILD_EXIT -ne 0 ]; then
  echo "FAILED: build did not exit 0"
  grep -E "Failed to compile|Type error|^Error:" /tmp/buildfinal_full.log || true
  tail -n 20 /tmp/buildfinal_full.log
  exit 1
fi
echo "BUILD OK"
node tmp_check7.js
