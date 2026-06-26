let _currentStock = null;
let _watchList = [];
let _trades = [];
let _lastStrategies = [];
let _lastSummary = {};
let _searchHistory = [];
let _stockNames = {};
let _searchTimer = null;
let _activeCategory = '全部';

async function httpGet(url) {
    try {
        if (window.Capacitor && window.Capacitor.Http) {
            const response = await Capacitor.Http.get({ url });
            return JSON.parse(response.data);
        }
    } catch (e) {
        console.log('Capacitor HTTP not available, using fetch');
    }
    
    const response = await fetch(url, { mode: 'cors' });
    return await response.json();
}

function getTencentPrefix(code) {
    if (code.startsWith('6') || code.startsWith('9')) return 'sh';
    if (code.startsWith('0') || code.startsWith('3') || code.startsWith('2')) return 'sz';
    return 'sh';
}

function init() {
    loadWatchList();
    loadTrades();
    loadSearchHistory();
    renderWatchList();
    renderTrades();
    renderSearchHistory();
    refreshProfit();
    
    if (typeof strategyEngine === 'undefined') {
        console.error('StrategyEngine not loaded');
    }
    
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.search-wrapper') && !e.target.closest('.search-box')) {
            document.querySelectorAll('.search-suggestions').forEach(el => el.style.display = 'none');
        }
    });
}

function showToast(msg, duration = 2000) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
}

function openModal(title, content) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalBody').innerHTML = content;
    document.getElementById('strategyModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('strategyModal').style.display = 'none';
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const tab = document.getElementById('tab-' + tabName);
    if (tab) tab.classList.add('active');
    
    const btns = document.querySelectorAll('.tab-btn');
    const tabMap = { home: 0, trade: 2, strategy: 1, news: 3 };
    if (btns[tabMap[tabName]]) btns[tabMap[tabName]].classList.add('active');
    
    if (tabName === 'home') {
        refreshProfit();
        renderWatchList();
    }
    else if (tabName === 'trade') {
        loadTrades();
        renderTrades();
    }
    else if (tabName === 'strategy') {
        loadSearchHistory();
    }
    else if (tabName === 'news') {
        loadSearchHistory();
    }
}

function onSearchInput() {
    renderSearchHistory();
}

// ==================== 搜索建议 ====================
function setupSearchSuggestions(inputId, suggestionsId, onSelect) {
    const input = document.getElementById(inputId);
    const sug = document.getElementById(suggestionsId);
    if (!input || !sug) return;
    
    input.addEventListener('input', function () {
        clearTimeout(_searchTimer);
        const kw = this.value.trim();
        if (!kw) { sug.style.display = 'none'; return; }
        _searchTimer = setTimeout(async () => {
            try {
                const results = await searchStockByName(kw);
                if (results.length > 0) {
                    sug.innerHTML = results.map(item => `
                        <div class="suggestion-item" data-code="${item.code}" data-name="${item.name}">
                            <span class="suggestion-code">${item.code}</span>
                            <span class="suggestion-name">${item.name}</span>
                        </div>
                    `).join('');
                    sug.style.display = 'block';
                    sug.querySelectorAll('.suggestion-item').forEach(el => {
                        el.addEventListener('click', () => {
                            onSelect(el.dataset.code, el.dataset.name);
                            sug.style.display = 'none';
                        });
                    });
                } else {
                    sug.innerHTML = '<div class="suggestion-item" style="justify-content:center;color:var(--text-muted);">未找到</div>';
                    sug.style.display = 'block';
                }
            } catch (e) { console.error('搜索失败:', e); }
        }, 250);
    });
}

// 首页搜索
function onHomeSearchInput() {
    const kw = document.getElementById('searchInput').value.trim();
    if (!kw) {
        renderSearchHistory();
        document.getElementById('homeSearchSuggestions').style.display = 'none';
        return;
    }
    
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
        try {
            const results = await searchStockByName(kw);
            const sug = document.getElementById('homeSearchSuggestions');
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${item.code}" data-name="${item.name}">
                        <span class="suggestion-code">${item.code}</span>
                        <span class="suggestion-name">${item.name}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', () => {
                        goToStockDetail(el.dataset.code, el.dataset.name);
                        sug.style.display = 'none';
                    });
                });
            } else {
                sug.innerHTML = '<div class="suggestion-item" style="justify-content:center;color:var(--text-muted);">未找到</div>';
                sug.style.display = 'block';
            }
        } catch (e) { console.error(e); }
    }, 250);
}

function goToStockDetail(code, name) {
    document.getElementById('searchInput').value = code;
    _stockNames[code] = name;
    doSearch();
    saveSearchHistory(code, name);
    document.getElementById('homeSearchSuggestions').style.display = 'none';
}

// 交易页搜索
function onTradeCodeInput() {
    const kw = document.getElementById('stockCode').value.trim();
    if (!kw) { document.getElementById('codeSuggestions').style.display = 'none'; return; }
    
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
        try {
            const results = await searchStockByName(kw);
            const sug = document.getElementById('codeSuggestions');
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${item.code}" data-name="${item.name}">
                        <span class="suggestion-code">${item.code}</span>
                        <span class="suggestion-name">${item.name}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', () => {
                        selectStock(el.dataset.code, el.dataset.name);
                        sug.style.display = 'none';
                    });
                });
            } else {
                sug.style.display = 'none';
            }
        } catch (e) { console.error(e); }
    }, 250);
}

function onTradeNameInput() {
    const kw = document.getElementById('stockName').value.trim();
    if (!kw) { document.getElementById('nameSuggestions').style.display = 'none'; return; }
    
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
        try {
            const results = await searchStockByName(kw);
            const sug = document.getElementById('nameSuggestions');
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${item.code}" data-name="${item.name}">
                        <span class="suggestion-code">${item.code}</span>
                        <span class="suggestion-name">${item.name}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', () => {
                        selectStock(el.dataset.code, el.dataset.name);
                        sug.style.display = 'none';
                    });
                });
            } else {
                sug.style.display = 'none';
            }
        } catch (e) { console.error(e); }
    }, 250);
}

function selectStock(code, name) {
    document.getElementById('stockCode').value = code;
    document.getElementById('stockName').value = name;
    _stockNames[code] = name;
    document.querySelectorAll('.search-suggestions').forEach(el => el.style.display = 'none');
}

// 策略页搜索
function onStrategySearchInput() {
    const kw = document.getElementById('strategyInput').value.trim();
    if (!kw) {
        loadSearchHistory();
        document.getElementById('strategySuggestions').style.display = 'none';
        return;
    }
    
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
        try {
            const results = await searchStockByName(kw);
            const sug = document.getElementById('strategySuggestions');
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${item.code}" data-name="${item.name}">
                        <span class="suggestion-code">${item.code}</span>
                        <span class="suggestion-name">${item.name}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', () => {
                        document.getElementById('strategyInput').value = el.dataset.code;
                        _stockNames[el.dataset.code] = el.dataset.name;
                        loadStrategyDetail();
                        saveSearchHistory(el.dataset.code, el.dataset.name);
                        sug.style.display = 'none';
                    });
                });
            } else {
                sug.innerHTML = '<div class="suggestion-item" style="justify-content:center;color:var(--text-muted);">未找到</div>';
                sug.style.display = 'block';
            }
        } catch (e) { console.error(e); }
    }, 250);
}

// 舆情页搜索
function onNewsSearchInput() {
    const kw = document.getElementById('newsInput').value.trim();
    if (!kw) {
        loadSearchHistory();
        document.getElementById('newsSuggestions').style.display = 'none';
        return;
    }
    
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
        try {
            const results = await searchStockByName(kw);
            const sug = document.getElementById('newsSuggestions');
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${item.code}" data-name="${item.name}">
                        <span class="suggestion-code">${item.code}</span>
                        <span class="suggestion-name">${item.name}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', () => {
                        document.getElementById('newsInput').value = el.dataset.code;
                        _stockNames[el.dataset.code] = el.dataset.name;
                        loadNews();
                        saveSearchHistory(el.dataset.code, el.dataset.name);
                        sug.style.display = 'none';
                    });
                });
            } else {
                sug.innerHTML = '<div class="suggestion-item" style="justify-content:center;color:var(--text-muted);">未找到</div>';
                sug.style.display = 'block';
            }
        } catch (e) { console.error(e); }
    }, 250);
}

