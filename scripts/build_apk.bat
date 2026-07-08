@echo off
chcp 65001 >nul
echo ==============================================
echo   股票做T助手 - 一键打包 APK
echo ==============================================
echo.

set "BASE_DIR=D:\stock-app"
set "NODE_DIR=%BASE_DIR%\nodejs"
set "JDK_DIR=%BASE_DIR%\jdk"
set "SDK_DIR=%BASE_DIR%\android-sdk"
set "PROJECT_DIR=%BASE_DIR%\project"

set "PATH=%NODE_DIR%\bin;%PATH%"
set "JAVA_HOME=%JDK_DIR%"
set "ANDROID_HOME=%SDK_DIR%"

cd "%PROJECT_DIR%"

echo [1/5] 初始化 Capacitor 项目...
if not exist "capacitor.config.json" (
    npx cap init StockTHelper com.example.stockthelper --web-dir=www
    echo Capacitor 项目已初始化
) else (
    echo Capacitor 项目已存在
)

echo.
echo [2/5] 添加 Android 平台...
if not exist "android" (
    npx cap add android
    echo Android 平台已添加
) else (
    echo Android 平台已存在
)

echo.
echo [3/5] 同步项目...
npx cap sync android
echo 项目同步完成

echo.
echo [4/5] 构建 APK...
cd android
call gradlew assembleDebug

echo.
echo [5/5] 查找 APK 文件...
for /r "%PROJECT_DIR%\android\app\build\outputs\apk\debug" %%f in (*.apk) do (
    echo.
    echo ==============================================
    echo   APK 构建成功！
    echo ==============================================
    echo.
    echo 文件位置：%%f
    echo.
    echo 将此文件复制到手机安装即可使用！
    echo.
    pause
    exit /b 0
)

echo.
echo ==============================================
echo   APK 构建失败，请检查错误信息
echo ==============================================
echo.
pause
