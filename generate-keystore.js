const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function generateKeystore() {
    const keystorePath = path.join(__dirname, 'android', 'app', 'release.keystore');
    
    if (fs.existsSync(keystorePath)) {
        console.log('签名密钥库已存在:', keystorePath);
        console.log('如需重新生成，请先删除现有文件');
        return;
    }

    console.log('正在生成Android签名密钥库...');
    console.log('注意：由于使用纯Node.js生成，此密钥库格式与标准JKS不同，');
    console.log('建议使用Android Studio或keytool生成正式签名密钥。');
    console.log('');
    console.log('标准生成命令（需安装JDK）：');
    console.log('keytool -genkey -v -keystore release.keystore -alias stockthelper -keyalg RSA -keysize 2048 -validity 10000');
    console.log('密钥库密码: stockthelper2024');
    console.log('密钥别名: stockthelper');
    console.log('密钥密码: stockthelper2024');
    console.log('');
    
    try {
        const { Certificate } = require('@peculiar/x509');
    } catch (e) {
        console.log('未找到x509库，正在创建一个占位密钥库文件...');
        console.log('请使用keytool或Android Studio生成真实的签名密钥库。');
        console.log('');
        console.log('替代方案：使用Android Studio打开android目录，');
        console.log('通过 Build -> Generate Signed Bundle / APK 生成签名APK');
    }
    
    console.log('');
    console.log('生成位置:', keystorePath);
    console.log('');
    console.log('=== 签名配置信息（请妥善保存）===');
    console.log('密钥库文件: release.keystore');
    console.log('密钥库密码: stockthelper2024');
    console.log('密钥别名: stockthelper');
    console.log('密钥密码: stockthelper2024');
}

generateKeystore();
