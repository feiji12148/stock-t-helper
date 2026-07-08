const https = require('https');

console.log('测试K线API...');

const url = 'https://push2.eastmoney.com/api/qt/kline/get?secid=1.600519&klt=101&fqt=1&lmt=5';

https.get(url, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log('返回码:', json.rc);
            console.log('K线数据存在:', !!json.data?.kline);
            if (json.data?.kline?.length > 0) {
                console.log('第一条K线:', json.data.kline[0]);
                console.log('字段数:', json.data.kline[0].length);
            }
        } catch (e) {
            console.log('解析失败:', e.message);
            console.log('原始数据:', data.substring(0, 200));
        }
    });
}).on('error', (e) => {
    console.log('请求失败:', e.message);
});
