#!/bin/bash
cd "$(dirname "$0")"

# 已经在跑就不重复启动（Electron 单实例锁也会兜底）
if pgrep -f "electron .*claude-pet/desktop" >/dev/null 2>&1; then
  echo "桌宠已经在运行啦（看菜单栏右上角的小图标）"
  sleep 2
  exit 0
fi

if [ ! -d node_modules ]; then
  echo "第一次启动，正在安装依赖（约 1-2 分钟）…"
  npm install || { echo "npm install 失败，请确认已安装 Node.js"; read -n 1; exit 1; }
fi

# 后台分离启动：本窗口可以直接关掉，宠物继续运行
nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
disown
echo "桌宠已启动！这个窗口可以关了。"
echo "退出宠物：点屏幕右上角菜单栏的橘猫图标 → 退出"
sleep 3
exit 0
