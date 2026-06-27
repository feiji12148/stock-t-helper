let _currentStock = null;
let _watchList = [];
let _trades = [];
let _lastStrategies = [];
let _lastSummary = {};
let _lastPanoramaStrategies = [];
let _lastPanoramaSummary = null;
let _panoramaHistory = JSON.parse(localStorage.getItem('panoramaHistory') || '[]');
let _searchHistory = [];
let _stockNames = {};
let _searchTimer = null;
let _activeCategory = '全部';
let _settings = {};
let _autoRefreshTimer = null;
let _refreshCountdown = 0;

function getCapacitorHttp() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Http) {
        return window.Capacitor.Plugins.Http;
    }
    if (window.Capacitor && window.Capacitor.Http) {
        return window.Capacitor.Http;
    }
    return null;
}

async function httpGet(url) {
    const Http = getCapacitorHttp();
    if (Http) {
        try {
            const response = await Http.get({ url });
            if (typeof response.data === 'string') {
                return JSON.parse(response.data);
            }
            return response.data;
        } catch (e) {
            console.log('Capacitor HTTP 请求失败，尝试 fetch:', e);
        }
    }
    
    const response = await fetch(url, { mode: 'cors' });
    return await response.json();
}

function getTencentPrefix(code) {
    if (code.startsWith('6') || code.startsWith('9')) return 'sh';
    if (code.startsWith('0') || code.startsWith('3') || code.startsWith('2')) return 'sz';
    return 'sh';
}

// 获取当前股票价格（从缓存获取）
const _priceCache = {};
async function getCurrentPrice(code) {
    if (_priceCache[code] && _priceCache[code].time > Date.now() - 60000) {
        return _priceCache[code].price;
    }
    try {
        const prefix = getTencentPrefix(code);
        const url = `https://qt.gtimg.cn/q=${prefix}${code}`;
        let text;
        const Http = getCapacitorHttp();
        if (Http) {
            const response = await Http.get({ url });
            text = response.data;
        } else {
            const response = await fetch(url);
            text = await response.text();
        }
        const match = text.match(/="([^"]+)"/);
        if (match) {
            const qt = match[1].split('~');
            const price = parseFloat(qt[3]) || 0;
            if (price > 0) {
                _priceCache[code] = { price: price, time: Date.now() };
                return price;
            }
        }
        const parts = text.split('~');
        if (parts.length > 3) {
            const price = parseFloat(parts[3]) || 0;
            if (price > 0) {
                _priceCache[code] = { price: price, time: Date.now() };
                return price;
            }
        }
    } catch (e) {
        console.log('获取价格失败:', code, e);
    }
    return 0;
}

function init() {
    loadWatchList();
    loadTrades();
    loadSearchHistory();
    loadPanoramaHistory();
    loadSettings();
    loadHoldingsSignals();
    renderWatchList();
    renderTrades();
    renderSearchHistory();
    refreshProfit();
    updateAutoRefresh();
    
    if (typeof strategyEngine === 'undefined') {
        console.error('StrategyEngine not loaded');
    }
    
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.search-wrapper') && !e.target.closest('.search-box')) {
            document.querySelectorAll('.search-suggestions').forEach(el => el.style.display = 'none');
        }
    });
}

// 加载持仓股票的做T信号
function loadHoldingsSignals() {
    const holdings = {};
    _trades.forEach(t => {
        if (!holdings[t.code]) holdings[t.code] = { qty: 0, name: t.name || t.code };
        if ((t.trade_type || t.type) === 'BUY') {
            holdings[t.code].qty += t.quantity;
        } else {
            holdings[t.code].qty -= t.quantity;
        }
    });
    
    const holdingStocks = Object.entries(holdings).filter(([_, info]) => info.qty > 0);
    
    if (holdingStocks.length > 0) {
        let added = false;
        holdingStocks.forEach(([code, info]) => {
            if (!_watchList.includes(code)) {
                _watchList.push(code);
                added = true;
            }
            _stockNames[code] = info.name;
        });
        if (added) {
            saveWatchList();
        }
    }
}