async function doSearch() {
    const input = document.getElementById('searchInput').value.trim();
    if (!input) {
        showToast('请输入股票代码或名称');
        return;
    }

    try {
        let code = input;
        if (!/^\d{6}$/.test(input)) {
            const searchResult = await searchStockByName(input);
            if (searchResult && searchResult.length > 0) {
                code = searchResult[0].code;
            } else {
                showToast('未找到股票，请输入正确代码');
                return;
            }
        }

        await loadStockInfo(code);
        addToSearchHistory(code);
        renderSearchHistory();
    } catch (e) {
        console.error(e);
        showToast('搜索失败：' + e.message);
    }
}

async function searchStockByName(name) {
    const url = `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(name)}&t=all&p=1&o=0&n=10`;
    try {
        const response = await fetch(url, { mode: 'cors' });
        const text = await response.text();
        const jsonStr = text.replace(/^v_hint\(|\)$/g, '');
        const data = JSON.parse(jsonStr);
        const results = [];
        if (data && data.data) {
            for (const item of data.data) {
                if (item && item.length >= 3) {
                    results.push({ code: item[0], name: item[1] });
                }
            }
        }
        return results;
    } catch (e) {
        console.error(e);
        return [];
    }
}

async function loadStockInfo(code) {
    try {
        const prefix = getTencentPrefix(code);
        const fullCode = `${prefix}${code}`;
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,1,qfq`;
        const data = await httpGet(url);
        
        if (data.code !== 0 || !data.data || !data.data[fullCode]) {
            showToast('获取行情失败，请检查股票代码');
            return;
        }

        const stockData = data.data[fullCode];
        const qt = stockData.qt?.[fullCode];
        if (!qt || qt.length < 38) {
            showToast('获取行情失败');
            return;
        }

        _currentStock = {
            code: qt[2],
            name: qt[1],
            current_price: parseFloat(qt[3]) || 0,
            prev_close: parseFloat(qt[4]) || 0,
            open_price: parseFloat(qt[5]) || 0,
            volume: parseFloat(qt[36]) * 100 || 0,
            amount: parseFloat(qt[37]) * 10000 || 0,
            change_amount: parseFloat(qt[31]) || 0,
            change_percent: parseFloat(qt[32]) || 0,
            high_price: parseFloat(qt[33]) || 0,
            low_price: parseFloat(qt[34]) || 0,
            turnover: parseFloat(qt[38]) || 0
        };

        renderStockInfo();
        await loadKlineData(code);
    } catch (e) {
        console.error(e);
        showToast('获取行情失败：' + e.message);
    }
}

function renderStockInfo() {
    if (!_currentStock) return;
    
    const emptyHome = document.getElementById('emptyHome');
    const marketSection = document.getElementById('marketSection');
    if (emptyHome) emptyHome.style.display = 'none';
    if (marketSection) marketSection.style.display = 'block';
    
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };
    
    setText('marketName', _currentStock.name);
    setText('marketCode', _currentStock.code);
    setText('marketPrice', _currentStock.current_price.toFixed(2));
    
    const changeEl = document.getElementById('marketChange');
    const changeVal = _currentStock.change_percent;
    if (changeEl) {
        changeEl.innerText = (changeVal >= 0 ? '+' : '') + changeVal.toFixed(2) + '%';
        changeEl.className = 'market-hero-change ' + (changeVal >= 0 ? 'up' : 'down');
    }
    
    setText('marketOpen', _currentStock.open_price.toFixed(2));
    setText('marketHigh', _currentStock.high_price.toFixed(2));
    setText('marketLow', _currentStock.low_price.toFixed(2));
    setText('marketPreClose', _currentStock.prev_close.toFixed(2));
    setText('marketVolume', formatVolume(_currentStock.volume));
    setText('marketTurnover', _currentStock.turnover.toFixed(2) + '%');
}

function formatVolume(vol) {
    if (vol >= 100000000) return (vol / 100000000).toFixed(2) + '亿';
    if (vol >= 10000) return (vol / 10000).toFixed(2) + '万';
    return vol.toFixed(0);
}

async function loadKlineData(code) {
    try {
        const prefix = getTencentPrefix(code);
        const fullCode = `${prefix}${code}`;
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,120,qfq`;
        const data = await httpGet(url);
        
        if (data.code !== 0 || !data.data || !data.data[fullCode]) {
            showToast('获取K线数据失败');
            return;
        }

        const klineArray = data.data[fullCode].qfqday || data.data[fullCode].day || [];
        if (klineArray.length === 0) {
            showToast('获取K线数据失败');
            return;
        }

        const klines = klineArray.map(k => ({
            date: k[0],
            open: parseFloat(k[1]),
            close: parseFloat(k[2]),
            high: parseFloat(k[3]),
            low: parseFloat(k[4]),
            volume: parseFloat(k[5]) * 100,
            amount: k[6] ? parseFloat(k[6]) * 10000 : 0
        }));

        await runStrategyAnalysis(klines);
    } catch (e) {
        console.error(e);
        showToast('获取K线数据失败：' + e.message);
    }
}

async function runStrategyAnalysis(klines) {
    if (!_currentStock || !strategyEngine) return;
    
    const holdings = getHoldings(_currentStock.code);
    const [strategies, summary] = strategyEngine.runAllStrategies(_currentStock, klines, holdings);
    
    _lastStrategies = strategies;
    _lastSummary = summary;
    window._lastStrategies = strategies;
    renderSignalPanel(strategies);
    renderStrategySummary(strategies);
    renderBestPlan(summary);
    renderCoreAdvice(_currentStock, strategies);
    
    const strategyDetailSection = document.getElementById('strategyDetailSection');
    if (strategyDetailSection) {
        strategyDetailSection.style.display = 'block';
        renderStrategyDetailSection(strategies);
    }
    
    const emptyStrategy = document.getElementById('emptyStrategy');
    if (emptyStrategy) emptyStrategy.style.display = 'none';
    
    refreshProfit();
}

function renderSignalPanel(strategies) {
    const buyCount = strategies.filter(s => s.action.includes('BUY')).length;
    const sellCount = strategies.filter(s => s.action.includes('SELL')).length;
    const tCount = strategies.filter(s => s.action.includes('TRADING_OPPORTUNITY') || s.action.includes('BUY_THEN_SELL') || s.action.includes('SELL_THEN_BUY')).length;
    
    let mainText = '等待分析';
    let detailText = '';
    
    if (tCount > 0) {
        mainText = `⚡ 发现 ${tCount} 个做T机会`;
        detailText = '当前股价处于波动区间，适合做T操作';
    } else if (buyCount > sellCount) {
        mainText = `📈 买入信号占优 (${buyCount}:${sellCount})`;
        detailText = '多个指标显示看涨，建议关注买入时机';
    } else if (sellCount > buyCount) {
        mainText = `📉 卖出信号占优 (${sellCount}:${buyCount})`;
        detailText = '多个指标显示看跌，建议关注卖出时机';
    } else {
        mainText = '📊 多空平衡';
        detailText = '指标信号相互抵消，建议观望';
    }
    
    const mainTextEl = document.getElementById('signalMainText');
    const detailTextEl = document.getElementById('signalDetailText');
    if (mainTextEl) mainTextEl.innerText = mainText;
    if (detailTextEl) detailTextEl.innerText = detailText;
    
    if (_currentStock) {
        const pressure = _currentStock.high_price * 1.01;
        const support = _currentStock.low_price * 0.99;
        const pressureEl = document.getElementById('signalPressure');
        const supportEl = document.getElementById('signalSupport');
        if (pressureEl) pressureEl.innerText = pressure.toFixed(2);
        if (supportEl) supportEl.innerText = support.toFixed(2);
    }
}

