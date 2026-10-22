#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22 或更新版本：https://nodejs.org/'
  exit 1
fi
echo '余烬营地：http://localhost:3000'
node server.mjs
