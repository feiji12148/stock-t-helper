@echo off
chcp 65001 >nul
echo ==============================================
echo   股票做T助手 - 签名APK打包脚本
echo ==============================================
echo.

set "PROJECT_DIR=%~dp0.."
cd /d "%PROJECT_DIR%"

echo 当前目录: %cd%
echo.

:: 检查签名密钥库是否存在
set "KEYSTORE=android\app\release.keystore"
if not exist "%KEYSTORE%" (
    echo [!] 签名密钥库不存在，正在生成...
    echo.
    
    :: 查找JDK路径
    set "JAVA_HOME="
    
    :: 尝试常见路径
    if exist "C:\Program Files\Java\jdk*" (
        for /d %%i in ("C:\Program Files\Java\jdk*") do set "JAVA_HOME=%%i"
    )
    if exist "C:\Program Files\Eclipse Adoptium\jdk*" (
        for /d %%i in ("C:\Program Files\Eclipse Adoptium\jdk*") do set "JAVA_HOME=%%i"
    )
    if exist "C:\Program Files\Microsoft\jdk*" (
        for /d %%i in ("C:\Program Files\Microsoft\jdk*") do set "JAVA_HOME=%%i"
    )
    if exist "%USERPROFILE%\.jdks\*" (
        for /d %%i in ("%USERPROFILE%\.jdks\*") do set "JAVA_HOME=%%i"
    )
    
    if "%JAVA_HOME%"=="" (
        echo [!] 未找到JDK，无法生成签名密钥库
        echo.
        echo 解决方案:
        echo 1. 安装 JDK 17 或更高版本
        echo    下载地址: https://adoptium.net/
        echo.
        echo 2. 或使用 Android Studio 打开 android 目录
        echo    Build ^> Generate Signed Bundle/APK ^> APK
        echo    创建新密钥库，密码设为: stockthelper2024
        echo    别名设为: stockthelper
        echo.
        echo 3. 或手动执行 (安装JDK后):
        echo    cd android\app
        echo    keytool -genkey -v -keystore release.keystore -alias stockthelper -keyalg RSA -keysize 2048 -validity 10000 -storepass stockthelper2024 -keypass stockthelper2024 -dname "CN=StockTHelper, OU=App, O=Personal, L=Beijing, ST=Beijing, C=CN"
        echo.
        pause
        exit /b 1
    )
    
    echo 找到JDK: %JAVA_HOME%
    echo.
    
    cd android\app
    "%JAVA_HOME%\bin\keytool" -genkey -v -keystore release.keystore -alias stockthelper -keyalg RSA -keysize 2048 -validity 10000 -storepass stockthelper2024 -keypass stockthelper2024 -dname "CN=StockTHelper, OU=App, O=Personal, L=Beijing, ST=Beijing, C=CN"
    
    if exist release.keystore (
        echo [√] 签名密钥库生成成功！
    ) else (
        echo [!] 签名密钥库生成失败
        pause
        exit /b 1
    )
    cd ..\..
)

echo [√] 签名密钥库已存在
echo.

:: 检查Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [!] 未找到 Node.js，请先安装
    pause
    exit /b 1
)
echo [√] Node.js 已安装

:: 同步项目
echo.
echo [1/3] 同步项目...
call npx cap sync android
if errorlevel 1 (
    echo [!] 同步失败
    pause
    exit /b 1
)

:: 构建APK
echo.
echo [2/3] 构建签名APK...
cd android
call gradlew assembleRelease --warning-mode=all
if errorlevel 1 (
    echo [!] 构建失败，尝试使用 assembleDebug...
    call gradlew assembleDebug
    if errorlevel 1 (
        echo [!] 构建失败
        cd ..
        pause
        exit /b 1
    )
    set "APK_TYPE=debug"
) else (
    set "APK_TYPE=release"
)
cd ..

:: 查找APK
echo.
echo [3/3] 查找APK文件...
set "APK_PATH="
for /r "android\app\build\outputs\apk\%APK_TYPE%" %%f in (*.apk) do (
    set "APK_PATH=%%f"
)

if "%APK_PATH%"=="" (
    echo [!] 未找到APK文件
    pause
    exit /b 1
)

echo.
echo ==============================================
echo   APK构建成功！
echo ==============================================
echo.
echo 文件位置: %APK_PATH%
echo.
echo 签名信息:
echo   密钥库: release.keystore
echo   密码: stockthelper2024
echo   别名: stockthelper
echo.
echo 重要提示:
echo   1. 首次安装新签名版本需卸载旧版
echo   2. 后续更新可直接覆盖安装
echo   3. 请备份 release.keystore 文件！
echo.
pause