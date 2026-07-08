const https = require('https');
const StrategyEngine = require('./www/js/strategies.js');

function getTencentPrefix(code) {
    if (code.startsWith('688') || code.startsWith('689')) return 'sh';
    if (code.startsWith('6') || code.startsWith('9')) return 'sh';
    if (code.startsWith('0') || code.startsWith('3') || code.startsWith('2')) return 'sz';
    if (code.startsWith('8') || code.startsWith('4')) return 'bj';
    return 'sh';
}

function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        }).on('error', reject);
    });
}

function parseTencentQtData(qt) {
    if (!qt || !Array.isArray(qt) || qt.length < 38) {
        return null;
    }
    return {
        code: qt[2] || '',
        name: qt[1] || '',
        current_price: parseFloat(qt[3]) || 0,
        prev_close: parseFloat(qt[4]) || 0,
        open_price: parseFloat(qt[5]) || 0,
        volume: (parseFloat(qt[36]) || 0) * 100,
        amount: (parseFloat(qt[37]) || 0) * 10000,
        change_amount: parseFloat(qt[31]) || 0,
        change_percent: parseFloat(qt[32]) || 0,
        high_price: parseFloat(qt[33]) || 0,
        low_price: parseFloat(qt[34]) || 0,
        turnover: parseFloat(qt[38]) || 0
    };
}

async function loadStockInfo(code) {
    const prefix = getTencentPrefix(code);
    const fullCode = `${prefix}${code}`;
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,1,qfq`;
    const data = await httpGet(url);
    
    if (data.code !== 0 || !data.data || !data.data[fullCode]) {
        throw new Error('行情数据接口返回错误');
    }
    
    const stockData = data.data[fullCode];
    const qt = stockData.qt?.[fullCode];
    const parsedStock = parseTencentQtData(qt);
    if (!parsedStock) {
        throw new Error('行情数据格式错误');
    }
    
    return parsedStock;
}

async function loadKlineData(code) {
    const prefix = getTencentPrefix(code);
    const fullCode = `${prefix}${code}`;
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,250,qfq`;
    const data = await httpGet(url);
    
    if (data.code !== 0 || !data.data || !data.data[fullCode]) {
        throw new Error('K线数据接口返回错误');
    }
    
    const klineArray = data.data[fullCode].qfqday || data.data[fullCode].day || [];
    if (klineArray.length === 0) {
        throw new Error('K线数据为空');
    }
    
    const klines = klineArray.map(k => ({
        date: k[0],
        open: parseFloat(k[1]) || 0,
        close: parseFloat(k[2]) || 0,
        high: parseFloat(k[3]) || 0,
        low: parseFloat(k[4]) || 0,
        volume: k[5] ? (parseFloat(k[5]) || 0) * 100 : 0,
        amount: k[6] ? (parseFloat(k[6]) || 0) * 10000 : 0
    }));
    
    return klines;
}

async function main() {
    const stockCode = '002425';
    const engine = new StrategyEngine();
    
    console.log('正在获取股票行情数据...');
    const stockInfo = await loadStockInfo(stockCode);
    console.log('股票名称:', stockInfo.name);
    console.log('当前价:', stockInfo.current_price);
    
    console.log('正在获取K线数据...');
    const klines = await loadKlineData(stockCode);
    console.log('K线数量:', klines.length);
    
    console.log('正在运行策略分析...');
    const [strategies, summary] = engine.runAllStrategies(stockInfo, klines, 0);
    
    const _currentStock = stockInfo;
    const _lastSummary = summary;
    const _lastStrategies = strategies;
    
    await new Promise(r => setTimeout(r, 3000));
    console.log('当前价:', _currentStock.current_price);
    console.log('最高价:', _currentStock.high_price);
    console.log('最低价:', _currentStock.low_price);
    console.log('best_t:', _lastSummary.best_t);
    const tSignals = _lastStrategies.filter(s => ['BUY_THEN_SELL','SELL_THEN_BUY','BOX_TRADING','TRADING_OPPORTUNITY'].includes(s.action));
    console.log('做T策略数量:', tSignals.length);
    tSignals.forEach((s, i) => {
        console.log(`T[${i}]: ${s.name}, buy=${s.buy_price}, sell=${s.sell_price}, action=${s.action}`);
    });
}

main().catch(console.error);
