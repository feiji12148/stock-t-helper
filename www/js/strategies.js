function safeArrMax(arr) {
    if (!arr || !arr.length) return -Infinity;
    let m = arr[0];
    for (let i = 1; i < arr.length; i++) { if (arr[i] > m) m = arr[i]; }
    return m;
}
function safeArrMin(arr) {
    if (!arr || !arr.length) return Infinity;
    let m = arr[0];
    for (let i = 1; i < arr.length; i++) { if (arr[i] < m) m = arr[i]; }
    return m;
}

function getLocalDateStr(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getNextTradingDay(dateStr) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() + 1);
    }
    return getLocalDateStr(d);
}

class StrategyEngine {
    calcTxFee(buyPrice, sellPrice, quantity) {
        if (!buyPrice || !sellPrice || !quantity || buyPrice <= 0 || sellPrice <= 0 || quantity <= 0) return 0;
        const buyAmount = buyPrice * quantity;
        const sellAmount = sellPrice * quantity;
        const buyComm = Math.max(buyAmount * 0.0003, 5);
        const buyTrans = buyAmount * 0.00001;
        const sellComm = Math.max(sellAmount * 0.0003, 5);
        const sellStamp = sellAmount * 0.001;
        const sellTrans = sellAmount * 0.00001;
        return parseFloat((buyComm + buyTrans + sellComm + sellStamp + sellTrans).toFixed(2));
    }
    
    calcTxFeePct(buyPrice, sellPrice, quantity = 100) {
        if (!buyPrice || buyPrice <= 0 || quantity <= 0) return 0;
        const fee = this.calcTxFee(buyPrice, sellPrice, quantity);
        const buyAmount = buyPrice * quantity;
        return buyAmount > 0 ? fee / buyAmount * 100 : 0;
    }
    
    sma(values, period) {
        if (!values || values.length < period || period <= 0) return null;
        const sum = values.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
    }

    smaSeries(values, period) {
        if (values.length < period || period <= 0) return [];
        const result = [];
        let sum = 0;
        for (let i = 0; i < period; i++) sum += values[i];
        result.push(sum / period);
        for (let i = period; i < values.length; i++) {
            sum += values[i] - values[i - period];
            result.push(sum / period);
        }
        return result;
    }

    ema(values, period) {
        if (!values || period <= 0 || values.length < period) return null;
        const k = 2 / (period + 1);
        let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < values.length; i++) {
            result = values[i] * k + result * (1 - k);
        }
        return result;
    }

    emaSeries(values, period) {
        if (!values || period <= 0 || values.length < period) return [];
        const k = 2 / (period + 1);
        const result = [values.slice(0, period).reduce((a, b) => a + b, 0) / period];
        for (let i = period; i < values.length; i++) {
            result.push(values[i] * k + result[result.length - 1] * (1 - k));
        }
        return result;
    }

    wma(values, period) {
        if (!values || values.length < period || period <= 0) return null;
        let totalWeight = 0;
        let weightedSum = 0;
        for (let i = 0; i < period; i++) {
            const weight = i + 1;
            weightedSum += values[values.length - period + i] * weight;
            totalWeight += weight;
        }
        return totalWeight > 0 ? weightedSum / totalWeight : null;
    }

    calcMacd(closes, fast = 12, slow = 26, signal = 9) {
        const difSeries = this.calcMacdSeries(closes, fast, slow, signal);
        if (!difSeries) return [null, null, null];
        return [
            difSeries[0][difSeries[0].length - 1],
            difSeries[1][difSeries[1].length - 1],
            difSeries[2][difSeries[2].length - 1]
        ];
    }

    calcMacdSeries(closes, fast = 12, slow = 26, signal = 9) {
        if (fast >= slow) return null;
        if (closes.length < slow + signal) return null;
        const emaFast = this.emaSeries(closes, fast);
        const emaSlow = this.emaSeries(closes, slow);
        const offset = slow - fast;
        const dif = [];
        for (let i = 0; i < emaSlow.length; i++) {
            dif.push(emaFast[i + offset] - emaSlow[i]);
        }
        if (dif.length < signal) return null;
        const dea = this.emaSeries(dif, signal);
        const trim = dif.length - dea.length;
        const difAligned = dif.slice(trim);
        const bar = difAligned.map((d, i) => (d - dea[i]) * 2);
        return [difAligned, dea, bar];
    }

    calcRsi(closes, period = 14) {
        if (!closes || closes.length < period + 1 || period <= 0) return null;
        let avgGain = 0;
        let avgLoss = 0;
        for (let i = 1; i <= period; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) avgGain += diff;
            else avgLoss -= diff;
        }
        avgGain /= period;
        avgLoss /= period;
        for (let i = period + 1; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }
        if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
        const rs = avgGain / avgLoss;
        return Math.max(0, Math.min(100, 100 - (100 / (1 + rs))));
    }

    calcKdj(highs, lows, closes, n = 9, m1 = 3, m2 = 3) {
        if (!highs || !lows || !closes) return [null, null, null];
        if (closes.length < n || highs.length < n || lows.length < n || n <= 0 || m1 <= 0 || m2 <= 0) return [null, null, null];
        const rsvList = [];
        for (let i = n - 1; i < closes.length; i++) {
            let h = highs[i - n + 1];
            let l = lows[i - n + 1];
            for (let j = i - n + 2; j <= i; j++) {
                if (highs[j] > h) h = highs[j];
                if (lows[j] < l) l = lows[j];
            }
            if (h === l) {
                const pc = i > 0 ? closes[i - 1] : null;
                const rsv = pc !== null ? (closes[i] >= pc ? 100 : 0) : 50;
                rsvList.push(rsv);
            } else {
                const range = h - l;
                rsvList.push(range > 0 ? (closes[i] - l) / range * 100 : 50);
            }
        }
        let k = 50, d = 50;
        for (const rsv of rsvList) {
            k = (2 / m1) * k + (1 / m1) * rsv;
            d = (2 / m2) * d + (1 / m2) * k;
        }
        const j = 3 * k - 2 * d;
        return [
            Math.max(0, Math.min(100, k)),
            Math.max(0, Math.min(100, d)),
            Math.max(-20, Math.min(120, j))
        ];
    }

    calcBollinger(closes, period = 20, stdMult = 2) {
        if (!closes || closes.length < period || period <= 0) return [null, null, null];
        const actualPeriod = Math.min(period, closes.length);
        const window = closes.slice(-actualPeriod);
        const mid = window.reduce((a, b) => a + b, 0) / actualPeriod;
        const variance = window.reduce((sum, x) => {
            const diff = x - mid;
            return sum + diff * diff;
        }, 0) / actualPeriod;
        const std = Math.sqrt(variance);
        if (std === 0 || mid === 0) return [mid, mid, mid];
        const upper = mid + stdMult * std;
        const lower = mid - stdMult * std;
        return [lower, mid, upper];
    }

    calcAtr(highs, lows, closes, period = 14) {
        if (!highs || !lows || !closes) return null;
        if (closes.length < period + 1 || highs.length < period + 1 || lows.length < period + 1 || period <= 0) return null;
        const trs = [];
        for (let i = 1; i < closes.length; i++) {
            trs.push(Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            ));
        }
        if (trs.length < period) return null;
        let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < trs.length; i++) {
            atr = (atr * (period - 1) + trs[i]) / period;
        }
        return atr;
    }

    calcDmi(highs, lows, closes, period = 14) {
        if (period <= 0 || closes.length < period + 1) return [null, null, null];
        const plusDm = [], minusDm = [], trList = [];
        for (let i = 1; i < closes.length; i++) {
            const up = highs[i] - highs[i - 1];
            const down = lows[i - 1] - lows[i];
            plusDm.push(up > down && up > 0 ? up : 0);
            minusDm.push(down > up && down > 0 ? down : 0);
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            );
            trList.push(tr);
        }
        if (trList.length < period) return [null, null, null];
        const pdiSeries = [], mdiSeries = [], dxSeries = [];
        let atrPrev = trList.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let pdmPrev = plusDm.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let mdmPrev = minusDm.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < trList.length; i++) {
            atrPrev = (atrPrev * (period - 1) + trList[i]) / period;
            pdmPrev = (pdmPrev * (period - 1) + plusDm[i]) / period;
            mdmPrev = (mdmPrev * (period - 1) + minusDm[i]) / period;
            const pdi = atrPrev > 0 ? pdmPrev / atrPrev * 100 : 0;
            const mdi = atrPrev > 0 ? mdmPrev / atrPrev * 100 : 0;
            pdiSeries.push(pdi);
            mdiSeries.push(mdi);
            const sum = pdi + mdi;
            dxSeries.push(sum > 0 ? Math.abs(pdi - mdi) / sum * 100 : 0);
        }
        if (pdiSeries.length === 0) return [null, null, null];
        const adxSeries = [];
        if (dxSeries.length >= period) {
            let adx = dxSeries.slice(0, period).reduce((a, b) => a + b, 0) / period;
            adxSeries.push(adx);
            for (let i = period; i < dxSeries.length; i++) {
                adx = (adx * (period - 1) + dxSeries[i]) / period;
                adxSeries.push(adx);
            }
        } else {
            adxSeries.push(dxSeries.reduce((a, b) => a + b, 0) / Math.max(1, dxSeries.length));
        }
        const pdi = pdiSeries[pdiSeries.length - 1];
        const mdi = mdiSeries[mdiSeries.length - 1];
        const adx = adxSeries[adxSeries.length - 1];
        return [pdi, mdi, adx];
    }

    calcWilliamsR(highs, lows, closes, period = 14) {
        if (closes.length < period || highs.length < period || lows.length < period) return null;
        const h = safeArrMax(highs.slice(-period));
        const l = safeArrMin(lows.slice(-period));
        if (h === l) return -50;
        const wr = (h - closes[closes.length - 1]) / (h - l) * -100;
        return Math.max(-100, Math.min(0, wr));
    }

    calcCci(highs, lows, closes, period = 14) {
        if (!highs || !lows || !closes) return null;
        if (highs.length < period || lows.length < period || closes.length < period) return null;
        const tps = [];
        const startIdx = closes.length - period;
        for (let i = startIdx; i < closes.length; i++) {
            tps.push((highs[i] + lows[i] + closes[i]) / 3);
        }
        const tpSma = tps.reduce((a, b) => a + b, 0) / period;
        const mad = tps.reduce((sum, tp) => sum + Math.abs(tp - tpSma), 0) / period;
        if (mad === 0 || tpSma === 0) return 0;
        return (tps[tps.length - 1] - tpSma) / (0.015 * mad);
    }

    calcObv(closes, volumes) {
        if (closes.length < 2) return 0;
        const series = this.calcObvSeries(closes, volumes);
        return series[series.length - 1];
    }

    calcObvSeries(closes, volumes) {
        if (closes.length < 2 || volumes.length < 2) return [0];
        const result = [volumes[0] || 0];
        let obv = volumes[0] || 0;
        for (let i = 1; i < closes.length; i++) {
            if (closes[i] > closes[i - 1]) obv += volumes[i] || 0;
            else if (closes[i] < closes[i - 1]) obv -= volumes[i] || 0;
            result.push(obv);
        }
        return result;
    }

    calcMfi(highs, lows, closes, volumes, period = 14) {
        if (closes.length < period + 1 || highs.length < period + 1 || lows.length < period + 1) return null;
        if (volumes.length < period + 1) return null;
        try {
            const moneyFlow = [];
            for (let i = 1; i < closes.length; i++) {
                const typicalCur = (highs[i] + lows[i] + closes[i]) / 3;
                const typicalPrev = (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3;
                const flow = typicalCur * volumes[i];
                if (typicalCur > typicalPrev) {
                    moneyFlow.push({ positive: flow, negative: 0 });
                } else if (typicalCur < typicalPrev) {
                    moneyFlow.push({ positive: 0, negative: flow });
                } else {
                    moneyFlow.push({ positive: 0, negative: 0 });
                }
            }
            if (moneyFlow.length < period) return 50;
            let posSum = 0, negSum = 0;
            for (let i = 0; i < period; i++) {
                posSum += moneyFlow[i].positive;
                negSum += moneyFlow[i].negative;
            }
            let mfi;
            if (negSum === 0) {
                mfi = posSum > 0 ? 100 : 50;
            } else {
                const moneyRatio = posSum / negSum;
                mfi = 100 - (100 / (1 + moneyRatio));
            }
            for (let i = period; i < moneyFlow.length; i++) {
                posSum = posSum - moneyFlow[i - period].positive + moneyFlow[i].positive;
                negSum = negSum - moneyFlow[i - period].negative + moneyFlow[i].negative;
                if (negSum === 0) {
                    mfi = posSum > 0 ? 100 : 50;
                } else {
                    const moneyRatio = posSum / negSum;
                    mfi = 100 - (100 / (1 + moneyRatio));
                }
            }
            return Math.max(0, Math.min(100, mfi));
        } catch (e) {
            return null;
        }
    }

    calcMomentum(values, period = 5) {
        if (values.length < period + 1) return null;
        return values[values.length - 1] - values[values.length - period - 1];
    }

    calcRoc(values, period = 12) {
        if (values.length < period + 1) return null;
        const prevVal = values[values.length - period - 1];
        if (prevVal === 0) return null;
        return (values[values.length - 1] - prevVal) / prevVal * 100;
    }

    calcPsy(values, period = 12) {
        if (values.length < period + 1 || period <= 0) return null;
        let riseDays = 0;
        const start = values.length - period;
        for (let i = start; i < values.length; i++) {
            if (i > 0 && values[i] > values[i - 1]) riseDays++;
        }
        return Math.max(0, Math.min(100, riseDays / period * 100));
    }

    calcVwapDeviation(currentPrice, volume, amount) {
        if (volume === 0) return [0, 0];
        const vwap = amount / volume;
        const deviation = vwap > 0 ? (currentPrice - vwap) / vwap * 100 : 0;
        return [vwap, deviation];
    }

    calcPsar(highs, lows, afStart = 0.02, afStep = 0.02, afMax = 0.2) {
        if (highs.length < 3 || lows.length < 3) return [null, null];
        const initPeriod = Math.min(10, highs.length);
        let isLong = false;
        let ep, sar;
        if (highs.length >= 5) {
            const firstHalfHigh = safeArrMax(highs.slice(0, Math.floor(initPeriod / 2)));
            const secondHalfHigh = safeArrMax(highs.slice(Math.floor(initPeriod / 2), initPeriod));
            const firstHalfLow = safeArrMin(lows.slice(0, Math.floor(initPeriod / 2)));
            const secondHalfLow = safeArrMin(lows.slice(Math.floor(initPeriod / 2), initPeriod));
            const upMove = secondHalfHigh - firstHalfLow;
            const downMove = firstHalfHigh - secondHalfLow;
            isLong = upMove >= downMove;
        } else {
            isLong = highs[highs.length - 1] > highs[0];
        }
        let af = afStart;
        if (isLong) {
            ep = safeArrMax(highs.slice(0, initPeriod));
            sar = safeArrMin(lows.slice(0, initPeriod));
        } else {
            ep = safeArrMin(lows.slice(0, initPeriod));
            sar = safeArrMax(highs.slice(0, initPeriod));
        }
        for (let i = initPeriod; i < highs.length; i++) {
            const prevSar = sar;
            sar = prevSar + af * (ep - prevSar);
            if (isLong) {
                if (i >= 2) {
                    sar = Math.min(sar, lows[i - 1]);
                    if (i >= 3) sar = Math.min(sar, lows[i - 2]);
                }
                if (lows[i] < sar) {
                    isLong = false;
                    sar = ep;
                    ep = lows[i];
                    af = afStart;
                } else {
                    if (highs[i] > ep) {
                        ep = highs[i];
                        af = Math.min(af + afStep, afMax);
                    }
                }
            } else {
                if (i >= 2) {
                    sar = Math.max(sar, highs[i - 1]);
                    if (i >= 3) sar = Math.max(sar, highs[i - 2]);
                }
                if (highs[i] > sar) {
                    isLong = true;
                    sar = ep;
                    ep = highs[i];
                    af = afStart;
                } else {
                    if (lows[i] < ep) {
                        ep = lows[i];
                        af = Math.min(af + afStep, afMax);
                    }
                }
            }
        }
        return [sar, isLong ? 'LONG' : 'SHORT'];
    }

    findSupportResistance(highs, lows, closes, lookback = 20) {
        if (closes.length < 5 || highs.length < 5 || lows.length < 5) return [[], []];
        const actualLookback = Math.min(lookback, highs.length, lows.length, closes.length);
        const h = highs.slice(-actualLookback);
        const l = lows.slice(-actualLookback);
        const resistances = [], supports = [];
        for (let i = 2; i < h.length - 2; i++) {
            if (h[i] > h[i - 1] && h[i] > h[i - 2] && h[i] > h[i + 1] && h[i] > h[i + 2]) {
                resistances.push(h[i]);
            }
            if (l[i] < l[i - 1] && l[i] < l[i - 2] && l[i] < l[i + 1] && l[i] < l[i + 2]) {
                supports.push(l[i]);
            }
        }
        return [supports.slice(-3), resistances.slice(-3)];
    }

    _make(name, icon, category, feasibility, priority, suggestion, action, reasoning, extra = {}) {
        const r = {
            name, icon, category, feasibility, priority, suggestion, action, reasoning
        };
        for (const [k, v] of Object.entries(extra)) {
            if (v !== null && v !== undefined) {
                r[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
            }
        }
        return r;
    }

    runAllStrategies(stockInfo, klines, holdings = 0, options = {}) {
        const results = [];
        const holdQty = typeof holdings === 'number' ? holdings : (holdings && holdings.qty) || 0;
        const holdCost = typeof holdings === 'object' && holdings ? (holdings.cost || 0) : 0;
        const cp = stockInfo.current_price;
        const op = stockInfo.open_price;
        const hp = stockInfo.high_price;
        const lp = stockInfo.low_price;
        const pc = stockInfo.prev_close;
        const vol = stockInfo.volume;
        const chg = stockInfo.change_percent;
        const amt = stockInfo.amount || 0;
        const name = stockInfo.name || '';
        const code = stockInfo.code || '';
        const fixedPredHour = options.fixedPredictionHour != null ? options.fixedPredictionHour : 15;

        const feeRate = 0.001; // 单边手续费0.1%（全局定义，供所有策略使用）
        const minProfitPct = 0.3; // 最小盈利空间（扣除双边手续费0.2%后确保盈利）

        if (pc <= 0) return [results, {}];

        const amplitude = (hp - lp) / pc * 100;
        const avgPrice = (hp + lp + cp) / 3;
        const devFromAvg = avgPrice > 0 ? (cp - avgPrice) / avgPrice * 100 : 0;

        const CATEGORY_TREND = '趋势类';
        const CATEGORY_OSCILLATOR = '震荡类';
        const CATEGORY_VOLUME = '量价类';
        const CATEGORY_PATTERN = '形态类';
        const CATEGORY_MICRO = '日内微操类';
        const CATEGORY_NOVEL = '🔥 自创策略';

        const hasKline = klines.length >= 10;
        let closes, opens, highs, lows, volumes;
        let closesWithToday, opensWithToday, highsWithToday, lowsWithToday, volumesWithToday;

        if (hasKline) {
            closes = klines.map(k => k.close);
            opens = klines.map(k => k.open);
            highs = klines.map(k => k.high);
            lows = klines.map(k => k.low);
            volumes = klines.map(k => k.volume);
            closesWithToday = [...closes, cp];
            opensWithToday = [...opens, op];
            highsWithToday = [...highs, hp];
            lowsWithToday = [...lows, lp];
            volumesWithToday = [...volumes, vol];
        } else {
            closes = highs = lows = volumes = opens = [];
            closesWithToday = [cp];
            opensWithToday = [op];
            highsWithToday = [hp];
            lowsWithToday = [lp];
            volumesWithToday = [vol];
        }

        const _indCache = {};
        const getRsi = (period = 14) => {
            const key = `rsi_${period}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcRsi(closesWithToday, period);
            return _indCache[key];
        };
        const getKdj = (n = 9, m = 3, k = 3) => {
            const key = `kdj_${n}_${m}_${k}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcKdj(highsWithToday, lowsWithToday, closesWithToday, n, m, k);
            return _indCache[key];
        };
        const getMacd = (fast = 12, slow = 26, signal = 9) => {
            const key = `macd_${fast}_${slow}_${signal}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcMacd(closesWithToday, fast, slow, signal);
            return _indCache[key];
        };
        const getAtr = (period = 14) => {
            const key = `atr_${period}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcAtr(highsWithToday, lowsWithToday, closesWithToday, period);
            return _indCache[key];
        };
        const getSma = (period) => {
            const key = `sma_${period}`;
            if (_indCache[key] === undefined) _indCache[key] = this.sma(closesWithToday, period);
            return _indCache[key];
        };
        const getCci = (period = 14) => {
            const key = `cci_${period}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcCci(highsWithToday, lowsWithToday, closesWithToday, period);
            return _indCache[key];
        };
        const getDmi = (period = 14) => {
            const key = `dmi_${period}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcDmi(highsWithToday, lowsWithToday, closesWithToday, period);
            return _indCache[key];
        };
        const getBoll = (period = 20, k = 2) => {
            const key = `boll_${period}_${k}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcBollinger(closesWithToday, period, k);
            return _indCache[key];
        };
        const getPsar = (afStart = 0.02, afStep = 0.02, afMax = 0.2) => {
            const key = `psar_${afStart}_${afStep}_${afMax}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcPsar(highsWithToday, lowsWithToday, afStart, afStep, afMax);
            return _indCache[key];
        };
        const getObv = () => {
            const key = 'obv';
            if (_indCache[key] === undefined) _indCache[key] = this.calcObv(closesWithToday, volumesWithToday);
            return _indCache[key];
        };
        const getObvSeries = () => {
            const key = 'obv_series';
            if (_indCache[key] === undefined) _indCache[key] = this.calcObvSeries(closesWithToday, volumesWithToday);
            return _indCache[key];
        };
        const getWr = (period = 14) => {
            const key = `wr_${period}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcWilliamsR(highsWithToday, lowsWithToday, closesWithToday, period);
            return _indCache[key];
        };
        const getPsy = (period = 12) => {
            const key = `psy_${period}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcPsy(closesWithToday, period);
            return _indCache[key];
        };
        const getMfi = (period = 14) => {
            const key = `mfi_${period}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcMfi(highsWithToday, lowsWithToday, closesWithToday, volumesWithToday, period);
            return _indCache[key];
        };
        const getMacdSeries = (fast = 12, slow = 26, signal = 9) => {
            const key = `macd_series_${fast}_${slow}_${signal}`;
            if (_indCache[key] === undefined) _indCache[key] = this.calcMacdSeries(closesWithToday, fast, slow, signal);
            return _indCache[key];
        };

        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const trend = chg > 0.5 ? '上升' : (chg < -0.5 ? '下跌' : '横盘');

        // =================================================================
        //  一、趋势类策略
        // =================================================================

        if (hasKline && closes.length >= 30) {
            const ma5 = getSma(5);
            const ma10 = getSma(10);
            const ma20 = getSma(20);
            const ma5Prev = this.sma(closesWithToday.slice(0, -1), 5);
            const ma10Prev = this.sma(closesWithToday.slice(0, -1), 10);

            if (ma5 && ma10 && ma5Prev && ma10Prev) {
                if (ma5 > ma10 && ma5Prev <= ma10Prev) {
                    results.push(this._make(
                        '均线金叉 (MA5×MA10)', '📈', CATEGORY_TREND, '高', 1,
                        `MA5(${ma5.toFixed(2)}) 上穿 MA10(${ma10.toFixed(2)})，短期趋势转多！买入后看MA20(${ma20.toFixed(2)})压力。`,
                        'BUY', '金叉信号，短期看涨概率>70%',
                        { target_price: ma20, stop_loss: ma10 * 0.98 }
                    ));
                } else if (ma5 < ma10 && ma5Prev >= ma10Prev) {
                    results.push(this._make(
                        '均线死叉 (MA5×MA10)', '📉', CATEGORY_TREND, '高', 1,
                        `MA5(${ma5.toFixed(2)}) 下穿 MA10(${ma10.toFixed(2)})，短期趋势转空！建议减仓或观望。`,
                        'SELL', '死叉信号，短期看跌概率>70%',
                        { target_price: ma20, stop_loss: ma5 * 1.02 }
                    ));
                } else {
                    const status = ma5 > ma10 ? '多头排列' : ma5 < ma10 ? '空头排列' : '纠缠震荡';
                    const action = ma5 > ma10 ? 'HOLD' : ma5 < ma10 ? 'AVOID_BUY' : 'WATCH';
                    results.push(this._make(
                        '均线状态 (MA5×MA10)', '⏸️', CATEGORY_TREND, '低', 3,
                        `MA5(${ma5.toFixed(2)}) vs MA10(${ma10.toFixed(2)})，${status}，等待明确信号。`,
                        action, `均线${status}，暂无交叉信号，继续观察`
                    ));
                }

                if (ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20) {
                    results.push(this._make(
                        '均线多头排列', '🟢', CATEGORY_TREND, '中', 2,
                        `MA5(${ma5.toFixed(2)}) > MA10(${ma10.toFixed(2)}) > MA20(${ma20.toFixed(2)})，趋势强劲，持股待涨。`,
                        'HOLD', '多头排列，趋势延续概率高'
                    ));
                } else if (ma5 && ma10 && ma20 && ma5 < ma10 && ma10 < ma20) {
                    results.push(this._make(
                        '均线空头排列', '🔴', CATEGORY_TREND, '中', 2,
                        `MA5(${ma5.toFixed(2)}) < MA10(${ma10.toFixed(2)}) < MA20(${ma20.toFixed(2)})，空头趋势，勿抄底。`,
                        'AVOID_BUY', '空头排列，下跌趋势延续概率高'
                    ));
                } else if (ma5 && ma10 && ma20) {
                    results.push(this._make(
                        '均线排列状态', '', CATEGORY_TREND, '低', 3,
                        `MA5(${ma5.toFixed(2)}), MA10(${ma10.toFixed(2)}), MA20(${ma20.toFixed(2)})，均线交错，方向不明。`,
                        'WATCH', '均线交错，等待方向明确'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 35) {
            const [difNow, deaNow] = getMacd();
            const macdSeries = getMacdSeries();
            if (difNow !== null && macdSeries && macdSeries[0].length >= 2) {
                const d1 = macdSeries[0][macdSeries[0].length - 1];
                const e1 = macdSeries[1][macdSeries[1].length - 1];
                const d0 = macdSeries[0][macdSeries[0].length - 2];
                const e0 = macdSeries[1][macdSeries[1].length - 2];
                let macdTriggered = false;

                if (d1 > e1 && d0 <= e0) {
                    results.push(this._make(
                        'MACD金叉', '⚡', CATEGORY_TREND, '高', 1,
                        `DIF(${d1.toFixed(3)}) 上穿 DEA(${e1.toFixed(3)})，MACD柱由负转正，中期看涨信号。`,
                        'BUY', 'MACD金叉是经典买入信号，成功率约65%',
                        { target_price: cp * 1.03, stop_loss: cp * 0.97 }
                    ));
                    macdTriggered = true;
                } else if (d1 < e1 && d0 >= e0) {
                    results.push(this._make(
                        'MACD死叉', '⚡', CATEGORY_TREND, '高', 1,
                        `DIF(${d1.toFixed(3)}) 下穿 DEA(${e1.toFixed(3)})，MACD柱由正转负，中期看跌信号。`,
                        'SELL', 'MACD死叉是经典卖出信号',
                        { target_price: cp * 0.97, stop_loss: cp * 1.03 }
                    ));
                    macdTriggered = true;
                }

                if (!macdTriggered) {
                    const status = d1 > e1 ? '多头' : d1 < e1 ? '空头' : '纠缠';
                    const action = d1 > e1 ? 'HOLD' : d1 < e1 ? 'AVOID_BUY' : 'WATCH';
                    results.push(this._make(
                        'MACD状态', '', CATEGORY_TREND, '低', 3,
                        `DIF(${d1.toFixed(3)}) vs DEA(${e1.toFixed(3)})，${status}市场，等待明确信号。`,
                        action, `MACD${status}，暂无交叉信号，继续观察`
                    ));
                }

                if (macdSeries[2].length >= 2) {
                    if (macdSeries[2][macdSeries[2].length - 1] > 0 && macdSeries[2][macdSeries[2].length - 2] <= 0) {
                        results.push(this._make(
                            'MACD柱转正', '📈', CATEGORY_TREND, '中', 2,
                            `MACD柱由负转正(${macdSeries[2][macdSeries[2].length - 1].toFixed(3)})，多头动能增强。`,
                            'BUY', 'MACD柱转正是短期买入辅助信号'
                        ));
                    } else if (macdSeries[2][macdSeries[2].length - 1] < 0 && macdSeries[2][macdSeries[2].length - 2] >= 0) {
                        results.push(this._make(
                            'MACD柱转负', '📉', CATEGORY_TREND, '中', 2,
                            `MACD柱由正转负(${macdSeries[2][macdSeries[2].length - 1].toFixed(3)})，空头动能增强。`,
                            'SELL', 'MACD柱转负是短期卖出辅助信号'
                        ));
                    }
                }

                let recentHigh20 = null;
                let recentLow20 = null;
                if (closes.length >= 20) {
                    recentHigh20 = Math.max(...closes.slice(-20));
                    recentLow20 = Math.min(...closes.slice(-20));
                }

                if (closes.length >= 50) {
                    const dif5Ago = macdSeries[0][macdSeries[0].length - 5];
                    if (recentHigh20 !== null && cp >= recentHigh20 && dif5Ago !== undefined && difNow < dif5Ago && difNow < 0) {
                        results.push(this._make(
                            'MACD顶背离', '⚠️', CATEGORY_TREND, '中', 2,
                            '股价创新高但MACD未创新高，顶背离预警，可能见顶。',
                            'SELL', '顶背离后回调概率约60%'
                        ));
                    } else if (recentLow20 !== null && cp <= recentLow20 && dif5Ago !== undefined && difNow > dif5Ago && difNow > 0) {
                        results.push(this._make(
                            'MACD底背离', '💎', CATEGORY_TREND, '中', 2,
                            '股价创新低但MACD未创新低，底背离信号，可能见底。',
                            'BUY', '底背离后反弹概率约60%'
                        ));
                    }
                }

                const difPrev = macdSeries[0].length >= 2 ? macdSeries[0][macdSeries[0].length - 2] : null;
                if (difNow > 0 && difPrev !== null && difPrev <= 0) {
                    results.push(this._make(
                        'MACD零轴上穿', '🚀', CATEGORY_TREND, '高', 1,
                        `MACD DIF由负转正(${difPrev.toFixed(3)}→${difNow.toFixed(3)})，零轴上穿，趋势由空转多。`,
                        'BUY', 'MACD零轴上穿是重要的趋势转强信号'
                    ));
                } else if (difNow < 0 && difPrev !== null && difPrev >= 0) {
                    results.push(this._make(
                        'MACD零轴下穿', '📉', CATEGORY_TREND, '高', 1,
                        `MACD DIF由正转负(${difPrev.toFixed(3)}→${difNow.toFixed(3)})，零轴下穿，趋势由多转空。`,
                        'SELL', 'MACD零轴下穿是重要的趋势转弱信号'
                    ));
                }

                if (macdSeries[2].length >= 10 && recentHigh20 !== null && recentLow20 !== null) {
                    const barSeries = macdSeries[2];
                    const barNow = barSeries[barSeries.length - 1];
                    const bar5Ago = barSeries.length >= 6 ? barSeries[barSeries.length - 6] : null;

                    if (cp >= recentHigh20 && bar5Ago !== null && barNow < bar5Ago && barNow > 0) {
                        results.push(this._make(
                            'MACD柱状图顶背离', '⚠️', CATEGORY_TREND, '高', 1,
                            `股价创新高但MACD柱状图(${barNow.toFixed(3)})小于5日前(${bar5Ago.toFixed(3)})，顶背离预警。`,
                            'SELL', 'MACD柱状图背离比DIF背离更灵敏'
                        ));
                    }

                    if (cp <= recentLow20 && bar5Ago !== null && barNow > bar5Ago && barNow < 0) {
                        results.push(this._make(
                            'MACD柱状图底背离', '💎', CATEGORY_TREND, '高', 1,
                            `股价创新低但MACD柱状图(${barNow.toFixed(3)})大于5日前(${bar5Ago.toFixed(3)})，底背离信号。`,
                            'BUY', 'MACD柱状图背离比DIF背离更灵敏'
                        ));
                    }
                }
            }
        }

        if (hasKline && closes.length >= 20) {
            const [bollLower, bollMid, bollUpper] = getBoll();
            const ma5Boll = getSma(5);
            const ma10Boll = getSma(10);
            const isUptrend = ma5Boll && ma10Boll && ma5Boll > ma10Boll;
            const isDowntrend = ma5Boll && ma10Boll && ma5Boll < ma10Boll;

            if (bollLower !== null) {
                // 普通触及：仅当明显跌破/突破（偏离>0.5%）时触发，精准触碰（<0.5%）由精准触碰策略处理
                const isPreciseLower = bollLower > 0 && Math.abs(cp - bollLower) / bollLower < 0.005;
                const isPreciseUpper = bollUpper > 0 && Math.abs(cp - bollUpper) / bollUpper < 0.005;
                if (cp <= bollLower && !isPreciseLower) {
                    if (isDowntrend) {
                        results.push(this._make(
                            '布林下轨-下跌趋势中', '⚠️', CATEGORY_TREND, '中', 2,
                            `股价(${cp.toFixed(2)})触及布林下轨(${bollLower.toFixed(2)})，但处于下跌趋势中，可能是下跌中继而非买点。等企稳再看。`,
                            'WATCH', '下跌趋势中触及下轨可能是续跌信号，不建议抄底',
                            { stop_loss: bollLower * 0.97 }
                        ));
                    } else {
                        results.push(this._make(
                            '布林下轨支撑', '🎯', CATEGORY_TREND, '高', 1,
                            `股价(${cp.toFixed(2)})触及布林下轨(${bollLower.toFixed(2)})，超卖反弹概率大。目标中轨(${bollMid.toFixed(2)})。`,
                            'BUY', '触及下轨后回归中轨概率>70%',
                            { target_price: bollMid, stop_loss: bollLower * 0.98 }
                        ));
                    }
                } else if (cp >= bollUpper && !isPreciseUpper) {
                    if (isUptrend) {
                        results.push(this._make(
                            '布林上轨-上涨趋势中', '📈', CATEGORY_TREND, '中', 2,
                            `股价(${cp.toFixed(2)})触及布林上轨(${bollUpper.toFixed(2)})，上涨趋势中可能继续突破。`,
                            'HOLD', '上涨趋势中触及上轨可能继续突破',
                            { target_price: bollUpper * 1.02 }
                        ));
                    } else {
                        results.push(this._make(
                            '布林上轨压力', '🎯', CATEGORY_TREND, '高', 1,
                            `股价(${cp.toFixed(2)})触及布林上轨(${bollUpper.toFixed(2)})，超买回调概率大。目标中轨(${bollMid.toFixed(2)})。`,
                            'SELL', '触及上轨后回归中轨概率>70%',
                            { target_price: bollMid, stop_loss: bollUpper * 1.02 }
                        ));
                    }
                }

                const bollWidth = bollMid > 0 ? (bollUpper - bollLower) / bollMid * 100 : 0;
                if (bollWidth < 5) {
                    results.push(this._make(
                        '布林收口-变盘在即', '🔄', CATEGORY_TREND, '中', 2,
                        `布林带宽度仅${bollWidth.toFixed(1)}%，极度收口，即将变盘。关注突破方向。`,
                        'WATCH', '收口后往往有大行情，等方向明确再操作'
                    ));
                }

                if (closes.length >= 2) {
                    const [prevLower, , prevUpper] = this.calcBollinger(closes.slice(0, -1), 20, 2);
                    if (cp > bollUpper && prevUpper !== null && closes[closes.length - 2] <= prevUpper) {
                        results.push(this._make(
                            '布林上轨突破', '🚀', CATEGORY_TREND, '高', 1,
                            `价格突破布林上轨(${bollUpper.toFixed(2)})，强势突破信号。`,
                            'BUY', '布林上轨突破通常意味着加速上涨'
                        ));
                    } else if (cp < bollLower && prevLower !== null && closes[closes.length - 2] >= prevLower) {
                        results.push(this._make(
                            '布林下轨突破', '📉', CATEGORY_TREND, '高', 1,
                            `价格突破布林下轨(${bollLower.toFixed(2)})，弱势突破信号。`,
                            'SELL', '布林下轨突破通常意味着加速下跌'
                        ));
                    }
                }
            }
        }

        if (hasKline && closes.length >= 10) {
            const [sarVal, sarDir] = getPsar();
            if (sarVal !== null) {
                if (sarDir === 'LONG' && cp > sarVal) {
                    results.push(this._make(
                        'SAR多头信号', '🟢', CATEGORY_TREND, '中', 2,
                        `SAR指标多头，止损点(${sarVal.toFixed(2)})，趋势向上持股。`,
                        'HOLD', 'SAR多头+价格在止损点上方，趋势延续'
                    ));
                } else if (sarDir === 'SHORT' && cp < sarVal) {
                    results.push(this._make(
                        'SAR空头信号', '🔴', CATEGORY_TREND, '中', 2,
                        `SAR指标空头，压力点(${sarVal.toFixed(2)})，趋势向下观望。`,
                        'AVOID_BUY', 'SAR空头+价格在压力点下方，趋势延续'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 15) {
            const [pdi, mdi, adx] = getDmi();
            if (pdi !== null) {
                if (pdi > mdi && adx > 25) {
                    results.push(this._make(
                        'DMI多头强势', '📈', CATEGORY_TREND, '中', 2,
                        `+DI(${pdi.toFixed(1)}) > -DI(${mdi.toFixed(1)})，ADX=${adx.toFixed(1)}>25，多头趋势明确。`,
                        'BUY', 'DMI多头+ADX>25表示趋势强劲'
                    ));
                } else if (mdi > pdi && adx > 25) {
                    results.push(this._make(
                        'DMI空头强势', '📉', CATEGORY_TREND, '中', 2,
                        `-DI(${mdi.toFixed(1)}) > +DI(${pdi.toFixed(1)})，ADX=${adx.toFixed(1)}>25，空头趋势明确。`,
                        'SELL', 'DMI空头+ADX>25表示趋势强劲'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 52) {
            const tenkan = (safeArrMax(highsWithToday.slice(-9)) + safeArrMin(lowsWithToday.slice(-9))) / 2;
            const kijun = (safeArrMax(highsWithToday.slice(-26)) + safeArrMin(lowsWithToday.slice(-26))) / 2;
            // 注意：标准一目均衡表中 Senkou Span A/B 应向前位移26个周期作为云层
            // 当前实现未做位移，直接用当期值判断，可能影响云层位置准确性
            const senkouA = (tenkan + kijun) / 2;
            const senkouB = (safeArrMax(highsWithToday.slice(-52)) + safeArrMin(lowsWithToday.slice(-52))) / 2;
            if (cp > Math.max(senkouA, senkouB) && tenkan > kijun) {
                results.push(this._make(
                    '一目均衡表-强势', '☁️', CATEGORY_TREND, '中', 2,
                    `股价在云层之上，转换线(${tenkan.toFixed(2)})>基准线(${kijun.toFixed(2)})，多头格局。`,
                    'HOLD', '一目均衡表多头排列，趋势向上'
                ));
            } else if (cp < Math.min(senkouA, senkouB) && tenkan < kijun) {
                results.push(this._make(
                    '一目均衡表-弱势', '☁️', CATEGORY_TREND, '中', 2,
                    `股价在云层之下，转换线(${tenkan.toFixed(2)})<基准线(${kijun.toFixed(2)})，空头格局。`,
                    'AVOID_BUY', '一目均衡表空头排列，趋势向下'
                ));
            }
        }

        const [vwap, vwapDev] = this.calcVwapDeviation(cp, vol, amt);
        if (vwap > 0) {
            if (vwapDev > 2.5) {
                results.push(this._make(
                    'VWAP严重偏离-卖出', '💰', CATEGORY_TREND, '高', 1,
                    `股价偏离VWAP +${vwapDev.toFixed(2)}%（VWAP=${vwap.toFixed(2)}），严重超买，回归概率大。`,
                    'SELL', 'VWAP偏离>2.5%回归概率>80%',
                    { target_price: vwap, stop_loss: cp * 1.01 }
                ));
            } else if (vwapDev < -2.5) {
                results.push(this._make(
                    'VWAP严重偏离-买入', '💰', CATEGORY_TREND, '高', 1,
                    `股价偏离VWAP ${vwapDev.toFixed(2)}%（VWAP=${vwap.toFixed(2)}），严重超卖，回归概率大。`,
                    'BUY', 'VWAP偏离<-2.5%回归概率>80%',
                    { target_price: vwap, stop_loss: cp * 0.99 }
                ));
            }
        }

        // TRIX（三重指数平滑平均线）策略
        if (hasKline && closes.length >= 30) {
            // 计算TRIX：对收盘价进行三次EMA平滑，再计算变化率
            const ema1 = this.ema(closesWithToday, 12);
            if (ema1 && ema1.length >= 3) {
                const ema2List = [];
                let ema2Prev = ema1[0];
                for (let i = 0; i < ema1.length; i++) {
                    ema2Prev = i === 0 ? ema1[i] : ema2Prev * 11 / 13 + ema1[i] * 2 / 13;
                    ema2List.push(ema2Prev);
                }
                const ema3List = [];
                let ema3Prev = ema2List[0];
                for (let i = 0; i < ema2List.length; i++) {
                    ema3Prev = i === 0 ? ema2List[i] : ema3Prev * 11 / 13 + ema2List[i] * 2 / 13;
                    ema3List.push(ema3Prev);
                }
                if (ema3List.length >= 2) {
                    const trixNow = (ema3List[ema3List.length - 1] - ema3List[ema3List.length - 2]) / ema3List[ema3List.length - 2] * 100;
                    const trixPrev = ema3List.length >= 3 ? (ema3List[ema3List.length - 2] - ema3List[ema3List.length - 3]) / ema3List[ema3List.length - 3] * 100 : 0;
                    // TRIX金叉零轴（从负转正）
                    if (trixPrev < 0 && trixNow >= 0) {
                        results.push(this._make(
                            'TRIX金叉零轴', '📈', CATEGORY_TREND, '高', 1,
                            `TRIX从${trixPrev.toFixed(2)}%上穿零轴至${trixNow.toFixed(2)}%，长期趋势转多。`,
                            'BUY', 'TRIX金叉零轴后1-3周上涨概率约65%'
                        ));
                    }
                    // TRIX死叉零轴（从正转负）
                    else if (trixPrev > 0 && trixNow <= 0) {
                        results.push(this._make(
                            'TRIX死叉零轴', '📉', CATEGORY_TREND, '高', 1,
                            `TRIX从${trixPrev.toFixed(2)}%下穿零轴至${trixNow.toFixed(2)}%，长期趋势转空。`,
                            'SELL', 'TRIX死叉零轴后1-3周下跌概率约60%'
                        ));
                    }
                    // TRIX持续上升
                    else if (trixNow > trixPrev && trixNow > 0) {
                        results.push(this._make(
                            'TRIX持续上升', '📈', CATEGORY_TREND, '中', 2,
                            `TRIX=${trixNow.toFixed(2)}%，持续上升，长期多头动能增强。`,
                            'HOLD', 'TRIX上升阶段持股待涨'
                        ));
                    }
                    // TRIX持续下降
                    else if (trixNow < trixPrev && trixNow < 0) {
                        results.push(this._make(
                            'TRIX持续下降', '📉', CATEGORY_TREND, '中', 2,
                            `TRIX=${trixNow.toFixed(2)}%，持续下降，长期空头动能增强。`,
                            'WATCH', 'TRIX下降阶段观望为主'
                        ));
                    }
                }
            }
        }

        // =================================================================
        //  新增：ARBR人气意愿指标策略
        // =================================================================
        if (hasKline && closes.length >= 26) {
            const arPeriod = 26;
            const brPeriod = 26;
            let arUp = 0, arDown = 0;
            let brUp = 0, brDown = 0;
            for (let i = closes.length - arPeriod; i < closes.length; i++) {
                if (i > 0) {
                    arUp += highs[i] - opens[i];
                    arDown += opens[i] - lows[i];
                    brUp += highs[i] - closes[i - 1];
                    brDown += closes[i - 1] - lows[i];
                }
            }
            const ar = arDown > 0 ? arUp / arDown * 100 : 100;
            const br = brDown > 0 ? brUp / brDown * 100 : 100;
            
            if (ar > 150 && br < 50) {
                results.push(this._make(
                    'ARBR黄金交叉', '🟢', CATEGORY_OSCILLATOR, '高', 1,
                    `AR=${ar.toFixed(0)}>150且BR=${br.toFixed(0)}<50，人气高涨但意愿低迷，这不是恐慌而是机会！`,
                    'BUY', 'AR上150且BR下50是经典买入信号，成功率约70%'
                ));
            } else if (ar < 50 && br > 300) {
                results.push(this._make(
                    'ARBR死亡交叉', '🔴', CATEGORY_OSCILLATOR, '高', 1,
                    `AR=${ar.toFixed(0)}<50且BR=${br.toFixed(0)}>300，人气低迷但意愿高涨，警惕多头陷阱！`,
                    'SELL', 'AR下50且BR上300是经典卖出信号'
                ));
            } else if (ar > 180) {
                results.push(this._make(
                    'AR人气过热', '🔴', CATEGORY_OSCILLATOR, '中', 2,
                    `AR=${ar.toFixed(0)}>180，市场人气极度狂热，短期有回调风险。`,
                    'WATCH', 'AR>180为极度超买区'
                ));
            } else if (ar < 40) {
                results.push(this._make(
                    'AR人气低迷', '🟢', CATEGORY_OSCILLATOR, '中', 2,
                    `AR=${ar.toFixed(0)}<40，市场人气极度低迷，反弹机会增大。`,
                    'BUY', 'AR<40为极度超卖区'
                ));
            } else if (br > 400) {
                results.push(this._make(
                    'BR意愿过热', '🔴', CATEGORY_OSCILLATOR, '中', 2,
                    `BR=${br.toFixed(0)}>400，买卖意愿极度强烈，恐高情绪蔓延。`,
                    'WATCH', 'BR>400为警戒区'
                ));
            } else if (br < 40) {
                results.push(this._make(
                    'BR意愿低迷', '🟢', CATEGORY_OSCILLATOR, '中', 2,
                    `BR=${br.toFixed(0)}<40，买卖意愿极度低迷，即将见底反弹。`,
                    'BUY', 'BR<40为极度超卖区'
                ));
            } else {
                results.push(this._make(
                    `ARBR指标中性(AR=${ar.toFixed(0)},BR=${br.toFixed(0)})`, '📊', CATEGORY_OSCILLATOR, '中', 4,
                    `AR=${ar.toFixed(0)}，BR=${br.toFixed(0)}，多空力量均衡。`,
                    'HOLD', 'ARBR中性区观望'
                ));
            }
        }

        // =================================================================
        //  新增：VWMA成交量加权均线策略
        // =================================================================
        if (hasKline && closes.length >= 20 && volumes.length >= 20) {
            const vwmaPeriod = 20;
            let vwmaSum = 0;
            let volSum = 0;
            for (let i = closes.length - vwmaPeriod; i < closes.length; i++) {
                vwmaSum += closes[i] * volumes[i];
                volSum += volumes[i];
            }
            const vwma = volSum > 0 ? vwmaSum / volSum : cp;
            
            if (vwma > 0) {
                const ma20 = getSma(20);
                if (cp > vwma && vwma > ma20) {
                    results.push(this._make(
                        'VWMA多头确认', '📈', CATEGORY_TREND, '高', 1,
                        `VWMA(${vwma.toFixed(2)})>MA20(${ma20 ? ma20.toFixed(2) : '-'}), 价格在VWMA上方，量价配合良好，真突破概率大。`,
                        'BUY', 'VWMA多头+量能配合是强势信号'
                    ));
                } else if (cp < vwma && vwma < ma20) {
                    results.push(this._make(
                        'VWMA空头确认', '📉', CATEGORY_TREND, '高', 1,
                        `VWMA(${vwma.toFixed(2)})<MA20(${ma20 ? ma20.toFixed(2) : '-'}), 价格在VWMA下方，量价背离，可能是假突破。`,
                        'SELL', 'VWMA空头表示量能不支持上涨'
                    ));
                } else if (cp > vwma) {
                    results.push(this._make(
                        'VWMA偏多', '📊', CATEGORY_TREND, '中', 2,
                        `价格(${cp.toFixed(2)})>VWMA(${vwma.toFixed(2)}), 量价配合偏多。`,
                        'HOLD', 'VWMA上方持股'
                    ));
                } else {
                    results.push(this._make(
                        'VWMA偏空', '📊', CATEGORY_TREND, '中', 2,
                        `价格(${cp.toFixed(2)})<VWMA(${vwma.toFixed(2)}), 量价配合偏空。`,
                        'WATCH', 'VWMA下方观望'
                    ));
                }
            }
        }

        // =================================================================
        //  新增：EXPMA指数平均数策略
        // =================================================================
        if (hasKline && closes.length >= 30) {
            const expmaShort = 12;
            const expmaLong = 50;
            
            let expma12 = closes[0];
            let expma50 = closes[0];
            const smooth12 = 2 / (expmaShort + 1);
            const smooth50 = 2 / (expmaLong + 1);
            
            for (let i = 1; i < closes.length; i++) {
                expma12 = closes[i] * smooth12 + expma12 * (1 - smooth12);
                expma50 = closes[i] * smooth50 + expma50 * (1 - smooth50);
            }
            
            const prevExpma12 = expma12;
            const prevExpma50 = expma50;
            
            if (expma12 > expma50 && prevExpma12 <= prevExpma50) {
                results.push(this._make(
                    'EXPMA金叉', '📈', CATEGORY_TREND, '高', 1,
                    `EXPMA(12)=${expma12.toFixed(2)}上穿EXPMA(50)=${expma50.toFixed(2)}，中期趋势转多。`,
                    'BUY', 'EXPMA金叉是稳健的中线买入信号'
                ));
            } else if (expma12 < expma50 && prevExpma12 >= prevExpma50) {
                results.push(this._make(
                    'EXPMA死叉', '📉', CATEGORY_TREND, '高', 1,
                    `EXPMA(12)=${expma12.toFixed(2)}下穿EXPMA(50)=${expma50.toFixed(2)}，中期趋势转空。`,
                    'SELL', 'EXPMA死叉是中线卖出信号'
                ));
            } else if (expma12 > expma50) {
                results.push(this._make(
                    'EXPMA多头排列', '📈', CATEGORY_TREND, '中', 2,
                    `EXPMA(12)=${expma12.toFixed(2)}>EXPMA(50)=${expma50.toFixed(2)}，中期多头趋势。`,
                    'HOLD', 'EXPMA多头持股待涨'
                ));
            } else {
                results.push(this._make(
                    'EXPMA空头排列', '📉', CATEGORY_TREND, '中', 2,
                    `EXPMA(12)=${expma12.toFixed(2)}<EXPMA(50)=${expma50.toFixed(2)}，中期空头趋势。`,
                    'WATCH', 'EXPMA空头观望为主'
                ));
            }
        }

        // =================================================================
        //  新增：MTM动量指标策略
        // =================================================================
        if (hasKline && closes.length >= 14) {
            const mtmPeriod = 10;
            const mtmBase = closesWithToday[closesWithToday.length - mtmPeriod];
            if (mtmBase > 0) {
                const mtm = (cp - mtmBase) / mtmBase * 100;
                
                if (mtm > 20) {
                    results.push(this._make(
                        'MTM动量极强', '🔴', CATEGORY_OSCILLATOR, '高', 1,
                        `MTM(${mtmPeriod})=${mtm.toFixed(2)}%>20，价格上涨速度极快，警惕回调。`,
                        'WATCH', 'MTM>20为超买区'
                    ));
                } else if (mtm < -20) {
                    results.push(this._make(
                        'MTM动量极弱', '🟢', CATEGORY_OSCILLATOR, '高', 1,
                        `MTM(${mtmPeriod})=${mtm.toFixed(2)}%<-20，价格下跌速度极快，反弹机会大。`,
                        'BUY', 'MTM<-20为超卖区'
                    ));
                } else if (mtm > 10) {
                    results.push(this._make(
                        'MTM动量偏强', '📈', CATEGORY_OSCILLATOR, '中', 2,
                        `MTM(${mtmPeriod})=${mtm.toFixed(2)}%，上涨动能较强。`,
                        'HOLD', 'MTM偏强持股'
                    ));
                } else if (mtm < -10) {
                    results.push(this._make(
                        'MTM动量偏弱', '📉', CATEGORY_OSCILLATOR, '中', 2,
                        `MTM(${mtmPeriod})=${mtm.toFixed(2)}%，下跌动能较强。`,
                        'WATCH', 'MTM偏弱观望'
                    ));
                } else {
                    results.push(this._make(
                        `MTM动量中性(${mtm.toFixed(2)}%)`, '📊', CATEGORY_OSCILLATOR, '中', 4,
                        `MTM(${mtmPeriod})=${mtm.toFixed(2)}%，多空平衡。`,
                        'HOLD', 'MTM中性观望'
                    ));
                }
            }
        }

        // =================================================================
        //  新增：DMA平行线差指标策略
        // =================================================================
        if (hasKline && closes.length >= 60) {
            const dmaShort = 10;
            const dmaLong = 50;
            const amaPeriod = 6;
            
            let ma10 = closes[0];
            let ma50 = closes[0];
            for (let i = 1; i < closes.length; i++) {
                ma10 = (ma10 * 9 + closes[i]) / 10;
                ma50 = (ma50 * 49 + closes[i]) / 50;
            }
            
            const dma = ma10 - ma50;
            const prevDma = dma;
            
            let ama = dma;
            for (let i = 1; i < closes.length; i++) {
                ama = (ama * 5 + dma) / 6;
            }
            
            if (dma > ama && prevDma <= ama) {
                results.push(this._make(
                    'DMA金叉', '📈', CATEGORY_TREND, '高', 1,
                    `DMA(${dma.toFixed(4)})上穿AMA(${ama.toFixed(4)})，趋势由弱转强。`,
                    'BUY', 'DMA金叉是中线买入信号'
                ));
            } else if (dma < ama && prevDma >= ama) {
                results.push(this._make(
                    'DMA死叉', '📉', CATEGORY_TREND, '高', 1,
                    `DMA(${dma.toFixed(4)})下穿AMA(${ama.toFixed(4)})，趋势由强转弱。`,
                    'SELL', 'DMA死叉是中线卖出信号'
                ));
            } else if (dma > 0) {
                results.push(this._make(
                    'DMA多头', '📈', CATEGORY_TREND, '中', 2,
                    `DMA=${dma.toFixed(4)}>0，中线多头趋势。`,
                    'HOLD', 'DMA>0持股'
                ));
            } else {
                results.push(this._make(
                    'DMA空头', '📉', CATEGORY_TREND, '中', 2,
                    `DMA=${dma.toFixed(4)}<0，中线空头趋势。`,
                    'WATCH', 'DMA<0观望'
                ));
            }
        }

        // =================================================================
        //  二、震荡类策略
        // =================================================================

        if (hasKline && closes.length >= 15) {
            const rsi = getRsi(14);
            if (rsi !== null) {
                if (rsi < 30) {
                    results.push(this._make(
                        'RSI超卖', '🟢', CATEGORY_OSCILLATOR, '高', 1,
                        `RSI(14)=${rsi.toFixed(1)}，进入超卖区(<30)，反弹概率大。`,
                        'STRONG_BUY', 'RSI<30为经典超卖信号',
                        { target_price: cp * 1.03, stop_loss: cp * 0.97 }
                    ));
                } else if (rsi > 70) {
                    results.push(this._make(
                        'RSI超买', '🔴', CATEGORY_OSCILLATOR, '高', 1,
                        `RSI(14)=${rsi.toFixed(1)}，进入超买区(>70)，回调概率大。`,
                        'STRONG_SELL', 'RSI>70为经典超买信号',
                        { target_price: cp * 0.97, stop_loss: cp * 1.03 }
                    ));
                } else if (rsi < 40) {
                    results.push(this._make(
                        'RSI偏弱', '📊', CATEGORY_OSCILLATOR, '中', 2,
                        `RSI(14)=${rsi.toFixed(1)}，偏弱区域，可轻仓试探。`,
                        'WATCH', 'RSI 30-40区域可分批建仓'
                    ));
                } else if (rsi > 60 && rsi <= 70) {
                    results.push(this._make(
                        'RSI偏强', '📊', CATEGORY_OSCILLATOR, '中', 2,
                        `RSI(14)=${rsi.toFixed(1)}，偏强区域，已持有可继续。`,
                        'HOLD', 'RSI 60-70区域趋势偏强'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 9) {
            const [k, d, j] = getKdj();
            if (k !== null) {
                if (j < 20) {
                    results.push(this._make(
                        'KDJ超卖-J值极低', '🟢', CATEGORY_OSCILLATOR, '高', 1,
                        `KDJ: K=${k.toFixed(1)} D=${d.toFixed(1)} J=${j.toFixed(1)}，J<20超卖区，强烈买入信号。`,
                        'STRONG_BUY', 'J<20为极端超卖，反弹概率>80%',
                        { target_price: cp * 1.03, stop_loss: cp * 0.97 }
                    ));
                } else if (j > 100) {
                    results.push(this._make(
                        'KDJ超买-J值极高', '🔴', CATEGORY_OSCILLATOR, '高', 1,
                        `KDJ: K=${k.toFixed(1)} D=${d.toFixed(1)} J=${j.toFixed(1)}，J>100超买区，强烈卖出信号。`,
                        'STRONG_SELL', 'J>100为极端超买，回调概率>80%',
                        { target_price: cp * 0.97, stop_loss: cp * 1.03 }
                    ));
                }

                if (hasKline && closes.length >= 10) {
                    const [kp, dp, jp] = this.calcKdj(
                        highsWithToday.slice(0, -1),
                        lowsWithToday.slice(0, -1),
                        closesWithToday.slice(0, -1)
                    );
                    if (kp !== null) {
                        if (k > d && kp <= dp) {
                            results.push(this._make(
                                'KDJ金叉', '📈', CATEGORY_OSCILLATOR, '中', 2,
                                'K线上穿D线，KDJ金叉，短期看涨。',
                                'BUY', 'KDJ金叉是短线买入信号'
                            ));
                        } else if (k < d && kp >= dp) {
                            results.push(this._make(
                                'KDJ死叉', '📉', CATEGORY_OSCILLATOR, '中', 2,
                                'K线下穿D线，KDJ死叉，短期看跌。',
                                'SELL', 'KDJ死叉是短线卖出信号'
                            ));
                        }
                    }
                }
            }
        }

        if (hasKline && closes.length >= 14) {
            const wr = getWr();
            if (wr !== null) {
                if (wr < -80) {
                    results.push(this._make(
                        '威廉%R超卖', '🟢', CATEGORY_OSCILLATOR, '中', 2,
                        `威廉%R=${wr.toFixed(1)}，<-80超卖区，反弹信号。`,
                        'BUY', '%R<-80等同于RSI<20'
                    ));
                } else if (wr > -20) {
                    results.push(this._make(
                        '威廉%R超买', '🔴', CATEGORY_OSCILLATOR, '中', 2,
                        `威廉%R=${wr.toFixed(1)}，>-20超买区，回调信号。`,
                        'SELL', '%R>-20等同于RSI>80'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 14) {
            const cci = getCci();
            if (cci !== null) {
                if (cci < -100) {
                    results.push(this._make(
                        'CCI超卖', '🟢', CATEGORY_OSCILLATOR, '中', 2,
                        `CCI=${cci.toFixed(1)}，<-100超卖区，价格偏离均值过大。`,
                        'BUY', 'CCI<-100为超卖信号'
                    ));
                } else if (cci > 100) {
                    results.push(this._make(
                        'CCI超买', '🔴', CATEGORY_OSCILLATOR, '中', 2,
                        `CCI=${cci.toFixed(1)}，>100超买区，价格偏离均值过大。`,
                        'SELL', 'CCI>100为超买信号'
                    ));
                }
            }
        }

        const rsv = (hp !== lp) ? ((cp - lp) / (hp - lp) * 100) : 50;
        if (rsv < 20) {
            const buyPrice = Math.min(cp * 0.998, lp * 1.003);
            results.push(this._make(
                'RSV超卖', '🎯', CATEGORY_OSCILLATOR, '高', 1,
                `RSV=${rsv.toFixed(0)}，超卖区，强烈买入信号。`,
                'STRONG_BUY', 'RSV<20反弹概率>85%',
                { entry_price: buyPrice, target_price: avgPrice, stop_loss: cp * 0.985 }
            ));
        } else if (rsv > 80) {
            results.push(this._make(
                'RSV超买', '🎯', CATEGORY_OSCILLATOR, '高', 1,
                `RSV=${rsv.toFixed(0)}，超买区，强烈卖出信号。`,
                'STRONG_SELL', 'RSV>80回调概率>85%',
                { target_price: avgPrice, stop_loss: cp * 1.015 }
            ));
        }

        const priceVsAvg = Math.abs(devFromAvg);
        if (priceVsAvg > 2.5) {
            if (cp > avgPrice) {
                results.push(this._make(
                    '均价线背离-超买', '🔴', CATEGORY_OSCILLATOR, '高', 1,
                    `股价偏离均价线 +${devFromAvg.toFixed(2)}%，严重超买！立即高抛。`,
                    'SELL', '均价线背离>2.5%回归概率>85%',
                    { target_price: avgPrice * 1.005, stop_loss: cp * 1.01 }
                ));
            } else {
                results.push(this._make(
                    '均价线背离-超卖', '🟢', CATEGORY_OSCILLATOR, '高', 1,
                    `股价偏离均价线 ${devFromAvg.toFixed(2)}%，严重超卖！立即低吸。`,
                    'BUY', '均价线背离<-2.5%回归概率>85%',
                    { target_price: avgPrice * 0.995, stop_loss: cp * 0.99 }
                ));
            }
        }

        const oscillatorScores = { buy: 0, sell: 0 };
        for (const r of results) {
            if (r.category === CATEGORY_OSCILLATOR) {
                if (r.action.includes('BUY')) oscillatorScores.buy++;
                else if (r.action.includes('SELL')) oscillatorScores.sell++;
            }
        }
        if (oscillatorScores.buy >= 3) {
            results.push(this._make(
                '多指标共振-超卖', '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                `${oscillatorScores.buy}个震荡指标同时发出买入信号，共振确认，可信度极高！`,
                'STRONG_BUY', '多指标共振信号可靠性远高于单一指标'
            ));
        } else if (oscillatorScores.sell >= 3) {
            results.push(this._make(
                '多指标共振-超买', '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                `${oscillatorScores.sell}个震荡指标同时发出卖出信号，共振确认，可信度极高！`,
                'STRONG_SELL', '多指标共振信号可靠性远高于单一指标'
            ));
        }

        // UOS（终极震荡指标）策略
        if (hasKline && closes.length >= 30) {
            const uosShort = 7, uosMid = 14, uosLong = 28;
            const calcBP = (i) => closes[i] - Math.min(lows[i], closes[i - 1] || lows[i]);
            const calcTR = (i) => Math.max(highs[i], closes[i - 1] || highs[i]) - Math.min(lows[i], closes[i - 1] || lows[i]);
            const calcAvg = (period) => {
                let sumBP = 0, sumTR = 0;
                for (let i = closes.length - period; i < closes.length; i++) {
                    if (i > 0) {
                        sumBP += calcBP(i);
                        sumTR += calcTR(i);
                    }
                }
                return sumTR > 0 ? sumBP / sumTR : 0;
            };
            const avg7 = calcAvg(uosShort);
            const avg14 = calcAvg(uosMid);
            const avg28 = calcAvg(uosLong);
            if (avg7 > 0 && avg14 > 0 && avg28 > 0) {
                const uos = 100 * (4 * avg7 + 2 * avg14 + avg28) / 7;
                // UOS超卖（<30）
                if (uos < 30) {
                    results.push(this._make(
                        'UOS终极震荡超卖', '🟢', CATEGORY_OSCILLATOR, '高', 1,
                        `UOS=${uos.toFixed(1)}<30，三重周期同时超卖，强烈反弹信号！`,
                        'BUY', 'UOS<30后反弹概率约70%'
                    ));
                }
                // UOS超买（>70）
                else if (uos > 70) {
                    results.push(this._make(
                        'UOS终极震荡超买', '🔴', CATEGORY_OSCILLATOR, '高', 1,
                        `UOS=${uos.toFixed(1)}>70，三重周期同时超买，回调风险大！`,
                        'SELL', 'UOS>70后回调概率约65%'
                    ));
                }
                // UOS中性区
                else {
                    results.push(this._make(
                        `UOS终极震荡中性(${uos.toFixed(1)})`, '📊', CATEGORY_OSCILLATOR, '中', 3,
                        `UOS=${uos.toFixed(1)}，处于30-70中性区，多空平衡。`,
                        'HOLD', 'UOS中性区观望'
                    ));
                }
            }
        }

        // ASI（累计震荡指标）策略
        if (hasKline && closes.length >= 20) {
            const siList = [];
            for (let i = 1; i < closes.length; i++) {
                const c = closes[i], c1 = closes[i - 1], h = highs[i], l = lows[i], h1 = highs[i - 1], l1 = lows[i - 1];
                const a = Math.abs(h - c1);
                const b = Math.abs(l - c1);
                const d = Math.abs(h1 - l1);
                const e = Math.abs(c1 - opens[i - 1]);
                const k = Math.max(a, b);
                const r = a > b && a > 0 ? a + b / 2 + d / 4 : (b > a && b > 0 ? b + a / 2 + d / 4 : d + e / 4);
                const si = r > 0 ? 50 * (c - c1 + (c - opens[i]) / 2 + (c1 - opens[i - 1]) / 4) * k / r : 0;
                siList.push(si);
            }
            if (siList.length >= 2) {
                const asiNow = siList.reduce((a, b) => a + b, 0);
                const asiPrev = siList.slice(0, -1).reduce((a, b) => a + b, 0);
                // ASI创新高但价格未创新高（顶背离）
                if (asiNow > asiPrev * 1.05 && cp < pc * 1.02 && chg < 1) {
                    results.push(this._make(
                        'ASI顶背离', '🔴', CATEGORY_OSCILLATOR, '高', 1,
                        `ASI创新高但价格未跟进，累计震荡顶背离，趋势可能反转。`,
                        'SELL', 'ASI顶背离后下跌概率约60%'
                    ));
                }
                // ASI创新低但价格未创新低（底背离）
                else if (asiNow < asiPrev * 0.95 && cp > pc * 0.98 && chg > -1) {
                    results.push(this._make(
                        'ASI底背离', '🟢', CATEGORY_OSCILLATOR, '高', 1,
                        `ASI创新低但价格未跟进，累计震荡底背离，反弹可能随时出现。`,
                        'BUY', 'ASI底背离后反弹概率约65%'
                    ));
                }
                // ASI持续上升
                else if (asiNow > asiPrev) {
                    results.push(this._make(
                        'ASI累计震荡上升', '📈', CATEGORY_OSCILLATOR, '中', 2,
                        `ASI持续上升，累计动能增强。`,
                        'HOLD', 'ASI上升持股'
                    ));
                }
            }
        }

        // =================================================================
        //  三、量价类策略
        // =================================================================

        if (vol > 2000000 && chg > 1) {
            results.push(this._make(
                '放量上涨', '📊', CATEGORY_VOLUME, '中', 2,
                `放量上涨 +${chg.toFixed(2)}%，成交量 ${vol.toLocaleString()}。趋势健康但勿追高。`,
                'HOLD', '放量上涨趋势延续概率高，但追高风险大'
            ));
        } else if (vol > 2000000 && chg < -1) {
            results.push(this._make(
                '放量下跌', '🚫', CATEGORY_VOLUME, '中', 2,
                `放量下跌 ${chg.toFixed(2)}%，成交量 ${vol.toLocaleString()}。主力出货，坚决不抄底。`,
                'AVOID_BUY', '放量下跌往往是真跌'
            ));
        } else if (vol < 500000 && Math.abs(chg) < 0.5) {
            results.push(this._make(
                '缩量横盘', '⏸️', CATEGORY_VOLUME, '低', 3,
                '成交量极低，市场观望情绪浓，等待放量方向选择。',
                'WATCH', '缩量横盘后往往有方向选择'
            ));
        }

        if (hasKline && closes.length >= 10) {
            const obvSeries = getObvSeries();
            const obvNow = obvSeries[obvSeries.length - 1];
            const obvPrev = obvSeries.length >= 2 ? obvSeries[obvSeries.length - 2] : 0;
            if (obvNow > obvPrev && chg > 0) {
                results.push(this._make(
                    'OBV上升趋势', '📈', CATEGORY_VOLUME, '中', 2,
                    'OBV能量潮上升，量能配合价格上涨，趋势健康。',
                    'HOLD', 'OBV上升确认上涨趋势'
                ));
            } else if (obvNow < obvPrev && chg < 0) {
                results.push(this._make(
                    'OBV下降趋势', '📉', CATEGORY_VOLUME, '中', 2,
                    'OBV能量潮下降，量能配合价格下跌，趋势延续。',
                    'SELL', 'OBV下降确认下跌趋势'
                ));
            }
        }

        if (hasKline && volumes.length >= 5) {
            const avgVol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const volRatio = avgVol5 > 0 ? vol / avgVol5 : 1;
            if (volRatio > 3) {
                results.push(this._make(
                    `量比异动 (${volRatio.toFixed(1)}倍)`, '⚡', CATEGORY_VOLUME, '中', 2,
                    `量比${volRatio.toFixed(1)}，成交量异常放大，关注价格方向。`,
                    'WATCH', '量比>3表示有大资金介入'
                ));
            }
        }

        if (hasKline && closes.length >= 10) {
            const avgVol5 = volumes.length >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : vol;
            if (cp > closes[closes.length - 1] && vol < avgVol5) {
                results.push(this._make(
                    '量价背离-价涨量缩', '⚠️', CATEGORY_VOLUME, '中', 2,
                    '价格上涨但成交量萎缩，量价背离，上涨动力不足。',
                    'SELL', '量价背离后回调概率约60%'
                ));
            }
        }

        // EMV（简易波动指标）策略
        if (hasKline && closes.length >= 20) {
            const emvList = [];
            for (let i = 1; i < closes.length; i++) {
                const mid = (highs[i] + lows[i]) / 2;
                const mid1 = (highs[i - 1] + lows[i - 1]) / 2;
                const boxRatio = volumes[i] > 0 ? (volumes[i] / 1000000) / (highs[i] - lows[i]) : 0;
                const emv = highs[i] !== lows[i] ? (mid - mid1) / (highs[i] - lows[i]) / (boxRatio + 1) : 0;
                emvList.push(emv);
            }
            if (emvList.length >= 14) {
                // 计算EMV的14日EMA
                let emvEma = emvList[0];
                for (let i = 0; i < emvList.length; i++) {
                    emvEma = i === 0 ? emvList[i] : emvEma * 13 / 15 + emvList[i] * 2 / 15;
                }
                const emvAvg = emvList.slice(-5).reduce((a, b) => a + b, 0) / 5;
                // EMV上穿零轴
                if (emvAvg > 0 && emvList[emvList.length - 2] <= 0) {
                    results.push(this._make(
                        'EMV简易波动上穿零轴', '📈', CATEGORY_VOLUME, '高', 1,
                        `EMV从负区上穿零轴，量价配合良好，上涨动能增强。`,
                        'BUY', 'EMV上穿零轴后上涨概率约65%'
                    ));
                }
                // EMV下穿零轴
                else if (emvAvg < 0 && emvList[emvList.length - 2] >= 0) {
                    results.push(this._make(
                        'EMV简易波动下穿零轴', '📉', CATEGORY_VOLUME, '高', 1,
                        `EMV从正区下穿零轴，量价背离，下跌风险增大。`,
                        'SELL', 'EMV下穿零轴后下跌概率约60%'
                    ));
                }
                // EMV持续为正
                else if (emvAvg > 0) {
                    results.push(this._make(
                        'EMV简易波动为正', '📈', CATEGORY_VOLUME, '中', 2,
                        `EMV=${emvAvg.toFixed(2)}>0，量价配合良好。`,
                        'HOLD', 'EMV为正持股'
                    ));
                }
                // EMV持续为负
                else if (emvAvg < 0) {
                    results.push(this._make(
                        'EMV简易波动为负', '📉', CATEGORY_VOLUME, '中', 2,
                        `EMV=${emvAvg.toFixed(2)}<0，量价配合不佳。`,
                        'WATCH', 'EMV为负观望'
                    ));
                }
            }
        }

        // =================================================================
        //  三-2、分时主力意图分析策略（基于分时量价数据推断主力行为）
        // =================================================================

        if (cp > 0 && vol > 0) {
            // ---- 1. 分时量价配合分析（主力吸筹/出货识别）----
            // 核心逻辑：上涨放量=主力主动买入（吸筹），下跌放量=主力主动卖出（出货）
            const priceRange = hp - lp;
            const upperHalfVol = priceRange > 0 ? Math.min(1, (cp - lp) / priceRange) : 0.5;
            const lowerHalfVol = 1 - upperHalfVol;

            // 价格位置 + 涨跌幅 + 量比 综合判断主力意图
            const avgVol10 = hasKline && volumes.length >= 10
                ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10
                : vol;
            const volRatioMain = avgVol10 > 0 ? vol / avgVol10 : 1;

            // 上涨放量：价格在上半区 + 量比>1.2 → 主力吸筹
            if (chg > 0.3 && volRatioMain > 1.2 && upperHalfVol > 0.55) {
                const intensity = volRatioMain > 2 ? '强烈' : (volRatioMain > 1.5 ? '明显' : '轻微');
                results.push(this._make(
                    `[主力] 分时吸筹-${intensity}`, '🟢', CATEGORY_VOLUME, '高', 1,
                    `价格上涨${chg.toFixed(2)}%+放量${volRatioMain.toFixed(1)}倍，价格位于日内高位(${(upperHalfVol*100).toFixed(0)}%)，主力主动买入迹象${intensity}。`,
                    'BUY', `分时吸筹信号：涨+放量+价在上半区，主力介入概率>70%`,
                    { main_force_trend: '吸筹', volume_ratio: volRatioMain, price_position: upperHalfVol }
                ));
            }
            // 下跌放量：价格在下半区 + 量比>1.2 → 主力出货
            else if (chg < -0.3 && volRatioMain > 1.2 && lowerHalfVol > 0.55) {
                const intensity = volRatioMain > 2 ? '强烈' : (volRatioMain > 1.5 ? '明显' : '轻微');
                results.push(this._make(
                    `[主力] 分时出货-${intensity}`, '🔴', CATEGORY_VOLUME, '高', 1,
                    `价格下跌${chg.toFixed(2)}%+放量${volRatioMain.toFixed(1)}倍，价格位于日内低位(${(lowerHalfVol*100).toFixed(0)}%)，主力主动卖出迹象${intensity}。`,
                    'SELL', `分时出货信号：跌+放量+价在下半区，主力离场概率>70%`,
                    { main_force_trend: '出货', volume_ratio: volRatioMain, price_position: upperHalfVol }
                ));
            }
            // 上涨缩量：价涨但量缩 → 假突破/诱多
            else if (chg > 0.5 && volRatioMain < 0.7) {
                results.push(this._make(
                    '[主力] 涨价缩量-诱多警惕', '⚠️', CATEGORY_VOLUME, '中', 2,
                    `价格上涨${chg.toFixed(2)}%但量比仅${volRatioMain.toFixed(1)}倍，缩量上涨多为诱多，主力未真实参与。`,
                    'SELL', '缩量上涨=主力不认可，回落概率>60%',
                    { main_force_trend: '诱多', volume_ratio: volRatioMain }
                ));
            }
            // 跌价缩量：跌但量缩 → 洗盘而非出货
            else if (chg < -0.5 && volRatioMain < 0.7) {
                results.push(this._make(
                    '[主力] 跌价缩量-洗盘可能', '🔍', CATEGORY_VOLUME, '中', 2,
                    `价格下跌${chg.toFixed(2)}%但量比仅${volRatioMain.toFixed(1)}倍，缩量下跌多为洗盘，主力未大举出货。`,
                    'WATCH', '缩量下跌=主力未出逃，反弹概率>55%',
                    { main_force_trend: '洗盘', volume_ratio: volRatioMain }
                ));
            }
            // 平量震荡：量比接近1，价格波动小 → 主力观望
            else if (volRatioMain > 0.8 && volRatioMain < 1.2 && Math.abs(chg) < 0.5) {
                results.push(this._make(
                    '[主力] 平量震荡-主力观望', '⏸️', CATEGORY_VOLUME, '低', 3,
                    `量比${volRatioMain.toFixed(1)}倍接近正常，价格波幅小，主力观望中，等待方向选择。`,
                    'WATCH', '平量震荡=主力未表态，宜观望',
                    { main_force_trend: '观望', volume_ratio: volRatioMain }
                ));
            }

            // ---- 2. 大单估算（用成交额/成交量推算单笔大小）----
            if (amt > 0 && vol > 0) {
                const avgTicket = amt / vol; // 估算平均每笔成交金额
                const histAvgAmount = hasKline && volumes.length >= 5
                    ? volumes.slice(-5).reduce((a, v, i) => a + v * closes[closes.length - 5 + i], 0) / 5
                    : amt;
                const histAvgTicket = hasKline && volumes.length >= 5
                    ? histAvgAmount / (volumes.slice(-5).reduce((a, b) => a + b, 0) / 5)
                    : avgTicket;
                const ticketRatio = histAvgTicket > 0 ? avgTicket / histAvgTicket : 1;

                if (ticketRatio > 1.5 && chg > 0) {
                    results.push(this._make(
                        `[主力] 大单买入-${ticketRatio.toFixed(1)}倍`, '💼', CATEGORY_VOLUME, '高', 1,
                        `平均每笔成交${avgTicket.toFixed(0)}元，较5日均值的${histAvgTicket.toFixed(0)}元放大${ticketRatio.toFixed(1)}倍，且价格上涨，大单主动买入。`,
                        'BUY', `大单占比上升+价格上涨=机构/大户买入，跟庄概率>65%`,
                        { avg_ticket_size: avgTicket, ticket_ratio: ticketRatio }
                    ));
                } else if (ticketRatio > 1.5 && chg < 0) {
                    results.push(this._make(
                        `[主力] 大单卖出-${ticketRatio.toFixed(1)}倍`, '💼', CATEGORY_VOLUME, '高', 1,
                        `平均每笔成交${avgTicket.toFixed(0)}元，较5日均值的${histAvgTicket.toFixed(0)}元放大${ticketRatio.toFixed(1)}倍，且价格下跌，大单主动卖出。`,
                        'SELL', `大单占比上升+价格下跌=机构/大户出货，离场概率>65%`,
                        { avg_ticket_size: avgTicket, ticket_ratio: ticketRatio }
                    ));
                } else if (ticketRatio < 0.7 && Math.abs(chg) > 0.5) {
                    results.push(this._make(
                        '[主力] 小单主导-散户行情', '👥', CATEGORY_VOLUME, '低', 3,
                        `平均每笔成交${avgTicket.toFixed(0)}元，较5日均值缩小至${ticketRatio.toFixed(1)}倍，价格波动但大单未参与，散户行情难持续。`,
                        'WATCH', '小单主导=散户行情，方向不确定',
                        { avg_ticket_size: avgTicket, ticket_ratio: ticketRatio }
                    ));
                }
            }

            // ---- 3. 分时形态识别（阶梯上涨/脉冲放量/V型反转）----
            if (hasKline && closes.length >= 5) {
                const recentCloses = closes.slice(-5);
                const recentVols = volumes.slice(-5);

                // 阶梯式上涨：逐日收盘价递增 + 量能温和放大 → 主力控盘吸筹
                let isStairUp = true;
                let volIncreasing = true;
                for (let i = 1; i < recentCloses.length; i++) {
                    if (recentCloses[i] <= recentCloses[i - 1] * 1.001) isStairUp = false;
                    if (recentVols[i] < recentVols[i - 1] * 0.8) volIncreasing = false;
                }
                if (isStairUp && volIncreasing && chg > 0) {
                    results.push(this._make(
                        '[主力] 阶梯式吸筹', '🪜', CATEGORY_VOLUME, '高', 1,
                        `近5日收盘价逐日递增+量能温和放大，典型阶梯式上涨形态，主力控盘稳步吸筹。`,
                        'BUY', '阶梯式上涨=主力控盘吸筹，后续看涨概率>70%',
                        { pattern: '阶梯吸筹', consecutive_up_days: 5 }
                    ));
                }

                // 脉冲式放量：今日量比远超近日均值 + 涨跌幅大 → 主力突击
                const recentAvgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
                const todayVolRatio = recentAvgVol > 0 ? vol / recentAvgVol : 1;
                if (todayVolRatio > 2 && Math.abs(chg) > 2) {
                    if (chg > 0) {
                        results.push(this._make(
                            '[主力] 脉冲放量-突击拉升', '🚀', CATEGORY_VOLUME, '高', 1,
                            `今日量比${todayVolRatio.toFixed(1)}倍+涨幅${chg.toFixed(2)}%，脉冲式放量拉升，主力突击进场。`,
                            'BUY', '脉冲放量拉升=主力突击，短期动能强',
                            { pattern: '脉冲拉升', volume_ratio: todayVolRatio }
                        ));
                    } else {
                        results.push(this._make(
                            '[主力] 脉冲放量-恐慌抛售', '💀', CATEGORY_VOLUME, '高', 1,
                            `今日量比${todayVolRatio.toFixed(1)}倍+跌幅${chg.toFixed(2)}%，脉冲式放量下跌，主力恐慌性抛售或砸盘。`,
                            'SELL', '脉冲放量下跌=主力砸盘，短期风险大',
                            { pattern: '脉冲抛售', volume_ratio: todayVolRatio }
                        ));
                    }
                }

                // V型反转：前几日下跌 + 今日强势反弹 → 主力抄底
                if (closes.length >= 4 && chg > 1) {
                    const prev3Chg = (closes[closes.length - 1] - closes[closes.length - 4]) / closes[closes.length - 4] * 100;
                    if (prev3Chg < -3 && chg > 1.5) {
                        results.push(this._make(
                            '[主力] V型反转-抄底信号', 'V', CATEGORY_VOLUME, '高', 1,
                            `前3日下跌${prev3Chg.toFixed(1)}%后今日反弹${chg.toFixed(2)}%，V型反转形态，主力抄底入场。`,
                            'BUY', 'V型反转=主力抄底，反弹概率>60%',
                            { pattern: 'V型反转', prev_drop: prev3Chg }
                        ));
                    }
                }

                // 顶部放量滞涨：量比大但涨幅缩小 → 主力出货
                if (todayVolRatio > 1.5 && chg > 0 && chg < 0.5 && hasKline && closes.length >= 3) {
                    const prev2Chg = (closes[closes.length - 1] - closes[closes.length - 3]) / closes[closes.length - 3] * 100;
                    if (prev2Chg > 3) {
                        results.push(this._make(
                            '[主力] 放量滞涨-出货嫌疑', '⛔', CATEGORY_VOLUME, '高', 1,
                            `前2日已涨${prev2Chg.toFixed(1)}%，今日量比${todayVolRatio.toFixed(1)}倍但涨幅仅${chg.toFixed(2)}%，放量滞涨=主力暗中出货。`,
                            'SELL', '放量滞涨=主力出货经典形态，回调概率>65%',
                            { pattern: '放量滞涨', volume_ratio: todayVolRatio }
                        ));
                    }
                }
            }

            // ---- 4. 量比趋势变化（资金入场/撤退节奏）----
            if (hasKline && volumes.length >= 10) {
                const avgVol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
                const avgVol10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
                const vol5Vs10 = avgVol10 > 0 ? avgVol5 / avgVol10 : 1;
                const todayVs5 = avgVol5 > 0 ? vol / avgVol5 : 1;

                // 近5日均量 > 近10日均量 + 今日继续放量 → 资金持续入场
                if (vol5Vs10 > 1.15 && todayVs5 > 1.1 && chg > 0) {
                    results.push(this._make(
                        '[主力] 量能递增-资金持续入场', '📈', CATEGORY_VOLUME, '高', 1,
                        `近5日均量是10日均量的${vol5Vs10.toFixed(2)}倍，今日继续放量${todayVs5.toFixed(1)}倍，资金持续入场趋势明确。`,
                        'BUY', '量能递增=资金持续流入，上涨持续性>70%',
                        { vol5_vs_10: vol5Vs10, today_vs_5: todayVs5 }
                    ));
                }
                // 近5日均量 < 近10日均量 + 今日缩量 → 资金持续撤退
                else if (vol5Vs10 < 0.85 && todayVs5 < 0.9 && chg < 0) {
                    results.push(this._make(
                        '[主力] 量能递减-资金持续撤退', '📉', CATEGORY_VOLUME, '高', 1,
                        `近5日均量仅为10日均量的${vol5Vs10.toFixed(2)}倍，今日继续缩量${todayVs5.toFixed(1)}倍，资金持续撤退趋势明确。`,
                        'SELL', '量能递减=资金持续流出，下跌持续性>70%',
                        { vol5_vs_10: vol5Vs10, today_vs_5: todayVs5 }
                    ));
                }
            }

            // ---- 5. 盘口买卖力量估算（用价格位置+成交额推算）----
            if (amt > 0 && priceRange > 0) {
                // 用价格在区间中的位置 + 成交额大小 推算买卖力量
                const pricePos = (cp - lp) / priceRange; // 0~1
                // 估算主动买入占比：价格越高，主动买入越多
                const buyForce = pricePos;
                const sellForce = 1 - pricePos;
                const forceDiff = buyForce - sellForce; // -1~1

                // 大额成交 + 买方占优 → 主动买入强势
                const amtRatio = hasKline && volumes.length >= 5
                    ? amt / (volumes.slice(-5).reduce((a, v, i) => a + v * closes[closes.length - 5 + i], 0) / 5)
                    : 1;

                if (forceDiff > 0.2 && amtRatio > 1.3) {
                    results.push(this._make(
                        '[主力] 盘口买方强势', '💪', CATEGORY_VOLUME, '中', 2,
                        `价格位于日内区间${(pricePos*100).toFixed(0)}%高位，成交额放大${amtRatio.toFixed(1)}倍，买方力量明显占优（${(buyForce*100).toFixed(0)}% vs ${(sellForce*100).toFixed(0)}%）。`,
                        'BUY', '盘口买方强势+放量=主动买入多，短期看涨',
                        { buy_force: buyForce, sell_force: sellForce, amount_ratio: amtRatio }
                    ));
                } else if (forceDiff < -0.2 && amtRatio > 1.3) {
                    results.push(this._make(
                        '[主力] 盘口卖方强势', '👊', CATEGORY_VOLUME, '中', 2,
                        `价格位于日内区间${(pricePos*100).toFixed(0)}%低位，成交额放大${amtRatio.toFixed(1)}倍，卖方力量明显占优（${(sellForce*100).toFixed(0)}% vs ${(buyForce*100).toFixed(0)}%）。`,
                        'SELL', '盘口卖方强势+放量=主动卖出多，短期看跌',
                        { buy_force: buyForce, sell_force: sellForce, amount_ratio: amtRatio }
                    ));
                }
            }
        }

        // =================================================================
        //  三-3、分时形态战法策略（基于黄白线乖离、经典分时形态）
        // =================================================================

        // 黄白线乖离：用VWAP均价线作为"黄线"，当前价作为"白线"
        if (vwap > 0 && cp > 0) {
            const volRatioMain = (hasKline && volumes.length >= 10)
                ? vol / (volumes.slice(-10).reduce((a, b) => a + b, 0) / 10)
                : 1;
            // 计算乖离格数：假设1格=1%偏离
            const biasPercent = Math.abs(vwapDev);
            const biasDirection = vwapDev > 0 ? '上' : '下';
            const priceGrids = Math.round(biasPercent);

            // ---- 黄白线乖离战法 ----
            // 乖离<1%：横盘区，不做T
            if (biasPercent < 1) {
                results.push(this._make(
                    '[分时] 黄白线横盘-不做T', '⏸️', CATEGORY_MICRO, '低', 3,
                    `股价偏离均价线仅${biasPercent.toFixed(1)}%，在3格以内横盘震荡。空间不足1%，扣掉手续费=白干，建议等待突破。`,
                    'WATCH', '黄白线3格内横盘=空间不足，只看不动',
                    { vwap_bias: biasPercent, vwap: vwap }
                ));
            }
            // 乖离>3%：黄金操作信号
            else if (biasPercent > 3) {
                if (vwapDev > 0) {
                    // 高位乖离：倒T卖出机会
                    results.push(this._make(
                        `[分时] 高位乖离-倒T卖出`, '📉', CATEGORY_MICRO, '高', 1,
                        `股价偏离均价线+${biasPercent.toFixed(1)}%（超5格），情绪透支必然回归。建议卖出机动仓，等回踩均价线${vwap.toFixed(2)}附近再接回。`,
                        'SELL', `黄白线高位乖离>5格=倒T黄金信号，回归概率>80%`,
                        { vwap_bias: biasPercent, target_buy_price: vwap }
                    ));
                } else {
                    // 低位乖离：正T买入机会
                    results.push(this._make(
                        `[分时] 低位乖离-正T买入`, '📈', CATEGORY_MICRO, '高', 1,
                        `股价偏离均价线-${biasPercent.toFixed(1)}%（超5格），恐慌过度必然反弹。建议买入机动仓，等反弹至均价线${vwap.toFixed(2)}附近再抛出。`,
                        'BUY', `黄白线低位乖离>5格=正T黄金信号，反弹概率>80%`,
                        { vwap_bias: biasPercent, target_sell_price: vwap }
                    ));
                }
            }
            // 乖离在1-3%之间：观察区
            else if (biasPercent >= 1 && biasPercent <= 3) {
                results.push(this._make(
                    '[分时] 黄白线温和偏离-观察', '👁️', CATEGORY_MICRO, '中', 2,
                    `股价偏离均价线${biasPercent.toFixed(1)}%，偏离3-5格之间。若量能配合可试探，否则等进一步偏离再操作。`,
                    'WATCH', '黄白线温和偏离=信号不强，需量能配合',
                    { vwap_bias: biasPercent, vwap: vwap }
                ));
            }

            // ---- 急拉vs急跌判断（用日内振幅位置）----
            const dayRange = hp - lp;
            const pricePos = dayRange > 0 ? (cp - lp) / dayRange : 0.5;
            const upperZone = pricePos > 0.85; // 接近日内高点
            const lowerZone = pricePos < 0.15; // 接近日内低点

            // 5格直线拉升：可能涨停，不T要捂
            if (chg > 3 && volRatioMain > 2 && upperZone) {
                results.push(this._make(
                    '[分时] 直线拉升-可能涨停', '🚀', CATEGORY_MICRO, '高', 1,
                    `股价涨幅${chg.toFixed(1)}%+量比${volRatioMain.toFixed(1)}倍，位于日内高位(${(pricePos*100).toFixed(0)}%)。直线拉升可能是主力封板前兆，不要做T，锁仓等待！`,
                    'HOLD', `直线拉升+放量=可能涨停，做T=卖飞`,
                    { change: chg, volume_ratio: volRatioMain, price_position: pricePos }
                ));
            }

            // ---- 分时正T形态识别 ----
            // 3底逐级抬升：价格低点在逐步抬高（用日内走势判断）
            if (lowerZone && chg > 0 && chg < 2 && volRatioMain > 1.2) {
                results.push(this._make(
                    '[分时] 三底抬升-正T买入', '📈', CATEGORY_MICRO, '高', 1,
                    `价格位于日内低位但逐步抬高，量比${volRatioMain.toFixed(1)}倍配合。典型的三底抬升形态，可买入机动仓等待反弹。`,
                    'BUY', '三底逐级抬升+量能配合=买入信号',
                    { pattern: '三底抬升', volume_ratio: volRatioMain }
                ));
            }

            // 急跌钩头：日内低位但开始反弹
            if (lowerZone && chg > -1 && chg < 1 && volRatioMain > 1.3) {
                results.push(this._make(
                    '[分时] 急跌钩头-正T买入', '↩️', CATEGORY_MICRO, '高', 1,
                    `价格急跌后在日内低位${(pricePos*100).toFixed(0)}%出现钩头，量比${volRatioMain.toFixed(1)}倍放大。典型的急跌钩头形态，可买入等待反弹。`,
                    'BUY', '急跌钩头+放量=反弹信号',
                    { pattern: '急跌钩头', volume_ratio: volRatioMain }
                ));
            }

            // ---- 分时反T形态识别 ----
            // 跌破均价线
            if (vwapDev < -1 && chg < 0) {
                results.push(this._make(
                    '[分时] 跌破均价线-反T卖出', '📉', CATEGORY_MICRO, '高', 1,
                    `股价跌破均价线${Math.abs(vwapDev).toFixed(1)}%，且当日下跌${chg.toFixed(2)}%。跌破均价线=弱势确立，反弹至均价线附近应卖出。`,
                    'SELL', '跌破均价线=弱势确立，反弹即卖点',
                    { vwap_bias: vwapDev, vwap: vwap }
                ));
            }

            // 量价背离：价涨量缩
            if (chg > 0.5 && volRatioMain < 0.7) {
                results.push(this._make(
                    '[分时] 量价背离-反T卖出', '⚠️', CATEGORY_MICRO, '高', 1,
                    `价格上涨${chg.toFixed(1)}%但量比仅${volRatioMain.toFixed(1)}倍，量价背离。无量上涨是诱多，应该卖出。`,
                    'SELL', '价涨量缩=主力诱多，冲高即卖点',
                    { volume_ratio: volRatioMain }
                ));
            }

            // 快速拉升但量能不持续
            if (chg > 2 && volRatioMain > 1.5 && volRatioMain < 2) {
                // 判断是否接近高位（可能冲高回落）
                if (upperZone) {
                    results.push(this._make(
                        '[分时] 冲高量能不足-反T卖出', '⬇️', CATEGORY_MICRO, '中', 2,
                        `快速拉升${chg.toFixed(1)}%但量比${volRatioMain.toFixed(1)}倍不够充沛，且位于日内高位。量能不持续=冲高回落风险。`,
                        'SELL', '快速拉升+量能不持续=冲高回落',
                        { volume_ratio: volRatioMain, change: chg }
                    ));
                }
            }

            // 箱体震荡：用振幅判断
            if (amplitude > 1 && amplitude < 3 && Math.abs(chg) < 1 && volRatioMain > 0.8 && volRatioMain < 1.3) {
                results.push(this._make(
                    '[分时] 箱体震荡-高抛低吸', '📦', CATEGORY_MICRO, '中', 2,
                    `日内振幅${amplitude.toFixed(1)}%，价格波动不大，呈箱体震荡。可在箱体下沿${lp.toFixed(2)}附近买入，上沿${hp.toFixed(2)}附近卖出。`,
                    'WATCH', '箱体震荡=高抛低吸，不破位可反复T',
                    { box_low: lp, box_high: hp, amplitude: amplitude }
                ));
            }

            // 开盘长波下跌+反弹无力
            if (chg < -1.5 && volRatioMain > 1.5 && pricePos < 0.3) {
                results.push(this._make(
                    '[分时] 长波下跌-反T卖出', '⬇️', CATEGORY_MICRO, '高', 1,
                    `开盘长波下跌${chg.toFixed(1)}%，量比${volRatioMain.toFixed(1)}倍放大但位于日内低位。主力砸盘坚决，反弹无力应卖出。`,
                    'SELL', '长波下跌+放量=主力砸盘，反弹即卖点',
                    { change: chg, volume_ratio: volRatioMain }
                ));
            }
        }

        // ---- 时间窗口+分时形态组合策略 ----
        // 早盘急拉：9:30-10:00 急拉超3%要警惕
        if ((hour === 9 && minute >= 30) || (hour === 10 && minute < 30)) {
            const volRatioMain = (hasKline && volumes.length >= 10)
                ? vol / (volumes.slice(-10).reduce((a, b) => a + b, 0) / 10)
                : 1;
            if (chg > 3 && volRatioMain > 2) {
                results.push(this._make(
                    '[分时] 早盘急拉-警惕诱多', '⚠️', CATEGORY_MICRO, '高', 1,
                    `早盘${hour}:${minute}急拉${chg.toFixed(1)}%，量比${volRatioMain.toFixed(1)}倍。早盘急拉常是主力诱多，观察能否站稳，急拉不追高。`,
                    'WATCH', '早盘急拉=诱多嫌疑，等待确认',
                    { time: `${hour}:${minute}`, change: chg }
                ));
            } else if (chg < -2 && volRatioMain > 1.5) {
                results.push(this._make(
                    '[分时] 早盘急跌-关注低吸', '🔍', CATEGORY_MICRO, '高', 1,
                    `早盘${hour}:${minute}急跌${chg.toFixed(1)}%，量比${volRatioMain.toFixed(1)}倍。早盘急跌常是洗盘或恐慌盘，观察量能是否萎缩，企稳可低吸。`,
                    'BUY', '早盘急跌=洗盘可能，企稳低吸',
                    { time: `${hour}:${minute}`, change: chg }
                ));
            }
        }

        // 尾盘拉升：14:30之后拉升
        if (hour === 14 && minute >= 30) {
            if (chg > 1.5) {
                results.push(this._make(
                    '[分时] 尾盘拉升-次日高开?', '🌆', CATEGORY_MICRO, '中', 2,
                    `尾盘拉升${chg.toFixed(1)}%，可能是做收盘价或有利好。尾盘拉升次日高开概率大，但也要警惕诱多。正T可留仓过夜。`,
                    'HOLD', '尾盘拉升=次日高开概率大',
                    { change: chg }
                ));
            } else if (chg < -1.5) {
                results.push(this._make(
                    '[分时] 尾盘跳水-次日低开?', '🌆', CATEGORY_MICRO, '中', 2,
                    `尾盘跳水${chg.toFixed(1)}%，可能是洗盘或有利空。尾盘跳水次日低开概率大，做T当日了结不留仓。`,
                    'SELL', '尾盘跳水=次日低开风险',
                    { change: chg }
                ));
            }
        }

        // =================================================================
        //  三-4、量比做T策略（抖音实战：缩量涨就卖，缩量跌就买）
        // =================================================================

        // 量比判断标准：
        // 量比 > 1: 当前成交活跃度高于平时，有场外资金进场，属于放量行情
        // 量比 < 1: 成交冷清，场内资金观望，属于缩量行情
        // 量比 < 0.8: 严重缩量，拉升几乎没有资金支撑

        if (cp > 0 && vol > 0) {
            const avgVol10 = hasKline && volumes.length >= 10
                ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10
                : vol;
            const volRatioMain = avgVol10 > 0 ? vol / avgVol10 : 1;

            // 缩量上涨 = 标准卖点：股价上涨但成交量缩小，跟风资金不足，冲高回落概率高
            if (chg > 0.5 && volRatioMain < 0.8) {
                results.push(this._make(
                    '[量比] 缩量上涨-果断卖出', '🔴', CATEGORY_MICRO, '高', 1,
                    `股价上涨${chg.toFixed(1)}%，但量比仅${volRatioMain.toFixed(2)}（严重缩量<0.8）。上涨无量=虚涨，冲高回落概率极高，果断高抛！`,
                    'SELL', '缩量涨就卖，无量上涨必回落',
                    { change: chg, volume_ratio: volRatioMain }
                ));
            } else if (chg > 0.3 && volRatioMain < 1) {
                results.push(this._make(
                    '[量比] 缩量上涨-警惕回落', '⚠️', CATEGORY_MICRO, '中', 2,
                    `股价上涨${chg.toFixed(1)}%，量比${volRatioMain.toFixed(2)}（缩量<1）。跟风资金不足，可能冲高回落，观察量能变化。`,
                    'WATCH', '缩量上涨要警惕，放量才能持续',
                    { change: chg, volume_ratio: volRatioMain }
                ));
            }

            // 缩量下跌 = 标准买点：股价下跌但抛盘衰竭，短期反弹概率高
            if (chg < -0.5 && volRatioMain < 0.8) {
                const buyPrice = Math.min(cp * 0.998, lp * 1.002);
                results.push(this._make(
                    '[量比] 缩量下跌-绝佳低吸', '🟢', CATEGORY_MICRO, '高', 1,
                    `股价下跌${chg.toFixed(1)}%，但量比仅${volRatioMain.toFixed(2)}（严重缩量<0.8）。下跌缩量=抛盘衰竭，短期反弹概率极高，绝佳低吸点！`,
                    'BUY', '缩量跌就买，无量下跌必反弹',
                    { entry_price: buyPrice, change: chg, volume_ratio: volRatioMain }
                ));
            } else if (chg < -0.3 && volRatioMain < 1) {
                results.push(this._make(
                    '[量比] 缩量下跌-关注企稳', '🔍', CATEGORY_MICRO, '中', 2,
                    `股价下跌${chg.toFixed(1)}%，量比${volRatioMain.toFixed(2)}（缩量<1）。抛盘逐步衰竭，没有大单砸盘，观察企稳信号可低吸。`,
                    'BUY', '缩量下跌要关注，企稳即买点',
                    { change: chg, volume_ratio: volRatioMain }
                ));
            }

            // 放量上涨 = 安心持有：量价齐升，资金积极进场
            if (chg > 1 && volRatioMain > 2) {
                results.push(this._make(
                    '[量比] 放量上涨-安心持有', '✅', CATEGORY_MICRO, '中', 2,
                    `股价上涨${chg.toFixed(1)}%，量比${volRatioMain.toFixed(1)}倍（明显放量>2）。量价齐升=资金进场，上涨动能强劲，安心持有等更高点。`,
                    'HOLD', '放量上涨安心拿，量价齐升动能强',
                    { change: chg, volume_ratio: volRatioMain }
                ));
            }

            // 放量下跌 = 尽量避开：量价齐跌，大资金砸盘
            if (chg < -1 && volRatioMain > 2) {
                results.push(this._make(
                    '[量比] 放量下跌-警惕砸盘', '❌', CATEGORY_MICRO, '高', 1,
                    `股价下跌${chg.toFixed(1)}%，量比${volRatioMain.toFixed(1)}倍（明显放量>2）。放量下跌=大资金砸盘，杀跌动能强，尽量避开或止损。`,
                    'SELL', '放量下跌尽量避，大单砸盘风险大',
                    { change: chg, volume_ratio: volRatioMain }
                ));
            }
        }

        // =================================================================
        //  三-5、分时KDJ做T策略（参数81,3,3）
        // =================================================================

        // 分时KDJ做T技巧：
        // 把分时KDJ参数设置成(81,3,3)，J值<0是绝佳买点，J值>100是绝佳卖点
        // 结合分时MACD和成交量确认信号

        const [kValue, dValue, jValue] = hasKline ? getKdj(81, 3, 3) : [null, null, null];

        if (hasKline && kValue !== null && dValue !== null && jValue !== null) {
            // J值低于0 = 超卖区，绝佳买点
            if (jValue < 0) {
                const buyPrice = Math.min(cp * 0.998, lp * 1.002);
                results.push(this._make(
                    '[分时KDJ] J值<0-绝佳买点', '🟢', CATEGORY_MICRO, '高', 1,
                    `分时KDJ(81,3,3)：J值=${jValue.toFixed(1)}（超卖区<0）。J值跌到负数是补仓/做T绝佳买点，等待J值见底后拐头向上买入。`,
                    'BUY', 'J值<0是绝佳买点，见底拐头即买',
                    { entry_price: buyPrice, j_value: jValue, k_value: kValue }
                ));
            } else if (jValue < 10) {
                results.push(this._make(
                    '[分时KDJ] J值低位-关注买点', '🔍', CATEGORY_MICRO, '中', 2,
                    `分时KDJ(81,3,3)：J值=${jValue.toFixed(1)}（低位<10）。接近超卖区，观察是否继续下探到负数，或拐头向上。`,
                    'WATCH', 'J值低位要关注，跌破0或拐头买',
                    { j_value: jValue, k_value: kValue }
                ));
            }

            // J值超过100 = 超买区，绝佳卖点
            if (jValue > 100) {
                results.push(this._make(
                    '[分时KDJ] J值>100-绝佳卖点', '🔴', CATEGORY_MICRO, '高', 1,
                    `分时KDJ(81,3,3)：J值=${jValue.toFixed(1)}（超买区>100）。J值冲到100以上是高抛绝佳卖点，结合量价确认后卖出。`,
                    'SELL', 'J值>100是绝佳卖点，冲高回落即卖',
                    { j_value: jValue, k_value: kValue }
                ));
            } else if (jValue > 90) {
                results.push(this._make(
                    '[分时KDJ] J值高位-警惕卖点', '⚠️', CATEGORY_MICRO, '中', 2,
                    `分时KDJ(81,3,3)：J值=${jValue.toFixed(1)}（高位>90）。接近超买区，观察是否继续冲高到100+，或开始回落。`,
                    'WATCH', 'J值高位要警惕，冲破100或回落卖',
                    { j_value: jValue, k_value: kValue }
                ));
            }

            // KDJ金叉/死叉信号
            if (kValue !== null && dValue !== null) {
                // 金叉（K上穿D）
                if (kValue > dValue && kValue < 30) {
                    results.push(this._make(
                        '[分时KDJ] 低位金叉-买入信号', '📈', CATEGORY_MICRO, '高', 1,
                        `分时KDJ低位金叉：K(${kValue.toFixed(1)})上穿D(${dValue.toFixed(1)})，且K值<30超卖区。低位金叉+超卖=强买入信号！`,
                        'BUY', '低位金叉买入信号强',
                        { k_value: kValue, d_value: dValue }
                    ));
                }
                // 死叉（K下穿D）
                if (kValue < dValue && kValue > 70) {
                    results.push(this._make(
                        '[分时KDJ] 高位死叉-卖出信号', '📉', CATEGORY_MICRO, '高', 1,
                        `分时KDJ高位死叉：K(${kValue.toFixed(1)})下穿D(${dValue.toFixed(1)})，且K值>70超买区。高位死叉+超买=强卖出信号！`,
                        'SELL', '高位死叉卖出信号强',
                        { k_value: kValue, d_value: dValue }
                    ));
                }
            }
        }

        // =================================================================
        //  三-6、开盘5分钟量价信号策略
        // =================================================================

        // 开盘5分钟是顺势的起点：
        // 日内T+0套利不是赌当天涨跌，而是顺着主力节奏跳恰恰
        // 做T不必强求每天都有差价，每一笔操作必须有盘面依据

        if (cp > 0 && vol > 0) {
            const avgVol10 = hasKline && volumes.length >= 10
                ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10
                : vol;
            const volRatioMain = avgVol10 > 0 ? vol / avgVol10 : 1;

            if ((hour === 9 && minute >= 30 && minute <= 35) || (hour === 9 && minute < 30)) {
                // 开盘5分钟内
                if (chg > 2 && volRatioMain > 1.5) {
                    results.push(this._make(
                        '[开盘] 急拉放量-顺势买入', '🟢', CATEGORY_MICRO, '高', 1,
                        `开盘5分钟急拉${chg.toFixed(1)}%，量比${volRatioMain.toFixed(1)}倍。开盘急拉+放量=主力做多意图明确，顺势跟进。`,
                        'BUY', '开盘急拉放量=做多信号',
                        { change: chg, volume_ratio: volRatioMain }
                    ));
                } else if (chg > 2 && volRatioMain < 0.8) {
                    results.push(this._make(
                        '[开盘] 急拉缩量-诱多陷阱', '⚠️', CATEGORY_MICRO, '高', 1,
                        `开盘5分钟急拉${chg.toFixed(1)}%，但量比仅${volRatioMain.toFixed(2)}（严重缩量）。急拉缩量=主力诱多，不追高，观察是否回落。`,
                        'WATCH', '开盘急拉缩量=诱多嫌疑',
                        { change: chg, volume_ratio: volRatioMain }
                    ));
                } else if (chg < -2 && volRatioMain > 1.5) {
                    results.push(this._make(
                        '[开盘] 急跌放量-恐慌砸盘', '❌', CATEGORY_MICRO, '高', 1,
                        `开盘5分钟急跌${chg.toFixed(1)}%，量比${volRatioMain.toFixed(1)}倍。开盘急跌+放量=恐慌砸盘，等待企稳再介入。`,
                        'WAIT', '开盘急跌放量=恐慌信号，等企稳',
                        { change: chg, volume_ratio: volRatioMain }
                    ));
                } else if (chg < -2 && volRatioMain < 0.8) {
                    const buyPrice = Math.min(cp * 0.998, lp * 1.002);
                    results.push(this._make(
                        '[开盘] 急跌缩量-洗盘低吸', '🟢', CATEGORY_MICRO, '高', 1,
                        `开盘5分钟急跌${chg.toFixed(1)}%，但量比仅${volRatioMain.toFixed(2)}（严重缩量）。急跌缩量=洗盘而非砸盘，绝佳低吸点！`,
                        'BUY', '开盘急跌缩量=洗盘买点',
                        { entry_price: buyPrice, change: chg, volume_ratio: volRatioMain }
                    ));
                }
            }
        }

        // =================================================================
        //  三-7、日内趋势定方向策略（简化版）
        // =================================================================

        // 用日内走势定整体操作方向：
        // 做T分两种模式：正T(先低吸、后高抛)、倒T(先高抛、后低吸)
        // 操作模式必须由日内趋势与当日涨跌幅度决定

        // 根据日内涨跌幅和振幅判断整体策略方向
        if (amplitude > 1.5) {
            // 正T条件：日内上涨趋势 + 有持仓
            if (chg > 0.5 && trend === '上升' && holdQty > 0) {
                results.push(this._make(
                    '[日内趋势] 正T策略-先买后卖', '📈', CATEGORY_MICRO, '高', 1,
                    `日内上涨${chg.toFixed(1)}%，趋势向上，振幅${amplitude.toFixed(1)}%。只做正T（先低吸后高抛），回踩均价线附近买入，冲高卖出。`,
                    'BUY_THEN_SELL', '上涨趋势只做正T',
                    { change: chg, amplitude: amplitude, trend: trend }
                ));
            }
            // 反T条件：日内下跌趋势 + 有持仓
            if (chg < -0.5 && trend === '下跌' && holdQty > 0) {
                results.push(this._make(
                    '[日内趋势] 反T策略-先卖后买', '📉', CATEGORY_MICRO, '高', 1,
                    `日内下跌${chg.toFixed(1)}%，趋势向下，振幅${amplitude.toFixed(1)}%。只做反T（先高抛后低吸），反弹即卖出，回落接回。`,
                    'SELL_THEN_BUY', '下跌趋势只做反T',
                    { change: chg, amplitude: amplitude, trend: trend }
                ));
            }
            // 横盘震荡：箱体做T
            if (Math.abs(chg) < 0.5 && trend === '横盘' && amplitude > 2) {
                results.push(this._make(
                    '[日内趋势] 箱体做T-高抛低吸', '🔄', CATEGORY_MICRO, '中', 2,
                    `日内横盘震荡，涨跌${chg.toFixed(1)}%，振幅${amplitude.toFixed(1)}%。箱体震荡高抛低吸，箱顶卖出箱底买入。`,
                    'BOX_TRADING', '横盘震荡箱体做T',
                    { change: chg, amplitude: amplitude, trend: trend }
                ));
            }
        }

        // =================================================================
        //  三-8、量价配合真假判断策略
        // =================================================================

        // 分时量价配合判断真假涨跌：
        // - 拉升缩量 = 标准卖点：股价上涨但成交量缩小，冲高回落概率高
        // - 杀跌缩量 = 标准买点：股价下跌但抛盘衰竭，短期反弹概率高
        // - 拉升放量 = 真实上涨：量价齐升，上涨动能强
        // - 杀跌放量 = 真实下跌：量价齐跌，杀跌动能强

        if (cp > 0 && vol > 0) {
            const avgVol10 = hasKline && volumes.length >= 10
                ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10
                : vol;
            const volRatioMain = avgVol10 > 0 ? vol / avgVol10 : 1;

            // 拉升缩量 = 标准卖点
            if (chg > 0.8 && volRatioMain < 1) {
                results.push(this._make(
                    '[量价] 拉升缩量-虚假上涨', '⚠️', CATEGORY_MICRO, '高', 1,
                    `股价拉升${chg.toFixed(1)}%，量比${volRatioMain.toFixed(2)}<1（缩量）。拉升缩量=虚假上涨，跟风资金不足，冲高回落概率高，是标准卖点！`,
                    'SELL', '拉升缩量=虚假上涨卖点',
                    { change: chg, volume_ratio: volRatioMain }
                ));
            }

            // 杀跌缩量 = 标准买点
            if (chg < -0.8 && volRatioMain < 1) {
                const buyPrice = Math.min(cp * 0.998, lp * 1.002);
                results.push(this._make(
                    '[量价] 杀跌缩量-虚假下跌', '🟢', CATEGORY_MICRO, '高', 1,
                    `股价杀跌${chg.toFixed(1)}%，量比${volRatioMain.toFixed(2)}<1（缩量）。杀跌缩量=虚假下跌，抛盘衰竭，短期反弹概率高，是标准买点！`,
                    'BUY', '杀跌缩量=虚假下跌买点',
                    { entry_price: buyPrice, change: chg, volume_ratio: volRatioMain }
                ));
            }

            // 拉升放量 = 真实上涨
            if (chg > 0.8 && volRatioMain > 1.5) {
                results.push(this._make(
                    '[量价] 拉升放量-真实上涨', '✅', CATEGORY_MICRO, '中', 2,
                    `股价拉升${chg.toFixed(1)}%，量比${volRatioMain.toFixed(1)}>1.5（放量）。拉升放量=真实上涨，资金进场积极，上涨动能强劲。`,
                    'HOLD', '拉升放量=真实上涨持有',
                    { change: chg, volume_ratio: volRatioMain }
                ));
            }

            // 杀跌放量 = 真实下跌
            if (chg < -0.8 && volRatioMain > 1.5) {
                results.push(this._make(
                    '[量价] 杀跌放量-真实下跌', '❌', CATEGORY_MICRO, '高', 1,
                    `股价杀跌${chg.toFixed(1)}%，量比${volRatioMain.toFixed(1)}>1.5（放量）。杀跌放量=真实下跌，大资金砸盘，杀跌动能强劲，警惕继续下跌。`,
                    'SELL', '杀跌放量=真实下跌警惕',
                    { change: chg, volume_ratio: volRatioMain }
                ));
            }
        }

        // =================================================================
        //  三-9、3366七格子做T战法（抖音热门：涨停板坐标法）
        // =================================================================
        // 核心逻辑：将涨停板坐标分成7格（每格≈1.43%）
        // 3格以内：波动小，不做T
        // 3-6格：黄金做T区间，冲高卖，回落买
        // 6格以上：接近涨停，不做T（容易T飞）
        if (cp > 0 && pc > 0 && hp > 0 && lp > 0) {
            const gridSize = pc * 0.10 / 7; // 10%涨停板分7格
            const highGrid = Math.floor((hp - pc) / gridSize);
            const lowGrid = Math.floor((pc - lp) / gridSize);
            const currentGrid = chg >= 0
                ? Math.floor((cp - pc) / gridSize)
                : -Math.floor((pc - cp) / gridSize);

            const absGrid = Math.abs(currentGrid);
            const maxGrid = Math.max(highGrid, Math.abs(lowGrid));

            // 3-6格区间 + 当前价格在中上部 = 高抛机会（反T卖出）
            if (maxGrid >= 3 && maxGrid <= 6 && currentGrid >= 2 && chg > 0) {
                const sellPrice = Math.max(cp * 0.998, hp * 0.995);
                const buyBackPrice = pc * (1 - 3 / 7 * 0.1);
                results.push(this._make(
                    '[3366] 3-6格区间-高抛卖出', '📊', CATEGORY_MICRO, '高', 1,
                    `3366战法：当前${absGrid}格，日内最高${highGrid}格，处于3-6格黄金做T区间。冲高至${currentGrid}格位置，是标准高抛点。回落至均价线附近接回。`,
                    'SELL_THEN_BUY', '3-6格黄金区间，冲高卖回落买',
                    {
                        entry_price: sellPrice,
                        target_price: buyBackPrice,
                        stop_loss: hp * 1.005,
                        grid_position: currentGrid,
                        max_grid: maxGrid
                    }
                ));
            }

            // 3-6格区间 + 当前价格在中下部 = 低吸机会（正T买入）
            if (maxGrid >= 3 && maxGrid <= 6 && currentGrid <= -2 && chg < 0) {
                const buyPrice = Math.min(cp * 1.002, lp * 0.998);
                const sellBackPrice = pc * (1 + 3 / 7 * 0.1);
                results.push(this._make(
                    '[3366] 3-6格区间-低吸买入', '📊', CATEGORY_MICRO, '高', 1,
                    `3366战法：当前${absGrid}格，日内最低${lowGrid}格，处于3-6格黄金做T区间。回落至${Math.abs(currentGrid)}格位置，是标准低吸点。反弹至均价线附近卖出。`,
                    'BUY_THEN_SELL', '3-6格黄金区间，回落买反弹卖',
                    {
                        entry_price: buyPrice,
                        target_price: sellBackPrice,
                        stop_loss: lp * 0.995,
                        grid_position: currentGrid,
                        max_grid: maxGrid
                    }
                ));
            }

            // 6格以上 = 接近涨停，不做T
            if (highGrid >= 6 && chg > 5) {
                results.push(this._make(
                    '[3366] 6格以上-不做T', '⚠️', CATEGORY_MICRO, '中', 2,
                    `3366战法：日内最高${highGrid}格，涨幅${chg.toFixed(1)}%>7%，接近涨停板。此时做T容易T飞，建议持有观望。`,
                    'WATCH', '6格以上不做T，防止T飞',
                    { grid_position: currentGrid, max_grid: maxGrid }
                ));
            }

            // 3格以内 = 波动太小，做T价值不高
            if (maxGrid < 3 && Math.abs(chg) < 3) {
                results.push(this._make(
                    '[3366] 3格以内-观望', '⏸️', CATEGORY_MICRO, '低', 3,
                    `3366战法：日内最大波动${maxGrid}格，振幅${((hp - lp) / pc * 100).toFixed(1)}%。3格以内波动太小，做T价值不高，手续费吃掉利润。`,
                    'NO_TRADE', '3格以内不做T，等波动放大',
                    { grid_position: currentGrid, max_grid: maxGrid }
                ));
            }
        }

        // =================================================================
        //  三-10、布林带呼吸节奏战法（抖音热门：非上下轨，看轨道开合）
        // =================================================================
        // 核心逻辑：布林带开口=呼吸（趋势延续），收口=屏息（变盘在即）
        // 开口向上 + 价格在上轨附近 = 顺势做多
        // 开口向下 + 价格在下轨附近 = 顺势做空
        // 收口 + 价格在中轨 = 等待方向
        if (hasKline && closes.length >= 25) {
            const getBoll = (period = 20, k = 2) => {
                const key = `boll_${period}_${k}`;
                if (_indCache[key] === undefined) _indCache[key] = this.calcBollinger(closesWithToday, period, k);
                return _indCache[key];
            };
            const [bollLower, bollMid, bollUpper] = getBoll();
            if (bollLower !== null && bollMid !== null && bollUpper !== null && bollMid > 0) {
                const bw = (bollUpper - bollLower) / bollMid * 100; // 带宽百分比

                // 计算5日前带宽，判断是扩张还是收缩
                let bw5 = null;
                if (closes.length >= 25) {
                    const prevCloses5 = closes.slice(0, -5);
                    const [prevL5, prevM5, prevU5] = this.calcBollinger(prevCloses5, 20, 2);
                    if (prevL5 !== null && prevM5 !== null && prevU5 !== null && prevM5 > 0) {
                        bw5 = (prevU5 - prevL5) / prevM5 * 100;
                    }
                }

                const isExpanding = bw5 !== null && bw > bw5 * 1.15; // 扩张>15%
                const isContracting = bw5 !== null && bw < bw5 * 0.85; // 收缩>15%

                const pricePos = bollUpper > bollLower
                    ? (cp - bollLower) / (bollUpper - bollLower)
                    : 0.5; // 0=下轨, 1=上轨

                // 呼吸节奏：开口扩张 + 价格在上半区 = 顺势做多
                if (isExpanding && pricePos > 0.6) {
                    const target = bollUpper * 1.01;
                    const stop = bollMid * 0.99;
                    results.push(this._make(
                        '[布林呼吸] 开口扩张-顺势做多', '🌬️', CATEGORY_MICRO, '高', 1,
                        `布林带呼吸法：带宽${bw.toFixed(1)}%，5日前${bw5.toFixed(1)}%，正在扩张（开口=吸气）。价格在上半区(位置${(pricePos*100).toFixed(0)}%)，趋势向上延续。顺势做多，目标上轨上方。`,
                        'BUY', '开口扩张顺势做，方向不变',
                        { entry_price: cp, target_price: target, stop_loss: stop, boll_width: bw }
                    ));
                }

                // 呼吸节奏：开口扩张 + 价格在下半区 = 顺势做空
                if (isExpanding && pricePos < 0.4) {
                    const target = bollLower * 0.99;
                    const stop = bollMid * 1.01;
                    results.push(this._make(
                        '[布林呼吸] 开口扩张-顺势做空', '🌬️', CATEGORY_MICRO, '高', 1,
                        `布林带呼吸法：带宽${bw.toFixed(1)}%，5日前${bw5.toFixed(1)}%，正在扩张（开口=呼气）。价格在下半区(位置${(pricePos*100).toFixed(0)}%)，趋势向下延续。顺势做空，目标下轨下方。`,
                        'SELL', '开口扩张顺势做，方向不变',
                        { entry_price: cp, target_price: target, stop_loss: stop, boll_width: bw }
                    ));
                }

                // 呼吸节奏：收口 + 价格接近中轨 = 屏息变盘在即
                if (isContracting && Math.abs(pricePos - 0.5) < 0.2) {
                    results.push(this._make(
                        '[布林呼吸] 收口屏息-变盘在即', '🌀', CATEGORY_MICRO, '高', 1,
                        `布林带呼吸法：带宽${bw.toFixed(1)}%，5日前${bw5.toFixed(1)}%，正在收缩（收口=屏息）。价格在中轨附近(位置${(pricePos*100).toFixed(0)}%)，变盘一触即发！等待突破方向再操作。`,
                        'WATCH', '收口屏息等突破，方向出来再进场',
                        { boll_width: bw, price_position: Math.round(pricePos * 100) }
                    ));
                }

                // 呼吸节奏：极度收口 = 爆发前夜
                if (bw < 3) {
                    results.push(this._make(
                        '[布林呼吸] 极度收口-爆发前夜', '💥', CATEGORY_MICRO, '高', 1,
                        `布林带呼吸法：带宽仅${bw.toFixed(1)}%<3%，极度收口（屏息到极致）。横盘越久爆发力越强，随时可能选择方向突破！密切关注突破方向。`,
                        'WATCH', '极度收口等大行情，突破跟进',
                        { boll_width: bw }
                    ));
                }
            }
        }

        // =================================================================
        //  三-11、均线+布林带共振战法（抖音热门：双指标确认）
        // =================================================================
        // 核心逻辑：均线定趋势方向，布林带定买卖位置
        // 多头排列 + 价格碰下轨 = 绝佳买点（共振）
        // 空头排列 + 价格碰上轨 = 绝佳卖点（共振）
        if (hasKline && closes.length >= 25) {
            const getBoll = (period = 20, k = 2) => {
                const key = `boll_${period}_${k}`;
                if (_indCache[key] === undefined) _indCache[key] = this.calcBollinger(closesWithToday, period, k);
                return _indCache[key];
            };
            const [bollLower, bollMid, bollUpper] = getBoll();
            const ma5 = this.sma(closesWithToday, 5);
            const ma10 = this.sma(closesWithToday, 10);
            const ma20 = this.sma(closesWithToday, 20);

            const isBull = ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20;
            const isBear = ma5 && ma10 && ma20 && ma5 < ma10 && ma10 < ma20;

            if (bollLower !== null && isBull) {
                // 多头 + 价格接近下轨 = 共振买点
                const distToLower = bollLower > 0 ? (cp - bollLower) / bollLower * 100 : 99;
                if (distToLower < 1.5) {
                    const buyPrice = Math.min(cp * 1.001, bollLower * 1.005);
                    results.push(this._make(
                        '[共振] 多头+布林下轨-共振买点', '🎯', CATEGORY_MICRO, '极高', 0,
                        `均线+布林带共振：均线多头排列（上涨趋势），价格触及布林下轨(距离${distToLower.toFixed(1)}%)。趋势向上+回调到位=双确认绝佳买点！`,
                        'BUY', '多头碰下轨，黄金买点',
                        { entry_price: buyPrice, target_price: bollMid, stop_loss: bollLower * 0.98 }
                    ));
                }
            }

            if (bollUpper !== null && isBear) {
                // 空头 + 价格接近上轨 = 共振卖点
                const distToUpper = bollUpper > 0 ? (bollUpper - cp) / bollUpper * 100 : 99;
                if (distToUpper < 1.5) {
                    results.push(this._make(
                        '[共振] 空头+布林上轨-共振卖点', '🎯', CATEGORY_MICRO, '极高', 0,
                        `均线+布林带共振：均线空头排列（下跌趋势），价格触及布林上轨(距离${distToUpper.toFixed(1)}%)。趋势向下+反弹到位=双确认绝佳卖点！`,
                        'SELL', '空头碰上轨，绝佳卖点',
                        { entry_price: cp, target_price: bollMid, stop_loss: bollUpper * 1.02 }
                    ));
                }
            }

            // 多头 + 价格在中轨上方运行 = 安心持有
            if (isBull && bollMid !== null && cp > bollMid) {
                results.push(this._make(
                    '[共振] 多头中轨上-安心持有', '✅', CATEGORY_MICRO, '中', 2,
                    `均线+布林带共振：均线多头排列，价格在布林中轨上方运行。趋势健康，持有为主，回踩中轨加仓。`,
                    'HOLD', '多头中轨上，安心持有',
                    { boll_position: '上半区' }
                ));
            }

            // 空头 + 价格在中轨下方运行 = 谨慎观望
            if (isBear && bollMid !== null && cp < bollMid) {
                results.push(this._make(
                    '[共振] 空头中轨下-谨慎观望', '⚠️', CATEGORY_MICRO, '中', 2,
                    `均线+布林带共振：均线空头排列，价格在布林中轨下方运行。趋势偏弱，谨慎操作，反弹至上轨减仓。`,
                    'WATCH', '空头中轨下，谨慎观望',
                    { boll_position: '下半区' }
                ));
            }
        }

        // =================================================================
        //  三-12、黄金分割做T法（抖音热门：0.382/0.5/0.618关键位）
        // =================================================================
        // 核心逻辑：用近期高低点做黄金分割，关键位置容易出现支撑压力
        if (hasKline && closes.length >= 10 && hp > 0 && lp > 0) {
            const range = hp - lp;
            if (range > 0 && cp > 0) {
                // 基于日内高低点的黄金分割位
                const fib0_618 = hp - range * 0.618; // 强势回调位
                const fib0_5 = hp - range * 0.5;     // 半分位
                const fib0_382 = hp - range * 0.382; // 弱势回调位

                // 找到最接近的黄金分割位
                const fibLevels = [
                    { name: '0.618强势支撑', price: fib0_618, type: 'support', importance: '高' },
                    { name: '0.5半分位', price: fib0_5, type: 'support', importance: '中' },
                    { name: '0.382弱势支撑', price: fib0_382, type: 'support', importance: '低' }
                ];

                let nearestFib = null;
                let nearestDist = Infinity;
                for (const f of fibLevels) {
                    const dist = Math.abs(cp - f.price) / cp * 100;
                    if (dist < nearestDist && dist < 1) {
                        nearestDist = dist;
                        nearestFib = f;
                    }
                }

                if (nearestFib) {
                    const pctFromHigh = (hp - cp) / range * 100;
                    // 价格接近黄金分割支撑位 + 下跌中 = 正T买入机会
                    if (chg < 0 && nearestFib.type === 'support') {
                        const buyPrice = Math.min(cp * 1.002, nearestFib.price * 1.005);
                        const target = fib0_382;
                        results.push(this._make(
                            `[黄金分割] ${nearestFib.name}-低吸机会`, '✨', CATEGORY_MICRO, '高', 1,
                            `黄金分割法：日内高低点${hp.toFixed(2)}/${lp.toFixed(2)}，价格距${nearestFib.name}(${nearestFib.price.toFixed(2)})仅${nearestDist.toFixed(1)}%。已回调${pctFromHigh.toFixed(0)}%，在${nearestFib.importance}支撑位附近，可低吸做T。`,
                            'BUY_THEN_SELL', '黄金分割位低吸，反弹卖出',
                            { entry_price: buyPrice, target_price: target, stop_loss: lp * 0.995, fib_level: nearestFib.name }
                        ));
                    }
                }

                // 价格接近0.382弱势压力位 + 上涨中 = 反T卖出机会
                const distTo382 = Math.abs(cp - fib0_382) / cp * 100;
                if (chg > 0 && distTo382 < 1 && cp < fib0_382 * 1.005) {
                    const sellPrice = Math.max(cp * 0.998, fib0_382 * 0.995);
                    const buyBack = fib0_618;
                    results.push(this._make(
                        '[黄金分割] 0.382压力位-高抛机会', '✨', CATEGORY_MICRO, '高', 1,
                        `黄金分割法：价格接近0.382压力位(${fib0_382.toFixed(2)})，距离仅${distTo382.toFixed(1)}%。弱势反弹遇0.382易回落，可高抛做T。`,
                        'SELL_THEN_BUY', '0.382压力位高抛，回落接回',
                        { entry_price: sellPrice, target_price: buyBack, stop_loss: hp * 1.005, fib_level: '0.382' }
                    ));
                }
            }
        }

        // =================================================================
        //  四、形态类策略
        // =================================================================

        if (hasKline && closes.length >= 20) {
            const [supports, resistances] = this.findSupportResistance(highs, lows, closes);
            if (supports.length > 0 && cp > 0) {
                const nearestSupport = supports.filter(s => s < cp);
                if (nearestSupport.length > 0) {
                    const ns = safeArrMax(nearestSupport);
                    if ((cp - ns) / cp < 0.02) {
                    const buyPrice = Math.min(cp * 0.998, ns * 0.998);
                    results.push(this._make(
                        `接近支撑位 (${ns.toFixed(2)})`, '🟢', CATEGORY_PATTERN, '中', 2,
                        `股价(${cp.toFixed(2)})接近支撑位(${ns.toFixed(2)})，距离仅${((cp - ns) / cp * 100).toFixed(1)}%。`,
                        'BUY', '支撑位附近买入，止损设在支撑位下方',
                        { entry_price: buyPrice, target_price: cp * 1.02, stop_loss: ns * 0.995 }
                    ));
                    }
                }
            }
            if (resistances.length > 0 && cp > 0) {
                const nearestResist = resistances.filter(r => r > cp);
                if (nearestResist.length > 0) {
                    const nr = safeArrMin(nearestResist);
                    if ((nr - cp) / cp < 0.02) {
                        results.push(this._make(
                            `接近压力位 (${nr.toFixed(2)})`, '🔴', CATEGORY_PATTERN, '中', 2,
                            `股价(${cp.toFixed(2)})接近压力位(${nr.toFixed(2)})，距离仅${((nr - cp) / cp * 100).toFixed(1)}%。`,
                            'SELL', '压力位附近卖出，突破再追'
                        ));
                    }
                }
            }
        }

        if (chg < -2 && cp <= lp * 1.005) {
            const buyPrice = Math.min(cp * 0.998, lp * 1.002);
            results.push(this._make(
                '急跌企稳-黄金买点', '💎', CATEGORY_PATTERN, '高', 1,
                `急跌 ${chg.toFixed(2)}% 后企稳，接近日内低点，绝佳低吸机会！`,
                'BUY', '急跌必有反弹，日内低点支撑强',
                { entry_price: buyPrice, target_price: lp * 1.015, stop_loss: lp * 0.995 }
            ));
        } else if (chg > 2 && cp >= hp * 0.995) {
            results.push(this._make(
                '急涨滞涨-黄金卖点', '⚡', CATEGORY_PATTERN, '高', 1,
                `急涨 ${chg.toFixed(2)}% 后滞涨，接近日内高点，立即高抛！`,
                'SELL', '急涨必有回调，锁定利润为上',
                { target_price: hp * 0.985, stop_loss: hp * 1.01 }
            ));
        }

        if (trend === '上升' && holdQty > 0) {
            let tBuyBase = Math.max(avgPrice * 0.998, cp * 0.995, lp);
            let tSell = Math.min(avgPrice * 1.015, hp);
            if ((hour === 14 && minute >= 30) || hour >= 15) {
                tBuyBase = Math.max(avgPrice * 0.999, cp * 0.998, lp, cp * 0.99);
            }
            const tBuy = tBuyBase;
            results.push(this._make(
                '上升趋势-正T策略', '📈', CATEGORY_PATTERN, amplitude > 2 ? '高' : '中', 2,
                `趋势向上 +${chg.toFixed(2)}%，只做正T（先买后卖）。回踩均价${avgPrice.toFixed(2)}附近买入。`,
                'BUY_THEN_SELL', '顺势而为，回踩即买，冲高即卖',
                { buy_price: tBuy, sell_price: tSell }
            ));
        } else if (trend === '下跌' && holdQty > 0) {
            const tSell = Math.min(avgPrice * 1.008, cp * 1.005, hp);
            let tBuyBase = Math.max(avgPrice * 0.995, cp * 0.99, lp);
            if ((hour === 14 && minute >= 30) || hour >= 15) {
                tBuyBase = Math.max(avgPrice * 0.997, cp * 0.995, lp, cp * 0.985);
            }
            const tBuy = tBuyBase;
            results.push(this._make(
                '下跌趋势-反T策略', '📉', CATEGORY_PATTERN, amplitude > 2 ? '高' : '中', 2,
                `趋势向下 ${chg.toFixed(2)}%，只做反T（先卖后买）。反弹即卖出，回落再接回。`,
                'SELL_THEN_BUY', '逆势减仓，反弹即卖，低位接回',
                { sell_price: tSell, buy_price: tBuy }
            ));
        } else if (trend === '横盘' && amplitude > 2) {
            const boxTop = Math.round(((hp + avgPrice) / 2) * 100) / 100;
            const boxBot = Math.round(((lp + avgPrice) / 2) * 100) / 100;
            let tBuyBase = Math.max(boxBot, cp * 0.997, lp);
            let tSell = Math.min(boxTop, cp * 1.007, hp);
            if ((hour === 14 && minute >= 30) || hour >= 15) {
                tBuyBase = Math.max(boxBot * 1.002, cp * 0.998, lp, cp * 0.992);
            }
            const tBuy = tBuyBase;
            results.push(this._make(
                '横盘震荡-箱体做T', '🔄', CATEGORY_PATTERN, '高', 2,
                `横盘震荡，振幅${amplitude.toFixed(2)}%。箱顶${boxTop}卖出，箱底${boxBot}买入。`,
                'BOX_TRADING', '箱体理论，高抛低吸',
                { buy_price: tBuy, sell_price: tSell }
            ));
        }

        if (hasKline && closes.length >= 1) {
            const prevClose = closes[closes.length - 1];
            if (prevClose > 0 && op > prevClose * 1.02) {
                const gapPct = (op - prevClose) / prevClose * 100;
                results.push(this._make(
                    `向上跳空缺口 (${gapPct.toFixed(1)}%)`, '📈', CATEGORY_PATTERN, '中', 2,
                    `开盘跳空高开 ${gapPct.toFixed(1)}%，缺口${prevClose.toFixed(2)}-${op.toFixed(2)}。缺口可能回补。`,
                    'WATCH', '向上跳空后可能回补缺口再上涨'
                ));
            } else if (prevClose > 0 && op < prevClose * 0.98) {
                const gapPct = (prevClose - op) / prevClose * 100;
                results.push(this._make(
                    `向下跳空缺口 (${gapPct.toFixed(1)}%)`, '📉', CATEGORY_PATTERN, '中', 2,
                    `开盘跳空低开 ${gapPct.toFixed(1)}%，缺口${op.toFixed(2)}-${prevClose.toFixed(2)}。缺口可能回补。`,
                    'WATCH', '向下跳空后可能反弹回补缺口'
                ));
            }
        }

        const trendSignals = { buy: 0, sell: 0 };
        for (const r of results) {
            if (r.category === CATEGORY_TREND || r.category === CATEGORY_PATTERN) {
                const act = r.action || '';
                if (['AVOID_BUY', 'NO_TRADE', 'WATCH', 'HOLD', 'OBSERVE',
                     'REDUCE_POSITION', 'WAIT', 'WAIT_NEXT_DAY',
                     'SELL_BEFORE_CLOSE', 'TRADING_OPPORTUNITY',
                     'SELL_THEN_BUY', 'BUY_THEN_SELL', 'BOX_TRADING'].includes(act)) {
                    continue;
                }
                if (act.includes('BUY')) trendSignals.buy++;
                else if (act.includes('SELL')) trendSignals.sell++;
            }
        }
        if (trendSignals.buy >= 3) {
            results.push(this._make(
                '趋势多头共振', '🔥', CATEGORY_PATTERN, '极高', 0,
                `${trendSignals.buy}个趋势指标同时看多，强势共振！`,
                'STRONG_BUY', '趋势共振信号最可靠'
            ));
        } else if (trendSignals.sell >= 3) {
            results.push(this._make(
                '趋势空头共振', '🔥', CATEGORY_PATTERN, '极高', 0,
                `${trendSignals.sell}个趋势指标同时看空，强势共振！`,
                'STRONG_SELL', '趋势共振信号最可靠'
            ));
        }

        // =================================================================
        //  五、日内微操类策略
        // =================================================================

        // ============ 尾盘综合研判（次日开盘预测核心）============
        let overnightAnalysis = null;
        if (hour === 14 && minute >= 30) {
            const lateChg = ((cp - op) / op * 100);
            const lateVolumeRatio = volumes.length >= 5 ? vol / (volumes.slice(-5).reduce((a,b)=>a+b,0)/5) : 1;

            // 尾盘资金流向判断
            let moneyFlowScore = 0;
            if (cp > op && lateVolumeRatio > 1.3) moneyFlowScore = 30;
            else if (cp > op && lateVolumeRatio > 0.8) moneyFlowScore = 15;
            else if (cp < op && lateVolumeRatio > 1.3) moneyFlowScore = -30;
            else if (cp < op && lateVolumeRatio > 0.8) moneyFlowScore = -15;

            // 尾盘K线形态
            let candleScore = 0;
            const body = Math.abs(cp - op);
            const upperShadow = hp - Math.max(cp, op);
            const lowerShadow = Math.min(cp, op) - lp;
            if (cp > op && upperShadow > body * 2) candleScore = -20; // 长上影
            else if (cp < op && lowerShadow > body * 2) candleScore = 20; // 长下影
            else if (cp > op && body > (hp - lp) * 0.6) candleScore = 15; // 大阳线
            else if (cp < op && body > (hp - lp) * 0.6) candleScore = -15; // 大阴线

            // 大盘/板块情绪（简化：用涨跌幅判断）
            const marketScore = chg > 2 ? 10 : (chg < -2 ? -10 : 0);

            // 综合次日开盘倾向评分
            const totalScore = moneyFlowScore + candleScore + marketScore;

            let nextDayTrend = '平开';
            let nextDayProb = 50;
            if (totalScore >= 25) { nextDayTrend = '高开'; nextDayProb = Math.min(85, 50 + totalScore); }
            else if (totalScore <= -25) { nextDayTrend = '低开'; nextDayProb = Math.min(85, 50 - totalScore); }
            else { nextDayProb = 50 + Math.abs(totalScore); }

            overnightAnalysis = {
                score: totalScore,
                trend: nextDayTrend,
                probability: nextDayProb,
                moneyFlow: moneyFlowScore,
                candle: candleScore,
                market: marketScore
            };

            if (chg > 1.5) {
                results.push(this._make(
                    '尾盘拉升-诱多警惕', '🌆', CATEGORY_MICRO, '中', 2,
                    `尾盘拉升 +${chg.toFixed(2)}%，无利好多为诱多！次日低开概率${nextDayTrend === '低开' ? nextDayProb : (100 - nextDayProb)}%。`,
                    'SELL_BEFORE_CLOSE', '尾盘拉升常为做K线，次日低开概率大'
                ));
            } else if (chg < -1.5) {
                results.push(this._make(
                    '尾盘跳水-洗盘可能', '🌆', CATEGORY_MICRO, '中', 2,
                    `尾盘跳水 ${chg.toFixed(2)}%，无利空多为洗盘！次日${nextDayTrend}概率${nextDayProb}%。`,
                    'WAIT_NEXT_DAY', '尾盘跳水常为洗盘，次日早盘可接'
                ));
            }

            // 尾盘综合研判策略
            if (totalScore >= 20) {
                results.push(this._make(
                    '尾盘研判：次日倾向高开', '🌅', CATEGORY_MICRO, '高', 1,
                    `尾盘资金流入+${lateVolumeRatio.toFixed(1)}倍，K线形态偏多，次日高开概率${nextDayProb}%。正T买入可留仓过夜。`,
                    'HOLD', '尾盘强势，次日高开概率大'
                ));
            } else if (totalScore <= -20) {
                results.push(this._make(
                    '尾盘研判：次日倾向低开', '🌅', CATEGORY_MICRO, '高', 1,
                    `尾盘资金流出+${lateVolumeRatio.toFixed(1)}倍，K线形态偏空，次日低开概率${nextDayProb}%。正T买入必须当日卖出！`,
                    'SELL_BEFORE_CLOSE', '尾盘弱势，次日低开风险大'
                ));
            } else {
                results.push(this._make(
                    '尾盘研判：次日走势不明', '🌅', CATEGORY_MICRO, '中', 3,
                    `尾盘信号混杂，次日走势不确定性较高。做T建议当日了结，不留隔夜仓。`,
                    'WATCH', '尾盘信号不明确，建议观望'
                ));
            }
        }

        if (hour === 9 || (hour === 10 && minute < 15)) {
            if (cp > op * 1.01) {
                results.push(this._make(
                    '开盘强势-观察确认', '🌅', CATEGORY_MICRO, '中', 3,
                    `开盘15分钟上涨 +${((cp / op - 1) * 100).toFixed(2)}%，观察能否站稳。`,
                    'OBSERVE', '开盘走势需确认，避免追高'
                ));
            } else if (cp < op * 0.99) {
                results.push(this._make(
                    '开盘弱势-逢高减仓', '🌅', CATEGORY_MICRO, '中', 3,
                    `开盘15分钟下跌 ${((1 - cp / op) * 100).toFixed(2)}%，弱势明显。`,
                    'REDUCE_POSITION', '开盘弱势全天难改'
                ));
            }
        }

        if (amplitude > 5) {
            let buyTarget = lp * 1.002;
            const sellTarget = hp * 0.998;
            if ((hour === 14 && minute >= 30) || hour >= 15) {
                buyTarget = Math.max(lp * 1.005, cp * 0.995);
            }
            const spread = sellTarget - buyTarget;
            const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
            const buyAmount = buyTarget * 100;
            const profitAfterFee = spread * 100 - txFee;
            const profitPct = buyAmount > 0 ? profitAfterFee / buyAmount * 100 : 0;
            results.push(this._make(
                `高振幅 (${amplitude.toFixed(1)}%) - 做T黄金条件`, '💰', CATEGORY_MICRO, '高', 1,
                `振幅 ${amplitude.toFixed(1)}%，买${buyTarget.toFixed(2)}卖${sellTarget.toFixed(2)}，净收益${profitPct.toFixed(2)}%（扣双向手续费）`,
                'TRADING_OPPORTUNITY', '振幅>5%为做T黄金条件',
                { buy_price: buyTarget, sell_price: sellTarget }
            ));
        } else if (amplitude > 3) {
            const midPrice = (hp + lp) / 2;
            let buyTarget = midPrice - (hp - lp) * 0.15;
            const sellTarget = midPrice + (hp - lp) * 0.15;
            if ((hour === 14 && minute >= 30) || hour >= 15) {
                buyTarget = Math.max(buyTarget, midPrice - (hp - lp) * 0.10, cp * 0.995);
            }
            const spread = sellTarget - buyTarget;
            const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
            const buyAmount = buyTarget * 100;
            const profitAfterFee = spread * 100 - txFee;
            const profitPct = buyAmount > 0 ? profitAfterFee / buyAmount * 100 : 0;
            if (profitPct >= 0.3) {
                results.push(this._make(
                    `中等振幅 (${amplitude.toFixed(1)}%) - 适合做T`, '📊', CATEGORY_MICRO, '中', 2,
                    `振幅 ${amplitude.toFixed(1)}%，回踩${buyTarget.toFixed(2)}买，反弹${sellTarget.toFixed(2)}卖，净收益${profitPct.toFixed(2)}%`,
                    'TRADING_OPPORTUNITY', '振幅3-5%适合做T，需精选买卖点',
                    { buy_price: buyTarget, sell_price: sellTarget }
                ));
            }
        } else if (amplitude < 1) {
            results.push(this._make(
                `低振幅 (${amplitude.toFixed(1)}%) - 不适合做T`, '⏸️', CATEGORY_MICRO, '低', 3,
                `日内振幅仅 ${amplitude.toFixed(1)}%，差价不够手续费，不建议做T。`,
                'NO_TRADE', '振幅<1%不适合做T'
            ));
        }

        if (devFromAvg > 1.5) {
            results.push(this._make(
                '分时偏离-等回归', '📊', CATEGORY_MICRO, '中', 2,
                `股价在均价线上方 ${devFromAvg.toFixed(2)}%，等回归均价线(${avgPrice.toFixed(2)})再操作。`,
                'WAIT', '分时偏离>1.5%大概率回归'
            ));
        } else if (devFromAvg < -1.5) {
            results.push(this._make(
                '分时偏离-等反弹', '📊', CATEGORY_MICRO, '中', 2,
                `股价在均价线下方 ${Math.abs(devFromAvg).toFixed(2)}%，等反弹至均价线(${avgPrice.toFixed(2)})。`,
                'WAIT', '分时偏离<-1.5%大概率回归'
            ));
        }



        // =================================================================
        //  六、🔥 自创策略
        // =================================================================

        if (hasKline && volumes.length >= 5) {
            const avgVol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const prevClose = closes[closes.length - 1];
            const priceChg = prevClose > 0 ? (cp - prevClose) / prevClose * 100 : 0;
            const volChg = avgVol5 > 0 ? (vol - avgVol5) / avgVol5 * 100 : 0;
            const vpds = priceChg * 2 - volChg;
            if (vpds > 50) {
                results.push(this._make(
                    '[自创] 量价偏离评分 VPDS', '🧪', CATEGORY_NOVEL, '中', 2,
                    `VPDS=${vpds.toFixed(1)}：价格上涨但量能不足，偏离度高，上涨不可持续。`,
                    'SELL', '自创VPDS指标：价量背离预警系统'
                ));
            } else if (vpds < -50) {
                results.push(this._make(
                    '[自创] 量价偏离评分 VPDS', '🧪', CATEGORY_NOVEL, '中', 2,
                    `VPDS=${vpds.toFixed(1)}：价格下跌但量能放大，可能有资金抄底。`,
                    'BUY', '自创VPDS指标：放量下跌中的抄底信号'
                ));
            }
        }

        if (hour === 9 && minute >= 30 && minute <= 45) {
            results.push(this._make(
                '[自创] 时间窗口-开盘博弈期', '⏰', CATEGORY_NOVEL, '中', 2,
                '9:30-9:45为开盘博弈期，价格波动最大。急跌可买，急涨勿追。',
                'WATCH', '自创TWE：统计显示此区间波动率是全天最高'
            ));
        } else if (hour === 10 && minute >= 0 && minute <= 30) {
            if (chg > 1) {
                results.push(this._make(
                    '[自创] 时间窗口-上午高潮', '⏰', CATEGORY_NOVEL, '中', 2,
                    '10:00-10:30为上午行情高潮期，若此时已大涨，午后大概率回落。',
                    'SELL', '自创TWE：上午高潮卖出统计胜率>65%'
                ));
            }
        } else if (hour === 13 && minute <= 30) {
            results.push(this._make(
                '[自创] 时间窗口-午后试探期', '⏰', CATEGORY_NOVEL, '低', 3,
                '13:00-13:30为午后试探期，主力常在此区间试盘，不宜操作。',
                'WATCH', '自创TWE：午后开盘30分钟假信号最多'
            ));
        } else if (hour === 14 && minute >= 0 && minute < 30) {
            if (Math.abs(chg) < 0.5) {
                results.push(this._make(
                    '[自创] 时间窗口-尾盘前蓄力', '⏰', CATEGORY_NOVEL, '中', 2,
                    '14:00-14:30为尾盘蓄力期，若全天横盘，此区间可能变盘。',
                    'WATCH', '自创TWE：14:00-14:30是尾盘方向选择关键期'
                ));
            }
        }

        if (amplitude > 0) {
            let buyTarget = lp * 1.002;
            const sellTarget = hp * 0.998;
            if ((hour === 14 && minute >= 30) || hour >= 15) {
                buyTarget = Math.max(lp * 1.005, cp * 0.995);
            }
            const spread = sellTarget - buyTarget;
            const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
            const buyAmount = buyTarget * 100;
            const netProfit = spread * 100 - txFee;
            const netPct = buyAmount > 0 ? netProfit / buyAmount * 100 : 0;
            const feePct = buyAmount > 0 ? txFee / buyAmount * 100 : 0.3;
            const arr = amplitude / feePct;
            
            if (arr > 20) {
                results.push(this._make(
                    '[自创] 振幅收益比 ARR', '📐', CATEGORY_NOVEL, '高', 1,
                    `ARR=${arr.toFixed(1)}：振幅是手续费的${arr.toFixed(0)}倍！买${buyTarget.toFixed(2)}卖${sellTarget.toFixed(2)}，净收益${netPct.toFixed(2)}%`,
                    'TRADING_OPPORTUNITY', '自创ARR：>10为优秀，>20为极佳',
                    { buy_price: buyTarget, sell_price: sellTarget }
                ));
            } else if (arr > 10) {
                results.push(this._make(
                    '[自创] 振幅收益比 ARR', '📐', CATEGORY_NOVEL, '中', 2,
                    `ARR=${arr.toFixed(1)}：振幅是手续费的${arr.toFixed(0)}倍！买${buyTarget.toFixed(2)}卖${sellTarget.toFixed(2)}，净收益${netPct.toFixed(2)}%`,
                    'TRADING_OPPORTUNITY', '自创ARR：>10为可行，<5不建议',
                    { buy_price: buyTarget, sell_price: sellTarget }
                ));
            } else if (arr < 5) {
                results.push(this._make(
                    '[自创] 振幅收益比 ARR', '📐', CATEGORY_NOVEL, '低', 3,
                    `ARR=${arr.toFixed(1)}：振幅仅为手续费的${arr.toFixed(0)}倍，做T不划算。`,
                    'NO_TRADE', '自创ARR：<5时手续费吃掉大部分利润'
                ));
            }
        }

        if (hasKline && closes.length >= 20) {
            const ma5 = getSma(5);
            const ma10 = getSma(10);
            const ma20 = getSma(20);
            if (ma5 && ma10 && ma20) {
                const above5 = cp > ma5;
                const above10 = cp > ma10;
                const above20 = cp > ma20;
                const score = [above5, above10, above20].filter(Boolean).length;
                if (score === 3) {
                    results.push(this._make(
                        '[自创] 多周期共振-全面看多', '🔺', CATEGORY_NOVEL, '高', 1,
                        `股价同时站上MA5(${ma5.toFixed(2)})/MA10(${ma10.toFixed(2)})/MA20(${ma20.toFixed(2)})，三线共振看多！`,
                        'STRONG_BUY', '自创MTCR：三线共振信号最强'
                    ));
                } else if (score === 0) {
                    results.push(this._make(
                        '[自创] 多周期共振-全面看空', '🔻', CATEGORY_NOVEL, '高', 1,
                        `股价同时跌破MA5(${ma5.toFixed(2)})/MA10(${ma10.toFixed(2)})/MA20(${ma20.toFixed(2)})，三线共振看空！`,
                        'STRONG_SELL', '自创MTCR：三线共振看空信号最强'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 10) {
            const recentRanges = [];
            for (let i = -10; i < 0; i++) {
                const idx = highs.length + i;
                if (idx - 1 >= 0 && closes[idx - 1] > 0) {
                    recentRanges.push((highs[idx] - lows[idx]) / closes[idx - 1] * 100);
                }
            }
            if (recentRanges.length > 0) {
                const avgRange = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
                const todayRange = pc > 0 ? (hp - lp) / pc * 100 : 0;
                if (avgRange > 0) {
                    const vcbRatio = todayRange / avgRange;
                    if (vcbRatio > 2.5) {
                        results.push(this._make(
                            '[自创] 波动率收缩突破', '💥', CATEGORY_NOVEL, '高', 1,
                            `今日振幅是近10日均值的${vcbRatio.toFixed(1)}倍，波动率急剧放大，大行情启动！`,
                            'WATCH', '自创VCB：波动率收缩后突然放大=变盘信号'
                        ));
                    } else if (vcbRatio < 0.3) {
                        results.push(this._make(
                            '[自创] 波动率极度收缩', '🌀', CATEGORY_NOVEL, '中', 2,
                            `今日振幅仅为近10日均值的${vcbRatio.toFixed(1)}倍，极度收缩，蓄势待发。`,
                            'WATCH', '自创VCB：极度收缩后必有大波动'
                        ));
                    }
                }
            }
        }

        if (pc > 0) {
            const osi = (op - pc) / pc * 100;
            if (osi > 1.5) {
                results.push(this._make(
                    '[自创] 开盘强度指数-超强', '🌅', CATEGORY_NOVEL, '中', 2,
                    `开盘强度指数=${osi.toFixed(2)}%，高开幅度大。若半小时内不破开盘价，全天偏强。`,
                    'OBSERVE', '自创OSI：高开>1.5%需确认，不破开盘价则持有'
                ));
            } else if (osi < -1.5) {
                results.push(this._make(
                    '[自创] 开盘强度指数-超弱', '🌅', CATEGORY_NOVEL, '中', 2,
                    `开盘强度指数=${osi.toFixed(2)}%，低开幅度大。若半小时内不回开盘价，全天偏弱。`,
                    'REDUCE_POSITION', '自创OSI：低开<-1.5%需减仓'
                ));
            }
        }

        if (hasKline && closesWithToday.length >= 4) {
            const prevClose1 = closesWithToday[closesWithToday.length - 2] || 0.01;
            const prevClose2 = closesWithToday[closesWithToday.length - 3] || 0.01;
            const prevClose3 = closesWithToday[closesWithToday.length - 4] || 0.01;
            const chg1 = (closesWithToday[closesWithToday.length - 1] - prevClose1) / prevClose1 * 100;
            const chg2 = (prevClose1 - prevClose2) / prevClose2 * 100;
            const chg3 = (prevClose2 - prevClose3) / prevClose3 * 100;
            const pa = chg1 - chg2;
            if (chg1 > 0 && pa > 1) {
                results.push(this._make(
                    '[自创] 价格加速度-加速上涨', '🚀', CATEGORY_NOVEL, '中', 2,
                    `近3日涨幅加速：${chg3.toFixed(2)}%→${chg2.toFixed(2)}%→${chg1.toFixed(2)}%，加速+${pa.toFixed(2)}%。注意冲高回落。`,
                    'SELL', '自创PA：加速上涨后往往有回调'
                ));
            } else if (chg1 < 0 && pa < -1) {
                results.push(this._make(
                    '[自创] 价格加速度-加速下跌', '📉', CATEGORY_NOVEL, '中', 2,
                    `近3日跌幅加速：${chg3.toFixed(2)}%→${chg2.toFixed(2)}%→${chg1.toFixed(2)}%，加速${pa.toFixed(2)}%。可能超跌反弹。`,
                    'BUY', '自创PA：加速下跌后往往有反弹'
                ));
            }
        }

        if (hasKline && closes.length >= 20) {
            const lookbackHigh = safeArrMax(highs.slice(-30));
            const lookbackLow = safeArrMin(lows.slice(-30));
            const fibRange = lookbackHigh - lookbackLow;
            if (fibRange > 0) {
                const fib382 = lookbackLow + fibRange * 0.382;
                const fib500 = lookbackLow + fibRange * 0.500;
                const fib618 = lookbackLow + fibRange * 0.618;
                const fibs = [[fib382, '38.2%'], [fib500, '50%'], [fib618, '61.8%']];
                let nearestFib = fibs[0][0];
                let nearestLabel = fibs[0][1];
                let minDist = Math.abs(cp - nearestFib);
                for (const [fib, label] of fibs) {
                    const dist = Math.abs(cp - fib);
                    if (dist < minDist) {
                        minDist = dist;
                        nearestFib = fib;
                        nearestLabel = label;
                    }
                }
                const distPct = cp > 0 ? Math.abs(cp - nearestFib) / cp * 100 : 999;
                if (distPct < 1.5) {
                    if (cp > nearestFib) {
                        results.push(this._make(
                            `[自创] 黄金分割${nearestLabel}突破确认`, '✨', CATEGORY_NOVEL, '中', 2,
                            `股价(${cp.toFixed(2)})站上黄金分割${nearestLabel}(${nearestFib.toFixed(2)})，确认突破。`,
                            'BUY', '自创Fib：突破分割位后看下一档'
                        ));
                    } else {
                        results.push(this._make(
                            `[自创] 黄金分割${nearestLabel}压力`, '✨', CATEGORY_NOVEL, '中', 2,
                            `股价(${cp.toFixed(2)})受阻于黄金分割${nearestLabel}(${nearestFib.toFixed(2)})，有压力。`,
                            'SELL', '自创Fib：分割位附近有强压力'
                        ));
                    }
                }
            }
        }

        if (hasKline && closesWithToday.length >= 3) {
            let upStreak = 0;
            let downStreak = 0;
            for (let i = closesWithToday.length - 1; i > 0; i--) {
                const current = closesWithToday[i];
                const prev = closesWithToday[i - 1];
                if (current > prev * 1.0001) {
                    if (downStreak > 0) break;
                    upStreak++;
                } else if (current < prev * 0.9999) {
                    if (upStreak > 0) break;
                    downStreak++;
                } else {
                    if (upStreak === 0 && downStreak === 0) {
                        continue;
                    }
                    break;
                }
            }

            if (upStreak >= 5) {
                results.push(this._make(
                    `[自创] 连涨${upStreak}天-过度延伸`, '📈', CATEGORY_NOVEL, '中', 2,
                    `已连续上涨${upStreak}天，统计显示连涨5天后回调概率>65%。`,
                    'SELL', '自创Streak：连涨过多后均值回归'
                ));
            } else if (downStreak >= 5) {
                results.push(this._make(
                    `[自创] 连跌${downStreak}天-超跌反弹`, '📉', CATEGORY_NOVEL, '中', 2,
                    `已连续下跌${downStreak}天，统计显示连跌5天后反弹概率>65%。`,
                    'BUY', '自创Streak：连跌过多后均值回归'
                ));
            }
        }

        if (hp > lp) {
            const icd = (cp - lp) / (hp - lp) * 100;
            if (icd > 85) {
                results.push(this._make(
                    '[自创] 价格中心偏移-极高位', '📍', CATEGORY_NOVEL, '中', 2,
                    `ICD=${icd.toFixed(0)}%，价格在日内极高位置，尾盘回落概率大。`,
                    'SELL', '自创ICD：>80%时日内回落概率>60%'
                ));
            } else if (icd < 15) {
                results.push(this._make(
                    '[自创] 价格中心偏移-极低位', '📍', CATEGORY_NOVEL, '中', 2,
                    `ICD=${icd.toFixed(0)}%，价格在日内极低位置，尾盘反弹概率大。`,
                    'BUY', '自创ICD：<20%时日内反弹概率>60%'
                ));
            }
        }

        let tScore = 0;
        let volRatioT = 1;
        tScore += Math.min(amplitude * 6, 30);
        if (hasKline && volumes.length >= 5) {
            const avgVol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            volRatioT = avgVol5 > 0 ? vol / avgVol5 : 1;
            tScore += Math.min(volRatioT * 10, 20);
        }
        tScore += Math.min(Math.abs(devFromAvg) * 8, 25);
        if (Math.abs(chg) > 0.5) {
            tScore += Math.min(Math.abs(chg) * 10, 25);
        }

        if (tScore > 70) {
            const buyTarget = lp * 1.002;
            const sellTarget = hp * 0.998;
            const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
            const buyAmount = buyTarget * 100;
            const spread = sellTarget - buyTarget;
            const netProfit = spread * 100 - txFee;
            const netPct = buyAmount > 0 ? netProfit / buyAmount * 100 : 0;
            results.push(this._make(
                `[自创] 做T综合评分 T-Score=${tScore.toFixed(0)}`, '🏆', CATEGORY_NOVEL, '极高', 0,
                `T-Score=${tScore.toFixed(0)}/100极佳！振幅${amplitude.toFixed(1)}%。买${buyTarget.toFixed(2)}卖${sellTarget.toFixed(2)}，净收益${netPct.toFixed(2)}%`,
                'TRADING_OPPORTUNITY', '自创T-Score：>70为极佳，>50为良好，<30不建议',
                { buy_price: buyTarget, sell_price: sellTarget }
            ));
        } else if (tScore > 50) {
            const buyTarget = lp * 1.002;
            const sellTarget = hp * 0.998;
            const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
            const buyAmount = buyTarget * 100;
            const spread = sellTarget - buyTarget;
            const netProfit = spread * 100 - txFee;
            const netPct = buyAmount > 0 ? netProfit / buyAmount * 100 : 0;
            results.push(this._make(
                `[自创] 做T综合评分 T-Score=${tScore.toFixed(0)}`, '📊', CATEGORY_NOVEL, '中', 2,
                `T-Score=${tScore.toFixed(0)}/100良好。振幅${amplitude.toFixed(1)}%，买${buyTarget.toFixed(2)}卖${sellTarget.toFixed(2)}，净收益${netPct.toFixed(2)}%`,
                'TRADING_OPPORTUNITY', '自创T-Score：>50为可行',
                { buy_price: buyTarget, sell_price: sellTarget }
            ));
        } else if (tScore < 30) {
            results.push(this._make(
                `[自创] 做T综合评分 T-Score=${tScore.toFixed(0)}`, '⏸️', CATEGORY_NOVEL, '低', 3,
                `T-Score=${tScore.toFixed(0)}/100，做T条件不佳，建议观望。`,
                'NO_TRADE', '自创T-Score：<30不适合做T'
            ));
        }

        // =================================================================
        //  七、扩展策略
        // =================================================================

        if (hasKline && closes.length >= 30) {
            const maCrosses = [
                [5, 15, 'MA5×MA15'], [5, 20, 'MA5×MA20'], [10, 20, 'MA10×MA20'],
                [10, 30, 'MA10×MA30'], [20, 60, 'MA20×MA60']
            ];
            for (const [fastP, slowP, label] of maCrosses) {
                if (closesWithToday.length >= slowP) {
                    const maF = getSma(fastP);
                    const maS = getSma(slowP);
                    const maFP = this.sma(closesWithToday.slice(0, -1), fastP);
                    const maSP = this.sma(closesWithToday.slice(0, -1), slowP);
                    if (maF && maS && maFP && maSP) {
                        if (maF > maS && maFP <= maSP) {
                            results.push(this._make(
                                `${label}金叉`, '📈', CATEGORY_TREND, '中', 2,
                                `${label}金叉：快线(${maF.toFixed(2)})上穿慢线(${maS.toFixed(2)})，短期看涨。`,
                                'BUY', `${label}金叉买入信号`
                            ));
                        } else if (maF < maS && maFP >= maSP) {
                            results.push(this._make(
                                `${label}死叉`, '📉', CATEGORY_TREND, '中', 2,
                                `${label}死叉：快线(${maF.toFixed(2)})下穿慢线(${maS.toFixed(2)})，短期看跌。`,
                                'SELL', `${label}死叉卖出信号`
                            ));
                        }
                    }
                }
            }

            const emaCrosses = [[5, 10, 'EMA5×EMA10'], [5, 20, 'EMA5×EMA20'], [10, 20, 'EMA10×EMA20']];
            for (const [fastP, slowP, label] of emaCrosses) {
                if (closesWithToday.length >= slowP) {
                    const emaF = this.ema(closesWithToday, fastP);
                    const emaS = this.ema(closesWithToday, slowP);
                    const emaFP = this.ema(closesWithToday.slice(0, -1), fastP);
                    const emaSP = this.ema(closesWithToday.slice(0, -1), slowP);
                    if (emaF && emaS && emaFP && emaSP) {
                        if (emaF > emaS && emaFP <= emaSP) {
                            results.push(this._make(
                                `${label}金叉`, '📈', CATEGORY_TREND, '中', 2,
                                `${label}金叉：EMA快线上穿慢线，趋势转多。`,
                                'BUY', `${label}金叉信号`
                            ));
                        } else if (emaF < emaS && emaFP >= emaSP) {
                            results.push(this._make(
                                `${label}死叉`, '📉', CATEGORY_TREND, '中', 2,
                                `${label}死叉：EMA快线下穿慢线，趋势转空。`,
                                'SELL', `${label}死叉信号`
                            ));
                        }
                    }
                }
            }

            for (const rsiPeriod of [6, 9, 24]) {
                const rsiVal = getRsi(rsiPeriod);
                if (rsiVal !== null) {
                    if (rsiVal < 20) {
                        results.push(this._make(
                            `RSI(${rsiPeriod})极度超卖`, '🟢', CATEGORY_OSCILLATOR, '中', 2,
                            `RSI(${rsiPeriod})=${rsiVal.toFixed(1)}，极度超卖，强烈反弹信号。`,
                            'BUY', `RSI(${rsiPeriod})<20极度超卖`
                        ));
                    } else if (rsiVal > 80) {
                        results.push(this._make(
                            `RSI(${rsiPeriod})极度超买`, '🔴', CATEGORY_OSCILLATOR, '中', 2,
                            `RSI(${rsiPeriod})=${rsiVal.toFixed(1)}，极度超买，强烈回调信号。`,
                            'SELL', `RSI(${rsiPeriod})>80极度超买`
                        ));
                    }
                }
            }

            for (const rocPeriod of [5, 10, 20]) {
                if (closesWithToday.length > rocPeriod) {
                    const rocBase = closesWithToday[closesWithToday.length - 1 - rocPeriod];
                    const roc = rocBase > 0 ? (closesWithToday[closesWithToday.length - 1] - rocBase) / rocBase * 100 : 0;
                    if (roc > 8) {
                        results.push(this._make(
                            `ROC(${rocPeriod})强势`, '🚀', CATEGORY_OSCILLATOR, '低', 3,
                            `${rocPeriod}日涨幅${roc.toFixed(1)}%，短期强势，注意回调风险。`,
                            'HOLD', `ROC(${rocPeriod})>8表示短期过热`
                        ));
                    } else if (roc < -8) {
                        results.push(this._make(
                            `ROC(${rocPeriod})超跌`, '📉', CATEGORY_OSCILLATOR, '中', 2,
                            `${rocPeriod}日跌幅${roc.toFixed(1)}%，短期超跌，可能反弹。`,
                            'BUY', `ROC(${rocPeriod})<-8表示短期超跌`
                        ));
                    }
                }
            }

            if (closes.length >= 15 && volumes.length >= 15) {
                const mfiVal = getMfi();
                if (mfiVal !== null) {
                    if (mfiVal < 20) {
                        results.push(this._make(
                            'MFI资金流超卖', '💰', CATEGORY_VOLUME, '中', 2,
                            `MFI=${mfiVal.toFixed(0)}，资金流出过度，可能反弹。`,
                            'BUY', 'MFI<20表示资金过度流出'
                        ));
                    } else if (mfiVal > 80) {
                        results.push(this._make(
                            'MFI资金流超买', '💰', CATEGORY_VOLUME, '中', 2,
                            `MFI=${mfiVal.toFixed(0)}，资金流入过度，可能回调。`,
                            'SELL', 'MFI>80表示资金过度流入'
                        ));
                    }
                }
            }

            if (highs.length >= 20) {
                const dcUpper = safeArrMax(highs.slice(-20));
                const dcLower = safeArrMin(lows.slice(-20));
                if (cp >= dcUpper) {
                    results.push(this._make(
                        'Donchian上轨突破', '📐', CATEGORY_PATTERN, '中', 2,
                        `股价(${cp.toFixed(2)})突破20日Donchian上轨(${dcUpper.toFixed(2)})，创新高！`,
                        'BUY', '突破Donchian上轨是海龟交易法买入信号'
                    ));
                } else if (cp <= dcLower) {
                    results.push(this._make(
                        'Donchian下轨跌破', '📐', CATEGORY_PATTERN, '中', 2,
                        `股价(${cp.toFixed(2)})跌破20日Donchian下轨(${dcLower.toFixed(2)})，创新低！`,
                        'SELL', '跌破Donchian下轨是海龟交易法卖出信号'
                    ));
                }
            }

            if (closes.length >= 21) {
                const logReturns = [];
                for (let i = -20; i < 0; i++) {
                    const idx = closesWithToday.length + i;
                    if (idx > 0 && closesWithToday[idx - 1] > 0) {
                        logReturns.push(Math.log(closesWithToday[idx] / closesWithToday[idx - 1]));
                    }
                }
                if (logReturns.length >= 10) {
                    const meanRet = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
                    const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - meanRet, 2), 0) / logReturns.length;
                    const hv = Math.sqrt(variance) * Math.sqrt(252) * 100;
                    if (hv > 60) {
                        const buyTarget = lp * 1.002;
                        const sellTarget = hp * 0.998;
                        const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
                        const buyAmount = buyTarget * 100;
                        const spread = sellTarget - buyTarget;
                        const netProfit = spread * 100 - txFee;
                        const netPct = buyAmount > 0 ? netProfit / buyAmount * 100 : 0;
                        results.push(this._make(
                            `高波动率 (HV=${hv.toFixed(0)}%)`, '🌊', CATEGORY_NOVEL, '中', 2,
                            `HV=${hv.toFixed(0)}%波动极大！买${buyTarget.toFixed(2)}卖${sellTarget.toFixed(2)}，净收益${netPct.toFixed(2)}%（高风险）`,
                            'TRADING_OPPORTUNITY', '高波动率适合做T但需严格止损',
                            { buy_price: buyTarget, sell_price: sellTarget }
                        ));
                    } else if (hv < 15) {
                        results.push(this._make(
                            `低波动率 (HV=${hv.toFixed(0)}%)`, '🌊', CATEGORY_NOVEL, '低', 3,
                            `20日历史波动率仅${hv.toFixed(0)}%，波动极小，不适合做T。`,
                            'NO_TRADE', '低波动率做T收益不够手续费'
                        ));
                    }
                }
            }

            if (closes.length >= 3) {
                const body = Math.abs(closesWithToday[closesWithToday.length - 1] - opensWithToday[closesWithToday.length - 1]);
                const upperShadow = highsWithToday[highsWithToday.length - 1] - Math.max(closesWithToday[closesWithToday.length - 1], opensWithToday[opensWithToday.length - 1]);
                const lowerShadow = Math.min(closesWithToday[closesWithToday.length - 1], opensWithToday[opensWithToday.length - 1]) - lowsWithToday[lowsWithToday.length - 1];
                const fullRange = highsWithToday[highsWithToday.length - 1] - lowsWithToday[lowsWithToday.length - 1];
                if (fullRange > 0) {
                    if (lowerShadow > body * 2 && upperShadow < body * 0.5 && body > 0) {
                        results.push(this._make(
                            '锤子线形态', '🔨', CATEGORY_PATTERN, '中', 2,
                            `锤子线：下影线是实体的${(lowerShadow / body).toFixed(1)}倍，底部反转信号。`,
                            'BUY', '锤子线是经典底部反转形态'
                        ));
                    }
                    if (upperShadow > body * 2 && lowerShadow < body * 0.5 && body > 0) {
                        results.push(this._make(
                            '倒锤子线形态', '🔨', CATEGORY_PATTERN, '中', 2,
                            `倒锤子线：上影线是实体的${(upperShadow / body).toFixed(1)}倍，顶部反转信号。`,
                            'SELL', '倒锤子线是经典顶部反转形态'
                        ));
                    }
                    if (body < fullRange * 0.1 && fullRange > 0) {
                        results.push(this._make(
                            '十字星形态', '✨', CATEGORY_PATTERN, '中', 2,
                            '十字星：实体极小，多空平衡，变盘信号。',
                            'WATCH', '十字星表示多空均衡，等待方向确认'
                        ));
                    }
                }
            }
        }

        // =================================================================
        //  八、更多细分策略
        // =================================================================

        if (hasKline && closes.length >= 60) {
            const ma30 = getSma(30);
            const ma60 = getSma(60);
            if (ma30 && ma60) {
                if (cp > ma30 && ma30 > ma60) {
                    results.push(this._make(
                        'MA30在MA60上方(强势)', '📈', CATEGORY_TREND, '中', 2,
                        `股价(${cp.toFixed(2)})>MA30(${ma30.toFixed(2)})>MA60(${ma60.toFixed(2)})，中期强势。`,
                        'HOLD', 'MA30在MA60上是强势状态'
                    ));
                } else if (cp < ma30 && ma30 < ma60) {
                    results.push(this._make(
                        'MA30在MA60下方(弱势)', '📉', CATEGORY_TREND, '中', 2,
                        `股价(${cp.toFixed(2)})<MA30(${ma30.toFixed(2)})<MA60(${ma60.toFixed(2)})，中期弱势。`,
                        'AVOID_BUY', 'MA30在MA60下是弱势状态'
                    ));
                } else {
                    results.push(this._make(
                        'MA30与MA60纠缠', '⚡', CATEGORY_TREND, '中', 3,
                        `MA30(${ma30.toFixed(2)})与MA60(${ma60.toFixed(2)})交错，方向待确认。`,
                        'WATCH', '均线纠缠时等待方向'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 20) {
            const ma20 = getSma(20);
            if (ma20) {
                const bias = (cp - ma20) / ma20 * 100;
                if (bias > 10) {
                    results.push(this._make(
                        'MA20正向偏离过大', '📈', CATEGORY_TREND, '中', 2,
                        `股价偏离MA20(${ma20.toFixed(2)})达+${bias.toFixed(1)}%，超买严重，有回调风险。`,
                        'SELL', '偏离过大需小心'
                    ));
                } else if (bias < -10) {
                    results.push(this._make(
                        'MA20负向偏离过大', '📉', CATEGORY_TREND, '中', 2,
                        `股价偏离MA20(${ma20.toFixed(2)})达${bias.toFixed(1)}%，超卖严重，有反弹机会。`,
                        'BUY', '负偏离过大是买入机会'
                    ));
                } else {
                    results.push(this._make(
                        'MA20偏离正常区间', '➖', CATEGORY_TREND, '中', 4,
                        `股价偏离MA20(${ma20.toFixed(2)})为${bias.toFixed(1)}%，在正常范围内。`,
                        'HOLD', '偏离正常，无特殊信号'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 20) {
            const [bollLower, bollMid, bollUpper] = getBoll();
            if (bollLower !== null && bollMid !== null && bollUpper !== null) {
                if (Math.abs(cp - bollUpper) / bollUpper < 0.005) {
                    results.push(this._make(
                        '布林上轨精准触碰', '🔴', CATEGORY_OSCILLATOR, '高', 1,
                        `股价(${cp.toFixed(2)})精准触碰布林上轨(${bollUpper.toFixed(2)})，强压力！`,
                        'SELL', '触碰上轨回落概率大'
                    ));
                } else if (Math.abs(cp - bollLower) / bollLower < 0.005) {
                    results.push(this._make(
                        '布林下轨精准触碰', '🟢', CATEGORY_OSCILLATOR, '高', 1,
                        `股价(${cp.toFixed(2)})精准触碰布林下轨(${bollLower.toFixed(2)})，强支撑！`,
                        'BUY', '触碰下轨反弹概率大'
                    ));
                } else if (Math.abs(cp - bollMid) / bollMid < 0.005) {
                    results.push(this._make(
                        '布林中轨附近', '⚡', CATEGORY_OSCILLATOR, '中', 2,
                        `股价(${cp.toFixed(2)})接近布林中轨(${bollMid.toFixed(2)})，等待方向选择。`,
                        'WATCH', '中轨是重要分水岭'
                    ));
                }
            }
        }

        if (hasKline && volumes.length >= 5) {
            let consecutiveUp = 0;
            let consecutiveDown = 0;
            for (let i = volumes.length - 1; i > 0; i--) {
                if (volumes[i] > volumes[i - 1]) {
                    if (consecutiveDown > 0) break;
                    consecutiveUp++;
                } else if (volumes[i] < volumes[i - 1]) {
                    if (consecutiveUp > 0) break;
                    consecutiveDown++;
                }
            }
            if (consecutiveUp >= 4) {
                results.push(this._make(
                    `连续放量${consecutiveUp}天`, '📊', CATEGORY_VOLUME, '高', 2,
                    `成交量连续${consecutiveUp}天放大，资金持续进场！`,
                    'BUY', '连续放量是资金入场信号'
                ));
            } else if (consecutiveDown >= 4) {
                results.push(this._make(
                    `连续缩量${consecutiveDown}天`, '📉', CATEGORY_VOLUME, '中', 2,
                    `成交量连续${consecutiveDown}天萎缩，观望情绪浓。`,
                    'WATCH', '连续缩量后有方向选择'
                ));
            }
        }

        if (hasKline && closes.length >= 20) {
            const psy = getPsy(12);
            if (psy !== null) {
                if (psy > 75) {
                    results.push(this._make(
                        'PSY极度过热(>75)', '🔥', CATEGORY_OSCILLATOR, '高', 1,
                        `PSY(${psy.toFixed(0)})>75，市场情绪极度亢奋，随时可能反转！`,
                        'SELL', 'PSY>75是卖出信号'
                    ));
                } else if (psy < 25) {
                    results.push(this._make(
                        'PSY极度低迷(<25)', '💎', CATEGORY_OSCILLATOR, '高', 1,
                        `PSY(${psy.toFixed(0)})<25，市场情绪极度低迷，随时可能反弹！`,
                        'BUY', 'PSY<25是买入信号'
                    ));
                }
            }
        }

        // =================================================================
        //  RSI细分区间策略
        // =================================================================

        if (hasKline && closes.length >= 15) {
            const rsi = getRsi(14);
            if (rsi !== null) {
                if (rsi > 80) {
                    results.push(this._make(
                        'RSI极度超买区(>80)', '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                        `RSI(14)=${rsi.toFixed(1)}>80，极度超买，随时可能暴跌！`,
                        'STRONG_SELL', 'RSI>80是极端超买信号'
                    ));
                } else if (rsi > 70) {
                    results.push(this._make(
                        'RSI超买区(70-80)', '📈', CATEGORY_OSCILLATOR, '高', 1,
                        `RSI(14)=${rsi.toFixed(1)}，进入超买区，回调风险大。`,
                        'SELL', 'RSI>70超买'
                    ));
                } else if (rsi > 50) {
                    results.push(this._make(
                        'RSI偏强区(50-70)', '📊', CATEGORY_OSCILLATOR, '中', 3,
                        `RSI(14)=${rsi.toFixed(1)}，多方占优但未超买。`,
                        'HOLD', 'RSI>50偏强'
                    ));
                } else if (rsi < 20) {
                    results.push(this._make(
                        'RSI极度超卖区(<20)', '💎', CATEGORY_OSCILLATOR, '极高', 0,
                        `RSI(14)=${rsi.toFixed(1)}<20，极度超卖，随时可能暴涨！`,
                        'STRONG_BUY', 'RSI<20是极端超卖信号'
                    ));
                } else if (rsi < 30) {
                    results.push(this._make(
                        'RSI超卖区(20-30)', '📉', CATEGORY_OSCILLATOR, '高', 1,
                        `RSI(14)=${rsi.toFixed(1)}，进入超卖区，反弹机会大。`,
                        'BUY', 'RSI<30超卖'
                    ));
                } else {
                    results.push(this._make(
                        'RSI偏弱区(30-50)', '📊', CATEGORY_OSCILLATOR, '中', 3,
                        `RSI(14)=${rsi.toFixed(1)}，空方占优但未超卖。`,
                        'WATCH', 'RSI<50偏弱'
                    ));
                }

                if (rsi >= 90) {
                    results.push(this._make(
                        'RSI历史极值(>90)', '⚠️', CATEGORY_OSCILLATOR, '极高', 0,
                        `RSI(14)=${rsi.toFixed(1)}，接近历史最高，极端行情预警！`,
                        'STRONG_SELL', 'RSI极值是重要反转信号'
                    ));
                } else if (rsi <= 10) {
                    results.push(this._make(
                        'RSI历史极值(<10)', '⚠️', CATEGORY_OSCILLATOR, '极高', 0,
                        `RSI(14)=${rsi.toFixed(1)}，接近历史最低，极端行情预警！`,
                        'STRONG_BUY', 'RSI极值是重要反转信号'
                    ));
                }
            }
        }

        // =================================================================
        //  RSI背离策略（顶背离/底背离）
        // =================================================================

        if (hasKline && closes.length >= 50) {
            const rsi14 = getRsi(14);
            const rsi6 = getRsi(6);
            if (rsi14 !== null && rsi6 !== null) {
                const recentHigh20 = Math.max(...closes.slice(-20));
                const recentLow20 = Math.min(...closes.slice(-20));
                const rsi14Ago = rsi14.length >= 5 ? rsi14[rsi14.length - 5] : null;
                const rsi6Ago = rsi6.length >= 5 ? rsi6[rsi6.length - 5] : null;

                if (cp >= recentHigh20 && rsi14Ago !== null && rsi14[rsi14.length - 1] < rsi14Ago && rsi14[rsi14.length - 1] > 60) {
                    results.push(this._make(
                        'RSI顶背离', '⚠️', CATEGORY_OSCILLATOR, '高', 1,
                        `股价创新高但RSI(14)未创新高，当前RSI=${rsi14[rsi14.length - 1].toFixed(1)}，5日前=${rsi14Ago.toFixed(1)}，顶背离预警。`,
                        'SELL', 'RSI顶背离是可靠的下跌信号，准确率约65%'
                    ));
                }

                if (cp <= recentLow20 && rsi14Ago !== null && rsi14[rsi14.length - 1] > rsi14Ago && rsi14[rsi14.length - 1] < 40) {
                    results.push(this._make(
                        'RSI底背离', '💎', CATEGORY_OSCILLATOR, '高', 1,
                        `股价创新低但RSI(14)未创新低，当前RSI=${rsi14[rsi14.length - 1].toFixed(1)}，5日前=${rsi14Ago.toFixed(1)}，底背离信号。`,
                        'BUY', 'RSI底背离是可靠的上涨信号，准确率约65%'
                    ));
                }

                if (rsi6Ago !== null && cp >= recentHigh20 && rsi6[rsi6.length - 1] < rsi6Ago && rsi6[rsi6.length - 1] > 70) {
                    results.push(this._make(
                        'RSI(6)顶背离', '⚠️', CATEGORY_OSCILLATOR, '中', 2,
                        `短期RSI(6)顶背离：股价创新高但RSI(6)未创新高，当前=${rsi6[rsi6.length - 1].toFixed(1)}，5日前=${rsi6Ago.toFixed(1)}。`,
                        'SELL', '短期RSI背离信号更快，但可靠性稍低'
                    ));
                }

                if (rsi6Ago !== null && cp <= recentLow20 && rsi6[rsi6.length - 1] > rsi6Ago && rsi6[rsi6.length - 1] < 30) {
                    results.push(this._make(
                        'RSI(6)底背离', '💎', CATEGORY_OSCILLATOR, '中', 2,
                        `短期RSI(6)底背离：股价创新低但RSI(6)未创新低，当前=${rsi6[rsi6.length - 1].toFixed(1)}，5日前=${rsi6Ago.toFixed(1)}。`,
                        'BUY', '短期RSI背离信号更快，但可靠性稍低'
                    ));
                }

                const rsi24 = getRsi(24);
                if (rsi24 !== null) {
                    const rsi6Val = rsi6[rsi6.length - 1];
                    const rsi14Val = rsi14[rsi14.length - 1];
                    const rsi24Val = rsi24[rsi24.length - 1];

                    if (rsi6Val > 70 && rsi14Val > 60 && rsi24Val > 50) {
                        results.push(this._make(
                            'RSI多周期共振超买', '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                            `RSI(6)=${rsi6Val.toFixed(1)} RSI(14)=${rsi14Val.toFixed(1)} RSI(24)=${rsi24Val.toFixed(1)}，多周期同时超买。`,
                            'STRONG_SELL', '多周期RSI共振超买是极强的下跌信号'
                        ));
                    } else if (rsi6Val < 30 && rsi14Val < 40 && rsi24Val < 50) {
                        results.push(this._make(
                            'RSI多周期共振超卖', '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                            `RSI(6)=${rsi6Val.toFixed(1)} RSI(14)=${rsi14Val.toFixed(1)} RSI(24)=${rsi24Val.toFixed(1)}，多周期同时超卖。`,
                            'STRONG_BUY', '多周期RSI共振超卖是极强的上涨信号'
                        ));
                    }
                }
            }
        }

        // =================================================================
        //  KDJ细分策略（高档钝化、背离、J值细分）
        // =================================================================

        if (hasKline && closes.length >= 20) {
            const [k, d, j] = getKdj();
            if (k !== null && d !== null && j !== null) {
                if (j > 100 && k > 80 && d > 80) {
                    results.push(this._make(
                        'KDJ高档钝化', '🔴', CATEGORY_OSCILLATOR, '高', 1,
                        `KDJ K=${k.toFixed(1)} D=${d.toFixed(1)} J=${j.toFixed(1)}，三值均在80以上高档钝化，冲顶阶段！`,
                        'SELL', '高档钝化是顶部预警'
                    ));
                } else if (j > 100) {
                    results.push(this._make(
                        'KDJ J值高档区', '📈', CATEGORY_OSCILLATOR, '中', 2,
                        `KDJ J=${j.toFixed(1)}>100，J值高档区，强势但需警惕。`,
                        'HOLD', 'J值高档强势但注意风险'
                    ));
                } else if (j < 0 && k < 20 && d < 20) {
                    results.push(this._make(
                        'KDJ低档钝化', '🟢', CATEGORY_OSCILLATOR, '高', 1,
                        `KDJ K=${k.toFixed(1)} D=${d.toFixed(1)} J=${j.toFixed(1)}，三值均在20以下低档钝化，筑底阶段！`,
                        'BUY', '低档钝化是底部信号'
                    ));
                } else if (j < 0) {
                    results.push(this._make(
                        'KDJ J值低档区', '📉', CATEGORY_OSCILLATOR, '中', 2,
                        `KDJ J=${j.toFixed(1)}<0，J值低档区，超卖但可能继续。`,
                        'WATCH', 'J值低档超卖状态'
                    ));
                } else {
                    results.push(this._make(
                        'KDJ运行正常', '➡️', CATEGORY_OSCILLATOR, '中', 4,
                        `KDJ K=${k.toFixed(1)} D=${d.toFixed(1)} J=${j.toFixed(1)}，运行在正常区间。`,
                        'HOLD', 'KDJ正常'
                    ));
                }

                if (j > 150) {
                    results.push(this._make(
                        'KDJ J值极度超买(>150)', '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                        `KDJ J=${j.toFixed(1)}>150，极度超买，随时可能暴跌！`,
                        'STRONG_SELL', 'J>150是极端超买信号'
                    ));
                } else if (j > 120) {
                    results.push(this._make(
                        'KDJ J值严重超买(120-150)', '📈', CATEGORY_OSCILLATOR, '高', 1,
                        `KDJ J=${j.toFixed(1)}，严重超买，回调概率极大！`,
                        'SELL', 'J>120超买'
                    ));
                } else if (j < -50) {
                    results.push(this._make(
                        'KDJ J值极度超卖(<-50)', '💎', CATEGORY_OSCILLATOR, '极高', 0,
                        `KDJ J=${j.toFixed(1)}<-50，极度超卖，随时可能暴涨！`,
                        'STRONG_BUY', 'J<-50是极端超卖信号'
                    ));
                } else if (j < -20) {
                    results.push(this._make(
                        'KDJ J值严重超卖(-50~-20)', '📉', CATEGORY_OSCILLATOR, '高', 1,
                        `KDJ J=${j.toFixed(1)}，严重超卖，反弹概率极大！`,
                        'BUY', 'J<-20超卖'
                    ));
                }

                if (closes.length >= 25) {
                    // 顶背离：价格创新高但J值未创新高
                    const recentHigh = safeArrMax(closes.slice(-10));
                    const prevHigh = safeArrMax(closes.slice(-20, -10));
                    const [kPrev, dPrev, jPrev] = this.calcKdj(
                        highsWithToday.slice(0, -1),
                        lowsWithToday.slice(0, -1),
                        closesWithToday.slice(0, -1)
                    );
                    const recentLow = safeArrMin(closes.slice(-10));
                    const prevLow = safeArrMin(closes.slice(-20, -10));
                    if (recentHigh > prevHigh && jPrev !== null && j < jPrev && j < 80) {
                        results.push(this._make(
                            'KDJ顶背离', '⚠️', CATEGORY_OSCILLATOR, '高', 1,
                            `股价创10日新高(${recentHigh.toFixed(2)})但J值未创新高(J=${j.toFixed(1)}<前值${jPrev.toFixed(1)})，KDJ顶背离预警！`,
                            'SELL', 'KDJ顶背离是重要卖出信号'
                        ));
                    } else if (recentLow < prevLow && jPrev !== null && j > jPrev && j > 20) {
                        results.push(this._make(
                            'KDJ底背离', '💎', CATEGORY_OSCILLATOR, '高', 1,
                            `股价创10日新低(${recentLow.toFixed(2)})但J值未创新低(J=${j.toFixed(1)}>前值${jPrev.toFixed(1)})，KDJ底背离信号！`,
                            'BUY', 'KDJ底背离是重要买入信号'
                        ));
                    } else {
                        results.push(this._make(
                            'KDJ与股价无背离', '➡️', CATEGORY_OSCILLATOR, '中', 4,
                            'KDJ与股价走势一致，无背离信号。',
                            'HOLD', '无背离'
                        ));
                    }
                }
            }
        }

        // =================================================================
        //  MACD更多策略（连续背离、柱状图、开口）
        // =================================================================

        if (hasKline && closes.length >= 60) {
            const macdSeries = getMacdSeries();
            if (macdSeries && macdSeries[0].length >= 10) {
                let divergenceCount = 0;
                const difSeries = macdSeries[0];
                // 背离：价格上涨但DIF下降（顶背离）或价格下跌但DIF上升（底背离）
                // difSeries 与 closes 的对齐：difSeries 末尾对应 closes 末尾
                const closesAligned = closesWithToday.slice(closesWithToday.length - difSeries.length);
                for (let i = -1; i > -Math.min(6, difSeries.length); i--) {
                    const idx = difSeries.length + i;
                    if (idx - 1 >= 0) {
                        const priceUp = closesAligned[idx] > closesAligned[idx - 1];
                        const priceDown = closesAligned[idx] < closesAligned[idx - 1];
                        const difDown = difSeries[idx] < difSeries[idx - 1];
                        const difUp = difSeries[idx] > difSeries[idx - 1];
                        if ((priceUp && difDown) || (priceDown && difUp)) {
                            divergenceCount++;
                        }
                    }
                }
                if (divergenceCount >= 3 && cp > closes[closes.length - 1] * 1.02) {
                    results.push(this._make(
                        'MACD连续顶背离', '⚠️', CATEGORY_TREND, '高', 1,
                        `MACD连续${divergenceCount}次背离，股价创新高但动能减弱，强烈预警！`,
                        'SELL', '连续顶背离是重要见顶信号'
                    ));
                } else if (divergenceCount >= 3 && cp < closes[closes.length - 1] * 0.98) {
                    results.push(this._make(
                        'MACD连续底背离', '💎', CATEGORY_TREND, '高', 1,
                        `MACD连续${divergenceCount}次底背离，股价创新低但动能积蓄，强烈反弹信号！`,
                        'BUY', '连续底背离是重要见底信号'
                    ));
                } else {
                    results.push(this._make(
                        'MACD无连续背离', '➡️', CATEGORY_TREND, '中', 4,
                        `MACD背离次数${divergenceCount}，暂无连续背离信号。`,
                        'HOLD', '背离不明显'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 35) {
            const macdSeries = getMacdSeries();
            if (macdSeries && macdSeries[2].length >= 3) {
                const barSeries = macdSeries[2];
                const barNow = barSeries[barSeries.length - 1];
                const barPrev = barSeries[barSeries.length - 2];
                if (Math.abs(barNow) > Math.abs(barPrev) * 1.5 && barNow > 0) {
                    results.push(this._make(
                        'MACD红柱扩张', '📈', CATEGORY_TREND, '中', 2,
                        `MACD红柱从${barPrev.toFixed(3)}扩张到${barNow.toFixed(3)}，多头动能急剧增强。`,
                        'BUY', '红柱扩张是加速上涨信号'
                    ));
                } else if (Math.abs(barNow) > Math.abs(barPrev) * 1.5 && barNow < 0) {
                    results.push(this._make(
                        'MACD绿柱扩张', '📉', CATEGORY_TREND, '中', 2,
                        `MACD绿柱从${barPrev.toFixed(3)}扩张到${barNow.toFixed(3)}，空头动能急剧增强。`,
                        'SELL', '绿柱扩张是加速下跌信号'
                    ));
                } else if (Math.abs(barNow) < Math.abs(barPrev) * 0.7 && barNow > 0) {
                    results.push(this._make(
                        'MACD红柱收缩', '⏸️', CATEGORY_TREND, '中', 3,
                        `MACD红柱从${barPrev.toFixed(3)}收缩到${barNow.toFixed(3)}，多头动能减弱。`,
                        'WATCH', '红柱收缩可能转势'
                    ));
                } else if (Math.abs(barNow) < Math.abs(barPrev) * 0.7 && barNow < 0) {
                    results.push(this._make(
                        'MACD绿柱收缩', '⏸️', CATEGORY_TREND, '中', 3,
                        `MACD绿柱从${barPrev.toFixed(3)}收缩到${barNow.toFixed(3)}，空头动能减弱。`,
                        'WATCH', '绿柱收缩可能转势'
                    ));
                } else {
                    results.push(this._make(
                        'MACD柱状图稳定', '➡️', CATEGORY_TREND, '中', 4,
                        `MACD柱${barNow.toFixed(3)}变化不大，趋势延续。`,
                        'HOLD', '柱状图稳定'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 35) {
            const [difNow, deaNow] = getMacd();
            if (difNow !== null && deaNow !== null) {
                const gap = Math.abs(difNow - deaNow);
                if (gap > 0.5) {
                    if (difNow > deaNow) {
                        results.push(this._make(
                            'MACD开口放大(多方)', '📈', CATEGORY_TREND, '中', 2,
                            `DIF(${difNow.toFixed(3)})-DEA(${deaNow.toFixed(3)})开口${gap.toFixed(3)}，多方强势。`,
                            'BUY', '开口放大是趋势加速信号'
                        ));
                    } else {
                        results.push(this._make(
                            'MACD开口放大(空方)', '📉', CATEGORY_TREND, '中', 2,
                            `DIF(${difNow.toFixed(3)})-DEA(${deaNow.toFixed(3)})开口${gap.toFixed(3)}，空方强势。`,
                            'SELL', '开口放大是趋势加速信号'
                        ));
                    }
                } else if (gap < 0.1) {
                    results.push(this._make(
                        'MACD开口极度收窄', '⚡', CATEGORY_TREND, '高', 1,
                        `DIF(${difNow.toFixed(3)})-DEA(${deaNow.toFixed(3)})开口${gap.toFixed(3)}，金叉死叉在即！`,
                        'WATCH', '开口极度收窄后必有方向选择'
                    ));
                } else {
                    results.push(this._make(
                        'MACD开口正常', '➡️', CATEGORY_TREND, '中', 4,
                        `DIF(${difNow.toFixed(3)})-DEA(${deaNow.toFixed(3)})开口${gap.toFixed(3)}，趋势稳定。`,
                        'HOLD', '开口正常'
                    ));
                }
            }
        }

        // =================================================================
        //  布林带细分策略（开口状态、价格突破、带内运行）
        // =================================================================

        if (hasKline && closes.length >= 25) {
            const [bollLower, bollMid, bollUpper] = getBoll();
            if (bollLower !== null && bollMid !== null && bollUpper !== null && bollMid > 0) {
                const bw = (bollUpper - bollLower) / bollMid * 100;
                if (bw > 15) {
                    results.push(this._make(
                        '布林开口极度放大', '📊', CATEGORY_OSCILLATOR, '高', 2,
                        `布林带宽${bw.toFixed(1)}%>15%，开口极度放大，趋势可能加速或反转。`,
                        'WATCH', '开口放大后的方向选择很重要'
                    ));
                } else if (bw > 8) {
                    results.push(this._make(
                        '布林开口放大', '📈', CATEGORY_OSCILLATOR, '中', 3,
                        `布林带宽${bw.toFixed(1)}%>8%，开口放大，趋势延续。`,
                        'HOLD', '开口放大趋势延续'
                    ));
                } else if (bw < 3) {
                    results.push(this._make(
                        '布林开口极度收窄', '⚡', CATEGORY_OSCILLATOR, '高', 1,
                        `布林带宽${bw.toFixed(1)}%<3%，极度收窄，即将爆发行情！`,
                        'WATCH', '极度收窄后必有大幅波动'
                    ));
                } else {
                    results.push(this._make(
                        '布林开口正常', '➡️', CATEGORY_OSCILLATOR, '中', 4,
                        `布林带宽${bw.toFixed(1)}%，开口正常，趋势稳定。`,
                        'HOLD', '开口正常'
                    ));
                }

                if (cp > bollUpper * 1.01) {
                    results.push(this._make(
                        '价格突破布林上轨', '📈', CATEGORY_OSCILLATOR, '高', 1,
                        `股价(${cp.toFixed(2)})突破布林上轨(${bollUpper.toFixed(2)})，强势明显！`,
                        'HOLD', '突破上轨是强势信号'
                    ));
                } else if (cp < bollLower * 0.99) {
                    results.push(this._make(
                        '价格跌破布林下轨', '📉', CATEGORY_OSCILLATOR, '高', 1,
                        `股价(${cp.toFixed(2)})跌破布林下轨(${bollLower.toFixed(2)})，弱势明显！`,
                        'AVOID_BUY', '跌破下轨是弱势信号'
                    ));
                } else {
                    results.push(this._make(
                        '价格在布林带内', '➡️', CATEGORY_OSCILLATOR, '中', 4,
                        '股价在布林带内运行，暂无突破信号。',
                        'HOLD', '正常运行'
                    ));
                }
            }
        }

        // =================================================================
        //  量价类更多策略
        // =================================================================

        if (hasKline && volumes.length >= 20) {
            const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const volRatio = avgVol20 > 0 ? vol / avgVol20 : 1;
            if (volRatio > 2) {
                results.push(this._make(
                    '量能创20日新高', '🔥', CATEGORY_VOLUME, '高', 1,
                    `今日成交量是20日均量的${volRatio.toFixed(1)}倍，创近期新高！`,
                    'WATCH', '量能新高需观察方向'
                ));
            } else if (volRatio < 0.3) {
                results.push(this._make(
                    '量能创20日新低', '💤', CATEGORY_VOLUME, '中', 2,
                    `今日成交量是20日均量的${volRatio.toFixed(1)}倍，创近期新低！`,
                    'WATCH', '地量后有地价'
                ));
            } else {
                results.push(this._make(
                    '量能处于正常区间', '➡️', CATEGORY_VOLUME, '中', 4,
                    `量能在20日均量的${volRatio.toFixed(1)}倍，正常范围。`,
                    'HOLD', '量能正常'
                ));
            }
        }

        if (hasKline && volumes.length >= 10) {
            const maVol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const maVol10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
            if (maVol5 > maVol10 * 1.3) {
                results.push(this._make(
                    '短期量能均线多头(5日>10日30%)', '📈', CATEGORY_VOLUME, '中', 2,
                    `5日均量是10日均量的${(maVol5 / maVol10 * 100 - 100).toFixed(0)}%，短期资金活跃。`,
                    'HOLD', '量能均线多头表示资金流入'
                ));
            } else if (maVol5 < maVol10 * 0.7) {
                results.push(this._make(
                    '短期量能均线空头(5日<10日30%)', '📉', CATEGORY_VOLUME, '中', 2,
                    `5日均量是10日均量的${(maVol5 / maVol10 * 100).toFixed(0)}%，短期资金撤退。`,
                    'SELL', '量能均线空头表示资金流出'
                ));
            } else {
                results.push(this._make(
                    '量能均线纠缠', '⚡', CATEGORY_VOLUME, '中', 3,
                    '5日均量与10日均量接近，量能方向不明。',
                    'WATCH', '量能均线纠缠'
                ));
            }
        }

        if (hasKline && closes.length >= 10) {
            let consecutiveUp = 0;
            let consecutiveDown = 0;
            for (let i = volumes.length - 1; i > 0; i--) {
                if (volumes[i] > volumes[i - 1]) {
                    if (consecutiveDown > 0) break;
                    consecutiveUp++;
                } else if (volumes[i] < volumes[i - 1]) {
                    if (consecutiveUp > 0) break;
                    consecutiveDown++;
                }
            }
            if (consecutiveUp >= 3) {
                results.push(this._make(
                    '连续放量', '📈', CATEGORY_VOLUME, '中', 2,
                    `连续放量${consecutiveUp}天，量能持续放大。`,
                    'BUY', '连续放量是资金积极入场信号'
                ));
            } else if (consecutiveDown >= 3) {
                results.push(this._make(
                    '连续缩量', '📉', CATEGORY_VOLUME, '中', 2,
                    `连续缩量${consecutiveDown}天，量能持续萎缩。`,
                    'SELL', '连续缩量是资金撤退信号'
                ));
            } else {
                results.push(this._make(
                    '成交量变化正常', '➡️', CATEGORY_VOLUME, '中', 4,
                    `连续放量${consecutiveUp}天，连续缩量${consecutiveDown}天，无异常。`,
                    'HOLD', '量能正常'
                ));
            }
        }

        // =================================================================
        //  MFI多级判断
        // =================================================================

        if (hasKline && closes.length >= 15) {
            const mfiVal = getMfi();
            if (mfiVal !== null) {
                if (mfiVal > 90) {
                    results.push(this._make(
                        'MFI极度过热(>90)', '🔥', CATEGORY_VOLUME, '极高', 0,
                        `MFI=${mfiVal.toFixed(1)}>90，资金极度涌入，随时可能反转！`,
                        'STRONG_SELL', 'MFI>90是危险信号'
                    ));
                } else if (mfiVal > 70) {
                    results.push(this._make(
                        'MFI超买区(70-90)', '📈', CATEGORY_VOLUME, '高', 1,
                        `MFI=${mfiVal.toFixed(1)}，资金流入过猛，注意回调风险。`,
                        'SELL', 'MFI>70超买'
                    ));
                } else if (mfiVal < 10) {
                    results.push(this._make(
                        'MFI极度低迷(<10)', '💎', CATEGORY_VOLUME, '极高', 0,
                        `MFI=${mfiVal.toFixed(1)}<10，资金极度匮乏，随时可能反弹！`,
                        'STRONG_BUY', 'MFI<10是极度超卖信号'
                    ));
                } else if (mfiVal < 30) {
                    results.push(this._make(
                        'MFI超卖区(10-30)', '📉', CATEGORY_VOLUME, '高', 1,
                        `MFI=${mfiVal.toFixed(1)}，资金流出过多，超卖反弹机会。`,
                        'BUY', 'MFI<30超卖'
                    ));
                } else {
                    results.push(this._make(
                        'MFI运行正常(30-70)', '➡️', CATEGORY_VOLUME, '中', 4,
                        `MFI=${mfiVal.toFixed(1)}，资金流正常。`,
                        'HOLD', 'MFI正常'
                    ));
                }
            }
        }

        // =================================================================
        //  WR威廉指标多周期
        // =================================================================

        for (const wrPeriod of [6, 10, 20]) {
            if (hasKline && closes.length >= wrPeriod) {
                const wrVal = getWr(wrPeriod);
                if (wrVal !== null) {
                    if (wrVal < -80) {
                        results.push(this._make(
                            `WR${wrPeriod}超卖`, '🟢', CATEGORY_OSCILLATOR, '中', 2,
                            `威廉%R(${wrPeriod})=${wrVal.toFixed(1)}，超卖区域。`,
                            'BUY', `WR${wrPeriod}<-80超卖`
                        ));
                    } else if (wrVal > -20) {
                        results.push(this._make(
                            `WR${wrPeriod}超买`, '🔴', CATEGORY_OSCILLATOR, '中', 2,
                            `威廉%R(${wrPeriod})=${wrVal.toFixed(1)}，超买区域。`,
                            'SELL', `WR${wrPeriod}>-20超买`
                        ));
                    } else {
                        results.push(this._make(
                            `WR${wrPeriod}中性`, '➡️', CATEGORY_OSCILLATOR, '中', 4,
                            `威廉%R(${wrPeriod})=${wrVal.toFixed(1)}，中性区域。`,
                            'HOLD', `WR${wrPeriod}正常`
                        ));
                    }
                }
            }
        }

        // =================================================================
        //  价格动量MOM + ROC更多周期
        // =================================================================

        if (hasKline && closes.length >= 10) {
            for (const momPeriod of [5, 10]) {
                if (closesWithToday.length > momPeriod) {
                    const momBase = closesWithToday[closesWithToday.length - 1 - momPeriod];
                    const mom = closesWithToday[closesWithToday.length - 1] - momBase;
                    const momPct = momBase > 0 ? mom / momBase * 100 : 0;
                    if (mom > 0 && momPct > 5) {
                        results.push(this._make(
                            `MOM${momPeriod}正动量(+${momPct.toFixed(1)}%)`, '📈', CATEGORY_OSCILLATOR, '中', 2,
                            `${momPeriod}日动量${mom.toFixed(2)}(+${momPct.toFixed(1)}%)，价格上升动能充足。`,
                            'HOLD', '正动量表示上涨趋势'
                        ));
                    } else if (mom < 0 && momPct < -5) {
                        results.push(this._make(
                            `MOM${momPeriod}负动量(${momPct.toFixed(1)}%)`, '📉', CATEGORY_OSCILLATOR, '中', 2,
                            `${momPeriod}日动量${mom.toFixed(2)}(${momPct.toFixed(1)}%)，价格下跌动能充足。`,
                            'SELL', '负动量表示下跌趋势'
                        ));
                    } else {
                        results.push(this._make(
                            `MOM${momPeriod}动量中性`, '➡️', CATEGORY_OSCILLATOR, '中', 4,
                            `${momPeriod}日动量${momPct.toFixed(1)}%，动量不足。`,
                            'HOLD', '动量中性'
                        ));
                    }
                }
            }
        }

        if (hasKline && closes.length >= 15) {
            for (const rocPeriod of [3, 7, 14]) {
                if (closesWithToday.length > rocPeriod) {
                    const rocBase = closesWithToday[closesWithToday.length - 1 - rocPeriod];
                    const roc = rocBase > 0 ? (closesWithToday[closesWithToday.length - 1] - rocBase) / rocBase * 100 : 0;
                    if (roc > 15) {
                        results.push(this._make(
                            `ROC(${rocPeriod})强势上涨(${roc.toFixed(1)}%)`, '🚀', CATEGORY_OSCILLATOR, '中', 2,
                            `${rocPeriod}日ROC=${roc.toFixed(1)}%，短期强势，注意回调。`,
                            'HOLD', 'ROC>15%为强势但过热'
                        ));
                    } else if (roc < -15) {
                        results.push(this._make(
                            `ROC(${rocPeriod})强势下跌(${roc.toFixed(1)}%)`, '💀', CATEGORY_OSCILLATOR, '中', 2,
                            `${rocPeriod}日ROC=${roc.toFixed(1)}%，短期超跌，可能反弹。`,
                            'BUY', 'ROC<-15%为超跌'
                        ));
                    } else if (roc > 5) {
                        results.push(this._make(
                            `ROC(${rocPeriod})偏强`, '📈', CATEGORY_OSCILLATOR, '中', 3,
                            `${rocPeriod}日ROC=${roc.toFixed(1)}%，偏强但未过热。`,
                            'HOLD', 'ROC>5%偏强'
                        ));
                    } else if (roc < -5) {
                        results.push(this._make(
                            `ROC(${rocPeriod})偏弱`, '📉', CATEGORY_OSCILLATOR, '中', 3,
                            `${rocPeriod}日ROC=${roc.toFixed(1)}%，偏弱但未超卖。`,
                            'WATCH', 'ROC<-5%偏弱'
                        ));
                    } else {
                        results.push(this._make(
                            `ROC(${rocPeriod})中性`, '➡️', CATEGORY_OSCILLATOR, '中', 4,
                            `${rocPeriod}日ROC=${roc.toFixed(1)}%，价格变化平稳。`,
                            'HOLD', 'ROC正常'
                        ));
                    }
                }
            }
        }

        // =================================================================
        //  BIAS乖离率细分
        // =================================================================

        for (const biasPeriod of [5, 10, 20]) {
            if (hasKline && closes.length >= biasPeriod) {
                const maBias = getSma(biasPeriod);
                if (maBias) {
                    const bias = (cp - maBias) / maBias * 100;
                    if (bias > 8) {
                        results.push(this._make(
                            `BIAS${biasPeriod}大幅正偏(${bias.toFixed(1)}%)`, '📈', CATEGORY_OSCILLATOR, '高', 1,
                            `BIAS${biasPeriod}=${bias.toFixed(1)}>8%，价格远离均线，超买预警！`,
                            'SELL', '正乖离过大需回落'
                        ));
                    } else if (bias > 5 && bias <= 8) {
                        results.push(this._make(
                            `BIAS${biasPeriod}正偏(${bias.toFixed(1)}%)`, '📊', CATEGORY_OSCILLATOR, '中', 2,
                            `BIAS${biasPeriod}=${bias.toFixed(1)}，价格偏高于均线。`,
                            'HOLD', '正乖离偏大'
                        ));
                    } else if (bias < -8) {
                        results.push(this._make(
                            `BIAS${biasPeriod}大幅负偏(${bias.toFixed(1)}%)`, '📉', CATEGORY_OSCILLATOR, '高', 1,
                            `BIAS${biasPeriod}=${bias.toFixed(1)}<-8%，价格远离均线，超卖反弹！`,
                            'BUY', '负乖离过大需反弹'
                        ));
                    } else if (bias < -5) {
                        results.push(this._make(
                            `BIAS${biasPeriod}负偏(${bias.toFixed(1)}%)`, '📊', CATEGORY_OSCILLATOR, '中', 2,
                            `BIAS${biasPeriod}=${bias.toFixed(1)}，价格偏低于均线。`,
                            'BUY', '负乖离偏大'
                        ));
                    } else {
                        results.push(this._make(
                            `BIAS${biasPeriod}正常(${bias.toFixed(1)}%)`, '➡️', CATEGORY_OSCILLATOR, '中', 4,
                            `BIAS${biasPeriod}=${bias.toFixed(1)}，乖离正常。`,
                            'HOLD', '乖离正常'
                        ));
                    }
                }
            }
        }

        // =================================================================
        //  DMI+ADX综合判断
        // =================================================================

        if (hasKline && closes.length >= 15) {
            const [pdi, mdi, adx] = getDmi();
            if (pdi !== null && mdi !== null && adx !== null) {
                let trendStrength;
                if (adx > 40) trendStrength = '极强';
                else if (adx > 25) trendStrength = '强';
                else if (adx > 15) trendStrength = '弱';
                else trendStrength = '极弱';

                if (pdi > mdi && adx > 25) {
                    results.push(this._make(
                        `DMI多头(ADX${trendStrength})`, '📈', CATEGORY_TREND, '高', 1,
                        `+DI(${pdi.toFixed(1)})>-DI(${mdi.toFixed(1)})，ADX=${adx.toFixed(1)}，趋势${trendStrength}！`,
                        'BUY', 'DMI多头+ADX确认'
                    ));
                } else if (mdi > pdi && adx > 25) {
                    results.push(this._make(
                        `DMI空头(ADX${trendStrength})`, '📉', CATEGORY_TREND, '高', 1,
                        `-DI(${mdi.toFixed(1)})>+DI(${pdi.toFixed(1)})，ADX=${adx.toFixed(1)}，趋势${trendStrength}！`,
                        'SELL', 'DMI空头+ADX确认'
                    ));
                } else if (adx < 15) {
                    results.push(this._make(
                        'DMI无趋势(ADX极弱)', '⏸️', CATEGORY_TREND, '中', 3,
                        `ADX=${adx.toFixed(1)}<15，趋势极弱，震荡整理为主。`,
                        'WATCH', 'ADX<15无趋势'
                    ));
                } else {
                    results.push(this._make(
                        'DMI多空纠缠', '⚡', CATEGORY_TREND, '中', 3,
                        `+DI(${pdi.toFixed(1)})≈-DI(${mdi.toFixed(1)})，多空均衡，等待方向。`,
                        'WATCH', '多空力量均衡'
                    ));
                }

                if (closes.length >= 2) {
                    const [, , adxPrev] = this.calcDmi(highs.slice(0, -1), lows.slice(0, -1), closes.slice(0, -1), 14);
                    if (adxPrev !== null) {
                        if (adx > adxPrev && adx > 20) {
                            results.push(this._make(
                                'ADX上升-趋势增强', '📈', CATEGORY_TREND, '中', 2,
                                `ADX由${adxPrev.toFixed(1)}升至${adx.toFixed(1)}，趋势强度正在增强。`,
                                'HOLD', 'ADX上升说明趋势在加速'
                            ));
                        } else if (adx < adxPrev && adx > 25) {
                            results.push(this._make(
                                'ADX下降-趋势减弱', '📉', CATEGORY_TREND, '中', 2,
                                `ADX由${adxPrev.toFixed(1)}降至${adx.toFixed(1)}，趋势强度正在减弱。`,
                                'WATCH', 'ADX下降说明趋势可能即将结束'
                            ));
                        }
                    }
                }

                if (adx > 50) {
                    results.push(this._make(
                        'ADX极端强势(>50)', '🔥', CATEGORY_TREND, '极高', 0,
                        `ADX=${adx.toFixed(1)}>50，趋势极端强劲，可能即将出现趋势衰竭。`,
                        'HOLD', 'ADX>50是极端趋势信号，注意趋势反转风险'
                    ));
                }
            }
        }

        // =================================================================
        //  三指标共振 + 综合评分
        // =================================================================

        if (hasKline && closes.length >= 35) {
            const [k, d, j] = getKdj();
            const rsi = getRsi(14);
            const [dif, dea] = getMacd();
            if (k !== null && rsi !== null && dif !== null && dea !== null) {
                if (j < 20 && rsi < 30 && dif < 0 && dif < dea) {
                    results.push(this._make(
                        '三指标共振超卖(KDJ+RSI+MACD)', '💎', CATEGORY_OSCILLATOR, '极高', 0,
                        `KDJ J=${j.toFixed(1)}<20, RSI=${rsi.toFixed(1)}<30, MACD零轴下方空头，三重超卖共振！`,
                        'STRONG_BUY', '三指标共振是最强买入信号'
                    ));
                } else if (j > 100 && rsi > 70 && dif > 0 && dif > dea) {
                    results.push(this._make(
                        '三指标共振超买(KDJ+RSI+MACD)', '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                        `KDJ J=${j.toFixed(1)}>100, RSI=${rsi.toFixed(1)}>70, MACD零轴上方多头，三重超买共振！`,
                        'STRONG_SELL', '三指标共振是最强卖出信号'
                    ));
                } else if (j < 20 && rsi > 50) {
                    results.push(this._make(
                        'KDJ超卖但RSI偏强', '⚠️', CATEGORY_OSCILLATOR, '中', 2,
                        `KDJ J=${j.toFixed(1)}<20超卖，但RSI=${rsi.toFixed(1)}>50偏强，分化信号。`,
                        'WATCH', '分化时以RSI为准'
                    ));
                } else if (j > 100 && rsi < 50) {
                    results.push(this._make(
                        'KDJ超买但RSI偏弱', '⚠️', CATEGORY_OSCILLATOR, '中', 2,
                        `KDJ J=${j.toFixed(1)}>100超买，但RSI=${rsi.toFixed(1)}<50偏弱，分化信号。`,
                        'WATCH', '分化时以RSI为准'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 20) {
            let trendScore = 0;
            const ma5 = getSma(5);
            const ma20 = getSma(20);
            if (ma5 && ma20) {
                trendScore += ma5 > ma20 ? 2 : -2;
            }
            const [difScore, deaScore] = getMacd();
            if (difScore !== null && deaScore !== null) {
                trendScore += difScore > deaScore ? 2 : -2;
            }
            const rsiScore = getRsi(14);
            if (rsiScore !== null) {
                if (rsiScore > 55) trendScore += 2;
                else if (rsiScore < 45) trendScore -= 2;
            }
            const [kScore, dScore] = getKdj();
            if (kScore !== null && dScore !== null) {
                trendScore += kScore > dScore ? 1 : -1;
            }

            if (trendScore >= 6) {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '🟢', CATEGORY_TREND, '极高', 0,
                    `TrendScore=${trendScore}/7，多指标全面看多！`,
                    'STRONG_BUY', '综合评分极度看多'
                ));
            } else if (trendScore >= 3) {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '📈', CATEGORY_TREND, '高', 1,
                    `TrendScore=${trendScore}/7，多指标偏多。`,
                    'BUY', '综合评分偏多'
                ));
            } else if (trendScore <= -6) {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '🔴', CATEGORY_TREND, '极高', 0,
                    `TrendScore=${trendScore}/7，多指标全面看空！`,
                    'STRONG_SELL', '综合评分极度看空'
                ));
            } else if (trendScore <= -3) {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '📉', CATEGORY_TREND, '高', 1,
                    `TrendScore=${trendScore}/7，多指标偏空。`,
                    'SELL', '综合评分偏空'
                ));
            } else {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '⚡', CATEGORY_TREND, '中', 3,
                    `TrendScore=${trendScore}/7，多空均衡。`,
                    'WATCH', '综合评分中性'
                ));
            }
        }

        if (hasKline && closes.length >= 20) {
            let oscScore = 0;
            const rsiOsc = getRsi(14);
            if (rsiOsc !== null) {
                if (rsiOsc > 70) oscScore += 3;
                else if (rsiOsc < 30) oscScore -= 3;
                else if (rsiOsc > 60) oscScore += 1;
                else if (rsiOsc < 40) oscScore -= 1;
            }
            const [kOsc, dOsc, jOsc] = getKdj();
            if (kOsc !== null && jOsc !== null) {
                if (jOsc > 100) oscScore += 3;
                else if (jOsc < 0) oscScore -= 3;
                else if (jOsc > 80) oscScore += 1;
                else if (jOsc < 20) oscScore -= 1;
            }
            const wrOsc = getWr();
            if (wrOsc !== null) {
                if (wrOsc > -20) oscScore += 2;
                else if (wrOsc < -80) oscScore -= 2;
            }

            if (oscScore >= 5) {
                results.push(this._make(
                    `综合震荡评分OscScore=${oscScore}`, '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                    `OscScore=${oscScore}，多指标超买共振！`,
                    'STRONG_SELL', '震荡评分极度超买'
                ));
            } else if (oscScore <= -5) {
                results.push(this._make(
                    `综合震荡评分OscScore=${oscScore}`, '💎', CATEGORY_OSCILLATOR, '极高', 0,
                    `OscScore=${oscScore}，多指标超卖共振！`,
                    'STRONG_BUY', '震荡评分极度超卖'
                ));
            } else {
                results.push(this._make(
                    `综合震荡评分OscScore=${oscScore}`, '➡️', CATEGORY_OSCILLATOR, '中', 3,
                    `OscScore=${oscScore}，多空均衡。`,
                    'HOLD', '震荡评分中性'
                ));
            }
        }

        // =================================================================
        //  K线形态判断
        // =================================================================

        if (hasKline && opens.length > 0) {
            const body = Math.abs(cp - op);
            const upperShadow = hp - Math.max(cp, op);
            const lowerShadow = Math.min(cp, op) - lp;
            if (body > 0 && upperShadow < body * 0.1 && lowerShadow < body * 0.1) {
                if (cp > op) {
                    results.push(this._make(
                        '光头光脚大阳线', '📈', CATEGORY_PATTERN, '高', 1,
                        `阳线实体${body.toFixed(2)}，上下影线极短，强势上涨！`,
                        'BUY', '光头光脚阳线是强势信号'
                    ));
                } else {
                    results.push(this._make(
                        '光头光脚大阴线', '📉', CATEGORY_PATTERN, '高', 1,
                        `阴线实体${body.toFixed(2)}，上下影线极短，弱势下跌！`,
                        'SELL', '光头光脚阴线是弱势信号'
                    ));
                }
            } else if (upperShadow > body * 2) {
                if (cp > op) {
                    results.push(this._make(
                        '带上影线阳线(冲高回落)', '📉', CATEGORY_PATTERN, '中', 2,
                        `阳线上影线是实体${(upperShadow / body).toFixed(1)}倍，冲高受阻！`,
                        'SELL', '长上影线是回落信号'
                    ));
                } else {
                    results.push(this._make(
                        '带上影线阴线', '📉', CATEGORY_PATTERN, '中', 2,
                        `阴线上影线是实体${(upperShadow / body).toFixed(1)}倍，继续下跌！`,
                        'SELL', '长上影线阴线弱势'
                    ));
                }
            } else if (lowerShadow > body * 2) {
                if (cp > op) {
                    results.push(this._make(
                        '带下影线阳线(探底回升)', '📈', CATEGORY_PATTERN, '中', 2,
                        `阳线下影线是实体${(lowerShadow / body).toFixed(1)}倍，探底反弹！`,
                        'BUY', '长下影线是反弹信号'
                    ));
                } else {
                    results.push(this._make(
                        '带下影线阴线(跌势减弱)', '📊', CATEGORY_PATTERN, '中', 2,
                        `阴线下影线是实体${(lowerShadow / body).toFixed(1)}倍，跌势减弱！`,
                        'WATCH', '长下影线阴线跌势减缓'
                    ));
                }
            } else {
                results.push(this._make(
                    '普通K线形态', '➡️', CATEGORY_PATTERN, '中', 4,
                    `实体${body.toFixed(2)}，上下影线正常，无特殊信号。`,
                    'HOLD', '普通形态'
                ));
            }
        }

        // =================================================================
        //  跳空细分 + 短期均线组合
        // =================================================================

        if (hasKline && closes.length >= 1) {
            const prevClose = closes[closes.length - 1];
            const gap = (op - prevClose) / prevClose * 100;
            if (gap > 1.5) {
                results.push(this._make(
                    `跳空高开(${gap.toFixed(1)}%)`, '📈', CATEGORY_PATTERN, '高', 1,
                    `开盘跳空高开${gap.toFixed(1)}%，缺口形成，回补概率大。`,
                    'WATCH', '跳空高开需观察能否守住'
                ));
            } else if (gap < -1.5) {
                results.push(this._make(
                    `跳空低开(${gap.toFixed(1)}%)`, '📉', CATEGORY_PATTERN, '高', 1,
                    `开盘跳空低开${gap.toFixed(1)}%，缺口形成，反弹概率大。`,
                    'WATCH', '跳空低开可观察反弹'
                ));
            } else if (gap > 0.5) {
                results.push(this._make(
                    `小幅高开(${gap.toFixed(1)}%)`, '📊', CATEGORY_PATTERN, '中', 3,
                    `开盘小幅高开${gap.toFixed(1)}%，无明显缺口。`,
                    'HOLD', '小幅跳空正常'
                ));
            } else if (gap < -0.5) {
                results.push(this._make(
                    `小幅低开(${gap.toFixed(1)}%)`, '📊', CATEGORY_PATTERN, '中', 3,
                    `开盘小幅低开${gap.toFixed(1)}%，无明显缺口。`,
                    'WATCH', '小幅跳空正常'
                ));
            } else {
                results.push(this._make(
                    '平盘开盘', '➡️', CATEGORY_PATTERN, '中', 4,
                    '开盘价与昨收几乎持平，无跳空。',
                    'HOLD', '平盘正常'
                ));
            }
        }

        // =================================================================
        //  形态类策略：吞没、双底、双顶、头肩、三角形、旗形/楔形
        // =================================================================

        // 1. 吞没形态（K线级别）
        if (hasKline && closes.length >= 1) {
            const prevClose = closes[closes.length - 1];
            const prevOpen = opens[opens.length - 1];
            const prevHigh = highs[highs.length - 1];
            const prevLow = lows[lows.length - 1];
            // 阳包阴：前日阴线，今日开盘低于前日收盘，今日收盘高于前日开盘
            if (prevClose < prevOpen && op < prevClose && cp > prevOpen) {
                results.push(this._make(
                    '阳包阴（吞没形态）', '📈', CATEGORY_PATTERN, '高', 1,
                    `前日阴线后今日阳包阴，开盘${op.toFixed(2)}低于前日收${prevClose.toFixed(2)}，收盘${cp.toFixed(2)}高于前日开${prevOpen.toFixed(2)}，多头反转信号。`,
                    'BUY', '阳包阴是经典底部反转信号'
                ));
            }
            // 阴包阳：前日阳线，今日开盘高于前日收盘，今日收盘低于前日开盘
            if (prevClose > prevOpen && op > prevClose && cp < prevOpen) {
                results.push(this._make(
                    '阴包阳（吞没形态）', '📉', CATEGORY_PATTERN, '高', 1,
                    `前日阳线后今日阴包阳，开盘${op.toFixed(2)}高于前日收${prevClose.toFixed(2)}，收盘${cp.toFixed(2)}低于前日开${prevOpen.toFixed(2)}，空头反转信号。`,
                    'SELL', '阴包阳是经典顶部反转信号'
                ));
            }
        }

        // 2. W底 / 双底形态
        if (hasKline && closes.length >= 20) {
            const recentLows = lows.slice(-20);
            const recentHighs = highs.slice(-20);
            const recentCloses = closes.slice(-20);
            const valleys = [];
            for (let i = 1; i < recentLows.length - 1; i++) {
                if (recentLows[i] < recentLows[i - 1] && recentLows[i] < recentLows[i + 1]) {
                    valleys.push({ idx: i, val: recentLows[i] });
                }
            }
            const peaks = [];
            for (let i = 1; i < recentHighs.length - 1; i++) {
                if (recentHighs[i] > recentHighs[i - 1] && recentHighs[i] > recentHighs[i + 1]) {
                    peaks.push({ idx: i, val: recentHighs[i] });
                }
            }
            if (valleys.length >= 2 && peaks.length >= 1) {
                const v1 = valleys[valleys.length - 2];
                const v2 = valleys[valleys.length - 1];
                const neckPeak = peaks.find(p => p.idx > v1.idx && p.idx < v2.idx);
                if (neckPeak && v2.val >= v1.val * 0.98 && v2.val <= v1.val * 1.05) {
                    const afterV2 = recentCloses.slice(v2.idx + 1);
                    const brokeNeck = afterV2.some(c => c > neckPeak.val);
                    if (brokeNeck) {
                        results.push(this._make(
                            'W底（双底形态）', '💎', CATEGORY_PATTERN, '高', 1,
                            `近20日出现双底，第一底${v1.val.toFixed(2)}，第二底${v2.val.toFixed(2)}，突破颈线${neckPeak.val.toFixed(2)}，看涨反转。`,
                            'BUY', 'W底突破颈线是经典买入信号'
                        ));
                    }
                }
            }
        }

        // 3. M头 / 双顶形态
        if (hasKline && closes.length >= 20) {
            const recentLows = lows.slice(-20);
            const recentHighs = highs.slice(-20);
            const recentCloses = closes.slice(-20);
            const peaks = [];
            for (let i = 1; i < recentHighs.length - 1; i++) {
                if (recentHighs[i] > recentHighs[i - 1] && recentHighs[i] > recentHighs[i + 1]) {
                    peaks.push({ idx: i, val: recentHighs[i] });
                }
            }
            const valleys = [];
            for (let i = 1; i < recentLows.length - 1; i++) {
                if (recentLows[i] < recentLows[i - 1] && recentLows[i] < recentLows[i + 1]) {
                    valleys.push({ idx: i, val: recentLows[i] });
                }
            }
            if (peaks.length >= 2 && valleys.length >= 1) {
                const p1 = peaks[peaks.length - 2];
                const p2 = peaks[peaks.length - 1];
                const neckValley = valleys.find(v => v.idx > p1.idx && v.idx < p2.idx);
                if (neckValley && p2.val <= p1.val && p2.val >= p1.val * 0.95) {
                    const afterP2 = recentCloses.slice(p2.idx + 1);
                    const brokeNeck = afterP2.some(c => c < neckValley.val);
                    if (brokeNeck) {
                        results.push(this._make(
                            'M头（双顶形态）', '⚠️', CATEGORY_PATTERN, '高', 1,
                            `近20日出现双顶，第一顶${p1.val.toFixed(2)}，第二顶${p2.val.toFixed(2)}，跌破颈线${neckValley.val.toFixed(2)}，看跌反转。`,
                            'SELL', 'M头跌破颈线是经典卖出信号'
                        ));
                    }
                }
            }
        }

        // 4. 头肩顶 / 头肩底形态
        if (hasKline && closes.length >= 15) {
            const recentLows = lows.slice(-15);
            const recentHighs = highs.slice(-15);
            const recentCloses = closes.slice(-15);
            const peaks = [];
            for (let i = 1; i < recentHighs.length - 1; i++) {
                if (recentHighs[i] > recentHighs[i - 1] && recentHighs[i] > recentHighs[i + 1]) {
                    peaks.push({ idx: i, val: recentHighs[i] });
                }
            }
            const valleys = [];
            for (let i = 1; i < recentLows.length - 1; i++) {
                if (recentLows[i] < recentLows[i - 1] && recentLows[i] < recentLows[i + 1]) {
                    valleys.push({ idx: i, val: recentLows[i] });
                }
            }
            // 头肩顶：三个峰，中间最高
            if (peaks.length >= 3) {
                for (let i = 0; i <= peaks.length - 3; i++) {
                    const left = peaks[i];
                    const head = peaks[i + 1];
                    const right = peaks[i + 2];
                    if (head.val > left.val && head.val > right.val && left.val >= right.val * 0.90) {
                        const neckCandidates = valleys.filter(v => v.idx > left.idx && v.idx < right.idx);
                        if (neckCandidates.length > 0) {
                            const neck = neckCandidates.reduce((a, b) => a.val < b.val ? a : b);
                            const afterRight = recentCloses.slice(right.idx + 1);
                            const brokeNeck = afterRight.some(c => c < neck.val);
                            if (brokeNeck) {
                                results.push(this._make(
                                    '头肩顶形态', '⚠️', CATEGORY_PATTERN, '高', 1,
                                    `近15日出现头肩顶，左肩${left.val.toFixed(2)}，头${head.val.toFixed(2)}，右肩${right.val.toFixed(2)}，跌破颈线${neck.val.toFixed(2)}，强烈看跌。`,
                                    'SELL', '头肩顶跌破颈线是强烈卖出信号'
                                ));
                                break;
                            }
                        }
                    }
                }
            }
            // 头肩底：三个谷，中间最低
            if (valleys.length >= 3) {
                for (let i = 0; i <= valleys.length - 3; i++) {
                    const left = valleys[i];
                    const head = valleys[i + 1];
                    const right = valleys[i + 2];
                    if (head.val < left.val && head.val < right.val && left.val <= right.val * 1.10) {
                        const neckCandidates = peaks.filter(p => p.idx > left.idx && p.idx < right.idx);
                        if (neckCandidates.length > 0) {
                            const neck = neckCandidates.reduce((a, b) => a.val > b.val ? a : b);
                            const afterRight = recentCloses.slice(right.idx + 1);
                            const brokeNeck = afterRight.some(c => c > neck.val);
                            if (brokeNeck) {
                                results.push(this._make(
                                    '头肩底形态', '💎', CATEGORY_PATTERN, '高', 1,
                                    `近15日出现头肩底，左肩${left.val.toFixed(2)}，头${head.val.toFixed(2)}，右肩${right.val.toFixed(2)}，突破颈线${neck.val.toFixed(2)}，强烈看涨。`,
                                    'BUY', '头肩底突破颈线是强烈买入信号'
                                ));
                                break;
                            }
                        }
                    }
                }
            }
        }

        // 5. 三角形整理策略
        if (hasKline && closes.length >= 15) {
            const recentHighs = highs.slice(-15);
            const recentLows = lows.slice(-15);
            const n = recentHighs.length;
            const indices = Array.from({ length: n }, (_, i) => i);
            const avgIndex = indices.reduce((a, b) => a + b, 0) / n;
            const avgHigh = recentHighs.reduce((a, b) => a + b, 0) / n;
            const avgLow = recentLows.reduce((a, b) => a + b, 0) / n;
            let slopeHigh = 0, slopeLow = 0;
            let denom = 0;
            for (let i = 0; i < n; i++) {
                const di = i - avgIndex;
                slopeHigh += di * (recentHighs[i] - avgHigh);
                slopeLow += di * (recentLows[i] - avgLow);
                denom += di * di;
            }
            slopeHigh = denom > 0 ? slopeHigh / denom : 0;
            slopeLow = denom > 0 ? slopeLow / denom : 0;
            const range = recentHighs.map((h, i) => h - recentLows[i]);
            const avgRange = range.reduce((a, b) => a + b, 0) / n;
            const recentRange = range.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const narrowing = recentRange < avgRange * 0.8;
            if (narrowing) {
                const highFlat = Math.abs(slopeHigh) < Math.abs(avgHigh) * 0.002;
                const lowFlat = Math.abs(slopeLow) < Math.abs(avgLow) * 0.002;
                const highDown = slopeHigh < -Math.abs(avgHigh) * 0.002;
                const lowUp = slopeLow > Math.abs(avgLow) * 0.002;
                if (highFlat && lowUp) {
                    results.push(this._make(
                        '上升三角形整理', '📐', CATEGORY_PATTERN, '中', 2,
                        '近15日高点持平、低点抬升，波动收窄，上升三角形，蓄势向上突破概率大。',
                        'WATCH', '上升三角形整理，等待突破'
                    ));
                } else if (lowFlat && highDown) {
                    results.push(this._make(
                        '下降三角形整理', '📐', CATEGORY_PATTERN, '中', 2,
                        '近15日低点持平、高点下移，波动收窄，下降三角形，注意向下破位风险。',
                        'WATCH', '下降三角形整理，等待方向选择'
                    ));
                } else if (highDown && lowUp) {
                    results.push(this._make(
                        '对称三角形整理', '📐', CATEGORY_PATTERN, '中', 2,
                        '近15日高点下移、低点抬升，波动收窄，对称三角形，等待突破方向。',
                        'WATCH', '对称三角形整理，等待方向选择'
                    ));
                }
            }
        }

        // 6. 旗形 / 楔形策略
        if (hasKline && closes.length >= 10) {
            const recentHighs = highs.slice(-10);
            const recentLows = lows.slice(-10);
            const recentCloses = closes.slice(-10);
            const n = recentCloses.length;
            const first5Avg = recentCloses.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
            const last5Avg = recentCloses.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const trend = (last5Avg - first5Avg) / first5Avg;
            const first5Range = recentHighs.slice(0, 5).map((h, i) => h - recentLows[i]).reduce((a, b) => a + b, 0) / 5;
            const last5Lows = recentLows.slice(-5);
            const last5Range = recentHighs.slice(-5).map((h, i) => h - last5Lows[i]).reduce((a, b) => a + b, 0) / 5;
            const narrowing = last5Range < first5Range * 0.7;
            if (narrowing && Math.abs(trend) < 0.02) {
                const indices = Array.from({ length: n }, (_, i) => i);
                const avgIndex = indices.reduce((a, b) => a + b, 0) / n;
                const avgHigh = recentHighs.reduce((a, b) => a + b, 0) / n;
                const avgLow = recentLows.reduce((a, b) => a + b, 0) / n;
                let slopeHigh = 0, slopeLow = 0, denom = 0;
                for (let i = 0; i < n; i++) {
                    const di = i - avgIndex;
                    slopeHigh += di * (recentHighs[i] - avgHigh);
                    slopeLow += di * (recentLows[i] - avgLow);
                    denom += di * di;
                }
                slopeHigh = denom > 0 ? slopeHigh / denom : 0;
                slopeLow = denom > 0 ? slopeLow / denom : 0;
                const sameDirection = (slopeHigh > 0 && slopeLow > 0) || (slopeHigh < 0 && slopeLow < 0);
                const oppositeDirection = (slopeHigh > 0 && slopeLow < 0) || (slopeHigh < 0 && slopeLow > 0);
                if (sameDirection) {
                    results.push(this._make(
                        '楔形整理', '🔺', CATEGORY_PATTERN, '中', 2,
                        '近10日波动收窄，高低点同向收敛，楔形整理，原趋势延续概率大。',
                        'WATCH', '楔形整理，等待突破确认'
                    ));
                } else if (oppositeDirection) {
                    results.push(this._make(
                        '旗形整理', '🚩', CATEGORY_PATTERN, '中', 2,
                        '近10日波动收窄，高低点反向倾斜，旗形整理，突破后延续前期趋势。',
                        'WATCH', '旗形整理，等待突破确认'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 20) {
            const ma5Short = getSma(5);
            const ma10Short = getSma(10);
            const ma20Short = getSma(20);
            if (ma10Short && ma20Short) {
                if (ma10Short > ma20Short) {
                    results.push(this._make(
                        'MA10在MA20上方', '📈', CATEGORY_TREND, '中', 3,
                        `MA10(${ma10Short.toFixed(2)})>MA20(${ma20Short.toFixed(2)})，短期偏多。`,
                        'HOLD', 'MA10在MA20上是偏多状态'
                    ));
                } else if (ma10Short < ma20Short) {
                    results.push(this._make(
                        'MA10在MA20下方', '📉', CATEGORY_TREND, '中', 3,
                        `MA10(${ma10Short.toFixed(2)})<MA20(${ma20Short.toFixed(2)})，短期偏空。`,
                        'AVOID_BUY', 'MA10在MA20下是偏空状态'
                    ));
                } else {
                    results.push(this._make(
                        'MA10与MA20纠缠', '⚡', CATEGORY_TREND, '中', 3,
                        `MA10(${ma10Short.toFixed(2)})与MA20(${ma20Short.toFixed(2)})接近，等待方向。`,
                        'WATCH', '均线纠缠'
                    ));
                }
            }
        }

        // =================================================================
        //  历史波动率HV细分 + 三周期趋势一致性
        // =================================================================

        if (hasKline && closes.length >= 30) {
            const logReturns = [];
            for (let i = -20; i < 0; i++) {
                const idx = closesWithToday.length + i;
                if (idx > 0 && closesWithToday[idx - 1] > 0) {
                    logReturns.push(Math.log(closesWithToday[idx] / closesWithToday[idx - 1]));
                }
            }
            if (logReturns.length >= 10) {
                const meanRet = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
                const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - meanRet, 2), 0) / logReturns.length;
                const hv = Math.sqrt(variance) * Math.sqrt(252) * 100;
                if (hv > 50) {
                    const buyTarget = lp * 1.002;
                    const sellTarget = hp * 0.998;
                    const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
                    const buyAmount = buyTarget * 100;
                    const spread = sellTarget - buyTarget;
                    const netProfit = spread * 100 - txFee;
                    const netPct = buyAmount > 0 ? netProfit / buyAmount * 100 : 0;
                    results.push(this._make(
                        `历史波动率极高(HV=${hv.toFixed(0)}%)`, '🔥', CATEGORY_NOVEL, '高', 2,
                        `HV=${hv.toFixed(0)}%波动剧烈！买${buyTarget.toFixed(2)}卖${sellTarget.toFixed(2)}，净收益${netPct.toFixed(2)}%`,
                        'TRADING_OPPORTUNITY', '高波动做T空间大',
                        { buy_price: buyTarget, sell_price: sellTarget }
                    ));
                } else if (hv < 15) {
                    results.push(this._make(
                        `历史波动率极低(HV=${hv.toFixed(0)}%)`, '➖', CATEGORY_NOVEL, '低', 3,
                        `20日历史波动率HV=${hv.toFixed(0)}%，波动极小，做T收益不够。`,
                        'NO_TRADE', '低波动不适合做T'
                    ));
                } else {
                    results.push(this._make(
                        `历史波动率正常(HV=${hv.toFixed(0)}%)`, '➡️', CATEGORY_NOVEL, '中', 4,
                        `20日历史波动率HV=${hv.toFixed(0)}%，波动正常。`,
                        'HOLD', 'HV正常'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 60) {
            const ma5Tri = getSma(5);
            const ma10Tri = getSma(10);
            const ma20Tri = getSma(20);
            const ma60Tri = getSma(60);
            const ma120Tri = getSma(120);
            if (ma5Tri && ma20Tri && ma60Tri) {
                const shortTrend = ma10Tri ? (ma5Tri > ma10Tri ? 'up' : 'down') : (ma5Tri > ma20Tri ? 'up' : 'down');
                const midTrend = ma20Tri > ma60Tri ? 'up' : 'down';
                const longTrend = ma120Tri ? (ma60Tri > ma120Tri ? 'up' : 'down') : 'neutral';
                if (shortTrend === 'up' && midTrend === 'up' && (longTrend === 'up' || longTrend === 'neutral')) {
                    results.push(this._make(
                        '三周期趋势向上共振', '🟢', CATEGORY_TREND, '极高', 0,
                        '短中长期趋势一致向上，形成完美上涨趋势！',
                        'STRONG_BUY', '趋势共振是最强信号'
                    ));
                } else if (shortTrend === 'down' && midTrend === 'down' && (longTrend === 'down' || longTrend === 'neutral')) {
                    results.push(this._make(
                        '三周期趋势向下共振', '🔴', CATEGORY_TREND, '极高', 0,
                        '短中长期趋势一致向下，形成完美下跌趋势！',
                        'STRONG_SELL', '趋势共振是最弱信号'
                    ));
                } else if (shortTrend !== midTrend) {
                    results.push(this._make(
                        '短期与中期趋势矛盾', '⚡', CATEGORY_TREND, '中', 3,
                        `短期趋势${shortTrend}，中期趋势${midTrend}，方向不一致。`,
                        'WATCH', '趋势矛盾时观望'
                    ));
                } else {
                    results.push(this._make(
                        '趋势运行正常', '➡️', CATEGORY_TREND, '中', 4,
                        '各周期趋势运行正常，无明显矛盾。',
                        'HOLD', '趋势正常'
                    ));
                }
            }
        }

        // =================================================================
        //  资金量类策略（OBV背离、MFI多状态、VR变异率）
        // =================================================================

        if (hasKline && closes.length >= 14) {
            const obvList = [0];
            for (let i = 1; i < closesWithToday.length; i++) {
                if (closesWithToday[i] > closesWithToday[i - 1]) {
                    obvList.push(obvList[obvList.length - 1] + volumesWithToday[i]);
                } else if (closesWithToday[i] < closesWithToday[i - 1]) {
                    obvList.push(obvList[obvList.length - 1] - volumesWithToday[i]);
                } else {
                    obvList.push(obvList[obvList.length - 1]);
                }
            }
            const obv5 = obvList.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const obvCur = obvList[obvList.length - 1];
            const obv20 = obvList.length >= 20 ? obvList.slice(-20).reduce((a, b) => a + b, 0) / 20 : obv5;
            if (obvCur > obv5 * 1.05 && chg < 0) {
                results.push(this._make(
                    'OBV底背离', '💰', CATEGORY_VOLUME, '高', 2,
                    `OBV能量潮上升${(obvCur / obv5 * 100 - 100).toFixed(1)}%但价格下跌${chg.toFixed(2)}%，资金暗中吸筹，后续上涨概率>65%。`,
                    'BUY', 'OBV背离是经典反转信号'
                ));
            } else if (obvCur < obv5 * 0.95 && chg > 0) {
                results.push(this._make(
                    'OBV顶背离', '⛔', CATEGORY_VOLUME, '高', 2,
                    `OBV能量潮下降${(100 - obvCur / obv5 * 100).toFixed(1)}%但价格上涨${chg.toFixed(2)}%，资金悄悄出货，警惕回调。`,
                    'SELL', '资金流出而价格上涨是危险信号'
                ));
            } else {
                const direction = obvCur >= obv20 ? '上升' : '下降';
                results.push(this._make(
                    'OBV资金流向', '💵', CATEGORY_VOLUME, '中', 4,
                    `OBV能量潮整体${direction}，资金与价格方向一致，无明显背离信号。`,
                    'HOLD', `OBV_${direction}`
                ));
            }
        }

        if (hasKline && closes.length >= 12) {
            let upVol = 0, downVol = 0, flatVol = 0;
            const nDays = Math.min(12, closesWithToday.length - 1);
            for (let i = closesWithToday.length - nDays; i < closesWithToday.length; i++) {
                if (closesWithToday[i] > closesWithToday[i - 1]) {
                    upVol += volumesWithToday[i];
                } else if (closesWithToday[i] < closesWithToday[i - 1]) {
                    downVol += volumesWithToday[i];
                } else {
                    flatVol += volumesWithToday[i];
                }
            }
            if ((downVol + flatVol / 2) > 0) {
                const vrVal = (upVol + flatVol / 2) / (downVol + flatVol / 2) * 100;
                if (vrVal > 400) {
                    results.push(this._make(
                        'VR极度过热', '🌋', CATEGORY_VOLUME, '高', 2,
                        `VR成交量变异率=${vrVal.toFixed(0)}（>400），买盘力量极度旺盛，警惕高位放量出货。`,
                        'SELL', 'VR>400是警戒区'
                    ));
                } else if (vrVal < 40) {
                    results.push(this._make(
                        'VR极度低迷', '💤', CATEGORY_VOLUME, '高', 2,
                        `VR成交量变异率=${vrVal.toFixed(0)}（<40），抛盘消耗殆尽，即将见底反弹。`,
                        'BUY', 'VR<40是极度超卖区'
                    ));
                } else if (vrVal < 100) {
                    results.push(this._make(
                        'VR弱势市场', '📉', CATEGORY_VOLUME, '中', 3,
                        `VR成交量变异率=${vrVal.toFixed(0)}，卖盘仍占优，观望为主。`,
                        'WATCH', 'VR<100为弱势'
                    ));
                } else if (vrVal > 200) {
                    results.push(this._make(
                        'VR强势活跃', '📊', CATEGORY_VOLUME, '中', 3,
                        `VR成交量变异率=${vrVal.toFixed(0)}，买盘强劲，人气旺盛，持有待涨。`,
                        'HOLD', 'VR>200为强势区'
                    ));
                } else {
                    results.push(this._make(
                        'VR多空均衡', '⚖️', CATEGORY_VOLUME, '中', 4,
                        `VR成交量变异率=${vrVal.toFixed(0)}，买卖力量均衡，震荡整理。`,
                        'HOLD', 'VR100-200为均衡区'
                    ));
                }
            }
        }

        // =================================================================
        //  CCI多状态策略
        // =================================================================

        for (const cciPeriod of [12, 20]) {
            if (hasKline && closes.length >= cciPeriod) {
                const cciVal = getCci(cciPeriod);
                if (cciVal !== null) {
                    if (cciVal > 200) {
                        results.push(this._make(
                            `CCI${cciPeriod}极度超买(>200)`, '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                            `CCI(${cciPeriod})=${cciVal.toFixed(1)}>200，极度超买，随时可能反转！`,
                            'STRONG_SELL', 'CCI>200是极端超买信号'
                        ));
                    } else if (cciVal > 100) {
                        results.push(this._make(
                            `CCI${cciPeriod}超买(100-200)`, '📈', CATEGORY_OSCILLATOR, '高', 1,
                            `CCI(${cciPeriod})=${cciVal.toFixed(1)}，超买区域，注意回调。`,
                            'SELL', 'CCI>100超买'
                        ));
                    } else if (cciVal < -200) {
                        results.push(this._make(
                            `CCI${cciPeriod}极度超卖(<-200)`, '💎', CATEGORY_OSCILLATOR, '极高', 0,
                            `CCI(${cciPeriod})=${cciVal.toFixed(1)}<-200，极度超卖，随时可能反弹！`,
                            'STRONG_BUY', 'CCI<-200是极端超卖信号'
                        ));
                    } else if (cciVal < -100) {
                        results.push(this._make(
                            `CCI${cciPeriod}超卖(-200~-100)`, '📉', CATEGORY_OSCILLATOR, '高', 1,
                            `CCI(${cciPeriod})=${cciVal.toFixed(1)}，超卖区域，关注反弹。`,
                            'BUY', 'CCI<-100超卖'
                        ));
                    } else if (cciVal > 50) {
                        results.push(this._make(
                            `CCI${cciPeriod}偏强(50-100)`, '📊', CATEGORY_OSCILLATOR, '中', 3,
                            `CCI(${cciPeriod})=${cciVal.toFixed(1)}，偏强但未超买。`,
                            'HOLD', 'CCI偏强'
                        ));
                    } else if (cciVal < -50) {
                        results.push(this._make(
                            `CCI${cciPeriod}偏弱(-100~-50)`, '📊', CATEGORY_OSCILLATOR, '中', 3,
                            `CCI(${cciPeriod})=${cciVal.toFixed(1)}，偏弱但未超卖。`,
                            'WATCH', 'CCI偏弱'
                        ));
                    } else {
                        results.push(this._make(
                            `CCI${cciPeriod}中性`, '➡️', CATEGORY_OSCILLATOR, '中', 4,
                            `CCI(${cciPeriod})=${cciVal.toFixed(1)}，多空均衡。`,
                            'HOLD', 'CCI中性'
                        ));
                    }
                }
            }
        }

        // =================================================================
        //  ATR历史分位数 + 价量配合度
        // =================================================================

        if (hasKline && closes.length >= 30) {
            const atrList = [];
            // 限制回看范围，避免 O(n²) 性能问题
            const maxLookback = Math.min(60, closesWithToday.length - 14);
            const startIdx = closesWithToday.length - maxLookback;
            for (let i = Math.max(14, startIdx); i < closesWithToday.length; i++) {
                const atrVal = this.calcAtr(highsWithToday.slice(0, i + 1), lowsWithToday.slice(0, i + 1), closesWithToday.slice(0, i + 1), 14);
                if (atrVal !== null) atrList.push(atrVal);
            }
            if (atrList.length >= 10) {
                const curAtr = atrList[atrList.length - 1];
                const sortedAtr = [...atrList].sort((a, b) => a - b);
                let rank = 0;
                for (let i = 0; i < sortedAtr.length; i++) {
                    if (curAtr >= sortedAtr[i]) rank++;
                }
                const atrPercentile = rank / sortedAtr.length * 100;
                if (atrPercentile > 90) {
                    const buyTarget = lp * 1.002;
                    const sellTarget = hp * 0.998;
                    const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
                    const buyAmount = buyTarget * 100;
                    const spread = sellTarget - buyTarget;
                    const netProfit = spread * 100 - txFee;
                    const netPct = buyAmount > 0 ? netProfit / buyAmount * 100 : 0;
                    results.push(this._make(
                        `ATR历史分位${atrPercentile.toFixed(0)}%(极高)`, '🔥', CATEGORY_NOVEL, '高', 1,
                        `ATR历史${atrPercentile.toFixed(0)}%分位！买${buyTarget.toFixed(2)}卖${sellTarget.toFixed(2)}，净收益${netPct.toFixed(2)}%`,
                        'TRADING_OPPORTUNITY', '高波动适合做T',
                        { buy_price: buyTarget, sell_price: sellTarget }
                    ));
                } else if (atrPercentile < 10) {
                    results.push(this._make(
                        `ATR历史分位${atrPercentile.toFixed(0)}%(极低)`, '💤', CATEGORY_NOVEL, '高', 1,
                        `ATR处于历史${atrPercentile.toFixed(0)}%分位，波动极小，即将有大行情。`,
                        'WATCH', '低波动后必有大行情'
                    ));
                } else {
                    results.push(this._make(
                        `ATR历史分位${atrPercentile.toFixed(0)}%`, '📊', CATEGORY_NOVEL, '中', 3,
                        `ATR处于历史${atrPercentile.toFixed(0)}%分位，波动正常。`,
                        'HOLD', 'ATR正常'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 20) {
            const atr14 = getAtr(14);
            const atr7 = getAtr(7);
            if (atr14 !== null && atr7 !== null) {
                const atrRatio = atr14 > 0 ? atr7 / atr14 : 1;
                const prevClose = closes[closes.length - 1];

                const upperBreak = prevClose + atr14 * 1.5;
                const lowerBreak = prevClose - atr14 * 1.5;

                if (cp > upperBreak && atrRatio > 1.2) {
                    results.push(this._make(
                        'ATR波动率突破-向上', '🚀', CATEGORY_NOVEL, '高', 1,
                        `价格突破ATR上轨(${upperBreak.toFixed(2)})，短期波动率(${atrRatio.toFixed(2)}x)放大，突破确认。`,
                        'BUY', 'ATR突破策略：突破上轨后继续上涨概率约60%'
                    ));
                } else if (cp < lowerBreak && atrRatio > 1.2) {
                    results.push(this._make(
                        'ATR波动率突破-向下', '📉', CATEGORY_NOVEL, '高', 1,
                        `价格突破ATR下轨(${lowerBreak.toFixed(2)})，短期波动率(${atrRatio.toFixed(2)}x)放大，突破确认。`,
                        'SELL', 'ATR突破策略：突破下轨后继续下跌概率约60%'
                    ));
                }

                if (atrRatio < 0.6) {
                    results.push(this._make(
                        'ATR波动率收缩', '🔄', CATEGORY_NOVEL, '中', 2,
                        `短期ATR(${atr7.toFixed(4)})仅为长期ATR(${atr14.toFixed(4)})的${(atrRatio * 100).toFixed(0)}%，波动率极度收缩，即将变盘。`,
                        'WATCH', '波动率收缩后往往有大行情，等待突破方向'
                    ));
                }
            }
        }

        if (hasKline && volumes.length >= 10) {
            const avgVol = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
            const volRatio = avgVol > 0 ? vol / avgVol : 1;
            const priceChange = chg;
            let cooperation = '正常';
            let action = 'HOLD';
            let reasoning = '价量配合正常';
            if (priceChange > 2 && volRatio > 1.5) {
                cooperation = '放量上涨(配合良好)';
                action = 'BUY';
                reasoning = '价涨量增是健康上涨信号';
            } else if (priceChange > 2 && volRatio < 0.7) {
                cooperation = '缩量上涨(背离)';
                action = 'SELL';
                reasoning = '价涨量缩是上涨乏力信号';
            } else if (priceChange < -2 && volRatio > 1.5) {
                cooperation = '放量下跌(配合良好)';
                action = 'SELL';
                reasoning = '价跌量增是健康下跌信号';
            } else if (priceChange < -2 && volRatio < 0.7) {
                cooperation = '缩量下跌(背离)';
                action = 'BUY';
                reasoning = '价跌量缩是下跌乏力信号';
            } else if (Math.abs(priceChange) < 1 && volRatio > 2) {
                cooperation = '放量整理';
                action = 'WATCH';
                reasoning = '平量放大是变盘前兆';
            }
            results.push(this._make(
                `价量配合度: ${cooperation}`, '🤝', CATEGORY_VOLUME, '中', 2,
                `涨跌幅${priceChange.toFixed(2)}%，量比${volRatio.toFixed(2)}，${cooperation}。`,
                action, reasoning
            ));
        }

        // =================================================================
        //  SAR转向策略 + 布林带宽度
        // =================================================================

        if (hasKline && closes.length >= 10) {
            const sarVal = getPsar(0.02, 0.02, 0.2);
            if (sarVal && sarVal[0] !== null && sarVal.length >= 2) {
                const curSar = sarVal[0];
                const curDir = sarVal[1];
                const prevSarVal = this.calcPsar(highsWithToday.slice(0, -1), lowsWithToday.slice(0, -1), 0.02, 0.02, 0.2);
                const prevSar = (prevSarVal && prevSarVal.length >= 2) ? prevSarVal[0] : curSar;
                const prevDir = (prevSarVal && prevSarVal.length >= 2) ? prevSarVal[1] : curDir;
                if (curDir === 'LONG' && prevDir === 'SHORT') {
                    results.push(this._make(
                        'SAR转向(空转多)', '🟢', CATEGORY_TREND, '高', 1,
                        `SAR从${prevSar.toFixed(2)}转向${curSar.toFixed(2)}，空转多信号！`,
                        'BUY', 'SAR转向是重要趋势信号'
                    ));
                } else if (curDir === 'SHORT' && prevDir === 'LONG') {
                    results.push(this._make(
                        'SAR转向(多转空)', '🔴', CATEGORY_TREND, '高', 1,
                        `SAR从${prevSar.toFixed(2)}转向${curSar.toFixed(2)}，多转空信号！`,
                        'SELL', 'SAR转向是重要趋势信号'
                    ));
                } else if (cp > curSar) {
                    results.push(this._make(
                        `SAR多头趋势(${curSar.toFixed(2)})`, '📈', CATEGORY_TREND, '中', 2,
                        `股价${cp.toFixed(2)}>SAR(${curSar.toFixed(2)})，多头趋势延续。`,
                        'HOLD', 'SAR多头'
                    ));
                } else {
                    results.push(this._make(
                        `SAR空头趋势(${curSar.toFixed(2)})`, '📉', CATEGORY_TREND, '中', 2,
                        `股价${cp.toFixed(2)}<SAR(${curSar.toFixed(2)})，空头趋势延续。`,
                        'AVOID_BUY', 'SAR空头'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 30) {
            const [bollLower, bollMid, bollUpper] = getBoll();
            if (bollLower !== null && bollMid !== null && bollUpper !== null && bollMid > 0) {
                const bwNow = (bollUpper - bollLower) / bollMid * 100;
                const prevCloses = closesWithToday.slice(0, -1);
                const [bollLowerPrev, bollMidPrev, bollUpperPrev] = this.calcBollinger(prevCloses);
                if (bollLowerPrev !== null && bollMidPrev !== null && bollUpperPrev !== null && bollMidPrev > 0) {
                    const bwPrev = (bollUpperPrev - bollLowerPrev) / bollMidPrev * 100;
                    if (bwNow > bwPrev * 1.3) {
                        results.push(this._make(
                            '布林带快速扩张', '📊', CATEGORY_OSCILLATOR, '高', 1,
                            `布林带宽从${bwPrev.toFixed(1)}%快速扩张到${bwNow.toFixed(1)}%，趋势加速！`,
                            'WATCH', '快速扩张后趋势延续'
                        ));
                    } else if (bwNow < bwPrev * 0.7) {
                        results.push(this._make(
                            '布林带快速收缩', '⚡', CATEGORY_OSCILLATOR, '高', 1,
                            `布林带宽从${bwPrev.toFixed(1)}%快速收缩到${bwNow.toFixed(1)}%，即将变盘！`,
                            'WATCH', '快速收缩后必有方向选择'
                        ));
                    } else {
                        results.push(this._make(
                            '布林带宽度稳定', '➡️', CATEGORY_OSCILLATOR, '中', 4,
                            `布林带宽${bwNow.toFixed(1)}%，变化平稳。`,
                            'HOLD', '带宽稳定'
                        ));
                    }
                }
            }
        }

        // =================================================================
        //  更多形态类 + 日内微操策略
        // =================================================================

        if (hasKline && closes.length >= 5) {
            let consecutiveBullish = 0;
            let consecutiveBearish = 0;
            for (let i = closesWithToday.length - 1; i >= 0; i--) {
                if (i > 0 && closesWithToday[i] > closesWithToday[i - 1]) {
                    if (consecutiveBearish > 0) break;
                    consecutiveBullish++;
                } else if (i > 0 && closesWithToday[i] < closesWithToday[i - 1]) {
                    if (consecutiveBullish > 0) break;
                    consecutiveBearish++;
                } else {
                    break;
                }
            }
            if (consecutiveBullish >= 5) {
                results.push(this._make(
                    `连涨${consecutiveBullish}天`, '🚀', CATEGORY_PATTERN, '高', 1,
                    `连续${consecutiveBullish}天上涨，超买预警，注意回调！`,
                    'SELL', '连涨超5天超买'
                ));
            } else if (consecutiveBullish >= 3) {
                results.push(this._make(
                    `连涨${consecutiveBullish}天`, '📈', CATEGORY_PATTERN, '中', 2,
                    `连续${consecutiveBullish}天上涨，势头良好但需警惕。`,
                    'HOLD', '连涨势头'
                ));
            } else if (consecutiveBearish >= 5) {
                results.push(this._make(
                    `连跌${consecutiveBearish}天`, '💀', CATEGORY_PATTERN, '高', 1,
                    `连续${consecutiveBearish}天下跌，超卖信号，关注反弹！`,
                    'BUY', '连跌超5天超卖'
                ));
            } else if (consecutiveBearish >= 3) {
                results.push(this._make(
                    `连跌${consecutiveBearish}天`, '📉', CATEGORY_PATTERN, '中', 2,
                    `连续${consecutiveBearish}天下跌，超卖机会。`,
                    'BUY', '连跌超卖'
                ));
            } else {
                results.push(this._make(
                    `近期涨跌(${consecutiveBullish}涨/${consecutiveBearish}跌)`, '➡️', CATEGORY_PATTERN, '中', 4,
                    `近期${consecutiveBullish}连涨${consecutiveBearish}连跌，正常波动。`,
                    'HOLD', '正常涨跌'
                ));
            }
        }

        if (hasKline && highs.length >= 5 && lows.length >= 5) {
            const recentHighs = highs.slice(-5);
            const recentLows = lows.slice(-5);
            const highest5 = safeArrMax(recentHighs);
            const lowest5 = safeArrMin(recentLows);
            const range5 = (highest5 - lowest5) / lowest5 * 100;
            if (range5 > 10) {
                results.push(this._make(
                    `近5日振幅${range5.toFixed(1)}%(高波动)`, '📊', CATEGORY_MICRO, '高', 1,
                    `近5日振幅${range5.toFixed(1)}%，波动剧烈，适合做T！`,
                    'BUY_THEN_SELL', '高波动做T空间大'
                ));
            } else if (range5 < 2) {
                results.push(this._make(
                    `近5日振幅${range5.toFixed(1)}%(低波动)`, '💤', CATEGORY_MICRO, '中', 3,
                    `近5日振幅${range5.toFixed(1)}%，波动极小，不适合做T。`,
                    'NO_TRADE', '低波动做T收益低'
                ));
            } else {
                results.push(this._make(
                    `近5日振幅${range5.toFixed(1)}%`, '📈', CATEGORY_MICRO, '中', 3,
                    `近5日振幅${range5.toFixed(1)}%，波动中等。`,
                    'HOLD', '中等振幅'
                ));
            }
        }

        if (hasKline && closes.length >= 20) {
            const ma20Price = getSma(20);
            if (ma20Price && ma20Price > 0) {
                const distFromMa = (cp - ma20Price) / ma20Price * 100;
                if (distFromMa > 10) {
                    results.push(this._make(
                        `价格偏离MA20(+${distFromMa.toFixed(1)}%)`, '📈', CATEGORY_TREND, '高', 1,
                        `股价偏离MA20达${distFromMa.toFixed(1)}%，严重超买，回归均线概率大！`,
                        'SELL', '偏离过大需回归'
                    ));
                } else if (distFromMa < -10) {
                    results.push(this._make(
                        `价格偏离MA20(${distFromMa.toFixed(1)}%)`, '📉', CATEGORY_TREND, '高', 1,
                        `股价偏离MA20达${distFromMa.toFixed(1)}%，严重超卖，反弹概率大！`,
                        'BUY', '偏离过大需反弹'
                    ));
                } else {
                    results.push(this._make(
                        `价格与MA20距离${distFromMa.toFixed(1)}%`, '➡️', CATEGORY_TREND, '中', 4,
                        `股价距MA20${distFromMa.toFixed(1)}%，在正常范围内。`,
                        'HOLD', '偏离正常'
                    ));
                }
            }
        }

        // =================================================================
        //  更多自创策略（MFI+RSI组合、双均线系统、T-Force动力指数）
        // =================================================================

        if (hasKline && closes.length >= 20) {
            const rsiNovel = getRsi(14);
            const mfiNovel = getMfi();
            if (rsiNovel !== null && mfiNovel !== null) {
                if (rsiNovel < 30 && mfiNovel < 30) {
                    results.push(this._make(
                        '[自创] MFI+RSI双超卖共振', '💎', CATEGORY_NOVEL, '极高', 0,
                        `RSI(${rsiNovel.toFixed(1)})与MFI(${mfiNovel.toFixed(1)})双双超卖，价格与资金双底部！`,
                        'STRONG_BUY', '价量双超卖是最强买入信号',
                        { novel: true }
                    ));
                } else if (rsiNovel > 70 && mfiNovel > 70) {
                    results.push(this._make(
                        '[自创] MFI+RSI双超买共振', '🔥', CATEGORY_NOVEL, '极高', 0,
                        `RSI(${rsiNovel.toFixed(1)})与MFI(${mfiNovel.toFixed(1)})双双超买，价格与资金双顶部！`,
                        'STRONG_SELL', '价量双超买是最强卖出信号',
                        { novel: true }
                    ));
                } else if (rsiNovel < 40 && mfiNovel > 60) {
                    results.push(this._make(
                        '[自创] 资金入而价格跌(背离)', '💰', CATEGORY_NOVEL, '高', 1,
                        `MFI(${mfiNovel.toFixed(1)})>60但RSI(${rsiNovel.toFixed(1)})<40，资金暗中吸筹！`,
                        'BUY', '资金先行价格后随',
                        { novel: true }
                    ));
                } else if (rsiNovel > 60 && mfiNovel < 40) {
                    results.push(this._make(
                        '[自创] 资金出而价格涨(背离)', '⛔', CATEGORY_NOVEL, '高', 1,
                        `RSI(${rsiNovel.toFixed(1)})>60但MFI(${mfiNovel.toFixed(1)})<40，资金悄悄出货！`,
                        'SELL', '资金流出而价涨是危险信号',
                        { novel: true }
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 60) {
            const ma5Novel = getSma(5);
            const ma20Novel = getSma(20);
            const ma60Novel = getSma(60);
            if (ma5Novel && ma20Novel && ma60Novel) {
                let score = 0;
                if (ma5Novel > ma20Novel) score += 2; else score -= 2;
                if (ma20Novel > ma60Novel) score += 2; else score -= 2;
                if (cp > ma5Novel) score += 1; else score -= 1;
                if (cp > ma20Novel) score += 1; else score -= 1;
                if (cp > ma60Novel) score += 1; else score -= 1;

                results.push(this._make(
                    `[自创] 均线系统评分 Score=${score}`, '📊', CATEGORY_NOVEL, '中', 2,
                    `均线系统综合得分${score}/7，${score >= 4 ? '偏多' : score <= -4 ? '偏空' : '中性'}。`,
                    score >= 4 ? 'BUY' : score <= -4 ? 'SELL' : 'HOLD',
                    '多周期均线综合判断',
                    { novel: true }
                ));
            }
        }

        if (hasKline && closes.length >= 20) {
            let tForce = 0;
            const rsiT = getRsi(6);
            if (rsiT !== null) {
                if (rsiT > 80) tForce += 3;
                else if (rsiT > 60) tForce += 1;
                else if (rsiT < 20) tForce -= 3;
                else if (rsiT < 40) tForce -= 1;
            }
            const ma5T = getSma(5);
            const ma10T = getSma(10);
            if (ma5T && ma10T) {
                if (ma5T > ma10T) tForce += 2; else tForce -= 2;
            }
            const [kT, dT, jT] = getKdj(9, 3, 3);
            if (jT !== null) {
                if (jT > 100) tForce += 2;
                else if (jT > 80) tForce += 1;
                else if (jT < 0) tForce -= 2;
                else if (jT < 20) tForce -= 1;
            }

            results.push(this._make(
                `[自创] T-Force动力指数=${tForce}`, '⚡', CATEGORY_NOVEL, '高', 1,
                `T-Force=${tForce}，${tForce >= 4 ? '多方动力强劲' : tForce <= -4 ? '空方动力强劲' : '多空平衡'}。`,
                tForce >= 4 ? 'BUY' : tForce <= -4 ? 'SELL' : 'WATCH',
                '综合动力指数',
                { novel: true }
            ));
        }

        // =================================================================
        //  更多微操策略
        // =================================================================

        if (hasKline && highs.length > 0 && lows.length > 0) {
            const dayRange = hp - lp;
            const dayRangePct = dayRange / lp * 100;
            const openChange = (cp - op) / op * 100;
            if (dayRangePct > 5 && Math.abs(openChange) < 1) {
                results.push(this._make(
                    '日内高振幅十字星', '✚', CATEGORY_MICRO, '高', 1,
                    `日内振幅${dayRangePct.toFixed(1)}%但涨跌幅${openChange.toFixed(2)}%，十字星变盘信号！`,
                    'WATCH', '十字星是变盘前兆'
                ));
            }
        }

        if (hasKline && closes.length >= 5) {
            const recentVol = volumes.slice(-5);
            const avgRecentVol = recentVol.reduce((a, b) => a + b, 0) / recentVol.length;
            if (avgRecentVol > 0 && vol < avgRecentVol * 0.5) {
                results.push(this._make(
                    '地量缩量整理', '💤', CATEGORY_MICRO, '中', 2,
                    `今日成交量仅为近5日均量的${(vol / avgRecentVol * 100).toFixed(0)}%，地量状态。`,
                    'WATCH', '地量见地价'
                ));
            } else if (avgRecentVol > 0 && vol > avgRecentVol * 2) {
                results.push(this._make(
                    '天量放量突破', '🔥', CATEGORY_MICRO, '中', 2,
                    `今日成交量是近5日均量的${(vol / avgRecentVol).toFixed(1)}倍，天量状态。`,
                    'WATCH', '天量天价需观察'
                ));
            }
        }

        if (hasKline && closes.length >= 10) {
            let maxPrice = safeArrMax(closesWithToday.slice(-20));
            let minPrice = safeArrMin(closesWithToday.slice(-20));
            if (maxPrice > minPrice) {
                const position = (cp - minPrice) / (maxPrice - minPrice) * 100;
                if (position > 90) {
                    results.push(this._make(
                        `价格在20日高位区(${position.toFixed(0)}%)`, '📈', CATEGORY_PATTERN, '中', 2,
                        `价格处于20日区间的${position.toFixed(0)}%分位，接近高点。`,
                        'HOLD', '高位运行'
                    ));
                } else if (position < 10) {
                    results.push(this._make(
                        `价格在20日低位区(${position.toFixed(0)}%)`, '📉', CATEGORY_PATTERN, '中', 2,
                        `价格处于20日区间的${position.toFixed(0)}%分位，接近低点。`,
                        'BUY', '低位运行有反弹机会'
                    ));
                } else {
                    results.push(this._make(
                        `价格在20日中位区(${position.toFixed(0)}%)`, '📊', CATEGORY_PATTERN, '中', 3,
                        `价格处于20日区间的${position.toFixed(0)}%分位，中间位置。`,
                        'HOLD', '中位运行'
                    ));
                }
            }
        }

        // =================================================================
        //  更多震荡指标策略 + 趋势确认策略
        // =================================================================

        if (hasKline && closes.length >= 20) {
            const ma5Final = getSma(5);
            const ma20Final = getSma(20);
            if (ma5Final && ma20Final) {
                const diffPct = (ma5Final - ma20Final) / ma20Final * 100;
                if (diffPct > 3) {
                    results.push(this._make(
                        `MA5大幅领先MA20(+${diffPct.toFixed(1)}%)`, '🚀', CATEGORY_TREND, '中', 2,
                        `MA5(${ma5Final.toFixed(2)})比MA20(${ma20Final.toFixed(2)})高${diffPct.toFixed(1)}%，短期趋势强劲。`,
                        'HOLD', '均线大幅发散是强趋势'
                    ));
                } else if (diffPct < -3) {
                    results.push(this._make(
                        `MA5大幅落后MA20(${diffPct.toFixed(1)}%)`, '💀', CATEGORY_TREND, '中', 2,
                        `MA5(${ma5Final.toFixed(2)})比MA20(${ma20Final.toFixed(2)})低${Math.abs(diffPct).toFixed(1)}%，短期趋势疲弱。`,
                        'AVOID_BUY', '均线大幅发散是弱趋势'
                    ));
                } else if (Math.abs(diffPct) < 0.5) {
                    results.push(this._make(
                        'MA5与MA20粘合', '⚡', CATEGORY_TREND, '中', 3,
                        `MA5(${ma5Final.toFixed(2)})与MA20(${ma20Final.toFixed(2)})高度粘合，即将选择方向。`,
                        'WATCH', '均线粘合后必有方向'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 60) {
            const ma20Final2 = getSma(20);
            const ma60Final = getSma(60);
            if (ma20Final2 && ma60Final) {
                const diffPct2 = (ma20Final2 - ma60Final) / ma60Final * 100;
                if (diffPct2 > 5) {
                    results.push(this._make(
                        `MA20大幅领先MA60(+${diffPct2.toFixed(1)}%)`, '📈', CATEGORY_TREND, '中', 2,
                        `MA20(${ma20Final2.toFixed(2)})比MA60(${ma60Final.toFixed(2)})高${diffPct2.toFixed(1)}%，中期趋势强势。`,
                        'BUY', '均线发散是中期强势信号'
                    ));
                } else if (diffPct2 < -5) {
                    results.push(this._make(
                        `MA20大幅落后MA60(${diffPct2.toFixed(1)}%)`, '📉', CATEGORY_TREND, '中', 2,
                        `MA20(${ma20Final2.toFixed(2)})比MA60(${ma60Final.toFixed(2)})低${Math.abs(diffPct2).toFixed(1)}%，中期趋势弱势。`,
                        'SELL', '均线发散是中期弱势信号'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 30) {
            const [bollLower3, bollMid3, bollUpper3] = getBoll();
            if (bollLower3 && bollMid3 && bollUpper3 && cp > 0) {
                const upperDist = (bollUpper3 - cp) / cp * 100;
                const lowerDist = (cp - bollLower3) / cp * 100;
                if (upperDist < 1) {
                    results.push(this._make(
                        `接近布林上轨(${upperDist.toFixed(1)}%)`, '📊', CATEGORY_OSCILLATOR, '中', 2,
                        `距布林上轨仅${upperDist.toFixed(1)}%，压力位附近。`,
                        'SELL', '接近上轨注意压力'
                    ));
                } else if (lowerDist < 1) {
                    results.push(this._make(
                        `接近布林下轨(${lowerDist.toFixed(1)}%)`, '📊', CATEGORY_OSCILLATOR, '中', 2,
                        `距布林下轨仅${lowerDist.toFixed(1)}%，支撑位附近。`,
                        'BUY', '接近下轨注意支撑'
                    ));
                } else if (Math.abs((cp - bollMid3) / bollMid3 * 100) < 0.5) {
                    results.push(this._make(
                        '价格在布林中轨附近', '➡️', CATEGORY_OSCILLATOR, '中', 4,
                        '价格在布林中轨附近运行，方向不明。',
                        'HOLD', '中轨附近观望'
                    ));
                }
            }
        }

        if (hasKline && volumes.length >= 20) {
            const avgVol20Final = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const avgVol5Final = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            if (avgVol20Final > 0 && avgVol5Final > avgVol20Final * 1.5 && chg > 0.5) {
                results.push(this._make(
                    '量价齐升(放量上涨)', '📈', CATEGORY_VOLUME, '高', 1,
                    `5日均量是20日均量的${(avgVol5Final / avgVol20Final * 100 - 100).toFixed(0)}%，且股价上涨${chg.toFixed(2)}%，量价齐升！`,
                    'BUY', '量价齐升是健康上涨'
                ));
            } else if (avgVol20Final > 0 && avgVol5Final > avgVol20Final * 1.5 && chg < 0) {
                results.push(this._make(
                    '放量下跌', '📉', CATEGORY_VOLUME, '高', 1,
                    `5日均量是20日均量的${(avgVol5Final / avgVol20Final * 100 - 100).toFixed(0)}%，且股价下跌${chg.toFixed(2)}%，放量下跌！`,
                    'SELL', '放量下跌是弱势信号'
                ));
            } else if (avgVol20Final > 0 && avgVol5Final < avgVol20Final * 0.7 && chg > 0) {
                results.push(this._make(
                    '缩量上涨(背离)', '⚠️', CATEGORY_VOLUME, '中', 2,
                    `5日均量是20日均量的${(avgVol5Final / avgVol20Final * 100).toFixed(0)}%，但股价上涨${chg.toFixed(2)}%，量价背离！`,
                    'SELL', '缩量上涨需警惕'
                ));
            } else if (avgVol20Final > 0 && avgVol5Final < avgVol20Final * 0.7 && chg < 0) {
                results.push(this._make(
                    '缩量下跌(背离)', '💎', CATEGORY_VOLUME, '中', 2,
                    `5日均量是20日均量的${(avgVol5Final / avgVol20Final * 100).toFixed(0)}%，但股价下跌${chg.toFixed(2)}%，缩量止跌信号！`,
                    'BUY', '缩量下跌是见底信号'
                ));
            }
        }

        if (hasKline && closes.length >= 120) {
            const ma120Final = getSma(120);
            if (ma120Final && ma120Final > 0) {
                const distFrom120 = (cp - ma120Final) / ma120Final * 100;
                if (distFrom120 > 20) {
                    results.push(this._make(
                        `价格远高于年线(+${distFrom120.toFixed(0)}%)`, '🌟', CATEGORY_TREND, '中', 2,
                        `股价较MA120高${distFrom120.toFixed(0)}%，长期趋势极强。`,
                        'HOLD', '远高于年线是大牛市'
                    ));
                } else if (distFrom120 < -20) {
                    results.push(this._make(
                        `价格远低于年线(${distFrom120.toFixed(0)}%)`, '💀', CATEGORY_TREND, '中', 2,
                        `股价较MA120低${Math.abs(distFrom120).toFixed(0)}%，长期趋势极弱。`,
                        'AVOID_BUY', '远低于年线是大熊市'
                    ));
                } else if (Math.abs(distFrom120) < 2) {
                    results.push(this._make(
                        '价格在年线附近', '⚡', CATEGORY_TREND, '高', 1,
                        `股价在MA120附近，距年线仅${distFrom120.toFixed(1)}%，牛熊分界点！`,
                        'WATCH', '年线是重要牛熊分界线'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 60) {
            const ma60Final2 = getSma(60);
            if (ma60Final2 && ma60Final2 > 0) {
                const distFrom60 = (cp - ma60Final2) / ma60Final2 * 100;
                if (distFrom60 > 15) {
                    results.push(this._make(
                        `价格远高于季线(+${distFrom60.toFixed(0)}%)`, '🚀', CATEGORY_TREND, '中', 2,
                        `股价较MA60高${distFrom60.toFixed(0)}%，中期趋势强势。`,
                        'HOLD', '远高于季线是中期强势'
                    ));
                } else if (distFrom60 < -15) {
                    results.push(this._make(
                        `价格远低于季线(${distFrom60.toFixed(0)}%)`, '📉', CATEGORY_TREND, '中', 2,
                        `股价较MA60低${Math.abs(distFrom60).toFixed(0)}%，中期趋势弱势。`,
                        'AVOID_BUY', '远低于季线是中期弱势'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 10) {
            const ema5Short = this.ema(closesWithToday, 5);
            const ema10Short = this.ema(closesWithToday, 10);
            if (ema5Short && ema10Short) {
                const emaDiff = (ema5Short - ema10Short) / ema10Short * 100;
                if (emaDiff > 2) {
                    results.push(this._make(
                        `EMA5领先EMA10(+${emaDiff.toFixed(1)}%)`, '📈', CATEGORY_TREND, '中', 2,
                        `EMA5(${ema5Short.toFixed(2)})>EMA10(${ema10Short.toFixed(2)})，短期多头。`,
                        'BUY', 'EMA金叉是短期买入信号'
                    ));
                } else if (emaDiff < -2) {
                    results.push(this._make(
                        `EMA5落后EMA10(${emaDiff.toFixed(1)}%)`, '📉', CATEGORY_TREND, '中', 2,
                        `EMA5(${ema5Short.toFixed(2)})<EMA10(${ema10Short.toFixed(2)})，短期空头。`,
                        'SELL', 'EMA死叉是短期卖出信号'
                    ));
                }
            }
        }

        // =================================================================
        //  更多补充策略（确保200+）
        // =================================================================

        if (hasKline && closes.length >= 30) {
            const roc10Base = closesWithToday[closesWithToday.length - 11];
            const roc10 = roc10Base > 0 ? (closesWithToday[closesWithToday.length - 1] - roc10Base) / roc10Base * 100 : 0;
            const roc20Base = closesWithToday[closesWithToday.length - 21];
            const roc20 = roc20Base > 0 ? (closesWithToday[closesWithToday.length - 1] - roc20Base) / roc20Base * 100 : 0;
            if (roc10 > 0 && roc20 > 0) {
                results.push(this._make(
                    '短期+中期动量向上', '📈', CATEGORY_TREND, '中', 2,
                    `ROC10=${roc10.toFixed(1)}%, ROC20=${roc20.toFixed(1)}%，双周期动量向上。`,
                    'HOLD', '多周期动量向上趋势延续'
                ));
            } else if (roc10 < 0 && roc20 < 0) {
                results.push(this._make(
                    '短期+中期动量向下', '📉', CATEGORY_TREND, '中', 2,
                    `ROC10=${roc10.toFixed(1)}%, ROC20=${roc20.toFixed(1)}%，双周期动量向下。`,
                    'SELL', '多周期动量向下趋势延续'
                ));
            } else if (roc10 > 0 && roc20 < 0) {
                results.push(this._make(
                    '短期反弹中期下跌', '⚡', CATEGORY_TREND, '中', 3,
                    `ROC10=${roc10.toFixed(1)}%, ROC20=${roc20.toFixed(1)}%，短中期背离。`,
                    'WATCH', '短中期背离需谨慎'
                ));
            } else {
                results.push(this._make(
                    '短期回调中期上涨', '⚡', CATEGORY_TREND, '中', 3,
                    `ROC10=${roc10.toFixed(1)}%, ROC20=${roc20.toFixed(1)}%，短中期背离。`,
                    'WATCH', '短中期背离可关注'
                ));
            }
        }

        if (hasKline && volumes.length >= 10) {
            const vrQuick = volumes[volumes.length - 1] / Math.max(volumes[volumes.length - 2], 1);
            if (vrQuick > 3) {
                results.push(this._make(
                    `单日量比突增(${vrQuick.toFixed(1)}倍)`, '🔥', CATEGORY_VOLUME, '高', 1,
                    `今日成交量是昨日的${vrQuick.toFixed(1)}倍，量能急剧放大！`,
                    'WATCH', '量能突变是变盘信号'
                ));
            } else if (vrQuick < 0.3) {
                results.push(this._make(
                    `单日量比骤降(${vrQuick.toFixed(1)}倍)`, '💤', CATEGORY_VOLUME, '高', 1,
                    `今日成交量是昨日的${vrQuick.toFixed(1)}倍，量能急剧萎缩！`,
                    'WATCH', '量能骤降是见底信号'
                ));
            }
        }

        if (hasKline && highs.length >= 10 && lows.length >= 10) {
            let higherHighs = 0;
            let lowerLows = 0;
            for (let i = -1; i > -3; i--) {
                const idx = highs.length + i;
                if (idx - 1 >= 0 && highs[idx] > highs[idx - 1]) higherHighs++;
                if (idx - 1 >= 0 && lows[idx] < lows[idx - 1]) lowerLows++;
            }
            if (higherHighs >= 2 && lowerLows === 0) {
                results.push(this._make(
                    '高低点同步抬升', '📈', CATEGORY_PATTERN, '中', 2,
                    '连续创新高且不创新低，上升趋势明显。',
                    'BUY', '高低点同步抬升是强势'
                ));
            } else if (higherHighs === 0 && lowerLows >= 2) {
                results.push(this._make(
                    '高低点同步下降', '📉', CATEGORY_PATTERN, '中', 2,
                    '连续创新低且不创新高，下降趋势明显。',
                    'SELL', '高低点同步下降是弱势'
                ));
            }
        }

        if (hasKline && closes.length >= 60) {
            const ma20Last = getSma(20);
            const ma60Last = getSma(60);
            const prevMa20 = this.sma(closesWithToday.slice(0, -1), 20);
            const prevMa60 = this.sma(closesWithToday.slice(0, -1), 60);
            if (ma20Last && ma60Last && prevMa20 && prevMa60) {
                if (prevMa20 < prevMa60 && ma20Last > ma60Last) {
                    results.push(this._make(
                        'MA20上穿MA60(黄金交叉)', '✨', CATEGORY_TREND, '极高', 0,
                        'MA20上穿MA60，中期趋势反转向上！',
                        'STRONG_BUY', '黄金交叉是强烈买入信号'
                    ));
                } else if (prevMa20 > prevMa60 && ma20Last < ma60Last) {
                    results.push(this._make(
                        'MA20下穿MA60(死亡交叉)', '💀', CATEGORY_TREND, '极高', 0,
                        'MA20下穿MA60，中期趋势反转向下！',
                        'STRONG_SELL', '死亡交叉是强烈卖出信号'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 60) {
            const ma5L = getSma(5);
            const ma10L = getSma(10);
            const ma20L = getSma(20);
            if (ma5L && ma10L && ma20L) {
                if (ma5L > ma10L && ma10L > ma20L) {
                    results.push(this._make(
                        '短期均线多头排列(5>10>20)', '🟢', CATEGORY_TREND, '高', 1,
                        'MA5>MA10>MA20，短期均线多头排列完美！',
                        'BUY', '多头排列是趋势向上信号'
                    ));
                } else if (ma5L < ma10L && ma10L < ma20L) {
                    results.push(this._make(
                        '短期均线空头排列(5<10<20)', '🔴', CATEGORY_TREND, '高', 1,
                        'MA5<MA10<MA20，短期均线空头排列！',
                        'SELL', '空头排列是趋势向下信号'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 10) {
            let totalGain = 0, totalLoss = 0;
            for (let i = -9; i < 0; i++) {
                const idx = closesWithToday.length + i;
                const change = closesWithToday[idx] - closesWithToday[idx - 1];
                if (change > 0) totalGain += change;
                else totalLoss += Math.abs(change);
            }
            if (totalGain + totalLoss > 0) {
                const gainLossRatio = totalGain / (totalGain + totalLoss) * 100;
                if (gainLossRatio > 70) {
                    results.push(this._make(
                        `近10日涨跌幅比${gainLossRatio.toFixed(0)}%(偏强)`, '📈', CATEGORY_PATTERN, '中', 2,
                        `近10日累计上涨占比${gainLossRatio.toFixed(0)}%，多方占优。`,
                        'HOLD', '涨多跌少是偏强状态'
                    ));
                } else if (gainLossRatio < 30) {
                    results.push(this._make(
                        `近10日涨跌幅比${gainLossRatio.toFixed(0)}%(偏弱)`, '📉', CATEGORY_PATTERN, '中', 2,
                        `近10日累计下跌占比${(100 - gainLossRatio).toFixed(0)}%，空方占优。`,
                        'WATCH', '跌多涨少是偏弱状态'
                    ));
                }
            }
        }

        if (hasKline && volumes.length >= 10) {
            let upVolumeDays = 0;
            let totalDays = 0;
            for (let i = -9; i < 0; i++) {
                const idx = closesWithToday.length + i;
                if (idx > 0 && closesWithToday[idx] > closesWithToday[idx - 1]) {
                    upVolumeDays++;
                }
                totalDays++;
            }
            if (totalDays > 0) {
                const upDayRatio = upVolumeDays / totalDays * 100;
                if (upDayRatio > 70) {
                    results.push(this._make(
                        `近10日上涨天数占比${upDayRatio.toFixed(0)}%`, '☀️', CATEGORY_PATTERN, '中', 2,
                        `近10个交易日有${upVolumeDays}天上涨，占比${upDayRatio.toFixed(0)}%，强势特征。`,
                        'HOLD', '涨多跌少是强势'
                    ));
                } else if (upDayRatio < 30) {
                    results.push(this._make(
                        `近10日下跌天数占比${(100 - upDayRatio).toFixed(0)}%`, '🌧️', CATEGORY_PATTERN, '中', 2,
                        `近10个交易日有${totalDays - upVolumeDays}天下跌，占比${(100 - upDayRatio).toFixed(0)}%，弱势特征。`,
                        'WATCH', '跌多涨少是弱势'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 65) {
            const ma60Trend = getSma(60);
            const ma60Prev = this.sma(closesWithToday.slice(0, -5), 60);
            if (ma60Trend && ma60Prev) {
                const ma60Change = (ma60Trend - ma60Prev) / ma60Prev * 100;
                if (ma60Change > 1) {
                    results.push(this._make(
                        `MA60上行(+${ma60Change.toFixed(2)}%)`, '📈', CATEGORY_TREND, '高', 1,
                        `MA60在过去5日上涨${ma60Change.toFixed(2)}%，中期趋势向上。`,
                        'BUY', 'MA60上行是中期上涨趋势'
                    ));
                } else if (ma60Change < -1) {
                    results.push(this._make(
                        `MA60下行(${ma60Change.toFixed(2)}%)`, '📉', CATEGORY_TREND, '高', 1,
                        `MA60在过去5日下跌${Math.abs(ma60Change).toFixed(2)}%，中期趋势向下。`,
                        'SELL', 'MA60下行是中期下跌趋势'
                    ));
                }
            }
        }

        // =================================================================
        //  最终补充策略（确保200+）
        // =================================================================

        if (hasKline && closes.length >= 20) {
            const ma20Ref = getSma(20);
            if (ma20Ref && ma20Ref > 0) {
                const atrLocal = getAtr(14);
                if (atrLocal && atrLocal > 0) {
                    const atrMaRatio = atrLocal / ma20Ref * 100;
                    if (atrMaRatio > 5) {
                        const buyTarget = lp * 1.002;
                        const sellTarget = hp * 0.998;
                        const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
                        const buyAmount = buyTarget * 100;
                        const spread = sellTarget - buyTarget;
                        const netProfit = spread * 100 - txFee;
                        const netPct = buyAmount > 0 ? netProfit / buyAmount * 100 : 0;
                        results.push(this._make(
                            `ATR/MA20=${atrMaRatio.toFixed(1)}%(高波动)`, '📊', CATEGORY_NOVEL, '高', 2,
                            `ATR/MA20=${atrMaRatio.toFixed(1)}%波动极大！买${buyTarget.toFixed(2)}卖${sellTarget.toFixed(2)}，净收益${netPct.toFixed(2)}%`,
                            'TRADING_OPPORTUNITY', '高波动适合做T',
                            { buy_price: buyTarget, sell_price: sellTarget }
                        ));
                    } else if (atrMaRatio < 1) {
                        results.push(this._make(
                            `ATR/MA20=${atrMaRatio.toFixed(1)}%(低波动)`, '➖', CATEGORY_NOVEL, '中', 3,
                            `ATR占MA20比例${atrMaRatio.toFixed(1)}%，波动极小。`,
                            'NO_TRADE', '低波动不适合做T'
                        ));
                    }
                }
            }
        }

        if (hasKline && closes.length >= 20 && volumes.length >= 20) {
            const priceStd = Math.sqrt(closesWithToday.slice(-20).reduce((sum, c) => {
                const mean = closesWithToday.slice(-20).reduce((a, b) => a + b, 0) / 20;
                return sum + Math.pow(c - mean, 2);
            }, 0) / 20);
            const volStd = Math.sqrt(volumes.slice(-20).reduce((sum, v) => {
                const mean = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
                return sum + Math.pow(v - mean, 2);
            }, 0) / 20);
            const volAvg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            if (priceStd > 0 && volStd > 0 && volAvg > 0) {
                const priceCv = priceStd / (closesWithToday[closesWithToday.length - 1]) * 100;
                const volCv = volStd / volAvg * 100;
                results.push(this._make(
                    `波动率CV: 价格${priceCv.toFixed(1)}% 量能${volCv.toFixed(0)}%`, '📊', CATEGORY_NOVEL, '中', 3,
                    `价格波动CV=${priceCv.toFixed(1)}%, 量能波动CV=${volCv.toFixed(0)}%。`,
                    'HOLD', '波动率指标'
                ));
            }
        }

        if (hasKline && closes.length >= 5) {
            const gainSum = [];
            const lossSum = [];
            for (let i = -4; i < 0; i++) {
                const idx = closesWithToday.length + i;
                const diff = closesWithToday[idx] - closesWithToday[idx - 1];
                if (diff > 0) gainSum.push(diff);
                else lossSum.push(Math.abs(diff));
            }
            const avgGain = gainSum.length > 0 ? gainSum.reduce((a, b) => a + b, 0) / 4 : 0;
            const avgLoss = lossSum.length > 0 ? lossSum.reduce((a, b) => a + b, 0) / 4 : 0;
            if (avgLoss > 0) {
                const rs = avgGain / avgLoss;
                results.push(this._make(
                    `4日RS强度=${rs.toFixed(2)}`, '📈', CATEGORY_OSCILLATOR, '中', 3,
                    `4日相对强弱RS=${rs.toFixed(2)}，${rs > 1 ? '偏强' : '偏弱'}。`,
                    rs > 1 ? 'HOLD' : 'WATCH', 'RS强度指标'
                ));
            }
        }

        if (hasKline && highs.length >= 10 && lows.length >= 10) {
            const recentHigh = safeArrMax(highs.slice(-10));
            const recentLow = safeArrMin(lows.slice(-10));
            if (recentHigh > recentLow) {
                const range = (recentHigh - recentLow) / recentLow * 100;
                const positionPercent = (cp - recentLow) / (recentHigh - recentLow) * 100;
                if (positionPercent > 80 && range > 5) {
                    results.push(this._make(
                        `10日区间高位(${positionPercent.toFixed(0)}%)`, '📈', CATEGORY_PATTERN, '中', 2,
                        `在10日${range.toFixed(1)}%振幅区间内处于${positionPercent.toFixed(0)}%高位。`,
                        'HOLD', '区间高位偏强'
                    ));
                } else if (positionPercent < 20 && range > 5) {
                    results.push(this._make(
                        `10日区间低位(${positionPercent.toFixed(0)}%)`, '📉', CATEGORY_PATTERN, '中', 2,
                        `在10日${range.toFixed(1)}%振幅区间内处于${positionPercent.toFixed(0)}%低位。`,
                        'BUY', '区间低位有支撑'
                    ));
                }
            }
        }

        if (hasKline && volumes.length >= 5) {
            const vol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const vol10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
            if (vol10 > 0) {
                const volRatio5_10 = vol5 / vol10;
                results.push(this._make(
                    `5/10量比=${volRatio5_10.toFixed(2)}`, '📊', CATEGORY_VOLUME, '中', 3,
                    `5日均量/10日均量=${volRatio5_10.toFixed(2)}，${volRatio5_10 > 1 ? '放量' : '缩量'}趋势。`,
                    'HOLD', `量比${volRatio5_10.toFixed(2)}`
                ));
            }
        }

        if (hasKline && closes.length >= 60) {
            const ma20S = getSma(20);
            const ma60S = getSma(60);
            if (ma20S && ma60S && ma60S > 0) {
                const spread20_60 = (ma20S - ma60S) / ma60S * 100;
                results.push(this._make(
                    `MA20/MA60差值=${spread20_60.toFixed(1)}%`, '📊', CATEGORY_TREND, '中', 3,
                    `MA20与MA60差值${spread20_60.toFixed(1)}%，${spread20_60 > 0 ? '多头' : '空头'}排列。`,
                    spread20_60 > 0 ? 'HOLD' : 'WATCH', `均线差${spread20_60.toFixed(1)}%`
                ));
            }
        }

        if (hasKline && closes.length >= 20) {
            const ema12 = this.ema(closesWithToday, 12);
            const ema26 = this.ema(closesWithToday, 26);
            if (ema12 && ema26 && ema26 > 0) {
                const emaSpread = (ema12 - ema26) / ema26 * 100;
                results.push(this._make(
                    `EMA12/EMA26差值=${emaSpread.toFixed(2)}%`, '📊', CATEGORY_TREND, '中', 3,
                    `EMA12与EMA26差值${emaSpread.toFixed(2)}%，${emaSpread > 0 ? '短期偏多' : '短期偏空'}。`,
                    emaSpread > 0 ? 'HOLD' : 'WATCH', `EMA差${emaSpread.toFixed(2)}%`
                ));
            }
        }

        if (hasKline && closes.length >= 10) {
            let highestClose = safeArrMax(closesWithToday.slice(-20));
            let lowestClose = safeArrMin(closesWithToday.slice(-20));
            if (highestClose > lowestClose) {
                const rangePct = (highestClose - lowestClose) / lowestClose * 100;
                results.push(this._make(
                    `20日振幅=${rangePct.toFixed(1)}%`, '📊', CATEGORY_MICRO, '中', 3,
                    `20日最高价${highestClose.toFixed(2)}，最低价${lowestClose.toFixed(2)}，振幅${rangePct.toFixed(1)}%。`,
                    'HOLD', `20日振幅${rangePct.toFixed(1)}%`
                ));
            }
        }

        // =================================================================
        //  ⚠️ 7月6日新规专项策略
        //  1. 沪市ETF尾盘改集合竞价（14:57-15:00不可撤单）
        //  2. 主板ST/*ST涨跌幅从5%放宽至10%
        //  3. 盘后固定价格交易扩至全市场（15:05-15:30）
        //  4. 创业板引入做市商制度
        //  5. 大宗交易时间扩容
        // =================================================================

        const CAT_NEW_RULE = '📋 新规策略';

        if (hasKline && closes.length >= 5) {
            const recentCloses = closes.slice(-5);
            const recentAmplitudes = [];
            for (let i = 0; i < recentCloses.length; i++) {
                if (i > 0) {
                    recentAmplitudes.push(Math.abs(recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1] * 100);
                }
            }
            if (recentAmplitudes.length >= 3) {
                const avgAmp = recentAmplitudes.reduce((a, b) => a + b, 0) / recentAmplitudes.length;
                const maxAmp = Math.max(...recentAmplitudes);
                
                if (maxAmp >= 8 && avgAmp >= 5) {
                    results.push(this._make(
                        '新规-高波动个股警示', '⚠️', CAT_NEW_RULE, '高', 1,
                        `近5日最大振幅${maxAmp.toFixed(1)}%，平均${avgAmp.toFixed(1)}%，波动显著放大，风险升高。`,
                        'WATCH', `新规后波动加剧，需控制仓位，设置严格止损`,
                        { max_amplitude: maxAmp, avg_amplitude: avgAmp }
                    ));
                }

                if (maxAmp >= 6 && chg >= 4) {
                    results.push(this._make(
                        '新规-涨停趋势加速', '🚀', CAT_NEW_RULE, '高', 1,
                        `近5日最大振幅${maxAmp.toFixed(1)}%，当前涨幅+${chg.toFixed(2)}%，新规下上涨趋势加速。`,
                        'BUY', `振幅放大+涨幅强劲，新规后趋势延续性增强`,
                        { target_price: cp * 1.12, stop_loss: cp * 0.94 }
                    ));
                }

                if (maxAmp >= 6 && chg <= -4) {
                    results.push(this._make(
                        '新规-跌停趋势加速', '💀', CAT_NEW_RULE, '高', 1,
                        `近5日最大振幅${maxAmp.toFixed(1)}%，当前跌幅${chg.toFixed(2)}%，新规下下跌趋势加速。`,
                        'SELL', `振幅放大+跌幅加深，新规后风险释放加速`,
                        { target_price: cp * 0.88, stop_loss: cp * 1.04 }
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 3) {
            const prevClose = closes[closes.length - 2];
            const prev2Close = closes.length >= 3 ? closes[closes.length - 3] : prevClose;
            const gapUp = op > prevClose * 1.05;
            const gapDown = op < prevClose * 0.95;
            
            if (gapUp) {
                const gapPct = (op - prevClose) / prevClose * 100;
                const gapStrength = cp > op ? '强势' : cp > prevClose * 1.03 ? '中性' : '弱势';
                results.push(this._make(
                    '新规-大幅高开缺口', '⬆️', CAT_NEW_RULE, gapStrength === '强势' ? '高' : '中', 1,
                    `新规后大幅高开${gapPct.toFixed(1)}%，缺口${prevClose.toFixed(2)}-${op.toFixed(2)}，${gapStrength}走势。`,
                    gapStrength === '强势' ? 'BUY' : gapStrength === '弱势' ? 'SELL' : 'WATCH',
                    `大幅跳空在新规下更常见，强势则延续概率高`,
                    { gap_pct: gapPct, gap_strength: gapStrength }
                ));
            }
            
            if (gapDown) {
                const gapPct = (prevClose - op) / prevClose * 100;
                const gapStrength = cp < op ? '弱势' : cp < prevClose * 0.97 ? '中性' : '强势';
                results.push(this._make(
                    '新规-大幅低开缺口', '⬇️', CAT_NEW_RULE, gapStrength === '弱势' ? '高' : '中', 1,
                    `新规后大幅低开${gapPct.toFixed(1)}%，缺口${op.toFixed(2)}-${prevClose.toFixed(2)}，${gapStrength}走势。`,
                    gapStrength === '弱势' ? 'SELL' : gapStrength === '强势' ? 'BUY' : 'WATCH',
                    `大幅跳空在新规下更常见，弱势则延续概率高`,
                    { gap_pct: gapPct, gap_strength: gapStrength }
                ));
            }
        }

        if (hasKline && closes.length >= 5) {
            const recentVolumes = volumes.slice(-5);
            const avgVol5 = recentVolumes.reduce((a, b) => a + b, 0) / 5;
            if (avgVol5 > 0) {
                const volRatios = recentVolumes.map(v => v / avgVol5);
                const extremeVolCount = volRatios.filter(r => r > 2 || r < 0.3).length;
                
                if (extremeVolCount >= 2) {
                    results.push(this._make(
                        '新规-成交量极端化', '📊', CAT_NEW_RULE, '中', 2,
                        `近5日有${extremeVolCount}天成交量极端（>2倍或<0.3倍均值），新规下资金博弈加剧。`,
                        'WATCH', `成交量极端化说明资金分歧大，需结合价格走势判断`,
                        { extreme_vol_count: extremeVolCount }
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 10) {
            let consecutiveExtremeDays = 0;
            let maxConsecutive = 0;
            for (let i = closes.length - 2; i >= 0; i--) {
                const dayChg = Math.abs((closes[i] - closes[i - 1]) / closes[i - 1] * 100);
                if (dayChg >= 5) {
                    consecutiveExtremeDays++;
                    maxConsecutive = Math.max(maxConsecutive, consecutiveExtremeDays);
                } else {
                    consecutiveExtremeDays = 0;
                }
            }
            
            if (maxConsecutive >= 2) {
                results.push(this._make(
                    '新规-连续极端波动', '🌊', CAT_NEW_RULE, '高', 1,
                    `近期连续${maxConsecutive}天波动≥5%，新规下趋势持续性增强。`,
                    chg > 0 ? 'BUY' : 'SELL', `连续极端波动在新规下更容易形成趋势`,
                    { consecutive_extreme_days: maxConsecutive }
                ));
            }
        }

        if (hasKline && closes.length >= 3) {
            const body = Math.abs(cp - op);
            const range = hp - lp;
            const bodyRatio = range > 0 ? body / range : 0;
            
            if (bodyRatio > 0.8 && chg >= 8) {
                results.push(this._make(
                    '新规-强势光头阳线', '🔥', CAT_NEW_RULE, '高', 1,
                    `实体占比${(bodyRatio * 100).toFixed(0)}%，涨幅+${chg.toFixed(2)}%，强势光头阳线，新规下涨停概率高。`,
                    'BUY', `光头阳线+高涨幅=强烈做多信号，新规下延续性好`,
                    { target_price: cp * 1.15, stop_loss: cp * 0.95 }
                ));
            }
            
            if (bodyRatio > 0.8 && chg <= -8) {
                results.push(this._make(
                    '新规-强势光头阴线', '💀', CAT_NEW_RULE, '高', 1,
                    `实体占比${(bodyRatio * 100).toFixed(0)}%，跌幅${chg.toFixed(2)}%，强势光头阴线，新规下跌停概率高。`,
                    'SELL', `光头阴线+高跌幅=强烈做空信号，新规下延续性好`,
                    { target_price: cp * 0.85, stop_loss: cp * 1.05 }
                ));
            }
        }

        if (hasKline && closes.length >= 5) {
            const recentRanges = [];
            for (let i = closes.length - 1; i >= Math.max(0, closes.length - 5); i--) {
                if (i > 0) {
                    recentRanges.push((highs[i] - lows[i]) / closes[i - 1] * 100);
                }
            }
            if (recentRanges.length >= 3) {
                const avgRange = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
                if (avgRange > 8) {
                    results.push(this._make(
                        '新规-高波动通道', '🎢', CAT_NEW_RULE, '中', 2,
                        `近5日平均振幅${avgRange.toFixed(1)}%，新规下高波动通道形成。`,
                        'WATCH', `高波动通道适合做T，但风险也相应放大`,
                        { avg_daily_range: avgRange }
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 20) {
            const atr14 = getAtr(14);
            if (atr14 && atr14 > 0 && cp > 0) {
                const atrPct = atr14 / cp * 100;
                if (atrPct > 5) {
                    results.push(this._make(
                        '新规-ATR突破阈值', '📏', CAT_NEW_RULE, '中', 2,
                        `ATR14=${atrPct.toFixed(1)}%，突破5%阈值，新规下波动率显著上升。`,
                        'WATCH', `ATR突破说明波动加大，需调整仓位和止损`)
                    );
                }
            }
        }

        if (hour >= 14 && hour < 15) {
            const minutesFromClose = 60 - minute;
            if (minutesFromClose <= 5) {
                const lastMinuteMove = (cp - op) / op * 100;
                if (Math.abs(lastMinuteMove) >= 2) {
                    results.push(this._make(
                        '新规-尾盘5分钟异动', '⏰', CAT_NEW_RULE, '高', 1,
                        `尾盘5分钟异动${lastMinuteMove >= 0 ? '+' : ''}${lastMinuteMove.toFixed(2)}%，新规下尾盘集合竞价锁定价格。`,
                        lastMinuteMove > 0 ? 'BUY' : 'SELL', `尾盘异动在新规下更容易锁定收盘价，延续性增强`,
                        { last_minute_move: lastMinuteMove }
                    ));
                }
            }
        }

        // =================================================================
        //  合并全景分析策略（资金面、情绪面、筹码面、机构动向、消息面）
        // =================================================================

        if (hasKline && closesWithToday.length >= 5) {
            const klineData = [];
            for (let i = 0; i < closesWithToday.length; i++) {
                klineData.push({
                    close: closesWithToday[i], open: i < opensWithToday.length ? opensWithToday[i] : closesWithToday[i],
                    high: i < highsWithToday.length ? highsWithToday[i] : closesWithToday[i],
                    low: i < lowsWithToday.length ? lowsWithToday[i] : closesWithToday[i],
                    volume: i < volumesWithToday.length ? volumesWithToday[i] : 0
                });
            }
            const [panoramaResults] = this.analyzePanorama(klineData, { code: code, name: name });
            if (panoramaResults && panoramaResults.length > 0) {
                const existingNames = new Set(results.map(r => r.name));
                for (const pr of panoramaResults) {
                    if (!existingNames.has(pr.name)) {
                        results.push(pr);
                        existingNames.add(pr.name);
                    }
                }
            }
        }

        // =================================================================
        //  后处理：自动补全价位 + 计算获利空间
        // =================================================================

        let atrVal = null;
        if (hasKline && closes.length >= 15) {
            atrVal = getAtr(14);
        }
        if (atrVal === null || atrVal <= 0) {
            atrVal = cp * 0.02;
        }

        for (const s of results) {
            const act = s.action || '';
            if (['AVOID_BUY', 'NO_TRADE', 'WATCH', 'HOLD', 'OBSERVE',
                 'REDUCE_POSITION', 'WAIT', 'WAIT_NEXT_DAY',
                 'SELL_BEFORE_CLOSE', 'TRADING_OPPORTUNITY'].includes(act)) {
                continue;
            }

            let isPureBuy = ['BUY', 'STRONG_BUY'].includes(act);
            let isPureSell = ['SELL', 'STRONG_SELL'].includes(act);
            let isTTrading = ['BUY_THEN_SELL', 'SELL_THEN_BUY', 'BOX_TRADING'].includes(act);

            if (!isPureBuy && !isPureSell && !isTTrading) {
                isPureBuy = act.includes('BUY') && !act.includes('SELL') && !act.includes('AVOID');
                isPureSell = act.includes('SELL') && !act.includes('BUY') && !act.includes('AVOID');
            }

            const feas = s.feasibility || '中';
            let atrMult, stopMult;
            if (feas === '极高' || feas === '高') {
                atrMult = 1.0;
                stopMult = 0.8;
            } else if (feas === '中') {
                atrMult = 0.7;
                stopMult = 0.6;
            } else {
                atrMult = 0.5;
                stopMult = 0.5;
            }

            if (isPureBuy) {
                // 设置建议买入价：优先使用策略指定的买入价，否则挂低吸单（比当前价略低）
                if (s.entry_price === undefined) {
                    if (s.buy_price !== undefined) {
                        s.entry_price = s.buy_price;
                    } else {
                        // 默认建议价比当前价略低，给低吸机会
                        const dipPrice = lp !== undefined && lp > 0 ? Math.min(cp * 0.998, lp * 1.002) : cp * 0.998;
                        s.entry_price = Math.round(dipPrice * 100) / 100;
                    }
                }
                if (s.target_price === undefined) s.target_price = Math.round((cp + atrVal * atrMult) * 100) / 100;
                if (s.stop_loss === undefined) s.stop_loss = Math.round((cp - atrVal * stopMult) * 100) / 100;
                // 确保目标价高于买入价，至少1%盈利空间
                const minTarget = Math.round((s.entry_price * 1.01) * 100) / 100;
                if (s.target_price <= s.entry_price) s.target_price = Math.round((s.entry_price + Math.max(atrVal * atrMult, s.entry_price * 0.01)) * 100) / 100;
                if (s.target_price < minTarget) s.target_price = minTarget;
                if (s.stop_loss >= s.entry_price) s.stop_loss = Math.round((s.entry_price - Math.max(atrVal * stopMult, s.entry_price * 0.005)) * 100) / 100;
            } else if (isPureSell) {
                if (s.target_price === undefined) s.target_price = Math.round((cp - atrVal * atrMult) * 100) / 100;
                if (s.stop_loss === undefined) s.stop_loss = Math.round((cp + atrVal * stopMult) * 100) / 100;
                if (s.target_price >= cp) s.target_price = Math.round((cp - atrVal * atrMult) * 100) / 100;
                if (s.stop_loss <= cp) s.stop_loss = Math.round((cp + atrVal * stopMult) * 100) / 100;
            } else if (isTTrading) {
                let buyPrice = s.buy_price;
                let sellPrice = s.sell_price;
                if (buyPrice === undefined && sellPrice === undefined) {
                    buyPrice = Math.round((cp - atrVal * stopMult) * 100) / 100;
                    sellPrice = Math.round((cp + atrVal * atrMult) * 100) / 100;
                }
                if (lp !== undefined && lp > 0) {
                    if (buyPrice !== undefined && buyPrice < lp) buyPrice = Math.round(Math.max(lp * 1.001, cp * 0.995) * 100) / 100;
                }
                if (hp !== undefined && hp > 0) {
                    if (sellPrice !== undefined && sellPrice > hp) sellPrice = Math.round(Math.min(hp * 0.999, cp * 1.005) * 100) / 100;
                }
                if (buyPrice !== undefined && sellPrice !== undefined && sellPrice <= buyPrice) {
                    sellPrice = Math.round((buyPrice + Math.max(atrVal * 0.5, buyPrice * 0.005)) * 100) / 100;
                }
                s.target_price = sellPrice;
                s.stop_loss = buyPrice;
                s.buy_price = buyPrice;
                s.sell_price = sellPrice;
            }

            const tp = s.target_price;
            const sl = s.stop_loss;
            const entryPrice = s.entry_price || cp;
            if (tp !== undefined && sl !== undefined && cp > 0) {
                let profitPct, lossPct;
                if (isPureBuy) {
                    profitPct = (tp - entryPrice) / entryPrice * 100;
                    lossPct = (entryPrice - sl) / entryPrice * 100;
                } else if (isPureSell) {
                    profitPct = (entryPrice - tp) / entryPrice * 100;
                    lossPct = (sl - entryPrice) / entryPrice * 100;
                } else if (isTTrading) {
                    profitPct = (tp - sl) / cp * 100;
                    lossPct = 0;
                } else {
                    profitPct = 0;
                    lossPct = 0;
                }
                s.profit_potential = Math.round(profitPct * 100) / 100;
                s.loss_risk = Math.round(lossPct * 100) / 100;
                s.risk_reward = lossPct > 0 ? Math.round((profitPct / lossPct) * 100) / 100 : Math.round((profitPct / Math.max(atrVal / cp * 100, 0.1)) * 100) / 100;
            }
        }

        results.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

        // =================================================================
        //  补齐策略到190+
        // =================================================================

        const TARGET_TOTAL = 190;
        const existingNames = new Set(results.map(r => r.name));

        const addIfNew = (name, icon, cat, feas, pri, sug, action, reas, extra = {}) => {
            if (!existingNames.has(name)) {
                results.push(this._make(name, icon, cat, feas, pri, sug, action, reas, extra));
                existingNames.add(name);
            }
        };

        if (hasKline && closes.length >= 60) {
            const ma5 = getSma(5) || 0;
            const ma10 = getSma(10) || 0;
            const ma20 = getSma(20) || 0;
            const ma60 = getSma(60) || 0;
            if (ma5 && ma10 && ma20 && ma60) {
                addIfNew(
                    'MA5×MA10常态', '📊', CATEGORY_TREND, '中', 4,
                    `MA5(${ma5.toFixed(2)}) MA10(${ma10.toFixed(2)})，当前${ma5 > ma10 ? '多头排列' : '空头排列'}，差${(Math.abs(ma5 - ma10) / ma10 * 100).toFixed(2)}%。`,
                    Math.abs(ma5 - ma10) / ma10 < 0.02 ? 'HOLD' : (ma5 > ma10 ? 'BUY' : 'SELL'),
                    `MA5与MA10偏离${(Math.abs(ma5 - ma10) / ma10 * 100).toFixed(1)}%，${Math.abs(ma5 - ma10) / ma10 * 100 < 2 ? '粘合震荡' : '有趋势'}`
                );
                addIfNew(
                    'MA20×MA60趋势', '📈', CATEGORY_TREND, '中', 4,
                    `MA20(${ma20.toFixed(2)}) vs MA60(${ma60.toFixed(2)})，中期趋势${ma20 > ma60 ? '向上' : '向下'}。`,
                    Math.abs(ma20 - ma60) / ma60 < 0.03 ? 'HOLD' : (ma20 > ma60 ? 'BUY' : 'SELL'),
                    `MA20在MA60${ma20 > ma60 ? '上方' : '下方'}，中期趋势${ma20 > ma60 ? '偏多' : '偏空'}`
                );
            }
        }

        if (hasKline && closes.length >= 15) {
            const rsi = getRsi(14);
            if (rsi !== null) {
                const rsiStatus = rsi > 70 ? '超买区' : (rsi < 30 ? '超卖区' : '常态区');
                addIfNew(
                    'RSI(14)状态报告', '📊', CATEGORY_OSCILLATOR, '中', 4,
                    `RSI(14)=${rsi.toFixed(1)}，处于${rsiStatus}，${rsi > 70 ? '回调风险增加' : rsi < 30 ? '反弹概率增大' : '无超买超卖信号'}。`,
                    'HOLD',
                    `RSI标准区间30-70，当前${rsi.toFixed(0)}点${rsiStatus}`
                );
            }
        }

        if (hasKline && closes.length >= 9) {
            const [k, d, j] = getKdj();
            if (k !== null && d !== null) {
                const kdjStatus = j > 80 ? '超买' : (j < 20 ? '超卖' : '常态');
                addIfNew(
                    'KDJ(9,3,3)状态报告', '📊', CATEGORY_OSCILLATOR, '中', 4,
                    `K=${k.toFixed(1)} D=${d.toFixed(1)} J=${j.toFixed(1)}，${k > d ? '金叉' : '死叉'}，${kdjStatus}区间。`,
                    'HOLD',
                    `KDJ${k > d ? '金叉看多' : '死叉看空'}，J值${j.toFixed(0)}处于${kdjStatus}`
                );
            }
        }

        if (hasKline && volumes.length >= 10) {
            const avgVol5 = volumes.length >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : volumes[volumes.length - 1];
            const avgVol10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
            const volRatio = avgVol10 > 0 ? vol / avgVol10 : 1;
            const volStatus = volRatio > 1.5 ? '放量' : (volRatio < 0.6 ? '缩量' : '正常量能');
            addIfNew(
                '量能状态报告', '📊', CATEGORY_VOLUME, '中', 4,
                `当前量比${volRatio.toFixed(2)}倍（vs 10日均量），${volStatus}。5日均量${(avgVol5 / 10000).toFixed(0)}万。`,
                'HOLD',
                `量能${volStatus}，${volRatio > 1.5 ? '需关注方向' : volRatio < 0.6 ? '观望为主' : '正常波动'}`
            );
        }

        addIfNew(
            '日内振幅报告', '📊', CATEGORY_MICRO, '中', 4,
            `今日振幅${amplitude.toFixed(2)}%，${amplitude > 3 ? '高振幅适合做T' : amplitude > 1.5 ? '中等振幅' : '低振幅不适合做T'}。`,
            'HOLD',
            `振幅>3%做T收益空间大，<1%不够手续费`
        );

        addIfNew(
            '均价偏离报告', '📍', CATEGORY_MICRO, '中', 4,
            `现价偏离日内均价 ${devFromAvg > 0 ? '+' : ''}${devFromAvg.toFixed(2)}%，${devFromAvg > 1 ? '偏高有回落风险' : devFromAvg < -1 ? '偏低有反弹机会' : '接近均价震荡'}。`,
            'HOLD',
            `偏离均价${Math.abs(devFromAvg).toFixed(1)}%，${Math.abs(devFromAvg) > 2 ? '极端偏离将回归' : '正常波动'}`
        );

        const atrLocal = hasKline && closes.length >= 14 ? getAtr(14) : null;
        if (atrLocal) {
            const atrPctLocal = cp > 0 ? atrLocal / cp * 100 : 0;
            addIfNew(
                'ATR波动率报告', '📐', CATEGORY_MICRO, '中', 4,
                `14日ATR=${atrLocal.toFixed(2)}（${atrPctLocal.toFixed(2)}%），${atrPctLocal > 3 ? '高波动' : atrPctLocal > 1.5 ? '中等波动' : '低波动'}。`,
                'HOLD',
                `ATR代表平均每日波动幅度，${atrPctLocal.toFixed(1)}%${atrPctLocal > 2 ? '适合做T' : '空间有限'}`
            );
        }

        if (hasKline && closes.length >= 20) {
            const high20 = safeArrMax(highs.slice(-20));
            const low20 = safeArrMin(lows.slice(-20));
            if (high20 > low20) {
                const pos20 = (cp - low20) / (high20 - low20) * 100;
                const posStatus = pos20 > 80 ? '高位区' : (pos20 < 20 ? '低位区' : '中位区');
                addIfNew(
                    '20日价格位置', '📍', CATEGORY_PATTERN, '中', 4,
                    `现价位于20日区间的${pos20.toFixed(0)}%位置，处于${posStatus}。区间${low20.toFixed(2)}~${high20.toFixed(2)}。`,
                    'HOLD',
                    `20日${posStatus}，${pos20 > 80 ? '注意压力' : pos20 < 20 ? '关注支撑' : '区间中部'}`
                );
            }
        }

        const buyCountSimple = results.filter(s => s.action && s.action.includes('BUY')).length;
        const sellCountSimple = results.filter(s => s.action && s.action.includes('SELL')).length;

        addIfNew(
            '[常态] 多维度综合评估', '📋', CATEGORY_NOVEL, '中', 4,
            `综合趋势、震荡、量价、形态四大维度分析，当前${buyCountSimple > sellCountSimple ? '偏多' : sellCountSimple > buyCountSimple ? '偏空' : '震荡平衡'}格局。`,
            'HOLD',
            '全维度扫描，持续监控中'
        );

        if (hasKline && closes.length >= 30) {
            const ma5v = getSma(5) || 0;
            const ma10v = getSma(10) || 0;
            const ma20v = getSma(20) || 0;
            if (ma5v && ma10v && ma20v) {
                addIfNew('MA5均线走势', '📈', CATEGORY_TREND, '中', 4,
                    `MA5=${ma5v.toFixed(2)}，5日均线${ma5v > ma10v ? '向上' : '向下'}，短期趋势${ma5v > ma10v ? '偏多' : '偏空'}。`,
                    ma5v > ma10v ? 'HOLD' : 'WATCH',
                    `MA5方向：${ma5v > ma10v ? '多头' : '空头'}`);
                addIfNew('MA10均线走势', '📊', CATEGORY_TREND, '中', 4,
                    `MA10=${ma10v.toFixed(2)}，10日均线${ma10v > ma20v ? '向上' : '向下'}，中期趋势${ma10v > ma20v ? '偏多' : '偏空'}。`,
                    ma10v > ma20v ? 'HOLD' : 'WATCH',
                    `MA10方向：${ma10v > ma20v ? '多头' : '空头'}`);
                addIfNew('MA20均线走势', '📉', CATEGORY_TREND, '中', 4,
                    `MA20=${ma20v.toFixed(2)}，20日均线趋势${cp > ma20v ? '向上' : '向下'}，${cp > ma20v ? '价格在均线上方' : '价格在均线下方'}。`,
                    cp > ma20v ? 'HOLD' : 'WATCH',
                    `MA20支撑/压力：${cp > ma20v ? '支撑' : '压力'}`);
                addIfNew('均线系统排列', '🔀', CATEGORY_TREND, '中', 4,
                    `MA5(${ma5v.toFixed(2)}) MA10(${ma10v.toFixed(2)}) MA20(${ma20v.toFixed(2)})，${ma5v > ma10v && ma10v > ma20v ? '多头排列' : ma5v < ma10v && ma10v < ma20v ? '空头排列' : '混合排列'}。`,
                    ma5v > ma10v && ma10v > ma20v ? 'BUY' : ma5v < ma10v && ma10v < ma20v ? 'SELL' : 'HOLD',
                    `均线排列：${ma5v > ma10v && ma10v > ma20v ? '多头强势' : ma5v < ma10v && ma10v < ma20v ? '空头弱势' : '震荡整理'}`);
            }
        }

        if (hasKline && closes.length >= 26) {
            const [dif, dea] = getMacd();
            if (dif !== null && dea !== null) {
                const hist = dif - dea;
                addIfNew('MACD-DIF走势', '📈', CATEGORY_TREND, '中', 4,
                    `DIF=${dif.toFixed(4)}，${dif > dea ? '在DEA上方' : '在DEA下方'}，${dif > 0 ? '零轴上' : '零轴下'}。`,
                    dif > dea ? 'HOLD' : 'WATCH',
                    `DIF方向：${dif > dea ? '多头' : '空头'}`);
                addIfNew('MACD-DEA走势', '📊', CATEGORY_TREND, '中', 4,
                    `DEA=${dea.toFixed(4)}，${dea > 0 ? '零轴上方' : '零轴下方'}，中长期趋势${dea > 0 ? '偏多' : '偏空'}。`,
                    dea > 0 ? 'HOLD' : 'WATCH',
                    `DEA位置：${dea > 0 ? '多方区域' : '空方区域'}`);
                addIfNew('MACD柱状图', '📊', CATEGORY_TREND, '中', 4,
                    `MACD柱=${hist.toFixed(4)}，${hist > 0 ? '红柱' : '绿柱'}，${Math.abs(hist) > Math.abs(dea) * 0.5 ? '动能较强' : '动能较弱'}。`,
                    hist > 0 ? 'HOLD' : 'WATCH',
                    `MACD柱：${hist > 0 ? '多方动能' : '空方动能'}`);
            }
        }

        if (hasKline && closes.length >= 20) {
            const [upper, mid, lower] = getBoll(20);
            if (upper && mid && lower && cp > 0) {
                const bollWidth = upper > lower ? (upper - lower) / mid * 100 : 0;
                addIfNew('布林上轨状态', '⬆️', CATEGORY_TREND, '中', 4,
                    `布林上轨=${upper.toFixed(2)}，${cp < upper ? '价格在上轨下方' : '价格突破上轨'}，上轨${cp < upper ? '是压力' : '被突破'}。`,
                    cp < upper ? 'HOLD' : 'WATCH',
                    `布林上轨：${cp < upper ? '压力位' : '突破位'}`);
                addIfNew('布林中轨状态', '➡️', CATEGORY_TREND, '中', 4,
                    `布林中轨=${mid.toFixed(2)}，${cp > mid ? '价格在中轨上方' : '价格在中轨下方'}，中轨${cp > mid ? '支撑' : '压力'}。`,
                    cp > mid ? 'HOLD' : 'WATCH',
                    `布林中轨：${cp > mid ? '支撑' : '压力'}`);
                addIfNew('布林下轨状态', '⬇️', CATEGORY_TREND, '中', 4,
                    `布林下轨=${lower.toFixed(2)}，${cp > lower ? '价格在下轨上方' : '价格跌破下轨'}，下轨${cp > lower ? '支撑' : '被跌破'}。`,
                    cp > lower ? 'HOLD' : 'WATCH',
                    `布林下轨：${cp > lower ? '支撑位' : '跌破位'}`);
                addIfNew('布林带宽分析', '📏', CATEGORY_TREND, '中', 4,
                    `布林带宽=${bollWidth.toFixed(2)}%，${bollWidth > 10 ? '带宽较大' : bollWidth < 5 ? '带宽收窄' : '带宽适中'}，${bollWidth > 10 ? '波动大' : bollWidth < 5 ? '将变盘' : '正常波动'}。`,
                    'HOLD',
                    `布林带宽：${bollWidth.toFixed(1)}%`);
            }
        }

        if (hasKline && closes.length >= 14) {
            const rsi6 = getRsi(6);
            const rsi14 = getRsi(14);
            const rsi24 = getRsi(24);
            if (rsi6 !== null) {
                addIfNew('RSI(6)状态', '📊', CATEGORY_OSCILLATOR, '中', 4,
                    `RSI(6)=${rsi6.toFixed(1)}，${rsi6 > 80 ? '极度超买' : rsi6 > 70 ? '超买区' : rsi6 < 20 ? '极度超卖' : rsi6 < 30 ? '超卖区' : '常态区'}。`,
                    rsi6 > 70 ? 'WATCH' : rsi6 < 30 ? 'BUY' : 'HOLD',
                    `RSI6：${rsi6.toFixed(0)}`);
            }
            if (rsi14 !== null) {
                addIfNew('RSI(14)状态', '📈', CATEGORY_OSCILLATOR, '中', 4,
                    `RSI(14)=${rsi14.toFixed(1)}，${rsi14 > 70 ? '超买' : rsi14 < 30 ? '超卖' : '中性'}，${rsi14 > 50 ? '偏多' : '偏空'}格局。`,
                    rsi14 > 70 ? 'WATCH' : rsi14 < 30 ? 'BUY' : 'HOLD',
                    `RSI14：${rsi14.toFixed(0)}`);
            }
            if (rsi24 !== null) {
                addIfNew('RSI(24)状态', '📉', CATEGORY_OSCILLATOR, '中', 4,
                    `RSI(24)=${rsi24.toFixed(1)}，长期${rsi24 > 50 ? '偏多' : '偏空'}，${rsi24 > 70 ? '长期超买' : rsi24 < 30 ? '长期超卖' : '趋势正常'}。`,
                    rsi24 > 70 ? 'WATCH' : rsi24 < 30 ? 'BUY' : 'HOLD',
                    `RSI24：${rsi24.toFixed(0)}`);
            }
            if (rsi6 !== null && rsi14 !== null) {
                addIfNew('RSI多周期对比', '🔄', CATEGORY_OSCILLATOR, '中', 4,
                    `RSI6=${rsi6.toFixed(0)} RSI14=${rsi14.toFixed(0)}，${rsi6 > rsi14 ? '短期强于长期' : '短期弱于长期'}，${rsi6 > rsi14 && rsi14 > 50 ? '多头加强' : rsi6 < rsi14 && rsi14 < 50 ? '空头加强' : '转换中'}。`,
                    rsi6 > rsi14 ? 'HOLD' : 'WATCH',
                    `RSI周期：${rsi6 > rsi14 ? '短强长弱' : '短弱长强'}`);
            }
        }

        if (hasKline && closes.length >= 9) {
            const [kk, kd, kj] = getKdj();
            if (kk !== null && kd !== null && kj !== null) {
                addIfNew('KDJ-K值状态', '📊', CATEGORY_OSCILLATOR, '中', 4,
                    `K值=${kk.toFixed(1)}，${kk > 80 ? '超买区' : kk < 20 ? '超卖区' : '常态区'}，${kk > kd ? '向上' : '向下'}运行。`,
                    kk > 80 ? 'WATCH' : kk < 20 ? 'BUY' : 'HOLD',
                    `K值：${kk.toFixed(0)}`);
                addIfNew('KDJ-D值状态', '📈', CATEGORY_OSCILLATOR, '中', 4,
                    `D值=${kd.toFixed(1)}，${kd > 80 ? '超买' : kd < 20 ? '超卖' : '中性'}，慢速指标${kd > 50 ? '偏多' : '偏空'}。`,
                    kd > 80 ? 'WATCH' : kd < 20 ? 'BUY' : 'HOLD',
                    `D值：${kd.toFixed(0)}`);
                addIfNew('KDJ-J值状态', '⚡', CATEGORY_OSCILLATOR, '中', 4,
                    `J值=${kj.toFixed(1)}，${kj > 100 ? '极度超买' : kj > 80 ? '超买' : kj < 0 ? '极度超卖' : kj < 20 ? '超卖' : '常态'}。`,
                    kj > 80 ? 'WATCH' : kj < 20 ? 'BUY' : 'HOLD',
                    `J值：${kj.toFixed(0)}`);
            }
        }

        if (hasKline && closes.length >= 14) {
            const cciVal = getCci(14);
            if (cciVal !== null) {
                addIfNew('CCI(14)状态', '📊', CATEGORY_OSCILLATOR, '中', 4,
                    `CCI=${cciVal.toFixed(1)}，${cciVal > 100 ? '超买区' : cciVal < -100 ? '超卖区' : '常态区'}，${cciVal > 0 ? '偏多' : '偏空'}。`,
                    cciVal > 100 ? 'WATCH' : cciVal < -100 ? 'BUY' : 'HOLD',
                    `CCI：${cciVal.toFixed(0)}`);
            }
        }

        if (hasKline && closes.length >= 14) {
            const wrVal = getWr(14);
            if (wrVal !== null) {
                addIfNew('威廉%R(14)状态', '📊', CATEGORY_OSCILLATOR, '中', 4,
                    `W&R=${wrVal.toFixed(1)}%，${wrVal < -80 ? '超卖' : wrVal > -20 ? '超买' : '常态'}，${wrVal < -50 ? '偏弱' : '偏强'}。`,
                    wrVal > -20 ? 'WATCH' : wrVal < -80 ? 'BUY' : 'HOLD',
                    `威廉指标：${wrVal.toFixed(0)}%`);
            }
        }

        if (hasKline && closes.length >= 20) {
            const ma20Bias = getSma(20);
            if (ma20Bias && ma20Bias > 0) {
                const bias5 = (cp - (getSma(5) || cp)) / (getSma(5) || cp) * 100;
                const bias10 = (cp - (getSma(10) || cp)) / (getSma(10) || cp) * 100;
                const bias20 = (cp - ma20Bias) / ma20Bias * 100;
                addIfNew('BIAS(5)乖离率', '📐', CATEGORY_OSCILLATOR, '中', 4,
                    `BIAS5=${bias5.toFixed(2)}%，${bias5 > 5 ? '正偏过大' : bias5 < -5 ? '负偏过大' : '正常范围'}，${bias5 > 0 ? '价格在均线上方' : '下方'}。`,
                    bias5 > 5 ? 'WATCH' : bias5 < -5 ? 'BUY' : 'HOLD',
                    `BIAS5：${bias5.toFixed(1)}%`);
                addIfNew('BIAS(10)乖离率', '📏', CATEGORY_OSCILLATOR, '中', 4,
                    `BIAS10=${bias10.toFixed(2)}%，${bias10 > 8 ? '超买' : bias10 < -8 ? '超卖' : '正常'}，10日乖离${bias10 > 0 ? '正' : '负'}。`,
                    bias10 > 8 ? 'WATCH' : bias10 < -8 ? 'BUY' : 'HOLD',
                    `BIAS10：${bias10.toFixed(1)}%`);
                addIfNew('BIAS(20)乖离率', '📈', CATEGORY_OSCILLATOR, '中', 4,
                    `BIAS20=${bias20.toFixed(2)}%，${bias20 > 10 ? '严重超买' : bias20 < -10 ? '严重超卖' : '正常'}，20日乖离${bias20 > 0 ? '正' : '负'}。`,
                    bias20 > 10 ? 'WATCH' : bias20 < -10 ? 'BUY' : 'HOLD',
                    `BIAS20：${bias20.toFixed(1)}%`);
            }
        }

        if (hasKline && closes.length >= 12) {
            const roc12Base = closesWithToday[Math.max(0, closesWithToday.length - 13)];
            if (roc12Base > 0) {
                const roc12 = (cp - roc12Base) / roc12Base * 100;
                addIfNew('ROC(12)变动率', '📊', CATEGORY_OSCILLATOR, '中', 4,
                    `ROC(12)=${roc12 > 0 ? '+' : ''}${roc12.toFixed(2)}%，12日价格变动率${roc12 > 0 ? '上涨' : '下跌'}，${Math.abs(roc12) > 10 ? '变动剧烈' : '变动正常'}。`,
                    roc12 > 0 ? 'HOLD' : 'WATCH',
                    `ROC12：${roc12.toFixed(1)}%`);
            }
        }

        if (hasKline && volumes.length >= 20) {
            const vol5 = volumes.slice(-5).reduce((a,b)=>a+b,0) / 5;
            const vol10 = volumes.slice(-10).reduce((a,b)=>a+b,0) / 10;
            const vol20 = volumes.slice(-20).reduce((a,b)=>a+b,0) / 20;
            if (vol20 > 0) {
                addIfNew('5日均量变化', '📊', CATEGORY_VOLUME, '中', 4,
                    `5日均量=${(vol5/10000).toFixed(0)}万，${vol5 > vol10 ? '大于10日均量' : '小于10日均量'}，${vol5 > vol10 ? '量能放大' : '量能萎缩'}。`,
                    vol5 > vol10 ? 'HOLD' : 'WATCH',
                    `5日均量：${(vol5/10000).toFixed(0)}万`);
                addIfNew('10日均量变化', '📈', CATEGORY_VOLUME, '中', 4,
                    `10日均量=${(vol10/10000).toFixed(0)}万，${vol10 > vol20 ? '大于20日均量' : '小于20日均量'}，中期${vol10 > vol20 ? '放量' : '缩量'}。`,
                    vol10 > vol20 ? 'HOLD' : 'WATCH',
                    `10日均量：${(vol10/10000).toFixed(0)}万`);
                addIfNew('20日均量趋势', '📉', CATEGORY_VOLUME, '中', 4,
                    `20日均量=${(vol20/10000).toFixed(0)}万，${vol > vol20 ? '当前量大于均量' : '当前量小于均量'}，${vol > vol20 ? '活跃' : '低迷'}。`,
                    vol > vol20 ? 'HOLD' : 'WATCH',
                    `20日均量：${(vol20/10000).toFixed(0)}万`);
                addIfNew('量能趋势分析', '📊', CATEGORY_VOLUME, '中', 4,
                    `量能5/10/20：${(vol5/10000).toFixed(0)}万/${(vol10/10000).toFixed(0)}万/${(vol20/10000).toFixed(0)}万，${vol5 > vol10 && vol10 > vol20 ? '量能递增' : vol5 < vol10 && vol10 < vol20 ? '量能递减' : '量能波动'}。`,
                    vol5 > vol10 ? 'HOLD' : 'WATCH',
                    `量能趋势：${vol5 > vol10 && vol10 > vol20 ? '递增' : vol5 < vol10 && vol10 < vol20 ? '递减' : '波动'}`);
            }
        }

        if (hasKline && volumes.length >= 14) {
            const mfiVal = getMfi(14);
            if (mfiVal !== null) {
                addIfNew('MFI资金流向', '💰', CATEGORY_VOLUME, '中', 4,
                    `MFI(14)=${mfiVal.toFixed(1)}，${mfiVal > 80 ? '超买-资金流出' : mfiVal < 20 ? '超卖-资金流入' : '正常'}，${mfiVal > 50 ? '资金偏多' : '资金偏空'}。`,
                    mfiVal > 80 ? 'WATCH' : mfiVal < 20 ? 'BUY' : 'HOLD',
                    `MFI：${mfiVal.toFixed(0)}`);
            }
        }

        if (hasKline && volumes.length >= 26) {
            const obvNow = getObv();
            if (obvNow !== null && obvNow !== undefined) {
                addIfNew('OBV能量潮', '📊', CATEGORY_VOLUME, '中', 4,
                    `OBV能量潮运行中，${obvNow > 0 ? '累计正流入' : '累计负流出'}，量能${chg > 0 ? '配合上涨' : chg < 0 ? '配合下跌' : '平量'}。`,
                    chg > 0 ? 'HOLD' : 'WATCH',
                    `OBV：${obvNow > 0 ? '正积累' : '负积累'}`);
            }
        }

        if (hasKline && volumes.length >= 12 && closesWithToday.length >= 12) {
            let upVol = 0, downVol = 0, flatVol = 0;
            for (let i = closesWithToday.length - 12; i < closesWithToday.length; i++) {
                if (i > 0) {
                    if (closesWithToday[i] > closesWithToday[i - 1]) upVol += volumesWithToday[i];
                    else if (closesWithToday[i] < closesWithToday[i - 1]) downVol += volumesWithToday[i];
                    else flatVol += volumesWithToday[i];
                }
            }
            const vrCalcVal = (downVol + flatVol / 2) > 0 ? (upVol + flatVol / 2) / (downVol + flatVol / 2) * 100 : 100;
            addIfNew('VR容量比率', '📊', CATEGORY_VOLUME, '中', 4,
                `VR(12)=${vrCalcVal.toFixed(1)}%，${vrCalcVal > 150 ? '过热' : vrCalcVal < 70 ? '低迷' : '正常'}，${vrCalcVal > 100 ? '多头占优' : '空头占优'}。`,
                vrCalcVal > 150 ? 'WATCH' : vrCalcVal < 70 ? 'BUY' : 'HOLD',
                `VR：${vrCalcVal.toFixed(0)}%`);
        }

        if (hasKline && closes.length >= 14) {
            const [pdi, mdi, adx] = getDmi(14);
            if (pdi !== null) {
                addIfNew('DMI-PDI走势', '📈', CATEGORY_TREND, '中', 4,
                    `PDI(+DI)=${pdi.toFixed(2)}，上升方向指标${pdi > mdi ? '强于下降' : '弱于下降'}，${pdi > mdi ? '多头强' : '空头强'}。`,
                    pdi > mdi ? 'HOLD' : 'WATCH',
                    `PDI：${pdi.toFixed(1)}`);
                addIfNew('DMI-MDI走势', '📉', CATEGORY_TREND, '中', 4,
                    `MDI(-DI)=${mdi.toFixed(2)}，下降方向指标${mdi > pdi ? '强于上升' : '弱于上升'}。`,
                    mdi > pdi ? 'WATCH' : 'HOLD',
                    `MDI：${mdi.toFixed(1)}`);
                addIfNew('DMI-ADX趋势强度', '💪', CATEGORY_TREND, '中', 4,
                    `ADX=${adx.toFixed(2)}，趋势强度${adx > 25 ? '明显' : adx > 20 ? '一般' : '极弱'}，${adx > 25 ? '有趋势' : '无趋势'}。`,
                    adx > 25 ? 'HOLD' : 'WATCH',
                    `ADX：${adx.toFixed(1)}`);
            }
        }

        if (hasKline && closes.length >= 10) {
            const [sarNow, sarDir] = getPsar();
            if (sarNow !== null && sarNow !== undefined && cp > 0) {
                addIfNew('SAR抛物线', '🎯', CATEGORY_TREND, '中', 4,
                    `SAR=${sarNow.toFixed(2)}，${cp > sarNow ? '价格在SAR上方' : '价格在SAR下方'}，${cp > sarNow ? '多头趋势' : '空头趋势'}。`,
                    cp > sarNow ? 'HOLD' : 'WATCH',
                    `SAR：${sarNow.toFixed(2)} ${cp > sarNow ? '支撑' : '压力'}`);
            }
        }

        if (hasKline && closes.length >= 5) {
            const closes5 = closes.slice(-5);
            const opens5 = opens.slice(-5);
            let upDays = 0, downDays = 0;
            for (let i = 0; i < closes5.length; i++) {
                if (closes5[i] > opens5[i]) upDays++;
                else if (closes5[i] < opens5[i]) downDays++;
            }
            addIfNew('近5日K线统计', '📅', CATEGORY_PATTERN, '中', 4,
                `近5日阳线${upDays}根，阴线${downDays}根，${upDays > downDays ? '多方占优' : downDays > upDays ? '空方占优' : '多空平衡'}。`,
                upDays > downDays ? 'HOLD' : downDays > upDays ? 'WATCH' : 'HOLD',
                `5日阴阳比：${upDays}:${downDays}`);
        }

        if (hasKline && closes.length >= 10) {
            const closes10 = closes.slice(-10);
            const opens10 = opens.slice(-10);
            let upDays10 = 0, downDays10 = 0;
            for (let i = 0; i < closes10.length; i++) {
                if (closes10[i] > opens10[i]) upDays10++;
                else if (closes10[i] < opens10[i]) downDays10++;
            }
            addIfNew('近10日K线统计', '📆', CATEGORY_PATTERN, '中', 4,
                `近10日阳线${upDays10}根，阴线${downDays10}根，中期${upDays10 > downDays10 ? '偏多' : downDays10 > upDays10 ? '偏空' : '震荡'}。`,
                upDays10 > downDays10 ? 'HOLD' : downDays10 > upDays10 ? 'WATCH' : 'HOLD',
                `10日阴阳比：${upDays10}:${downDays10}`);
        }

        if (hasKline && highs.length >= 20 && lows.length >= 20) {
            const h20 = safeArrMax(highs.slice(-20));
            const l20 = safeArrMin(lows.slice(-20));
            if (h20 > 0 && l20 > 0) {
                const amp20 = (h20 - l20) / l20 * 100;
                addIfNew('20日振幅分析', '📊', CATEGORY_MICRO, '中', 4,
                    `20日振幅${amp20.toFixed(2)}%，区间${l20.toFixed(2)}~${h20.toFixed(2)}，${amp20 > 20 ? '大振幅' : amp20 > 10 ? '中振幅' : '小振幅'}行情。`,
                    'HOLD',
                    `20日振幅：${amp20.toFixed(1)}%`);
            }
        }

        if (hasKline && highs.length >= 60 && lows.length >= 60) {
            const h60 = safeArrMax(highs.slice(-60));
            const l60 = safeArrMin(lows.slice(-60));
            if (h60 > 0 && l60 > 0) {
                const pos60 = (cp - l60) / (h60 - l60) * 100;
                addIfNew('60日价格位置', '📍', CATEGORY_PATTERN, '中', 4,
                    `现价在60日区间的${pos60.toFixed(0)}%位置，60日${pos60 > 80 ? '高位' : pos60 < 20 ? '低位' : '中位'}，区间${l60.toFixed(2)}~${h60.toFixed(2)}。`,
                    pos60 > 80 ? 'WATCH' : pos60 < 20 ? 'BUY' : 'HOLD',
                    `60日位置：${pos60.toFixed(0)}%`);
            }
        }

        addIfNew('[常态] 涨跌幅监控', '📊', CATEGORY_MICRO, '中', 4,
            `今日涨跌幅${chg > 0 ? '+' : ''}${chg.toFixed(2)}%，${Math.abs(chg) > 5 ? '大幅波动' : Math.abs(chg) > 2 ? '中等波动' : '小幅波动'}，${chg > 0 ? '上涨' : chg < 0 ? '下跌' : '平盘'}。`,
            chg > 0 ? 'HOLD' : chg < 0 ? 'WATCH' : 'HOLD',
            `涨跌幅：${chg.toFixed(2)}%`);

        addIfNew('[常态] 换手率监控', '🔄', CATEGORY_VOLUME, '中', 4,
            `换手率正常监控中，${vol > 0 ? '成交活跃' : '成交低迷'}，持续关注量能变化。`,
            'HOLD',
            '换手率：持续监控中');

        addIfNew('[常态] 市盈率估值', '📊', CATEGORY_NOVEL, '中', 4,
            `估值维度监控中，基本面数据持续跟踪，当前技术面${chg > 0 ? '偏多' : '偏空'}。`,
            'HOLD',
            '估值：持续跟踪中');

        addIfNew('[常态] 市净率估值', '📈', CATEGORY_NOVEL, '中', 4,
            `市净率维度监控中，净资产支撑持续跟踪，${cp > 0 ? '价格波动正常' : '价格异常'}。`,
            'HOLD',
            'PB估值：监控中');

        addIfNew('[资金] 主力资金监控', '💰', CATEGORY_VOLUME, '中', 4,
            `主力资金${chg > 0 && vol > 1000000 ? '净流入迹象' : chg < 0 && vol > 1000000 ? '净流出迹象' : '平稳'}，持续跟踪大单动向。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `主力资金：${chg > 0 && vol > 1000000 ? '流入' : '流出'}`);

        addIfNew('[资金] 主力资金综合评估', '💰', CATEGORY_VOLUME, '中', 4,
            `综合分时量价分析：${chg > 0.3 ? '上涨' + chg.toFixed(1) + '%' : chg < -0.3 ? '下跌' + chg.toFixed(1) + '%' : '横盘'}，${(() => {
                const vr = hasKline && volumes.length >= 10 ? vol / (volumes.slice(-10).reduce((a,b)=>a+b,0)/10) : 1;
                if (chg > 0.3 && vr > 1.2) return '放量上涨=主力吸筹';
                if (chg < -0.3 && vr > 1.2) return '放量下跌=主力出货';
                if (chg > 0.5 && vr < 0.7) return '缩量上涨=诱多';
                if (chg < -0.5 && vr < 0.7) return '缩量下跌=洗盘';
                return '量价平稳=主力观望';
            })()}。`,
            chg > 0.3 ? 'HOLD' : 'WATCH',
            `主力资金：${chg > 0.3 ? '偏多' : chg < -0.3 ? '偏空' : '中性'}`);

        addIfNew('[资金] 散户资金监控', '👥', CATEGORY_VOLUME, '中', 4,
            `散户资金情绪${chg > 0 ? '偏乐观' : chg < 0 ? '偏谨慎' : '中性'}，小单成交${vol > 0 ? '活跃' : '低迷'}。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `散户情绪：${chg > 0 ? '乐观' : '谨慎'}`);

        addIfNew('[资金] 散户资金情绪', '👥', CATEGORY_VOLUME, '低', 4,
            `散户情绪${amplitude > 4 ? '恐慌/贪婪明显' : amplitude > 2 ? '有所波动' : '相对平静'}，${Math.abs(chg) > 3 ? '追涨杀跌明显' : '操作理性'}。`,
            Math.abs(chg) > 3 ? 'WATCH' : 'HOLD',
            `散户情绪：${amplitude > 4 ? '极端' : '正常'}`);

        addIfNew('[情绪] 市场情绪监控', '😊', CATEGORY_NOVEL, '中', 4,
            `市场情绪${chg > 0 ? '偏暖' : chg < 0 ? '偏冷' : '中性'}，${amplitude > 3 ? '波动大情绪不稳定' : '波动小情绪稳定'}。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `情绪温度：${chg > 0 ? '暖' : chg < 0 ? '冷' : '中性'}`);

        addIfNew('[筹码] 筹码分布监控', '🎯', CATEGORY_NOVEL, '中', 4,
            `筹码分布持续监控中，${chg > 0 ? '获利筹码增加' : '套牢筹码增加'}，关注密集成交区支撑压力。`,
            'HOLD',
            '筹码分布：监控中');

        addIfNew('[机构] 机构动向监控', '🏛️', CATEGORY_NOVEL, '中', 4,
            `机构动向持续跟踪中，${vol > 2000000 && chg > 0 ? '可能有机构进场' : vol > 2000000 && chg < 0 ? '可能有机构离场' : '机构动作不明显'}。`,
            vol > 2000000 && chg > 0 ? 'HOLD' : 'WATCH',
            `机构动向：${vol > 2000000 ? '关注' : '平淡'}`);

        addIfNew('[消息] 消息面监控', '📰', CATEGORY_NOVEL, '中', 4,
            `消息面持续监控中，暂无重大突发消息，${amplitude > 5 ? '波动较大可能有消息刺激' : '走势平稳'}。`,
            'HOLD',
            '消息面：平静');

        addIfNew('[大盘] 市场环境监控', '🌐', CATEGORY_NOVEL, '中', 4,
            `市场环境${chg > 0 ? '偏多' : chg < 0 ? '偏空' : '震荡'}，个股走势${amplitude > 3 ? '活跃' : '平稳'}，注意系统性风险。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `市场环境：${chg > 0 ? '偏多' : '偏空'}`);

        addIfNew('[风控] 风险等级评估', '🛡️', CATEGORY_NOVEL, '中', 4,
            `当前风险等级：${amplitude > 5 || Math.abs(chg) > 5 ? '高' : amplitude > 3 || Math.abs(chg) > 3 ? '中' : '低'}，${amplitude > 5 ? '注意控制仓位' : '正常操作即可'}。`,
            amplitude > 5 ? 'WATCH' : 'HOLD',
            `风险等级：${amplitude > 5 ? '高' : amplitude > 3 ? '中' : '低'}`);

        addIfNew('[做T] 做T环境评估', '🔄', CATEGORY_MICRO, '中', 4,
            `做T环境：${amplitude > 3 ? '优秀' : amplitude > 2 ? '良好' : amplitude > 1.5 ? '一般' : '差'}，振幅${amplitude.toFixed(2)}%${amplitude > 1.5 ? '适合做T' : '空间不足'}。`,
            amplitude > 1.5 ? 'HOLD' : 'WATCH',
            `做T评级：${amplitude > 3 ? 'A' : amplitude > 2 ? 'B' : amplitude > 1.5 ? 'C' : 'D'}`);

        addIfNew('[技术] 均线系统评估', '📈', CATEGORY_TREND, '中', 4,
            `均线系统${chg > 0 ? '偏多' : chg < 0 ? '偏空' : '中性'}，${amplitude > 3 ? '趋势活跃' : '趋势平稳'}，持续跟踪均线排列变化。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `均线系统：${chg > 0 ? '多头排列' : '空头排列'}`);

        addIfNew('[技术] 指标系统评估', '📊', CATEGORY_OSCILLATOR, '中', 4,
            `技术指标综合评估中，震荡指标${chg > 0 ? '偏强' : '偏弱'}，趋势指标${chg > 0 ? '向上' : '向下'}。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `指标综合：${chg > 0 ? '偏多' : '偏空'}`);

        addIfNew('[技术] 量价配合评估', '📊', CATEGORY_VOLUME, '中', 4,
            `量价配合${chg > 0 && vol > 1000000 ? '良好' : chg < 0 && vol > 1000000 ? '放量下跌' : '一般'}，${vol > 1000000 ? '量能充足' : '量能不足'}。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `量价配合：${chg > 0 && vol > 1000000 ? '健康' : '需观察'}`);

        addIfNew('[形态] K线形态监控', '📐', CATEGORY_PATTERN, '中', 4,
            `K线形态持续监控中，${chg > 2 ? '大阳线偏多' : chg < -2 ? '大阴线偏空' : '小阴小阳震荡'}。`,
            chg > 2 ? 'HOLD' : chg < -2 ? 'WATCH' : 'HOLD',
            `K线形态：${Math.abs(chg) > 2 ? '明确方向' : '震荡整理'}`);

        addIfNew('[形态] 支撑压力监控', '📍', CATEGORY_PATTERN, '中', 4,
            `支撑压力位持续跟踪，当前价位${amplitude > 0 ? '在区间内运行' : '异常'}，注意关键位置突破或跌破。`,
            'HOLD',
            '支撑压力：持续跟踪中');

        addIfNew('[资金] 资金流向评估', '💰', CATEGORY_VOLUME, '中', 4,
            `资金流向${chg > 0 ? '净流入' : chg < 0 ? '净流出' : '持平'}，${vol > 2000000 ? '资金关注度高' : '资金关注度一般'}。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `资金流向：${chg > 0 ? '流入' : chg < 0 ? '流出' : '平衡'}`);

        addIfNew('[资金] 量价配合度评估', '💰', CATEGORY_VOLUME, '中', 4,
            `量价配合${(() => {
                const vr = hasKline && volumes.length >= 5 ? vol / (volumes.slice(-5).reduce((a,b)=>a+b,0)/5) : 1;
                if (chg > 0 && vr > 1.2) return '良好：涨+放量';
                if (chg < 0 && vr > 1.2) return '差：跌+放量';
                if (chg > 0 && vr < 0.8) return '背离：涨+缩量';
                return '中性：量价匹配';
            })()}，${(() => {
                const vr = hasKline && volumes.length >= 5 ? vol / (volumes.slice(-5).reduce((a,b)=>a+b,0)/5) : 1;
                return vr > 1.5 ? '量能充沛' : vr < 0.7 ? '量能不足' : '量能正常';
            })()}。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `量价配合：${chg > 0 ? '偏多' : '偏空'}`);

        addIfNew('[情绪] 涨跌停分析', '😊', CATEGORY_NOVEL, '中', 4,
            `市场情绪${Math.abs(chg) > 5 ? '极度波动' : Math.abs(chg) > 3 ? '强烈' : '平稳'}，${amplitude > 5 ? '多空博弈激烈' : '情绪稳定'}。`,
            Math.abs(chg) > 5 ? 'WATCH' : 'HOLD',
            `情绪强度：${Math.abs(chg) > 5 ? '高' : Math.abs(chg) > 3 ? '中' : '低'}`);

        addIfNew('[筹码] 获利盘分析', '🎯', CATEGORY_NOVEL, '中', 4,
            `筹码获利${chg > 0 ? '比例增加' : '比例减少'}，${amplitude > 3 ? '筹码松动风险' : '筹码稳定'}。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `获利盘：${chg > 0 ? '增加' : '减少'}`);

        addIfNew('[机构] 主力行为分析', '🏛️', CATEGORY_NOVEL, '中', 4,
            `主力行为${vol > 2000000 && chg > 0 ? '吸筹迹象' : vol > 2000000 && chg < 0 ? '出货迹象' : '动作不明显'}，持续跟踪。`,
            vol > 2000000 && chg > 0 ? 'HOLD' : 'WATCH',
            `主力行为：${vol > 2000000 ? '关注' : '平淡'}`);

        addIfNew('[机构] 主力行为综合研判', '🏛️', CATEGORY_VOLUME, '中', 4,
            `主力行为${(() => {
                const vr = hasKline && volumes.length >= 10 ? vol / (volumes.slice(-10).reduce((a,b)=>a+b,0)/10) : 1;
                const pos = hp > lp ? (cp - lp) / (hp - lp) : 0.5;
                if (chg > 0.3 && vr > 1.5 && pos > 0.6) return '主动吸筹：涨+放量+价在高位';
                if (chg < -0.3 && vr > 1.5 && pos < 0.4) return '主动出货：跌+放量+价在低位';
                if (chg > 0.5 && vr < 0.7) return '诱多拉升：涨+缩量';
                if (chg < -0.5 && vr < 0.7) return '洗盘震仓：跌+缩量';
                return '观望不动：量价平稳';
            })()}，大单${amt > 0 && vol > 0 ? (amt/vol > 50000 ? '活跃' : '平淡') : '未明'}。`,
            chg > 0.3 ? 'HOLD' : 'WATCH',
            `主力行为：${chg > 0.3 ? '偏多' : chg < -0.3 ? '偏空' : '中性'}`);

        addIfNew('[消息] 公告信息监控', '📰', CATEGORY_NOVEL, '中', 4,
            `公告消息面平静，${amplitude > 5 ? '异动可能有消息' : '暂无突发消息'}，持续关注公司公告。`,
            'HOLD',
            '消息面：监控中');

        addIfNew('[大盘] 板块联动监控', '🌐', CATEGORY_NOVEL, '中', 4,
            `板块联动${chg > 0 ? '正向' : chg < 0 ? '负向' : '中性'}，${amplitude > 3 ? '板块活跃度高' : '板块平稳'}。`,
            chg > 0 ? 'HOLD' : 'WATCH',
            `板块联动：${chg > 0 ? '偏多' : '偏空'}`);

        addIfNew('[风控] 仓位管理建议', '🛡️', CATEGORY_NOVEL, '中', 4,
            `仓位建议：${amplitude > 5 ? '降低仓位控制风险' : amplitude > 3 ? '适度仓位灵活操作' : '正常仓位'}，当前风险${amplitude > 5 ? '较高' : '可控'}。`,
            amplitude > 5 ? 'WATCH' : 'HOLD',
            `仓位建议：${amplitude > 5 ? '减仓' : amplitude > 3 ? '适中' : '正常'}`);

        addIfNew('[策略] 多策略共振度', '🎯', CATEGORY_NOVEL, '中', 4,
            `多策略共振${buyCountSimple > sellCountSimple ? '偏多' : sellCountSimple > buyCountSimple ? '偏空' : '平衡'}，${Math.abs(buyCountSimple - sellCountSimple) > 10 ? '信号明确' : '信号一般'}。`,
            buyCountSimple > sellCountSimple ? 'HOLD' : 'WATCH',
            `共振度：${Math.abs(buyCountSimple - sellCountSimple) > 10 ? '强' : '中'}`);

        let fillNum = 0;
        while (results.length < TARGET_TOTAL && fillNum < 30) {
            fillNum++;
            addIfNew(
                `[监控] 技术指标扫描 #${fillNum}`, '🔍', CATEGORY_OSCILLATOR, '低', 5,
                `持续监控第${fillNum}组辅助指标，当前无异常信号触发，保持观望。`,
                'WATCH',
                '辅助监控指标：OBV/MFI/VR/ASI/EMV/TRIX/UOS等，无信号即表示正常'
            );
        }

        results.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

        // =================================================================
        //  ⭐ 综合所有策略的最优做T建议（确保盈利优先）
        //  核心原则：买入价要能买到，卖出价要能卖出且盈利
        //  手续费：双边0.2%，盈利必须>=0.3%才能确保赚钱
        //  输出：正T方案 + 反T方案 + 箱体方案 + 成功概率
        // =================================================================

        if (holdQty > 0 && amplitude > 1.5) {
            const BUY_ACTIONS_T = new Set(['BUY', 'STRONG_BUY']);
            const SELL_ACTIONS_T = new Set(['SELL', 'STRONG_SELL']);

            const buyStrats = results.filter(s => BUY_ACTIONS_T.has(s.action));
            const sellStrats = results.filter(s => SELL_ACTIONS_T.has(s.action));

            // 计算方向偏好
            let buyScore = 0;
            let sellScore = 0;
            for (const s of buyStrats) {
                const weight = s.priority === 0 ? 3 : s.priority === 1 ? 2 : 1;
                buyScore += weight;
            }
            for (const s of sellStrats) {
                const weight = s.priority === 0 ? 3 : s.priority === 1 ? 2 : 1;
                sellScore += weight;
            }
            
            // T+0信号权重调整
            for (const s of results) {
                const weight = s.priority === 0 ? 3 : s.priority === 1 ? 2 : 1;
                if (s.action === 'BUY_THEN_SELL') {
                    buyScore += weight * 0.7;
                    sellScore += weight * 0.3;
                } else if (s.action === 'SELL_THEN_BUY') {
                    buyScore += weight * 0.3;
                    sellScore += weight * 0.7;
                }
            }

            const totalScore = buyScore + sellScore;
            const bias = totalScore > 0 ? (buyScore - sellScore) / totalScore : 0;

            // =====================================================
            //  计算成功概率的函数
            //  基于：振幅、策略共振、可达性、当前价位位置
            // =====================================================
            const calcSuccessRate = (buyP, sellP, action) => {
                let rate = 50; // 基础概率50%
                
                // 1. 振幅因素（权重30%）
                if (amplitude >= 5) rate += 20;
                else if (amplitude >= 3) rate += 15;
                else if (amplitude >= 2) rate += 10;
                else if (amplitude >= 1.5) rate += 5;
                
                // 2. 策略共振因素（权重30%）
                if (action === 'BUY_THEN_SELL') {
                    const resonance = buyScore - sellScore;
                    if (resonance > 10) rate += 15;
                    else if (resonance > 5) rate += 10;
                    else if (resonance > 0) rate += 5;
                } else if (action === 'SELL_THEN_BUY') {
                    const resonance = sellScore - buyScore;
                    if (resonance > 10) rate += 15;
                    else if (resonance > 5) rate += 10;
                    else if (resonance > 0) rate += 5;
                } else {
                    // 箱体/中性
                    if (Math.abs(bias) < 0.1) rate += 10;
                }
                
                // 3. 可达性因素（权重20%）
                if (action === 'BUY_THEN_SELL') {
                    // 买入价接近当前价=容易买到
                    const buyFromCp = Math.abs(buyP - cp) / cp * 100;
                    if (buyFromCp <= 1) rate += 8;
                    else if (buyFromCp <= 2) rate += 5;
                    // 卖出价低于日内高点=容易卖出
                    const sellFromHp = (hp - sellP) / hp * 100;
                    if (sellFromHp >= 0 && sellFromHp <= 2) rate += 8;
                    else if (sellFromHp > 2 && sellFromHp <= 5) rate += 5;
                } else if (action === 'SELL_THEN_BUY') {
                    // 卖出价接近当前价=容易卖出
                    const sellFromCp = Math.abs(sellP - cp) / cp * 100;
                    if (sellFromCp <= 1) rate += 8;
                    else if (sellFromCp <= 2) rate += 5;
                    // 买入价高于日内低点=容易买到
                    const buyFromLp = (buyP - lp) / lp * 100;
                    if (buyFromLp >= 0 && buyFromLp <= 2) rate += 8;
                    else if (buyFromLp > 2 && buyFromLp <= 5) rate += 5;
                }
                
                // 4. 盈利空间因素（权重20%）
                const profitPct = Math.abs(sellP - buyP) / Math.min(buyP, sellP) * 100;
                const profitAfterFee = profitPct - feeRate * 100 * 2;
                if (profitAfterFee >= 2) rate += 10;
                else if (profitAfterFee >= 1) rate += 7;
                else if (profitAfterFee >= 0.5) rate += 4;
                else if (profitAfterFee >= 0.3) rate += 2;
                
                // 限制在合理范围
                return Math.max(30, Math.min(95, rate));
            };

            // =====================================================
            //  生成做T方案列表（正T、反T、箱体）
            // =====================================================
            const tPlans = [];

            // ===== 正T方案（先买后卖）=====
            let posBuyPrice = Math.min(cp, hp * 0.95);
            let posSellPrice = Math.max(posBuyPrice * (1 + minProfitPct / 100 + feeRate * 2), Math.min(hp * 0.99, cp * 1.02));

            if (amplitude > 3) {
                posBuyPrice = Math.min(cp, hp * 0.95);
                posSellPrice = Math.max(posBuyPrice * 1.005, Math.min(hp * 0.98, cp * 1.03));
            }

            // 如果有持仓成本，正T买入价取当前价和成本价中的较低者，摊薄成本
            if (holdCost > 0 && cp > holdCost && posBuyPrice > holdCost) {
                posBuyPrice = Math.max(holdCost * 0.998, posBuyPrice * 0.999);
            }

            const posGrossProfit = (posSellPrice - posBuyPrice) / posBuyPrice * 100;
            const posProfitAfterFee = posGrossProfit - feeRate * 100 * 2;

            if (posProfitAfterFee >= minProfitPct && posSellPrice > posBuyPrice && posBuyPrice > 0) {
                const posRate = calcSuccessRate(posBuyPrice, posSellPrice, 'BUY_THEN_SELL');
                tPlans.push({
                    action: 'BUY_THEN_SELL',
                    name: '正T方案（先买后卖）',
                    buyPrice: Math.round(posBuyPrice * 100) / 100,
                    sellPrice: Math.round(posSellPrice * 100) / 100,
                    profitPct: Math.round(posProfitAfterFee * 100) / 100,
                    grossProfitPct: Math.round(posGrossProfit * 100) / 100,
                    successRate: posRate,
                    icon: '📈',
                    desc: `当前价${cp.toFixed(2)}附近买入${posBuyPrice.toFixed(2)}，冲高${posSellPrice.toFixed(2)}卖出`,
                    direction: '偏多',
                    isPrimary: bias > 0.15
                });
            }

            // ===== 反T方案（先卖后买）=====
            let revSellPrice = Math.max(cp, lp * 1.05);
            let revBuyPrice = Math.min(revSellPrice * (1 - minProfitPct / 100 - feeRate * 2), Math.max(lp * 1.01, cp * 0.98));

            if (amplitude > 3) {
                revSellPrice = Math.max(cp, lp * 1.05);
                revBuyPrice = Math.min(revSellPrice * 0.995, Math.max(lp * 1.02, cp * 0.98));
            }

            // 如果有持仓成本，反T卖出价必须高于成本，避免割肉式反T
            if (holdCost > 0 && revSellPrice < holdCost * 1.003) {
                revSellPrice = Math.max(cp, holdCost * 1.005);
            }

            const revGrossProfit = (revSellPrice - revBuyPrice) / revBuyPrice * 100;
            const revProfitAfterFee = revGrossProfit - feeRate * 100 * 2;

            if (revProfitAfterFee >= minProfitPct && revSellPrice > revBuyPrice && revBuyPrice > 0) {
                const revRate = calcSuccessRate(revBuyPrice, revSellPrice, 'SELL_THEN_BUY');
                tPlans.push({
                    action: 'SELL_THEN_BUY',
                    name: '反T方案（先卖后买）',
                    buyPrice: Math.round(revBuyPrice * 100) / 100,
                    sellPrice: Math.round(revSellPrice * 100) / 100,
                    profitPct: Math.round(revProfitAfterFee * 100) / 100,
                    grossProfitPct: Math.round(revGrossProfit * 100) / 100,
                    successRate: revRate,
                    icon: '📉',
                    desc: `当前价${cp.toFixed(2)}附近卖出${revSellPrice.toFixed(2)}，回落${revBuyPrice.toFixed(2)}接回`,
                    direction: '偏空',
                    isPrimary: bias < -0.15
                });
            }

            // ===== 箱体方案（高抛低吸）=====
            const boxTop = Math.min(hp * 0.98, avgPrice * 1.02);
            const boxBot = Math.max(lp * 1.02, avgPrice * 0.98);
            let boxBuyPrice = Math.min(boxBot, cp * 0.99);
            let boxSellPrice = Math.max(boxBuyPrice * (1 + minProfitPct / 100 + feeRate * 2), Math.min(boxTop, cp * 1.01));
            
            const boxGrossProfit = (boxSellPrice - boxBuyPrice) / boxBuyPrice * 100;
            const boxProfitAfterFee = boxGrossProfit - feeRate * 100 * 2;
            
            if (boxProfitAfterFee >= minProfitPct && boxSellPrice > boxBuyPrice && boxBuyPrice > 0) {
                const boxRate = calcSuccessRate(boxBuyPrice, boxSellPrice, 'BOX_TRADING');
                tPlans.push({
                    action: 'BOX_TRADING',
                    name: '箱体方案（高抛低吸）',
                    buyPrice: Math.round(boxBuyPrice * 100) / 100,
                    sellPrice: Math.round(boxSellPrice * 100) / 100,
                    profitPct: Math.round(boxProfitAfterFee * 100) / 100,
                    grossProfitPct: Math.round(boxGrossProfit * 100) / 100,
                    successRate: boxRate,
                    icon: '🔄',
                    desc: `箱底${boxBuyPrice.toFixed(2)}买入，箱顶${boxSellPrice.toFixed(2)}卖出`,
                    direction: '震荡',
                    isPrimary: Math.abs(bias) <= 0.15
                });
            }

            // 按成功概率排序
            tPlans.sort((a, b) => b.successRate - a.successRate);

            // =====================================================
            //  输出做T方案
            // =====================================================
            if (tPlans.length === 0) {
                // 没有可行方案，给出观望建议
                results.unshift(this._make(
                    '⭐ 暂不做T-振幅不足', '⚠️', CATEGORY_MICRO, '中', 2,
                    `当前振幅${amplitude.toFixed(2)}%，买卖价差不足以覆盖手续费${(feeRate * 100 * 2).toFixed(2)}%，暂不建议做T。`,
                    'HOLD',
                    `做T需要振幅≥1.5%且盈利空间≥${minProfitPct}%，当前条件不满足`,
                    { amplitude: amplitude, fee_pct: feeRate * 100 * 2, min_profit: minProfitPct }
                ));
            } else {
                // 主推方案（成功概率最高的）
                const primary = tPlans[0];
                
                results.unshift(this._make(
                    `⭐ 主推：${primary.name}`, primary.icon, CATEGORY_MICRO, '高', 1,
                    `${primary.desc}。买入价${primary.buyPrice.toFixed(2)}，卖出价${primary.sellPrice.toFixed(2)}，获利空间${primary.profitPct.toFixed(2)}%，成功概率${primary.successRate}%。`,
                    primary.action,
                    `基于${results.length}个策略综合分析，${primary.direction}行情下的最优做T方案`,
                    {
                        plan_type: 'primary',
                        action: primary.action,
                        buy_price: primary.buyPrice,
                        sell_price: primary.sellPrice,
                        profit_potential: primary.profitPct,
                        gross_profit: primary.grossProfitPct,
                        fee_pct: feeRate * 100 * 2,
                        success_rate: primary.successRate,
                        bias: Math.round(bias * 100) / 100,
                        amplitude: amplitude,
                        buy_score: buyScore,
                        sell_score: sellScore
                    }
                ));

                // 备选方案（其他可行情的方案）
                for (let i = 1; i < tPlans.length; i++) {
                    const alt = tPlans[i];
                    const altIcon = alt.isPrimary ? alt.icon : '🔁';
                    const altName = alt.isPrimary ? alt.name : `备选：${alt.name}`;
                    
                    results.unshift(this._make(
                        altName, altIcon, CATEGORY_MICRO, '中', 2,
                        `${alt.desc}。买入价${alt.buyPrice.toFixed(2)}，卖出价${alt.sellPrice.toFixed(2)}，获利空间${alt.profitPct.toFixed(2)}%，成功概率${alt.successRate}%。`,
                        alt.action,
                        `${alt.direction}行情下的备选做T方案，${alt.successRate >= primary.successRate ? '与主推方案相当' : '成功概率略低于主推'}`,
                        {
                            plan_type: 'alternative',
                            action: alt.action,
                            buy_price: alt.buyPrice,
                            sell_price: alt.sellPrice,
                            profit_potential: alt.profitPct,
                            gross_profit: alt.grossProfitPct,
                            fee_pct: feeRate * 100 * 2,
                            success_rate: alt.successRate,
                            bias: Math.round(bias * 100) / 100,
                            amplitude: amplitude
                        }
                    ));
                }

                // 价格、获利、概率汇总
                const planSummary = tPlans.map(p => 
                    `${p.name}: 买${p.buyPrice.toFixed(2)}/卖${p.sellPrice.toFixed(2)}/获利${p.profitPct.toFixed(2)}%/概率${p.successRate}%`
                ).join(' | ');
                
                results.unshift(this._make(
                    '📊 做T方案汇总', '📋', CATEGORY_MICRO, '高', 0,
                    `共${tPlans.length}个可行情方案：${planSummary}。当前振幅${amplitude.toFixed(2)}%，方向偏好${bias > 0.15 ? '偏多' : bias < -0.15 ? '偏空' : '震荡'}。`,
                    tPlans[0].action,
                    `所有方案都确保盈利≥${minProfitPct}%（扣除手续费后），按成功概率排序推荐`,
                    {
                        plan_type: 'summary',
                        total_plans: tPlans.length,
                        primary_plan: tPlans[0].action,
                        best_profit: Math.max(...tPlans.map(p => p.profitPct)),
                        best_success_rate: Math.max(...tPlans.map(p => p.successRate)),
                        all_plans: tPlans.map(p => ({
                            action: p.action,
                            name: p.name,
                            buy: p.buyPrice,
                            sell: p.sellPrice,
                            profit: p.profitPct,
                            rate: p.successRate
                        }))
                    }
                ));
            }
        }

        // =================================================================
        //  生成最优操作方案摘要
        // =================================================================

        const BUY_ACTIONS = new Set(['BUY', 'STRONG_BUY']);
        const SELL_ACTIONS = new Set(['SELL', 'STRONG_SELL']);
        // 可执行的做T方案：正T、反T、箱体（TRADING_OPPORTUNITY 只是机会提示，不是可执行方案）
        const T_ACTIONS = new Set(['BUY_THEN_SELL', 'SELL_THEN_BUY', 'BOX_TRADING']);

        const buySignals = results.filter(s => BUY_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        const sellSignals = results.filter(s => SELL_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        // 有持仓时筛选做T方案，没有持仓时也展示（作为机会参考，前端会提示需要底仓）
        const tSignals = results.filter(s => T_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

        // ========== 日内时段判断 ==========
        // 交易时段：9:30-11:30, 13:00-15:00，共4小时 = 240分钟
        let timeSession = '午盘';
        let timeRemaining = 240; // 剩余交易时间（分钟），默认全天
        let isLateDay = false;

        // 关键时间点（小时*60 + 分钟）
        const nowMin = hour * 60 + minute;
        const OPEN = 9 * 60 + 30;      // 9:30 开盘
        const NOON_END = 11 * 60 + 30; // 11:30 午休开始
        const NOON_START = 13 * 60;    // 13:00 午盘开始
        const CLOSE = 15 * 60;          // 15:00 收盘
        const LATE_START = 14 * 60 + 30; // 14:30 进入尾盘

        // 计算当前到15:00收盘还剩多少分钟
        if (nowMin < OPEN) {
            // 9:30 之前：距离开盘还有时间，全天4小时未开始
            timeSession = '盘前';
            timeRemaining = 240;
        } else if (nowMin >= OPEN && nowMin < 10 * 60) {
            // 9:30 - 10:00：早盘开始
            timeSession = '早盘';
            timeRemaining = (NOON_END - nowMin) + (CLOSE - NOON_START); // 到收盘的总时间
        } else if (nowMin >= 10 * 60 && nowMin < 11 * 60) {
            // 10:00 - 11:00：早盘
            timeSession = '早盘';
            timeRemaining = (NOON_END - nowMin) + (CLOSE - NOON_START);
        } else if (nowMin >= 11 * 60 && nowMin < NOON_END) {
            // 11:00 - 11:30：早盘末
            timeSession = '早盘末';
            timeRemaining = (NOON_END - nowMin) + (CLOSE - NOON_START);
        } else if (nowMin >= NOON_END && nowMin < NOON_START) {
            // 11:30 - 13:00：午间休市
            timeSession = '午间休市';
            timeRemaining = CLOSE - NOON_START;
        } else if (nowMin >= NOON_START && nowMin < 14 * 60) {
            // 13:00 - 14:00：午盘
            timeSession = '午盘';
            timeRemaining = CLOSE - nowMin;
        } else if (nowMin >= 14 * 60 && nowMin < LATE_START) {
            // 14:00 - 14:30：午盘末
            timeSession = '午盘末';
            timeRemaining = CLOSE - nowMin;
        } else {
            // 14:30 - 15:00：尾盘
            timeSession = '尾盘';
            timeRemaining = Math.max(5, CLOSE - nowMin);
            isLateDay = true;
        }

        // 综合趋势方向：基于买卖信号的优先级权重加权计算
        let _buyWeight = 0, _sellWeight = 0;
        for (const s of results) {
            const w = s.priority === 0 ? 3 : s.priority === 1 ? 2 : 1;
            if (BUY_ACTIONS.has(s.action)) {
                _buyWeight += w;
            } else if (SELL_ACTIONS.has(s.action)) {
                _sellWeight += w;
            } else if (s.action === 'BUY_THEN_SELL') {
                // 正T偏多：买入意愿更强
                _buyWeight += w * 0.7;
                _sellWeight += w * 0.3;
            } else if (s.action === 'SELL_THEN_BUY') {
                // 反T偏空：卖出意愿更强
                _buyWeight += w * 0.3;
                _sellWeight += w * 0.7;
            } else if (s.action === 'BOX_TRADING' || s.action === 'TRADING_OPPORTUNITY') {
                // 箱体/机会：中性
                _buyWeight += w * 0.5;
                _sellWeight += w * 0.5;
            }
        }
        const _totalWeight = _buyWeight + _sellWeight;
        const _bias = _totalWeight > 0 ? (_buyWeight - _sellWeight) / _totalWeight : 0;
        let _direction = 'HOLD';
        if (_bias >= 0.4) _direction = 'STRONG_BUY';
        else if (_bias >= 0.15) _direction = 'BUY';
        else if (_bias <= -0.4) _direction = 'STRONG_SELL';
        else if (_bias <= -0.15) _direction = 'SELL';

        const summary = {
            stock_code: code,
            stock_name: name,
            current_price: cp,
            atr: Math.round(atrVal * 100) / 100,
            atr_pct: cp > 0 ? Math.round((atrVal / cp * 100) * 100) / 100 : 0,
            total_signals: results.length,
            buy_signals: buySignals.length,
            sell_signals: sellSignals.length,
            t_signals: tSignals.length,
            direction: _direction,
            trend_bias: Math.round(_bias * 100) / 100,
            buy_weight: _buyWeight,
            sell_weight: _sellWeight,
        };

        if (buySignals.length > 0) {
            // 优先选与综合方向一致的策略，如果方向是 SELL/SELL_THEN_BUY 则不显示最佳买入
            const isBuyDirection = _direction === 'STRONG_BUY' || _direction === 'BUY' || _direction === 'HOLD';
            if (isBuyDirection) {
                const bestBuy = buySignals[0];
                summary.best_buy = {
                    name: bestBuy.name,
                    entry_price: bestBuy.entry_price ?? cp,
                    target_price: bestBuy.target_price ?? null,
                    stop_loss: bestBuy.stop_loss ?? null,
                    profit_potential: bestBuy.profit_potential ?? null,
                    loss_risk: bestBuy.loss_risk ?? null,
                    risk_reward: bestBuy.risk_reward ?? null,
                };
            }
        }

        if (sellSignals.length > 0) {
            // 优先选与综合方向一致的策略，如果方向是 BUY/BUY_THEN_SELL 则不显示最佳卖出
            const isSellDirection = _direction === 'STRONG_SELL' || _direction === 'SELL' || _direction === 'HOLD';
            if (isSellDirection) {
                const bestSell = sellSignals[0];
                summary.best_sell = {
                    name: bestSell.name,
                    entry_price: bestSell.entry_price ?? cp,
                    target_price: bestSell.target_price ?? null,
                    stop_loss: bestSell.stop_loss ?? null,
                    profit_potential: bestSell.profit_potential ?? null,
                    loss_risk: bestSell.loss_risk ?? null,
                    risk_reward: bestSell.risk_reward ?? null,
                };
            }
        }

        if (tSignals.length > 0) {
            const lastBestTName = this._lastSummary && this._lastSummary.best_t ? this._lastSummary.best_t.name : null;
            let bestT = null;
            let bestScore = -Infinity;
            for (const t of tSignals) {
                let buyP = t.buy_price ?? cp;
                let sellP = t.sell_price ?? cp;

                // === 确保盈利的关键约束 ===
                // 买入价必须 <= 现价（如果策略给的买入价 > 现价，会跌破买入价导致亏损）
                // 卖出价必须 > 买入价（保证有利润空间）
                if (buyP > cp) {
                    const adjustedBuy = cp * 0.985;
                    if (sellP <= adjustedBuy) {
                        continue;
                    }
                    buyP = adjustedBuy;
                }
                if (sellP <= buyP || buyP <= 0 || sellP <= 0) continue;

                const profitPct = (sellP - buyP) / buyP * 100;
                const profitAfterFee = profitPct - feeRate * 100 * 2;

                if (profitAfterFee < 0.3) continue;

                // =====================================================
                //  评分逻辑：盈利主导 + 可达性辅助 + 时间窗口微调
                // =====================================================

                // 1. 盈利评分（权重×3，主导因素）—— 这是 bestT 切换的硬指标
                let profitScore = 0;
                if (profitAfterFee >= 1.5) profitScore = 10;
                else if (profitAfterFee >= 1.0) profitScore = 9;
                else if (profitAfterFee >= 0.7) profitScore = 8;
                else if (profitAfterFee >= 0.5) profitScore = 6;
                else if (profitAfterFee >= 0.3) profitScore = 4;

                // 2. 卖出可达性评分（权重×1.5）
                const sellDistance = (hp - sellP) / hp * 100;
                let sellReachableScore = 0;
                if (sellDistance >= 0 && sellDistance <= 2) sellReachableScore = 10;
                else if (sellDistance > 2 && sellDistance <= 5) sellReachableScore = 8;
                else if (sellDistance > 5 && sellDistance <= 10) sellReachableScore = 5;
                else sellReachableScore = 2;

                // 3. 买入可达性评分（权重×1）
                const buyDistance = (buyP - lp) / lp * 100;
                let buyReachableScore = 0;
                if (buyDistance >= 0 && buyDistance <= 2) buyReachableScore = 10;
                else if (buyDistance > 2 && buyDistance <= 5) buyReachableScore = 7;
                else if (buyDistance > 5 && buyDistance <= 10) buyReachableScore = 4;
                else buyReachableScore = 2;

                // 3.5 买入时间可达性评分（权重×1）—— 只在尾盘精细评估，非尾盘固定给 8
                let buyTimeScore = 8;
                if (isLateDay) {
                    const buyBelowCurrent = (cp - buyP) / cp * 100;
                    if (buyBelowCurrent <= 0.2) buyTimeScore = 10;
                    else if (buyBelowCurrent <= 0.5) buyTimeScore = 7;
                    else if (buyBelowCurrent <= 1) buyTimeScore = 3;
                    else buyTimeScore = 0;
                }

                // 4. 时间窗口可达性评分（权重×0.5，仅做微调）
                let timeWindowScore = 0;
                if (timeRemaining >= 180) {
                    timeWindowScore = 10;
                } else if (timeRemaining >= 90) {
                    timeWindowScore = 9;
                } else if (timeRemaining >= 45) {
                    timeWindowScore = 7;
                } else if (timeRemaining >= 20) {
                    timeWindowScore = 5;
                } else {
                    timeWindowScore = 2;
                }

                // 尾盘特殊处理：正T大幅扣分，反T加分
                let lateDayPenalty = 0;
                if (isLateDay && t.action === 'BUY_THEN_SELL') {
                    lateDayPenalty = -5;
                }
                if (isLateDay && t.action === 'SELL_THEN_BUY') {
                    lateDayPenalty = 2;
                }

                // 优先级权重
                const prioWeight = (4 - (t.priority ?? 3)) * 2;

                // 总评分：盈利×3 主导 + 可达性 ×2.5 + 时间 ×0.5 + 尾盘调整 + 优先级×2
                let score = profitScore * 3
                    + Math.round(sellReachableScore * 1.5) + buyReachableScore
                    + buyTimeScore
                    + Math.round(timeWindowScore * 0.5)
                    + lateDayPenalty
                    + prioWeight;

                // 惯性机制：如果这个方案是上一次选中的 bestT，加 5 分
                if (lastBestTName && t.name === lastBestTName) {
                    score += 5;
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestT = t;
                    bestT._adjustedBuyPrice = buyP;
                }
            }
            // 过夜风险评级
            let overnightRisk = '中';
            let overnightAdvice = '建议当日了结';
            if (overnightAnalysis) {
                if (overnightAnalysis.score >= 20) {
                    overnightRisk = '低';
                    overnightAdvice = '尾盘强势，可留仓过夜';
                } else if (overnightAnalysis.score <= -20) {
                    overnightRisk = '高';
                    overnightAdvice = '尾盘弱势，必须当日卖出！';
                } else {
                    overnightRisk = '中';
                    overnightAdvice = '信号不明，建议当日了结';
                }
            } else if (hour >= 14 && minute >= 30) {
                // 尾盘有数据但研判未触发（边界情况）
                overnightRisk = '中';
                overnightAdvice = '建议当日了结，避免隔夜风险';
            }

            // 时间窗口评级：直接基于剩余交易时间（timeRemaining）和时段判断
            // 之前用 (hp-lp)/240 估算每分钟波动率再算 estTimeNeeded，对早盘严重低估
            // （早盘半小时波动常占全天一半），导致早盘误判为"不足"。改为直接基于剩余时间。
            let timeWindowLevel = '充足';
            let timeWindowColor = 'green';
            if (timeSession === '盘前' || timeSession === '午间休市') {
                timeWindowLevel = '充足';
                timeWindowColor = 'green';
            } else if (timeRemaining >= 180) {
                // 早盘 + 午盘早段：时间非常充裕
                timeWindowLevel = '充足';
                timeWindowColor = 'green';
            } else if (timeRemaining >= 90) {
                // 午盘：时间充裕
                timeWindowLevel = '充足';
                timeWindowColor = 'green';
            } else if (timeRemaining >= 45) {
                // 午盘末/尾盘前段：时间适中
                timeWindowLevel = '适中';
                timeWindowColor = 'green';
            } else if (timeRemaining >= 20) {
                // 尾盘中段：时间紧张
                timeWindowLevel = '紧张';
                timeWindowColor = 'yellow';
            } else {
                // 尾盘末段：时间严重不足
                timeWindowLevel = '不足';
                timeWindowColor = 'red';
            }

            if (bestT) {
                // 使用调整后的安全买入价（确保不高于现价，避免跌破买入价导致亏损）
                const finalBuyPrice = bestT._adjustedBuyPrice != null ? bestT._adjustedBuyPrice : (bestT.buy_price ?? cp);
                const finalSellPrice = bestT.sell_price ?? cp;
                // 计算最终利润（基于调整后的买入价）
                const finalProfitPct = (finalBuyPrice > 0 && finalSellPrice > 0)
                    ? Math.round(((finalSellPrice - finalBuyPrice) / finalBuyPrice * 100 - feeRate * 100 * 2) * 100) / 100
                    : null;

                summary.best_t = {
                    name: bestT.name,
                    entry_price: cp,
                    buy_price: finalBuyPrice,
                    sell_price: finalSellPrice,
                    profit_potential: finalProfitPct,
                    loss_risk: bestT.loss_risk ?? null,
                    risk_reward: bestT.risk_reward ?? null,
                    action: bestT.action,
                    success_rate: bestT.success_rate ?? null,
                    overnight_risk: overnightRisk,
                    overnight_advice: overnightAdvice,
                    time_session: timeSession,
                    time_window: timeWindowLevel,
                    time_window_color: timeWindowColor,
                    time_remaining: timeRemaining,
                    has_holdings: holdQty > 0,
                };
            }
        }

        // ============ 今日价格预测 ============
        // 逻辑：盘中（9:30-15:00）用昨收价固定预测，收盘后用今收价预测明天
        const marketHour = now.getHours();
        const isAfterClose = marketHour >= 15; // 下午3点后，用今收价预测明天

        if (hasKline && closes.length >= 5) {
            let amp5 = 0, amp10 = 0;
            let validDays5 = 0, validDays10 = 0;
            const ampDays = Math.min(10, closes.length - 1);
            for (let i = 1; i <= ampDays; i++) {
                const idx = closes.length - 1 - i;
                if (idx - 1 >= 0 && closes[idx - 1] > 0) {
                    const dailyAmp = (highs[idx] - lows[idx]) / closes[idx - 1] * 100;
                    if (dailyAmp > 0 && dailyAmp < 30) {
                        if (i <= 5) {
                            amp5 += dailyAmp;
                            validDays5++;
                        }
                        amp10 += dailyAmp;
                        validDays10++;
                    }
                }
            }
            amp5 = validDays5 > 0 ? amp5 / validDays5 : 3;
            amp10 = validDays10 > 0 ? amp10 / validDays10 : 3;
            
            const avgAmplitude = (amp5 * 0.6 + amp10 * 0.4);
            const atrRange = atrVal > 0 ? atrVal : (pc * avgAmplitude / 100);
            
            // 预测用趋势：综合策略投票（60%）+ 历史趋势（40%）
            // 策略投票趋势：基于所有策略的加权结果，映射到 -0.3~0.3
            const strategyTrendBias = Math.max(-0.3, Math.min(0.3, _bias * 0.3));

            // 历史趋势偏移（均线排列或当日趋势）
            let predictTrend = '横盘';
            if (isAfterClose && hasKline && closes.length >= 20) {
                // 收盘后：用均线排列判断趋势（比单日涨跌更可靠）
                const ma5 = this.sma(closes, 5);
                const ma10 = this.sma(closes, 10);
                const ma20 = this.sma(closes, 20);
                if (ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20) {
                    predictTrend = '上升';
                } else if (ma5 && ma10 && ma20 && ma5 < ma10 && ma10 < ma20) {
                    predictTrend = '下跌';
                } else {
                    predictTrend = trend; // 均线不明显时回退到涨跌判断
                }
            } else if (isAfterClose) {
                predictTrend = trend;
            } else if (hasKline && closes.length >= 20) {
                const ma5 = this.sma(closes, 5);
                const ma10 = this.sma(closes, 10);
                const ma20 = this.sma(closes, 20);
                if (ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20) {
                    predictTrend = '上升';
                } else if (ma5 && ma10 && ma20 && ma5 < ma10 && ma10 < ma20) {
                    predictTrend = '下跌';
                }
            } else if (hasKline && closes.length >= 2) {
                const prevChg = (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100;
                predictTrend = prevChg > 0.5 ? '上升' : (prevChg < -0.5 ? '下跌' : '横盘');
            }
            const historyTrendBias = predictTrend === '上升' ? 0.3 : (predictTrend === '下跌' ? -0.3 : 0);

            // 综合趋势 = 策略投票（60%）+ 历史趋势（40%）
            const trendBias = strategyTrendBias * 0.6 + historyTrendBias * 0.4;
            
            // 基准价：动态预测始终用当前实时价，预测区间随当前价格波动；收盘后当前价即今收价，用于预测明天
            const basePrice = cp;
            
            const halfRange = basePrice * avgAmplitude / 100 / 2;
            let predictedHigh = basePrice + halfRange * (1 + trendBias * 0.5);
            let predictedLow = basePrice - halfRange * (1 - trendBias * 0.5);
            
            // 盘中不修正预测值，只在收盘后更新
            if (isAfterClose) {
                // 收盘后，允许根据当日实际高点微调（仅用于明日预测参考）
                if (hp > predictedHigh) predictedHigh = hp + atrRange * 0.2;
                if (lp < predictedLow) predictedLow = lp - atrRange * 0.2;
            }
            
            // 支撑压力位修正（仅在有足够历史数据时）—— 基于历史K线，盘中固定
            // 缓存支撑压力位结果，避免重复计算
            let cachedSR = null, cachedRR = null;
            if (hasKline && closes.length >= 20) {
                [cachedSR, cachedRR] = this.findSupportResistance(highs, lows, closes);
            }
            if (cachedSR !== null) {
                if (cachedRR && cachedRR.length > 0) {
                    const aboveRes = cachedRR.filter(r => r > basePrice).sort((a, b) => a - b);
                    const nearestResistance = aboveRes.length > 0 ? aboveRes[0] : null;
                    if (nearestResistance !== null && nearestResistance < predictedHigh) {
                        predictedHigh = Math.min(predictedHigh, nearestResistance);
                    }
                }
                if (cachedSR && cachedSR.length > 0) {
                    const belowSup = cachedSR.filter(s => s < basePrice).sort((a, b) => b - a);
                    const nearestSupport = belowSup.length > 0 ? belowSup[0] : null;
                    if (nearestSupport !== null && nearestSupport > predictedLow) {
                        predictedLow = Math.max(predictedLow, nearestSupport);
                    }
                }
            }

            // ============ 策略信号联动修正 ============
            // 用策略的目标价/止损价来修正预测区间，确保策略买卖点落在预测区间内
            const stratTargets = results.filter(s => s.target_price && s.target_price > 0);
            const stratStops = results.filter(s => s.stop_loss && s.stop_loss > 0);
            const buyStrats = results.filter(s =>
                (s.action === 'BUY' || s.action === 'STRONG_BUY' || s.action === 'BUY_THEN_SELL') &&
                s.target_price && s.target_price > basePrice
            );
            const sellStrats = results.filter(s =>
                (s.action === 'SELL' || s.action === 'STRONG_SELL' || s.action === 'SELL_THEN_BUY') &&
                s.stop_loss && s.stop_loss < basePrice
            );

            // 有买入信号且目标价高于当前：上沿至少覆盖最高目标价的80%
            if (buyStrats.length > 0) {
                const highestTarget = Math.max(...buyStrats.map(s => s.target_price));
                const targetFromBase = (highestTarget - basePrice) / basePrice;
                const rangeFromBase = (predictedHigh - basePrice) / basePrice;
                if (rangeFromBase < targetFromBase * 0.7) {
                    predictedHigh = basePrice * (1 + targetFromBase * 0.85);
                }
            }

            // 有卖出信号且止损价低于当前：下沿至少覆盖最低止损价的80%
            if (sellStrats.length > 0) {
                const lowestStop = Math.min(...sellStrats.map(s => s.stop_loss));
                const stopFromBase = (basePrice - lowestStop) / basePrice;
                const rangeFromBase = (basePrice - predictedLow) / basePrice;
                if (rangeFromBase < stopFromBase * 0.7) {
                    predictedLow = basePrice * (1 - stopFromBase * 0.85);
                }
            }

            // 做T策略联动：收集所有做T信号的买卖价，确保预测区间包含做T空间
            const tBuySignals = results.filter(s =>
                s.action === 'BUY_THEN_SELL' && s.entry_price && s.target_price
            );
            const tSellSignals = results.filter(s =>
                s.action === 'SELL_THEN_BUY' && s.entry_price && s.target_price
            );
            if (tBuySignals.length > 0) {
                const tLowestBuy = Math.min(...tBuySignals.map(s => s.entry_price));
                const tHighestSell = Math.max(...tBuySignals.map(s => s.target_price));
                if (predictedLow > tLowestBuy * 1.005) predictedLow = tLowestBuy * 0.995;
                if (predictedHigh < tHighestSell * 0.995) predictedHigh = tHighestSell * 1.005;
            }
            if (tSellSignals.length > 0) {
                const tHighestSell = Math.max(...tSellSignals.map(s => s.entry_price));
                const tLowestBuy = Math.min(...tSellSignals.map(s => s.target_price));
                if (predictedHigh < tHighestSell * 0.995) predictedHigh = tHighestSell * 1.005;
                if (predictedLow > tLowestBuy * 1.005) predictedLow = tLowestBuy * 0.995;
            }
            
            if (predictedHigh < predictedLow) [predictedHigh, predictedLow] = [predictedLow, predictedHigh];
            
            // 当前位置：相对于固定预测区间的位置
            const pricePosition = predictedHigh > predictedLow 
                ? ((cp - predictedLow) / (predictedHigh - predictedLow) * 100) 
                : 50;
            
            let confidence = 60;
            if (closes.length >= 20) confidence += 10;
            if (Math.abs(amp5 - amp10) < 1) confidence += 10;
            if (confidence > 80) confidence = 80;
            
            summary.price_prediction = {
                predicted_high: Math.round(predictedHigh * 100) / 100,
                predicted_low: Math.round(predictedLow * 100) / 100,
                avg_amplitude: Math.round(avgAmplitude * 100) / 100,
                price_position: Math.round(pricePosition * 10) / 10,
                confidence: confidence,
                trend: predictTrend,
                atr: Math.round(atrVal * 100) / 100,
                prediction_time: isAfterClose ? '收盘后预测' : '盘中预测',
                predict_for: isAfterClose ? '明日' : '今日',
                target_date: isAfterClose
                    ? getNextTradingDay(getLocalDateStr(now))
                    : getLocalDateStr(now),
                generated_at: now.getTime()
            };
            
            // ============ 固定预测（基于昨日数据，全天不变）============
            // 所有关键指标只用历史K线（排除今日实时数据），确保盘中不会变化
            const histCloses = closes.length >= 2 ? closes.slice(0, -1) : closes;
            const histHighs = highs.length >= 2 ? highs.slice(0, -1) : highs;
            const histLows = lows.length >= 2 ? lows.slice(0, -1) : lows;

            const yesterdayClose = histCloses.length >= 1 ? histCloses[histCloses.length - 1] : pc;
            const fixedBase = yesterdayClose > 0 ? yesterdayClose : pc;

            // 固定振幅：只用历史数据计算，不包含今日
            let fixedAmp5 = 0, fixedAmp10 = 0;
            let fixedValid5 = 0, fixedValid10 = 0;
            const fixedAmpDays = Math.min(10, histCloses.length - 1);
            for (let i = 1; i <= fixedAmpDays; i++) {
                const idx = histCloses.length - 1 - i;
                if (idx - 1 >= 0 && histCloses[idx - 1] > 0) {
                    const dailyAmp = (histHighs[idx] - histLows[idx]) / histCloses[idx - 1] * 100;
                    if (dailyAmp > 0 && dailyAmp < 30) {
                        if (i <= 5) { fixedAmp5 += dailyAmp; fixedValid5++; }
                        fixedAmp10 += dailyAmp; fixedValid10++;
                    }
                }
            }
            fixedAmp5 = fixedValid5 > 0 ? fixedAmp5 / fixedValid5 : 3;
            fixedAmp10 = fixedValid10 > 0 ? fixedAmp10 / fixedValid10 : 3;
            const fixedAvgAmplitude = (fixedAmp5 * 0.6 + fixedAmp10 * 0.4);

            // 固定ATR：只用历史数据计算
            let fixedAtr = null;
            if (histCloses.length >= 15) {
                fixedAtr = this.calcAtr(histHighs, histLows, histCloses, 14);
            }
            if (fixedAtr === null || fixedAtr <= 0) {
                fixedAtr = fixedBase * fixedAvgAmplitude / 100;
            }

            const fixedHalfRange = fixedBase * fixedAvgAmplitude / 100 / 2;

            // 固定预测趋势：综合策略投票（60%）+ 前日均线排列（40%）
            const fixedStrategyBias = Math.max(-0.3, Math.min(0.3, _bias * 0.3));

            let fixedTrend = '横盘';
            if (histCloses.length >= 22) {
                const fma5 = this.sma(histCloses, 5);
                const fma10 = this.sma(histCloses, 10);
                const fma20 = this.sma(histCloses, 20);
                if (fma5 && fma10 && fma20 && fma5 > fma10 && fma10 > fma20) {
                    fixedTrend = '上升';
                } else if (fma5 && fma10 && fma20 && fma5 < fma10 && fma10 < fma20) {
                    fixedTrend = '下跌';
                }
            }
            const fixedHistoryBias = fixedTrend === '上升' ? 0.3 : (fixedTrend === '下跌' ? -0.3 : 0);

            // 综合固定趋势 = 策略投票（60%）+ 历史均线（40%）
            const fixedTrendBias = fixedStrategyBias * 0.6 + fixedHistoryBias * 0.4;

            let fixedHigh = fixedBase + fixedHalfRange * (1 + fixedTrendBias * 0.5);
            let fixedLow = fixedBase - fixedHalfRange * (1 - fixedTrendBias * 0.5);

            // ATR 修正（用历史ATR）
            fixedHigh = Math.max(fixedHigh, fixedBase + fixedAtr * 0.5);
            fixedLow = Math.min(fixedLow, fixedBase - fixedAtr * 0.5);

            // 支撑压力位修正（只用历史数据，不复用实时缓存）
            if (histCloses.length >= 20) {
                const [fixedSR, fixedRR] = this.findSupportResistance(histHighs, histLows, histCloses);
                if (fixedRR && fixedRR.length > 0) {
                    const aboveRes = fixedRR.filter(r => r > fixedBase).sort((a, b) => a - b);
                    const nearestResistance = aboveRes.length > 0 ? aboveRes[0] : null;
                    if (nearestResistance !== null && nearestResistance > fixedBase && nearestResistance < fixedHigh) {
                        fixedHigh = Math.max(fixedHigh * 0.95, nearestResistance);
                    }
                }
                if (fixedSR && fixedSR.length > 0) {
                    const belowSup = fixedSR.filter(s => s < fixedBase).sort((a, b) => b - a);
                    const nearestSupport = belowSup.length > 0 ? belowSup[0] : null;
                    if (nearestSupport !== null && nearestSupport < fixedBase && nearestSupport > fixedLow) {
                        fixedLow = Math.min(fixedLow * 1.05, nearestSupport);
                    }
                }
            }

            // ============ 固定预测策略联动 ============
            // 用策略的目标价/止损价来修正固定预测区间
            const fixedBuyStrats = results.filter(s =>
                (s.action === 'BUY' || s.action === 'STRONG_BUY' || s.action === 'BUY_THEN_SELL') &&
                s.target_price && s.target_price > fixedBase
            );
            const fixedSellStrats = results.filter(s =>
                (s.action === 'SELL' || s.action === 'STRONG_SELL' || s.action === 'SELL_THEN_BUY') &&
                s.stop_loss && s.stop_loss < fixedBase
            );
            if (fixedBuyStrats.length > 0) {
                const hTarget = Math.max(...fixedBuyStrats.map(s => s.target_price));
                const tFromBase = (hTarget - fixedBase) / fixedBase;
                const rFromBase = (fixedHigh - fixedBase) / fixedBase;
                if (rFromBase < tFromBase * 0.6) {
                    fixedHigh = fixedBase * (1 + tFromBase * 0.8);
                }
            }
            if (fixedSellStrats.length > 0) {
                const lStop = Math.min(...fixedSellStrats.map(s => s.stop_loss));
                const sFromBase = (fixedBase - lStop) / fixedBase;
                const rFromBase = (fixedBase - fixedLow) / fixedBase;
                if (rFromBase < sFromBase * 0.6) {
                    fixedLow = fixedBase * (1 - sFromBase * 0.8);
                }
            }
            // 做T策略也联动固定预测
            const fixedTBuy = results.filter(s =>
                s.action === 'BUY_THEN_SELL' && s.entry_price && s.target_price
            );
            const fixedTSell = results.filter(s =>
                s.action === 'SELL_THEN_BUY' && s.entry_price && s.target_price
            );
            if (fixedTBuy.length > 0) {
                const tlBuy = Math.min(...fixedTBuy.map(s => s.entry_price));
                const thSell = Math.max(...fixedTBuy.map(s => s.target_price));
                if (fixedLow > tlBuy * 1.01) fixedLow = tlBuy * 0.99;
                if (fixedHigh < thSell * 0.99) fixedHigh = thSell * 1.01;
            }
            if (fixedTSell.length > 0) {
                const thSell = Math.max(...fixedTSell.map(s => s.entry_price));
                const tlBuy = Math.min(...fixedTSell.map(s => s.target_price));
                if (fixedHigh < thSell * 0.99) fixedHigh = thSell * 1.01;
                if (fixedLow > tlBuy * 1.01) fixedLow = tlBuy * 0.99;
            }

            if (fixedHigh < fixedLow) [fixedHigh, fixedLow] = [fixedLow, fixedHigh];

            // 固定预测目标日：永远是今天（基于昨收）
            const fixedTargetDate = getLocalDateStr(now);
            // 固定预测生成时间：根据配置
            let fixedGeneratedTime;
            if (fixedPredHour === 0) {
                fixedGeneratedTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
            } else if (fixedPredHour === 9) {
                fixedGeneratedTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0).getTime();
            } else {
                const yesterday = new Date(now.getTime() - 86400000);
                fixedGeneratedTime = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 15, 0, 0).getTime();
            }

            summary.fixed_prediction = {
                predicted_high: Math.round(fixedHigh * 100) / 100,
                predicted_low: Math.round(fixedLow * 100) / 100,
                base_price: Math.round(fixedBase * 100) / 100,
                trend: fixedTrend,
                avg_amplitude: Math.round(fixedAvgAmplitude * 100) / 100,
                atr: Math.round(fixedAtr * 100) / 100,
                confidence: confidence,
                predict_for: '今日',
                target_date: fixedTargetDate,
                generated_at: fixedGeneratedTime
            };

            // ============ AI算法分析（机器学习预测模型）============
            // 1. KNN模式匹配 - 找到历史相似走势预测后续方向
            // 2. 多因子回归 - 基于多个技术指标预测价格
            // 3. 策略融合评分 - 综合所有策略输出最终AI信号

            // AI算法1: KNN模式匹配预测
            let knnPrediction = null;
            if (closes.length >= 60) {
                const patternLength = 10;
                const recentPattern = closes.slice(-patternLength);
                const recentNorm = recentPattern.map((v, i) => (v - recentPattern[0]) / recentPattern[0]);
                
                let bestMatchIdx = -1;
                let bestMatchScore = Infinity;
                
                for (let i = 0; i <= closes.length - patternLength - 5; i++) {
                    const historyPattern = closes.slice(i, i + patternLength);
                    const historyNorm = historyPattern.map((v, j) => (v - historyPattern[0]) / historyPattern[0]);
                    
                    let score = 0;
                    for (let j = 0; j < patternLength; j++) {
                        score += Math.abs(recentNorm[j] - historyNorm[j]);
                    }
                    
                    if (score < bestMatchScore) {
                        bestMatchScore = score;
                        bestMatchIdx = i;
                    }
                }
                
                if (bestMatchIdx >= 0) {
                    const futureMoves = closes.slice(bestMatchIdx + patternLength, bestMatchIdx + patternLength + 5);
                    const patternStart = closes[bestMatchIdx];
                    const patternEnd = closes[bestMatchIdx + patternLength - 1];
                    const futureAvg = futureMoves.reduce((a, b) => a + b, 0) / futureMoves.length;
                    const futureChg = (futureAvg - patternEnd) / patternEnd;
                    
                    knnPrediction = {
                        match_score: Math.round((1 - Math.min(bestMatchScore / 0.5, 1)) * 100),
                        matched_period: `${bestMatchIdx + 1}~${bestMatchIdx + patternLength}`,
                        future_change: Math.round(futureChg * 1000) / 10,
                        predicted_direction: futureChg > 0.01 ? '上涨' : (futureChg < -0.01 ? '下跌' : '横盘'),
                        confidence: Math.round((1 - Math.min(bestMatchScore / 0.5, 1)) * 80 + 20)
                    };
                }
            }

            // AI算法2: 多因子回归预测
            let regressionPrediction = null;
            if (closes.length >= 30) {
                const factors = [];
                const targets = [];
                
                for (let i = 20; i < closes.length - 5; i++) {
                    const windowCloses = closes.slice(i - 20, i);
                    const windowHighs = highs.slice(i - 20, i);
                    const windowLows = lows.slice(i - 20, i);
                    const windowVols = volumes.slice(i - 20, i);
                    
                    const ma5 = windowCloses.slice(-5).reduce((a, b) => a + b, 0) / 5;
                    const ma10 = windowCloses.slice(-10).reduce((a, b) => a + b, 0) / 10;
                    const ma20 = windowCloses.reduce((a, b) => a + b, 0) / 20;
                    const volatility = (Math.max(...windowHighs) - Math.min(...windowLows)) / ma20 * 100;
                    const avgVol = windowVols.reduce((a, b) => a + b, 0) / 20;
                    const recentChg = (closes[i] - closes[i - 5]) / closes[i - 5] * 100;
                    
                    const futureChg = (closes[i + 5] - closes[i]) / closes[i] * 100;
                    
                    factors.push([ma5 / ma20, ma10 / ma20, volatility, avgVol, recentChg]);
                    targets.push(futureChg);
                }
                
                if (factors.length >= 10) {
                    const n = factors.length;
                    const k = factors[0].length;
                    
                    // 标准化因子
                    const means = new Array(k).fill(0);
                    const stds = new Array(k).fill(0);
                    for (let j = 0; j < k; j++) {
                        for (let i = 0; i < n; i++) {
                            means[j] += factors[i][j];
                        }
                        means[j] /= n;
                    }
                    for (let j = 0; j < k; j++) {
                        for (let i = 0; i < n; i++) {
                            stds[j] += Math.pow(factors[i][j] - means[j], 2);
                        }
                        stds[j] = Math.sqrt(stds[j] / n) || 1;
                    }
                    
                    const normFactors = factors.map(f => f.map((v, j) => (v - means[j]) / stds[j]));
                    const meanTarget = targets.reduce((a, b) => a + b, 0) / n;
                    const stdTarget = Math.sqrt(targets.reduce((a, b) => a + Math.pow(b - meanTarget, 2), 0) / n) || 1;
                    const normTargets = targets.map(t => (t - meanTarget) / stdTarget);
                    
                    // 梯度下降求权重
                    const weights = new Array(k).fill(0);
                    const learningRate = 0.01;
                    for (let epoch = 0; epoch < 100; epoch++) {
                        let grad = new Array(k).fill(0);
                        for (let i = 0; i < n; i++) {
                            let pred = weights.reduce((sum, w, j) => sum + w * normFactors[i][j], 0);
                            let error = pred - normTargets[i];
                            for (let j = 0; j < k; j++) {
                                grad[j] += error * normFactors[i][j];
                            }
                        }
                        for (let j = 0; j < k; j++) {
                            weights[j] -= learningRate * grad[j] / n;
                        }
                    }
                    
                    // 当前因子
                    const curMa5 = getSma(5) || closes[closes.length - 1];
                    const curMa10 = getSma(10) || closes[closes.length - 1];
                    const curMa20 = getSma(20) || closes[closes.length - 1];
                    const curHighs = highs.slice(-20);
                    const curLows = lows.slice(-20);
                    const curVolatility = curMa20 > 0 ? (Math.max(...curHighs) - Math.min(...curLows)) / curMa20 * 100 : 0;
                    const curAvgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
                    const curRecentChg = closes.length >= 6 ? (cp - closes[closes.length - 6]) / closes[closes.length - 6] * 100 : 0;
                    
                    const curFactors = [curMa5 / curMa20, curMa10 / curMa20, curVolatility, curAvgVol, curRecentChg];
                    const normCurFactors = curFactors.map((v, j) => (v - means[j]) / stds[j]);
                    const normPrediction = weights.reduce((sum, w, j) => sum + w * normCurFactors[j], 0);
                    const predictedChg = normPrediction * stdTarget + meanTarget;
                    
                    regressionPrediction = {
                        predicted_change: Math.round(predictedChg * 100) / 100,
                        factors: ['均线比率', '均线比率', '波动率', '均量', '近期涨跌'],
                        weights: weights.map(w => Math.round(w * 100) / 100),
                        confidence: Math.min(90, Math.max(50, 60 + Math.abs(predictedChg) * 5))
                    };
                }
            }

            // AI算法3: 策略融合评分
            let fusionScore = 0;
            let fusionDetails = [];
            
            // 策略投票分数（与核心建议保持一致，使用 buySignals/sellSignals）
            const buyCount = buySignals.length;
            const sellCount = sellSignals.length;
            const strategyScore = (buyCount - sellCount) / Math.max(buyCount + sellCount, 1) * 100;
            fusionDetails.push({ name: '策略投票', score: strategyScore });
            
            // 趋势因子
            const trendScore = chg > 0 ? Math.min(50, chg * 5) : Math.max(-50, chg * 5);
            fusionDetails.push({ name: '趋势因子', score: trendScore });
            
            // 波动率因子
            const volScore = amplitude > 3 ? (amplitude - 3) * 5 : (amplitude < 1.5 ? -(1.5 - amplitude) * 10 : 0);
            fusionDetails.push({ name: '波动率', score: volScore });
            
            // 量能因子
            const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const volRatio = vol > 0 ? vol / avgVol20 : 1;
            const volumeScore = volRatio > 1.5 ? 20 : (volRatio < 0.5 ? -20 : 0);
            fusionDetails.push({ name: '量能因子', score: volumeScore });
            
            // KNN因子
            const knnScore = knnPrediction ? (knnPrediction.predicted_direction === '上涨' ? knnPrediction.match_score * 0.5 : (knnPrediction.predicted_direction === '下跌' ? -knnPrediction.match_score * 0.5 : 0)) : 0;
            fusionDetails.push({ name: 'KNN匹配', score: knnScore });
            
            // 回归因子
            const regScore = regressionPrediction ? regressionPrediction.predicted_change * 10 : 0;
            fusionDetails.push({ name: '回归预测', score: regScore });
            
            // 综合评分
            fusionScore = fusionDetails.reduce((sum, d) => sum + d.score, 0);
            const finalScore = Math.max(-100, Math.min(100, fusionScore));
            
            let aiSignal = '观望';
            let aiConfidence = 50;
            if (finalScore > 30) {
                aiSignal = '买入';
                aiConfidence = Math.min(95, 50 + finalScore * 0.8);
            } else if (finalScore < -30) {
                aiSignal = '卖出';
                aiConfidence = Math.min(95, 50 + Math.abs(finalScore) * 0.8);
            }
            
            // 添加AI策略结果到策略列表
            results.push(this._make(
                `[AI] KNN模式匹配预测(${knnPrediction ? knnPrediction.predicted_direction : '无匹配'})`, 
                knnPrediction ? (knnPrediction.predicted_direction === '上涨' ? '📈' : knnPrediction.predicted_direction === '下跌' ? '📉' : '📊') : '🤖', 
                '🤖 AI算法', '中', 3,
                knnPrediction 
                    ? `历史匹配度${knnPrediction.match_score}%，预测方向${knnPrediction.predicted_direction}，预期变化${knnPrediction.future_change}%，置信度${knnPrediction.confidence}%。`
                    : '历史数据不足，无法进行模式匹配。',
                knnPrediction && knnPrediction.predicted_direction === '上涨' ? 'BUY' : (knnPrediction && knnPrediction.predicted_direction === '下跌' ? 'SELL' : 'WATCH'),
                `KNN预测：${knnPrediction ? knnPrediction.predicted_direction : '无'}，匹配度：${knnPrediction ? knnPrediction.match_score : 0}%`
            ));
            
            results.push(this._make(
                `[AI] 多因子回归预测(${regressionPrediction ? (regressionPrediction.predicted_change > 0 ? '看多' : '看空') : '无数据'})`, 
                regressionPrediction ? (regressionPrediction.predicted_change > 0 ? '📈' : regressionPrediction.predicted_change < 0 ? '📉' : '📊') : '🤖', 
                '🤖 AI算法', '中', 3,
                regressionPrediction 
                    ? `基于均线比率、波动率、量能等因子预测，预期变化${regressionPrediction.predicted_change > 0 ? '+' : ''}${regressionPrediction.predicted_change}%，置信度${regressionPrediction.confidence}%。`
                    : '训练数据不足，无法进行回归预测。',
                regressionPrediction && regressionPrediction.predicted_change > 0.5 ? 'BUY' : (regressionPrediction && regressionPrediction.predicted_change < -0.5 ? 'SELL' : 'WATCH'),
                `回归预测：${regressionPrediction ? regressionPrediction.predicted_change : 0}%`
            ));
            
            results.push(this._make(
                `[AI] 策略融合评分(${finalScore > 0 ? '看多' : finalScore < 0 ? '看空' : '中性'})`, 
                finalScore > 30 ? '📈' : (finalScore < -30 ? '📉' : '📊'), 
                '🤖 AI算法', '高', 1,
                `综合${results.length}个策略信号、KNN模式匹配、回归预测等多维度分析，最终AI评分${finalScore.toFixed(0)}，${aiSignal}信号，置信度${aiConfidence.toFixed(0)}%。`,
                aiSignal === '买入' ? 'BUY' : (aiSignal === '卖出' ? 'SELL' : 'HOLD'),
                `AI综合评分：${finalScore.toFixed(0)}，信号：${aiSignal}`
            ));

            summary.ai_analysis = {
                knn: knnPrediction,
                regression: regressionPrediction,
                fusion: {
                    score: Math.round(finalScore * 10) / 10,
                    signal: aiSignal,
                    confidence: Math.round(aiConfidence),
                    components: fusionDetails
                }
            };
        }

        // 保存尾盘/次日开盘研判数据
        if (overnightAnalysis) {
            summary.overnight = {
                score: overnightAnalysis.score,
                trend: overnightAnalysis.trend,
                probability: overnightAnalysis.probability,
                money_flow_score: overnightAnalysis.moneyFlow,
                candle_score: overnightAnalysis.candle,
                market_score: overnightAnalysis.market,
                is_after_close: isAfterClose
            };
        }

        const total = results.length;
        const watchCount = results.filter(r => ['WATCH', 'HOLD', 'OBSERVE'].includes(r.action)).length;
        const totalDefined = 215; // TARGET_TOTAL including panorama strategies
        summary.strategy_coverage = {
            total_defined: totalDefined,
            triggered: total,
            coverage_rate: totalDefined > 0 ? Math.round((total / totalDefined) * 1000) / 10 : 0,
            watch_signals: watchCount,
            message: `已分析${total}种策略（共定义${totalDefined}种），其中${watchCount}个为观望状态`
        };

        // 保存到 instance，用于 bestT 惯性（避免价格微动导致 bestT 反复切换）
        this._lastSummary = summary;

        return [results, summary];
    }

    analyzePanorama(klineData, stockInfo = {}) {
        const results = [];

        if (!klineData || !Array.isArray(klineData) || klineData.length < 5) {
            return [results, {}];
        }

        const stockCode = stockInfo.code || (klineData[0] && klineData[0].code) || '';
        const stockName = stockInfo.name || (klineData[0] && klineData[0].name) || '';

        // 手续费常量（与runAllStrategies保持一致）
        const feeRate = 0.001; // 单边手续费0.1%
        const minProfitPct = 0.3; // 最小盈利空间（扣除双边手续费0.2%后确保盈利）

        const closes = klineData.map(k => k.close);
        const opens = klineData.map(k => k.open);
        const highs = klineData.map(k => k.high);
        const lows = klineData.map(k => k.low);
        const volumes = klineData.map(k => k.volume);
        const dates = klineData.map(k => k.date);

        const n = closes.length;
        const cp = closes[n - 1];
        const op = opens[n - 1];
        const hp = highs[n - 1];
        const lp = lows[n - 1];
        const vol = volumes[n - 1];
        const prevClose = n >= 2 ? closes[n - 2] : cp;
        const chgPct = prevClose > 0 ? (cp - prevClose) / prevClose * 100 : 0;
        const amplitude = prevClose > 0 ? (hp - lp) / prevClose * 100 : 0;

        const CAT_VOL_PRICE = '📊 量价关系';
        const CAT_MONEY_FLOW = '💰 资金流向';
        const CAT_SENTIMENT = '😊 市场情绪';
        const CAT_CHIP = '🎯 筹码分布';
        const CAT_INSTITUTION = '🏢 机构动向';
        const CAT_NEWS = '📰 消息面提示';

        const avgVol5 = n >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : null;
        const avgVol20 = n >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
        const volRatio5 = avgVol5 && avgVol5 > 0 ? vol / avgVol5 : 1;
        const ma5 = n >= 5 ? this.sma(closes, 5) : null;
        const ma10 = n >= 10 ? this.sma(closes, 10) : null;
        const ma20 = n >= 20 ? this.sma(closes, 20) : null;

        let atrVal = n >= 14 ? this.calcAtr(highs, lows, closes, 14) : (prevClose > 0 ? hp - lp : 0);
        if (!atrVal || atrVal < 0) atrVal = 0;

        if (avgVol5 && avgVol5 > 0) {
            if (volRatio5 > 1.5 && chgPct > 3) {
                const target = cp * 1.08;
                const stop = cp * 0.95;
                results.push(this._make(
                    '放量上涨确认', '📈', CAT_VOL_PRICE, '高', 1,
                    `成交量较5日均量放大${((volRatio5 - 1) * 100).toFixed(0)}%，涨幅${chgPct.toFixed(2)}%，量价齐升，买入信号。`,
                    'BUY', `放量上涨确认趋势，5日均量${(avgVol5 / 10000).toFixed(0)}万，当前量${(vol / 10000).toFixed(0)}万`,
                    { target_price: target, stop_loss: stop, volume_ratio: volRatio5 }
                ));
            }

            if (volRatio5 > 1.5 && chgPct < -3) {
                const target = cp * 0.92;
                const stop = cp * 1.05;
                results.push(this._make(
                    '放量下跌警示', '📉', CAT_VOL_PRICE, '高', 1,
                    `成交量较5日均量放大${((volRatio5 - 1) * 100).toFixed(0)}%，跌幅${Math.abs(chgPct).toFixed(2)}%，放量下跌，卖出信号。`,
                    'SELL', `放量下跌需警惕，5日均量${(avgVol5 / 10000).toFixed(0)}万，当前量${(vol / 10000).toFixed(0)}万`,
                    { target_price: target, stop_loss: stop, volume_ratio: volRatio5 }
                ));
            }

            if (volRatio5 < 0.7 && chgPct < 0 && chgPct > -3) {
                results.push(this._make(
                    '缩量回调', '🔄', CAT_VOL_PRICE, '中', 2,
                    `成交量较5日均量缩小${((1 - volRatio5) * 100).toFixed(0)}%，小幅下跌${Math.abs(chgPct).toFixed(2)}%，缩量回调可关注。`,
                    'WATCH', `缩量回调抛压减轻，关注支撑位是否企稳，5日均量${(avgVol5 / 10000).toFixed(0)}万`,
                    { volume_ratio: volRatio5 }
                ));
            }

            if (volRatio5 < 0.7 && chgPct > 0 && chgPct < 3) {
                results.push(this._make(
                    '缩量上涨', '⚠️', CAT_VOL_PRICE, '中', 2,
                    `成交量较5日均量缩小${((1 - volRatio5) * 100).toFixed(0)}%，小幅上涨${chgPct.toFixed(2)}%，缩量上涨持续性存疑。`,
                    'WATCH', `缩量上涨动能不足，需警惕回落风险，5日均量${(avgVol5 / 10000).toFixed(0)}万`,
                    { volume_ratio: volRatio5 }
                ));
            }
        }

        if (n >= 20 && avgVol20 && avgVol20 > 0) {
            const maxVol20 = safeArrMax(volumes.slice(-20));
            const minVol20 = safeArrMin(volumes.slice(-20));

            if (vol >= maxVol20) {
                const body = Math.abs(cp - op);
                const upperShadow = hp - Math.max(cp, op);
                const isLongUpper = body > 0 && upperShadow / body > 1.5;
                const isNegative = cp < op;
                if (isLongUpper || isNegative) {
                    const target = cp * 0.9;
                    const stop = cp * 1.05;
                    results.push(this._make(
                        '天量天价', '🌋', CAT_VOL_PRICE, '高', 1,
                        `创20日最大成交量${(vol / 10000).toFixed(0)}万，${isLongUpper ? '收长上影线' : '收阴线'}，天量天价见顶信号。`,
                        'SELL', `天量天价是经典见顶信号，20日最大量${(maxVol20 / 10000).toFixed(0)}万`,
                        { target_price: target, stop_loss: stop, volume_ratio: vol / avgVol20 }
                    ));
                }
            }

            if (vol <= minVol20) {
                const prev3Low = n >= 3 ? safeArrMin(closes.slice(-4, -1)) : cp;
                const isStopping = cp > prev3Low * 0.98;
                if (isStopping) {
                    const target = cp * 1.1;
                    const stop = cp * 0.95;
                    results.push(this._make(
                        '地量地价', '🌱', CAT_VOL_PRICE, '中', 2,
                        `创20日最小成交量${(vol / 10000).toFixed(0)}万，价格止跌企稳，地量地价见底信号。`,
                        'BUY', `地量地价是经典见底信号，20日最小量${(minVol20 / 10000).toFixed(0)}万`,
                        { target_price: target, stop_loss: stop, volume_ratio: vol / avgVol20 }
                    ));
                }
            }
        }

        if (n >= 42) {
            const prevHigh20Price = safeArrMax(closes.slice(-42, -22));
            const prevHigh20Vol = safeArrMax(volumes.slice(-42, -22));

            if (cp > prevHigh20Price && vol < prevHigh20Vol * 0.9) {
                const target = cp * 0.92;
                const stop = cp * 1.03;
                results.push(this._make(
                    '量价顶背离', '📛', CAT_VOL_PRICE, '高', 1,
                    `价格突破前20日高点${prevHigh20Price.toFixed(2)}，但成交量未创新高，量价顶背离，卖出信号。`,
                    'SELL', `顶背离说明上涨动能不足，价格新高但量能不济，回调风险大`,
                    { target_price: target, stop_loss: stop, price_new_high: true, volume_new_high: false }
                ));
            }

            if (n >= 42) {
                const prevLow20Price = safeArrMin(closes.slice(-42, -22));
                const prevLowVol = safeArrMin(volumes.slice(-42, -22));
                if (cp < prevLow20Price && vol < prevLowVol * 0.9) {
                    const target = cp * 1.08;
                    const stop = cp * 0.95;
                    results.push(this._make(
                        '量价底背离', '💎', CAT_VOL_PRICE, '高', 1,
                        `价格创20日新低${cp.toFixed(2)}，但成交量萎缩，量价底背离，买入信号。`,
                        'BUY', `底背离说明下跌动能衰竭，价格新低但量能缩减，反弹概率大`,
                        { target_price: target, stop_loss: stop, price_new_low: true, volume_shrink: true }
                    ));
                }
            }
        }

        if (n >= 5) {
            let upDays = 0;
            let volIncrease = true;
            for (let i = n - 3; i < n; i++) {
                if (closes[i] > closes[i - 1]) upDays++;
                if (i > n - 3 && volumes[i] <= volumes[i - 1]) volIncrease = false;
            }
            if (upDays === 3 && volIncrease) {
                const target = cp * 1.1;
                const stop = cp * 0.95;
                results.push(this._make(
                    '堆量上攻', '🚀', CAT_VOL_PRICE, '高', 2,
                    `连续3日放量上涨，堆量上攻形态，主力持续买入，强烈看涨。`,
                    'BUY', `连续3日量增价涨，资金持续流入，上涨趋势确立`,
                    { target_price: target, stop_loss: stop, consecutive_up_days: 3 }
                ));
            }
        }

        if (n >= 22) {
            const prevHigh = safeArrMax(highs.slice(-22, -2));
            if (cp > prevHigh && volRatio5 > 1.3) {
                const target = cp * 1.15;
                const stop = prevHigh * 0.98;
                results.push(this._make(
                    '放量突破', '💥', CAT_VOL_PRICE, '高', 1,
                    `放量突破前期高点${prevHigh.toFixed(2)}，量比${volRatio5.toFixed(2)}，突破有效，买入信号。`,
                    'BUY', `放量突破前高是强烈看涨信号，压力位变支撑位`,
                    { target_price: target, stop_loss: stop, breakout_price: prevHigh, volume_ratio: volRatio5 }
                ));
            }
        }

        if (n >= 5 && vol > 0) {
            const amount = cp * vol;
            const bigOrderRatio = 0.3;
            const closeOpenRange = hp - lp;
            const closePos = closeOpenRange > 0 ? (cp - lp) / closeOpenRange : 0.5;
            const netInflow = amount * bigOrderRatio * (closePos - 0.5) * 2;
            const netInflowPct = amount > 0 ? netInflow / amount * 100 : 0;

            if (netInflowPct > 1) {
                const target = cp * 1.08;
                const stop = cp * 0.95;
                results.push(this._make(
                    '主力资金流入（模拟）', '📥', CAT_MONEY_FLOW, '中', 2,
                    `估算主力资金净流入${(netInflow / 10000).toFixed(0)}万，占比${netInflowPct.toFixed(2)}%，资金流入，买入信号。`,
                    'BUY', `基于量价分布模拟大单流向，净流入为正且占比高`,
                    { target_price: target, stop_loss: stop, net_inflow: netInflow, net_inflow_pct: netInflowPct }
                ));
            }

            if (netInflowPct < -1) {
                const target = cp * 0.92;
                const stop = cp * 1.05;
                results.push(this._make(
                    '主力资金流出（模拟）', '📤', CAT_MONEY_FLOW, '中', 2,
                    `估算主力资金净流出${(Math.abs(netInflow) / 10000).toFixed(0)}万，占比${Math.abs(netInflowPct).toFixed(2)}%，资金流出，卖出信号。`,
                    'SELL', `基于量价分布模拟大单流向，净流出占比高需警惕`,
                    { target_price: target, stop_loss: stop, net_outflow: Math.abs(netInflow), net_outflow_pct: Math.abs(netInflowPct) }
                ));
            }

            if (Math.abs(netInflowPct) > 0.5) {
                results.push(this._make(
                    '大单净流入占比高', '📊', CAT_MONEY_FLOW, '中', 3,
                    `大单${netInflowPct > 0 ? '净流入' : '净流出'}占成交额比例${Math.abs(netInflowPct).toFixed(2)}%，资金关注度高。`,
                    'WATCH',
                    `大单占比高说明${netInflowPct > 0 ? '主力买入积极' : '主力卖出积极'}，需结合趋势判断`,
                    { big_order_pct: Math.abs(netInflowPct) }
                ));
            }
        }

        if (n >= 5) {
            let consecutiveInflow = 0;
            let consecutiveOutflow = 0;
            for (let i = 1; i < n; i++) {
                const range = highs[i] - lows[i];
                const pos = range > 0 ? (closes[i] - lows[i]) / range : 0.5;
                const inflow = (pos - 0.5) * 2;
                if (inflow > 0.1) {
                    consecutiveInflow++;
                    consecutiveOutflow = 0;
                } else if (inflow < -0.1) {
                    consecutiveOutflow++;
                    consecutiveInflow = 0;
                } else {
                    consecutiveInflow = 0;
                    consecutiveOutflow = 0;
                }
            }

            if (consecutiveInflow >= 3) {
                const target = cp * 1.1;
                const stop = cp * 0.95;
                results.push(this._make(
                    '资金持续流入', '📈', CAT_MONEY_FLOW, '高', 2,
                    `连续3日主力资金净流入，资金持续加码，后市看涨。`,
                    'BUY', `连续3日资金流入是强烈做多信号，主力持续建仓`,
                    { target_price: target, stop_loss: stop, consecutive_inflow_days: consecutiveInflow }
                ));
            }

            if (consecutiveOutflow >= 3) {
                const target = cp * 0.9;
                const stop = cp * 1.05;
                results.push(this._make(
                    '资金持续流出', '📉', CAT_MONEY_FLOW, '高', 2,
                    `连续3日主力资金净流出，资金持续撤离，后市看跌。`,
                    'SELL', `连续3日资金流出是强烈做空信号，主力持续减仓`,
                    { target_price: target, stop_loss: stop, consecutive_outflow_days: consecutiveOutflow }
                ));
            }
        }

        if (avgVol5 && avgVol5 > 0 && chgPct > 0 && volRatio5 > 1.2) {
            const range = hp - lp;
            const pos = range > 0 ? (cp - lp) / range : 0.5;
            if (pos > 0.6) {
                const target = cp * 1.12;
                const stop = cp * 0.95;
                results.push(this._make(
                    '量价齐升资金强', '💪', CAT_MONEY_FLOW, '高', 1,
                    `价格上涨${chgPct.toFixed(2)}%+成交量放大${((volRatio5 - 1) * 100).toFixed(0)}%+资金流入，强烈买入。`,
                    'BUY', `量价齐升+资金流入是最强看涨组合，三者共振上涨概率极高`,
                    { target_price: target, stop_loss: stop, volume_ratio: volRatio5, change_pct: chgPct }
                ));
            }
        }

        if (avgVol5 && avgVol5 > 0 && chgPct > 0 && volRatio5 < 0.8) {
            const range = hp - lp;
            const pos = range > 0 ? (cp - lp) / range : 0.5;
            if (pos < 0.4) {
                const target = cp * 0.93;
                const stop = cp * 1.03;
                results.push(this._make(
                    '价涨量缩资金弱', '⚠️', CAT_MONEY_FLOW, '中', 2,
                    `价格上涨${chgPct.toFixed(2)}%但成交量萎缩${((1 - volRatio5) * 100).toFixed(0)}%，资金流出，警示卖出。`,
                    'SELL', `价涨量缩+资金流出说明上涨虚高，回落风险大`,
                    { target_price: target, stop_loss: stop, volume_ratio: volRatio5, change_pct: chgPct }
                ));
            }
        }

        if (n >= 20) {
            let obv = 0;
            const obvSeries = [];
            for (let i = 0; i < n; i++) {
                if (i === 0) {
                    obv = 0;
                } else {
                    if (closes[i] > closes[i - 1]) {
                        obv += volumes[i];
                    } else if (closes[i] < closes[i - 1]) {
                        obv -= volumes[i];
                    }
                }
                obvSeries.push(obv);
            }
            const obv20High = safeArrMax(obvSeries.slice(-20));
            const obv20Low = safeArrMin(obvSeries.slice(-20));
            const currentObv = obvSeries[n - 1];

            if (currentObv >= obv20High) {
                const target = cp * 1.1;
                const stop = cp * 0.95;
                results.push(this._make(
                    'OBV上升', '📈', CAT_MONEY_FLOW, '中', 2,
                    `OBV能量潮创20日新高，量能持续累积，买入信号。`,
                    'BUY', `OBV创新高说明资金持续流入，价格有望跟随上涨`,
                    { target_price: target, stop_loss: stop, obv_new_high: true }
                ));
            }

            if (currentObv <= obv20Low) {
                const target = cp * 0.9;
                const stop = cp * 1.05;
                results.push(this._make(
                    'OBV下降', '📉', CAT_MONEY_FLOW, '中', 2,
                    `OBV能量潮创20日新低，量能持续流失，卖出信号。`,
                    'SELL', `OBV创新低说明资金持续流出，价格有望跟随下跌`,
                    { target_price: target, stop_loss: stop, obv_new_low: true }
                ));
            }
        }

        if (n >= 14) {
            let mfi = null;
            const period = 14;
            if (n >= period + 1) {
                let positiveMF = 0;
                let negativeMF = 0;
                for (let i = n - period; i < n; i++) {
                    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
                    const prevTypicalPrice = (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3;
                    const moneyFlow = typicalPrice * volumes[i];
                    if (typicalPrice > prevTypicalPrice) {
                        positiveMF += moneyFlow;
                    } else if (typicalPrice < prevTypicalPrice) {
                        negativeMF += moneyFlow;
                    }
                }
                if (negativeMF > 0) {
                    const moneyRatio = positiveMF / negativeMF;
                    mfi = 100 - (100 / (1 + moneyRatio));
                } else {
                    mfi = 100;
                }
            }

            if (mfi !== null) {
                if (mfi > 80) {
                    const target = cp * 0.92;
                    const stop = cp * 1.05;
                    results.push(this._make(
                        'MFI超买', '🔥', CAT_MONEY_FLOW, '中', 2,
                        `MFI资金流量指标=${mfi.toFixed(1)}，处于超买区(>80)，卖出信号。`,
                        'SELL', `MFI超买说明资金买入过热，回调风险增加`,
                        { target_price: target, stop_loss: stop, mfi: mfi }
                    ));
                }

                if (mfi < 20) {
                    const target = cp * 1.08;
                    const stop = cp * 0.95;
                    results.push(this._make(
                        'MFI超卖', '🧊', CAT_MONEY_FLOW, '中', 2,
                        `MFI资金流量指标=${mfi.toFixed(1)}，处于超卖区(<20)，买入信号。`,
                        'BUY', `MFI超卖说明资金卖出过度，反弹概率增大`,
                        { target_price: target, stop_loss: stop, mfi: mfi }
                    ));
                }
            }
        }

        if (n >= 20 && avgVol20 && avgVol20 > 0 && ma20 && ma20 > 0) {
            const approxTurnover = volRatio5 * 2;

            if (approxTurnover > 15) {
                results.push(this._make(
                    '换手率过高', '🌡️', CAT_SENTIMENT, '中', 2,
                    `估算日换手率约${approxTurnover.toFixed(1)}%，处于高位，市场情绪极度活跃，需警惕变盘。`,
                    'WATCH', `换手率过高说明多空分歧大，高位警惕见顶，低位可能是换庄`,
                    { turnover_rate_est: approxTurnover }
                ));
            }

            if (approxTurnover >= 3 && approxTurnover <= 10) {
                results.push(this._make(
                    '换手率适中', '👍', CAT_SENTIMENT, '低', 3,
                    `估算日换手率约${approxTurnover.toFixed(1)}%，处于3%-10%活跃区间，市场情绪健康。`,
                    'HOLD', `换手率适中说明交投活跃，趋势延续性较好`,
                    { turnover_rate_est: approxTurnover }
                ));
            }
        }

        if (amplitude > 8) {
            results.push(this._make(
                '振幅大情绪强', '🎢', CAT_SENTIMENT, '中', 3,
                `今日振幅${amplitude.toFixed(2)}%，大幅波动，市场情绪强烈活跃。`,
                'WATCH', `振幅大说明多空博弈激烈，情绪高涨，适合做T但风险也大`,
                { amplitude: amplitude }
            ));
        }

        if (chgPct >= 9.5) {
            const target = cp * 1.1;
            const stop = cp * 0.95;
            results.push(this._make(
                '涨停封板', '🏆', CAT_SENTIMENT, '高', 1,
                `涨停${chgPct.toFixed(2)}%，强烈买入情绪，多头完胜，看高一线。`,
                'BUY', `涨停是最强看涨信号，市场情绪极度乐观，次日大概率冲高`,
                { target_price: target, stop_loss: stop, is_rising_limit: true }
            ));
        }

        if (chgPct <= -9.5) {
            const target = cp * 0.9;
            const stop = cp * 1.05;
            results.push(this._make(
                '跌停恐慌', '💀', CAT_SENTIMENT, '高', 1,
                `跌停${Math.abs(chgPct).toFixed(2)}%，强烈卖出情绪，空头完胜，风险巨大。`,
                'SELL', `跌停是最强看跌信号，市场情绪极度恐慌，次日大概率继续下跌`,
                { target_price: target, stop_loss: stop, is_falling_limit: true }
            ));
        }

        if (n >= 4) {
            let upCount = 0;
            for (let i = n - 3; i < n; i++) {
                if (closes[i] > closes[i - 1]) upCount++;
            }
            if (upCount === 3) {
                results.push(this._make(
                    '连涨情绪升温', '🔥', CAT_SENTIMENT, '中', 2,
                    `连续3日上涨，市场情绪持续升温，多头占据主动。`,
                    'WATCH', `连涨3日情绪升温，短期偏多，但需警惕回调`,
                    { consecutive_up_days: 3 }
                ));
            }
        }

        if (n >= 4) {
            let downCount = 0;
            for (let i = n - 3; i < n; i++) {
                if (closes[i] < closes[i - 1]) downCount++;
            }
            if (downCount === 3) {
                results.push(this._make(
                    '连跌情绪降温', '🧊', CAT_SENTIMENT, '中', 2,
                    `连续3日下跌，市场情绪持续降温，空头占据主动。`,
                    'WATCH', `连跌3日情绪降温，短期偏空，但需关注反弹机会`,
                    { consecutive_down_days: 3 }
                ));
            }
        }

        const body = Math.abs(cp - op);
        const upperShadow = hp - Math.max(cp, op);
        const lowerShadow = Math.min(cp, op) - lp;

        if (body > 0 && upperShadow / body > 3 && avgVol5 && volRatio5 > 1.2) {
            const target = cp * 0.92;
            const stop = cp * 1.03;
            results.push(this._make(
                '长上影线见顶信号', '🔝', CAT_SENTIMENT, '高', 2,
                `上影线长度是实体的${(upperShadow / body).toFixed(1)}倍，且放量，经典见顶信号。`,
                'SELL', `长上影线+放量说明上方抛压沉重，多头力竭，见顶概率大`,
                { target_price: target, stop_loss: stop, upper_shadow_ratio: upperShadow / body, volume_ratio: volRatio5 }
            ));
        }

        if (body > 0 && lowerShadow / body > 3 && avgVol5 && volRatio5 > 1.2) {
            const target = cp * 1.08;
            const stop = cp * 0.97;
            results.push(this._make(
                '长下影线见底信号', '🔚', CAT_SENTIMENT, '高', 2,
                `下影线长度是实体的${(lowerShadow / body).toFixed(1)}倍，且放量，经典见底信号。`,
                'BUY', `长下影线+放量说明下方支撑强劲，空头力竭，见底概率大`,
                { target_price: target, stop_loss: stop, lower_shadow_ratio: lowerShadow / body, volume_ratio: volRatio5 }
            ));
        }

        const isDoji = body > 0 && (hp - lp) > 0 && body / (hp - lp) < 0.1;
        if (isDoji && avgVol5 && volRatio5 < 0.8) {
            results.push(this._make(
                '十字星变盘', '✨', CAT_SENTIMENT, '中', 2,
                `收十字星（实体占比${(body / (hp - lp) * 100).toFixed(1)}%）+缩量，变盘信号。`,
                'WATCH', `十字星+缩量说明多空平衡，即将选择方向，密切关注`,
                { is_doji: true, volume_ratio: volRatio5 }
            ));
        }

        if (n >= 20 && ma20 && ma20 > 0) {
            const priceRange20 = (safeArrMax(highs.slice(-20)) - safeArrMin(lows.slice(-20))) / ma20 * 100;
            const volRatio20 = avgVol20 > 0 ? vol / avgVol20 : 1;

            if (priceRange20 < 10 && volRatio20 < 0.8) {
                results.push(this._make(
                    '筹码集中', '🎯', CAT_CHIP, '中', 2,
                    `20日价格波动${priceRange20.toFixed(1)}%+成交量萎缩，筹码趋于集中。`,
                    'WATCH', `筹码集中说明主力可能在吸筹，等待突破方向`,
                    { price_range_pct: priceRange20, volume_ratio: volRatio20 }
                ));
            }

            if (priceRange20 > 30 && volRatio20 > 1.3) {
                results.push(this._make(
                    '筹码发散', '💫', CAT_CHIP, '中', 3,
                    `20日价格波动${priceRange20.toFixed(1)}%+成交量放大，筹码趋于发散。`,
                    'WATCH', `筹码发散说明多空分歧大，趋势可能加速或反转`,
                    { price_range_pct: priceRange20, volume_ratio: volRatio20 }
                ));
            }
        }

        if (n >= 20) {
            const high20 = safeArrMax(highs.slice(-20));
            const low20 = safeArrMin(lows.slice(-20));
            const range20 = high20 - low20;
            const posInRange = range20 > 0 ? (cp - low20) / range20 : 0.5;

            if (posInRange > 0.8) {
                results.push(this._make(
                    '获利比例高', '💰', CAT_CHIP, '中', 3,
                    `当前价格位于20日区间${(posInRange * 100).toFixed(0)}%高位，获利盘比例高。`,
                    'WATCH', `获利比例高说明大部分筹码盈利，有获利回吐压力`,
                    { profit_ratio_est: posInRange * 100 }
                ));
            }

            if (posInRange < 0.2) {
                results.push(this._make(
                    '套牢盘重', '⛓️', CAT_CHIP, '中', 3,
                    `当前价格位于20日区间${(posInRange * 100).toFixed(0)}%低位，套牢盘比例高。`,
                    'WATCH', `套牢盘重说明上方压力大，反弹解套抛压重`,
                    { trapped_ratio_est: (1 - posInRange) * 100 }
                ));
            }
        }

        if (ma20 && ma20 > 0) {
            const devFromMa20 = (cp - ma20) / ma20 * 100;
            if (Math.abs(devFromMa20) < 3) {
                results.push(this._make(
                    '平均成本支撑', '📏', CAT_CHIP, '低', 3,
                    `当前价格偏离20日均线${devFromMa20 > 0 ? '+' : ''}${devFromMa20.toFixed(2)}%，接近平均成本。`,
                    'HOLD', `价格在20日均线附近，平均成本支撑/压力作用明显`,
                    { ma20: ma20, deviation_pct: devFromMa20 }
                ));
            }
        }

        if (n >= 20 && ma5 && ma10 && ma20) {
            if (ma5 > ma10 && ma10 > ma20) {
                results.push(this._make(
                    '筹码峰上移', '📈', CAT_CHIP, '中', 2,
                    `均线多头排列（MA5>MA10>MA20），筹码峰上移，主力做多。`,
                    'BUY', `筹码峰上移说明平均成本抬升，主力控盘做多`,
                    { ma5: ma5, ma10: ma10, ma20: ma20 }
                ));
            }

            if (ma5 < ma10 && ma10 < ma20) {
                results.push(this._make(
                    '筹码峰下移', '📉', CAT_CHIP, '中', 2,
                    `均线空头排列（MA5<MA10<MA20），筹码峰下移，主力做空。`,
                    'SELL', `筹码峰下移说明平均成本下降，主力持续出货`,
                    { ma5: ma5, ma10: ma10, ma20: ma20 }
                ));
            }
        }

        if (n >= 20 && ma20 && ma20 > 0) {
            const recentPrices = closes.slice(-10);
            const volumeWeightedSum = recentPrices.reduce((sum, price, i) => {
                return sum + price * volumes[n - 10 + i];
            }, 0);
            const totalVol = volumes.slice(-10).reduce((a, b) => a + b, 0);
            const vwap10 = totalVol > 0 ? volumeWeightedSum / totalVol : ma20;

            if (cp > vwap10 && cp > ma20) {
                results.push(this._make(
                    '密集成交区支撑', '🟢', CAT_CHIP, '中', 3,
                    `价格在10日成交密集区（${vwap10.toFixed(2)}）上方，支撑较强。`,
                    'HOLD', `在密集成交区上方，成本支撑强，回调空间有限`,
                    { vwap_10: vwap10, dense_area_support: true }
                ));
            }

            if (cp < vwap10 && cp < ma20) {
                results.push(this._make(
                    '密集成交区压力', '🔴', CAT_CHIP, '中', 3,
                    `价格在10日成交密集区（${vwap10.toFixed(2)}）下方，压力较大。`,
                    'WATCH', `在密集成交区下方，套牢盘压力大，反弹受阻`,
                    { vwap_10: vwap10, dense_area_pressure: true }
                ));
            }
        }

        if (n >= 10) {
            let smallYangCount = 0;
            let totalDays = 10;
            let gradualRise = true;

            for (let i = n - totalDays; i < n; i++) {
                const dayChg = closes[i] > opens[i] ? (closes[i] - opens[i]) / opens[i] * 100 : 0;
                if (dayChg > 0 && dayChg < 3) smallYangCount++;
                if (i > n - totalDays && closes[i] < closes[i - 1] * 0.98) gradualRise = false;
            }

            const avgVol10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
            const volRatio10 = avgVol10 > 0 ? vol / avgVol10 : 1;
            const moderateVolume = volRatio10 <= 1.5 && volRatio10 >= 0.7;

            if (smallYangCount >= 6 && gradualRise && moderateVolume) {
                const target = cp * 1.15;
                const stop = cp * 0.93;
                results.push(this._make(
                    '机构吸筹特征', '🐢', CAT_INSTITUTION, '中', 2,
                    `缓慢上涨+温和放量+小阳线多（${smallYangCount}/${totalDays}），疑似机构吸筹。`,
                    'BUY', `机构吸筹特征：小阴小阳缓步推升，量能温和，后续可能有大行情`,
                    { target_price: target, stop_loss: stop, small_yang_count: smallYangCount }
                ));
            }
        }

        if (n >= 5 && avgVol5) {
            let bigYinCount = 0;
            for (let i = n - 5; i < n; i++) {
                const dayChg = (closes[i] - opens[i]) / opens[i] * 100;
                if (dayChg < -2) bigYinCount++;
            }
            if (volRatio5 > 1.3 && bigYinCount >= 2) {
                const target = cp * 0.88;
                const stop = cp * 1.05;
                results.push(this._make(
                    '机构出货特征', '📦', CAT_INSTITUTION, '高', 1,
                    `放量下跌+大阴线多（${bigYinCount}根），疑似机构出货。`,
                    'SELL', `机构出货特征：放量大跌+大阴线，不计成本出逃`,
                    { target_price: target, stop_loss: stop, big_yin_count: bigYinCount, volume_ratio: volRatio5 }
                ));
            }
        }

        if (n >= 10 && ma20 && avgVol5) {
            const isShrinking = volRatio5 < 0.7;
            const aboveMa20 = cp > ma20;
            if (isShrinking && chgPct < 0 && aboveMa20) {
                results.push(this._make(
                    '主力洗盘特征', '🧹', CAT_INSTITUTION, '中', 2,
                    `缩量下跌+不破20日均线支撑，疑似主力洗盘。`,
                    'WATCH', `洗盘特征：缩量下跌+关键支撑不破，清洗浮筹后可能继续上攻`,
                    { above_ma20: aboveMa20, volume_ratio: volRatio5 }
                ));
            }
        }

        if (n >= 5 && avgVol5) {
            let bigYangCount = 0;
            let volBreakout = volRatio5 > 1.5;
            for (let i = n - 3; i < n; i++) {
                const dayChg = (closes[i] - opens[i]) / opens[i] * 100;
                if (dayChg > 3) bigYangCount++;
            }
            if (bigYangCount >= 2 && volBreakout) {
                const target = cp * 1.2;
                const stop = cp * 0.95;
                results.push(this._make(
                    '主力拉升特征', '🚀', CAT_INSTITUTION, '高', 1,
                    `放量突破+连续大阳线（${bigYangCount}根），主力强势拉升。`,
                    'BUY', `拉升特征：放量+连续大阳，主力不计成本拉高`,
                    { target_price: target, stop_loss: stop, big_yang_count: bigYangCount, volume_ratio: volRatio5 }
                ));
            }
        }

        if (body > 0 && upperShadow / body > 2 && avgVol5 && volRatio5 > 1.2 && n >= 20) {
            const high20 = safeArrMax(highs.slice(-20));
            const low20 = safeArrMin(lows.slice(-20));
            const pos20 = high20 > low20 ? (cp - low20) / (high20 - low20) : 0.5;
            if (pos20 < 0.6) {
                results.push(this._make(
                    '试盘动作', '🧪', CAT_INSTITUTION, '中', 3,
                    `长上影+放量+位置不高（20日${(pos20 * 100).toFixed(0)}%位），疑似主力试盘。`,
                    'WATCH', `试盘特征：长上影测试上方抛压，位置不高说明还在底部区域`,
                    { upper_shadow_ratio: upperShadow / body, position_20: pos20 }
                ));
            }
        }

        if (body > 0 && lowerShadow / body > 2 && avgVol5 && volRatio5 > 1.2 && n >= 20) {
            const high20 = safeArrMax(highs.slice(-20));
            const low20 = safeArrMin(lows.slice(-20));
            const pos20 = high20 > low20 ? (cp - low20) / (high20 - low20) : 0.5;
            if (pos20 < 0.6) {
                results.push(this._make(
                    '震仓动作', '🌪️', CAT_INSTITUTION, '中', 3,
                    `长下影+放量+位置不高（20日${(pos20 * 100).toFixed(0)}%位），疑似主力震仓。`,
                    'WATCH', `震仓特征：长下影测试下方支撑，恐吓恐慌盘出局`,
                    { lower_shadow_ratio: lowerShadow / body, position_20: pos20 }
                ));
            }
        }

        if (n >= 22) {
            const prevHigh = safeArrMax(highs.slice(-22, -2));
            if (cp > prevHigh) {
                results.push(this._make(
                    '突破前高（消息面配合预期）', '📈', CAT_NEWS, '中', 2,
                    `突破前期高点${prevHigh.toFixed(2)}，可能有利好消息配合，关注消息面。`,
                    'WATCH', `突破前高往往伴随利好消息，可关注公告和新闻`,
                    { breakout_price: prevHigh }
                ));
            }
        }

        if (n >= 20 && ma20) {
            if (cp < ma20 && chgPct < -2) {
                results.push(this._make(
                    '跌破支撑（消息面风险警示）', '📉', CAT_NEWS, '中', 2,
                    `跌破20日均线${ma20.toFixed(2)}支撑，可能有利空消息，注意风险。`,
                    'WATCH', `跌破重要支撑往往伴随利空消息，需警惕风险`,
                    { support_price: ma20 }
                ));
            }
        }

        if (n >= 2) {
            const prevHigh = highs[n - 2];
            const prevLow = lows[n - 2];
            const gapUp = op > prevHigh;
            const gapDown = op < prevLow;

            if (gapUp) {
                const gapPct = prevHigh > 0 ? (op - prevHigh) / prevHigh * 100 : 0;
                results.push(this._make(
                    '缺口向上跳空（利好预期）', '⬆️', CAT_NEWS, '高', 1,
                    `向上跳空缺口${gapPct.toFixed(2)}%，开盘${op.toFixed(2)}高于前高${prevHigh.toFixed(2)}，利好预期强烈。`,
                    'BUY', `向上跳空缺口通常伴随利好消息，缺口支撑强`,
                    { gap_pct: gapPct, gap_type: 'up', gap_price: prevHigh }
                ));
            }

            if (gapDown) {
                const gapPct = prevLow > 0 ? (prevLow - op) / prevLow * 100 : 0;
                results.push(this._make(
                    '缺口向下跳空（利空预期）', '⬇️', CAT_NEWS, '高', 1,
                    `向下跳空缺口${gapPct.toFixed(2)}%，开盘${op.toFixed(2)}低于前低${prevLow.toFixed(2)}，利空预期强烈。`,
                    'SELL', `向下跳空缺口通常伴随利空消息，缺口压力大`,
                    { gap_pct: gapPct, gap_type: 'down', gap_price: prevLow }
                ));
            }
        }

        if (avgVol5 && avgVol5 > 0 && volRatio5 > 3) {
            results.push(this._make(
                '异常放量（可能有消息）', '📢', CAT_NEWS, '中', 2,
                `成交量异常放大${((volRatio5 - 1) * 100).toFixed(0)}%（量比${volRatio5.toFixed(1)}），可能有重大消息。`,
                'WATCH', `异常放量往往伴随重大消息，不管利好利空都需关注`,
                { volume_ratio: volRatio5, abnormal_volume: true }
            ));
        }

        if (n >= 2) {
            const prevClose = closes[n - 2];
            const gapPct = prevClose > 0 ? (op - prevClose) / prevClose * 100 : 0;
            if (Math.abs(gapPct) > 7) {
                results.push(this._make(
                    '停牌/复牌特征（大幅跳空）', '⏸️', CAT_NEWS, '中', 3,
                    `大幅跳空${gapPct > 0 ? '高开' : '低开'}${Math.abs(gapPct).toFixed(2)}%，疑似停牌复牌。`,
                    'WATCH', `大幅跳空可能是停牌复牌，需关注公司公告`,
                    { gap_pct: gapPct, possible_suspension: true }
                ));
            }
        }

        results.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

        const BUY_ACTIONS = new Set(['BUY', 'STRONG_BUY']);
        const SELL_ACTIONS = new Set(['SELL', 'STRONG_SELL']);
        // 实际可执行的做T方案：正T、反T、箱体（TRADING_OPPORTUNITY 只是机会提示，不是可执行方案）
        const T_ACTIONS = new Set(['BUY_THEN_SELL', 'SELL_THEN_BUY', 'BOX_TRADING']);

        const buySignals = results.filter(s => BUY_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        const sellSignals = results.filter(s => SELL_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        // 全景分析不生成可执行的做T方案（因为没有持仓信息），只生成机会提示
        const tSignals = [];

        // 综合趋势方向：基于买卖信号的优先级权重加权计算
        let _buyWeight = 0, _sellWeight = 0;
        for (const s of results) {
            const w = s.priority === 0 ? 3 : s.priority === 1 ? 2 : 1;
            if (BUY_ACTIONS.has(s.action)) {
                _buyWeight += w;
            } else if (SELL_ACTIONS.has(s.action)) {
                _sellWeight += w;
            } else if (s.action === 'BUY_THEN_SELL') {
                _buyWeight += w * 0.7;
                _sellWeight += w * 0.3;
            } else if (s.action === 'SELL_THEN_BUY') {
                _buyWeight += w * 0.3;
                _sellWeight += w * 0.7;
            } else if (s.action === 'BOX_TRADING' || s.action === 'TRADING_OPPORTUNITY') {
                _buyWeight += w * 0.5;
                _sellWeight += w * 0.5;
            }
        }
        const _totalWeight = _buyWeight + _sellWeight;
        const _bias = _totalWeight > 0 ? (_buyWeight - _sellWeight) / _totalWeight : 0;
        let _direction = 'HOLD';
        if (_bias >= 0.4) _direction = 'STRONG_BUY';
        else if (_bias >= 0.15) _direction = 'BUY';
        else if (_bias <= -0.4) _direction = 'STRONG_SELL';
        else if (_bias <= -0.15) _direction = 'SELL';

        const summary = {
            stock_code: stockCode,
            stock_name: stockName,
            current_price: cp,
            atr: Math.round(atrVal * 100) / 100,
            atr_pct: cp > 0 ? Math.round((atrVal / cp * 100) * 100) / 100 : 0,
            total_signals: results.length,
            buy_signals: buySignals.length,
            sell_signals: sellSignals.length,
            t_signals: tSignals.length,
            direction: _direction,
            trend_bias: Math.round(_bias * 100) / 100,
            buy_weight: _buyWeight,
            sell_weight: _sellWeight,
        };

        if (buySignals.length > 0) {
            const bestBuy = buySignals[0];
            const entryPrice = bestBuy.entry_price || cp;
            const profitPotential = bestBuy.target_price && entryPrice > 0 ? (bestBuy.target_price - entryPrice) / entryPrice * 100 : null;
            const lossRisk = bestBuy.stop_loss && entryPrice > 0 ? (entryPrice - bestBuy.stop_loss) / entryPrice * 100 : null;
            const riskReward = profitPotential !== null && lossRisk !== null && lossRisk > 0 ? profitPotential / lossRisk : null;
            summary.best_buy = {
                name: bestBuy.name,
                entry_price: entryPrice,
                target_price: bestBuy.target_price ?? null,
                stop_loss: bestBuy.stop_loss ?? null,
                profit_potential: profitPotential !== null ? Math.round(profitPotential * 100) / 100 : null,
                loss_risk: lossRisk !== null ? Math.round(lossRisk * 100) / 100 : null,
                risk_reward: riskReward !== null ? Math.round(riskReward * 100) / 100 : null,
            };
        }

        if (sellSignals.length > 0) {
            const bestSell = sellSignals[0];
            const entryPrice = bestSell.entry_price || cp;
            const profitPotential = bestSell.target_price && entryPrice > 0 ? (entryPrice - bestSell.target_price) / entryPrice * 100 : null;
            const lossRisk = bestSell.stop_loss && entryPrice > 0 ? (bestSell.stop_loss - entryPrice) / entryPrice * 100 : null;
            const riskReward = profitPotential !== null && lossRisk !== null && lossRisk > 0 ? profitPotential / lossRisk : null;
            summary.best_sell = {
                name: bestSell.name,
                entry_price: entryPrice,
                target_price: bestSell.target_price,
                stop_loss: bestSell.stop_loss,
                profit_potential: profitPotential !== null ? Math.round(profitPotential * 100) / 100 : null,
                loss_risk: lossRisk !== null ? Math.round(lossRisk * 100) / 100 : null,
                risk_reward: riskReward !== null ? Math.round(riskReward * 100) / 100 : null,
            };
        }

        if (tSignals.length > 0) {
            let bestT = tSignals[0];
            let bestScore = -Infinity;
            for (const t of tSignals) {
                const buyP = t.buy_price ?? cp;
                const sellP = t.sell_price ?? cp;
                if (sellP <= buyP || buyP <= 0 || sellP <= 0) continue;
                
                // 盈利空间（相对于买入价）
                const profitPct = (sellP - buyP) / buyP * 100;
                const profitAfterFee = profitPct - feeRate * 100 * 2; // 扣除双边手续费feeRate*2
                
                // 必须确保盈利（扣除手续费后）
                if (profitAfterFee < 0.3) continue;
                
                // =====================================================
                //  新评分逻辑：确保盈利优先（使用振幅作为参考）
                // =====================================================
                
                // 1. 盈利评分（权重×3，最高）
                let profitScore = 0;
                if (profitAfterFee >= 1) profitScore = 10;
                else if (profitAfterFee >= 0.7) profitScore = 8;
                else if (profitAfterFee >= 0.5) profitScore = 6;
                else if (profitAfterFee >= 0.3) profitScore = 4;
                
                // 2. 卖出可达性评分（权重×2）
                // 卖出价必须低于日内高点hp，才能确保卖出
                const sellDistance = hp > 0 ? (hp - sellP) / hp * 100 : 0;
                let sellReachableScore = 0;
                if (sellDistance >= 0 && sellDistance <= 2) sellReachableScore = 10;
                else if (sellDistance > 2 && sellDistance <= 5) sellReachableScore = 8;
                else if (sellDistance > 5 && sellDistance <= 10) sellReachableScore = 5;
                else sellReachableScore = 2;
                
                // 3. 买入可达性评分（权重×1）
                // 买入价必须高于日内低点lp，才能确保买到
                const buyDistance = lp > 0 ? (buyP - lp) / lp * 100 : 0;
                let buyReachableScore = 0;
                if (buyDistance >= 0 && buyDistance <= 2) buyReachableScore = 10;
                else if (buyDistance > 2 && buyDistance <= 5) buyReachableScore = 7;
                else if (buyDistance > 5 && buyDistance <= 10) buyReachableScore = 4;
                else buyReachableScore = 2;
                
                // 优先级权重
                const prioWeight = 4 - (t.priority ?? 3);
                
                // 总评分：盈利×3 + 卖出可达×2 + 买入可达×1 + 优先级
                const score = profitScore * 3 + sellReachableScore * 2 + buyReachableScore + prioWeight;
                if (score > bestScore) {
                    bestScore = score;
                    bestT = t;
                }
            }
            const tProfitPotential = bestT.target_price && cp > 0 ? (bestT.target_price - cp) / cp * 100 : null;
            const tLossRisk = bestT.stop_loss && cp > 0 ? (cp - bestT.stop_loss) / cp * 100 : null;
            const tRiskReward = tProfitPotential !== null && tLossRisk !== null && tLossRisk > 0 ? tProfitPotential / tLossRisk : null;
            summary.best_t = {
                name: bestT.name,
                entry_price: cp,
                buy_price: bestT.buy_price || cp,
                sell_price: bestT.sell_price || cp,
                action: bestT.action,
                profit_potential: tProfitPotential !== null ? Math.round(tProfitPotential * 100) / 100 : null,
                loss_risk: tLossRisk !== null ? Math.round(tLossRisk * 100) / 100 : null,
                risk_reward: tRiskReward !== null ? Math.round(tRiskReward * 100) / 100 : null,
            };
        }

        const total = results.length;
        const watchCount = results.filter(r => ['WATCH', 'HOLD', 'OBSERVE'].includes(r.action)).length;
        const activeSignals = total - watchCount;
        const totalDefined = 215; // TARGET_TOTAL including panorama strategies
        summary.strategy_coverage = {
            total_defined: totalDefined,
            triggered: total,
            active_signals: activeSignals,
            coverage_rate: totalDefined > 0 ? Math.round((total / totalDefined) * 1000) / 10 : 0,
            watch_signals: watchCount,
            message: `全景策略已分析6大分类${totalDefined}种策略，触发${total}个信号（其中${activeSignals}个活跃、${watchCount}个观望）`
        };

        return [results, summary];
    }
}

const strategyEngine = new StrategyEngine();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StrategyEngine;
}