function renderStrategySummary(strategies) {
    const buyCount = strategies.filter(s => s.action.includes('BUY')).length;
    const sellCount = strategies.filter(s => s.action.includes('SELL')).length;
    const tCount = strategies.filter(s => s.action.includes('TRADING_OPPORTUNITY') || s.action.includes('BUY_THEN_SELL') || s.action.includes('SELL_THEN_BUY')).length;
    const watchCount = strategies.filter(s => ['WATCH', 'HOLD', 'OBSERVE'].includes(s.action)).length;
    
    const container = document.getElementById('strategySummary');
    if (!container) return;
    container.innerHTML = `
        <div class="summary-chip" onclick="filterStrategies('buy')"><span class="dot red"></span>买入 ${buyCount}</div>
        <div class="summary-chip" onclick="filterStrategies('sell')"><span class="dot green"></span>卖出 ${sellCount}</div>
        <div class="summary-chip" onclick="filterStrategies('t')"><span class="dot yellow"></span>做T ${tCount}</div>
        <div class="summary-chip" onclick="filterStrategies('watch')"><span class="dot blue"></span>观望 ${watchCount}</div>
    `;
}

function renderBestPlan(summary) {
    const card = document.getElementById('bestPlanCard');
    if (!card || !summary) return;
    
    card.style.display = 'block';
    
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };
    
    const setDisplay = (id, display) => {
        const el = document.getElementById(id);
        if (el) el.style.display = display;
    };
    
    setText('planAtr', summary.atr ? summary.atr.toFixed(2) : '--');
    setText('planAtrPct', summary.atr_pct ? summary.atr_pct.toFixed(2) + '%' : '--');
    setText('planTotal', summary.total_signals || '--');
    setText('planBuySell', `买${summary.buy_signals || 0} / 卖${summary.sell_signals || 0}`);
    
    if (summary.best_buy) {
        setDisplay('planBuySection', 'block');
        setText('planBuyName', summary.best_buy.name);
        setText('planBuyEntry', '￥' + (summary.best_buy.entry_price || summary.current_price || 0).toFixed(2));
        setText('planBuyTarget', '￥' + (summary.best_buy.target_price || 0).toFixed(2));
        setText('planBuyStop', '￥' + (summary.best_buy.stop_loss || 0).toFixed(2));
        setText('planBuyProfit', summary.best_buy.profit_potential ? '+' + summary.best_buy.profit_potential.toFixed(2) + '%' : '--');
        setText('planBuyRisk', summary.best_buy.loss_risk ? summary.best_buy.loss_risk.toFixed(2) + '%' : '--');
        setText('planBuyRatio', summary.best_buy.risk_reward ? summary.best_buy.risk_reward.toFixed(2) : '--');
    } else {
        setDisplay('planBuySection', 'none');
    }
    
    if (summary.best_sell) {
        setDisplay('planSellSection', 'block');
        setText('planSellName', summary.best_sell.name);
        setText('planSellEntry', '￥' + (summary.best_sell.entry_price || summary.current_price || 0).toFixed(2));
        setText('planSellTarget', '￥' + (summary.best_sell.target_price || 0).toFixed(2));
        setText('planSellStop', '￥' + (summary.best_sell.stop_loss || 0).toFixed(2));
        setText('planSellProfit', summary.best_sell.profit_potential ? '+' + summary.best_sell.profit_potential.toFixed(2) + '%' : '--');
        setText('planSellRisk', summary.best_sell.loss_risk ? summary.best_sell.loss_risk.toFixed(2) + '%' : '--');
        setText('planSellRatio', summary.best_sell.risk_reward ? summary.best_sell.risk_reward.toFixed(2) : '--');
    } else {
        setDisplay('planSellSection', 'none');
    }
    
    if (summary.best_t) {
        setDisplay('planTSection', 'block');
        setText('planTName', summary.best_t.name);
        const buyPrice = summary.best_t.buy_price || summary.current_price;
        const sellPrice = summary.best_t.sell_price || summary.current_price;
        setText('planTBuy', '￥' + buyPrice.toFixed(2));
        setText('planTSell', '￥' + sellPrice.toFixed(2));
        const spread = Math.abs(sellPrice - buyPrice);
        const spreadPct = (spread / summary.current_price * 100);
        setText('planTSpread', '￥' + spread.toFixed(2));
        setText('planTProfit', '+' + spreadPct.toFixed(2) + '%');
        const action = summary.best_t.action;
        let actionText = '正T';
        if (action === 'SELL_THEN_BUY') actionText = '反T';
        else if (action === 'BOX_TRADING') actionText = '箱体';
        setText('planTAction', actionText);
    } else {
        setDisplay('planTSection', 'none');
    }
}

function refreshAll() {
    if (_currentStock) {
        loadStockInfo(_currentStock.code);
        showToast('数据已刷新');
    } else {
        showToast('请先搜索股票');
    }
}

function loadWatchList() {
    const saved = localStorage.getItem('watchList');
    _watchList = saved ? JSON.parse(saved) : [];
}

function saveWatchList() {
    localStorage.setItem('watchList', JSON.stringify(_watchList));
}

function doSearchByCode(code) {
    document.getElementById('searchInput').value = code;
    doSearch();
}

function addToWatchlist() {
    if (!_currentStock) {
        showToast('请先搜索股票');
        return;
    }
    
    if (!_watchList.includes(_currentStock.code)) {
        _watchList.push(_currentStock.code);
        saveWatchList();
        renderWatchList();
        showToast('已加入监控');
    } else {
        showToast('已在监控列表中');
    }
}

function removeFromWatchlist(code) {
    _watchList = _watchList.filter(c => c !== code);
    saveWatchList();
    renderWatchList();
    showToast('已移除监控');
}

function loadSearchHistory() {
    const saved = localStorage.getItem('searchHistory');
    let h = saved ? JSON.parse(saved) : [];
    
    h = h.map(item => {
        if (typeof item === 'string') {
            return { code: item, name: item };
        }
        if (!item.name) {
            item.name = _stockNames[item.code] || item.code;
        }
        return item;
    });
    
    _searchHistory = h;
    
    const homeWrap = document.getElementById('searchHistoryWrap');
    const homeList = document.getElementById('searchHistory');
    const strategyWrap = document.getElementById('strategyHistory');
    const strategyList = document.getElementById('strategyHistoryList');
    const sentimentWrap = document.getElementById('sentimentHistory');
    const sentimentList = document.getElementById('sentimentHistoryList');
    
    const homeHtml = _searchHistory.length > 0 ? _searchHistory.map(item =>
        `<span class="history-tag" onclick="goToStockDetail('${item.code}','${item.name || item.code}')">${item.name || item.code}</span>`
    ).join('') : '';
    
    const strategyHtml = _searchHistory.length > 0 ? _searchHistory.map(item =>
        `<span class="history-tag" onclick="analyzeHistory('${item.code}','${item.name || item.code}')">${item.name || item.code}</span>`
    ).join('') : '';
    
    const sentimentHtml = _searchHistory.length > 0 ? _searchHistory.map(item =>
        `<span class="history-tag" onclick="loadSentimentByCode('${item.code}','${item.name || item.code}')">${item.name || item.code}</span>`
    ).join('') : '';
    
    if (homeWrap && homeList) {
        homeWrap.style.display = _searchHistory.length > 0 ? 'block' : 'none';
        homeList.innerHTML = homeHtml;
    }
    if (strategyWrap && strategyList) {
        strategyWrap.style.display = _searchHistory.length > 0 ? 'block' : 'none';
        strategyList.innerHTML = strategyHtml;
    }
    if (sentimentWrap && sentimentList) {
        sentimentWrap.style.display = _searchHistory.length > 0 ? 'block' : 'none';
        sentimentList.innerHTML = sentimentHtml;
    }
}

