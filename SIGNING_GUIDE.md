# Android签名配置与数据迁移指南

## 问题说明

错误码 `-7` (INSTALL_FAILED_UPDATE_INCOMPATIBLE) 表示新旧APK签名不一致，无法直接覆盖安装。

## GitHub Actions 签名配置

### 方案A：自动生成固定签名（简单）

GitHub Actions 现已配置为每次使用相同参数生成密钥库：

```yaml
keytool -genkey -v \
  -keystore release.keystore \
  -alias stockthelper \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "stockthelper2024" \
  -keypass "stockthelper2024" \
  -dname "CN=StockTHelper, OU=App, O=Personal, L=Beijing, ST=Beijing, C=CN"
```

**注意**：由于 keytool 生成密钥时可能包含时间戳，建议使用方案B确保签名完全一致。

### 方案B：使用 GitHub Secrets 存储 Base64 密钥库（推荐）

1. **本地生成密钥库**
   ```bash
   cd android/app
   keytool -genkey -v -keystore release.keystore -alias stockthelper -keyalg RSA -keysize 2048 -validity 10000 -storepass stockthelper2024 -keypass stockthelper2024 -dname "CN=StockTHelper, OU=App, O=Personal, L=Beijing, ST=Beijing, C=CN"
   ```

2. **转换为 Base64**
   ```bash
   base64 -w 0 release.keystore > keystore_base64.txt
   # Windows PowerShell:
   # [Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) | Out-File keystore_base64.txt
   ```

3. **添加到 GitHub Secrets**
   - 进入 GitHub 仓库 → Settings → Secrets and variables → Actions
   - 点击 "New repository secret"
   - Name: `KEYSTORE_BASE64`
   - Value: 复制 `keystore_base64.txt` 的内容

4. **CI 自动使用**
   - GitHub Actions 会检测到 `KEYSTORE_BASE64` secret
   - 解码并使用同一个密钥库
   - 所有版本签名完全一致，可直接覆盖安装

## 本地打包签名配置

### 方案一：生成固定签名密钥（推荐）

使用固定签名后，所有版本使用相同密钥，可直接覆盖安装。

#### 步骤：

1. **安装JDK**（如已安装Android Studio可跳过）
   - 下载地址：https://adoptium.net/

2. **生成签名密钥库**
   
   打开命令行，进入 `android/app/` 目录，执行：
   
   ```bash
   keytool -genkey -v -keystore release.keystore -alias stockthelper -keyalg RSA -keysize 2048 -validity 10000 -storepass stockthelper2024 -keypass stockthelper2024 -dname "CN=StockTHelper, OU=App, O=Personal, L=Beijing, ST=Beijing, C=CN"
   ```

3. **验证密钥库文件**
   
   确认 `android/app/release.keystore` 文件存在

4. **运行签名打包脚本**
   
   ```
   scripts\build_signed_apk.bat
   ```

5. **首次安装需卸载旧版**
   
   - 旧版签名与新版不同 → 必须先卸载旧版再安装新版
   - 后续版本升级 → 可直接覆盖安装

### 方案二：数据导出/导入迁移（无需卸载丢失数据）

如果不想卸载旧版丢失数据，使用数据导出/导入功能：

#### 迁移步骤：

1. **旧版APP导出数据**
   - 打开旧版APP → 设置 → 导出数据
   - 保存导出的JSON备份文件

2. **卸载旧版，安装新版**
   - 卸载旧版（签名不同必须卸载）
   - 安装新版APK

3. **新版APP导入数据**
   - 打开新版APP → 设置 → 导入数据
   - 选择之前导出的JSON备份文件
   - 确认导入，所有数据将恢复

#### 导出数据包含：
- ✅ 监控列表
- ✅ 交易记录（含做T配对）
- ✅ 搜索历史
- ✅ 应用设置
- ✅ 全景分析历史
- ✅ 长期预测历史
- ✅ 价格预测记录（按月分块）
- ✅ 股票名称缓存
- ✅ 最后查看的股票

### 方案三：使用Android Studio生成签名APK

1. 用Android Studio打开 `android/` 目录
2. 菜单：Build → Generate Signed Bundle / APK
3. 选择APK → Next
4. 创建或选择密钥库
5. 选择release构建类型 → Finish

## 重要提醒

⚠️ **请妥善保管签名密钥库文件**
- `release.keystore` 文件丢失 → 无法更新应用（用户必须卸载重装）
- 建议备份到安全位置
- 不要将密钥库文件提交到代码仓库（已配置 gitignore）

## 签名配置信息

```
密钥库文件: release.keystore
密钥库密码: stockthelper2024
密钥别名: stockthelper
密钥密码: stockthelper2024
```

## 验证签名

查看APK签名信息：
```bash
keytool -printcert -jarfile app-release.apk
```
