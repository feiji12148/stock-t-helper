const StrategyEngine = require('./www/js/strategies.js');
const engine = new StrategyEngine();

function generateMockKlimes(days = 120, basePrice = 100, volatility = 0.02) {
    const klines = [];
    let price = basePrice;
    const now = new Date();
    
    for (let i = days; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        
        const change = (Math.random() - 0.48) * volatility * price;
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.5);
        const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.5);
        const volume = Math.floor(Math.random() * 5000000 + 1000000);
        const amount = volume * (high + low) / 2;
        
        klines.push({
            date: date.toISOString().split('T')[0],
            open: Math.round(open * 100) / 100,
            close: Math.round(close * 100) / 100,
            high: Math.round(high * 100) / 100,
            low: Math.round(low * 100) / 100,
            volume,
            amount
        });
        
        price = close;
    }
    
    return klines;
}

function testScenario(name, stockInfo, klines, holdings) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`测试场景: ${name}`);
    console.log(`${'='.repeat(60)}`);
    
    console.log(`\n股票: ${stockInfo.name} (${stockInfo.code})`);
    console.log(`当前价: ¥${stockInfo.current_price}`);
    console.log(`涨跌幅: ${stockInfo.change_percent.toFixed(2)}%`);
    console.log(`振幅: ${((stockInfo.high_price - stockInfo.low_price) / stockInfo.prev_close * 100).toFixed(2)}%`);
    console.log(`持仓: ${holdings}股`);
    
    const [strategies, summary] = engine.runAllStrategies(stockInfo, klines, holdings);
    
    console.log(`\n策略总数: ${strategies.length}`);
    console.log(`买入信号: ${summary.buy_signals}个`);
    console.log(`卖出信号: ${summary.sell_signals}个`);
    console.log(`做T信号: ${summary.t_signals}个`);
    
    if (summary.best_t) {
        console.log(`\n⭐ 最优做T方案:`);
        console.log(`  名称: ${summary.best_t.name}`);
        console.log(`  操作: ${summary.best_t.action}`);
        console.log(`  买入价: ¥${summary.best_t.buy_price}`);
        console.log(`  卖出价: ¥${summary.best_t.sell_price}`);
        console.log(`  差价: ¥${Math.abs(summary.best_t.sell_price - summary.best_t.buy_price).toFixed(2)}`);
        console.log(`  收益率: +${summary.best_t.profit_potential.toFixed(2)}% (扣除手续费后)`);
    } else {
        console.log(`\n⚠️  无做T建议`);
    }
    
    const tStrategies = strategies.filter(s => 
        ['BUY_THEN_SELL', 'SELL_THEN_BUY', 'BOX_TRADING'].includes(s.action)
    );
    
    if (tStrategies.length > 0) {
        console.log(`\n📊 所有做T相关策略:`);
        tStrategies.forEach((s, i) => {
            console.log(`  ${i + 1}. [${s.feasibility}] ${s.name}`);
            console.log(`     ${s.suggestion.substring(0, 60)}...`);
        });
    }
    
    return summary;
}

console.log('🚀 做T策略综合测试\n');

const baseKlines = generateMockKlimes(120, 50, 0.025);
const lastKline = baseKlines[baseKlines.length - 1];

const scenario1 = {
    code: '000001',
    name: '平安银行',
    current_price: lastKline.close * 1.02,
    open_price: lastKline.close * 0.995,
    high_price: lastKline.close * 1.035,
    low_price: lastKline.close * 0.99,
    prev_close: lastKline.close,
    volume: 8000000,
    amount: 400000000,
    change_percent: 2.0,
    turnover: 2.5
};
testScenario('上涨趋势-正T', scenario1, baseKlines.slice(0, -1), 1000);

const scenario2 = {
    code: '600519',
    name: '贵州茅台',
    current_price: lastKline.close * 0.98,
    open_price: lastKline.close * 1.005,
    high_price: lastKline.close * 1.01,
    low_price: lastKline.close * 0.97,
    prev_close: lastKline.close,
    volume: 6000000,
    amount: 300000000,
    change_percent: -2.0,
    turnover: 1.8
};
testScenario('下跌趋势-反T', scenario2, baseKlines.slice(0, -1), 500);

const scenario3 = {
    code: '300750',
    name: '宁德时代',
    current_price: lastKline.close,
    open_price: lastKline.close * 1.002,
    high_price: lastKline.close * 1.025,
    low_price: lastKline.close * 0.975,
    prev_close: lastKline.close,
    volume: 7000000,
    amount: 350000000,
    change_percent: 0.0,
    turnover: 2.0
};
testScenario('横盘震荡-箱体T', scenario3, baseKlines.slice(0, -1), 800);

const scenario4 = {
    code: '002425',
    name: '凯撒文化',
    current_price: lastKline.close * 1.003,
    open_price: lastKline.close * 0.998,
    high_price: lastKline.close * 1.008,
    low_price: lastKline.close * 0.995,
    prev_close: lastKline.close,
    volume: 2000000,
    amount: 100000000,
    change_percent: 0.3,
    turnover: 0.8
};
testScenario('低振幅-不适合做T', scenario4, baseKlines.slice(0, -1), 100);

console.log(`\n${'='.repeat(60)}`);
console.log('✅ 测试完成');
console.log(`${'='.repeat(60)}\n`);