function saveSearchHistory(code, name) {
    let h = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    h = h.filter(i => i.code !== code);
    h.unshift({ code, name, time: Date.now() });
    h = h.slice(0, 10);
    localStorage.setItem('searchHistory', JSON.stringify(h));
    _searchHistory = h;
    loadSearchHistory();
}

function addToSearchHistory(code) {
    let name = _stockNames[code] || code;
    saveSearchHistory(code, name);
}

function renderSearchHistory() {
    loadSearchHistory();
}

function analyzeHistory(code, name) {
    document.getElementById('strategyInput').value = code;
    if (name) _stockNames[code] = name;
    loadStrategyDetail();
}

function loadSentimentByCode(code, name) {
    document.getElementById('newsInput').value = code;
    _stockNames[code] = name;
    loadNews();
    saveSearchHistory(code, name);
}

// 策略页
async function loadStrategyDetail() {
    const code = document.getElementById('strategyInput').value.trim();
    if (!code) {
        showToast('请输入股票代码');
        return;
    }

    try {
        await loadStockInfo(code);
        addToSearchHistory(code);
    } catch (e) {
        console.error(e);
        showToast('分析失败：' + e.message);
    }
}

function renderStrategyDetailSection(strategies) {
    document.getElementById('emptyStrategy').style.display = 'none';
    document.getElementById('strategyDetailSection').style.display = 'block';
    
    const buyCount = strategies.filter(s => s.action.includes('BUY')).length;
    const sellCount = strategies.filter(s => s.action.includes('SELL')).length;
    const tCount = strategies.filter(s => s.action.includes('TRADING_OPPORTUNITY') || s.action.includes('BUY_THEN_SELL') || s.action.includes('SELL_THEN_BUY')).length;
    
    document.getElementById('buyCount').innerText = buyCount;
    document.getElementById('sellCount').innerText = sellCount;
    document.getElementById('tCount').innerText = tCount;
    
    renderCategoryTabs(strategies);
    renderStrategyList(strategies);
}

function renderCategoryTabs(strategies) {
    const tabs = document.getElementById('categoryTabs');
    const categories = {};
    strategies.forEach(s => {
        categories[s.category] = (categories[s.category] || 0) + 1;
    });
    
    tabs.innerHTML = `
        <button class="cat-tab active" onclick="filterStrategies('all')">全部 <span class="cat-count">${strategies.length}</span></button>
        ${Object.entries(categories).map(([cat, count]) => `
            <button class="cat-tab" onclick="filterStrategies('${cat}')">${cat} <span class="cat-count">${count}</span></button>
        `).join('')}
    `;
}

function filterStrategies(filter) {
    const tabs = document.querySelectorAll('.cat-tab');
    tabs.forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    let filtered = _lastStrategies;
    if (filter === 'buy') {
        filtered = _lastStrategies.filter(s => s.action.includes('BUY'));
    } else if (filter === 'sell') {
        filtered = _lastStrategies.filter(s => s.action.includes('SELL'));
    } else if (filter === 't') {
        filtered = _lastStrategies.filter(s => s.action.includes('TRADING_OPPORTUNITY') || s.action.includes('BUY_THEN_SELL') || s.action.includes('SELL_THEN_BUY'));
    } else if (filter === 'watch') {
        filtered = _lastStrategies.filter(s => ['WATCH', 'HOLD', 'OBSERVE'].includes(s.action));
    } else if (filter !== 'all') {
        filtered = _lastStrategies.filter(s => s.category === filter);
    }
    
    renderStrategyList(filtered);
}

function renderStrategyList(strategies) {
    const list = document.getElementById('strategyList');
    
    if (strategies.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div>暂无策略数据</div></div>';
        return;
    }
    
    list.innerHTML = strategies.map(s => `
        <div class="strategy-card ${s.action.includes('BUY') ? 'priority' : ''}" onclick="showStrategyDetail('${s.name}')">
            <div class="strategy-header">
                <div class="strategy-name">
                    <span class="strat-icon">${s.icon}</span>
                    ${s.name}
                    ${s.priority === 'high' ? '<span class="high-badge">高优先级</span>' : ''}
                    ${s.novel ? '<span class="novel-badge">新策略</span>' : ''}
                </div>
                <span class="strategy-feasibility feasibility-${s.feasibility}">${s.feasibility}</span>
            </div>
            <div class="strategy-suggestion">${s.suggestion}</div>
            <div class="strategy-reasoning">${s.reasoning}</div>
            <div class="strategy-prices">
                ${s.target_price ? `<span class="price-target">🎯 目标: ¥${s.target_price}</span>` : ''}
                ${s.stop_loss ? `<span class="price-stoploss">🛡️ 止损: ¥${s.stop_loss}</span>` : ''}
            </div>
        </div>
    `).join('');
}

function showStrategyDetail(name) {
    const strategy = _lastStrategies.find(s => s.name === name);
    if (!strategy) return;
    
    const content = `
        <div style="padding: 10px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                <span style="font-size:24px;">${strategy.icon}</span>
                <div>
                    <div style="font-weight:600;font-size:16px;">${strategy.name}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${strategy.category}</div>
                </div>
            </div>
            <div style="background:rgba(255,255,255,0.03);padding:12px;border-radius:var(--radius-sm);margin-bottom:15px;border:1px solid var(--border-glass);">
                <div style="font-size:14px;margin-bottom:8px;"><strong>操作建议：</strong>${strategy.suggestion}</div>
                <div style="font-size:13px;color:var(--text-secondary);"><strong>分析理由：</strong>${strategy.reasoning}</div>
            </div>
            ${strategy.target_price ? `<div style="font-size:13px;margin-bottom:5px;">🎯 目标价：<strong>¥${strategy.target_price}</strong></div>` : ''}
            ${strategy.stop_loss ? `<div style="font-size:13px;margin-bottom:5px;">🛡️ 止损价：<strong>¥${strategy.stop_loss}</strong></div>` : ''}
            ${strategy.buy_price ? `<div style="font-size:13px;margin-bottom:5px;">💰 买入价：<strong>¥${strategy.buy_price}</strong></div>` : ''}
            ${strategy.sell_price ? `<div style="font-size:13px;margin-bottom:5px;">📉 卖出价：<strong>¥${strategy.sell_price}</strong></div>` : ''}
            <div style="font-size:12px;color:var(--text-muted);margin-top:10px;">
                可行性：${strategy.feasibility} | 优先级：${strategy.priority}
            </div>
        </div>
    `;
    
    openModal(strategy.name, content);
}

// 交易页
function loadTrades() {
    const saved = localStorage.getItem('trades');
    _trades = saved ? JSON.parse(saved) : [];
}

function saveTrades() {
    localStorage.setItem('trades', JSON.stringify(_trades));
}

