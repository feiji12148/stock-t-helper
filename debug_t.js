const StrategyEngine = require('./www/js/strategies.js');

const engine = new StrategyEngine();

const stockInfo = {
    current_price: 100.5,
    open_price: 96.0,
    high_price: 103.0,
    low_price: 95.0,
    prev_close: 98.0,
    volume: 5000000,
    change_percent: 2.55,
    amount: 500000000,
    name: '测试股票',
    code: '000001'
};

const klines = [];
for (let i = 120; i >= 0; i--) {
    const base = 90 + Math.sin(i * 0.1) * 10 + i * 0.05;
    klines.push({
        date: `2024-01-${String(120 - i).padStart(2, '0')}`,
        open: base - 0.5 + Math.random() * 1,
        high: base + 1.5 + Math.random() * 1,
        low: base - 1.5 + Math.random() * 1,
        close: base + Math.random() * 1 - 0.5,
        volume: 3000000 + Math.random() * 2000000
    });
}

const [strategies, summary] = engine.runAllStrategies(stockInfo, klines, 1000);

console.log('=== 做T策略列表 ===');
const tSignals = strategies.filter(s => ['BUY_THEN_SELL', 'SELL_THEN_BUY', 'BOX_TRADING'].includes(s.action));
tSignals.forEach((s, i) => {
    console.log(`${i + 1}. [priority=${s.priority}] ${s.name}`);
    console.log(`   action: ${s.action}, buy_price: ${s.buy_price}, sell_price: ${s.sell_price}`);
});
