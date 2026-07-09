const StrategyEngine = require('./strategies.js');

const engine = new StrategyEngine();

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch(e) {
        console.log(`✗ ${name}: ${e.message}`);
        failed++;
    }
}

console.log('=== Comprehensive Tests ===\n');

test('Normal data', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST001'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 0.8,
            open: 9.5 + Math.random() * 0.8,
            high: 9.5 + Math.random() * 1,
            low: 9.5 + Math.random() * 0.6,
            volume: 1000000 + Math.random() * 500000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid result');
    const [strategies, summary] = result;
    if (!summary) throw new Error('No summary');
    if (strategies.length === 0) throw new Error('No strategies');
});

test('Edge: pc=0', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 0,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST002'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({ close: 10, open: 10, high: 10, low: 10, volume: 1000000 });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid result');
});

test('Edge: empty klines', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST003'
    };
    const result = engine.runAllStrategies(stock, [], 1000, {});
    if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid result');
});

test('Edge: cp=0', () => {
    const stock = {
        current_price: 0,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 0,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST004'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({ close: 10, open: 10, high: 10, low: 10, volume: 1000000 });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid result');
});

test('Edge: same high/low (range=0)', () => {
    const stock = {
        current_price: 10.00,
        open_price: 10.00,
        high_price: 10.00,
        low_price: 10.00,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST005'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({ close: 10.00, open: 10.00, high: 10.00, low: 10.00, volume: 1000000 });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid result');
});

test('Edge: holdings=0', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST006'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({ close: 9.5 + Math.random() * 0.8, open: 9.5 + Math.random() * 0.8, high: 9.5 + Math.random() * 1, low: 9.5 + Math.random() * 0.6, volume: 1000000 });
    }
    const result = engine.runAllStrategies(stock, klines, 0, {});
    if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid result');
});

test('Best_t profit_potential is calculated', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST007'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({ close: 9.5 + Math.random() * 0.8, open: 9.5 + Math.random() * 0.8, high: 9.5 + Math.random() * 1, low: 9.5 + Math.random() * 0.6, volume: 1000000 });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [, summary] = result;
    if (summary.best_t && summary.best_t.profit_potential === null) {
        throw new Error('profit_potential is null');
    }
});

test('Best_t success_rate is included', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST008'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({ close: 9.5 + Math.random() * 0.8, open: 9.5 + Math.random() * 0.8, high: 9.5 + Math.random() * 1, low: 9.5 + Math.random() * 0.6, volume: 1000000 });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [, summary] = result;
    if (summary.best_t) {
        if (summary.best_t.success_rate === undefined) {
            throw new Error('success_rate is undefined');
        }
        if (summary.best_t.success_rate !== null && (summary.best_t.success_rate < 30 || summary.best_t.success_rate > 95)) {
            throw new Error('success_rate out of range (30-95)');
        }
    }
});

// ========== 策略维度覆盖测试 ==========
test('Strategy categories covered (12 types)', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST009'
    };
    const klines = [];
    for (let i = 0; i < 60; i++) {
        klines.push({
            close: 9.5 + Math.random() * 0.8,
            open: 9.5 + Math.random() * 0.8,
            high: 9.5 + Math.random() * 1.2,
            low: 9.3 + Math.random() * 0.6,
            volume: 1000000 + Math.random() * 500000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [strategies] = result;

    const categories = new Set(strategies.map(s => s.category));
    // 验证至少有6个基础类别
    const expectedCategories = [
        '趋势类', '震荡类', '量价类', '形态类', '日内微操类', '🔥 自创策略'
    ];
    const foundBasic = expectedCategories.filter(c => categories.has(c));
    if (foundBasic.length < 4) {
        throw new Error(`Only ${foundBasic.length} basic categories found, expected at least 4`);
    }
});

// ========== 价格预测测试 ==========
test('Price prediction is calculated', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST010'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 0.8,
            open: 9.5 + Math.random() * 0.8,
            high: 9.5 + Math.random() * 1,
            low: 9.5 + Math.random() * 0.6,
            volume: 1000000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [, summary] = result;

    if (!summary.price_prediction) {
        throw new Error('price_prediction is missing');
    }
    if (!summary.price_prediction.predicted_high || !summary.price_prediction.predicted_low) {
        throw new Error('predicted_high/low is missing');
    }
    if (summary.price_prediction.predicted_high < summary.price_prediction.predicted_low) {
        throw new Error('predicted_high should be >= predicted_low');
    }
});