function renderTrades() {
    const tradeList = document.getElementById('tradeList');
    const holdingsList = document.getElementById('holdingsList');
    
    if (_trades.length === 0) {
        if (tradeList) tradeList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div>暂无交易记录</div></div>';
        if (holdingsList) holdingsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💹</div><div>暂无持仓记录</div></div>';
        return;
    }
    
    if (tradeList) {
        tradeList.innerHTML = _trades.map((t, idx) => `
            <div class="trade-item">
                <div class="trade-header">
                    <span class="trade-stock">${t.name || t.code}</span>
                    <span class="trade-type ${t.trade_type ? t.trade_type.toLowerCase() : t.type.toLowerCase()}">${t.trade_type === 'BUY' || t.type === 'BUY' ? '买入' : '卖出'}</span>
                    <button onclick="deleteTrade(${idx})" style="margin-left:auto;background:rgba(239,68,68,0.15);color:#ef4444;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;">删除</button>
                </div>
                <div class="trade-info">
                    <span>${t.code}</span>
                    <span>¥${t.price.toFixed(2)} × ${t.quantity}股</span>
                </div>
                ${t.note ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">📝 ${t.note}</div>` : ''}
                <div class="trade-time">${new Date(t.timestamp || t.date).toLocaleString('zh-CN')}</div>
            </div>
        `).join('');
    }
    
    const holdings = {};
    _trades.forEach(t => {
        const type = t.trade_type || t.type;
        if (!holdings[t.code]) holdings[t.code] = { qty: 0, cost: 0, name: t.name || t.code };
        if (type === 'BUY') {
            holdings[t.code].qty += t.quantity;
            holdings[t.code].cost += t.price * t.quantity;
        } else {
            holdings[t.code].qty -= t.quantity;
        }
    });
    
    let holdingsHtml = '';
    let hasHoldings = false;
    for (const [code, info] of Object.entries(holdings)) {
        if (info.qty > 0) {
            hasHoldings = true;
            const avgCost = info.cost / info.qty;
            holdingsHtml += `
                <div class="stock-profit-item">
                    <div>
                        <div class="stock-profit-name">${info.name}</div>
                        <div class="stock-profit-detail">${code} · 持仓 ${info.qty}股 · 成本 ¥${avgCost.toFixed(2)}</div>
                    </div>
                    <div class="stock-profit-value">${info.qty}股</div>
                </div>
            `;
        }
    }
    
    if (holdingsList) {
        if (!hasHoldings) {
            holdingsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💹</div><div>暂无持仓记录</div></div>';
        } else {
            holdingsList.innerHTML = holdingsHtml;
        }
    }
}

function addTrade() {
    const code = document.getElementById('stockCode').value.trim();
    const name = document.getElementById('stockName').value.trim();
    const type = document.getElementById('tradeType').value;
    const price = parseFloat(document.getElementById('price').value);
    const qty = parseInt(document.getElementById('quantity').value);
    const note = document.getElementById('note').value.trim();
    
    if (!code || isNaN(price) || isNaN(qty) || qty <= 0) {
        showToast('请填写完整交易信息');
        return;
    }
    
    const stockName = name || _stockNames[code] || code;
    
    _trades.push({
        code,
        name: stockName,
        trade_type: type,
        type: type,
        price,
        quantity: qty,
        note,
        date: new Date().toISOString(),
        timestamp: Date.now()
    });
    
    saveTrades();
    renderTrades();
    refreshProfit();
    autoAddTradedStocks();
    
    document.getElementById('price').value = '';
    document.getElementById('quantity').value = '';
    document.getElementById('note').value = '';
    
    showToast('交易记录已添加');
}

function deleteTrade(idx) {
    if (!confirm('确定删除这条交易记录？此操作不可恢复。')) return;
    _trades.splice(idx, 1);
    saveTrades();
    renderTrades();
    refreshProfit();
    showToast('✓ 删除成功');
}

function getHoldings(code) {
    return _trades.reduce((sum, t) => {
        if (t.code === code) {
            return sum + (t.type === 'BUY' ? t.quantity : -t.quantity);
        }
        return sum;
    }, 0);
}

// 舆情页
async function loadNews() {
    const code = document.getElementById('newsInput').value.trim();
    if (!code) {
        showToast('请输入股票代码');
        return;
    }

    try {
        document.getElementById('emptyNews').style.display = 'none';
        document.getElementById('newsSection').style.display = 'block';
        
        const noticeUrl = `https://np-anotice-stock.eastmoney.com/api/security/ann?cb=jQuery&sr=-1&page_size=10&page_index=1&ann_type=A&client_source=web&stock_list=${code}&f_node=0&s_node=0`;
        
        const today = new Date();
        const endDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const startDate = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
        const beginDate = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
        const reportUrl = `https://reportapi.eastmoney.com/report/list?cb=jQuery&industryCode=*&pageSize=10&industry=*&rating=*&ratingChange=*&beginTime=${beginDate}&endTime=${endDate}&pageNo=1&fields=&qType=0&orgCode=&code=${code}&rcode=&_=1`;
        
        let notices = [];
        let reports = [];
        
        try {
            const noticeText = await httpGetText(noticeUrl);
            let noticeJson = noticeText;
            if (noticeText.startsWith('jQuery')) {
                const startIdx = noticeText.indexOf('(');
                const endIdx = noticeText.lastIndexOf(')');
                if (startIdx > -1 && endIdx > startIdx) {
                    noticeJson = noticeText.substring(startIdx + 1, endIdx);
                }
            }
            const noticeData = JSON.parse(noticeJson);
            const items = (noticeData.data || {}).list || [];
            notices = items.map(it => ({
                title: it.title_ch || it.title || '',
                time: it.display_time || it.notice_date || '',
                category: (it.columns && it.columns[0] && it.columns[0].column_name) || ''
            })).filter(n => n.title);
        } catch (e) {
            console.log('公告获取失败，跳过', e);
        }
        
        try {
            const reportText = await httpGetText(reportUrl);
            let reportJson = reportText;
            if (reportText.startsWith('jQuery')) {
                const startIdx = reportText.indexOf('(');
                const endIdx = reportText.lastIndexOf(')');
                if (startIdx > -1 && endIdx > startIdx) {
                    reportJson = reportText.substring(startIdx + 1, endIdx);
                }
            }
            const reportData = JSON.parse(reportJson);
            reports = (reportData.data || []).map(it => ({
                title: it.title || '',
                org: it.orgSName || it.orgName || '',
                time: (it.publishDate || '').substring(0, 10),
                rating: it.emRatingName || ''
            })).filter(r => r.title);
        } catch (e) {
            console.log('研报获取失败，跳过', e);
        }

        renderNews(notices, reports);
    } catch (e) {
        console.error(e);
        showToast('获取舆情失败：' + e.message);
    }
}

async function httpGetText(url) {
    try {
        if (window.Capacitor && window.Capacitor.Http) {
            const response = await Capacitor.Http.get({ url });
            return response.data;
        }
    } catch (e) {
        console.log('Capacitor HTTP not available, using fetch');
    }
    
    const response = await fetch(url, { mode: 'cors' });
    return await response.text();
}

function renderNews(notices, reports) {
    const noticeList = document.getElementById('noticeList');
    const reportList = document.getElementById('reportList');
    
    if (notices.length > 0) {
        noticeList.innerHTML = notices.map(n => `
            <div style="padding:14px 0;border-bottom:1px solid var(--border-glass);">
                <div style="font-size:13px;font-weight:500;margin-bottom:6px;line-height:1.5;">${n.title}</div>
                <div style="display:flex;gap:10px;font-size:11px;color:var(--text-muted);">
                    ${n.category ? `<span style="background:rgba(129,140,248,0.1);color:var(--accent);padding:2px 8px;border-radius:10px;">${n.category}</span>` : ''}
                    <span>${n.time}</span>
                </div>
            </div>
        `).join('');
    } else {
        noticeList.innerHTML = '<div class="empty-state" style="padding:30px 0;font-size:12px;"><div class="empty-state-icon">📢</div>暂无公告数据</div>';
    }
    
    if (reports.length > 0) {
        reportList.innerHTML = reports.map(r => `
            <div style="padding:14px 0;border-bottom:1px solid var(--border-glass);">
                <div style="font-size:13px;font-weight:500;margin-bottom:6px;line-height:1.5;">${r.title}</div>
                <div style="display:flex;gap:10px;align-items:center;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">
                    <span>🏛️ ${r.org || '未知机构'}</span>
                    ${r.rating ? `<span style="background:rgba(52,211,153,0.1);color:var(--green);padding:2px 8px;border-radius:10px;">${r.rating}</span>` : ''}
                    <span>${r.time}</span>
                </div>
            </div>
        `).join('');
    } else {
        reportList.innerHTML = '<div class="empty-state" style="padding:30px 0;font-size:12px;"><div class="empty-state-icon">📰</div>暂无研报数据</div>';
    }
}

