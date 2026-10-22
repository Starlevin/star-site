@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请安装 Node.js 22 或更新版本： https://nodejs.org/
  pause
  exit /b 1
)
echo.
echo =======================================
echo  余烬营地 - 本地联机服务器
 echo  浏览器入口: http://localhost:3000
 echo  关闭此窗口即可停止本地服务器
 echo =======================================
echo.
start "" "http://localhost:3000"
node server.mjs
pause