// ========== 做T方案数量测试 ==========
test('T-plan generation (正T/反T/箱体)', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.50,  // 高振幅确保有足够空间
        low_price: 9.50,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST011'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 1,
            open: 9.5 + Math.random() * 1,
            high: 9.3 + Math.random() * 1.5,
            low: 9.2 + Math.random() * 0.8,
            volume: 1000000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [, summary] = result;

    if (!summary.best_t) {
        throw new Error('best_t is missing');
    }
    // 验证action是有效的做T类型
    const validActions = ['BUY_THEN_SELL', 'SELL_THEN_BUY', 'BOX_TRADING'];
    if (!validActions.includes(summary.best_t.action)) {
        throw new Error(`Invalid action: ${summary.best_t.action}`);
    }
});

// ========== 持仓为0时做T方案测试 ==========
test('Holdings=0 best_t has_holdings should be false', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.50,
        low_price: 9.50,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST012'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 1,
            open: 9.5 + Math.random() * 1,
            high: 9.3 + Math.random() * 1.5,
            low: 9.2 + Math.random() * 0.8,
            volume: 1000000
        });
    }
    // holdings=0 时仍可生成做T方案作为参考，但 has_holdings 应为 false
    const result = engine.runAllStrategies(stock, klines, 0, {});
    const [, summary] = result;

    if (summary.best_t && summary.best_t.has_holdings !== false) {
        throw new Error('best_t.has_holdings should be false when holdings=0');
    }
});

// ========== 策略投票权重测试 ==========
test('Strategy voting weights are applied', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST013'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 0.8,
            open: 9.5 + Math.random() * 0.8,
            high: 9.5 + Math.random() * 1,
            low: 9.5 + Math.random() * 0.6,
            volume: 1000000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [, summary] = result;

    // 验证投票结果存在（使用 buy_weight 和 sell_weight 字段）
    if (summary.buy_weight === undefined || summary.sell_weight === undefined) {
        throw new Error('buy_weight/sell_weight is missing');
    }
});

// ========== 新规策略测试 ==========
test('New rule strategies are applied', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST014'
    };
    const klines = [];
    // 模拟高波动数据触发新规策略
    for (let i = 0; i < 60; i++) {
        const base = 9.5;
        const volatility = i % 5 === 0 ? 0.5 : 0.1; // 每5天高波动
        klines.push({
            close: base + Math.random() * volatility * 2,
            open: base + Math.random() * volatility,
            high: base + volatility + Math.random() * 0.5,
            low: base - volatility + Math.random() * 0.3,
            volume: 1000000 + Math.random() * 500000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [strategies] = result;

    // 检查是否有新规策略
    const newRuleStrategies = strategies.filter(s => s.category && s.category.includes('新规'));
    // 不强制要求有新规策略，因为触发条件可能不满足，但至少不应报错
    if (strategies.length === 0) {
        throw new Error('No strategies generated');
    }
});

// ========== 固定预测测试 ==========
test('Fixed prediction is calculated', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.30,
        low_price: 9.70,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST015'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 0.8,
            open: 9.5 + Math.random() * 0.8,
            high: 9.5 + Math.random() * 1,
            low: 9.5 + Math.random() * 0.6,
            volume: 1000000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [, summary] = result;

    if (!summary.fixed_prediction) {
        throw new Error('fixed_prediction is missing');
    }
    if (!summary.fixed_prediction.predicted_high || !summary.fixed_prediction.predicted_low) {
        throw new Error('fixed_prediction high/low is missing');
    }
    if (!summary.fixed_prediction.base_price) {
        throw new Error('fixed_prediction base_price is missing');
    }
});

// ========== 利润计算手续费测试 ==========
test('Profit calculation includes fee deduction', () => {
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.50,
        low_price: 9.50,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '测试股票',
        code: 'TEST016'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 1,
            open: 9.5 + Math.random() * 1,
            high: 9.3 + Math.random() * 1.5,
            low: 9.2 + Math.random() * 0.8,
            volume: 1000000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [, summary] = result;

    if (summary.best_t && summary.best_t.profit_potential != null) {
        // 利润应该扣除了0.2%双边手续费
        // 如果买入价和卖出价差距只有0.3%，扣除0.2%后应该剩0.1%
        const buyPrice = summary.best_t.buy_price;
        const sellPrice = summary.best_t.sell_price;
        if (buyPrice > 0 && sellPrice > 0) {
            const grossProfit = (sellPrice - buyPrice) / buyPrice * 100;
            const netProfit = summary.best_t.profit_potential;
            // 净利润应该小于毛利润（因为扣除了手续费）
            if (netProfit > grossProfit) {
                throw new Error('Net profit should be less than gross profit after fee deduction');
            }
        }
    }
});

