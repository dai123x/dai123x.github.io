@echo off
setlocal
cd /d "%~dp0"
title 网址管理系统 - 停止服务

echo ============================================================
echo           正在停止【网址管理系统】后台服务...
echo ============================================================
echo.

set "STOPPED=0"

:: 1. 优先按记录的 PID 终止
if exist ".server.pid" (
    for /f "usebackq delims=" %%i in (".server.pid") do (
        taskkill /f /pid %%i >nul 2>nul
        if not errorlevel 1 set "STOPPED=1"
    )
    del /f /q ".server.pid" >nul 2>nul
)

:: 2. 按 8089 端口占用兜底查找并终止
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8089" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>nul
    if not errorlevel 1 set "STOPPED=1"
)

if "%STOPPED%"=="1" (
    echo [成功] 网址管理系统后台服务已安全退出！
) else (
    echo [提示] 未发现正在运行的服务 (可能此前已经关闭)。
)

echo.
echo 本窗口将在 2 秒后自动关闭...
ping -n 3 127.0.0.1 >nul
exit /b 0
