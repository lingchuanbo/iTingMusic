@echo off
chcp 65001 >nul
title Zen Player - Android 编译

echo ========================================
echo     Zen Player Android 编译脚本
echo ========================================
echo.

:: 检查 node_modules 是否存在
if not exist "node_modules" (
    echo [1/6] 正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
    echo 依赖安装完成！
    echo.
) else (
    echo [1/6] 依赖已安装，跳过...
)

:: 检查 Capacitor 是否安装
echo [2/6] 检查 Capacitor...
call npm list @capacitor/core >nul 2>&1
if errorlevel 1 (
    echo 正在安装 Capacitor...
    call npm install @capacitor/core @capacitor/cli @capacitor/android
    if errorlevel 1 (
        echo Capacitor 安装失败
        pause
        exit /b 1
    )
)
echo Capacitor 已就绪！
echo.

:: 检查是否已初始化 Capacitor
if not exist "capacitor.config.ts" (
    echo [3/6] 初始化 Capacitor...
    call npx cap init "Zen Player" "com.zenplayer.app" --web-dir dist
    if errorlevel 1 (
        echo Capacitor 初始化失败
        pause
        exit /b 1
    )
    echo Capacitor 初始化完成！
    echo.
) else (
    echo [3/6] Capacitor 已初始化，跳过...
)

:: 构建 Web 项目
echo [4/6] 构建 Web 项目...
call npm run build
if errorlevel 1 (
    echo Web 项目构建失败
    pause
    exit /b 1
)
echo Web 项目构建完成！
echo.

:: 检查是否已添加 Android 平台
if not exist "android" (
    echo [5/6] 添加 Android 平台...
    call npx cap add android
    if errorlevel 1 (
        echo Android 平台添加失败
        pause
        exit /b 1
    )
    echo Android 平台添加完成！
    echo.
) else (
    echo [5/6] Android 平台已存在，跳过...
)

:: 同步到 Android
echo [6/6] 同步到 Android...
call npx cap sync android
if errorlevel 1 (
    echo 同步失败
    pause
    exit /b 1
)
echo 同步完成！
echo.

echo ========================================
echo           编译完成！
echo ========================================
echo.
echo 接下来你可以：
echo   1. 运行 "npx cap open android" 打开 Android Studio
echo   2. 在 Android Studio 中点击 Run 运行到手机
echo   3. 或点击 Build ^> Build Bundle(s) / APK(s) 生成 APK
echo.
echo APK 文件位置：
echo   android\app\build\outputs\apk\debug\app-debug.apk
echo.

set /p choice=是否打开 Android Studio？(Y/N): 
if /i "%choice%"=="Y" (
    echo 正在打开 Android Studio...
    call npx cap open android
)

pause
