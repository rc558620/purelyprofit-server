#!/usr/bin/env bash
# 后端一键重启脚本（普通模式）：清理所有后端实例 → 重新编译 → 启动 → 重启打印代理
# 用法：bash scripts/restart-backend.sh
# 背景：nest start --watch 在本机存在优雅关闭卡死问题（HTTP 已关、进程不退、新进程起不来），
#       故统一使用普通模式运行，改完代码后执行本脚本即可生效。
set -e
cd "$(dirname "$0")/.."

echo "1/4 停止旧后端进程..."
pkill -9 -f "dist/src/main" 2>/dev/null || true
pkill -9 -f "nest.js start" 2>/dev/null || true
sleep 1

echo "2/4 编译..."
npx nest build > /tmp/restart-backend-build.log 2>&1 || { tail -20 /tmp/restart-backend-build.log; exit 1; }
echo "   TSC 编译通过"

echo "3/4 启动后端（普通模式，日志 logs/server-dev.log）..."
nohup node --enable-source-maps dist/src/main > logs/server-dev.log 2>&1 &
sleep 8
if lsof -iTCP:3000 -sTCP:LISTEN -P 2>/dev/null | grep -q node; then
  echo "   后端已监听 3000 ✅"
else
  echo "   后端启动失败，请查看 logs/server-dev.log"
  exit 1
fi

echo "4/4 重启打印代理（launchd）..."
launchctl kickstart -k "gui/$(id -u)/com.purelyprofit.print-agent" 2>/dev/null || true
sleep 5
redis-cli get purelyprofit:print-agent:online:37 | sed 's/^/   代理在线标记 = /'

echo "✅ 完成：后端 $(lsof -iTCP:3000 -sTCP:LISTEN -P 2>/dev/null | tail -1 | awk '{print $2}') 运行中，代理已重连"
