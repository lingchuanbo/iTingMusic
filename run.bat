@echo off
chcp 65001 >nul
title Zen Player

echo ========================================
echo        Zen Player 启动脚本
echo ========================================
echo.

:: 检查 node_modules 是否存在
if not exist "node_modules" (
    echo [1/2] 正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
    echo 依赖安装完成！
    echo.
) else (
    echo [1/2] 依赖已安装，跳过...
)

echo [2/2] 启动开发服务器...
echo.
echo 启动后请访问: http://localhost:5173
echo 按 Ctrl+C 停止服务器
echo ========================================
echo.

npm run dev

pause
