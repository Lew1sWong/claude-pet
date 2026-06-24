@echo off
chcp 65001 >nul
title Claude Pet
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [需要 Node.js] 请先安装 Node.js: https://nodejs.org
  echo  安装后重新双击本文件即可。
  echo.
  pause
  exit /b
)

if not exist "node_modules" (
  echo  第一次运行，正在下载依赖（约 1-2 分钟）...
  call npm install
)

echo  启动桌宠中...
call npm start