function viewTSignalDetail(code) {
    switchTab('strategy');
    setTimeout(() => {
        const input = document.getElementById('strategyInput');
        if (input) {
            input.value = code;
            loadStrategyDetail();
        }
    }, 100);
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

let _currentStrategySubtab = 'strategy';

function switchStrategySubtab(subtabName) {
    _currentStrategySubtab = subtabName;
    
    document.querySelectorAll('.top-tab').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.strategy-subtab').forEach(el => el.classList.remove('active'));
    
    const tabBtn = document.querySelector(`.top-tab[data-subtab="${subtabName}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    
    const subtab = document.getElementById('subtab-' + subtabName);
    if (subtab) subtab.classList.add('active');
    
    if (subtabName === 'strategy') {
        loadSearchHistory();
        const input = document.getElementById('strategyInput');
        if (_currentStock && !input.value.trim()) {
            input.value = _currentStock.code;
            _stockNames[_currentStock.code] = _currentStock.name;
            loadStrategyDetail();
        } else if (input && input.value.trim() && !_currentStock) {
            loadStrategyDetail();
        }
    } else if (subtabName === 'panorama') {
        loadPanoramaHistory();
        const input = document.getElementById('panoramaInput');
        if (_currentStock && !input.value.trim()) {
            input.value = _currentStock.code;
            _stockNames[_currentStock.code] = _currentStock.name;
            loadPanoramaDetail();
        } else if (input && input.value.trim() && !_currentStock) {
            loadPanoramaDetail();
        }
    } else if (subtabName === 'news') {
        loadSearchHistory();
        const input = document.getElementById('newsInput');
        if (_currentStock && !input.value.trim()) {
            input.value = _currentStock.code;
            _stockNames[_currentStock.code] = _currentStock.name;
            loadNews();
        } else if (input && input.value.trim()) {
            loadNews();
        }
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const tab = document.getElementById('tab-' + tabName);
    if (tab) tab.classList.add('active');
    
    const btns = document.querySelectorAll('.tab-btn');
    const tabMap = { home: 0, trade: 1, strategy: 2, settings: 3 };
    if (btns[tabMap[tabName]]) btns[tabMap[tabName]].classList.add('active');
    
    if (tabName === 'home') {
        refreshProfit();
        renderWatchList();
    }
    else if (tabName === 'trade') {
        loadTrades();
        renderTrades();
        refreshTradeStats();
    }
    else if (tabName === 'strategy') {
        switchStrategySubtab(_currentStrategySubtab);
    }
    else if (tabName === 'settings') {
        loadSettings();
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
        document.getElementById('searchLoading').style.display = 'none';
        return;
    }
    
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
        const loadingEl = document.getElementById('searchLoading');
        if (loadingEl) loadingEl.style.display = 'inline';
        
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
        finally {
            if (loadingEl) loadingEl.style.display = 'none';
        }
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
    
    if (/^\d{6}$/.test(kw)) {
        const type = document.getElementById('tradeType').value;
        if (type === 'SELL') {
            const pairSection = document.getElementById('pairBuySection');
            if (pairSection) pairSection.style.display = 'block';
            renderPairBuyList(kw);
        }
        updatePairProfitPreview();
    }
    
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
    
    const type = document.getElementById('tradeType').value;
    if (type === 'SELL') {
        const pairSection = document.getElementById('pairBuySection');
        if (pairSection) pairSection.style.display = 'block';
        renderPairBuyList(code);
    }
    updatePairProfitPreview();
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
        const loadingEl = document.getElementById('strategyLoading');
        if (loadingEl) loadingEl.style.display = 'inline';
        
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
        finally {
            if (loadingEl) loadingEl.style.display = 'none';
        }
    }, 250);
}

// 全景页搜索
function onPanoramaSearchInput() {
    const kw = document.getElementById('panoramaInput').value.trim();
    if (!kw) {
        loadPanoramaHistory();
        document.getElementById('panoramaSuggestions').style.display = 'none';
        return;
    }
    
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
        const loadingEl = document.getElementById('panoramaLoading');
        if (loadingEl) loadingEl.style.display = 'inline';
        
        try {
            const results = await searchStockByName(kw);
            const sug = document.getElementById('panoramaSuggestions');
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
                        document.getElementById('panoramaInput').value = el.dataset.code;
                        _stockNames[el.dataset.code] = el.dataset.name;
                        loadPanoramaDetail();
                        addToPanoramaHistory(el.dataset.code);
                        sug.style.display = 'none';
                    });
                });
            } else {
                sug.innerHTML = '<div class="suggestion-item" style="justify-content:center;color:var(--text-muted);">未找到</div>';
                sug.style.display = 'block';
            }
        } catch (e) { console.error(e); }
        finally {
            if (loadingEl) loadingEl.style.display = 'none';
        }
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
    try {
        let results = await searchStockByName_tencent(name);
        if (results && results.length > 0) return results;
        
        results = await searchStockByName_eastmoney(name);
        return results || [];
    } catch (e) {
        console.error('搜索股票失败:', e);
        return [];
    }
}

async function searchStockByName_tencent(name) {
    const url = `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(name)}&t=all&p=1&o=0&n=10`;
    try {
        let text;
        const Http = getCapacitorHttp();
        
        if (Http) {
            const response = await Http.get({ url });
            text = response.data;
        } else {
            const response = await fetch(url, { mode: 'cors' });
            text = await response.text();
        }
        
        if (!text || text.length === 0) {
            console.log('腾讯搜索返回空数据');
            return [];
        }
        
        text = text.replace(/^v_hint=?"?/, '').replace(/"?$/, '').trim();
        const items = text.split('^').filter(s => s.trim());
        const results = [];
        for (const item of items) {
            const parts = item.split('~');
            if (parts.length >= 5) {
                const code = parts[1];
                const nameStr = parts[2];
                const type = parts[4];
                if (type === 'GP-A' && code && nameStr) {
                    let decodedName = nameStr;
                    try {
                        if (nameStr.indexOf('\\u') >= 0) {
                            decodedName = JSON.parse('"' + nameStr + '"');
                        }
                    } catch (e) {
                        decodedName = nameStr;
                    }
                    results.push({ code: code, name: decodedName });
                }
            }
        }
        return results;
    } catch (e) {
        console.error('腾讯搜索失败:', e);
        return [];
    }
}

async function searchStockByName_eastmoney(name) {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(name)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`;
    try {
        let data;
        const Http = getCapacitorHttp();
        
        if (Http) {
            const response = await Http.get({ url });
            data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        } else {
            const response = await fetch(url, { mode: 'cors' });
            data = await response.json();
        }
        
        if (!data || !data.Data || !Array.isArray(data.Data)) return [];
        
        const results = [];
        for (const item of data.Data) {
            if (item.Code && item.Name && item.MarketType) {
                results.push({ code: item.Code, name: item.Name });
            }
        }
        return results;
    } catch (e) {
        console.error('东方财富搜索失败:', e);
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
        await runPanoramaAnalysis(klines);
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

async function runPanoramaAnalysis(klines) {
    if (!_currentStock || !strategyEngine) return;
    
    const [strategies, summary] = strategyEngine.analyzePanorama(klines) || [[], null];
    
    _lastPanoramaStrategies = strategies || [];
    _lastPanoramaSummary = summary || null;
    window._lastPanoramaStrategies = strategies || [];
    
    renderPanoramaOverview(strategies || [], summary || null);
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

function addToPanoramaHistory(code) {
    let name = _stockNames[code] || code;
    let h = JSON.parse(localStorage.getItem('panoramaHistory') || '[]');
    h = h.filter(i => i.code !== code);
    h.unshift({ code, name, time: Date.now() });
    h = h.slice(0, 10);
    localStorage.setItem('panoramaHistory', JSON.stringify(h));
    _panoramaHistory = h;
    loadPanoramaHistory();
}

function loadPanoramaHistory() {
    const saved = localStorage.getItem('panoramaHistory');
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
    
    _panoramaHistory = h;
    
    const panoramaWrap = document.getElementById('panoramaHistory');
    const panoramaList = document.getElementById('panoramaHistoryList');
    
    const panoramaHtml = _panoramaHistory.length > 0 ? _panoramaHistory.map(item =>
        `<span class="history-tag" onclick="loadPanoramaByCode('${item.code}','${item.name || item.code}')">${item.name || item.code}</span>`
    ).join('') : '';
    
    if (panoramaWrap && panoramaList) {
        panoramaWrap.style.display = _panoramaHistory.length > 0 ? 'block' : 'none';
        panoramaList.innerHTML = panoramaHtml;
    }
}

function loadPanoramaByCode(code, name) {
    switchTab('strategy');
    switchStrategySubtab('panorama');
    setTimeout(() => {
        const input = document.getElementById('panoramaInput');
        if (input) input.value = code;
        if (name) _stockNames[code] = name;
        loadPanoramaDetail();
    }, 50);
}

function renderSearchHistory() {
    loadSearchHistory();
}

function analyzeHistory(code, name) {
    switchTab('strategy');
    switchStrategySubtab('strategy');
    setTimeout(() => {
        const input = document.getElementById('strategyInput');
        if (input) input.value = code;
        if (name) _stockNames[code] = name;
        loadStrategyDetail();
    }, 50);
}

function loadSentimentByCode(code, name) {
    switchTab('strategy');
    switchStrategySubtab('news');
    setTimeout(() => {
        const input = document.getElementById('newsInput');
        if (input) input.value = code;
        _stockNames[code] = name;
        loadNews();
    }, 150);
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

async function loadPanoramaDetail() {
    const code = document.getElementById('panoramaInput').value.trim();
    if (!code) {
        showToast('请输入股票代码');
        return;
    }

    try {
        await loadStockInfo(code);
        addToPanoramaHistory(code);
    } catch (e) {
        console.error(e);
        showToast('全景分析失败：' + e.message);
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

function renderPanoramaOverview(strategies, summary) {
    const emptyPanorama = document.getElementById('emptyPanorama');
    const panoramaOverview = document.getElementById('panoramaOverview');
    
    if (emptyPanorama) emptyPanorama.style.display = 'none';
    if (panoramaOverview) panoramaOverview.style.display = 'block';
    
    const buyCount = strategies.filter(s => s.action.includes('BUY')).length;
    const sellCount = strategies.filter(s => s.action.includes('SELL')).length;
    const watchCount = strategies.filter(s => ['WATCH', 'HOLD', 'OBSERVE'].includes(s.action)).length;
    const totalCount = strategies.length;
    
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };
    
    setText('panoBuyCount', buyCount);
    setText('panoSellCount', sellCount);
    setText('panoWatchCount', watchCount);
    setText('panoTotalCount', totalCount);
    
    const categories = [
        { key: 'volume', cat: '📊 量价关系', name: '量价关系' },
        { key: 'money', cat: '💰 资金流向', name: '资金流向' },
        { key: 'sentiment', cat: '😊 市场情绪', name: '市场情绪' },
        { key: 'chip', cat: '🎯 筹码分布', name: '筹码分布' },
        { key: 'institution', cat: '🏢 机构动向', name: '机构动向' },
        { key: 'news', cat: '📰 消息面提示', name: '消息面' }
    ];
    const categoryScores = {};
    
    categories.forEach(item => {
        const catStrategies = strategies.filter(s => s.category === item.cat);
        if (catStrategies.length === 0) {
            categoryScores[item.key] = 50;
        } else {
            const catBuy = catStrategies.filter(s => s.action.includes('BUY')).length;
            const catSell = catStrategies.filter(s => s.action.includes('SELL')).length;
            const total = catStrategies.length;
            const score = Math.round(50 + (catBuy - catSell) / total * 50);
            categoryScores[item.key] = Math.max(0, Math.min(100, score));
        }
    });
    
    // 填充六维评分卡片
    categories.forEach(item => {
        const score = categoryScores[item.key];
        const fillEl = document.getElementById('score' + item.key.charAt(0).toUpperCase() + item.key.slice(1));
        const valueEl = document.getElementById('score' + item.key.charAt(0).toUpperCase() + item.key.slice(1) + 'Value');
        if (fillEl) {
            fillEl.style.width = score + '%';
            if (score >= 60) {
                fillEl.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
            } else if (score <= 40) {
                fillEl.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
            } else {
                fillEl.style.background = 'linear-gradient(90deg, #fbbf24, #f59e0b)';
            }
        }
        if (valueEl) {
            valueEl.innerText = score + '分';
            if (score >= 60) {
                valueEl.style.color = '#22c55e';
            } else if (score <= 40) {
                valueEl.style.color = '#ef4444';
            } else {
                valueEl.style.color = '#fbbf24';
            }
        }
    });
    
    // 计算并显示综合评分
    const avgScore = Math.round(categories.reduce((sum, item) => sum + categoryScores[item.key], 0) / categories.length);
    const totalScoreEl = document.getElementById('totalPanoramaScore');
    if (totalScoreEl) {
        totalScoreEl.innerText = avgScore;
    }
    
    const totalActionEl = document.getElementById('totalPanoramaAction');
    if (totalActionEl) {
        totalActionEl.className = 'total-action';
        if (avgScore >= 70) {
            totalActionEl.innerText = '⭐ 强烈买入';
            totalActionEl.classList.add('buy');
        } else if (avgScore >= 55) {
            totalActionEl.innerText = '📈 建议买入';
            totalActionEl.classList.add('buy');
        } else if (avgScore >= 45) {
            totalActionEl.innerText = '👀 观望';
            totalActionEl.classList.add('watch');
        } else if (avgScore >= 30) {
            totalActionEl.innerText = '📉 建议卖出';
            totalActionEl.classList.add('sell');
        } else {
            totalActionEl.innerText = '⚠️ 强烈卖出';
            totalActionEl.classList.add('sell');
        }
    }
    
    renderPanoramaCategoryTabs(strategies);
    renderPanoramaStrategyList(strategies);
    
    if (_currentStock) {
        addToPanoramaHistory(_currentStock.code);
    }
}

function renderPanoramaCategoryTabs(strategies) {
    const tabs = document.getElementById('panoramaCategoryTabs');
    if (!tabs) return;
    
    const categories = {};
    strategies.forEach(s => {
        categories[s.category] = (categories[s.category] || 0) + 1;
    });
    
    tabs.innerHTML = `
        <button class="cat-tab active" onclick="filterPanoramaStrategies('all')">全部 <span class="cat-count">${strategies.length}</span></button>
        ${Object.entries(categories).map(([cat, count]) => `
            <button class="cat-tab" onclick="filterPanoramaStrategies('${cat}')">${cat} <span class="cat-count">${count}</span></button>
        `).join('')}
    `;
}

function filterPanoramaStrategies(filter) {
    const tabs = document.querySelectorAll('#panoramaCategoryTabs .cat-tab');
    tabs.forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    let filtered = _lastPanoramaStrategies;
    if (filter === 'buy') {
        filtered = _lastPanoramaStrategies.filter(s => s.action.includes('BUY'));
    } else if (filter === 'sell') {
        filtered = _lastPanoramaStrategies.filter(s => s.action.includes('SELL'));
    } else if (filter === 'watch') {
        filtered = _lastPanoramaStrategies.filter(s => ['WATCH', 'HOLD', 'OBSERVE'].includes(s.action));
    } else if (filter !== 'all') {
        filtered = _lastPanoramaStrategies.filter(s => s.category === filter);
    }
    
    renderPanoramaStrategyList(filtered);
}

function renderPanoramaStrategyList(strategies) {
    const list = document.getElementById('panoramaStrategyList');
    if (!list) return;
    
    if (strategies.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div>暂无策略数据</div></div>';
        return;
    }
    
    list.innerHTML = strategies.map(s => `
        <div class="strategy-card ${s.action.includes('BUY') ? 'priority' : ''}" onclick="showPanoramaStrategyDetail('${s.name}')">
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

function showPanoramaStrategyDetail(name) {
    const strategy = _lastPanoramaStrategies.find(s => s.name === name);
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

// 维度详情数据：每个维度的指标说明、数据来源、计算方法
const DIMENSION_INFO = {
    volume: {
        title: '📊 量价关系',
        desc: '通过价格变动与成交量的配合关系，研判多空力量对比',
        dataSource: '成交明细、5日/10日/20日均量、量比、换手率、振幅',
        formulas: [
            { name: '放量上涨', formula: '量比 > 1.5 且 涨幅 > 3%', desc: '量价齐升，趋势向好' },
            { name: '放量下跌', formula: '量比 > 1.5 且 跌幅 > 3%', desc: '恐慌抛售，警示信号' },
            { name: '缩量回调', formula: '量比 < 0.7 且 跌幅 < 2%', desc: '洗盘可能性大' },
            { name: '量价背离', formula: '价格创新高/低 但 量未创新高/低', desc: '趋势可能反转' },
            { name: '天量天价', formula: '20日最大成交量 + 长上影', desc: '见顶信号' }
        ]
    },
    money: {
        title: '💰 资金流向',
        desc: '通过量价特征模拟主力资金的进出动向（实际生产环境可接入Level-2数据）',
        dataSource: '基于"涨时放量+跌时缩量=主力吃货"、"涨时缩量+跌时放量=主力出货"的经验规律模拟',
        formulas: [
            { name: '主力净流入', formula: '∑(上涨日量×价格 - 下跌日量×价格) / 5日', desc: '正值越大，资金流入越强' },
            { name: '大单净流入', formula: '估算价 > 均价1.01 的成交量 - 估算价 < 均价0.99 的成交量', desc: '大单代表主力动向' },
            { name: 'OBV能量潮', formula: 'OBV = 昨日OBV + (今收>昨收 ? 今量 : -今量)', desc: '新高买入，新低卖出' },
            { name: 'MFI资金流量', formula: 'MFI = 100 - 100/(1 + (14日正向资金流/14日负向资金流))', desc: '>80 超买，<20 超卖' }
        ]
    },
    sentiment: {
        title: '😊 市场情绪',
        desc: '通过换手率、振幅、涨跌停、连涨连跌、K线形态等反映市场情绪强度',
        dataSource: '换手率、振幅、连续涨跌天数、上下影线、十字星',
        formulas: [
            { name: '换手率活跃度', formula: '今日成交量 / 流通股本 × 100%', desc: '>15% 异常活跃，3-10% 适中' },
            { name: '振幅情绪', formula: '(今日最高 - 今日最低) / 昨收 × 100%', desc: '>8% 情绪强，<2% 情绪弱' },
            { name: '涨跌停封板', formula: '涨幅 ≥ 9.95% 或 ≤ -9.95%', desc: '情绪极端' },
            { name: '连涨/连跌', formula: '连续N日 收阳/收阴', desc: '情绪升温/降温' },
            { name: '长上影/下影', formula: '影线长度 > 实体 × 3 且 放量', desc: '顶部抛压/底部承接信号' }
        ]
    },
    chip: {
        title: '🎯 筹码分布',
        desc: '通过价格波动范围、成交密集区估算市场持仓成本和筹码集中度',
        dataSource: '20日/60日高低点、价格区间成交量、均线支撑/压力位',
        formulas: [
            { name: '筹码集中度', formula: '(20日最高 - 20日最低) / 20日均价', desc: '越小越集中，主力控盘度高' },
            { name: '获利比例', formula: '当前价 在 20日价格区间的位置%', desc: '>80% 获利盘多，<20% 套牢盘多' },
            { name: '筹码峰上移', formula: '5日均价 > 20日均价 > 60日均价', desc: '主力做多' },
            { name: '筹码峰下移', formula: '5日均价 < 20日均价 < 60日均价', desc: '主力做空' },
            { name: '密集成交区', formula: '20日内最大单日成交量所在价格区间', desc: '上方为压力，下方为支撑' }
        ]
    },
    institution: {
        title: '🏢 机构动向',
        desc: '通过量价配合、K线形态识别机构的吸筹、洗盘、拉升、出货行为',
        dataSource: '连续多日K线形态、量价配合、长上影/下影、突破/跌破关键位',
        formulas: [
            { name: '机构吸筹', formula: '缓慢上涨 + 温和放量 + 多小阳线 + 缩量回调', desc: '主力低吸' },
            { name: '机构出货', formula: '高位放量 + 大阴线 + 多次冲高回落', desc: '主力派发' },
            { name: '主力洗盘', formula: '缩量下跌 + 不破关键支撑 + 短期快速回落', desc: '震出浮筹' },
            { name: '主力拉升', formula: '放量突破 + 连续大阳 + 量能持续放大', desc: '主升浪' },
            { name: '试盘/震仓', formula: '长上影+放量 / 长下影+放量，位置不高', desc: '测试上方压力或下方支撑' }
        ]
    },
    news: {
        title: '📰 消息面提示',
        desc: '通过价格行为推断可能的消息面变化（突破、跳空、异常放量等往往是消息驱动）',
        dataSource: '突破前高、跌破支撑、跳空缺口、异常放量等技术信号',
        formulas: [
            { name: '突破前高', formula: '收盘价 > 60日最高价', desc: '可能有重大利好' },
            { name: '跌破支撑', formula: '收盘价 < 60日最低价', desc: '可能有重大利空' },
            { name: '跳空缺口', formula: '今日最低 > 昨日最高（向上）或 反之（向下）', desc: '消息驱动' },
            { name: '异常放量', formula: '量比 > 3', desc: '可能有突发消息' },
            { name: '停牌/复牌', formula: '大幅跳空 + 成交量骤变', desc: '重大事项公告' }
        ]
    }
};

function showDimensionDetail(dimKey) {
    const info = DIMENSION_INFO[dimKey];
    if (!info) return;
    
    // 获取该维度的策略
    const dimMap = {
        volume: '📊 量价关系',
        money: '💰 资金流向',
        sentiment: '😊 市场情绪',
        chip: '🎯 筹码分布',
        institution: '🏢 机构动向',
        news: '📰 消息面提示'
    };
    const catName = dimMap[dimKey];
    const dimStrategies = _lastPanoramaStrategies.filter(s => s.category === catName);
    
    // 获取当前分数
    const scoreEl = document.getElementById('score' + dimKey.charAt(0).toUpperCase() + dimKey.slice(1) + 'Value');
    const score = scoreEl ? scoreEl.innerText : '--';
    
    // 评分等级
    let scoreLevel = '中性';
    let scoreColor = '#fbbf24';
    const numScore = parseInt(score);
    if (!isNaN(numScore)) {
        if (numScore >= 70) { scoreLevel = '强势看多'; scoreColor = '#22c55e'; }
        else if (numScore >= 55) { scoreLevel = '偏多'; scoreColor = '#22c55e'; }
        else if (numScore >= 45) { scoreLevel = '中性'; scoreColor = '#fbbf24'; }
        else if (numScore >= 30) { scoreLevel = '偏空'; scoreColor = '#ef4444'; }
        else { scoreLevel = '强势看空'; scoreColor = '#ef4444'; }
    }
    
    // 统计信号
    const buyCount = dimStrategies.filter(s => s.action.includes('BUY')).length;
    const sellCount = dimStrategies.filter(s => s.action.includes('SELL')).length;
    const watchCount = dimStrategies.filter(s => ['WATCH', 'HOLD', 'OBSERVE'].includes(s.action)).length;
    
    const content = `
        <div style="padding: 4px;">
            <!-- 维度标题和分数 -->
            <div style="text-align:center;padding:16px;background:linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1));border-radius:12px;margin-bottom:16px;">
                <div style="font-size:28px;font-weight:700;margin-bottom:4px;">${info.title}</div>
                <div style="font-size:36px;font-weight:800;color:${scoreColor};margin:6px 0;">${score}</div>
                <div style="display:inline-block;padding:4px 12px;background:rgba(255,255,255,0.1);border-radius:12px;font-size:12px;color:${scoreColor};">${scoreLevel}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:8px;line-height:1.5;">${info.desc}</div>
            </div>
            
            <!-- 信号统计 -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
                <div style="text-align:center;padding:10px;background:rgba(34,197,94,0.08);border-radius:8px;border:1px solid rgba(34,197,94,0.2);">
                    <div style="font-size:18px;font-weight:700;color:#22c55e;">${buyCount}</div>
                    <div style="font-size:11px;color:var(--text-muted);">买入信号</div>
                </div>
                <div style="text-align:center;padding:10px;background:rgba(251,191,36,0.08);border-radius:8px;border:1px solid rgba(251,191,36,0.2);">
                    <div style="font-size:18px;font-weight:700;color:#fbbf24;">${watchCount}</div>
                    <div style="font-size:11px;color:var(--text-muted);">观望信号</div>
                </div>
                <div style="text-align:center;padding:10px;background:rgba(239,68,68,0.08);border-radius:8px;border:1px solid rgba(239,68,68,0.2);">
                    <div style="font-size:18px;font-weight:700;color:#ef4444;">${sellCount}</div>
                    <div style="font-size:11px;color:var(--text-muted);">卖出信号</div>
                </div>
            </div>
            
            <!-- 数据来源 -->
            <div style="background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:12px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                    <span>📡</span><span>数据来源</span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">${info.dataSource}</div>
            </div>
            
            <!-- 计算公式 -->
            <div style="background:rgba(139,92,246,0.05);border:1px solid rgba(139,92,246,0.2);border-radius:10px;padding:12px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                    <span>🔢</span><span>核心计算公式</span>
                </div>
                ${info.formulas.map(f => `
                    <div style="margin-bottom:10px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;">
                        <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:3px;">▸ ${f.name}</div>
                        <div style="font-size:11px;color:var(--accent);font-family:monospace;margin-bottom:3px;line-height:1.4;">${f.formula}</div>
                        <div style="font-size:11px;color:var(--text-muted);">${f.desc}</div>
                    </div>
                `).join('')}
            </div>
            
            <!-- 该维度的策略列表 -->
            <div style="background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:12px;margin-bottom:8px;">
                <div style="font-size:13px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                    <span>📋</span><span>本维度策略 (${dimStrategies.length}个)</span>
                </div>
                ${dimStrategies.length === 0 ? '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:10px;">当前数据未触发该维度的策略</div>' : 
                dimStrategies.map(s => {
                    const actionText = s.action === 'BUY' ? '买入' : s.action === 'SELL' ? '卖出' : '观望';
                    const actionColor = s.action === 'BUY' ? '#22c55e' : s.action === 'SELL' ? '#ef4444' : '#fbbf24';
                    return `
                        <div style="margin-bottom:8px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;border-left:3px solid ${actionColor};">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                <span style="font-size:12px;font-weight:600;">${s.icon} ${s.name}</span>
                                <span style="font-size:11px;font-weight:700;color:${actionColor};background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:10px;">${actionText}</span>
                            </div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:3px;line-height:1.5;">${s.suggestion}</div>
                            <div style="font-size:10px;color:var(--text-muted);line-height:1.4;">${s.reasoning}</div>
                            ${s.target_price ? `<div style="font-size:10px;margin-top:3px;color:var(--text-muted);">🎯 目标 ¥${s.target_price} | 🛡️ 止损 ¥${s.stop_loss || '-'}</div>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    const modal = document.getElementById('dimensionModal');
    const titleEl = document.getElementById('dimModalTitle');
    const bodyEl = document.getElementById('dimModalBody');
    if (titleEl) titleEl.innerText = info.title;
    if (bodyEl) bodyEl.innerHTML = content;
    if (modal) modal.style.display = 'flex';
}

function closeDimensionModal() {
    const modal = document.getElementById('dimensionModal');
    if (modal) modal.style.display = 'none';
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
        tradeList.innerHTML = _trades.map((t, idx) => {
            const type = t.trade_type || t.type;
            const isBuy = type === 'BUY';
            const remaining = isBuy ? getTradeRemaining(idx) : 0;
            const isPaired = t.pair_buy_index !== undefined;
            const amount = t.price * t.quantity;
            const comm = Math.max(amount * 0.0003, 5);
            const stamp = isBuy ? 0 : amount * 0.001;
            const trans = amount * 0.00001;
            const totalFee = comm + stamp + trans;
            
            let feeInfo = `
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px;padding:4px 6px;background:rgba(0,0,0,0.1);border-radius:4px;">
                    <span>金额 ¥${amount.toFixed(2)}</span>
                    <span style="margin-left:8px;color:var(--red);">手续费 ¥${totalFee.toFixed(2)}</span>
                    ${isBuy ? '' : `<span style="margin-left:4px;">(印花税¥${stamp.toFixed(2)})</span>`}
                </div>
            `;
            
            let pairInfo = '';
            if (isPaired && !isBuy) {
                const pairQty = t.pair_quantity || 0;
                const pairBuyPrice = t.pair_buy_price || 0;
                const pairSellPrice = t.pair_sell_price || t.price;
                const pairFee = t.pair_fee || 0;
                const profit = t.pair_profit || 0;
                const buyAmount = pairBuyPrice * pairQty;
                const grossProfit = (pairSellPrice - pairBuyPrice) * pairQty;
                const profitPercent = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;
                const isProfit = profit >= 0;
                const buyFee = Math.max(buyAmount * 0.0003, 5) + buyAmount * 0.00001;
                const sellFee = pairFee - buyFee;
                
                if (pairQty > 0) {
                    pairInfo = `
                        <div style="margin-top:8px;padding:10px;background:${isProfit ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)'};border-radius:8px;border-left:3px solid ${isProfit ? 'var(--green)' : 'var(--red)'};">
                            <div style="font-size:12px;font-weight:700;color:${isProfit ? 'var(--green)' : 'var(--red)'};margin-bottom:6px;">
                                🔗 做T收益（${pairQty}股）：${isProfit ? '+' : ''}¥${profit.toFixed(2)} (${isProfit ? '+' : ''}${profitPercent.toFixed(2)}%)
                            </div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">
                                买入价 ¥${pairBuyPrice.toFixed(2)} → 卖出价 ¥${pairSellPrice.toFixed(2)}，差价 ¥${(pairSellPrice - pairBuyPrice).toFixed(2)}
                            </div>
                            <div style="font-size:10px;color:var(--text-muted);padding-top:4px;border-top:1px solid rgba(255,255,255,0.1);">
                                <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                                    <span>毛利：</span>
                                    <span style="color:${isProfit ? 'var(--green)' : 'var(--red)'};">${isProfit ? '+' : ''}¥${grossProfit.toFixed(2)}</span>
                                </div>
                                <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                                    <span>手续费（买入）：</span>
                                    <span style="color:var(--red);">-¥${buyFee.toFixed(2)}</span>
                                </div>
                                <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                                    <span>手续费（卖出）：</span>
                                    <span style="color:var(--red);">-¥${sellFee.toFixed(2)}</span>
                                </div>
                                <div style="display:flex;justify-content:space-between;font-weight:600;padding-top:2px;">
                                    <span>净收益：</span>
                                    <span style="color:${isProfit ? 'var(--green)' : 'var(--red)'};">${isProfit ? '+' : ''}¥${profit.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
            }
            
            let remainingInfo = '';
            if (isBuy && remaining > 0) {
                remainingInfo = `<div style="font-size:11px;color:var(--accent);margin-top:4px;">📊 剩余可卖：${remaining}股 / ${t.quantity}股</div>`;
            } else if (isBuy && remaining === 0 && t.quantity > 0) {
                remainingInfo = `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">✓ 已全部卖出</div>`;
            }
            
            return `
                <div class="trade-item" onclick="showTradeDetail(${idx})" style="cursor:pointer;">
                    <div class="trade-header">
                        <span class="trade-stock">${t.name || t.code}</span>
                        <span class="trade-type ${type.toLowerCase()}">${isBuy ? '买入' : '卖出'}</span>
                        <button onclick="event.stopPropagation();deleteTrade(${idx})" style="margin-left:auto;background:rgba(239,68,68,0.15);color:#ef4444;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;">删除</button>
                    </div>
                    <div class="trade-info">
                        <span>${t.code}</span>
                        <span>¥${t.price.toFixed(2)} × ${t.quantity}股</span>
                    </div>
                    ${feeInfo}
                    ${remainingInfo}
                    ${pairInfo}
                    ${t.note ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">📝 ${t.note}</div>` : ''}
                    <div class="trade-time">${new Date(t.timestamp || t.date).toLocaleString('zh-CN')}</div>
                </div>
            `;
        }).join('');
    }
    
    const holdings = {};
    _trades.forEach(t => {
        const type = t.trade_type || t.type;
        if (!holdings[t.code]) holdings[t.code] = { qty: 0, cost: 0, name: t.name || t.code };
        if (type === 'BUY') {
            const amount = t.price * t.quantity;
            const comm = Math.max(amount * 0.0003, 5);
            const trans = amount * 0.00001;
            holdings[t.code].qty += t.quantity;
            holdings[t.code].cost += amount + comm + trans;
        } else if (type === 'SELL') {
            if (holdings[t.code].qty > 0) {
                const avgCost = holdings[t.code].cost / holdings[t.code].qty;
                const sellCost = avgCost * t.quantity;
                holdings[t.code].cost -= sellCost;
                holdings[t.code].qty -= t.quantity;
            }
        }
    });
    
    let holdingsHtml = '';
    let hasHoldings = false;
    const holdingsCodes = [];
    for (const [code, info] of Object.entries(holdings)) {
        if (info.qty > 0) {
            hasHoldings = true;
            const avgCost = info.cost / info.qty;
            holdingsCodes.push(code);
            
            holdingsHtml += `
                <div class="stock-profit-item" id="holding-${code}" onclick="switchToStrategy('${code}')" style="cursor:pointer;">
                    <div>
                        <div class="stock-profit-name">${info.name}</div>
                        <div class="stock-profit-detail">${code} · 持仓 ${info.qty}股 · 成本 ¥${avgCost.toFixed(2)}</div>
                    </div>
                    <div class="holding-profit" id="holding-profit-${code}" style="text-align:right;">
                        <div style="font-size:11px;color:var(--text-muted);">加载中...</div>
                    </div>
                </div>
            `;
        }
    }
    
    if (holdingsList) {
        if (!hasHoldings) {
            holdingsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💹</div><div>暂无持仓记录</div></div>';
        } else {
            holdingsList.innerHTML = holdingsHtml;
            
            // 异步获取持仓股票的价格并更新盈亏显示
            holdingsCodes.forEach(async (code) => {
                const avgCost = holdings[code].cost / holdings[code].qty;
                const currentPrice = await getCurrentPrice(code);
                const profit = (currentPrice - avgCost) * holdings[code].qty;
                const profitPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost * 100) : 0;
                const isProfit = profit >= 0;
                const profitColor = isProfit ? 'var(--red)' : 'var(--green)';
                const profitSign = isProfit ? '+' : '';
                
                const profitEl = document.getElementById('holding-profit-' + code);
                if (profitEl && currentPrice > 0) {
                    profitEl.innerHTML = `
                        <div style="font-size:14px;font-weight:700;color:${profitColor};">${profitSign}¥${profit.toFixed(2)}</div>
                        <div style="font-size:11px;color:${profitColor};">${profitSign}${profitPercent.toFixed(2)}%</div>
                    `;
                } else if (profitEl) {
                    profitEl.innerHTML = `
                        <div style="font-size:11px;color:var(--text-muted);">¥${currentPrice.toFixed(2)}</div>
                    `;
                }
            });
        }
    }
}

function refreshTradeStats() {
    loadTrades();
    
    let tProfit = 0;
    let tCount = 0;
    let totalFee = 0;
    
    _trades.forEach(t => {
        const type = t.trade_type || t.type;
        const amount = t.price * t.quantity;
        const comm = Math.max(amount * 0.0003, 5);
        const stamp = type === 'SELL' ? amount * 0.001 : 0;
        const trans = amount * 0.00001;
        totalFee += comm + stamp + trans;
        
        if (type === 'SELL' && t.pair_profit !== undefined) {
            tProfit += t.pair_profit;
            tCount++;
        }
    });
    
    const tProfitEl = document.getElementById('tradeTProfit');
    const tCountEl = document.getElementById('tradeTCount');
    const totalFeeEl = document.getElementById('tradeTotalFee');
    
    if (tProfitEl) {
        tProfitEl.textContent = (tProfit >= 0 ? '+' : '') + '¥' + tProfit.toFixed(2);
        tProfitEl.className = 'profit-value ' + (tProfit >= 0 ? 'positive' : 'negative');
    }
    if (tCountEl) tCountEl.textContent = tCount + '次';
    if (totalFeeEl) totalFeeEl.textContent = '¥' + totalFee.toFixed(2);
}

function showTradeDetail(idx) {
    const t = _trades[idx];
    if (!t) return;
    
    const type = t.trade_type || t.type;
    const isBuy = type === 'BUY';
    const amount = t.price * t.quantity;
    const comm = Math.max(amount * 0.0003, 5);
    const stamp = isBuy ? 0 : amount * 0.001;
    const trans = amount * 0.00001;
    const totalFee = comm + stamp + trans;
    
    let content = `
        <div style="padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <div style="font-size:18px;font-weight:700;">${t.name || t.code}</div>
                <span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${isBuy ? 'rgba(239,68,68,0.15)' : 'rgba(52,211,153,0.15)'};color:${isBuy ? 'var(--red)' : 'var(--green)'};">
                    ${isBuy ? '📈 买入' : '📉 卖出'}
                </span>
            </div>
            
            <div style="background:rgba(0,0,0,0.2);border-radius:12px;padding:16px;margin-bottom:16px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                    <div style="text-align:center;">
                        <div style="font-size:11px;color:var(--text-muted);">价格</div>
                        <div style="font-size:20px;font-weight:700;">¥${t.price.toFixed(2)}</div>
                    </div>
                    <div style="text-align:center;">
                        <div style="font-size:11px;color:var(--text-muted);">数量</div>
                        <div style="font-size:20px;font-weight:700;">${t.quantity}股</div>
                    </div>
                </div>
                <div style="text-align:center;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);">
                    <div style="font-size:11px;color:var(--text-muted);">成交金额</div>
                    <div style="font-size:24px;font-weight:700;">¥${amount.toFixed(2)}</div>
                </div>
            </div>
            
            <div style="background:rgba(239,68,68,0.08);border-radius:12px;padding:16px;margin-bottom:16px;">
                <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:12px;">💸 手续费明细</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
                    <div style="display:flex;justify-content:space-between;padding:6px 8px;background:rgba(0,0,0,0.1);border-radius:6px;">
                        <span>佣金</span>
                        <span style="color:var(--red);">¥${comm.toFixed(2)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px 8px;background:rgba(0,0,0,0.1);border-radius:6px;">
                        <span>过户费</span>
                        <span style="color:var(--red);">¥${trans.toFixed(4)}</span>
                    </div>
                    ${isBuy ? '' : `
                    <div style="display:flex;justify-content:space-between;padding:6px 8px;background:rgba(0,0,0,0.1);border-radius:6px;grid-column:span 2;">
                        <span>印花税（卖出）</span>
                        <span style="color:var(--red);">¥${stamp.toFixed(2)}</span>
                    </div>
                    `}
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);font-weight:700;">
                    <span>手续费合计</span>
                    <span style="color:var(--red);font-size:16px;">¥${totalFee.toFixed(2)}</span>
                </div>
            </div>
            
            ${t.pair_buy_index !== undefined && t.pair_quantity > 0 ? (() => {
                const pairQty = t.pair_quantity || 0;
                const pairBuyPrice = t.pair_buy_price || 0;
                const pairSellPrice = t.pair_sell_price || t.price;
                const pairFee = t.pair_fee || 0;
                const profit = t.pair_profit || 0;
                const buyAmount = pairBuyPrice * pairQty;
                const grossProfit = (pairSellPrice - pairBuyPrice) * pairQty;
                const profitPercent = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;
                const isProfit = profit >= 0;
                const buyFee = Math.max(buyAmount * 0.0003, 5) + buyAmount * 0.00001;
                const sellFee = pairFee - buyFee;
                return `
                <div style="background:${isProfit ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)'};border-radius:12px;padding:16px;border-left:4px solid ${isProfit ? 'var(--green)' : 'var(--red)'};">
                    <div style="font-size:13px;font-weight:700;color:${isProfit ? 'var(--green)' : 'var(--red)'};margin-bottom:12px;">🔗 做T收益明细（${pairQty}股）</div>
                    <div style="font-size:12px;margin-bottom:12px;padding:10px;background:rgba(0,0,0,0.1);border-radius:8px;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                            <span style="color:var(--text-muted);">配对买入</span>
                            <span>¥${pairBuyPrice.toFixed(2)} × ${pairQty}股</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:var(--text-muted);">配对卖出</span>
                            <span>¥${pairSellPrice.toFixed(2)} × ${pairQty}股</span>
                        </div>
                    </div>
                    <div style="font-size:12px;padding:10px;background:rgba(0,0,0,0.15);border-radius:8px;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                            <span>差价收益</span>
                            <span style="color:${isProfit ? 'var(--green)' : 'var(--red)'};">${isProfit ? '+' : ''}¥${grossProfit.toFixed(2)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                            <span style="color:var(--text-muted);">买入手续费</span>
                            <span style="color:var(--red);">-¥${buyFee.toFixed(2)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                            <span style="color:var(--text-muted);">卖出手续费</span>
                            <span style="color:var(--red);">-¥${sellFee.toFixed(2)}</span>
                        </div>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:2px solid rgba(255,255,255,0.2);font-weight:700;font-size:16px;">
                        <span>净收益</span>
                        <span style="color:${isProfit ? 'var(--green)' : 'var(--red)'};">${isProfit ? '+' : ''}¥${profit.toFixed(2)} (${isProfit ? '+' : ''}${profitPercent.toFixed(2)}%)</span>
                    </div>
                </div>
                `;
            })() : ''}
            
            ${t.note ? `
            <div style="margin-top:16px;padding:12px;background:rgba(0,0,0,0.1);border-radius:8px;">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">📝 备注</div>
                <div style="font-size:13px;">${t.note}</div>
            </div>
            ` : ''}
            
            <div style="margin-top:16px;font-size:11px;color:var(--text-muted);text-align:center;">
                交易时间：${new Date(t.timestamp || t.date).toLocaleString('zh-CN')}
            </div>
        </div>
    `;
    
    openModal('交易详情', content);
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
    
    if (type === 'SELL') {
        const holdings = getHoldings(code);
        if (qty > holdings) {
            showToast(`持仓不足，当前持有 ${holdings} 股`);
            return;
        }
    }
    
    const stockName = name || _stockNames[code] || code;
    
    const newTrade = {
        code,
        name: stockName,
        trade_type: type,
        type: type,
        price,
        quantity: qty,
        note,
        date: new Date().toISOString(),
        timestamp: Date.now()
    };
    
    if (type === 'SELL' && _selectedPairBuyIndex >= 0) {
        const remaining = getTradeRemaining(_selectedPairBuyIndex);
        const actualQty = Math.min(qty, remaining);
        if (actualQty > 0) {
            newTrade.pair_buy_index = _selectedPairBuyIndex;
            newTrade.pair_quantity = actualQty;
            const buyPrice = _trades[_selectedPairBuyIndex].price;
            const buyAmount = buyPrice * actualQty;
            const sellAmount = price * actualQty;
            const buyComm = Math.max(buyAmount * 0.0003, 5);
            const buyTrans = buyAmount * 0.00001;
            const sellComm = Math.max(sellAmount * 0.0003, 5);
            const sellStamp = sellAmount * 0.001;
            const sellTrans = sellAmount * 0.00001;
            const totalFee = buyComm + buyTrans + sellComm + sellStamp + sellTrans;
            newTrade.pair_buy_price = buyPrice;
            newTrade.pair_sell_price = price;
            newTrade.pair_fee = totalFee;
            newTrade.pair_profit = (price - buyPrice) * actualQty - totalFee;
        }
    }
    
    _trades.push(newTrade);
    
    saveTrades();
    renderTrades();
    refreshProfit();
    refreshTradeStats();
    autoAddTradedStocks();
    
    document.getElementById('price').value = '';
    document.getElementById('quantity').value = '';
    document.getElementById('note').value = '';
    _selectedPairBuyIndex = -1;
    
    if (type === 'SELL') {
        renderPairBuyList(code);
        updatePairProfitPreview();
    }
    
    showToast('交易记录已添加');
}

let _selectedPairBuyIndex = -1;

function onTradeTypeChange() {
    const type = document.getElementById('tradeType').value;
    const pairSection = document.getElementById('pairBuySection');
    const code = document.getElementById('stockCode').value.trim();
    
    if (type === 'SELL' && code) {
        pairSection.style.display = 'block';
        renderPairBuyList(code);
    } else {
        pairSection.style.display = 'none';
    }
    
    updatePairProfitPreview();
}

function renderPairBuyList(code) {
    const pairList = document.getElementById('pairBuyList');
    if (!pairList) return;
    
    const buyTrades = _trades.filter((t, i) => {
        const type = t.trade_type || t.type;
        return t.code === code && type === 'BUY' && getTradeRemaining(i) > 0;
    });
    
    if (buyTrades.length === 0) {
        pairList.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:10px;">该股票无可用持仓</div>';
        return;
    }
    
    pairList.innerHTML = _trades.map((t, idx) => {
        const type = t.trade_type || t.type;
        if (t.code !== code || type !== 'BUY') return '';
        const remaining = getTradeRemaining(idx);
        if (remaining <= 0) return '';
        
        const isSelected = _selectedPairBuyIndex === idx;
        return `
            <div onclick="selectPairBuy(${idx})" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;${isSelected ? 'background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);' : 'background:rgba(255,255,255,0.03);border:1px solid var(--border-glass);'}">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:13px;font-weight:600;">¥${t.price.toFixed(2)} × ${t.quantity}股</div>
                        <div style="font-size:11px;color:var(--text-muted);">${new Date(t.timestamp || t.date).toLocaleDateString('zh-CN')}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:12px;color:var(--accent);">剩余 ${remaining}股</div>
                        ${t.note ? `<div style="font-size:10px;color:var(--text-muted);">${t.note}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function selectPairBuy(idx) {
    _selectedPairBuyIndex = _selectedPairBuyIndex === idx ? -1 : idx;
    const code = document.getElementById('stockCode').value.trim();
    renderPairBuyList(code);
    updatePairProfitPreview();
}

function updatePairProfitPreview() {
    const preview = document.getElementById('pairProfitPreview');
    if (!preview) return;
    
    if (_selectedPairBuyIndex < 0) {
        preview.style.display = 'none';
        return;
    }
    
    const sellPrice = parseFloat(document.getElementById('price').value);
    const sellQty = parseInt(document.getElementById('quantity').value);
    
    if (!sellPrice || !sellQty || sellQty <= 0) {
        preview.style.display = 'none';
        return;
    }
    
    const buyTrade = _trades[_selectedPairBuyIndex];
    if (!buyTrade) {
        preview.style.display = 'none';
        return;
    }
    
    const remaining = getTradeRemaining(_selectedPairBuyIndex);
    const actualQty = Math.min(sellQty, remaining);
    
    if (actualQty <= 0) {
        preview.style.display = 'none';
        return;
    }
    
    const buyAmount = buyTrade.price * actualQty;
    const sellAmount = sellPrice * actualQty;
    const buyComm = Math.max(buyAmount * 0.0003, 5);
    const buyTrans = buyAmount * 0.00001;
    const sellComm = Math.max(sellAmount * 0.0003, 5);
    const sellStamp = sellAmount * 0.001;
    const sellTrans = sellAmount * 0.00001;
    const totalFee = buyComm + buyTrans + sellComm + sellStamp + sellTrans;
    const profit = sellAmount - buyAmount - totalFee;
    const profitPercent = (profit / buyAmount) * 100;
    
    preview.style.display = 'block';
    
    const profitEl = document.getElementById('pairProfitAmount');
    const percentEl = document.getElementById('pairProfitPercent');
    
    const isProfit = profit >= 0;
    profitEl.textContent = (isProfit ? '+' : '') + '¥' + profit.toFixed(2);
    profitEl.style.color = isProfit ? 'var(--green)' : 'var(--red)';
    percentEl.textContent = (isProfit ? '+' : '') + profitPercent.toFixed(2) + '%';
    percentEl.style.color = isProfit ? 'var(--green)' : 'var(--red)';
    
    preview.style.background = isProfit ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)';
    preview.style.borderColor = isProfit ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.2)';
}

function getTradeRemaining(idx) {
    const trade = _trades[idx];
    if (!trade || (trade.trade_type || trade.type) !== 'BUY') return 0;
    
    let sold = 0;
    _trades.forEach(t => {
        if ((t.trade_type || t.type) === 'SELL' && t.pair_buy_index === idx) {
            sold += t.quantity;
        }
    });
    
    return trade.quantity - sold;
}

function deleteTrade(idx) {
    if (!confirm('确定删除这条交易记录？此操作不可恢复。')) return;
    
    const deletedTrade = _trades[idx];
    const deletedType = deletedTrade.trade_type || deletedTrade.type;
    
    _trades.splice(idx, 1);
    
    _trades.forEach(t => {
        if (t.pair_buy_index !== undefined) {
            if (t.pair_buy_index === idx) {
                delete t.pair_buy_index;
                delete t.pair_quantity;
                delete t.pair_buy_price;
                delete t.pair_sell_price;
                delete t.pair_fee;
                delete t.pair_profit;
            } else if (t.pair_buy_index > idx) {
                t.pair_buy_index--;
            }
        }
    });
    
    if (deletedType === 'BUY') {
        showToast('已删除买入记录，相关配对已解除');
    }
    
    _selectedPairBuyIndex = -1;
    saveTrades();
    renderTrades();
    refreshProfit();
    refreshTradeStats();
    closeModal();
    if (deletedType !== 'BUY') {
        showToast('✓ 删除成功');
    }
}

function getHoldings(code) {
    return _trades.reduce((sum, t) => {
        if (t.code === code) {
            const type = t.trade_type || t.type;
            return sum + (type === 'BUY' ? t.quantity : -t.quantity);
        }
        return sum;
    }, 0);
}

// 舆情页
async function loadNews() {
    let code = document.getElementById('newsInput').value.trim();
    if (!code) {
        showToast('请输入股票代码');
        return;
    }

    if (!/^\d{6}$/.test(code)) {
        const searchResult = await searchStockByName(code);
        if (searchResult && searchResult.length > 0) {
            code = searchResult[0].code;
            _stockNames[code] = searchResult[0].name;
            document.getElementById('newsInput').value = code;
        } else {
            showToast('未找到该股票');
            return;
        }
    }

    try {
        saveSearchHistory(code, _stockNames[code] || code);
        
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
    const Http = getCapacitorHttp();
    if (Http) {
        try {
            const response = await Http.get({ url });
            return response.data;
        } catch (e) {
            console.log('Capacitor HTTP 请求失败，尝试 fetch:', e);
        }
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
        <span class="watch-tag" onclick="refreshTSignalForStock('${code}')">
            ${code}
            <button onclick="event.stopPropagation(); removeFromWatchlist('${code}')">×</button>
        </span>
    `).join('');
    miniContainer.innerHTML = miniHtml;
    
    refreshAllTSignals();
}

function refreshAllTSignals() {
    const miniDiv = document.getElementById('liveSignalsMini');
    if (!miniDiv) return;
    
    if (!_watchList || _watchList.length === 0) {
        miniDiv.innerHTML = '<div style="font-size:11px;color:var(--text-muted);margin-top:8px;text-align:center;">暂无监控股票</div>';
        return;
    }
    
    miniDiv.innerHTML = _watchList.map(code => {
        const name = _stockNames[code] || code;
        return `
            <div id="signal-card-${code}" class="signal-card" style="background:rgba(0,0,0,0.2);border-radius:8px;padding:10px;margin-top:8px;cursor:pointer;" onclick="viewTSignalDetail('${code}')">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="font-size:12px;font-weight:600;">${name} <span style="color:var(--text-muted);font-weight:400;">${code}</span></div>
                    <span style="font-size:10px;color:var(--text-muted);">加载中...</span>
                </div>
            </div>
        `;
    }).join('');
    
    _watchList.forEach(code => {
        getLiveTSignals(code);
    });
}

function refreshTSignalForStock(code) {
    if (!_watchList.includes(code)) return;
    
    const cardDiv = document.getElementById('signal-card-' + code);
    if (!cardDiv) {
        refreshAllTSignals();
        return;
    }
    
    const name = _stockNames[code] || code;
    cardDiv.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:12px;font-weight:600;">${name} <span style="color:var(--text-muted);font-weight:400;">${code}</span></div>
            <span style="font-size:10px;color:var(--text-muted);">刷新中...</span>
        </div>
    `;
    getLiveTSignals(code);
}

// ==================== 实时做T信号 ====================
async function getLiveTSignals(stockCode) {
    const cardDiv = document.getElementById('signal-card-' + stockCode);
    
    if (!cardDiv) return;
    
    try {
        const prefix = getTencentPrefix(stockCode);
        const fullCode = `${prefix}${stockCode}`;
        const quoteUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,1,qfq`;
        const quoteData = await httpGet(quoteUrl);
        
        if (quoteData.code !== 0 || !quoteData.data || !quoteData.data[fullCode]) {
            cardDiv.innerHTML = renderSignalCardError(stockCode, '加载失败');
            return;
        }
        
        const stockData = quoteData.data[fullCode];
        const qt = stockData.qt?.[fullCode];
        if (!qt || qt.length < 38) {
            cardDiv.innerHTML = renderSignalCardError(stockCode, '数据异常');
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
            cardDiv.innerHTML = renderSignalCardError(stockCode, 'K线加载失败');
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
        
        const tSignals = strategies.filter(s => 
            s.action === 'TRADING_OPPORTUNITY' || 
            s.action === 'BUY_THEN_SELL' || 
            s.action === 'SELL_THEN_BUY'
        );
        
        if (tSignals.length > 0) {
            const s = tSignals[0];
            const isBuyT = s.action === 'BUY_THEN_SELL';
            const color = isBuyT ? 'var(--green)' : 'var(--red)';
            const tType = isBuyT ? '正T (先买后卖)' : (s.action === 'SELL_THEN_BUY' ? '反T (先卖后买)' : '做T机会');
            
            cardDiv.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:12px;font-weight:600;">${stockInfo.name} <span style="color:var(--text-muted);font-weight:400;">${stockInfo.code}</span></div>
                        <div style="font-size:11px;color:${color};margin-top:2px;">⚡ ${tType}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:12px;font-weight:600;color:${color};">¥${stockInfo.current_price.toFixed(2)}</div>
                        <div style="font-size:10px;color:var(--text-muted);">${stockInfo.change_percent >= 0 ? '+' : ''}${stockInfo.change_percent.toFixed(2)}%</div>
                    </div>
                </div>
                ${s.target_price ? `
                <div style="margin-top:6px;font-size:10px;color:var(--text-muted);">
                    目标价: <span style="color:var(--green);">¥${s.target_price}</span>
                    ${s.support_price ? ` · 支撑: <span style="color:var(--red);">¥${s.support_price}</span>` : ''}
                </div>
                ` : ''}
            `;
        } else {
            cardDiv.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:12px;font-weight:600;">${stockInfo.name} <span style="color:var(--text-muted);font-weight:400;">${stockInfo.code}</span></div>
                        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">⏸️ 观望中</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:12px;font-weight:600;color:${stockInfo.change_percent >= 0 ? 'var(--red)' : 'var(--green)'};">¥${stockInfo.current_price.toFixed(2)}</div>
                        <div style="font-size:10px;color:var(--text-muted);">${stockInfo.change_percent >= 0 ? '+' : ''}${stockInfo.change_percent.toFixed(2)}%</div>
                    </div>
                </div>
            `;
        }
        
        _stockNames[stockCode] = stockInfo.name;
        
    } catch (e) {
        cardDiv.innerHTML = renderSignalCardError(stockCode, '加载失败');
    }
}

function renderSignalCardError(code, msg) {
    const name = _stockNames[code] || code;
    return `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:12px;font-weight:600;">${name} <span style="color:var(--text-muted);font-weight:400;">${code}</span></div>
            <span style="font-size:10px;color:var(--text-muted);">${msg}</span>
        </div>
    `;
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
    let tProfit = 0;
    let tTradeCount = 0;
    
    const holdings = {};
    
    _trades.forEach(t => {
        const type = t.trade_type || t.type;
        if (type === 'BUY') {
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
            
            if (t.pair_profit !== undefined && (t.pair_quantity || 0) > 0) {
                tProfit += t.pair_profit;
                tTradeCount++;
            }
            
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
    const holdingCodes = [];
    
    for (const [code, info] of Object.entries(holdings)) {
        if (info.qty > 0) {
            let currentPrice = info.cost / info.qty;
            if (_currentStock && _currentStock.code === code) {
                currentPrice = _currentStock.current_price;
            }
            holdingCodes.push(code);
            
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
    setProfitVal('tProfit', tProfit);
    
    const tCountEl = document.getElementById('tTradeCount');
    if (tCountEl) tCountEl.textContent = tTradeCount + '次';
    
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
            div.innerHTML = stockProfits.map((s, idx) => `
                <div class="stock-profit-item" id="home-holding-${idx}">
                    <div>
                        <div class="stock-profit-name">${s.name}</div>
                        <div class="stock-profit-detail">${s.code} · ${s.quantity}股 · ¥<span id="home-price-${idx}">${s.current_price.toFixed(2)}</span></div>
                    </div>
                    <div class="stock-profit-value" id="home-profit-${idx}" style="color:${s.profit >= 0 ? 'var(--red)' : 'var(--green)'}">
                        ${s.profit >= 0 ? '+' : ''}¥${s.profit.toFixed(2)}
                    </div>
                </div>
            `).join('');
            
            // 异步获取所有持仓股票的实时价格并更新
            let totalUnrealized = 0;
            let fetchedCount = 0;
            holdingCodes.forEach((code, idx) => {
                const info = holdings[code];
                if (!info) return;
                getCurrentPrice(code).then(currentPrice => {
                    fetchedCount++;
                    if (currentPrice > 0) {
                        const profit = (currentPrice - info.cost / info.qty) * info.qty;
                        const profitPercent = info.cost > 0 ? ((currentPrice - info.cost / info.qty) / (info.cost / info.qty) * 100) : 0;
                        const isProfit = profit >= 0;
                        const profitColor = isProfit ? 'var(--red)' : 'var(--green)';
                        const profitSign = isProfit ? '+' : '';
                        
                        totalUnrealized += profit;
                        
                        const priceEl = document.getElementById('home-price-' + idx);
                        const profitEl = document.getElementById('home-profit-' + idx);
                        if (priceEl) priceEl.textContent = currentPrice.toFixed(2);
                        if (profitEl) {
                            profitEl.style.color = profitColor;
                            profitEl.innerHTML = `${profitSign}¥${profit.toFixed(2)}<div style="font-size:11px;">${profitSign}${profitPercent.toFixed(2)}%</div>`;
                        }
                    }
                    
                    // 所有价格获取完成后更新总浮动盈亏和总盈亏
                    if (fetchedCount === holdingCodes.length) {
                        const newTotalProfit = realizedProfit + totalUnrealized;
                        setProfitVal('unrealizedProfit', totalUnrealized);
                        setProfitVal('totalProfit', newTotalProfit);
                    }
                });
            });
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
}

// ==================== 核心操作建议 ====================
function renderCoreAdvice(info, strategies) {
    const cp = info.current_price;
    const high = info.high_price;
    const low = info.low_price;
    
    const buySignals = strategies.filter(s => (s.action === 'BUY' || s.action === 'STRONG_BUY') && s.priority <= 2);
    const sellSignals = strategies.filter(s => (s.action === 'SELL' || s.action === 'STRONG_SELL') && s.priority <= 2);
    const tSignals = strategies.filter(s => (s.action === 'TRADING_OPPORTUNITY' || s.action === 'BUY_THEN_SELL' || s.action === 'SELL_THEN_BUY') && s.priority <= 2);
    const holdSignals = strategies.filter(s => (s.action === 'HOLD' || s.action === 'WATCH' || s.action === 'OBSERVE' || s.action === 'NO_TRADE') && s.priority <= 3);
    
    const buyScore = buySignals.reduce((s, st) => s + (st.priority === 0 ? 3 : st.priority === 1 ? 2 : 1), 0);
    const sellScore = sellSignals.reduce((s, st) => s + (st.priority === 0 ? 3 : st.priority === 1 ? 2 : 1), 0);
    const tScore = tSignals.reduce((s, st) => s + (st.priority === 0 ? 3 : st.priority === 1 ? 2 : 1), 0);
    
    let direction, directionText, directionIcon, directionColor, directionBg;
    if (tScore > 0 && tScore >= Math.max(buyScore, sellScore)) {
        direction = 'T_TRADING';
        directionText = '⚡ 发现做T机会';
        directionIcon = '⚡';
        directionColor = '#8b5cf6';
        directionBg = 'rgba(139,92,246,0.15)';
    } else if (buyScore > sellScore * 1.5 && buyScore > 3) {
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
    
    if (direction === 'T_TRADING') {
        const bestT = tSignals.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0];
        if (bestT) {
            reason = bestT.suggestion.substring(0, 60);
            if (bestT.action === 'BUY_THEN_SELL') {
                buyPrice = low * 0.995;
                sellPrice = high * 1.005;
                targetPrice = sellPrice;
                stopLoss = buyPrice * 0.99;
            } else if (bestT.action === 'SELL_THEN_BUY') {
                sellPrice = high * 1.005;
                buyPrice = low * 0.995;
                targetPrice = buyPrice;
                stopLoss = sellPrice * 1.01;
            } else {
                buyPrice = cp * 0.995;
                sellPrice = cp * 1.005;
                targetPrice = sellPrice;
                stopLoss = buyPrice * 0.99;
            }
            if (bestT.target_price) targetPrice = parseFloat(bestT.target_price);
            if (bestT.stop_loss) stopLoss = parseFloat(bestT.stop_loss);
        } else {
            reason = '当前股价波动较大，适合做T操作';
            buyPrice = cp * 0.995;
            sellPrice = cp * 1.005;
            targetPrice = sellPrice;
            stopLoss = buyPrice * 0.99;
        }
    } else if (direction === 'BUY') {
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
            <span style="color:#8b5cf6; cursor:pointer; padding:6px 12px; background:rgba(139,92,246,0.15); border-radius:20px; font-weight:600;" onclick="showStrategyModal('做T机会', filterTStrategies(_lastStrategies))">
                ⚡做T机会 ${tSignals.length}个
            </span>
            <span style="color:#fbbf24; cursor:pointer; padding:6px 12px; background:rgba(251,191,36,0.15); border-radius:20px; font-weight:600;" onclick="showStrategyModal('观望信号', filterHoldStrategies(_lastStrategies))">
                🟡观望信号 ${holdSignals.length}个
            </span>
        </div>
    `;
    
    const coreDiv = document.getElementById('coreAdvice');
    if (!coreDiv) return;
    
    const stockCode = info.code || '';
    const stockName = info.name || '';
    
    coreDiv.innerHTML = `
        <div style="background: ${directionBg}; border: 2px solid ${directionColor}; border-radius: 16px; padding: 20px; margin: 16px 0;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:16px; font-weight:700; color:var(--text-primary);">${stockCode}</span>
                    <span style="font-size:14px; color:var(--text-secondary);">${stockName}</span>
                </div>
                <span style="font-size:12px; color:var(--text-muted);">策略分析</span>
            </div>
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
                <span style="font-size:28px;">${directionIcon}</span>
                <div>
                    <div style="font-size:20px; font-weight:700; color:${directionColor};">${directionText}</div>
                    <div style="font-size:12px; color:#9ca3af; margin-top:4px;">${reason}</div>
                </div>
            </div>
            
            ${direction === 'T_TRADING' ? `
                <div style="background:rgba(0,0,0,0.3); border-radius:12px; padding:16px; margin-bottom:12px; cursor:pointer;" onclick="showStrategyModal('做T机会详情', filterTStrategies(_lastStrategies))">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                        <span style="font-size:12px; color:#9ca3af;">⚡ 点击查看做T策略详情</span>
                        <span style="font-size:12px; color:#8b5cf6;">→</span>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; text-align:center;">
                        <div>
                            <div style="font-size:10px; color:#9ca3af; margin-bottom:4px;">买入参考价</div>
                            <div style="font-size:18px; font-weight:700; color:#22c55e;">¥${buyPrice.toFixed(2)}</div>
                        </div>
                        <div>
                            <div style="font-size:10px; color:#9ca3af; margin-bottom:4px;">卖出参考价</div>
                            <div style="font-size:18px; font-weight:700; color:#ef4444;">¥${sellPrice.toFixed(2)}</div>
                        </div>
                        <div>
                            <div style="font-size:10px; color:#9ca3af; margin-bottom:4px;">止损价</div>
                            <div style="font-size:18px; font-weight:700; color:#fbbf24;">¥${stopLoss.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px;">
                    <div style="color:#22c55e;">📈做T收益 +${profitPercent}% (+¥${profitAmount.toFixed(2)})</div>
                    <div style="color:#ef4444;">📉做T风险 -${riskPercent}% (-¥${riskAmount.toFixed(2)})</div>
                    <div style="color:#fbbf24;">⚖️盈亏比 ${riskReward}</div>
                </div>
            ` : direction === 'BUY' ? `
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
    return list.filter(s => s.action === 'BUY' || s.action === 'STRONG_BUY');
}
function filterSellStrategies(list) {
    return list.filter(s => s.action === 'SELL' || s.action === 'STRONG_SELL');
}
function filterTStrategies(list) {
    return list.filter(s => s.action === 'TRADING_OPPORTUNITY' || s.action === 'BUY_THEN_SELL' || s.action === 'SELL_THEN_BUY');
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

// ==================== 设置功能 ====================

function changeTheme(themeName) {
    document.body.className = `theme-${themeName}`;
    
    document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('active'));
    const option = document.querySelector(`.theme-option[data-theme="${themeName}"]`);
    if (option) option.classList.add('active');
    
    if (_settings) {
        _settings.theme = themeName;
        localStorage.setItem('appSettings', JSON.stringify(_settings));
    }
}

function loadSettings() {
    const saved = localStorage.getItem('appSettings');
    const defaults = {
        autoRefreshInterval: 10,
        soundEnabled: false,
        showChangePercent: true,
        enableTrend: true,
        enableOscillation: true,
        enableVolume: true,
        enablePattern: true,
        enableIntraday: true,
        enableCustom: true,
        tSignalThreshold: 2,
        buySignalThreshold: 5,
        sellSignalThreshold: 5,
        theme: 'dark-purple'
    };
    
    _settings = saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    
    document.getElementById('autoRefreshInterval').value = _settings.autoRefreshInterval;
    document.getElementById('soundEnabled').checked = _settings.soundEnabled;
    document.getElementById('showChangePercent').checked = _settings.showChangePercent;
    document.getElementById('enableTrend').checked = _settings.enableTrend;
    document.getElementById('enableOscillation').checked = _settings.enableOscillation;
    document.getElementById('enableVolume').checked = _settings.enableVolume;
    document.getElementById('enablePattern').checked = _settings.enablePattern;
    document.getElementById('enableIntraday').checked = _settings.enableIntraday;
    document.getElementById('enableCustom').checked = _settings.enableCustom;
    document.getElementById('tSignalThreshold').value = _settings.tSignalThreshold;
    document.getElementById('buySignalThreshold').value = _settings.buySignalThreshold;
    document.getElementById('sellSignalThreshold').value = _settings.sellSignalThreshold;
    
    changeTheme(_settings.theme || 'dark-purple');
    updateAutoRefresh();
}

function saveSettings() {
    _settings.autoRefreshInterval = parseInt(document.getElementById('autoRefreshInterval').value) || 0;
    _settings.soundEnabled = document.getElementById('soundEnabled').checked;
    _settings.showChangePercent = document.getElementById('showChangePercent').checked;
    _settings.enableTrend = document.getElementById('enableTrend').checked;
    _settings.enableOscillation = document.getElementById('enableOscillation').checked;
    _settings.enableVolume = document.getElementById('enableVolume').checked;
    _settings.enablePattern = document.getElementById('enablePattern').checked;
    _settings.enableIntraday = document.getElementById('enableIntraday').checked;
    _settings.enableCustom = document.getElementById('enableCustom').checked;
    _settings.tSignalThreshold = parseFloat(document.getElementById('tSignalThreshold').value) || 2;
    _settings.buySignalThreshold = parseInt(document.getElementById('buySignalThreshold').value) || 5;
    _settings.sellSignalThreshold = parseInt(document.getElementById('sellSignalThreshold').value) || 5;
    
    localStorage.setItem('appSettings', JSON.stringify(_settings));
    updateAutoRefresh();
    showToast('设置已保存');
}

function updateAutoRefresh() {
    if (_autoRefreshTimer) {
        clearInterval(_autoRefreshTimer);
        _autoRefreshTimer = null;
    }
    
    const interval = _settings.autoRefreshInterval || 0;
    
    if (interval > 0) {
        _refreshCountdown = interval;
        updateRefreshIndicator();
        
        _autoRefreshTimer = setInterval(() => {
            _refreshCountdown--;
            updateRefreshIndicator();
            
            if (_refreshCountdown <= 0) {
                _refreshCountdown = interval;
                
                const strategyTab = document.getElementById('tab-strategy');
                const homeTab = document.getElementById('tab-home');
                
                if (strategyTab && strategyTab.classList.contains('active') && _currentStock) {
                    if (_currentStrategySubtab === 'strategy') {
                        loadStrategyDetail();
                    } else if (_currentStrategySubtab === 'panorama') {
                        loadPanoramaDetail();
                    }
                }
                
                if (homeTab && homeTab.classList.contains('active')) {
                    refreshAllTSignals();
                    refreshProfit();
                }
            }
        }, 1000);
    }
}

function updateRefreshIndicator() {
    const indicator = document.getElementById('autoRefreshIndicator');
    if (!indicator) return;
    
    const interval = _settings.autoRefreshInterval || 0;
    if (interval > 0) {
        indicator.style.display = 'inline-flex';
        indicator.innerHTML = `<span class="dot"></span>${_refreshCountdown}秒`;
    } else {
        indicator.style.display = 'none';
    }
}

function exportData() {
    const data = {
        version: '1.0',
        exportTime: new Date().toISOString(),
        settings: _settings,
        watchList: _watchList,
        trades: _trades,
        searchHistory: _searchHistory
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock_thelper_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('数据已导出');
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            if (data.settings) {
                _settings = { ..._settings, ...data.settings };
                localStorage.setItem('appSettings', JSON.stringify(_settings));
            }
            
            if (data.watchList) {
                _watchList = data.watchList;
                localStorage.setItem('watchList', JSON.stringify(_watchList));
            }
            
            if (data.trades) {
                _trades = data.trades;
                localStorage.setItem('trades', JSON.stringify(_trades));
            }
            
            if (data.searchHistory) {
                _searchHistory = data.searchHistory;
                localStorage.setItem('searchHistory', JSON.stringify(_searchHistory));
            }
            
            loadSettings();
            renderWatchList();
            renderTrades();
            renderSearchHistory();
            refreshProfit();
            
            showToast('数据导入成功');
        } catch (err) {
            showToast('导入失败：文件格式错误');
        }
    };
    reader.readAsText(file);
    input.value = '';
}

function clearAllData() {
    if (!confirm('确定要清除所有数据吗？\n包括：交易记录、监控列表、搜索历史、设置\n此操作不可恢复！')) {
        return;
    }
    
    localStorage.removeItem('watchList');
    localStorage.removeItem('trades');
    localStorage.removeItem('searchHistory');
    localStorage.removeItem('appSettings');
    
    _watchList = [];
    _trades = [];
    _searchHistory = [];
    _settings = {};
    
    loadSettings();
    renderWatchList();
    renderTrades();
    renderSearchHistory();
    refreshProfit();
    
    showToast('所有数据已清除');
}

// ========== 自动更新相关 ==========
const APP_VERSION = '3.0.0';
const GITHUB_REPO = 'feiji12148/stock-t-helper';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_DOWNLOAD = `https://github.com/${GITHUB_REPO}/releases/latest`;

async function checkForUpdate() {
    const btn = document.getElementById('checkUpdateBtn');
    const originalText = btn ? btn.innerText : '检查更新';
    
    if (btn) {
        btn.innerText = '检查中...';
        btn.disabled = true;
    }
    
    try {
        const Http = getCapacitorHttp();
        let data;
        
        if (Http) {
            const response = await Http.get({ url: GITHUB_API });
            data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        } else {
            const response = await fetch(GITHUB_API, { mode: 'cors' });
            data = await response.json();
        }
        
        if (data.tag_name) {
            const latestVersion = data.tag_name.replace(/^v/, '');
            const currentVersion = APP_VERSION;
            
            if (compareVersions(latestVersion, currentVersion) > 0) {
                // 发现新版本
                const updateContent = `
                    <div style="padding: 20px; text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 16px;">🆕</div>
                        <div style="font-size: 18px; font-weight: 700; color: var(--accent); margin-bottom: 12px;">
                            发现新版本：v${latestVersion}
                        </div>
                        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
                            当前版本：v${currentVersion}
                        </div>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 10px; padding: 14px; text-align: left; margin-bottom: 16px; max-height: 200px; overflow-y: auto;">
                            <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">更新说明：</div>
                            <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.6; white-space: pre-wrap;">${data.body || '暂无更新说明'}</div>
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">
                            发布日期：${new Date(data.published_at).toLocaleDateString('zh-CN')}
                        </div>
                        <button onclick="downloadUpdate()" style="width: 100%; padding: 14px; background: var(--accent); color: white; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;">
                            📥 前往下载新版本
                        </button>
                    </div>
                `;
                openModal('发现新版本', updateContent);
            } else {
                showToast('当前已是最新版本 ✓');
            }
        } else {
            showToast('检查更新失败');
        }
    } catch (e) {
        console.error('检查更新失败:', e);
        showToast('检查更新失败，请稍后重试');
    } finally {
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    }
}

function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

function downloadUpdate() {
    closeModal();
    // 在 Capacitor 环境中打开浏览器
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
        window.Capacitor.Plugins.Browser.open({ url: GITHUB_DOWNLOAD });
    } else {
        window.open(GITHUB_DOWNLOAD, '_blank');
    }
}

function getStrategySettings() {
    return {
        enableTrend: _settings.enableTrend !== false,
        enableOscillation: _settings.enableOscillation !== false,
        enableVolume: _settings.enableVolume !== false,
        enablePattern: _settings.enablePattern !== false,
        enableIntraday: _settings.enableIntraday !== false,
        enableCustom: _settings.enableCustom !== false
    };
}

function checkSignalThresholds(strategies) {
    const buyCount = strategies.filter(s => s.action.includes('BUY')).length;
    const sellCount = strategies.filter(s => s.action.includes('SELL')).length;
    
    const buyThreshold = _settings.buySignalThreshold || 5;
    const sellThreshold = _settings.sellSignalThreshold || 5;
    
    if (buyCount >= buyThreshold && _settings.soundEnabled) {
        playSound();
        showToast(`📈 买入信号：${buyCount}个策略看涨`);
    }
    
    if (sellCount >= sellThreshold && _settings.soundEnabled) {
        playSound();
        showToast(`📉 卖出信号：${sellCount}个策略看跌`);
    }
}

function playSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.3;
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.2);
    } catch (e) {
        console.log('Sound not available');
    }
}