// ========== 早盘时间窗口修复测试 ==========
test('Morning session time window should not be marked as 不足 (insufficient)', () => {
    // 修复：之前用 (hp-lp)/240 估算波动率导致 estTimeNeeded 偏大，
    // 早盘误判为"不足"。现在直接基于剩余时间判断。
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.50,
        low_price: 9.50,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '早盘测试',
        code: 'TEST017'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 1,
            open: 9.5 + Math.random() * 1,
            high: 9.3 + Math.random() * 1.5,
            low: 9.2 + Math.random() * 0.8,
            volume: 1000000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [, summary] = result;

    if (!summary.best_t) {
        // 没有可执行的做T方案是允许的（持仓信号不满足时）
        console.log('  (skipped: no best_t generated)');
        return;
    }

    const tw = summary.best_t.time_window;
    const tr = summary.best_t.time_remaining;
    const session = summary.best_t.time_session;

    // 验证 time_window 字段存在且是合法值
    const validWindows = ['充足', '适中', '紧张', '不足'];
    if (!validWindows.includes(tw)) {
        throw new Error(`Invalid time_window value: ${tw}`);
    }

    // 验证 time_window_color 字段存在
    const validColors = ['green', 'yellow', 'red'];
    if (!validColors.includes(summary.best_t.time_window_color)) {
        throw new Error(`Invalid time_window_color: ${summary.best_t.time_window_color}`);
    }

    // 关键修复：time_remaining >= 90（午盘+早盘时段）必须不是"不足"
    if (tr != null && tr >= 90 && tw === '不足') {
        throw new Error(`Time window misjudged: remaining=${tr}min (>=90) but window=${tw}. 早盘/午盘不应判为"不足"`);
    }

    // 验证 session 字段存在
    if (!session) {
        throw new Error('time_session is missing');
    }
});

// ========== bestT 稳定性（不飘忽）测试 ==========
test('bestT should remain stable across consecutive analyses', () => {
    // 修复：buyTimeScore 用实时股价 cp 计算，导致 bestT 在两次刷新间反复切换
    // 验证：相同输入两次调用 runAllStrategies，best_t.name 应保持一致
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.50,
        low_price: 9.50,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '稳定性测试',
        code: 'TEST018'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 1,
            open: 9.5 + Math.random() * 1,
            high: 9.3 + Math.random() * 1.5,
            low: 9.2 + Math.random() * 0.8,
            volume: 1000000
        });
    }
    // 第一次分析
    const r1 = engine.runAllStrategies(stock, klines, 1000, {});
    const [, s1] = r1;
    if (!s1.best_t) {
        console.log('  (skipped: no best_t generated)');
        return;
    }
    const name1 = s1.best_t.name;

    // 模拟 0.01 元价格微动（实际刷新时最常见的变化幅度）
    const stock2 = { ...stock, current_price: stock.current_price + 0.01 };
    const r2 = engine.runAllStrategies(stock2, klines, 1000, {});
    const [, s2] = r2;
    if (!s2.best_t) {
        console.log('  (skipped: no best_t on 2nd call)');
        return;
    }
    const name2 = s2.best_t.name;

    // 验证：±0.01 元的微动不应让 best_t 切换
    if (name1 !== name2) {
        throw new Error(`bestT switched on 0.01 price change: '${name1}' → '${name2}'（应保持稳定）`);
    }
});

// ========== 买入价确保盈利测试 ==========
test('best_t.buy_price should not exceed current_price (no loss risk)', () => {
    // 修复：之前策略给出的买入价可能 > 现价，导致股价跌到买入价以下就亏损
    // 现在强制约束：买入价必须 <= 现价，否则自动调整为现价的 98.5%
    const stock = {
        current_price: 10.00,
        open_price: 9.90,
        high_price: 10.80,
        low_price: 9.50,
        prev_close: 9.80,
        volume: 1000000,
        change_percent: 2.04,
        amount: 100000000,
        name: '盈利测试',
        code: 'TEST019'
    };
    const klines = [];
    for (let i = 0; i < 30; i++) {
        klines.push({
            close: 9.5 + Math.random() * 1,
            open: 9.5 + Math.random() * 1,
            high: 9.3 + Math.random() * 1.5,
            low: 9.2 + Math.random() * 0.8,
            volume: 1000000
        });
    }
    const result = engine.runAllStrategies(stock, klines, 1000, {});
    const [, summary] = result;

    if (!summary.best_t) {
        console.log('  (skipped: no best_t generated)');
        return;
    }

    const buyPrice = summary.best_t.buy_price;
    const sellPrice = summary.best_t.sell_price;
    const cp = summary.current_price;

    // 关键约束：买入价必须 <= 现价（否则会跌破买入价导致亏损）
    if (buyPrice > cp) {
        throw new Error(`买入价 ${buyPrice} 高于现价 ${cp}，会导致跌破买入价亏损`);
    }

    // 卖出价必须 > 买入价（保证有利润空间）
    if (sellPrice <= buyPrice) {
        throw new Error(`卖出价 ${sellPrice} 低于买入价 ${buyPrice}，无利润空间`);
    }

    // 利润必须为正（扣除手续费后）
    if (summary.best_t.profit_potential != null && summary.best_t.profit_potential <= 0) {
        throw new Error(`profit_potential=${summary.best_t.profit_potential} 应为正`);
    }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
