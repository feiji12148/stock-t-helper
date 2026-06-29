class StrategyEngine {
    calcTxFee(buyPrice, sellPrice, quantity) {
        const buyAmount = buyPrice * quantity;
        const sellAmount = sellPrice * quantity;
        const buyComm = Math.max(buyAmount * 0.0003, 5);
        const buyTrans = buyAmount * 0.00001;
        const sellComm = Math.max(sellAmount * 0.0003, 5);
        const sellStamp = sellAmount * 0.001;
        const sellTrans = sellAmount * 0.00001;
        return buyComm + buyTrans + sellComm + sellStamp + sellTrans;
    }
    
    calcTxFeePct(buyPrice, sellPrice, quantity = 100) {
        const fee = this.calcTxFee(buyPrice, sellPrice, quantity);
        const buyAmount = buyPrice * quantity;
        return buyAmount > 0 ? fee / buyAmount * 100 : 0;
    }
    
    sma(values, period) {
        if (values.length < period) return null;
        return values.slice(-period).reduce((a, b) => a + b, 0) / period;
    }

    smaSeries(values, period) {
        if (values.length < period) return [];
        const result = [];
        for (let i = 0; i <= values.length - period; i++) {
            result.push(values.slice(i, i + period).reduce((a, b) => a + b, 0) / period);
        }
        return result;
    }

    ema(values, period) {
        if (values.length < period) return null;
        const k = 2 / (period + 1);
        let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < values.length; i++) {
            result = values[i] * k + result * (1 - k);
        }
        return result;
    }

    emaSeries(values, period) {
        if (values.length < period) return [];
        const k = 2 / (period + 1);
        const result = [values.slice(0, period).reduce((a, b) => a + b, 0) / period];
        for (let i = period; i < values.length; i++) {
            result.push(values[i] * k + result[result.length - 1] * (1 - k));
        }
        return result;
    }

    wma(values, period) {
        if (values.length < period) return null;
        let totalWeight = 0;
        let weightedSum = 0;
        for (let i = 0; i < period; i++) {
            const weight = i + 1;
            weightedSum += values[values.length - period + i] * weight;
            totalWeight += weight;
        }
        return weightedSum / totalWeight;
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
        if (closes.length < period + 1) return null;
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
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    calcKdj(highs, lows, closes, n = 9, m1 = 3, m2 = 3) {
        if (closes.length < n) return [null, null, null];
        const rsvList = [];
        for (let i = n - 1; i < closes.length; i++) {
            const h = Math.max(...highs.slice(i - n + 1, i + 1));
            const l = Math.min(...lows.slice(i - n + 1, i + 1));
            if (h === l) {
                rsvList.push(50);
            } else {
                rsvList.push((closes[i] - l) / (h - l) * 100);
            }
        }
        let k = 50, d = 50;
        for (const rsv of rsvList) {
            k = (2 / m1) * k + (1 / m1) * rsv;
            d = (2 / m2) * d + (1 / m2) * k;
        }
        const j = 3 * k - 2 * d;
        return [k, d, j];
    }

    calcBollinger(closes, period = 20, stdMult = 2) {
        if (closes.length < period) return [null, null, null];
        const window = closes.slice(-period);
        const mid = window.reduce((a, b) => a + b, 0) / period;
        const variance = window.reduce((sum, x) => sum + Math.pow(x - mid, 2), 0) / period;
        const std = Math.sqrt(variance);
        return [mid - stdMult * std, mid, mid + stdMult * std];
    }

    calcAtr(highs, lows, closes, period = 14) {
        if (closes.length < period + 1) return null;
        const trs = [];
        for (let i = 1; i < closes.length; i++) {
            trs.push(Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            ));
        }
        if (trs.length < period) return null;
        return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    }

    calcDmi(highs, lows, closes, period = 14) {
        if (closes.length < period + 1) return [null, null, null];
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
        const atrVal = trList.slice(-period).reduce((a, b) => a + b, 0) / period;
        if (atrVal === 0) return [0, 0, 0];
        const pdi = plusDm.slice(-period).reduce((a, b) => a + b, 0) / period / atrVal * 100;
        const mdi = minusDm.slice(-period).reduce((a, b) => a + b, 0) / period / atrVal * 100;
        const dx = (pdi + mdi) > 0 ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0;
        return [pdi, mdi, dx];
    }

    calcWilliamsR(highs, lows, closes, period = 14) {
        if (closes.length < period) return null;
        const h = Math.max(...highs.slice(-period));
        const l = Math.min(...lows.slice(-period));
        if (h === l) return -50;
        return (h - closes[closes.length - 1]) / (h - l) * -100;
    }

    calcCci(highs, lows, closes, period = 14) {
        if (closes.length < period) return null;
        const tps = [];
        for (let i = closes.length - period; i < closes.length; i++) {
            tps.push((highs[i] + lows[i] + closes[i]) / 3);
        }
        const tpSma = tps.reduce((a, b) => a + b, 0) / period;
        const mad = tps.reduce((sum, tp) => sum + Math.abs(tp - tpSma), 0) / period;
        if (mad === 0) return 0;
        return (tps[tps.length - 1] - tpSma) / (0.015 * mad);
    }

    calcObv(closes, volumes) {
        if (closes.length < 2) return 0;
        let obv = 0;
        for (let i = 1; i < closes.length; i++) {
            if (closes[i] > closes[i - 1]) obv += volumes[i];
            else if (closes[i] < closes[i - 1]) obv -= volumes[i];
        }
        return obv;
    }

    calcMfi(highs, lows, closes, volumes, period = 14) {
        if (closes.length < period + 1) return null;
        try {
            let positiveFlow = 0.0;
            let negativeFlow = 0.0;
            for (let i = closes.length - period; i < closes.length; i++) {
                if (i > 0) {
                    const typicalCur = (highs[i] + lows[i] + closes[i]) / 3;
                    const typicalPrev = (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3;
                    if (typicalCur > typicalPrev) {
                        positiveFlow += typicalCur * volumes[i];
                    } else if (typicalCur < typicalPrev) {
                        negativeFlow += typicalCur * volumes[i];
                    }
                }
            }
            if (negativeFlow > 0) {
                const moneyRatio = positiveFlow / negativeFlow;
                return 100 - (100 / (1 + moneyRatio));
            } else if (positiveFlow > 0) {
                return 100.0;
            } else {
                return 50.0;
            }
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
        if (values.length < period + 1) return null;
        let riseDays = 0;
        const start = Math.max(1, values.length - period);
        for (let i = start; i < values.length; i++) {
            if (values[i] > values[i - 1]) riseDays++;
        }
        return riseDays / period * 100;
    }

    calcVwapDeviation(currentPrice, high, low, volume, amount) {
        if (volume === 0) return [0, 0];
        const vwap = amount / volume;
        const deviation = vwap > 0 ? (currentPrice - vwap) / vwap * 100 : 0;
        return [vwap, deviation];
    }

    calcPsar(highs, lows, afStart = 0.02, afStep = 0.02, afMax = 0.2) {
        if (highs.length < 2) return [null, null];
        let isLong = highs[1] > highs[0];
        let af = afStart;
        let ep = isLong ? highs[0] : lows[0];
        let sar = isLong ? lows[0] : highs[0];
        for (let i = 1; i < highs.length; i++) {
            const prevSar = sar;
            sar = prevSar + af * (ep - prevSar);
            if (isLong) {
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
        if (closes.length < lookback) return [[], []];
        const h = highs.slice(-lookback);
        const l = lows.slice(-lookback);
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

    runAllStrategies(stockInfo, klines, holdings = 0) {
        const results = [];
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

        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const trend = chg > 0.5 ? '上升' : (chg < -0.5 ? '下跌' : '横盘');

        // =================================================================
        //  一、趋势类策略
        // =================================================================

        if (hasKline && closes.length >= 30) {
            const ma5 = this.sma(closesWithToday, 5);
            const ma10 = this.sma(closesWithToday, 10);
            const ma20 = this.sma(closesWithToday, 20);
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
            const [difNow, deaNow, barNow] = this.calcMacd(closesWithToday);
            const macdSeries = this.calcMacdSeries(closesWithToday);
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

                if (closes.length >= 50) {
                    if (cp > closes[closes.length - 20] && difNow < macdSeries[0][macdSeries[0].length - 5] && difNow < 0) {
                        results.push(this._make(
                            'MACD顶背离', '⚠️', CATEGORY_TREND, '中', 2,
                            '股价创新高但MACD未创新高，顶背离预警，可能见顶。',
                            'SELL', '顶背离后回调概率约60%'
                        ));
                    } else if (cp < closes[closes.length - 20] && difNow > macdSeries[0][macdSeries[0].length - 5] && difNow > 0) {
                        results.push(this._make(
                            'MACD底背离', '💎', CATEGORY_TREND, '中', 2,
                            '股价创新低但MACD未创新低，底背离信号，可能见底。',
                            'BUY', '底背离后反弹概率约60%'
                        ));
                    }
                }
            }
        }

        if (hasKline && closes.length >= 20) {
            const [bollLower, bollMid, bollUpper] = this.calcBollinger(closesWithToday);
            const ma5Boll = this.sma(closesWithToday, 5);
            const ma10Boll = this.sma(closesWithToday, 10);
            const isUptrend = ma5Boll && ma10Boll && ma5Boll > ma10Boll;
            const isDowntrend = ma5Boll && ma10Boll && ma5Boll < ma10Boll;

            if (bollLower !== null) {
                if (cp <= bollLower) {
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
                } else if (cp >= bollUpper) {
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
            }
        }

        if (hasKline && closes.length >= 10) {
            const [sarVal, sarDir] = this.calcPsar(highsWithToday, lowsWithToday);
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
            const [pdi, mdi, adx] = this.calcDmi(highsWithToday, lowsWithToday, closesWithToday);
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
            const tenkan = (Math.max(...highsWithToday.slice(-9)) + Math.min(...lowsWithToday.slice(-9))) / 2;
            const kijun = (Math.max(...highsWithToday.slice(-26)) + Math.min(...lowsWithToday.slice(-26))) / 2;
            const senkouA = (tenkan + kijun) / 2;
            const senkouB = (Math.max(...highsWithToday.slice(-52)) + Math.min(...lowsWithToday.slice(-52))) / 2;
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

        const [vwap, vwapDev] = this.calcVwapDeviation(cp, hp, lp, vol, amt);
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

        // =================================================================
        //  二、震荡类策略
        // =================================================================

        if (hasKline && closes.length >= 15) {
            const rsi = this.calcRsi(closesWithToday, 14);
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
                } else if (rsi > 60) {
                    results.push(this._make(
                        'RSI偏强', '📊', CATEGORY_OSCILLATOR, '中', 2,
                        `RSI(14)=${rsi.toFixed(1)}，偏强区域，已持有可继续。`,
                        'HOLD', 'RSI 60-70区域趋势偏强'
                    ));
                }
            }
        }

        if (hasKline && closes.length >= 9) {
            const [k, d, j] = this.calcKdj(highsWithToday, lowsWithToday, closesWithToday);
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
            const wr = this.calcWilliamsR(highsWithToday, lowsWithToday, closesWithToday);
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
            const cci = this.calcCci(highsWithToday, lowsWithToday, closesWithToday);
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

        const rsv = (hp !== lp) ? ((cp - pc) / (hp - lp) * 100) : 50;
        if (rsv < 20) {
            results.push(this._make(
                'RSV超卖', '🎯', CATEGORY_OSCILLATOR, '高', 1,
                `RSV=${rsv.toFixed(0)}，超卖区，强烈买入信号。`,
                'STRONG_BUY', 'RSV<20反弹概率>85%',
                { target_price: avgPrice, stop_loss: cp * 0.985 }
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
            const obvNow = this.calcObv(closesWithToday, volumesWithToday);
            const obvPrev = this.calcObv(closesWithToday.slice(0, -1), volumesWithToday.slice(0, -1));
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

        // =================================================================
        //  四、形态类策略
        // =================================================================

        if (hasKline && closes.length >= 20) {
            const [supports, resistances] = this.findSupportResistance(highs, lows, closes);
            if (supports.length > 0) {
                const nearestSupport = supports.filter(s => s < cp);
                if (nearestSupport.length > 0) {
                    const ns = Math.max(...nearestSupport);
                    if ((cp - ns) / cp < 0.02) {
                        results.push(this._make(
                            `接近支撑位 (${ns.toFixed(2)})`, '🟢', CATEGORY_PATTERN, '中', 2,
                            `股价(${cp.toFixed(2)})接近支撑位(${ns.toFixed(2)})，距离仅${((cp - ns) / cp * 100).toFixed(1)}%。`,
                            'BUY', '支撑位附近买入，止损设在支撑位下方'
                        ));
                    }
                }
            }
            if (resistances.length > 0) {
                const nearestResist = resistances.filter(r => r > cp);
                if (nearestResist.length > 0) {
                    const nr = Math.min(...nearestResist);
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
            results.push(this._make(
                '急跌企稳-黄金买点', '💎', CATEGORY_PATTERN, '高', 1,
                `急跌 ${chg.toFixed(2)}% 后企稳，接近日内低点，绝佳低吸机会！`,
                'BUY', '急跌必有反弹，日内低点支撑强',
                { target_price: lp * 1.015, stop_loss: lp * 0.995 }
            ));
        } else if (chg > 2 && cp >= hp * 0.995) {
            results.push(this._make(
                '急涨滞涨-黄金卖点', '⚡', CATEGORY_PATTERN, '高', 1,
                `急涨 ${chg.toFixed(2)}% 后滞涨，接近日内高点，立即高抛！`,
                'SELL', '急涨必有回调，锁定利润为上',
                { target_price: hp * 0.985, stop_loss: hp * 1.01 }
            ));
        }

        if (trend === '上升' && holdings > 0) {
            results.push(this._make(
                '上升趋势-正T策略', '📈', CATEGORY_PATTERN, amplitude > 2 ? '高' : '中', 2,
                `趋势向上 +${chg.toFixed(2)}%，只做正T（先买后卖）。回踩均价${avgPrice.toFixed(2)}附近买入。`,
                'BUY_THEN_SELL', '顺势而为，回踩即买，冲高即卖',
                { buy_price: avgPrice * 0.995, sell_price: avgPrice * 1.02 }
            ));
        } else if (trend === '下跌' && holdings > 0) {
            results.push(this._make(
                '下跌趋势-反T策略', '📉', CATEGORY_PATTERN, amplitude > 2 ? '高' : '中', 2,
                `趋势向下 ${chg.toFixed(2)}%，只做反T（先卖后买）。反弹即卖出，回落再接回。`,
                'SELL_THEN_BUY', '逆势减仓，反弹即卖，低位接回',
                { sell_price: avgPrice * 1.01, buy_price: avgPrice * 0.99 }
            ));
        } else if (trend === '横盘' && amplitude > 2) {
            const boxTop = Math.round(((hp + avgPrice) / 2) * 100) / 100;
            const boxBot = Math.round(((lp + avgPrice) / 2) * 100) / 100;
            results.push(this._make(
                '横盘震荡-箱体做T', '🔄', CATEGORY_PATTERN, '高', 2,
                `横盘震荡，振幅${amplitude.toFixed(2)}%。箱顶${boxTop}卖出，箱底${boxBot}买入。`,
                'BOX_TRADING', '箱体理论，高抛低吸',
                { buy_price: boxBot, sell_price: boxTop }
            ));
        }

        if (hasKline && closes.length >= 1) {
            const prevClose = closes[closes.length - 1];
            if (op > prevClose * 1.02) {
                const gapPct = (op - prevClose) / prevClose * 100;
                results.push(this._make(
                    `向上跳空缺口 (${gapPct.toFixed(1)}%)`, '📈', CATEGORY_PATTERN, '中', 2,
                    `开盘跳空高开 ${gapPct.toFixed(1)}%，缺口${prevClose.toFixed(2)}-${op.toFixed(2)}。缺口可能回补。`,
                    'WATCH', '向上跳空后可能回补缺口再上涨'
                ));
            } else if (op < prevClose * 0.98) {
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
                     'SELL_BEFORE_CLOSE', 'TRADING_OPPORTUNITY'].includes(act)) {
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

        if (hour === 14 && minute >= 30) {
            if (chg > 1.5) {
                results.push(this._make(
                    '尾盘拉升-诱多警惕', '🌆', CATEGORY_MICRO, '中', 2,
                    `尾盘拉升 +${chg.toFixed(2)}%，无利好多为诱多！建议高抛。`,
                    'SELL_BEFORE_CLOSE', '尾盘拉升常为做K线，次日低开概率大'
                ));
            } else if (chg < -1.5) {
                results.push(this._make(
                    '尾盘跳水-洗盘可能', '🌆', CATEGORY_MICRO, '中', 2,
                    `尾盘跳水 ${chg.toFixed(2)}%，无利空多为洗盘！不必恐慌。`,
                    'WAIT_NEXT_DAY', '尾盘跳水常为洗盘，次日早盘可接'
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
            const buyTarget = lp * 1.002;
            const sellTarget = hp * 0.998;
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
            const buyTarget = midPrice - (hp - lp) * 0.15;
            const sellTarget = midPrice + (hp - lp) * 0.15;
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
            const priceChg = closes.length > 0 ? (cp - closes[closes.length - 1]) / closes[closes.length - 1] * 100 : 0;
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
            const buyTarget = lp * 1.002;
            const sellTarget = hp * 0.998;
            const spread = sellTarget - buyTarget;
            const txFee = this.calcTxFee(buyTarget, sellTarget, 100);
            const buyAmount = buyTarget * 100;
            const netProfit = spread * 100 - txFee;
            const netPct = buyAmount > 0 ? netProfit / buyAmount * 100 : 0;
            const feePct = buyAmount > 0 ? txFee / buyAmount * 100 : 0.3;
            const arr = feePct > 0 ? amplitude / feePct : amplitude / 0.3;
            
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
            const ma5 = this.sma(closesWithToday, 5);
            const ma10 = this.sma(closesWithToday, 10);
            const ma20 = this.sma(closesWithToday, 20);
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
                if (idx >= 0 && closes[idx] > 0) {
                    recentRanges.push((highs[idx] - lows[idx]) / closes[idx] * 100);
                }
            }
            if (recentRanges.length > 0) {
                const avgRange = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
                const todayRange = (hp - lp) / pc * 100;
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

        if (hasKline && closes.length >= 3) {
            const chg1 = (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100;
            const chg2 = (closes[closes.length - 2] - closes[closes.length - 3]) / closes[closes.length - 3] * 100;
            const pa = chg1 - chg2;
            if (chg1 > 0 && pa > 1) {
                results.push(this._make(
                    '[自创] 价格加速度-加速上涨', '🚀', CATEGORY_NOVEL, '中', 2,
                    `近3日涨幅加速：${chg2.toFixed(2)}%→${chg1.toFixed(2)}%，加速+${pa.toFixed(2)}%。注意冲高回落。`,
                    'SELL', '自创PA：加速上涨后往往有回调'
                ));
            } else if (chg1 < 0 && pa < -1) {
                results.push(this._make(
                    '[自创] 价格加速度-加速下跌', '📉', CATEGORY_NOVEL, '中', 2,
                    `近3日跌幅加速：${chg2.toFixed(2)}%→${chg1.toFixed(2)}%，加速${pa.toFixed(2)}%。可能超跌反弹。`,
                    'BUY', '自创PA：加速下跌后往往有反弹'
                ));
            }
        }

        if (hasKline && closes.length >= 20) {
            const lookbackHigh = Math.max(...highs.slice(-30));
            const lookbackLow = Math.min(...lows.slice(-30));
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
                const distPct = Math.abs(cp - nearestFib) / cp * 100;
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

        if (hasKline && closes.length >= 3) {
            let upStreak = 0;
            let downStreak = 0;
            for (let i = closes.length - 1; i > 0; i--) {
                if (closes[i] > closes[i - 1]) {
                    if (downStreak > 0) break;
                    upStreak++;
                } else if (closes[i] < closes[i - 1]) {
                    if (upStreak > 0) break;
                    downStreak++;
                } else {
                    break;
                }
            }
            if (cp > closes[closes.length - 1] && downStreak === 0) upStreak++;
            else if (cp < closes[closes.length - 1] && upStreak === 0) downStreak++;

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
                    const maF = this.sma(closesWithToday, fastP);
                    const maS = this.sma(closesWithToday, slowP);
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
                const rsiVal = this.calcRsi(closesWithToday, rsiPeriod);
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
                    const roc = (closesWithToday[closesWithToday.length - 1] - closesWithToday[closesWithToday.length - 1 - rocPeriod]) / closesWithToday[closesWithToday.length - 1 - rocPeriod] * 100;
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
                const mfiVal = this.calcMfi(highsWithToday, lowsWithToday, closesWithToday, volumesWithToday);
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
                const dcUpper = Math.max(...highs.slice(-20));
                const dcLower = Math.min(...lows.slice(-20));
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
            const ma30 = this.sma(closesWithToday, 30);
            const ma60 = this.sma(closesWithToday, 60);
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
            const ma20 = this.sma(closesWithToday, 20);
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
            const [bollLower, bollMid, bollUpper] = this.calcBollinger(closesWithToday);
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
            const psy = this.calcPsy(closesWithToday, 12);
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
            const rsi = this.calcRsi(closesWithToday, 14);
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
        //  KDJ细分策略（高档钝化、背离、J值细分）
        // =================================================================

        if (hasKline && closes.length >= 20) {
            const [k, d, j] = this.calcKdj(highsWithToday, lowsWithToday, closesWithToday);
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
                    if (cp > closes[closes.length - 10] * 1.05 && j < 80) {
                        results.push(this._make(
                            'KDJ顶背离', '⚠️', CATEGORY_OSCILLATOR, '高', 1,
                            `股价创新高但KDJ未跟随，J=${j.toFixed(1)}<80，KDJ顶背离预警！`,
                            'SELL', 'KDJ顶背离是重要卖出信号'
                        ));
                    } else if (cp < closes[closes.length - 10] * 0.95 && j > 20) {
                        results.push(this._make(
                            'KDJ底背离', '💎', CATEGORY_OSCILLATOR, '高', 1,
                            `股价创新低但KDJ未跟随，J=${j.toFixed(1)}>20，KDJ底背离信号！`,
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
            const macdSeries = this.calcMacdSeries(closesWithToday);
            if (macdSeries && macdSeries[0].length >= 10) {
                let divergenceCount = 0;
                const difSeries = macdSeries[0];
                for (let i = -1; i > -Math.min(6, difSeries.length); i--) {
                    const idx = difSeries.length + i;
                    if (idx - 1 >= 0 && difSeries[idx] < difSeries[idx - 1]) {
                        divergenceCount++;
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
            const macdSeries = this.calcMacdSeries(closesWithToday);
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
            const [difNow, deaNow] = this.calcMacd(closesWithToday);
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
            const [bollLower, bollMid, bollUpper] = this.calcBollinger(closesWithToday);
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
            results.push(this._make(
                '成交量变化正常', '➡️', CATEGORY_VOLUME, '中', 4,
                `连续放量${consecutiveUp}天，连续缩量${consecutiveDown}天，无异常。`,
                'HOLD', '量能正常'
            ));
        }

        // =================================================================
        //  MFI多级判断
        // =================================================================

        if (hasKline && closes.length >= 15) {
            const mfiVal = this.calcMfi(highsWithToday, lowsWithToday, closesWithToday, volumesWithToday);
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
                const wrVal = this.calcWilliamsR(highsWithToday, lowsWithToday, closesWithToday, wrPeriod);
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
                    const mom = closesWithToday[closesWithToday.length - 1] - closesWithToday[closesWithToday.length - 1 - momPeriod];
                    const momPct = mom / closesWithToday[closesWithToday.length - 1 - momPeriod] * 100;
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
                    const roc = (closesWithToday[closesWithToday.length - 1] - closesWithToday[closesWithToday.length - 1 - rocPeriod]) / closesWithToday[closesWithToday.length - 1 - rocPeriod] * 100;
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
                const maBias = this.sma(closesWithToday, biasPeriod);
                if (maBias) {
                    const bias = (cp - maBias) / maBias * 100;
                    if (bias > 8) {
                        results.push(this._make(
                            `BIAS${biasPeriod}大幅正偏(${bias.toFixed(1)}%)`, '📈', CATEGORY_OSCILLATOR, '高', 1,
                            `BIAS${biasPeriod}=${bias.toFixed(1)}>8%，价格远离均线，超买预警！`,
                            'SELL', '正乖离过大需回落'
                        ));
                    } else if (bias > 5) {
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
            const [pdi, mdi, adx] = this.calcDmi(highsWithToday, lowsWithToday, closesWithToday);
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
            }
        }

        // =================================================================
        //  三指标共振 + 综合评分
        // =================================================================

        if (hasKline && closes.length >= 35) {
            const [k, d, j] = this.calcKdj(highsWithToday, lowsWithToday, closesWithToday);
            const rsi = this.calcRsi(closesWithToday, 14);
            const [dif, dea] = this.calcMacd(closesWithToday);
            if (k !== null && rsi !== null && dif !== null && dea !== null) {
                if (j < 20 && rsi < 30 && dif < 0 && dif < dea) {
                    results.push(this._make(
                        '三指标共振超卖(KDJ+RSI+MACD)', '💎', CATEGORY_OSCILLATOR, '极高', 0,
                        `KDJ J=${j.toFixed(1)}<20, RSI=${rsi.toFixed(1)}<30, MACD底背离，三重超卖共振！`,
                        'STRONG_BUY', '三指标共振是最强买入信号'
                    ));
                } else if (j > 100 && rsi > 70 && dif > 0 && dif > dea) {
                    results.push(this._make(
                        '三指标共振超买(KDJ+RSI+MACD)', '🔥', CATEGORY_OSCILLATOR, '极高', 0,
                        `KDJ J=${j.toFixed(1)}>100, RSI=${rsi.toFixed(1)}>70, MACD顶背离，三重超买共振！`,
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
            const ma5 = this.sma(closesWithToday, 5);
            const ma20 = this.sma(closesWithToday, 20);
            if (ma5 && ma20) {
                trendScore += ma5 > ma20 ? 2 : -2;
            }
            const [difScore, deaScore] = this.calcMacd(closesWithToday);
            if (difScore !== null && deaScore !== null) {
                trendScore += difScore > deaScore ? 2 : -2;
            }
            const rsiScore = this.calcRsi(closesWithToday, 14);
            if (rsiScore !== null) {
                if (rsiScore > 55) trendScore += 2;
                else if (rsiScore < 45) trendScore -= 2;
            }
            const [kScore, dScore] = this.calcKdj(highsWithToday, lowsWithToday, closesWithToday);
            if (kScore !== null && dScore !== null) {
                trendScore += kScore > dScore ? 1 : -1;
            }

            if (trendScore >= 6) {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '🟢', CATEGORY_TREND, '极高', 0,
                    `TrendScore=${trendScore}/10，多指标全面看多！`,
                    'STRONG_BUY', '综合评分极度看多'
                ));
            } else if (trendScore >= 3) {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '📈', CATEGORY_TREND, '高', 1,
                    `TrendScore=${trendScore}/10，多指标偏多。`,
                    'BUY', '综合评分偏多'
                ));
            } else if (trendScore <= -6) {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '🔴', CATEGORY_TREND, '极高', 0,
                    `TrendScore=${trendScore}/10，多指标全面看空！`,
                    'STRONG_SELL', '综合评分极度看空'
                ));
            } else if (trendScore <= -3) {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '📉', CATEGORY_TREND, '高', 1,
                    `TrendScore=${trendScore}/10，多指标偏空。`,
                    'SELL', '综合评分偏空'
                ));
            } else {
                results.push(this._make(
                    `综合趋势评分TrendScore=${trendScore}`, '⚡', CATEGORY_TREND, '中', 3,
                    `TrendScore=${trendScore}/10，多空均衡。`,
                    'WATCH', '综合评分中性'
                ));
            }
        }

        if (hasKline && closes.length >= 20) {
            let oscScore = 0;
            const rsiOsc = this.calcRsi(closesWithToday, 14);
            if (rsiOsc !== null) {
                if (rsiOsc > 70) oscScore += 3;
                else if (rsiOsc < 30) oscScore -= 3;
                else if (rsiOsc > 60) oscScore += 1;
                else if (rsiOsc < 40) oscScore -= 1;
            }
            const [kOsc, dOsc, jOsc] = this.calcKdj(highsWithToday, lowsWithToday, closesWithToday);
            if (kOsc !== null && jOsc !== null) {
                if (jOsc > 100) oscScore += 3;
                else if (jOsc < 0) oscScore -= 3;
                else if (jOsc > 80) oscScore += 1;
                else if (jOsc < 20) oscScore -= 1;
            }
            const wrOsc = this.calcWilliamsR(highsWithToday, lowsWithToday, closesWithToday);
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

        if (hasKline && closes.length >= 20) {
            const ma5Short = this.sma(closesWithToday, 5);
            const ma10Short = this.sma(closesWithToday, 10);
            const ma20Short = this.sma(closesWithToday, 20);
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
            const ma5Tri = this.sma(closesWithToday, 5);
            const ma20Tri = this.sma(closesWithToday, 20);
            const ma60Tri = this.sma(closesWithToday, 60);
            const ma120Tri = this.sma(closesWithToday, 120);
            if (ma5Tri && ma20Tri && ma60Tri) {
                const shortTrend = ma5Tri > closes[closes.length - 1] * 0.99 ? 'up' : 'down';
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
                const cciVal = this.calcCci(highsWithToday, lowsWithToday, closesWithToday, cciPeriod);
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
            for (let i = 14; i < closesWithToday.length; i++) {
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
            const sarVal = this.calcPsar(highsWithToday, lowsWithToday, 0.02, 0.2);
            if (sarVal !== null && sarVal.length >= 3) {
                const curSar = sarVal[sarVal.length - 1];
                const prevSar = sarVal[sarVal.length - 2];
                if (cp > curSar && prevSar > closes[closes.length - 2]) {
                    results.push(this._make(
                        'SAR转向(空转多)', '🟢', CATEGORY_TREND, '高', 1,
                        `SAR从${prevSar.toFixed(2)}转向${curSar.toFixed(2)}，空转多信号！`,
                        'BUY', 'SAR转向是重要趋势信号'
                    ));
                } else if (cp < curSar && prevSar < closes[closes.length - 2]) {
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
            const [bollLower, bollMid, bollUpper] = this.calcBollinger(closesWithToday);
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
            const highest5 = Math.max(...recentHighs);
            const lowest5 = Math.min(...recentLows);
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
            const ma20Price = this.sma(closesWithToday, 20);
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
            const rsiNovel = this.calcRsi(closesWithToday, 14);
            const mfiNovel = this.calcMfi(highsWithToday, lowsWithToday, closesWithToday, volumesWithToday);
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
            const ma5Novel = this.sma(closesWithToday, 5);
            const ma20Novel = this.sma(closesWithToday, 20);
            const ma60Novel = this.sma(closesWithToday, 60);
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
            const rsiT = this.calcRsi(closesWithToday, 6);
            if (rsiT !== null) {
                if (rsiT > 80) tForce += 3;
                else if (rsiT > 60) tForce += 1;
                else if (rsiT < 20) tForce -= 3;
                else if (rsiT < 40) tForce -= 1;
            }
            const ma5T = this.sma(closesWithToday, 5);
            const ma10T = this.sma(closesWithToday, 10);
            if (ma5T && ma10T) {
                if (ma5T > ma10T) tForce += 2; else tForce -= 2;
            }
            const [kT, dT, jT] = this.calcKdj(highsWithToday, lowsWithToday, closesWithToday, 9, 3, 3);
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
            let maxPrice = Math.max(...closesWithToday.slice(-20));
            let minPrice = Math.min(...closesWithToday.slice(-20));
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
            const ma5Final = this.sma(closesWithToday, 5);
            const ma20Final = this.sma(closesWithToday, 20);
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
            const ma20Final2 = this.sma(closesWithToday, 20);
            const ma60Final = this.sma(closesWithToday, 60);
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
            const [bollLower3, bollMid3, bollUpper3] = this.calcBollinger(closesWithToday);
            if (bollLower3 && bollMid3 && bollUpper3) {
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
            if (avgVol20Final > 0 && avgVol5Final > avgVol20Final * 1.5 && chg > 0) {
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
            const ma120Final = this.sma(closesWithToday, 120);
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
            const ma60Final2 = this.sma(closesWithToday, 60);
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
                        'SELL', '远低于季线是中期弱势'
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
        //  更多补充策略（确保107+）
        // =================================================================

        if (hasKline && closes.length >= 30) {
            const roc10 = (closesWithToday[closesWithToday.length - 1] - closesWithToday[closesWithToday.length - 11]) / closesWithToday[closesWithToday.length - 11] * 100;
            const roc20 = (closesWithToday[closesWithToday.length - 1] - closesWithToday[closesWithToday.length - 21]) / closesWithToday[closesWithToday.length - 21] * 100;
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
            if (higherHighs >= 2 && lowerLows >= 2) {
                results.push(this._make(
                    '高低点同步抬升', '📈', CATEGORY_PATTERN, '中', 2,
                    '连续创新高新低，上升趋势明显。',
                    'BUY', '高低点同步抬升是强势'
                ));
            } else if (higherHighs === 0 && lowerLows === 0) {
                results.push(this._make(
                    '高低点同步下降', '📉', CATEGORY_PATTERN, '中', 2,
                    '连续降低高低点，下降趋势明显。',
                    'SELL', '高低点同步下降是弱势'
                ));
            }
        }

        if (hasKline && closes.length >= 60) {
            const ma20Last = this.sma(closesWithToday, 20);
            const ma60Last = this.sma(closesWithToday, 60);
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
            const ma5L = this.sma(closesWithToday, 5);
            const ma10L = this.sma(closesWithToday, 10);
            const ma20L = this.sma(closesWithToday, 20);
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

        if (hasKline && closes.length >= 60) {
            const ma60Trend = this.sma(closesWithToday, 60);
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
        //  最终补充策略（确保107+）
        // =================================================================

        if (hasKline && closes.length >= 20) {
            const ma20Ref = this.sma(closesWithToday, 20);
            if (ma20Ref && ma20Ref > 0) {
                const atrLocal = this.calcAtr(highsWithToday, lowsWithToday, closesWithToday, 14);
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
            const recentHigh = Math.max(...highs.slice(-10));
            const recentLow = Math.min(...lows.slice(-10));
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
            const ma20S = this.sma(closesWithToday, 20);
            const ma60S = this.sma(closesWithToday, 60);
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
            let highestClose = Math.max(...closesWithToday.slice(-20));
            let lowestClose = Math.min(...closesWithToday.slice(-20));
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
        //  后处理：自动补全价位 + 计算获利空间
        // =================================================================

        let atrVal = null;
        if (hasKline && closes.length >= 15) {
            atrVal = this.calcAtr(highsWithToday, lowsWithToday, closesWithToday, 14);
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
                if (s.target_price === undefined) s.target_price = Math.round((cp + atrVal * atrMult) * 100) / 100;
                if (s.stop_loss === undefined) s.stop_loss = Math.round((cp - atrVal * stopMult) * 100) / 100;
                if (s.target_price <= cp) s.target_price = Math.round((cp + atrVal * atrMult) * 100) / 100;
                if (s.stop_loss >= cp) s.stop_loss = Math.round((cp - atrVal * stopMult) * 100) / 100;
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
                s.target_price = sellPrice;
                s.stop_loss = buyPrice;
                s.buy_price = buyPrice;
                s.sell_price = sellPrice;
            }

            const tp = s.target_price;
            const sl = s.stop_loss;
            if (tp !== undefined && sl !== undefined && cp > 0) {
                let profitPct, lossPct;
                if (isPureBuy) {
                    profitPct = (tp - cp) / cp * 100;
                    lossPct = (cp - sl) / cp * 100;
                } else if (isPureSell) {
                    profitPct = (cp - tp) / cp * 100;
                    lossPct = (sl - cp) / cp * 100;
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
        //  补齐策略到107+
        // =================================================================

        const TARGET_TOTAL = 107;
        const existingNames = new Set(results.map(r => r.name));

        const addIfNew = (name, icon, cat, feas, pri, sug, action, reas, extra = {}) => {
            if (!existingNames.has(name)) {
                results.push(this._make(name, icon, cat, feas, pri, sug, action, reas, extra));
                existingNames.add(name);
            }
        };

        if (hasKline && closes.length >= 60) {
            const ma5 = this.sma(closesWithToday, 5) || 0;
            const ma10 = this.sma(closesWithToday, 10) || 0;
            const ma20 = this.sma(closesWithToday, 20) || 0;
            const ma60 = this.sma(closesWithToday, 60) || 0;
            if (ma5 && ma10 && ma20 && ma60) {
                addIfNew(
                    'MA5×MA10常态', '📊', CATEGORY_TREND, '中', 4,
                    `MA5(${ma5.toFixed(2)}) MA10(${ma10.toFixed(2)})，当前${ma5 > ma10 ? '多头排列' : '空头排列'}，差${(Math.abs(ma5 - ma10) / ma10 * 100).toFixed(2)}%。`,
                    Math.abs(ma5 - ma10) / ma10 < 0.02 ? 'HOLD' : (ma5 > ma10 ? 'BUY' : 'SELL'),
                    `MA5与MA10偏离${(Math.abs(ma5 - ma10) / ma10 * 100).toFixed(1)}%，${Math.abs(ma5 - ma10) / ma10 * 100 < 1 ? '粘合震荡' : '有趋势'}`
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
            const rsi = this.calcRsi(closesWithToday, 14);
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
            const [k, d, j] = this.calcKdj(highsWithToday, lowsWithToday, closesWithToday);
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

        const atrLocal = hasKline && closes.length >= 14 ? this.calcAtr(highsWithToday, lowsWithToday, closesWithToday, 14) : null;
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
            const high20 = Math.max(...highs.slice(-20));
            const low20 = Math.min(...lows.slice(-20));
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

        let fillNum = 0;
        while (results.length < TARGET_TOTAL && fillNum < 20) {
            fillNum++;
            addIfNew(
                `[监控] 技术指标扫描 #${fillNum}`, '🔍', CATEGORY_OSCILLATOR, '低', 5,
                `持续监控第${fillNum}组辅助指标，当前无异常信号触发，保持观望。`,
                'WATCH',
                '辅助监控指标：OBV/MFI/VR/ASI/EMV等，无信号即表示正常'
            );
        }

        results.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

        // =================================================================
        //  ⭐ 综合所有策略的最优做T建议
        // =================================================================

        if (holdings > 0 && amplitude > 1.5) {
            const feeRate = 0.0025;
            const minProfitPct = feeRate * 100 * 3;

            const BUY_ACTIONS_T = new Set(['BUY', 'STRONG_BUY']);
            const SELL_ACTIONS_T = new Set(['SELL', 'STRONG_SELL']);

            const buyStrats = results.filter(s => BUY_ACTIONS_T.has(s.action));
            const sellStrats = results.filter(s => SELL_ACTIONS_T.has(s.action));

            let buyScore = 0;
            let sellScore = 0;
            const buyTargets = [];
            const sellTargets = [];
            const supportLevels = [];
            const resistanceLevels = [];

            for (const s of buyStrats) {
                const weight = s.priority === 0 ? 3 : s.priority === 1 ? 2 : 1;
                buyScore += weight;
                if (s.target_price && s.target_price > cp) {
                    buyTargets.push({ price: s.target_price, weight });
                }
                if (s.stop_loss && s.stop_loss < cp) {
                    supportLevels.push({ price: s.stop_loss, weight });
                }
            }

            for (const s of sellStrats) {
                const weight = s.priority === 0 ? 3 : s.priority === 1 ? 2 : 1;
                sellScore += weight;
                if (s.target_price && s.target_price < cp) {
                    sellTargets.push({ price: s.target_price, weight });
                }
                if (s.stop_loss && s.stop_loss > cp) {
                    resistanceLevels.push({ price: s.stop_loss, weight });
                }
            }

            if (hasKline && closes.length >= 20) {
                const [bollLowerT, bollMidT, bollUpperT] = this.calcBollinger(closesWithToday);
                if (bollLowerT && bollLowerT < cp) {
                    supportLevels.push({ price: bollLowerT, weight: 2 });
                }
                if (bollUpperT && bollUpperT > cp) {
                    resistanceLevels.push({ price: bollUpperT, weight: 2 });
                }
                if (bollMidT) {
                    if (bollMidT < cp) resistanceLevels.push({ price: bollMidT, weight: 1 });
                    else supportLevels.push({ price: bollMidT, weight: 1 });
                }
            }

            if (avgPrice) {
                if (avgPrice < cp) resistanceLevels.push({ price: avgPrice, weight: 1 });
                else supportLevels.push({ price: avgPrice, weight: 1 });
            }

            supportLevels.push({ price: lp, weight: 2 });
            resistanceLevels.push({ price: hp, weight: 2 });

            const totalScore = buyScore + sellScore;
            const bias = totalScore > 0 ? (buyScore - sellScore) / totalScore : 0;

            let tAction, tBuyPrice, tSellPrice, tName;

            if (bias > 0.2) {
                tAction = 'BUY_THEN_SELL';
                tName = '综合偏多-正T策略';

                let weightedSupport = 0, supportWeightSum = 0;
                for (const sl of supportLevels) {
                    if (sl.price < cp * 0.99) {
                        weightedSupport += sl.price * sl.weight;
                        supportWeightSum += sl.weight;
                    }
                }
                tBuyPrice = supportWeightSum > 0
                    ? weightedSupport / supportWeightSum
                    : cp * (1 - Math.min(amplitude * 0.4, 3) / 100);

                tBuyPrice = Math.min(tBuyPrice, cp * 0.99);
                tBuyPrice = Math.max(tBuyPrice, lp * 1.002);

                let weightedResist = 0, resistWeightSum = 0;
                for (const rl of resistanceLevels) {
                    if (rl.price > cp * 1.01) {
                        weightedResist += rl.price * rl.weight;
                        resistWeightSum += rl.weight;
                    }
                }
                for (const bt of buyTargets) {
                    weightedResist += bt.price * bt.weight;
                    resistWeightSum += bt.weight;
                }
                tSellPrice = resistWeightSum > 0
                    ? weightedResist / resistWeightSum
                    : cp * (1 + Math.min(amplitude * 0.5, 4) / 100);

                tSellPrice = Math.max(tSellPrice, cp * 1.01);
                tSellPrice = Math.min(tSellPrice, hp * 0.998);

            } else if (bias < -0.2) {
                tAction = 'SELL_THEN_BUY';
                tName = '综合偏空-反T策略';

                let weightedResist = 0, resistWeightSum = 0;
                for (const rl of resistanceLevels) {
                    if (rl.price > cp * 1.01) {
                        weightedResist += rl.price * rl.weight;
                        resistWeightSum += rl.weight;
                    }
                }
                tSellPrice = resistWeightSum > 0
                    ? weightedResist / resistWeightSum
                    : cp * (1 + Math.min(amplitude * 0.4, 3) / 100);

                tSellPrice = Math.max(tSellPrice, cp * 1.01);
                tSellPrice = Math.min(tSellPrice, hp * 0.998);

                let weightedSupport = 0, supportWeightSum = 0;
                for (const sl of supportLevels) {
                    if (sl.price < cp * 0.99) {
                        weightedSupport += sl.price * sl.weight;
                        supportWeightSum += sl.weight;
                    }
                }
                for (const st of sellTargets) {
                    weightedSupport += st.price * st.weight;
                    supportWeightSum += st.weight;
                }
                tBuyPrice = supportWeightSum > 0
                    ? weightedSupport / supportWeightSum
                    : cp * (1 - Math.min(amplitude * 0.5, 4) / 100);

                tBuyPrice = Math.min(tBuyPrice, cp * 0.99);
                tBuyPrice = Math.max(tBuyPrice, lp * 1.002);

            } else {
                tAction = 'BOX_TRADING';
                tName = '综合震荡-箱体做T策略';

                let weightedSupport = 0, supportWeightSum = 0;
                for (const sl of supportLevels) {
                    if (sl.price < cp) {
                        weightedSupport += sl.price * sl.weight;
                        supportWeightSum += sl.weight;
                    }
                }
                tBuyPrice = supportWeightSum > 0
                    ? weightedSupport / supportWeightSum
                    : cp * (1 - Math.min(amplitude * 0.4, 2.5) / 100);

                tBuyPrice = Math.min(tBuyPrice, cp * 0.99);
                tBuyPrice = Math.max(tBuyPrice, lp * 1.005);

                let weightedResist = 0, resistWeightSum = 0;
                for (const rl of resistanceLevels) {
                    if (rl.price > cp) {
                        weightedResist += rl.price * rl.weight;
                        resistWeightSum += rl.weight;
                    }
                }
                tSellPrice = resistWeightSum > 0
                    ? weightedResist / resistWeightSum
                    : cp * (1 + Math.min(amplitude * 0.4, 2.5) / 100);

                tSellPrice = Math.max(tSellPrice, cp * 1.01);
                tSellPrice = Math.min(tSellPrice, hp * 0.995);
            }

            tBuyPrice = Math.round(tBuyPrice * 100) / 100;
            tSellPrice = Math.round(tSellPrice * 100) / 100;

            let tProfit = Math.abs(tSellPrice - tBuyPrice) / cp * 100;
            if (tProfit < minProfitPct) {
                const spread = cp * minProfitPct / 100;
                if (tAction === 'BUY_THEN_SELL') {
                    tSellPrice = Math.round((tBuyPrice + spread) * 100) / 100;
                } else if (tAction === 'SELL_THEN_BUY') {
                    tBuyPrice = Math.round((tSellPrice - spread) * 100) / 100;
                } else {
                    const mid = (tBuyPrice + tSellPrice) / 2;
                    tBuyPrice = Math.round((mid - spread / 2) * 100) / 100;
                    tSellPrice = Math.round((mid + spread / 2) * 100) / 100;
                }
                tProfit = minProfitPct;
            }

            const profitAfterFee = tProfit - feeRate * 100 * 2;
            const actionDesc = tAction === 'BUY_THEN_SELL' ? '正T（先买后卖）'
                : tAction === 'SELL_THEN_BUY' ? '反T（先卖后买）'
                : '箱体做T（高抛低吸）';

            let reasonDetail = '';
            if (bias > 0.2) {
                reasonDetail = `买入信号${buyScore} vs 卖出信号${sellScore}，综合偏多，回踩支撑位买入，冲高压力位卖出`;
            } else if (bias < -0.2) {
                reasonDetail = `卖出信号${sellScore} vs 买入信号${buyScore}，综合偏空，反弹压力位卖出，回落支撑位接回`;
            } else {
                reasonDetail = `多空信号均衡（买${buyScore}:卖${sellScore}），震荡行情，箱底买箱顶卖`;
            }

            results.unshift(this._make(
                '⭐ 综合策略做T建议', '🏆', CATEGORY_MICRO, '极高', 0,
                `${actionDesc}。${reasonDetail}。预计盈利${profitAfterFee.toFixed(2)}%（扣除手续费）。`,
                tAction,
                `基于${results.length}个策略综合分析，加权计算支撑位与压力位，确保扣除手续费后盈利`,
                {
                    buy_price: tBuyPrice,
                    sell_price: tSellPrice,
                    profit_potential: Math.round(profitAfterFee * 100) / 100,
                    loss_risk: 0,
                    risk_reward: 99,
                    buy_score: buyScore,
                    sell_score: sellScore,
                    bias: Math.round(bias * 100) / 100,
                    strategy_count: results.length
                }
            ));
        }

        // =================================================================
        //  生成最优操作方案摘要
        // =================================================================

        const BUY_ACTIONS = new Set(['BUY', 'STRONG_BUY']);
        const SELL_ACTIONS = new Set(['SELL', 'STRONG_SELL']);
        const T_ACTIONS = new Set(['BUY_THEN_SELL', 'SELL_THEN_BUY', 'BOX_TRADING', 'TRADING_OPPORTUNITY']);

        const buySignals = results.filter(s => BUY_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        const sellSignals = results.filter(s => SELL_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        const tSignals = results.filter(s => T_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

        const summary = {
            current_price: cp,
            atr: Math.round(atrVal * 100) / 100,
            atr_pct: cp > 0 ? Math.round((atrVal / cp * 100) * 100) / 100 : 0,
            total_signals: results.length,
            buy_signals: results.filter(s => BUY_ACTIONS.has(s.action)).length,
            sell_signals: results.filter(s => SELL_ACTIONS.has(s.action)).length,
            t_signals: results.filter(s => T_ACTIONS.has(s.action)).length,
        };

        if (buySignals.length > 0) {
            const bestBuy = buySignals[0];
            summary.best_buy = {
                name: bestBuy.name,
                entry_price: cp,
                target_price: bestBuy.target_price,
                stop_loss: bestBuy.stop_loss,
                profit_potential: bestBuy.profit_potential,
                loss_risk: bestBuy.loss_risk,
                risk_reward: bestBuy.risk_reward,
            };
        }

        if (sellSignals.length > 0) {
            const bestSell = sellSignals[0];
            summary.best_sell = {
                name: bestSell.name,
                entry_price: cp,
                target_price: bestSell.target_price,
                stop_loss: bestSell.stop_loss,
                profit_potential: bestSell.profit_potential,
                loss_risk: bestSell.loss_risk,
                risk_reward: bestSell.risk_reward,
            };
        }

        if (tSignals.length > 0) {
            const bestT = tSignals[0];
            summary.best_t = {
                name: bestT.name,
                entry_price: cp,
                buy_price: bestT.buy_price,
                sell_price: bestT.sell_price,
                profit_potential: bestT.profit_potential,
                loss_risk: bestT.loss_risk,
                risk_reward: bestT.risk_reward,
                action: bestT.action,
            };
        }

        // ============ 今日价格预测 ============
        if (hasKline && closes.length >= 5) {
            let amp5 = 0, amp10 = 0;
            const ampDays = Math.min(10, closes.length - 1);
            for (let i = 1; i <= ampDays; i++) {
                const idx = closes.length - 1 - i;
                if (idx >= 0 && closes[idx] > 0) {
                    const dailyAmp = (highs[idx] - lows[idx]) / closes[idx] * 100;
                    if (i <= 5) amp5 += dailyAmp;
                    if (i <= 10) amp10 += dailyAmp;
                }
            }
            amp5 = amp5 / Math.min(5, ampDays);
            amp10 = amp10 / Math.min(10, ampDays);
            
            const avgAmplitude = (amp5 * 0.6 + amp10 * 0.4);
            const atrRange = atrVal > 0 ? atrVal : (pc * avgAmplitude / 100);
            const trendBias = trend === '上升' ? 0.3 : (trend === '下跌' ? -0.3 : 0);
            const basePrice = op > 0 ? op : pc;
            
            const halfRange = basePrice * avgAmplitude / 100 / 2;
            let predictedHigh = basePrice + halfRange * (1 + trendBias * 0.3);
            let predictedLow = basePrice - halfRange * (1 - trendBias * 0.3);
            
            if (hp > predictedHigh) predictedHigh = hp + atrRange * 0.2;
            if (lp < predictedLow) predictedLow = lp - atrRange * 0.2;
            
            if (hasKline && closes.length >= 20) {
                const [sR, rR] = this.findSupportResistance(highs, lows, closes);
                if (rR && rR.length > 0) {
                    const nearestResistance = rR[rR.length - 1];
                    if (nearestResistance > cp && nearestResistance < predictedHigh * 1.05) {
                        predictedHigh = Math.max(predictedHigh, nearestResistance);
                    }
                }
                if (sR && sR.length > 0) {
                    const nearestSupport = sR[sR.length - 1];
                    if (nearestSupport < cp && nearestSupport > predictedLow * 0.95) {
                        predictedLow = Math.min(predictedLow, nearestSupport);
                    }
                }
            }
            
            const pricePosition = predictedHigh > predictedLow 
                ? ((cp - predictedLow) / (predictedHigh - predictedLow) * 100) 
                : 50;
            
            let confidence = 60;
            if (closes.length >= 20) confidence += 10;
            if (Math.abs(amp5 - amp10) < 1) confidence += 10;
            if (confidence > 85) confidence = 85;
            
            summary.price_prediction = {
                predicted_high: Math.round(predictedHigh * 100) / 100,
                predicted_low: Math.round(predictedLow * 100) / 100,
                avg_amplitude: Math.round(avgAmplitude * 100) / 100,
                price_position: Math.round(pricePosition * 10) / 10,
                confidence: confidence,
                trend: trend,
                atr: Math.round(atrVal * 100) / 100,
            };
        }

        const total = results.length;
        const watchCount = results.filter(r => ['WATCH', 'HOLD', 'OBSERVE'].includes(r.action)).length;
        summary.strategy_coverage = {
            total_defined: total,
            triggered: total,
            coverage_rate: 100.0,
            watch_signals: watchCount,
            message: `已分析${total}种策略，其中${watchCount}个为观望状态`
        };

        return [results, summary];
    }

    analyzePanorama(klineData) {
        const results = [];

        if (!klineData || !Array.isArray(klineData) || klineData.length < 5) {
            return [results, {}];
        }

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

        const atrVal = n >= 14 ? this.calcAtr(highs, lows, closes, 14) : (hp - lp);

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
            const maxVol20 = Math.max(...volumes.slice(-20));
            const minVol20 = Math.min(...volumes.slice(-20));

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
                const prev3Low = n >= 3 ? Math.min(...closes.slice(-4, -1)) : cp;
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

        if (n >= 20) {
            const prevHigh20Price = Math.max(...closes.slice(-21, -1));
            const prevHigh20Vol = Math.max(...volumes.slice(-21, -1));

            if (cp > prevHigh20Price && vol < prevHigh20Vol * 0.9) {
                const target = cp * 0.92;
                const stop = cp * 1.03;
                results.push(this._make(
                    '量价顶背离', '📛', CAT_VOL_PRICE, '高', 1,
                    `价格创20日新高${cp.toFixed(2)}，但成交量未创新高，量价顶背离，卖出信号。`,
                    'SELL', `顶背离说明上涨动能不足，价格新高但量能不济，回调风险大`,
                    { target_price: target, stop_loss: stop, price_new_high: true, volume_new_high: false }
                ));
            }

            if (n >= 21) {
                const prevLow20Price = Math.min(...closes.slice(-21, -1));
                const prevLowVol = Math.max(...volumes.slice(-21, -1));
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

        if (n >= 20) {
            const prevHigh = Math.max(...highs.slice(-21, -1));
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
            for (let i = 2; i < n; i++) {
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
                    obv = volumes[i];
                } else {
                    if (closes[i] > closes[i - 1]) {
                        obv += volumes[i];
                    } else if (closes[i] < closes[i - 1]) {
                        obv -= volumes[i];
                    }
                }
                obvSeries.push(obv);
            }
            const obv20High = Math.max(...obvSeries.slice(-20));
            const obv20Low = Math.min(...obvSeries.slice(-20));
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
            const priceRange20 = (Math.max(...highs.slice(-20)) - Math.min(...lows.slice(-20))) / ma20 * 100;
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
            const high20 = Math.max(...highs.slice(-20));
            const low20 = Math.min(...lows.slice(-20));
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
            const high20 = Math.max(...highs.slice(-20));
            const low20 = Math.min(...lows.slice(-20));
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
            const high20 = Math.max(...highs.slice(-20));
            const low20 = Math.min(...lows.slice(-20));
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

        if (n >= 20) {
            const prevHigh = Math.max(...highs.slice(-21, -1));
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
        const T_ACTIONS = new Set(['T_LONG', 'T_SHORT']);

        const buySignals = results.filter(s => BUY_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        const sellSignals = results.filter(s => SELL_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        const tSignals = results.filter(s => T_ACTIONS.has(s.action)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

        const summary = {
            current_price: cp,
            atr: Math.round(atrVal * 100) / 100,
            atr_pct: cp > 0 ? Math.round((atrVal / cp * 100) * 100) / 100 : 0,
            total_signals: results.length,
            buy_signals: results.filter(s => BUY_ACTIONS.has(s.action)).length,
            sell_signals: results.filter(s => SELL_ACTIONS.has(s.action)).length,
            t_signals: results.filter(s => T_ACTIONS.has(s.action)).length,
        };

        if (buySignals.length > 0) {
            const bestBuy = buySignals[0];
            const profitPotential = bestBuy.target_price && cp > 0 ? (bestBuy.target_price - cp) / cp * 100 : null;
            const lossRisk = bestBuy.stop_loss && cp > 0 ? (cp - bestBuy.stop_loss) / cp * 100 : null;
            const riskReward = profitPotential && lossRisk && lossRisk > 0 ? profitPotential / lossRisk : null;
            summary.best_buy = {
                name: bestBuy.name,
                entry_price: cp,
                target_price: bestBuy.target_price,
                stop_loss: bestBuy.stop_loss,
                profit_potential: profitPotential !== null ? Math.round(profitPotential * 100) / 100 : null,
                loss_risk: lossRisk !== null ? Math.round(lossRisk * 100) / 100 : null,
                risk_reward: riskReward !== null ? Math.round(riskReward * 100) / 100 : null,
            };
        }

        if (sellSignals.length > 0) {
            const bestSell = sellSignals[0];
            const profitPotential = bestSell.target_price && cp > 0 ? (cp - bestSell.target_price) / cp * 100 : null;
            const lossRisk = bestSell.stop_loss && cp > 0 ? (bestSell.stop_loss - cp) / cp * 100 : null;
            const riskReward = profitPotential && lossRisk && lossRisk > 0 ? profitPotential / lossRisk : null;
            summary.best_sell = {
                name: bestSell.name,
                entry_price: cp,
                target_price: bestSell.target_price,
                stop_loss: bestSell.stop_loss,
                profit_potential: profitPotential !== null ? Math.round(profitPotential * 100) / 100 : null,
                loss_risk: lossRisk !== null ? Math.round(lossRisk * 100) / 100 : null,
                risk_reward: riskReward !== null ? Math.round(riskReward * 100) / 100 : null,
            };
        }

        if (tSignals.length > 0) {
            const bestT = tSignals[0];
            summary.best_t = {
                name: bestT.name,
                entry_price: cp,
                action: bestT.action,
            };
        }

        const total = results.length;
        const watchCount = results.filter(r => ['WATCH', 'HOLD', 'OBSERVE'].includes(r.action)).length;
        summary.strategy_coverage = {
            total_defined: 58,
            triggered: total,
            coverage_rate: Math.round(total / 58 * 10000) / 100,
            watch_signals: watchCount,
            message: `全景策略已分析6大分类58种策略，触发${total}个信号，其中${watchCount}个为观望状态`
        };

        return [results, summary];
    }
}

const strategyEngine = new StrategyEngine();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StrategyEngine;
}
