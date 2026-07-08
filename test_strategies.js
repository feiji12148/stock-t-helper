const StrategyEngine = require('./www/js/strategies.js');

const engine = new StrategyEngine();

const stockInfo = {
    current_price: 100.5,
    open_price: 99.0,
    high_price: 102.0,
    low_price: 98.5,
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

console.log('=== 策略测试结果 ===');
console.log(`总策略数: ${strategies.length}`);
console.log(`买入信号: ${summary.buy_signals}`);
console.log(`卖出信号: ${summary.sell_signals}`);
console.log(`做T信号: ${summary.t_signals}`);
console.log(`ATR: ${summary.atr}`);
console.log(`ATR%: ${summary.atr_pct}%`);
console.log('');

const categories = {};
for (const s of strategies) {
    const cat = s.category || '未分类';
    if (!categories[cat]) categories[cat] = 0;
    categories[cat]++;
}

console.log('=== 策略分类统计 ===');
for (const [cat, count] of Object.entries(categories)) {
    console.log(`${cat}: ${count}个`);
}
console.log('');

console.log('=== 前10个策略 ===');
for (let i = 0; i < Math.min(10, strategies.length); i++) {
    const s = strategies[i];
    console.log(`${i + 1}. [${s.priority}] ${s.name} - ${s.action} - ${s.category}`);
}
console.log('');

if (summary.best_buy) {
    console.log('=== 最佳买入 ===');
    console.log(`名称: ${summary.best_buy.name}`);
    console.log(`目标价: ${summary.best_buy.target_price}`);
    console.log(`止损价: ${summary.best_buy.stop_loss}`);
    console.log(`获利空间: ${summary.best_buy.profit_potential}%`);
}
console.log('');

if (summary.best_t) {
    console.log('=== 最佳做T ===');
    console.log(`名称: ${summary.best_t.name}`);
    console.log(`操作: ${summary.best_t.action}`);
    console.log(`买价: ${summary.best_t.buy_price}`);
    console.log(`卖价: ${summary.best_t.sell_price}`);
}
