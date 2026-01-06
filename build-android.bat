@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Zen Player - Android 编译

echo ========================================
echo     Zen Player Android 编译脚本
echo ========================================
echo.

:: 检查 node_modules 是否存在
if not exist "node_modules" (
    echo [1/7] 正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
    echo 依赖安装完成！
    echo.
) else (
    echo [1/7] 依赖已安装，跳过...
)

:: 检查 Capacitor 是否安装
echo [2/7] 检查 Capacitor...
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
    echo [3/7] 初始化 Capacitor...
    call npx cap init "Zen Player" "com.zenplayer.app" --web-dir dist
    if errorlevel 1 (
        echo Capacitor 初始化失败
        pause
        exit /b 1
    )
    echo Capacitor 初始化完成！
    echo.
) else (
    echo [3/7] Capacitor 已初始化，跳过...
)

:: 构建 Web 项目
echo [4/7] 构建 Web 项目...
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
    echo [5/7] 添加 Android 平台...
    call npx cap add android
    if errorlevel 1 (
        echo Android 平台添加失败
        pause
        exit /b 1
    )
    echo Android 平台添加完成！
    echo.
) else (
    echo [5/7] Android 平台已存在，跳过...
)

:: 同步到 Android
echo [6/7] 同步到 Android...
call npx cap sync android
if errorlevel 1 (
    echo 同步失败
    pause
    exit /b 1
)
echo 同步完成！
echo.

:: 直接编译 APK
echo [7/7] 编译 APK...
echo.

:: 检查并设置 JAVA_HOME
if "%JAVA_HOME%"=="" (
    echo JAVA_HOME 未设置，尝试自动查找...
    
    :: 优先使用 Android Studio 自带的 JBR
    if exist "C:\Program Files\Android\Android Studio\jbr" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
        echo 已自动设置 JAVA_HOME: !JAVA_HOME!
    ) else if exist "C:\Program Files\Java\jdk-17" (
        set "JAVA_HOME=C:\Program Files\Java\jdk-17"
        echo 已自动设置 JAVA_HOME: !JAVA_HOME!
    ) else if exist "C:\Program Files\Java\jdk-11" (
        set "JAVA_HOME=C:\Program Files\Java\jdk-11"
        echo 已自动设置 JAVA_HOME: !JAVA_HOME!
    ) else (
        echo 错误: 未找到 Java 安装
        echo 请安装 JDK 17 或设置 JAVA_HOME 环境变量
        pause
        exit /b 1
    )
    echo.
)

:: 检查 ANDROID_HOME 或 ANDROID_SDK_ROOT
if "%ANDROID_HOME%"=="" (
    if "%ANDROID_SDK_ROOT%"=="" (
        :: 尝试自动设置常见路径
        if exist "%LOCALAPPDATA%\Android\Sdk" (
            set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
            echo 已自动设置 ANDROID_HOME: !ANDROID_HOME!
        ) else (
            echo 警告: ANDROID_HOME 或 ANDROID_SDK_ROOT 未设置
            echo 请确保已安装 Android SDK
        )
        echo.
    )
)

:: 进入 android 目录并执行 gradlew
pushd android

:: 检查 gradlew.bat 是否存在
if not exist "gradlew.bat" (
    echo 错误: gradlew.bat 不存在！
    echo 正在尝试重新生成 gradle wrapper...
    
    :: 尝试使用系统 gradle 生成 wrapper
    where gradle >nul 2>&1
    if errorlevel 1 (
        echo 系统未安装 gradle，无法生成 wrapper
        echo 请手动安装 gradle 或从其他项目复制 gradle wrapper 文件
        popd
        pause
        exit /b 1
    )
    
    call gradle wrapper
    if errorlevel 1 (
        echo gradle wrapper 生成失败
        popd
        pause
        exit /b 1
    )
)

echo 正在编译 Debug APK...
echo 这可能需要几分钟，请耐心等待...
echo.

call gradlew.bat assembleDebug
if errorlevel 1 (
    echo.
    echo APK 编译失败！
    echo.
    echo 可能的原因：
    echo   1. JAVA_HOME 未正确设置
    echo   2. Android SDK 未安装或路径未配置
    echo   3. 缺少必要的 SDK 组件
    echo.
    echo 请检查以上配置后重试
    popd
    pause
    exit /b 1
)

popd

echo.
echo ========================================
echo           编译完成！
echo ========================================
echo.
echo APK 文件位置：
echo   android\app\build\outputs\apk\debug\app-debug.apk
echo.

:: 检查 APK 是否生成成功
if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
    echo APK 已成功生成！
    echo.
    set /p openchoice=是否打开 APK 所在文件夹？(Y/N): 
    if /i "!openchoice!"=="Y" (
        explorer "android\app\build\outputs\apk\debug"
    )
) else (
    echo 警告: 未找到生成的 APK 文件
)

echo.
set /p choice=是否打开 Android Studio？(Y/N): 
if /i "%choice%"=="Y" (
    echo 正在打开 Android Studio...
    call npx cap open android
)

pause
