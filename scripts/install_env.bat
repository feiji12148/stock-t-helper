@echo off
chcp 65001 >nul
echo ==============================================
echo   股票做T助手 - 一键安装环境
echo ==============================================
echo.
echo 本脚本将自动安装：
echo   1. Node.js (便携版)
echo   2. JDK 17 (便携版)
echo   3. Android SDK
echo   4. Capacitor 依赖
echo.
echo 安装目录：D:\stock-app\
echo.
pause

set "BASE_DIR=D:\stock-app"
set "NODE_DIR=%BASE_DIR%\nodejs"
set "JDK_DIR=%BASE_DIR%\jdk"
set "SDK_DIR=%BASE_DIR%\android-sdk"
set "PROJECT_DIR=%BASE_DIR%\project"

echo [1/4] 安装 Node.js...
if not exist "%NODE_DIR%" (
    echo 正在下载 Node.js 18.x...
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.19.0/node-v18.19.0-win-x64.zip' -OutFile '%BASE_DIR%\node.zip'"
    powershell -Command "Expand-Archive -Path '%BASE_DIR%\node.zip' -DestinationPath '%BASE_DIR%'"
    ren "%BASE_DIR%\node-v18.19.0-win-x64" nodejs
    del "%BASE_DIR%\node.zip"
    echo Node.js 安装完成！
) else (
    echo Node.js 已安装
)

echo.
echo [2/4] 安装 JDK 17...
if not exist "%JDK_DIR%" (
    echo 正在下载 JDK 17...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.11%2B9/OpenJDK17U-jdk_x64_windows_hotspot_17.0.11_9.zip' -OutFile '%BASE_DIR%\jdk.zip'"
    powershell -Command "Expand-Archive -Path '%BASE_DIR%\jdk.zip' -DestinationPath '%BASE_DIR%'"
    ren "%BASE_DIR%\jdk-17.0.11+9" jdk
    del "%BASE_DIR%\jdk.zip"
    echo JDK 17 安装完成！
) else (
    echo JDK 17 已安装
)

echo.
echo [3/4] 安装 Android SDK...
if not exist "%SDK_DIR%" (
    mkdir "%SDK_DIR%"
    echo 正在下载 Android SDK 命令行工具...
    powershell -Command "Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708.zip' -OutFile '%BASE_DIR%\sdk.zip'"
    powershell -Command "Expand-Archive -Path '%BASE_DIR%\sdk.zip' -DestinationPath '%SDK_DIR%'"
    del "%BASE_DIR%\sdk.zip"
    
    echo 正在安装 Android SDK 组件...
    call "%NODE_DIR%\bin\node" -e "console.log('SDK setup...')"
    set "PATH=%NODE_DIR%\bin;%PATH%"
    
    echo 接受 SDK 许可...
    echo y | "%SDK_DIR%\cmdline-tools\bin\sdkmanager.bat" --licenses >nul 2>&1
    
    echo 安装 build-tools 和 platform...
    "%SDK_DIR%\cmdline-tools\bin\sdkmanager.bat" "build-tools;34.0.0" "platforms;android-34" "platform-tools" >nul 2>&1
    echo Android SDK 安装完成！
) else (
    echo Android SDK 已安装
)

echo.
echo [4/4] 安装项目依赖...
cd "%PROJECT_DIR%"
set "PATH=%NODE_DIR%\bin;%PATH%"

if not exist "node_modules" (
    echo 正在安装 Capacitor...
    npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/http
    echo 依赖安装完成！
) else (
    echo 依赖已安装
)

echo.
echo ==============================================
echo   环境安装完成！
echo ==============================================
echo.
echo 接下来运行：build_apk.bat
echo.
pause