document.addEventListener('DOMContentLoaded', init);

// ==================== 监控股票管理 ====================
function showAddWatchModal() {
    document.getElementById('watchModal').style.display = 'flex';
    document.getElementById('watchCodeInput').value = '';
    setTimeout(() => document.getElementById('watchCodeInput').focus(), 100);
}

function closeWatchModal() {
    document.getElementById('watchModal').style.display = 'none';
}

function addWatchStock(code) {
    if (!code) {
        code = document.getElementById('watchCodeInput').value.trim();
    }
    
    if (!code) {
        showToast('请输入股票代码');
        return;
    }
    
    if (!/^\d{6}$/.test(code)) {
        showToast('股票代码格式错误（应为6位数字）');
        return;
    }
    
    if (_watchList.includes(code)) {
        showToast('该股票已在监控列表中');
        closeWatchModal();
        return;
    }
    
    _watchList.push(code);
    saveWatchList();
    renderWatchList();
    closeWatchModal();
    showToast(`✓ 已添加 ${code} 到监控列表`);
    
    if (_watchList.length === 1) {
        getLiveTSignals(code);
    }
    
    autoAddTradedStocks();
}

function renderWatchList() {
    const miniContainer = document.getElementById('watchListMini');
    
    if (!miniContainer) return;
    
    if (!_watchList || _watchList.length === 0) {
        miniContainer.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">暂无监控</span>';
        return;
    }
    
    const miniHtml = _watchList.map(code => `
        <span class="watch-tag" onclick="getLiveTSignals('${code}')">
            ${code}
            <button onclick="event.stopPropagation(); removeFromWatchlist('${code}')">×</button>
        </span>
    `).join('');
    miniContainer.innerHTML = miniHtml;
}

