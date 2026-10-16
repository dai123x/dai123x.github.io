@echo off
setlocal
cd /d "%~dp0"
title 网址管理系统 - 正在启动...

:: 1. 检查是否已经在运行
if exist ".server.pid" (
    for /f "usebackq delims=" %%i in (".server.pid") do (
        tasklist /fi "PID eq %%i" 2>nul | find "%%i" >nul
        if not errorlevel 1 (
            echo 检测到服务已经在后台运行中，正在为您打开浏览器...
            start http://127.0.0.1:8089
            exit /b 0
        )
    )
)

:: 2. 查找 Python 路径
set "PY_BIN="
if exist "D:\Anaconda\pythonw.exe" set "PY_BIN=D:\Anaconda\pythonw.exe"
if not defined PY_BIN if exist "C:\Program Files\PyManager\pythonw.exe" set "PY_BIN=C:\Program Files\PyManager\pythonw.exe"
if not defined PY_BIN (
    for /f "delims=" %%p in ('where pythonw 2^>nul') do if not defined PY_BIN set "PY_BIN=%%p"
)
if not defined PY_BIN (
    for /f "delims=" %%p in ('where python 2^>nul') do if not defined PY_BIN set "PY_BIN=%%p"
)

if not defined PY_BIN (
    echo [错误] 未能检测到 Python 运行环境！
    pause
    exit /b 1
)

:: 3. 启动后台服务
start "" "%PY_BIN%" server.py

:: 4. 等待 1 秒
ping -n 2 127.0.0.1 >nul

:: 5. 唤起默认浏览器
start http://127.0.0.1:8089

exit /b 0
