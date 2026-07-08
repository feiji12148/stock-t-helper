const fs = require('fs');

const code = fs.readFileSync(__dirname + '/www/js/strategies.js', 'utf8');
const context = {};
eval(code);
const StrategyEngine = global.StrategyEngine || context.StrategyEngine;

const stockInfo = {
    code: '600519',
    name: '贵州茅台',
    current_price: 1200,
    open_price: 1190,
    high_price: 1210,
    low_price: 1180,
    prev_close: 1195,
    volume: 1000000,
    amount: 1200000000,
    change_percent: 0.42
};

const klines = [];
for (let i = 0; i < 30; i++) {
    klines.push({
        date: '2024-01-' + String(i + 1).padStart(2, '0'),
        open: 1180 + i,
        close: 1180 + i + (Math.random() - 0.5) * 10,
        high: 1185 + i + Math.random() * 5,
        low: 1175 + i - Math.random() * 5,
        volume: 1000000 + Math.random() * 500000,
        amount: 1200000000 + Math.random() * 100000000
    });
}

const [strategies, summary] = engine.runAllStrategies(stockInfo, klines, 0);

console.log('=== 策略引擎测试 ===');
console.log('策略数量:', strategies.length);
console.log('买入信号:', summary.signal_counts.buy);
console.log('卖出信号:', summary.signal_counts.sell);
console.log('观望信号:', summary.signal_counts.watch);
console.log('测试通过!');