// ==================== 实时做T信号 ====================
async function getLiveTSignals(stockCode) {
    const miniDiv = document.getElementById('liveSignalsMini');
    
    if (!miniDiv) return;
    
    miniDiv.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">加载中...</span>';
    
    try {
        const prefix = getTencentPrefix(stockCode);
        const fullCode = `${prefix}${stockCode}`;
        const quoteUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,1,qfq`;
        const quoteData = await httpGet(quoteUrl);
        
        if (quoteData.code !== 0 || !quoteData.data || !quoteData.data[fullCode]) {
            miniDiv.innerHTML = '<span style="font-size:10px;color:var(--text-muted);">加载失败</span>';
            return;
        }
        
        const stockData = quoteData.data[fullCode];
        const qt = stockData.qt?.[fullCode];
        if (!qt || qt.length < 38) {
            miniDiv.innerHTML = '<span style="font-size:10px;color:var(--text-muted);">加载失败</span>';
            return;
        }
        
        const stockInfo = {
            code: qt[2],
            name: qt[1],
            current_price: parseFloat(qt[3]) || 0,
            prev_close: parseFloat(qt[4]) || 0,
            open_price: parseFloat(qt[5]) || 0,
            volume: parseFloat(qt[36]) * 100 || 0,
            amount: parseFloat(qt[37]) * 10000 || 0,
            change_amount: parseFloat(qt[31]) || 0,
            change_percent: parseFloat(qt[32]) || 0,
            high_price: parseFloat(qt[33]) || 0,
            low_price: parseFloat(qt[34]) || 0,
            turnover: parseFloat(qt[38]) || 0
        };
        
        const klineUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,120,qfq`;
        const klineData = await httpGet(klineUrl);
        
        if (klineData.code !== 0 || !klineData.data || !klineData.data[fullCode]) {
            miniDiv.innerHTML = '<span style="font-size:10px;color:var(--text-muted);">K线加载失败</span>';
            return;
        }
        
        const klineArray = klineData.data[fullCode].qfqday || klineData.data[fullCode].day || [];
        const klines = klineArray.map(k => ({
            date: k[0],
            open: parseFloat(k[1]),
            close: parseFloat(k[2]),
            high: parseFloat(k[3]),
            low: parseFloat(k[4]),
            volume: parseFloat(k[5]) * 100,
            amount: k[6] ? parseFloat(k[6]) * 10000 : 0
        }));
        
        const holdings = getHoldings(stockCode);
        const [strategies, summary] = strategyEngine.runAllStrategies(stockInfo, klines, holdings);
        
        const highPriority = strategies.filter(s => s.priority <= 1);
        if (highPriority.length > 0) {
            const s = highPriority[0];
            const isBuy = s.action && (s.action.includes('BUY') || s.action.includes('OPPORTUNITY'));
            const color = isBuy ? 'var(--green)' : (s.action && s.action.includes('SELL') ? 'var(--red)' : 'var(--accent)');
            
            miniDiv.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                    <span style="font-size:14px;">${s.icon}</span>
                    <div style="flex:1;">
                        <div style="font-size:11px;font-weight:600;color:${color};">${s.name}</div>
                        <div style="font-size:10px;color:var(--text-muted);">${s.action || ''} · ${stockInfo.current_price}</div>
                    </div>
                    ${s.target_price ? `<span style="font-size:10px;color:var(--green);">↑${s.target_price}</span>` : ''}
                </div>
            `;
        } else {
            miniDiv.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">⏸️ 暂无信号 · 观望</div>';
        }
        
        _stockNames[stockCode] = stockInfo.name;
        
    } catch (e) {
        miniDiv.innerHTML = '<span style="font-size:10px;color:var(--text-muted);">加载失败</span>';
    }
}

// ==================== 收益计算 ====================
function refreshProfit() {
    loadTrades();
    
    let totalBuy = 0;
    let totalSell = 0;
    let realizedProfit = 0;
    let totalBuyAmount = 0;
    let totalSellAmount = 0;
    let commissionFee = 0;
    let stampTax = 0;
    let transferFee = 0;
    
    const holdings = {};
    
    _trades.forEach(t => {
        if (t.type === 'BUY') {
            totalBuy += t.quantity;
            const amount = t.price * t.quantity;
            totalBuyAmount += amount;
            
            const comm = Math.max(amount * 0.0003, 5);
            const trans = amount * 0.00001;
            commissionFee += comm;
            transferFee += trans;
            
            if (!holdings[t.code]) holdings[t.code] = { qty: 0, cost: 0, name: t.name || t.code };
            holdings[t.code].qty += t.quantity;
            holdings[t.code].cost += amount + comm + trans;
            
        } else {
            totalSell += t.quantity;
            const amount = t.price * t.quantity;
            totalSellAmount += amount;
            
            const comm = Math.max(amount * 0.0003, 5);
            const stamp = amount * 0.001;
            const trans = amount * 0.00001;
            commissionFee += comm;
            stampTax += stamp;
            transferFee += trans;
            
            if (holdings[t.code] && holdings[t.code].qty > 0) {
                const avgCost = holdings[t.code].cost / holdings[t.code].qty;
                const sellCost = avgCost * t.quantity;
                realizedProfit += (amount - comm - stamp - trans) - sellCost;
                holdings[t.code].qty -= t.quantity;
                holdings[t.code].cost -= sellCost;
            }
        }
    });
    
    let remaining = totalBuy - totalSell;
    let unrealizedProfit = 0;
    const stockProfits = [];
    
    for (const [code, info] of Object.entries(holdings)) {
        if (info.qty > 0) {
            let currentPrice = info.cost / info.qty;
            if (_currentStock && _currentStock.code === code) {
                currentPrice = _currentStock.current_price;
            }
            
            const marketValue = currentPrice * info.qty;
            const costValue = info.cost;
            const profit = marketValue - costValue;
            unrealizedProfit += profit;
            
            stockProfits.push({
                code,
                name: info.name || code,
                quantity: info.qty,
                avg_cost: info.cost / info.qty,
                current_price: currentPrice,
                profit: profit
            });
        }
    }
    
    stockProfits.sort((a, b) => b.quantity - a.quantity);
    
    const totalProfit = realizedProfit + unrealizedProfit;
    const totalFees = commissionFee + stampTax + transferFee;
    
    const setProfitVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = `¥${val.toFixed(2)}`;
            el.className = 'profit-value ' + (val > 0 ? 'positive' : val < 0 ? 'negative' : 'zero');
        }
    };
    
    setProfitVal('totalProfit', totalProfit);
    setProfitVal('realizedProfit', realizedProfit);
    setProfitVal('unrealizedProfit', unrealizedProfit);
    
    const totalBuyEl = document.getElementById('totalBuy');
    if (totalBuyEl) totalBuyEl.textContent = totalBuy + '股';
    
    const totalSellEl = document.getElementById('totalSell');
    if (totalSellEl) totalSellEl.textContent = totalSell + '股';
    
    const remainingEl = document.getElementById('remaining');
    if (remainingEl) remainingEl.textContent = remaining + '股';
    
    const tradeCountEl = document.getElementById('tradeCount');
    if (tradeCountEl) tradeCountEl.textContent = _trades.length + '次';
    
    const feesDiv = document.getElementById('feeDisplay');
    if (feesDiv) {
        feesDiv.innerHTML = `
            <div style="background:rgba(156,163,175,0.08);border-radius:8px;padding:10px;margin-top:6px;">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">已扣除费用</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px;">
                    <div style="text-align:center;"><div style="color:var(--text-muted);">佣金</div><div style="color:var(--red);">¥${commissionFee.toFixed(2)}</div></div>
                    <div style="text-align:center;"><div style="color:var(--text-muted);">印花税</div><div style="color:var(--red);">¥${stampTax.toFixed(2)}</div></div>
                    <div style="text-align:center;"><div style="color:var(--text-muted);">过户费</div><div style="color:var(--red);">¥${transferFee.toFixed(2)}</div></div>
                </div>
                <div style="margin-top:6px;font-size:11px;text-align:center;">
                    <span style="color:var(--text-muted);">总费用: </span><span style="color:var(--red);font-weight:700;">¥${totalFees.toFixed(2)}</span>
                </div>
            </div>`;
    }
    
    const div = document.getElementById('stockProfits');
    if (div) {
        if (stockProfits.length > 0) {
            div.innerHTML = stockProfits.map(s => `
                <div class="stock-profit-item">
                    <div>
                        <div class="stock-profit-name">${s.name}</div>
                        <div class="stock-profit-detail">${s.code} · ${s.quantity}股 · ¥${s.current_price.toFixed(2)}</div>
                    </div>
                    <div class="stock-profit-value" style="color:${s.profit >= 0 ? 'var(--red)' : 'var(--green)'}">
                        ${s.profit >= 0 ? '+' : ''}¥${s.profit.toFixed(2)}
                    </div>
                </div>
            `).join('');
        } else {
            div.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div>暂无持仓</div></div>';
        }
    }
    
    return {
        totalProfit,
        realizedProfit,
        unrealizedProfit,
        totalBuy,
        totalSell,
        remaining,
        tradeCount: _trades.length,
        commissionFee,
        stampTax,
        transferFee,
        totalFees,
        stockProfits
    };
}

function autoAddTradedStocks() {
    const holdings = {};
    _trades.forEach(t => {
        if (!holdings[t.code]) holdings[t.code] = { qty: 0, name: t.name || t.code };
        if (t.type === 'BUY') {
            holdings[t.code].qty += t.quantity;
        } else {
            holdings[t.code].qty -= t.quantity;
        }
    });
    
    let addedCount = 0;
    let primaryCode = null;
    
    for (const [code, info] of Object.entries(holdings)) {
        if (info.qty > 0) {
            if (!_watchList.includes(code)) {
                _watchList.push(code);
                addedCount++;
            }
            if (!primaryCode) primaryCode = code;
            if (info.name) _stockNames[code] = info.name;
        }
    }
    
    if (addedCount > 0) {
        saveWatchList();
        renderWatchList();
    }
    
    if (primaryCode) {
        getLiveTSignals(primaryCode);
    }
}

// ==================== 核心操作建议 ====================
function renderCoreAdvice(info, strategies) {
    const cp = info.current_price;
    const high = info.high_price;
    const low = info.low_price;
    
    const buySignals = strategies.filter(s => (s.action === 'BUY' || s.action === 'STRONG_BUY' || s.action === 'BUY_THEN_SELL') && s.priority <= 2);
    const sellSignals = strategies.filter(s => (s.action === 'SELL' || s.action === 'STRONG_SELL' || s.action === 'SELL_THEN_BUY') && s.priority <= 2);
    const holdSignals = strategies.filter(s => (s.action === 'HOLD' || s.action === 'WATCH' || s.action === 'OBSERVE' || s.action === 'NO_TRADE') && s.priority <= 3);
    
    const buyScore = buySignals.reduce((s, st) => s + (st.priority === 0 ? 3 : st.priority === 1 ? 2 : 1), 0);
    const sellScore = sellSignals.reduce((s, st) => s + (st.priority === 0 ? 3 : st.priority === 1 ? 2 : 1), 0);
    
    let direction, directionText, directionIcon, directionColor, directionBg;
    if (buyScore > sellScore * 1.5 && buyScore > 3) {
        direction = 'BUY';
        directionText = '建议买入做多';
        directionIcon = '📈';
        directionColor = '#22c55e';
        directionBg = 'rgba(34,197,94,0.15)';
    } else if (sellScore > buyScore * 1.5 && sellScore > 3) {
        direction = 'SELL';
        directionText = '建议卖出做空';
        directionIcon = '📉';
        directionColor = '#ef4444';
        directionBg = 'rgba(239,68,68,0.15)';
    } else {
        direction = 'HOLD';
        directionText = '建议观望等待';
        directionIcon = '⏸️';
        directionColor = '#fbbf24';
        directionBg = 'rgba(251,191,36,0.15)';
    }
    
    let buyPrice = cp;
    let sellPrice = cp;
    let targetPrice = cp;
    let stopLoss = cp;
    let reason = '';
    
    if (direction === 'BUY') {
        const bestBuy = buySignals.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0];
        if (bestBuy) {
            reason = bestBuy.suggestion.substring(0, 50);
            if (bestBuy.target_price) targetPrice = parseFloat(bestBuy.target_price);
            if (bestBuy.stop_loss) stopLoss = parseFloat(bestBuy.stop_loss);
            if (cp > targetPrice * 0.98) {
                buyPrice = targetPrice;
            } else {
                buyPrice = cp;
            }
        }
    } else if (direction === 'SELL') {
        const bestSell = sellSignals.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0];
        if (bestSell) {
            reason = bestSell.suggestion.substring(0, 50);
            if (bestSell.target_price) targetPrice = parseFloat(bestSell.target_price);
            if (bestSell.stop_loss) stopLoss = parseFloat(bestSell.stop_loss);
            if (cp < targetPrice * 1.02) {
                sellPrice = targetPrice;
            } else {
                sellPrice = cp;
            }
        }
    } else {
        reason = '多空信号均衡，建议等待明确方向';
    }
    
    const riskAmount = Math.abs(cp - stopLoss);
    const profitAmount = Math.abs(targetPrice - cp);
    const riskReward = riskAmount > 0 ? (profitAmount / riskAmount).toFixed(2) : 'N/A';
    const riskPercent = cp > 0 ? (riskAmount / cp * 100).toFixed(1) : '0';
    const profitPercent = cp > 0 ? (profitAmount / cp * 100).toFixed(1) : '0';
    
    const signalStats = `
        <div style="display:flex; gap:8px; margin-top:12px; font-size:12px; flex-wrap:wrap;">
            <span style="color:#22c55e; cursor:pointer; padding:6px 12px; background:rgba(34,197,94,0.15); border-radius:20px; font-weight:600;" onclick="showStrategyModal('买入信号', filterBuyStrategies(_lastStrategies))">
                🟢买入信号 ${buySignals.length}个
            </span>
            <span style="color:#ef4444; cursor:pointer; padding:6px 12px; background:rgba(239,68,68,0.15); border-radius:20px; font-weight:600;" onclick="showStrategyModal('卖出信号', filterSellStrategies(_lastStrategies))">
                🔴卖出信号 ${sellSignals.length}个
            </span>
            <span style="color:#fbbf24; cursor:pointer; padding:6px 12px; background:rgba(251,191,36,0.15); border-radius:20px; font-weight:600;" onclick="showStrategyModal('观望信号', filterHoldStrategies(_lastStrategies))">
                🟡观望信号 ${holdSignals.length}个
            </span>
        </div>
    `;
    
    const coreDiv = document.getElementById('coreAdvice');
    if (!coreDiv) return;
    
    coreDiv.innerHTML = `
        <div style="background: ${directionBg}; border: 2px solid ${directionColor}; border-radius: 16px; padding: 20px; margin: 16px 0;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
                <span style="font-size:28px;">${directionIcon}</span>
                <div>
                    <div style="font-size:20px; font-weight:700; color:${directionColor};">${directionText}</div>
                    <div style="font-size:12px; color:#9ca3af; margin-top:4px;">${reason}</div>
                </div>
            </div>
            
            ${direction === 'BUY' ? `
                <div style="background:rgba(0,0,0,0.3); border-radius:12px; padding:16px; margin-bottom:12px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; text-align:center;">
                        <div>
                            <div style="font-size:10px; color:#9ca3af; margin-bottom:4px;">买入价</div>
                            <div style="font-size:18px; font-weight:700; color:#22c55e;">¥${buyPrice.toFixed(2)}</div>
                        </div>
                        <div>
                            <div style="font-size:10px; color:#9ca3af; margin-bottom:4px;">目标价</div>
                            <div style="font-size:18px; font-weight:700; color:#60a5fa;">¥${targetPrice.toFixed(2)}</div>
                        </div>
                        <div>
                            <div style="font-size:10px; color:#9ca3af; margin-bottom:4px;">止损价</div>
                            <div style="font-size:18px; font-weight:700; color:#ef4444;">¥${stopLoss.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px;">
                    <div style="color:#22c55e;">📈预期收益 +${profitPercent}% (+¥${profitAmount.toFixed(2)})</div>
                    <div style="color:#ef4444;">📉风险损失 -${riskPercent}% (-¥${riskAmount.toFixed(2)})</div>
                    <div style="color:#fbbf24;">⚖️盈亏比 ${riskReward}</div>
                </div>
            ` : direction === 'SELL' ? `
                <div style="background:rgba(0,0,0,0.3); border-radius:12px; padding:16px; margin-bottom:12px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; text-align:center;">
                        <div>
                            <div style="font-size:10px; color:#9ca3af; margin-bottom:4px;">卖出价</div>
                            <div style="font-size:18px; font-weight:700; color:#ef4444;">¥${cp.toFixed(2)}</div>
                        </div>
                        <div>
                            <div style="font-size:10px; color:#9ca3af; margin-bottom:4px;">目标价</div>
                            <div style="font-size:18px; font-weight:700; color:#60a5fa;">¥${targetPrice.toFixed(2)}</div>
                        </div>
                        <div>
                            <div style="font-size:10px; color:#9ca3af; margin-bottom:4px;">止损价</div>
                            <div style="font-size:18px; font-weight:700; color:#22c55e;">¥${stopLoss.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px;">
                    <div style="color:#22c55e;">📈做空收益 +${profitPercent}% (+¥${profitAmount.toFixed(2)})</div>
                    <div style="color:#ef4444;">📉做空风险 -${riskPercent}% (-¥${riskAmount.toFixed(2)})</div>
                    <div style="color:#fbbf24;">⚖️盈亏比 ${riskReward}</div>
                </div>
            ` : `
                <div style="text-align:center; padding:20px; color:#9ca3af; font-size:14px;">
                    当前市场方向不明，建议等待明确信号后再操作
                </div>
            `}
            
            ${signalStats}
        </div>
    `;
    coreDiv.style.display = 'block';
}

function filterBuyStrategies(list) {
    return list.filter(s => s.action === 'BUY' || s.action === 'STRONG_BUY' || s.action === 'BUY_THEN_SELL');
}
function filterSellStrategies(list) {
    return list.filter(s => s.action === 'SELL' || s.action === 'STRONG_SELL' || s.action === 'SELL_THEN_BUY');
}
function filterHoldStrategies(list) {
    return list.filter(s => s.action === 'HOLD' || s.action === 'WATCH' || s.action === 'OBSERVE' || s.action === 'NO_TRADE');
}

function showStrategyModal(title, list) {
    let html = '';
    if (list.length === 0) {
        html = '<div class="empty-state">暂无数据</div>';
    } else {
        html = `<div style="display:grid; grid-template-columns:1fr; gap:8px;">`;
        list.forEach((s, idx) => {
            const actionColor = s.action.includes('BUY') && !s.action.includes('SELL') ? '#22c55e' :
                               s.action.includes('SELL') && !s.action.includes('BUY') ? '#ef4444' :
                               s.action.includes('BUY_THEN_SELL') || s.action.includes('SELL_THEN_BUY') ? '#60a5fa' : '#fbbf24';
            const actionText = s.action === 'BUY' ? '📈 买入' :
                              s.action === 'STRONG_BUY' ? '🚀 强买' :
                              s.action === 'SELL' ? '📉 卖出' :
                              s.action === 'STRONG_SELL' ? '💥 强卖' :
                              s.action === 'BUY_THEN_SELL' ? '🔄 做T(先买后卖)' :
                              s.action === 'SELL_THEN_BUY' ? '🔄 做T(先卖后买)' :
                              s.action === 'HOLD' ? '⏸️ 持有' :
                              s.action === 'WATCH' ? '👀 观望' :
                              s.action === 'OBSERVE' ? '🔍 观察' : '⏳ 中性';
            const prioText = s.priority === 0 ? '⭐⭐⭐ 极强' :
                            s.priority === 1 ? '⭐⭐ 强' :
                            s.priority === 2 ? '⭐ 中' : '📌 一般';
            html += `
                <div style="background:rgba(255,255,255,0.05); border-radius:12px; padding:14px; border:1px solid rgba(255,255,255,0.06);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:20px;">${s.icon || '📊'}</span>
                            <span style="font-weight:600; font-size:15px;">${s.name}</span>
                        </div>
                        <span style="color:${actionColor}; font-size:12px; font-weight:600; padding:4px 10px; background:${actionColor}22; border-radius:12px;">
                            ${actionText}
                        </span>
                    </div>
                    <div style="font-size:13px; color:#9ca3af; margin-bottom:10px;">${s.category} · ${prioText}</div>
                    <div style="font-size:14px; color:#e5e7eb; line-height:1.6; margin-bottom:10px;">${s.suggestion}</div>
                    ${s.reason ? `<div style="font-size:12px; color:#6b7280; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06);">💡 ${s.reason}</div>` : ''}
                    ${s.target_price ? `<div style="margin-top:8px; font-size:12px;">
                        <span style="color:#60a5fa;">🎯 目标价: ¥${s.target_price}</span>
                        ${s.stop_loss ? `<span style="color:#ef4444; margin-left:12px;">🛑 止损价: ¥${s.stop_loss}</span>` : ''}
                    </div>` : ''}
                </div>
            `;
        });
        html += `</div>`;
    }
    
    openModal(title + ` (${list.length}个)`, html);
    document.body.style.overflow = 'hidden';
}

// 修改closeModal以恢复滚动
const _originalCloseModal = closeModal;
closeModal = function() {
    _originalCloseModal();
    document.body.style.overflow = '';
};