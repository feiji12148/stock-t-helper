console.log('Testing StrategyEngine...');
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/www/js/strategies.js', 'utf8');
console.log('File loaded, length:', code.length);
console.log('First 50 chars:', code.substring(0, 50));

// Add module.exports
const modifiedCode = code + '\nmodule.exports = StrategyEngine;';
eval(modifiedCode);

console.log('StrategyEngine type:', typeof StrategyEngine);

if (typeof StrategyEngine === 'function') {
    const engine = new StrategyEngine();
    console.log('Engine created successfully');
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const sma = engine.sma(closes, 5);
    console.log('SMA(5):', sma);
    console.log('Test PASSED!');
} else {
    console.log('Test FAILED: StrategyEngine is undefined');
}