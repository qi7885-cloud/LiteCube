@echo off
chcp 65001 >nul
title 轻立方 LiteCube - 本地服务
cd /d "%~dp0"

set PORT=8123
set URL=http://localhost:%PORT%/app/index.html

where python >nul 2>nul
if %errorlevel%==0 (
  echo 正在启动轻立方（本地服务，关掉本窗口即退出）...
  echo 浏览器将自动打开 %URL%
  start "" cmd /c "timeout /t 1 >nul & start "" "%URL%""
  python "本地服务.py" %PORT%
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo 正在启动轻立方（本地服务，关掉本窗口即退出）...
  echo 浏览器将自动打开 %URL%
  start "" cmd /c "timeout /t 1 >nul & start "" "%URL%""
  py "本地服务.py" %PORT%
  goto :eof
)

echo 未检测到 Python，改用 Windows 自带的 PowerShell 服务...
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %PORT%
timeout /t 1 >nul
start "" "%URL%"
echo 已启动。关闭本窗口前请先关闭浏览器页面。
pause >nul
