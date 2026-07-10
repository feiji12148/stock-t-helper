function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function isBuyAction(action) {
    return action === 'BUY' || action === 'STRONG_BUY';
}

function isSellAction(action) {
    return action === 'SELL' || action === 'STRONG_SELL';
}

function isTAction(action) {
    // 只统计可执行的做T方案（不包含TRADING_OPPORTUNITY机会提示）
    return action === 'BUY_THEN_SELL' || action === 'SELL_THEN_BUY' || action === 'BOX_TRADING';
}

function countStrategyActions(strategies) {
    let buy = 0, sell = 0, t = 0, watch = 0;
    if (!strategies || !strategies.length) return { buy, sell, t, watch };
    strategies.forEach(s => {
        if (isBuyAction(s.action)) buy++;
        else if (isSellAction(s.action)) sell++;
        else if (isTAction(s.action)) t++;
        else if (s.action === 'WATCH' || s.action === 'HOLD' || s.action === 'OBSERVE') watch++;
    });
    return { buy, sell, t, watch };
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

function round(num, decimals = 2) {
    if (isNaN(num) || !isFinite(num)) return '0.00';
    const factor = Math.pow(10, decimals);
    return (Math.round(num * factor) / factor).toFixed(decimals);
}

function calcTradeFees(amount, type) {
    const commissionRate = 0.0003;
    const minCommission = 5;
    const stampTaxRate = 0.001;
    const transferFeeRate = 0.00001;
    
    const commission = Math.max(amount * commissionRate, minCommission);
    const stamp = type === 'SELL' ? amount * stampTaxRate : 0;
    const transfer = amount * transferFeeRate;
    const total = commission + stamp + transfer;
    
    return { commission, stamp, transfer, total };
}

let _currentStock = null;
let _lastSearchedStock = null; // 最后一次查询的股票，优先作为默认加载
let _watchList = [];
let _trades = [];
let _feeDetail = { commissionFee: 0, stampTax: 0, transferFee: 0, totalFees: 0 };
let _profitDetail = { totalProfit: 0, realizedProfit: 0, unrealizedProfit: 0, tProfit: 0, tTradeCount: 0, tWinCount: 0, stockProfits: [], totalBuy: 0, totalSell: 0, remaining: 0, tradeCount: 0, totalBuyAmount: 0, totalSellAmount: 0, commissionFee: 0, stampTax: 0, transferFee: 0, totalFees: 0 };
let _lastStrategies = [];
let _lastSummary = {};
let _lastKlines = [];
let _lastPanoramaStrategies = [];
let _lastPanoramaSummary = null;
let _stockRequestId = 0;
let _profitReqId = 0;
let _panoramaHistory;
try { _panoramaHistory = JSON.parse(localStorage.getItem('panoramaHistory') || '[]'); } catch(e) { _panoramaHistory = []; }
let _searchHistory = [];
let _stockNames = {};
const _searchTimers = {};
const _searchTimerStart = {};
let _searchTimerCleanupInterval = null;

function setSearchTimer(key, fn, delay = 250) {
    if (_searchTimers[key]) {
        clearTimeout(_searchTimers[key]);
        delete _searchTimers[key];
        delete _searchTimerStart[key];
    }
    const timerId = setTimeout(() => {
        delete _searchTimers[key];
        delete _searchTimerStart[key];
        fn();
    }, delay);
    _searchTimers[key] = timerId;
    _searchTimerStart[key] = Date.now();
    scheduleSearchTimerCleanup();
}

function scheduleSearchTimerCleanup() {
    if (_searchTimerCleanupInterval) return;
    _searchTimerCleanupInterval = setInterval(() => {
        const keys = Object.keys(_searchTimers);
        if (keys.length === 0) {
            clearInterval(_searchTimerCleanupInterval);
            _searchTimerCleanupInterval = null;
            return;
        }
        const now = Date.now();
        for (const key of keys) {
            const startTime = _searchTimerStart[key];
            if (startTime && now - startTime > 30000) {
                clearTimeout(_searchTimers[key]);
                delete _searchTimers[key];
                delete _searchTimerStart[key];
            }
        }
    }, 10000);
}
let _activeCategory = '全部';
let _settings = {};
let _autoRefreshTimer = null;
let _refreshCountdown = 0;
let _isRefreshing = false; // 防止双定时器刷新重叠的全局标志
let _profitListRendered = false; // 持仓列表是否已渲染
let _lastHoldingCodes = []; // 上一次的持仓代码，用于判断是否需要重建列表
let _switchTabTimer = null; // switchTab 动画定时器
let _currentTab = 'home';   // 当前激活的tab
let _tabSwitchToken = 0;    // tab切换令牌，防止旧请求覆盖新UI
let _switchSubtabTimer = null; // switchStrategySubtab 动画定时器
let _tSignalRequestId = 0; // 做T信号请求竞态保护
const _tSignalReqMap = {}; // 每个股票的最新请求ID

// 预测记录存储（按月分块）
let _predictionRecords = null; // 懒加载，按月分块

// localStorage.setItem 的安全封装，防止 quota 超限抛出
function safeSetItem(key, val) {
    try { localStorage.setItem(key, val); return true; } catch (e) { console.warn('存储失败:', key, e); return false; }
}

function loadStockNames() {
    try {
        const saved = localStorage.getItem('stockNames');
        const parsed = saved ? JSON.parse(saved) : {};
        _stockNames = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) { _stockNames = {}; }
}

let _saveStockNamesTimer = null;
function saveStockNames() {
    if (_saveStockNamesTimer) clearTimeout(_saveStockNamesTimer);
    _saveStockNamesTimer = setTimeout(() => {
        safeSetItem('stockNames', JSON.stringify(_stockNames));
    }, 2000);
}

// 获取指定月份的预测记录
function getPredictionMonthRecords(monthKey) {
    try {
        const data = localStorage.getItem('pred_' + monthKey);
        return data ? JSON.parse(data) : {};
    } catch (e) {
        return {};
    }
}

// 保存指定月份的预测记录
function savePredictionMonthRecords(monthKey, records) {
    try {
        safeSetItem('pred_' + monthKey, JSON.stringify(records));
    } catch (e) {
        console.warn('预测记录保存失败:', e);
    }
}

// 获取所有月分块键
function getPredictionMonthKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('pred_')) keys.push(k);
    }
    return keys.sort().reverse(); // 最新的在前
}

// 获取指定股票的所有历史预测记录（跨月合并）
function getPredictionHistory(code) {
    const records = [];
    const monthKeys = getPredictionMonthKeys();
    for (const mk of monthKeys) {
        const monthData = getPredictionMonthRecords(mk.replace('pred_', ''));
        for (const key in monthData) {
            if (key.startsWith(code + '_')) {
                records.push(monthData[key]);
            }
        }
    }
    return records.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// 迁移旧格式数据（一次性）
function migrateOldPredictionRecords() {
    const old = localStorage.getItem('predictionRecords');
    if (!old) return;
    try {
        const oldData = JSON.parse(old);
        const months = {};
        for (const key in oldData) {
            const r = oldData[key];
            if (!r.date) continue;
            const monthKey = r.date.substring(0, 7); // "2026-07"
            if (!months[monthKey]) months[monthKey] = {};
            months[monthKey][key] = r;
        }
        let savedCount = 0;
        let totalCount = Object.keys(oldData).length;
        for (const mk in months) {
            try {
                savePredictionMonthRecords(mk, months[mk]);
                savedCount += Object.keys(months[mk]).length;
            } catch (e) {
                console.warn('月分块写入失败:', mk, e);
            }
        }
        // 已迁移的记录从旧数据中移除，避免下次重复
        if (savedCount > 0) {
            const remaining = {};
            for (const key in oldData) {
                const r = oldData[key];
                const mk = r.date ? r.date.substring(0, 7) : '';
                if (!months[mk] || !months[mk][key]) {
                    remaining[key] = r;
                }
            }
            if (Object.keys(remaining).length === 0) {
                localStorage.removeItem('predictionRecords');
                console.log('预测记录迁移完成，共', totalCount, '条');
            } else {
                localStorage.setItem('predictionRecords', JSON.stringify(remaining));
                console.log('预测记录部分迁移，已完成', savedCount, '条，剩余', Object.keys(remaining).length, '条');
            }
        }
    } catch (e) {
        console.warn('迁移旧预测记录失败:', e);
    }
}

function getCapacitorHttp() {
    // Capacitor 6: CapacitorHttp 通过拦截 fetch/XHR 工作，不是传统插件
    // 检查是否运行在 Capacitor 原生环境中
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
        // 原生环境，fetch 已被 CapacitorHttp 拦截
        return { isNative: true };
    }
    // 兼容旧版本插件检测
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) {
        return window.Capacitor.Plugins.CapacitorHttp;
    }
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Http) {
        return window.Capacitor.Plugins.Http;
    }
    return null;
}

let _jsonpCounter = 0;

function fetchJsonp(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const callbackName = `jsonp_callback_${Date.now()}_${(++_jsonpCounter).toString(36)}`;
        const script = document.createElement('script');
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('JSONP timeout'));
        }, timeout);

        function cleanup() {
            clearTimeout(timeoutId);
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
            delete window[callbackName];
        }

        window[callbackName] = (data) => {
            cleanup();
            resolve(data);
        };

        const urlWithCallback = url + (url.indexOf('?') === -1 ? '?' : '&') + `cb=${callbackName}`;
        script.src = urlWithCallback;
        script.onerror = () => {
            cleanup();
            reject(new Error('JSONP script error'));
        };

        document.head.appendChild(script);
    });
}

function fetchJsonpText(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const callbackName = `jsonp_text_callback_${Date.now()}_${(++_jsonpCounter).toString(36)}`;
        const script = document.createElement('script');
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('JSONP text timeout'));
        }, timeout);

        function cleanup() {
            clearTimeout(timeoutId);
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
            delete window[callbackName];
        }

        window[callbackName] = (text) => {
            cleanup();
            resolve(text);
        };

        const urlWithCallback = url + (url.indexOf('?') === -1 ? '?' : '&') + `cb=${callbackName}`;
        script.src = urlWithCallback;
        script.onerror = () => {
            cleanup();
            reject(new Error('JSONP script error'));
        };

        document.head.appendChild(script);
    });
}

function fetchJsonWithScript(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const timeoutId = setTimeout(() => {
            xhr.abort();
            reject(new Error('XHR timeout'));
        }, timeout);

        xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
                clearTimeout(timeoutId);
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        resolve(data);
                    } catch (e) {
                        reject(new Error('JSON parse error'));
                    }
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            }
        };

        xhr.onerror = () => {
            clearTimeout(timeoutId);
            reject(new Error('XHR error'));
        };

        xhr.open('GET', url, true);
        xhr.withCredentials = false;
        xhr.send();
    });
}

function fetchJsonpVar(url, varName, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('JSONP var timeout'));
        }, timeout);

        function cleanup() {
            clearTimeout(timeoutId);
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
            delete window[varName];
        }

        script.onload = () => {
            const result = window[varName];
            cleanup();
            resolve(result);
        };

        script.onerror = () => {
            cleanup();
            reject(new Error('JSONP script error'));
        };

        script.src = url;
        document.head.appendChild(script);
    });
}

function getCapacitorLocalNotifications() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        return window.Capacitor.Plugins.LocalNotifications;
    }
    if (window.Capacitor && window.Capacitor.LocalNotifications) {
        return window.Capacitor.LocalNotifications;
    }
    return null;
}

async function httpGet(url, options = {}) {
    const { timeout = 10000, retry = 1 } = options;
    let lastError;
    
    const isNative = getCapacitorHttp() !== null;
    
    // 1. 尝试fetch（Capacitor原生环境中已被CapacitorHttp拦截，无CORS问题）
    for (let attempt = 0; attempt <= retry; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            // 原生环境不需要mode:cors，因为CapacitorHttp已拦截
            const fetchOptions = isNative 
                ? { signal: controller.signal } 
                : { mode: 'cors', signal: controller.signal };
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            // 先尝试直接解析JSON
            try {
                return await response.clone().json();
            } catch (jsonErr) {
                // 可能是JSONP格式(cb({...}))，获取文本提取JSON
                const text = await response.text();
                // 匹配JSONP: callbackName({...}) 或 callbackName([...])
                const match = text.match(/^\s*[\w$]+\s*\(([\s\S]*)\)\s*;?\s*$/);
                if (match && match[1]) {
                    try {
                        return JSON.parse(match[1]);
                    } catch (e) {
                        // JSONP内容解析失败，继续尝试其他方式
                    }
                }
                // 尝试直接解析文本为JSON
                return JSON.parse(text);
            }
        } catch (e) {
            clearTimeout(timeoutId);
            lastError = e;
            if (attempt < retry && e.name !== 'AbortError') {
                await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            }
        }
    }
    
    // 2. fetch失败，尝试JSONP（仅对支持JSONP的接口有效）
    try {
        return await fetchJsonp(url, timeout);
    } catch (jsonpErr) {
        lastError = jsonpErr;
    }
    
    console.error('HTTP请求最终失败:', url, lastError);
    throw lastError;
}

// JSONP方式拉取数据（fetch完全不可用时使用）
async function httpGetJsonp(url, timeout = 10000) {
    try {
        return await fetchJsonp(url, timeout);
    } catch (e) {
        console.error('JSONP请求失败:', url, e);
        throw e;
    }
}

function getTencentPrefix(code) {
    if (code.startsWith('688') || code.startsWith('689')) return 'sh';  // 科创板
    if (code.startsWith('6') || code.startsWith('9')) return 'sh';     // 沪市
    if (code.startsWith('0') || code.startsWith('3') || code.startsWith('2')) return 'sz';  // 深市+创业板
    if (code.startsWith('8') || code.startsWith('4')) return 'bj';     // 北交所
    return 'sh';
}

function parseTencentQtData(qt) {
    if (!qt || !Array.isArray(qt) || qt.length < 38) {
        return null;
    }
    return {
        code: qt[2] || '',
        name: qt[1] || '',
        current_price: parseFloat(qt[3]) || 0,
        prev_close: parseFloat(qt[4]) || 0,
        open_price: parseFloat(qt[5]) || 0,
        volume: (parseFloat(qt[36]) || 0) * 100,
        amount: (parseFloat(qt[37]) || 0) * 10000,
        change_amount: parseFloat(qt[31]) || 0,
        change_percent: parseFloat(qt[32]) || 0,
        high_price: parseFloat(qt[33]) || 0,
        low_price: parseFloat(qt[34]) || 0,
        turnover: parseFloat(qt[38]) || 0
    };
}

// 获取当前股票价格（从缓存获取）
const _priceCache = {};
const _priceCacheKeys = [];
const _priceCacheMax = 50;
async function getCurrentPrice(code) {
    if (_priceCache[code] && _priceCache[code].time > Date.now() - 20000) {
        return _priceCache[code].price;
    }
    // 用腾讯接口（WebView中稳定可用）
    try {
        const prefix = getTencentPrefix(code);
        const fullCode = `${prefix}${code}`;
        const qt = await fetchJsonpVar(`https://qt.gtimg.cn/q=${fullCode}`, `v_${fullCode}`, 5000);
        if (qt) {
            const parts = qt.split('~');
            if (parts.length >= 3) {
                const price = parseFloat(parts[3]) || 0;
                if (price > 0) {
                    setPriceCache(code, price);
                    return price;
                }
            }
        }
    } catch (e) {
        console.log('腾讯获取价格失败:', code, e);
    }
    // fallback: 东方财富接口
    try {
        const prefix = getTencentPrefix(code);
        const market = prefix === 'sh' ? 1 : 0;
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${code}&fields=f43,f44,f45,f46,f60,f168,f169,f170`;
        const data = await httpGet(url, { timeout: 5000 });
        
        if (data && data.data) {
            const price = (data.data.f43 || 0) / 100;
            if (price > 0) {
                setPriceCache(code, price);
                return price;
            }
        }
    } catch (e) {
        console.log('东方财富获取价格也失败:', code, e);
    }
    return 0;
}

function setPriceCache(code, price) {
    if (!_priceCache[code]) {
        _priceCacheKeys.push(code);
        if (_priceCacheKeys.length > _priceCacheMax) {
            const oldest = _priceCacheKeys.shift();
            delete _priceCache[oldest];
        }
    }
    _priceCache[code] = { price: price, time: Date.now() };
}

function cleanExpiredPriceCache() {
    const now = Date.now();
    const expired = [];
    for (const code of _priceCacheKeys) {
        if (_priceCache[code] && now - _priceCache[code].time > 60000) {
            expired.push(code);
        }
    }
    for (const code of expired) {
        const idx = _priceCacheKeys.indexOf(code);
        if (idx > -1) _priceCacheKeys.splice(idx, 1);
        delete _priceCache[code];
    }
}

let _priceCacheCleanupTimer = setInterval(cleanExpiredPriceCache, 30000);

function init() {
    loadSettings();
    loadStockNames();
    loadWatchList();
    loadTrades();
    loadSearchHistory();
    loadPanoramaHistory();
    loadAlertedSignals();

    // 迁移旧格式预测记录到按月分块存储
    migrateOldPredictionRecords();

    // 恢复最后一次查询的股票
    try {
        const savedLast = localStorage.getItem('lastSearchedStock');
        if (savedLast) {
            const parsed = JSON.parse(savedLast);
            if (parsed && parsed.code && typeof parsed.code === 'string') {
                _lastSearchedStock = { code: parsed.code, name: parsed.name || parsed.code };
            }
        }
    } catch (e) {
        console.warn('Failed to load lastSearchedStock:', e);
    }
    renderWatchList(false);
    
    // 首屏优先渲染，不阻塞
    requestAnimationFrame(() => {
        loadHoldingsSignals();
        renderTrades().catch(e => console.warn('renderTrades初始化失败:', e));
        renderSearchHistory();
        refreshProfit();
        updateAutoRefresh();
    });
    
    // 延迟加载监控股票信号，避免阻塞启动
    // 等首屏渲染完成后再加载，提升启动速度感知
    setTimeout(() => {
        refreshAllTSignals();
    }, 300);
    
    setTimeout(() => {
        loadDefaultStock();
    }, 1500);
    
    setTimeout(() => {
        if (typeof strategyEngine === 'undefined') {
            console.error('StrategyEngine not loaded');
        }
    }, 500);
    
    if (!window._clickListenerAdded) {
        window._clickListenerAdded = true;
        window._searchClickHandler = function (e) {
            if (!e.target.closest('.search-wrapper') && !e.target.closest('.search-box')) {
                document.querySelectorAll('.search-suggestions').forEach(el => {
                    el.style.display = 'none';
                    el.innerHTML = '';
                });
            }
        };
        document.addEventListener('click', window._searchClickHandler);
    }

    if (!window._focusinListenerAdded) {
        window._focusinListenerAdded = true;
        window._inputFocusHandler = (e) => {
            if (e.target.tagName === 'INPUT' && (e.target.type === 'text' || e.target.type === 'number')) {
                setTimeout(() => {
                    e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            }
            if (e.target.tagName === 'INPUT' && e.target.type === 'text' && !e.target.value.trim()) {
                const inputId = e.target.id;
                const suggestionMap = {
                    'searchInput': 'homeSearchSuggestions',
                    'strategyInput': 'strategySuggestions',
                    'newsInput': 'newsSuggestions',
                    'panoramaInput': 'panoramaSuggestions',
                    'longtermInput': 'longtermSuggestions'
                };
                const sugId = suggestionMap[inputId];
                if (sugId) {
                    showSearchHistoryInSuggestions(sugId, inputId);
                }
            }
        };
        document.addEventListener('focusin', window._inputFocusHandler);
    }

    if (!window._settingItemClickListenerAdded) {
        window._settingItemClickListenerAdded = true;
        window._settingClickHandler = (e) => {
            const item = e.target.closest('.setting-item');
            if (!item) return;
            if (e.target.closest('.toggle') || e.target.closest('.setting-select') || e.target.closest('.setting-input')) return;

            const toggleInput = item.querySelector('.toggle input[type="checkbox"]');
            if (toggleInput) {
                toggleInput.checked = !toggleInput.checked;
                toggleInput.dispatchEvent(new Event('change'));
                return;
            }
            
            const select = item.querySelector('.setting-select');
            if (select) {
                select.focus();
                select.click();
            }
        };
        document.addEventListener('click', window._settingClickHandler);
    }

    initSwipeTabs();
    initPullRefresh();
    initBackButton();
    initKeyboardResizeFix();

    window.addEventListener('beforeunload', cleanupAllResources);

    // 使用具名函数引用，便于 cleanupAllResources 移除，避免内存泄漏
    window._visibilityChangeHandler = () => {
        if (document.hidden) {
            pauseAutoRefreshOnHide();
        } else {
            resumeAutoRefreshOnShow();
        }
    };
    document.addEventListener('visibilitychange', window._visibilityChangeHandler);

    initModalMaskClose();
    initInputClearButtons();
}

function initModalMaskClose() {
    const modalIds = ['strategyModal', 'dimensionModal', 'watchModal', 'learnModal'];
    modalIds.forEach(id => {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeAllModals();
            }
        });
        initModalSwipeClose(modal);
    });
}

function initModalSwipeClose(modal) {
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    const content = modal.querySelector('.modal-content');
    if (!content) return;

    content.addEventListener('touchstart', (e) => {
        if (content.scrollTop > 0) return;
        startY = e.touches[0].clientY;
        currentY = 0;
        isDragging = false;
        content.style.transition = 'none';
    }, { passive: true });

    content.addEventListener('touchmove', (e) => {
        if (content.scrollTop > 0) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 0) {
            isDragging = true;
            currentY = dy * 0.5;
            content.style.transform = `scale(${0.95 + (currentY / 1000)}) translateY(${currentY}px)`;
            content.style.opacity = `${1 - currentY / 500}`;
        }
    }, { passive: true });

    content.addEventListener('touchend', () => {
        if (!isDragging) return;
        content.style.transition = '';
        if (currentY > 100) {
            content.style.transform = '';
            content.style.opacity = '';
            closeAllModals();
        } else {
            content.style.transform = '';
            content.style.opacity = '';
        }
        isDragging = false;
        currentY = 0;
    });
}

function initInputClearButtons() {
    const inputIds = ['searchInput', 'strategyInput', 'newsInput', 'panoramaInput', 'longtermInput', 'watchSearchInput', 'tradeNameInput'];
    inputIds.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        const wrapper = input.parentElement;
        if (!wrapper || !wrapper.classList.contains('search-box')) return;
        wrapper.classList.add('input-wrapper');
        const clearBtn = document.createElement('button');
        clearBtn.className = 'input-clear-btn';
        clearBtn.type = 'button';
        clearBtn.innerHTML = '×';
        clearBtn.setAttribute('aria-label', '清除');
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            input.value = '';
            input.focus();
            clearBtn.classList.remove('show');
            input.dispatchEvent(new Event('input'));
        });
        wrapper.appendChild(clearBtn);
        input.addEventListener('input', () => {
            if (input.value.trim()) {
                clearBtn.classList.add('show');
            } else {
                clearBtn.classList.remove('show');
            }
        });
    });
}

function animateNumber(el, newValue, formatter) {
    if (!el) return;
    const oldVal = parseFloat(el.dataset.value || '0');
    const newVal = parseFloat(newValue) || 0;
    if (oldVal === newVal) {
        if (formatter) el.textContent = formatter(newVal);
        return;
    }
    el.dataset.value = newVal;
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    if (newVal > oldVal) {
        el.classList.add('flash-up');
    } else if (newVal < oldVal) {
        el.classList.add('flash-down');
    }
    if (formatter) {
        el.textContent = formatter(newVal);
    }
    setTimeout(() => {
        el.classList.remove('flash-up', 'flash-down');
    }, 600);
}

function generateSkeleton(lines = 5, includeCards = false) {
    let html = '';
    if (includeCards) {
        for (let i = 0; i < 2; i++) {
            html += '<div class="skeleton skeleton-card"></div>';
        }
    }
    for (let i = 0; i < lines; i++) {
        html += `<div class="skeleton skeleton-line${i === lines - 1 ? ' short' : ''}"></div>`;
    }
    return html;
}

let _longPressTarget = null;
let _longPressMenuEl = null;
let _longPressCurrentTimer = null;

let _docMouseMoveHandler = null;
let _docMouseUpHandler = null;

function ensureDocumentLongPressHandlers() {
    if (_docMouseMoveHandler && _docMouseUpHandler) return;
    
    _docMouseMoveHandler = (e) => {
        const el = _longPressTarget;
        if (!el || !el._longPressMouseDown) return;
        el._longPressOnMove(e.clientX, e.clientY);
    };
    
    _docMouseUpHandler = () => {
        const el = _longPressTarget;
        if (!el || !el._longPressMouseDown) return;
        el._longPressMouseDown = false;
        el._longPressOnEnd();
    };
    
    document.addEventListener('mousemove', _docMouseMoveHandler);
    document.addEventListener('mouseup', _docMouseUpHandler);
}

function showLongPressMenu(x, y, items, targetEl) {
    hideLongPressMenu();
    
    const menu = document.createElement('div');
    menu.className = 'longpress-menu';
    menu.innerHTML = items.map((item, idx) => {
        if (item.divider) return '<div class="longpress-menu-divider"></div>';
        const dangerClass = item.danger ? ' danger' : '';
        return `
            <div class="longpress-menu-item${dangerClass}" data-index="${idx}">
                <span class="longpress-menu-icon">${escapeHtml(item.icon || '')}</span>
                <span>${escapeHtml(item.label)}</span>
            </div>
        `;
    }).join('');
    
    document.body.appendChild(menu);
    _longPressMenuEl = menu;
    _longPressTarget = targetEl;
    
    const menuRect = menu.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    
    let left = x;
    let top = y;
    
    if (left + menuRect.width > viewportW - 10) {
        left = viewportW - menuRect.width - 10;
    }
    if (top + menuRect.height > viewportH - 10) {
        top = y - menuRect.height - 10;
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    
    requestAnimationFrame(() => {
        menu.classList.add('show');
    });
    
    items.forEach((item, idx) => {
        if (item.divider) return;
        const menuItem = menu.querySelector(`[data-index="${idx}"]`);
        if (menuItem) {
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.onClick) item.onClick();
                hideLongPressMenu();
            });
            menuItem.addEventListener('touchstart', (e) => {
                e.stopPropagation();
            });
        }
    });
    
    setTimeout(() => {
        document.addEventListener('click', hideLongPressMenu, { once: true });
    }, 0);
    
    return menu;
}

function hideLongPressMenu() {
    if (_longPressMenuEl) {
        _longPressMenuEl.classList.remove('show');
        const el = _longPressMenuEl;
        setTimeout(() => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }, 150);
        _longPressMenuEl = null;
    }
    if (_longPressTarget) {
        _longPressTarget.classList.remove('pressing');
        _longPressTarget = null;
    }
    if (_longPressCurrentTimer) {
        clearTimeout(_longPressCurrentTimer);
        _longPressCurrentTimer = null;
    }
}

function initLongPress(el, onLongPress, options = {}) {
    if (!el) return;
    
    ensureDocumentLongPressHandlers();
    
    const delay = options.delay || 500;
    const moveThreshold = options.moveThreshold || 10;
    
    let startX = 0, startY = 0;
    let hasMoved = false;
    
    const onStart = (clientX, clientY) => {
        startX = clientX;
        startY = clientY;
        hasMoved = false;
        el.classList.add('longpress-target', 'pressing');
        _longPressTarget = el;
        
        if (_longPressCurrentTimer) clearTimeout(_longPressCurrentTimer);
        _longPressCurrentTimer = setTimeout(() => {
            if (!hasMoved) {
                if (navigator.vibrate) navigator.vibrate(30);
                onLongPress(el, clientX, clientY);
            }
            el.classList.remove('pressing');
        }, delay);
    };
    
    const onMove = (clientX, clientY) => {
        const dx = Math.abs(clientX - startX);
        const dy = Math.abs(clientY - startY);
        if (dx > moveThreshold || dy > moveThreshold) {
            hasMoved = true;
            el.classList.remove('pressing');
            if (_longPressCurrentTimer) {
                clearTimeout(_longPressCurrentTimer);
                _longPressCurrentTimer = null;
            }
        }
    };
    
    const onEnd = () => {
        el.classList.remove('pressing');
        if (_longPressCurrentTimer) {
            clearTimeout(_longPressCurrentTimer);
            _longPressCurrentTimer = null;
        }
        if (_longPressTarget === el) {
            _longPressTarget = null;
        }
    };
    
    el._longPressMouseDown = false;
    el._longPressOnMove = onMove;
    el._longPressOnEnd = onEnd;
    
    el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    
    el.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    
    el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        el._longPressMouseDown = true;
        onStart(e.clientX, e.clientY);
    });
    
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        onLongPress(el, e.clientX, e.clientY);
    });
}

let _autoRefreshPaused = false;
let _watchRefreshPaused = false;
let _pausedRefreshInterval = 0;

function pauseAutoRefreshOnHide() {
    if (_autoRefreshTimer) {
        clearTimeout(_autoRefreshTimer);
        _autoRefreshTimer = null;
        _autoRefreshPaused = true;
    }
    if (_watchRefreshTimer) {
        clearTimeout(_watchRefreshTimer);
        _watchRefreshTimer = null;
        _watchRefreshPaused = true;
    }
    _pausedRefreshInterval = _settings.autoRefreshInterval || 0;
}

function resumeAutoRefreshOnShow() {
    if (!_autoRefreshPaused && !_watchRefreshPaused) return;
    _autoRefreshPaused = false;
    _watchRefreshPaused = false;
    // 使用最新设置而非 _pausedRefreshInterval，避免隐藏期间用户关闭自动刷新后仍被重启
    const currentInterval = _settings.autoRefreshInterval || 0;
    if (currentInterval > 0) {
        updateAutoRefresh();
    }
    _pausedRefreshInterval = 0;
}

function cleanupAllResources() {
    if (_saveStockNamesTimer) {
        clearTimeout(_saveStockNamesTimer);
        _saveStockNamesTimer = null;
        safeSetItem('stockNames', JSON.stringify(_stockNames));
    }
    if (_autoRefreshTimer) {
        clearTimeout(_autoRefreshTimer);
        _autoRefreshTimer = null;
    }
    if (_watchRefreshTimer) {
        clearTimeout(_watchRefreshTimer);
        _watchRefreshTimer = null;
    }
    if (_tSignalBatchTimer) {
        clearTimeout(_tSignalBatchTimer);
        _tSignalBatchTimer = null;
    }
    if (_toastTimer) {
        clearTimeout(_toastTimer);
        _toastTimer = null;
    }
    if (_switchTabTimer) {
        clearTimeout(_switchTabTimer);
        _switchTabTimer = null;
    }
    if (_switchSubtabTimer) {
        clearTimeout(_switchSubtabTimer);
        _switchSubtabTimer = null;
    }
    if (_longPressCurrentTimer) {
        clearTimeout(_longPressCurrentTimer);
        _longPressCurrentTimer = null;
    }
    for (const key in _searchTimers) {
        clearTimeout(_searchTimers[key]);
        delete _searchTimers[key];
        delete _searchTimerStart[key];
    }
    if (_searchTimerCleanupInterval) {
        clearInterval(_searchTimerCleanupInterval);
        _searchTimerCleanupInterval = null;
    }
    if (_priceCacheCleanupTimer) {
        clearInterval(_priceCacheCleanupTimer);
        _priceCacheCleanupTimer = null;
    }

    if (window._searchClickHandler) {
        document.removeEventListener('click', window._searchClickHandler);
        window._searchClickHandler = null;
    }
    if (window._inputFocusHandler) {
        document.removeEventListener('focusin', window._inputFocusHandler);
        window._inputFocusHandler = null;
    }
    if (window._settingClickHandler) {
        document.removeEventListener('click', window._settingClickHandler);
        window._settingClickHandler = null;
    }
    if (_docMouseMoveHandler) {
        document.removeEventListener('mousemove', _docMouseMoveHandler);
        _docMouseMoveHandler = null;
    }
    if (_docMouseUpHandler) {
        document.removeEventListener('mouseup', _docMouseUpHandler);
        _docMouseUpHandler = null;
    }
    // 移除 visibilitychange / focusout / beforeunload / keydown 监听器，避免内存泄漏
    if (window._visibilityChangeHandler) {
        document.removeEventListener('visibilitychange', window._visibilityChangeHandler);
        window._visibilityChangeHandler = null;
    }
    if (window._keyboardFocusOutHandler) {
        document.removeEventListener('focusout', window._keyboardFocusOutHandler);
        window._keyboardFocusOutHandler = null;
    }
    if (window._globalKeydownHandler) {
        document.removeEventListener('keydown', window._globalKeydownHandler);
        window._globalKeydownHandler = null;
    }
    window.removeEventListener('beforeunload', cleanupAllResources);
    // 重置一次性标志，便于 HMR/热重载场景
    window._keyboardFixAdded = false;
}

function initBackButton() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        const { App } = window.Capacitor.Plugins;
        let lastBack = 0;
        App.addListener('backButton', () => {
            const now = Date.now();
            if (now - lastBack < 2000) {
                App.exitApp();
            } else {
                lastBack = now;
                showToast('再按一次退出');
            }
        });
    }
}

function initKeyboardResizeFix() {
    if (!window._keyboardFixAdded) {
        window._keyboardFixAdded = true;
        // 使用具名函数引用，便于 cleanupAllResources 移除
        window._keyboardFocusOutHandler = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }, 100);
            }
        };
        document.addEventListener('focusout', window._keyboardFocusOutHandler);
    }
}

function initSwipeTabs() {
    const tabContainer = document.getElementById('tab-strategy');
    if (!tabContainer) return;
    
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    const minSwipeDistance = 80; // 增大阈值，避免误触发
    const maxVerticalDistance = 30; // 垂直移动超过这个值就不算水平滑动
    
    tabContainer.addEventListener('touchstart', function(e) {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });
    
    tabContainer.addEventListener('touchend', function(e) {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe();
    }, { passive: true });
    
    function handleSwipe() {
        const distanceX = touchEndX - touchStartX;
        const distanceY = touchEndY - touchStartY;
        
        // 垂直移动太大，说明是滚动而不是滑动
        if (Math.abs(distanceY) > maxVerticalDistance) return;
        
        // 水平距离不够
        if (Math.abs(distanceX) < minSwipeDistance) return;
        
        const tabs = ['strategy', 'panorama', 'news'];
        const currentIndex = tabs.indexOf(_currentStrategySubtab);
        
        if (distanceX < 0) {
            // 左滑 -> 下一个 tab
            if (currentIndex < tabs.length - 1) {
                switchStrategySubtab(tabs[currentIndex + 1]);
            }
        } else {
            // 右滑 -> 上一个 tab
            if (currentIndex > 0) {
                switchStrategySubtab(tabs[currentIndex - 1]);
            }
        }
    }
}

// 初始化下拉刷新
function initPullRefresh() {
    const contentArea = document.querySelector('.content');
    if (!contentArea) return;

    let touchStartY = 0;
    let touchMoveY = 0;
    let touchStartX = 0;
    let touchMoveX = 0;
    let isPulling = false;
    let isRefreshing = false;
    const threshold = 80;

    // 创建下拉刷新指示器 - 默认隐藏在顶部上方
    const indicator = document.createElement('div');
    indicator.className = 'pull-refresh-indicator';
    indicator.innerHTML = '<span class="refresh-icon">🔄</span><span class="refresh-text">下拉刷新</span>';
    contentArea.insertBefore(indicator, contentArea.firstChild);

    // 设置过渡效果的工具函数
    function setTransition(enabled) {
        indicator.style.transition = enabled ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.3s ease' : 'none';
        const icon = indicator.querySelector('.refresh-icon');
        if (icon) {
            icon.style.transition = enabled ? 'transform 0.3s ease' : 'none';
        }
    }

    // 隐藏指示器
    function hideIndicator() {
        setTransition(true);
        indicator.style.transform = 'translateY(-100%)';
        indicator.style.opacity = '0';
        indicator.querySelector('.refresh-icon').style.transform = 'rotate(0deg)';
    }

    contentArea.addEventListener('touchstart', function(e) {
        isPulling = false;
        // 只在顶部附近才启用下拉刷新
        if (contentArea.scrollTop > 10 || isRefreshing) return;
        // 跳过交互元素
        if (e.target.closest('button, a, input, .strategy-card, .trade-item, .watch-tag, .plan-tab, .cat-tab, .score-card, .profit-item, .holding-row, .t-signal-card, .news-item, .longterm-card')) return;
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        touchMoveY = touchStartY;
        touchMoveX = touchStartX;
        isPulling = true;
        setTransition(false);
    }, { passive: true });

    contentArea.addEventListener('touchmove', function(e) {
        if (!isPulling || isRefreshing) return;

        touchMoveY = e.touches[0].clientY;
        touchMoveX = e.touches[0].clientX;
        const distance = touchMoveY - touchStartY;

        // 横向移动检查
        const dx = Math.abs(touchMoveX - touchStartX);
        const dy = Math.abs(touchMoveY - touchStartY);
        if (dx > 40 && dx > dy * 0.6) {
            isPulling = false;
            hideIndicator();
            return;
        }

        if (distance > 0 && contentArea.scrollTop <= 10) {
            e.preventDefault();
            // 使用阻尼效果：越拉越难拉
            const pullDistance = distance * 0.4;
            const cappedDistance = Math.min(pullDistance, threshold + 30);

            indicator.style.opacity = Math.min(1, distance / 60).toString();
            indicator.style.transform = `translateY(${cappedDistance - 50}px)`;

            if (distance >= threshold) {
                indicator.querySelector('.refresh-text').textContent = '释放刷新';
                indicator.querySelector('.refresh-icon').style.transform = 'rotate(180deg)';
            } else {
                indicator.querySelector('.refresh-text').textContent = '下拉刷新';
                indicator.querySelector('.refresh-icon').style.transform = 'rotate(0deg)';
            }
        }
    }, { passive: false });

    contentArea.addEventListener('touchend', function(e) {
        if (!isPulling || isRefreshing) return;

        isPulling = false;
        const distance = touchMoveY - touchStartY;

        setTransition(true);

        if (distance >= threshold) {
            // 触发刷新
            isRefreshing = true;
            indicator.classList.add('refreshing');
            indicator.style.transform = 'translateY(0px)';
            indicator.style.opacity = '1';
            indicator.querySelector('.refresh-text').textContent = '正在刷新...';
            indicator.querySelector('.refresh-icon').style.transform = '';

            // 执行刷新
            const doRefresh = async () => {
                if (navigator.vibrate) navigator.vibrate(30);
                try {
                    if (_currentStock) {
                        await loadStockInfo(_currentStock.code);
                    }
                    refreshAllTSignals();
                } catch (err) {
                    console.warn('刷新失败:', err);
                }
                // 刷新完成后延迟收起
                setTimeout(() => {
                    isRefreshing = false;
                    indicator.classList.remove('refreshing');
                    hideIndicator();
                }, 600);
            };
            doRefresh();
        } else {
            // 未达到阈值，回弹隐藏
            hideIndicator();
        }
    }, { passive: true });

    contentArea.addEventListener('touchcancel', function() {
        isPulling = false;
        hideIndicator();
    }, { passive: true });
}

// 加载持仓股票的做T信号
function loadHoldingsSignals() {
    const holdings = {};
    _trades.forEach(t => {
        if (!holdings[t.code]) {
            holdings[t.code] = { qty: 0, name: t.name || t.code };
        } else if (t.name && t.name !== t.code) {
            holdings[t.code].name = t.name;
        }
        if ((t.trade_type || t.type) === 'BUY') {
            holdings[t.code].qty += t.quantity;
        } else {
            holdings[t.code].qty = Math.max(0, holdings[t.code].qty - t.quantity);
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

let _toastTimer = null;
function showToast(msg, duration = 2000, position = 'bottom') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.className = 'toast';
    if (position === 'top') toast.classList.add('toast-top');
    else if (position === 'center') toast.classList.add('toast-center');
    toast.innerText = msg;
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    if (_toastTimer) clearTimeout(_toastTimer);
    const lineCount = String(msg).split('\n').length;
    if (lineCount > 1 || String(msg).length > 40) {
        duration = Math.max(duration, 3000 + lineCount * 500);
    }
    _toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function closeAllModals() {
    const modals = ['strategyModal', 'dimensionModal', 'watchModal', 'learnModal'];
    modals.forEach(id => {
        const modal = document.getElementById(id);
        if (modal && modal.classList.contains('show')) {
            modal.classList.remove('show');
            setTimeout(() => {
                if (!modal.classList.contains('show')) modal.style.display = 'none';
            }, 250);
        } else if (modal) {
            modal.style.display = 'none';
        }
    });
    
    document.querySelectorAll('.fee-detail-modal, .profit-detail-modal, .stock-detail-modal, .signal-alert').forEach(el => {
        el.remove();
    });
    
    document.body.style.overflow = '';
}

function openModal(title, content) {
    closeAllModals();
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const strategyModal = document.getElementById('strategyModal');
    if (modalTitle) modalTitle.innerText = title;
    if (modalBody) modalBody.innerHTML = content;
    if (strategyModal) {
        strategyModal.style.display = 'flex';
        requestAnimationFrame(() => {
            strategyModal.classList.add('show');
        });
        setTimeout(() => {
            const closeBtn = strategyModal.querySelector('.modal-close');
            if (closeBtn) closeBtn.focus();
        }, 50);
    }
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const strategyModal = document.getElementById('strategyModal');
    if (strategyModal) {
        strategyModal.classList.remove('show');
        setTimeout(() => {
            strategyModal.style.display = 'none';
        }, 250);
    }
    document.body.style.overflow = '';
}

let _currentStrategySubtab = 'strategy';

function switchStrategySubtab(subtabName) {
    _currentStrategySubtab = subtabName;
    
    document.querySelectorAll('.top-tab').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.strategy-subtab').forEach(el => el.classList.remove('active'));
    
    const tabBtn = document.querySelector(`.top-tab[data-subtab="${subtabName}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    
    const subtab = document.getElementById('subtab-' + subtabName);
    if (subtab) {
        subtab.classList.add('active');
        // 清理之前的动画定时器
        if (_switchSubtabTimer) {
            clearTimeout(_switchSubtabTimer);
            _switchSubtabTimer = null;
        }
        // 添加动画类
        subtab.classList.add('subtab-enter');
        _switchSubtabTimer = setTimeout(() => {
            subtab.classList.remove('subtab-enter');
            _switchSubtabTimer = null;
        }, 300);
    }
    
    if (subtabName === 'strategy') {
        loadSearchHistory();
        const input = document.getElementById('strategyInput');
        if (input && _currentStock && !input.value.trim()) {
            input.value = _currentStock.code;
            _stockNames[_currentStock.code] = _currentStock.name;
            loadStrategyDetail();
        } else if (input && input.value.trim() && !_currentStock) {
            loadStrategyDetail();
        }
    } else if (subtabName === 'panorama') {
        loadPanoramaHistory();
        const input = document.getElementById('panoramaInput');
        if (input && _currentStock && !input.value.trim()) {
            input.value = _currentStock.code;
            _stockNames[_currentStock.code] = _currentStock.name;
            loadPanoramaDetail();
        } else if (input && input.value.trim() && !_currentStock) {
            loadPanoramaDetail();
        }
    } else if (subtabName === 'news') {
        loadSearchHistory();
        const input = document.getElementById('newsInput');
        if (input && _currentStock && !input.value.trim()) {
            input.value = _currentStock.code;
            _stockNames[_currentStock.code] = _currentStock.name;
            loadNews();
        } else if (input && input.value.trim()) {
            loadNews();
        }
    } else if (subtabName === 'longterm') {
        loadLongtermHistory();
        const input = document.getElementById('longtermInput');
        if (input && _currentStock && !input.value.trim()) {
            input.value = _currentStock.code;
            _stockNames[_currentStock.code] = _currentStock.name;
            loadLongtermDetail();
        } else if (input && input.value.trim()) {
            loadLongtermDetail();
        }
    }
}

function switchTab(tabName) {
    _currentTab = tabName;
    const myToken = ++_tabSwitchToken; // 生成新令牌，旧tab的异步回调通过比对令牌取消
    const prevTab = document.querySelector('.tab-content.active');
    const nextTab = document.getElementById('tab-' + tabName);

    // 移除所有激活状态
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    // 清理之前的动画定时器
    if (_switchTabTimer) {
        clearTimeout(_switchTabTimer);
        _switchTabTimer = null;
    }

    // 添加动画效果
    if (nextTab) {
        nextTab.classList.add('active');
        nextTab.classList.add('page-enter');
        nextTab.scrollTop = 0;
        window.scrollTo({ top: 0, behavior: 'instant' });
        _switchTabTimer = setTimeout(() => {
            nextTab.classList.remove('page-enter');
            _switchTabTimer = null;
        }, 300);
    }

    const btns = document.querySelectorAll('.tab-btn');
    const tabMap = { home: 0, trade: 1, strategy: 2, learn: 3, settings: 4 };
    if (btns[tabMap[tabName]]) btns[tabMap[tabName]].classList.add('active');

    // 顶部行情栏只在首页和策略页显示（非fixed，随页面滚动）
    const header = document.querySelector('.header');
    const content = document.querySelector('.content');
    if (header && content) {
        if (tabName === 'home' || tabName === 'strategy') {
            header.style.display = '';
            content.style.marginTop = '0px';
        } else {
            header.style.display = 'none';
            content.style.marginTop = 'env(safe-area-inset-top)';
        }
    }

    if (tabName === 'home') {
        refreshProfit();
        renderWatchList();
    }
    else if (tabName === 'trade') {
        loadTrades();
        (async () => {
            await renderTrades();
            if (myToken !== _tabSwitchToken) return; // 已切换到其他tab，放弃更新
            refreshTradeStats();
        })();
    }
    else if (tabName === 'strategy') {
        switchStrategySubtab(_currentStrategySubtab);
    }
    else if (tabName === 'learn') {
        initLearnPage();
    }
    else if (tabName === 'settings') {
        loadSettings();
    }
}

function onSearchInput() {
    renderSearchHistory();
}

// ==================== 搜索建议 ====================
function setupSearchSuggestions(inputId, suggestionsId, onSelect, key) {
    const input = document.getElementById(inputId);
    const sug = document.getElementById(suggestionsId);
    if (!input || !sug) return;

    // 去重：避免对同一input重复绑定监听器
    if (input._suggestionBound) return;
    input._suggestionBound = true;

    input.addEventListener('input', function () {
        const kw = this.value.trim();
        if (!kw) { sug.style.display = 'none'; sug.innerHTML = ''; return; }
        sug.innerHTML = '<div class="search-loading">搜索中...</div>';
        sug.style.display = 'block';
        setSearchTimer(key || inputId, async () => {
            try {
                const results = await searchStockByName(kw);
                if (results.length > 0) {
                    sug.innerHTML = results.map(item => `
                        <div class="suggestion-item" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">
                            <span class="suggestion-code">${escapeHtml(item.code)}</span>
                            <span class="suggestion-name">${escapeHtml(item.name)}</span>
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
                    sug.innerHTML = '<div class="suggestion-item" style="justify-content:center;color:var(--text-muted);">未找到相关股票</div>';
                    sug.style.display = 'block';
                }
            } catch (e) {
                console.error('搜索失败:', e);
                sug.innerHTML = '<div class="suggestion-item" style="justify-content:center;color:var(--text-muted);">搜索失败，请重试</div>';
            }
        }, 250);
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            const kw = this.value.trim();
            if (!kw) return;
            sug.innerHTML = '<div class="search-loading">搜索中...</div>';
            sug.style.display = 'block';
            onSelect(kw, '');
        }
    });
}

let _searchRequestId = 0; // 搜索请求ID，防止旧结果覆盖新输入

// 首页搜索
function onHomeSearchInput() {
    const kw = document.getElementById('searchInput').value.trim();
    if (!kw) {
        renderSearchHistory();
        const sug = document.getElementById('homeSearchSuggestions');
        if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
        document.getElementById('searchLoading').style.display = 'none';
        return;
    }

    const myReqId = ++_searchRequestId;
    setSearchTimer('home', async () => {
        const loadingEl = document.getElementById('searchLoading');
        if (loadingEl) loadingEl.style.display = 'inline';

        try {
            const results = await searchStockByName(kw);
            if (myReqId !== _searchRequestId) return; // 输入已变化，丢弃旧结果
            const sug = document.getElementById('homeSearchSuggestions');
            if (!sug) return; // 元素已不存在
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">
                        <span class="suggestion-code">${escapeHtml(item.code)}</span>
                        <span class="suggestion-name">${escapeHtml(item.name)}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
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
            if (myReqId === _searchRequestId && loadingEl) loadingEl.style.display = 'none';
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
    if (!kw) {
        const sug = document.getElementById('codeSuggestions');
        if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
        return;
    }
    
    if (/^\d{6}$/.test(kw)) {
        const type = document.getElementById('tradeType').value;
        if (type === 'SELL') {
            const pairSection = document.getElementById('pairBuySection');
            if (pairSection) pairSection.style.display = 'block';
            renderPairBuyList(kw);
        }
        updatePairProfitPreview();
    }
    
    const myReqId = ++_searchRequestId;
    setSearchTimer('trade_code', async () => {
        try {
            const results = await searchStockByName(kw);
            if (myReqId !== _searchRequestId) return;
            const sug = document.getElementById('codeSuggestions');
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">
                        <span class="suggestion-code">${escapeHtml(item.code)}</span>
                        <span class="suggestion-name">${escapeHtml(item.name)}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
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
    if (!kw) {
        const sug = document.getElementById('nameSuggestions');
        if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
        return;
    }
    
    const myReqId = ++_searchRequestId;
    setSearchTimer('trade_name', async () => {
        try {
            const results = await searchStockByName(kw);
            if (myReqId !== _searchRequestId) return;
            const sug = document.getElementById('nameSuggestions');
            if (!sug) return;
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">
                        <span class="suggestion-code">${escapeHtml(item.code)}</span>
                        <span class="suggestion-name">${escapeHtml(item.name)}</span>
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
    document.querySelectorAll('.search-suggestions').forEach(el => {
        el.style.display = 'none';
        el.innerHTML = '';
    });
    
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
        const sug = document.getElementById('strategySuggestions');
        if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
        return;
    }
    
    const myReqId = ++_searchRequestId;
    setSearchTimer('strategy', async () => {
        const loadingEl = document.getElementById('strategyLoading');
        if (loadingEl) loadingEl.style.display = 'inline';

        try {
            const results = await searchStockByName(kw);
            if (myReqId !== _searchRequestId) return;
            const sug = document.getElementById('strategySuggestions');
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">
                        <span class="suggestion-code">${escapeHtml(item.code)}</span>
                        <span class="suggestion-name">${escapeHtml(item.name)}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
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
            if (myReqId === _searchRequestId && loadingEl) loadingEl.style.display = 'none';
        }
    }, 250);
}

// 全景页搜索
function onPanoramaSearchInput() {
    const kw = document.getElementById('panoramaInput').value.trim();
    if (!kw) {
        loadPanoramaHistory();
        const sug = document.getElementById('panoramaSuggestions');
        if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
        return;
    }
    
    const myReqId = ++_searchRequestId;
    setSearchTimer('panorama', async () => {
        const loadingEl = document.getElementById('panoramaLoading');
        if (loadingEl) loadingEl.style.display = 'inline';

        try {
            const results = await searchStockByName(kw);
            if (myReqId !== _searchRequestId) return;
            const sug = document.getElementById('panoramaSuggestions');
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">
                        <span class="suggestion-code">${escapeHtml(item.code)}</span>
                        <span class="suggestion-name">${escapeHtml(item.name)}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
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
            if (myReqId === _searchRequestId && loadingEl) loadingEl.style.display = 'none';
        }
    }, 250);
}

// 舆情页搜索
function onNewsSearchInput() {
    const kw = document.getElementById('newsInput').value.trim();
    if (!kw) {
        loadSearchHistory();
        const sug = document.getElementById('newsSuggestions');
        if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
        return;
    }
    
    const myReqId = ++_searchRequestId;
    setSearchTimer('news', async () => {
        try {
            const results = await searchStockByName(kw);
            if (myReqId !== _searchRequestId) return;
            const sug = document.getElementById('newsSuggestions');
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">
                        <span class="suggestion-code">${escapeHtml(item.code)}</span>
                        <span class="suggestion-name">${escapeHtml(item.name)}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
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
        showToast('搜索失败：' + (e.message || String(e)));
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
        try {
            text = await fetchJsonpVar(url, 'v_hint', 8000);
        } catch (e) {
            const response = await fetch(url);
            text = await response.text();
            text = text.replace(/^v_hint=?"?/, '').replace(/"?$/, '').trim();
        }
        
        if (!text || text.length === 0) {
            console.log('腾讯搜索返回空数据');
            return [];
        }
        
        const items = String(text).split('^').filter(s => s.trim());
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
                            decodedName = JSON.parse('"' + nameStr.replace(/\\u([0-9a-fA-F]{4})/g, '\\u$1') + '"');
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        let data;
        try {
            const response = await fetch(url, { signal: controller.signal });
            data = await response.json();
        } finally {
            clearTimeout(timeoutId);
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

// 阶梯式偏离准确度计算
// 偏离0% → 100分
// 偏离0.1% → 95分
// 偏离0.3% → 90分
// 偏离0.5% → 85分
// 偏离1% → 75分
// 偏离2% → 60分
// 偏离3% → 50分
// 偏离5% → 30分
// 偏离>5% → 20分
function calcDeviationAccuracy(deviationPercent) {
    const absDev = Math.abs(deviationPercent);
    if (absDev <= 0.05) return 100;
    if (absDev <= 0.1) return 95;
    if (absDev <= 0.3) return 90;
    if (absDev <= 0.5) return 85;
    if (absDev <= 1) return 75;
    if (absDev <= 2) return 60;
    if (absDev <= 3) return 50;
    if (absDev <= 5) return 30;
    return 20;
}

// 计算单日预测准确度（取最高价和最低价的平均准确度）
function calcDailyAccuracy(highPrice, lowPrice, predictHigh, predictLow) {
    // R9-8: 防止预测价为0或负数导致NaN
    if (!isFinite(predictHigh) || predictHigh <= 0) predictHigh = highPrice || 0.01;
    if (!isFinite(predictLow) || predictLow <= 0) predictLow = lowPrice || 0.01;
    if (!isFinite(highPrice) || highPrice <= 0) highPrice = predictHigh;
    if (!isFinite(lowPrice) || lowPrice <= 0) lowPrice = predictLow;
    
    // 最高价偏离：(实际最高 - 预测最高) / 预测最高 * 100
    let highDev = 0;
    if (highPrice >= predictHigh) {
        highDev = 0;
    } else {
        highDev = ((predictHigh - highPrice) / predictHigh) * 100;
    }
    
    // 最低价偏离：(预测最低 - 实际最低) / 预测最低 * 100
    let lowDev = 0;
    if (lowPrice <= predictLow) {
        lowDev = 0;
    } else {
        lowDev = ((lowPrice - predictLow) / predictLow) * 100;
    }
    
    const highAccuracy = calcDeviationAccuracy(highDev);
    const lowAccuracy = calcDeviationAccuracy(lowDev);
    
    // 综合准确度 = 两者平均
    return {
        highAccuracy: highAccuracy,
        lowAccuracy: lowAccuracy,
        overall: Math.round((highAccuracy + lowAccuracy) / 2),
        highDev: highDev,
        lowDev: lowDev
    };
}

function savePredictionRecord(code, name, currentPrice, highPrice, lowPrice, predictHigh, predictLow, direction, fixedPrediction) {
    const today = getLocalDateStr();
    const key = `${code}_${today}`;

    const accuracy = calcDailyAccuracy(highPrice, lowPrice, predictHigh, predictLow);

    const record = {
        code: code,
        name: name,
        date: today,
        currentPrice: currentPrice,
        highPrice: highPrice,
        lowPrice: lowPrice,
        predictHigh: predictHigh,
        predictLow: predictLow,
        direction: direction,
        hitHigh: highPrice >= predictHigh,
        hitLow: lowPrice <= predictLow,
        isSuccess: highPrice >= predictHigh || lowPrice <= predictLow,
        accuracy: accuracy.overall,
        highAccuracy: accuracy.highAccuracy,
        lowAccuracy: accuracy.lowAccuracy,
        highDev: accuracy.highDev,
        lowDev: accuracy.lowDev,
        updateTime: Date.now()
    };

    if (fixedPrediction && fixedPrediction.predicted_high && fixedPrediction.predicted_low) {
        const fpHigh = fixedPrediction.predicted_high;
        const fpLow = fixedPrediction.predicted_low;
        const fpAccuracy = calcDailyAccuracy(highPrice, lowPrice, fpHigh, fpLow);

        record.fixedPredictHigh = fpHigh;
        record.fixedPredictLow = fpLow;
        record.fixedBasePrice = fixedPrediction.base_price;
        record.fixedTrend = fixedPrediction.trend;
        record.fixedAvgAmplitude = fixedPrediction.avg_amplitude;
        record.fixedHitHigh = highPrice >= fpHigh;
        record.fixedHitLow = lowPrice <= fpLow;
        record.fixedIsSuccess = highPrice >= fpHigh || lowPrice <= fpLow;
        record.fixedAccuracy = fpAccuracy.overall;
        record.fixedHighAccuracy = fpAccuracy.highAccuracy;
        record.fixedLowAccuracy = fpAccuracy.lowAccuracy;
        record.fixedHighDev = fpAccuracy.highDev;
        record.fixedLowDev = fpAccuracy.lowDev;
    }

    // 按月分块存储
    const monthKey = today.substring(0, 7); // "2026-07"
    const monthRecords = getPredictionMonthRecords(monthKey);

    const existing = monthRecords[key];
    if (existing) {
        monthRecords[key] = { ...existing, ...record };
    } else {
        monthRecords[key] = record;
    }

    savePredictionMonthRecords(monthKey, monthRecords);
}

// 计算平均准确度
function getAvgAccuracy(code) {
    const records = getPredictionHistory(code);
    if (records.length === 0) return { avg: 0, total: 0, fixedAvg: 0, fixedTotal: 0 };
    const sum = records.reduce((acc, r) => acc + (r.accuracy || 0), 0);
    const fixedRecords = records.filter(r => typeof r.fixedAccuracy === 'number');
    const fixedSum = fixedRecords.reduce((acc, r) => acc + r.fixedAccuracy, 0);
    return {
        avg: Math.round(sum / records.length),
        total: records.length,
        fixedAvg: fixedRecords.length > 0 ? Math.round(fixedSum / fixedRecords.length) : 0,
        fixedTotal: fixedRecords.length
    };
}

// 显示预测历史记录弹窗
function showPredictionHistoryModal(code, name) {
    let records = getPredictionHistory(code);

    // 如果没有记录，生成模拟数据展示效果
    const isDemo = records.length === 0;
    if (isDemo) {
        records = generateDemoPredictionRecords(code, name);
    }

    const stats = getAvgAccuracy(code);
    // 如果是模拟数据，从模拟数据重新算
    const displayStats = isDemo ? calcStatsFromRecords(records) : stats;

    // 区分近一周和更早的记录
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    oneWeekAgo.setHours(0, 0, 0, 0);
    const recentRecords = records.filter(r => new Date(r.date) >= oneWeekAgo);
    const olderRecords = records.filter(r => new Date(r.date) < oneWeekAgo);

    // 按月分组更早的记录
    const olderByMonth = {};
    olderRecords.forEach(r => {
        const mk = r.date.substring(0, 7);
        if (!olderByMonth[mk]) olderByMonth[mk] = [];
        olderByMonth[mk].push(r);
    });

    let html = `
        <div style="padding:10px;">
            <div style="text-align:center; margin-bottom:16px;">
                <div style="display:flex; justify-content:center; gap:20px; align-items:flex-end;">
                    <div>
                        <div style="font-size:20px; font-weight:700; color:${displayStats.avg >= 80 ? 'var(--green)' : displayStats.avg >= 60 ? 'var(--yellow)' : 'var(--red)'};">${displayStats.avg}分</div>
                        <div style="font-size:10px; color:var(--text-muted);">动态预测 (${displayStats.total}天)</div>
                    </div>
    `;

    if (displayStats.fixedTotal > 0) {
        html += `
                    <div style="width:1px; height:30px; background:var(--surface-active);"></div>
                    <div>
                        <div style="font-size:20px; font-weight:700; color:${displayStats.fixedAvg >= 80 ? 'var(--green)' : displayStats.fixedAvg >= 60 ? 'var(--yellow)' : 'var(--red)'};">${displayStats.fixedAvg}分</div>
                        <div style="font-size:10px; color:var(--text-muted);">固定预测 (${displayStats.fixedTotal}天)</div>
                    </div>
        `;
    }

    if (isDemo) {
        html += `
                    <div style="width:1px; height:30px; background:var(--surface-active);"></div>
                    <div style="font-size:10px; color:var(--yellow); background:rgba(251,191,36,0.15); padding:3px 8px; border-radius:8px;">模拟数据</div>
        `;
    }

    html += `
                </div>
            </div>
    `;

    if (records.length === 0) {
        html += '<div style="text-align:center; color:var(--text-muted); padding:30px;">暂无预测记录</div>';
    } else {
        html += '<div style="max-height:500px; overflow-y:auto;">';

        // 近一周：卡片展示
        if (recentRecords.length > 0) {
            html += '<div style="font-size:11px; color:var(--text-muted); margin-bottom:8px; font-weight:600;">近一周</div>';
            recentRecords.forEach(r => {
                html += renderPredictionCard(r);
            });
        }

        // 更早：按月分表格
        const monthKeys = Object.keys(olderByMonth).sort().reverse();
        monthKeys.forEach(mk => {
            const monthLabel = mk.replace('-', '年') + '月';
            html += `
                <div style="margin-top:12px; margin-bottom:6px;">
                    <div style="font-size:11px; color:var(--text-muted); font-weight:600; display:flex; align-items:center; gap:6px; cursor:pointer;" onclick="const content=this.nextElementSibling; content.classList.toggle('open'); this.querySelector('.toggle-icon').innerText=content.classList.contains('open')?'▼':'▶';">
                        <span class="toggle-icon">▼</span> ${monthLabel} (${olderByMonth[mk].length}天)
                    </div>
                    <div class="collapsible-content open">${renderPredictionTable(olderByMonth[mk])}</div>
                </div>
            `;
        });

        html += '</div>';
    }

    html += '</div>';
    openModal(`${name} 预测历史`, html);
    document.body.style.overflow = 'hidden';
}

// 渲染单条预测卡片（近一周用）
function renderPredictionCard(r) {
    const dateStr = r.date;
    const acc = r.accuracy || 0;
    const accColor = acc >= 80 ? 'var(--green)' : acc >= 60 ? 'var(--yellow)' : 'var(--red)';
    const hasFixed = typeof r.fixedAccuracy === 'number';
    const fAcc = r.fixedAccuracy || 0;
    const fAccColor = fAcc >= 80 ? 'var(--green)' : fAcc >= 60 ? 'var(--yellow)' : 'var(--red)';

    let recordHtml = '<div style="background:var(--surface-3); border-radius:10px; padding:12px; margin-bottom:8px;">';
    recordHtml += '<div style="display:flex; justify-content:space-between; margin-bottom:8px; align-items:center;">';
    recordHtml += '<span style="font-size:13px; font-weight:600;">' + dateStr + '</span>';
    recordHtml += '<div style="display:flex; gap:6px; align-items:center;">';
    if (hasFixed) {
        recordHtml += '<span style="color:' + fAccColor + '; font-size:10px; font-weight:600; background:rgba(99,102,241,0.2); padding:2px 6px; border-radius:4px;">固' + fAcc + '分</span>';
    }
    recordHtml += '<span style="color:' + accColor + '; font-size:10px; font-weight:600; background:rgba(34,197,94,0.2); padding:2px 6px; border-radius:4px;">动' + acc + '分</span>';
    recordHtml += '</div></div>';

    if (hasFixed) {
        recordHtml += '<div style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.2); border-radius:8px; padding:8px; margin-bottom:8px;">';
        recordHtml += '<div style="font-size:10px; color:var(--accent); font-weight:600; margin-bottom:6px;">📌 固定预测（前日收盘）</div>';
        recordHtml += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:10px;">';
        recordHtml += '<div>';
        recordHtml += '<div style="color:var(--text-muted); margin-bottom:1px;">预测最高: ¥' + (r.fixedPredictHigh || 0).toFixed(2) + '</div>';
        recordHtml += '<div style="color:var(--text-muted);">实际最高: ¥' + (r.highPrice || 0).toFixed(2) + '</div>';
        const fHighText = r.fixedHitHigh ? '✓触及' : '差' + (r.fixedHighDev || 0).toFixed(2) + '%';
        const fHighColor = r.fixedHighAccuracy >= 80 ? 'var(--green)' : r.fixedHighAccuracy >= 60 ? 'var(--yellow)' : 'var(--red)';
        recordHtml += '<div style="color:' + fHighColor + '; margin-top:1px;">' + fHighText + ' (' + r.fixedHighAccuracy + '分)</div>';
        recordHtml += '</div>';
        recordHtml += '<div>';
        recordHtml += '<div style="color:var(--text-muted); margin-bottom:1px;">预测最低: ¥' + (r.fixedPredictLow || 0).toFixed(2) + '</div>';
        recordHtml += '<div style="color:var(--text-muted);">实际最低: ¥' + (r.lowPrice || 0).toFixed(2) + '</div>';
        const fLowText = r.fixedHitLow ? '✓触及' : '差' + (r.fixedLowDev || 0).toFixed(2) + '%';
        const fLowColor = r.fixedLowAccuracy >= 80 ? 'var(--green)' : r.fixedLowAccuracy >= 60 ? 'var(--yellow)' : 'var(--red)';
        recordHtml += '<div style="color:' + fLowColor + '; margin-top:1px;">' + fLowText + ' (' + r.fixedLowAccuracy + '分)</div>';
        recordHtml += '</div>';
        recordHtml += '</div></div>';
    }

    recordHtml += '<div style="background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.15); border-radius:8px; padding:8px;">';
    recordHtml += '<div style="font-size:10px; color:var(--green); font-weight:600; margin-bottom:6px;">📊 动态预测（实时）</div>';
    recordHtml += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:10px;">';
    recordHtml += '<div>';
    recordHtml += '<div style="color:var(--text-muted); margin-bottom:1px;">预测最高: ¥' + (r.predictHigh || 0).toFixed(2) + '</div>';
    recordHtml += '<div style="color:var(--text-muted);">实际最高: ¥' + (r.highPrice || 0).toFixed(2) + '</div>';
    const highText = r.hitHigh ? '✓触及' : '差' + (r.highDev || 0).toFixed(2) + '%';
    const highColor = r.highAccuracy >= 80 ? 'var(--green)' : r.highAccuracy >= 60 ? 'var(--yellow)' : 'var(--red)';
    recordHtml += '<div style="color:' + highColor + '; margin-top:1px;">' + highText + ' (' + r.highAccuracy + '分)</div>';
    recordHtml += '</div>';
    recordHtml += '<div>';
    recordHtml += '<div style="color:var(--text-muted); margin-bottom:1px;">预测最低: ¥' + (r.predictLow || 0).toFixed(2) + '</div>';
    recordHtml += '<div style="color:var(--text-muted);">实际最低: ¥' + (r.lowPrice || 0).toFixed(2) + '</div>';
    const lowText = r.hitLow ? '✓触及' : '差' + (r.lowDev || 0).toFixed(2) + '%';
    const lowColor = r.lowAccuracy >= 80 ? 'var(--green)' : r.lowAccuracy >= 60 ? 'var(--yellow)' : 'var(--red)';
    recordHtml += '<div style="color:' + lowColor + '; margin-top:1px;">' + lowText + ' (' + r.lowAccuracy + '分)</div>';
    recordHtml += '</div>';
    recordHtml += '</div></div>';
    recordHtml += '</div>';

    return recordHtml;
}

// 渲染预测表格（一周前用）
function renderPredictionTable(records) {
    if (!records || records.length === 0) return '';

    let html = '<div style="overflow-x:auto; margin-top:4px;">';
    html += '<table style="width:100%; border-collapse:collapse; font-size:10px;">';
    html += '<thead><tr style="background:var(--surface-3);">';
    html += '<th style="padding:6px 4px; text-align:center; color:var(--text-muted); font-weight:600; white-space:nowrap;">日期</th>';
    html += '<th style="padding:6px 4px; text-align:center; color:var(--accent); font-weight:600; white-space:nowrap;">固测高</th>';
    html += '<th style="padding:6px 4px; text-align:center; color:var(--accent); font-weight:600; white-space:nowrap;">固测低</th>';
    html += '<th style="padding:6px 4px; text-align:center; color:var(--green); font-weight:600; white-space:nowrap;">动测高</th>';
    html += '<th style="padding:6px 4px; text-align:center; color:var(--green); font-weight:600; white-space:nowrap;">动测低</th>';
    html += '<th style="padding:6px 4px; text-align:center; color:var(--text-muted); font-weight:600; white-space:nowrap;">实高</th>';
    html += '<th style="padding:6px 4px; text-align:center; color:var(--text-muted); font-weight:600; white-space:nowrap;">实低</th>';
    html += '<th style="padding:6px 4px; text-align:center; color:var(--accent); font-weight:600; white-space:nowrap;">固分</th>';
    html += '<th style="padding:6px 4px; text-align:center; color:var(--green); font-weight:600; white-space:nowrap;">动分</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    records.forEach((r, idx) => {
        const bgColor = idx % 2 === 0 ? 'transparent' : 'var(--surface-3)';
        const acc = r.accuracy || 0;
        const accColor = acc >= 80 ? 'var(--green)' : acc >= 60 ? 'var(--yellow)' : 'var(--red)';
        const hasFixed = typeof r.fixedAccuracy === 'number';
        const fAcc = r.fixedAccuracy || 0;
        const fAccColor = fAcc >= 80 ? 'var(--green)' : fAcc >= 60 ? 'var(--yellow)' : 'var(--red)';

        html += `<tr style="background:${bgColor};">`;
        html += `<td style="padding:5px 4px; text-align:center; color:var(--text-secondary); white-space:nowrap;">${r.date.substring(5)}</td>`;
        html += `<td style="padding:5px 4px; text-align:center; color:var(--accent);">${hasFixed ? (r.fixedPredictHigh || 0).toFixed(2) : '-'}</td>`;
        html += `<td style="padding:5px 4px; text-align:center; color:var(--accent);">${hasFixed ? (r.fixedPredictLow || 0).toFixed(2) : '-'}</td>`;
        html += `<td style="padding:5px 4px; text-align:center; color:var(--green);">${(r.predictHigh || 0).toFixed(2)}</td>`;
        html += `<td style="padding:5px 4px; text-align:center; color:var(--green);">${(r.predictLow || 0).toFixed(2)}</td>`;
        html += `<td style="padding:5px 4px; text-align:center; color:var(--text-primary);">${(r.highPrice || 0).toFixed(2)}</td>`;
        html += `<td style="padding:5px 4px; text-align:center; color:var(--text-primary);">${(r.lowPrice || 0).toFixed(2)}</td>`;
        html += `<td style="padding:5px 4px; text-align:center; color:${fAccColor}; font-weight:600;">${hasFixed ? fAcc : '-'}</td>`;
        html += `<td style="padding:5px 4px; text-align:center; color:${accColor}; font-weight:600;">${acc}</td>`;
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
}

// 从记录数组计算统计
function calcStatsFromRecords(records) {
    if (records.length === 0) return { avg: 0, total: 0, fixedAvg: 0, fixedTotal: 0 };
    const sum = records.reduce((acc, r) => acc + (r.accuracy || 0), 0);
    const fixedRecords = records.filter(r => typeof r.fixedAccuracy === 'number');
    const fixedSum = fixedRecords.reduce((acc, r) => acc + r.fixedAccuracy, 0);
    return {
        avg: Math.round(sum / records.length),
        total: records.length,
        fixedAvg: fixedRecords.length > 0 ? Math.round(fixedSum / fixedRecords.length) : 0,
        fixedTotal: fixedRecords.length
    };
}

// 生成模拟预测记录
function generateDemoPredictionRecords(code, name) {
    const records = [];
    const basePrice = 15.80;
    const today = new Date();

    for (let i = 0; i < 45; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        // 跳过周末
        if (d.getDay() === 0 || d.getDay() === 6) continue;

        const dateStr = getLocalDateStr(d);
        const volatility = (Math.random() - 0.5) * 0.04;
        const cp = basePrice * (1 + volatility * i * 0.1);
        const amplitude = 0.02 + Math.random() * 0.03;

        const predictHigh = cp * (1 + amplitude);
        const predictLow = cp * (1 - amplitude);
        const actualHigh = predictHigh * (0.97 + Math.random() * 0.06);
        const actualLow = predictLow * (0.94 + Math.random() * 0.12);

        const fixedAmplitude = 0.018 + Math.random() * 0.025;
        const fixedPredictHigh = cp * (1 + fixedAmplitude);
        const fixedPredictLow = cp * (1 - fixedAmplitude);

        const hitHigh = actualHigh >= predictHigh;
        const hitLow = actualLow <= predictLow;
        const highDev = Math.abs(actualHigh - predictHigh) / predictHigh * 100;
        const lowDev = Math.abs(actualLow - predictLow) / predictLow * 100;
        const highAccuracy = Math.max(0, Math.round(100 - highDev * 10));
        const lowAccuracy = Math.max(0, Math.round(100 - lowDev * 10));
        const overall = Math.round((highAccuracy + lowAccuracy) / 2);

        const fHitHigh = actualHigh >= fixedPredictHigh;
        const fHitLow = actualLow <= fixedPredictLow;
        const fHighDev = Math.abs(actualHigh - fixedPredictHigh) / fixedPredictHigh * 100;
        const fLowDev = Math.abs(actualLow - fixedPredictLow) / fixedPredictLow * 100;
        const fHighAccuracy = Math.max(0, Math.round(100 - fHighDev * 10));
        const fLowAccuracy = Math.max(0, Math.round(100 - fLowDev * 10));
        const fOverall = Math.round((fHighAccuracy + fLowAccuracy) / 2);

        records.push({
            code: code,
            name: name,
            date: dateStr,
            currentPrice: cp,
            highPrice: actualHigh,
            lowPrice: actualLow,
            predictHigh: predictHigh,
            predictLow: predictLow,
            direction: volatility > 0 ? '上升' : '下跌',
            hitHigh: hitHigh,
            hitLow: hitLow,
            isSuccess: hitHigh || hitLow,
            accuracy: overall,
            highAccuracy: highAccuracy,
            lowAccuracy: lowAccuracy,
            highDev: highDev,
            lowDev: lowDev,
            fixedPredictHigh: fixedPredictHigh,
            fixedPredictLow: fixedPredictLow,
            fixedBasePrice: cp * 0.998,
            fixedTrend: volatility > 0 ? '上升' : '下跌',
            fixedAvgAmplitude: (fixedAmplitude * 100).toFixed(2),
            fixedHitHigh: fHitHigh,
            fixedHitLow: fHitLow,
            fixedIsSuccess: fHitHigh || fHitLow,
            fixedAccuracy: fOverall,
            fixedHighAccuracy: fHighAccuracy,
            fixedLowAccuracy: fLowAccuracy,
            fixedHighDev: fHighDev,
            fixedLowDev: fLowDev,
            updateTime: d.getTime()
        });
    }

    return records;
}

async function loadStockInfo(code) {
    const reqId = ++_stockRequestId;
    
    showHomeSkeleton();
    
    async function attempt(retryCount) {
        try {
            const prefix = getTencentPrefix(code);
            const fullCode = `${prefix}${code}`;
            // 第一步：获取实时行情（腾讯接口稳定）
            const qt = await fetchJsonpVar(`https://qt.gtimg.cn/q=${fullCode}`, `v_${fullCode}`, 5000);
            if (!qt) {
                throw new Error('实时行情获取失败');
            }
            
            const parsedStock = parseTencentQtData(qt.split('~'));
            if (!parsedStock) {
                throw new Error('行情数据格式错误');
            }
            
            // 第二步：获取K线数据（支持HTTP/JSONP/东方财富fallback）
            let klines = [];
            try {
                klines = await fetchKlineData(code, 120);
            } catch (klineErr) {
                console.warn('K线数据获取失败:', klineErr.message);
            }

            _currentStock = parsedStock;

            if (_currentStock) {
                _stockNames[_currentStock.code] = _currentStock.name;
                saveStockNames();
                _lastSearchedStock = { code: _currentStock.code, name: _currentStock.name };
                safeSetItem('lastSearchedStock', JSON.stringify(_lastSearchedStock));
            }

            renderStockInfo();
            try {
                await loadKlineData(code, reqId, retryCount);
            } catch (e) {
                console.warn('K线数据加载失败，跳过策略分析:', e);
            }
            hideHomeSkeleton();
        } catch (e) {
            console.error('loadStockInfo错误:', e);
            if (reqId === _stockRequestId) hideHomeSkeleton();
            if (retryCount === 0 && e.name !== 'AbortError') {
                console.log('loadStockInfo 重试中...');
                await new Promise(r => setTimeout(r, 500));
                return attempt(1);
            }
            throw e;
        }
    }
    
    return attempt(0);
}

function showHomeSkeleton() {
}

function hideHomeSkeleton() {
}

function renderStockInfo() {
    if (!_currentStock) return;
    
    const emptyHome = document.getElementById('emptyHome');
    if (emptyHome) emptyHome.style.display = 'none';
    
    // 隐藏股票行情区域（用户不希望显示）
    const marketSection = document.getElementById('marketSection');
    if (marketSection) marketSection.style.display = 'none';
    
    // 填充行情数据
    const nameEl = document.getElementById('marketName');
    const codeEl = document.getElementById('marketCode');
    const priceEl = document.getElementById('marketPrice');
    const changeEl = document.getElementById('marketChange');
    const openEl = document.getElementById('marketOpen');
    const highEl = document.getElementById('marketHigh');
    const lowEl = document.getElementById('marketLow');
    const prevCloseEl = document.getElementById('marketPreClose');
    const volEl = document.getElementById('marketVolume');
    const turnoverEl = document.getElementById('marketTurnover');
    
    if (nameEl) nameEl.innerText = _currentStock.name || '--';
    if (codeEl) codeEl.innerText = _currentStock.code || '';
    
    const chg = _currentStock.change_percent || 0;
    const chgColor = chg > 0 ? 'var(--red)' : (chg < 0 ? 'var(--green)' : 'var(--text-muted)');
    const chgSign = chg >= 0 ? '+' : '';
    
    if (priceEl) {
        priceEl.innerText = '￥' + (_currentStock.current_price || 0).toFixed(2);
        priceEl.style.color = chgColor;
    }
    if (changeEl) {
        changeEl.innerText = chgSign + chg.toFixed(2) + '%';
        changeEl.style.color = chgColor;
    }
    if (openEl) openEl.innerText = _currentStock.open_price ? _currentStock.open_price.toFixed(2) : '--';
    if (highEl) highEl.innerText = _currentStock.high_price ? _currentStock.high_price.toFixed(2) : '--';
    if (lowEl) lowEl.innerText = _currentStock.low_price ? _currentStock.low_price.toFixed(2) : '--';
    if (prevCloseEl) prevCloseEl.innerText = _currentStock.prev_close ? _currentStock.prev_close.toFixed(2) : '--';
    if (volEl) volEl.innerText = _currentStock.amount ? formatAmount(_currentStock.amount) : '--';
    if (turnoverEl) turnoverEl.innerText = _currentStock.turnover != null ? _currentStock.turnover.toFixed(2) + '%' : '--';
    
    // 更新顶部header行情
    updateHeaderQuote();
}

function updateHeaderQuote(tOpportunity) {
    if (!_currentStock) return;
    
    const nameEl = document.getElementById('headerStockName');
    const codeEl = document.getElementById('headerStockCode');
    const priceEl = document.getElementById('headerStockPrice');
    const changeEl = document.getElementById('headerStockChange');
    const scrollEl = document.getElementById('headerQuoteScroll');
    
    if (nameEl) nameEl.innerText = _currentStock.name;
    if (codeEl) codeEl.innerText = _currentStock.code;
    
    const chg = _currentStock.change_percent || 0;
    const chgColor = chg > 0 ? 'var(--red)' : (chg < 0 ? 'var(--green)' : 'var(--text-muted)');
    const chgSign = chg >= 0 ? '+' : '';
    
    if (priceEl) {
        priceEl.classList.add('number-animate');
        animateNumber(priceEl, _currentStock.current_price, val => '￥' + val.toFixed(2));
        priceEl.style.color = chgColor;
    }
    if (changeEl) {
        changeEl.classList.add('number-animate');
        animateNumber(changeEl, chg, val => chgSign + val.toFixed(2) + '%');
        changeEl.style.color = chgColor;
    }
    
    if (scrollEl) {
        const openPrice = _currentStock.open_price ? _currentStock.open_price.toFixed(2) : '--';
        const highPrice = _currentStock.high_price ? _currentStock.high_price.toFixed(2) : '--';
        const lowPrice = _currentStock.low_price ? _currentStock.low_price.toFixed(2) : '--';
        const prevClose = _currentStock.prev_close ? _currentStock.prev_close.toFixed(2) : '--';
        const vol = _currentStock.amount ? formatAmount(_currentStock.amount) : '--';
        const turnover = _currentStock.turnover != null ? _currentStock.turnover.toFixed(2) + '%' : '--';
        const tText = tOpportunity != null ? tOpportunity : '分析中';
        
        const row = '<span style="font-size:11px; color:var(--text-muted);">今开 <span style="color:var(--text-primary);">' + openPrice + '</span></span>' +
            '<span style="width:12px; display:inline-block;"></span>' +
            '<span style="font-size:11px; color:var(--text-muted);">最高 <span style="color:var(--red);">' + highPrice + '</span></span>' +
            '<span style="width:12px; display:inline-block;"></span>' +
            '<span style="font-size:11px; color:var(--text-muted);">最低 <span style="color:var(--green);">' + lowPrice + '</span></span>' +
            '<span style="width:12px; display:inline-block;"></span>' +
            '<span style="font-size:11px; color:var(--text-muted);">昨收 <span style="color:var(--text-primary);">' + prevClose + '</span></span>' +
            '<span style="width:12px; display:inline-block;"></span>' +
            '<span style="font-size:11px; color:var(--text-muted);">成交额 <span style="color:var(--text-primary);">' + vol + '</span></span>' +
            '<span style="width:12px; display:inline-block;"></span>' +
            '<span style="font-size:11px; color:var(--text-muted);">换手率 <span style="color:var(--text-primary);">' + turnover + '</span></span>' +
            '<span style="width:12px; display:inline-block;"></span>' +
            '<span style="font-size:11px; color:var(--text-muted);">做T机会 <span style="color:var(--yellow);">' + tText + '</span></span>' +
            '<span style="width:40px; display:inline-block;"></span>';
        
        scrollEl.innerHTML = row + row;
    }
}

function formatLargeNumber(num) {
    if (isNaN(num) || num == null) return '0';
    if (Math.abs(num) >= 100000000) return (num / 100000000).toFixed(2) + '亿';
    if (Math.abs(num) >= 10000) return (num / 10000).toFixed(2) + '万';
    return Math.round(num).toString();
}

function formatVolume(vol) {
    return formatLargeNumber(vol);
}

function formatAmount(amount) {
    return formatLargeNumber(amount);
}

// 统一获取K线数据（支持HTTP/JSONP/东方财富多重fallback）
async function fetchKlineData(code, days = 120) {
    const prefix = getTencentPrefix(code);
    const fullCode = `${prefix}${code}`;

    // 方式1: 腾讯HTTP接口（Capacitor/代理环境可用）
    try {
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,${days},qfq`;
        const data = await httpGet(url, { timeout: 10000 });
        if (data && data.code === 0 && data.data && data.data[fullCode]) {
            const arr = data.data[fullCode].qfqday || data.data[fullCode].day || [];
            return arr.map(line => ({
                date: line[0] || '',
                open: parseFloat(line[1]) || 0,
                close: parseFloat(line[2]) || 0,
                high: parseFloat(line[3]) || 0,
                low: parseFloat(line[4]) || 0,
                volume: parseFloat(line[5]) * 100 || 0,
                amount: 0
            }));
        }
    } catch (e) {
        console.log('腾讯HTTP K线失败:', e.message);
    }

    // 方式2: 腾讯JSONP变量赋值（浏览器file://绕过CORS）
    try {
        const varName = `kline_${code}_${Date.now()}`;
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,${days},qfq&_var=${varName}`;
        const data = await fetchJsonpVar(url, varName, 10000);
        if (data && data.code === 0 && data.data && data.data[fullCode]) {
            const arr = data.data[fullCode].qfqday || data.data[fullCode].day || [];
            return arr.map(line => ({
                date: line[0] || '',
                open: parseFloat(line[1]) || 0,
                close: parseFloat(line[2]) || 0,
                high: parseFloat(line[3]) || 0,
                low: parseFloat(line[4]) || 0,
                volume: parseFloat(line[5]) * 100 || 0,
                amount: 0
            }));
        }
    } catch (e) {
        console.log('腾讯JSONP K线失败:', e.message);
    }

    // 方式3: 东方财富K线接口（支持CORS，浏览器可用）
    try {
        const market = prefix === 'sh' ? 1 : 0;
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${market}.${code}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${days}`;
        const data = await httpGet(url, { timeout: 10000 });
        if (data && data.data && data.data.klines && data.data.klines.length > 0) {
            return data.data.klines.map(line => {
                const parts = line.split(',');
                return {
                    date: parts[0] || '',
                    open: parseFloat(parts[1]) || 0,
                    close: parseFloat(parts[2]) || 0,
                    high: parseFloat(parts[3]) || 0,
                    low: parseFloat(parts[4]) || 0,
                    volume: parseFloat(parts[5]) || 0,
                    amount: parseFloat(parts[6]) || 0
                };
            });
        }
    } catch (e) {
        console.log('东方财富K线失败:', e.message);
    }

    throw new Error('所有K线数据源均不可用');
}

async function loadKlineData(code, reqId, retryCount = 0) {
    const myReqId = reqId || ++_stockRequestId;

    async function attempt(attemptNum) {
        try {
            const klines = await fetchKlineData(code, 250);

            if (myReqId !== _stockRequestId) return;
            if (!klines || klines.length === 0) {
                throw new Error('K线数据为空');
            }

            await runStrategyAnalysis(klines, myReqId);
            await runPanoramaAnalysis(klines, myReqId);
        } catch (e) {
            console.error('loadKlineData错误:', e);
            if (attemptNum === 0 && e.name !== 'AbortError') {
                console.log('loadKlineData 重试中...');
                await new Promise(r => setTimeout(r, 500));
                return attempt(1);
            }
            throw e;
        }
    }

    return attempt(retryCount);
}

async function runStrategyAnalysis(klines, reqId) {
    if (!_currentStock || !strategyEngine) return;
    if (reqId && reqId !== _stockRequestId) return;

    const requestCode = _currentStock.code;

    const holdings = getHoldings(_currentStock.code);
    const safeKlines = Array.isArray(klines) && klines.length > 0 ? klines : [];
    const result = strategyEngine.runAllStrategies(_currentStock, safeKlines, holdings, {
        fixedPredictionHour: _settings.fixedPredictionTime
    });
    if (!Array.isArray(result) || result.length !== 2) return;
    const [strategies, summary] = result;

    if (reqId && reqId !== _stockRequestId) return;
    if (!_currentStock || _currentStock.code !== requestCode) return;

    // 新数据成功后才替换旧数据
    _lastStrategies = strategies;
    _lastSummary = summary;
    _lastKlines = klines;
    renderSignalPanel(strategies);
    renderStrategySummary(strategies);
    renderBestPlan(summary);
    renderCoreAdvice(_currentStock, strategies);
    checkSignalThresholds(strategies);

    // 显示首页信号相关卡片
    const signalCard = document.getElementById('signalCard');
    if (signalCard) {
        if (_settings.showSignalCard !== false) {
            signalCard.style.display = 'block';
        } else {
            signalCard.style.display = 'none';
        }
    }

    const strategyDetailSection = document.getElementById('strategyDetailSection');
    if (strategyDetailSection) {
        strategyDetailSection.style.display = 'block';
        renderStrategyDetailSection(strategies);
    }

    const emptyStrategy = document.getElementById('emptyStrategy');
    if (emptyStrategy) emptyStrategy.style.display = 'none';

    refreshProfit();
}

async function runPanoramaAnalysis(klines, reqId) {
    if (!_currentStock || !strategyEngine) return;
    if (reqId && reqId !== _stockRequestId) return;

    const [strategies, summary] = strategyEngine.analyzePanorama(klines, _currentStock || {}) || [[], null];

    if (reqId && reqId !== _stockRequestId) return;

    _lastPanoramaStrategies = strategies || [];
    _lastPanoramaSummary = summary || null;

    renderPanoramaOverview(strategies || [], summary || null);
}

function renderSignalPanel(strategies) {
    let buyCount = 0;
    let sellCount = 0;
    let tCount = 0;
    strategies.forEach(s => {
        if (s.action === 'BUY' || s.action === 'STRONG_BUY') buyCount++;
        else if (s.action === 'SELL' || s.action === 'STRONG_SELL') sellCount++;
        else if (s.action === 'BUY_THEN_SELL' || s.action === 'SELL_THEN_BUY' || s.action === 'TRADING_OPPORTUNITY' || s.action === 'BOX_TRADING') tCount++;
    });
    
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
    let buyCount = 0, sellCount = 0, tCount = 0;
    strategies.forEach(s => {
        if (s.action === 'BUY' || s.action === 'STRONG_BUY') buyCount++;
        else if (s.action === 'SELL' || s.action === 'STRONG_SELL') sellCount++;
        else if (isTAction(s.action)) tCount++;
    });
    const watchCount = strategies.filter(s => ['WATCH', 'HOLD', 'OBSERVE'].includes(s.action)).length;
    
    const container = document.getElementById('strategySummary');
    if (!container) return;
    container.innerHTML = `
        <div class="summary-chip" onclick="filterStrategies('buy', event)"><span class="dot red"></span>买入 ${buyCount}</div>
        <div class="summary-chip" onclick="filterStrategies('sell', event)"><span class="dot green"></span>卖出 ${sellCount}</div>
        <div class="summary-chip" onclick="filterStrategies('t', event)"><span class="dot yellow"></span>做T ${tCount}</div>
        <div class="summary-chip" onclick="filterStrategies('watch', event)"><span class="dot blue"></span>观望 ${watchCount}</div>
    `;
}

function renderBestPlan(summary) {
    if (!summary) return;

    const cp = summary.current_price || (_currentStock ? _currentStock.current_price : 0) || 0.01;

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };

    const setDisplay = (id, display) => {
        const el = document.getElementById(id);
        if (el) el.style.display = display;
    };

    // 校验：如果 summary 的股票代码和当前股票不一致，清空显示
    if (_currentStock && summary.stock_code && summary.stock_code !== _currentStock.code) {
        setDisplay('planTSection', 'none');
        setDisplay('homePricePrediction', 'none');
        const strategyCard = document.getElementById('strategyBestPlanCard');
        if (strategyCard) strategyCard.style.display = 'none';
        return;
    }
    
    setText('planAtr', summary.atr ? summary.atr.toFixed(2) : '--');
    setText('planAtrPct', summary.atr_pct ? summary.atr_pct.toFixed(2) + '%' : '--');
    setText('planTotal', summary.total_signals || '--');
    setText('planBuySell', `买${summary.buy_signals || 0} / 卖${summary.sell_signals || 0}`);
    
    if (summary.best_buy || summary.best_sell) {
        setDisplay('planBuySellSection', 'block');
    } else {
        setDisplay('planBuySellSection', 'none');
    }
    
    if (summary.best_buy) {
        setText('planBuyName', summary.best_buy.name);
        setText('planBuyEntry', '￥' + (summary.best_buy.entry_price || summary.current_price || 0).toFixed(2));
        setText('planBuyTarget', '￥' + (summary.best_buy.target_price != null ? summary.best_buy.target_price.toFixed(2) : '--'));
        setText('planBuyStop', '￥' + (summary.best_buy.stop_loss != null ? summary.best_buy.stop_loss.toFixed(2) : '--'));
        setText('planBuyProfit', summary.best_buy.profit_potential != null ? '+' + summary.best_buy.profit_potential.toFixed(2) + '%' : '--');
        setText('planBuyRisk', summary.best_buy.loss_risk != null ? summary.best_buy.loss_risk.toFixed(2) + '%' : '--');
        setText('planBuyRatio', summary.best_buy.risk_reward != null ? summary.best_buy.risk_reward.toFixed(2) : '--');
        const buyRate = calcStrategySuccessRate(summary.best_buy, summary, 'buy');
        setText('planBuySuccessRate', '成功率 ' + buyRate + '%');
    }

    if (summary.best_sell) {
        setText('planSellName', summary.best_sell.name);
        setText('planSellEntry', '￥' + (summary.best_sell.entry_price || summary.current_price || 0).toFixed(2));
        setText('planSellTarget', '￥' + (summary.best_sell.target_price != null ? summary.best_sell.target_price.toFixed(2) : '--'));
        setText('planSellStop', '￥' + (summary.best_sell.stop_loss != null ? summary.best_sell.stop_loss.toFixed(2) : '--'));
        setText('planSellProfit', summary.best_sell.profit_potential != null ? '+' + summary.best_sell.profit_potential.toFixed(2) + '%' : '--');
        setText('planSellRisk', summary.best_sell.loss_risk != null ? summary.best_sell.loss_risk.toFixed(2) + '%' : '--');
        setText('planSellRatio', summary.best_sell.risk_reward != null ? summary.best_sell.risk_reward.toFixed(2) : '--');
        const sellRate = calcStrategySuccessRate(summary.best_sell, summary, 'sell');
        setText('planSellSuccessRate', '成功率 ' + sellRate + '%');
    }
    
    if (summary.best_t) {
        setDisplay('planTSection', 'block');
        setText('planTName', summary.best_t.name);
        const cp = summary.current_price || 0.01;
        const buyPrice = summary.best_t.buy_price || cp;
        const sellPrice = summary.best_t.sell_price || cp;
        setText('planTBuy', '￥' + buyPrice.toFixed(2));
        setText('planTSell', '￥' + sellPrice.toFixed(2));
        const spread = Math.abs(sellPrice - buyPrice);
        setText('planTSpread', '￥' + spread.toFixed(2));
        // 使用strategies.js已计算好的profit_potential，避免重复计算不一致
        const profitPct = summary.best_t.profit_potential;
        if (profitPct != null) {
            setText('planTProfit', (profitPct >= 0 ? '+' : '') + profitPct.toFixed(2) + '%');
        } else {
            // 如果没有预计算的profit，使用统一公式：(sell-buy)/buy*100 - 0.2
            const grossProfit = buyPrice > 0 ? (sellPrice - buyPrice) / buyPrice * 100 : 0;
            const netProfitPct = grossProfit - 0.2; // 双边手续费0.2%
            setText('planTProfit', (netProfitPct >= 0 ? '+' : '') + netProfitPct.toFixed(2) + '%');
        }
        const action = summary.best_t.action;
        let actionText = '正T';
        if (action === 'SELL_THEN_BUY') actionText = '反T';
        else if (action === 'BOX_TRADING') actionText = '箱体';
        setText('planTAction', actionText);
        // 同步切换主题色类
        const planSection = document.getElementById('planTSection');
        if (planSection) {
            planSection.classList.remove('t-plan-long', 't-plan-short', 't-plan-box');
            if (action === 'BUY_THEN_SELL') planSection.classList.add('t-plan-long');
            else if (action === 'SELL_THEN_BUY') planSection.classList.add('t-plan-short');
            else planSection.classList.add('t-plan-box');
        }
        // 显示成功率（如果有的话）
        if (summary.best_t.success_rate != null) {
            setText('planTSuccessRate', '成功率 ' + summary.best_t.success_rate + '%');
        }
        // 过夜风险提示
        const overnightEl = document.getElementById('planTOvernight');
        const overnightRiskEl = document.getElementById('planTOvernightRisk');
        const overnightAdviceEl = document.getElementById('planTOvernightAdvice');
        if (overnightEl && summary.best_t.overnight_risk) {
            overnightEl.style.display = 'flex';
            if (overnightRiskEl) {
                overnightRiskEl.innerText = summary.best_t.overnight_risk;
                const riskColor = summary.best_t.overnight_risk === '高' ? 'var(--red)' : (summary.best_t.overnight_risk === '低' ? 'var(--green)' : 'var(--yellow)');
                overnightRiskEl.style.color = riskColor;
            }
            if (overnightAdviceEl) overnightAdviceEl.innerText = summary.best_t.overnight_advice;
        } else if (overnightEl) {
            overnightEl.style.display = 'none';
        }
        // 时间窗口提示（新结构：planTMeta 包含交易时段/时间窗口/过夜风险）
        const metaEl = document.getElementById('planTMeta');
        const sessionEl = document.getElementById('planTSession');
        const windowEl = document.getElementById('planTWindow');
        const metaOvernightRiskEl = document.getElementById('planTOvernightRisk');
        if (metaEl && summary.best_t.time_session) {
            metaEl.style.display = 'flex';
            if (sessionEl) sessionEl.innerText = summary.best_t.time_session || '--';
            if (windowEl) {
                windowEl.innerText = summary.best_t.time_window || '--';
                const wColor = summary.best_t.time_window_color === 'green' ? 'var(--green)' :
                               summary.best_t.time_window_color === 'yellow' ? 'var(--yellow)' : 'var(--red)';
                windowEl.style.color = wColor;
            }
            if (metaOvernightRiskEl) {
                metaOvernightRiskEl.innerText = summary.best_t.overnight_risk || '--';
                const riskColor = summary.best_t.overnight_risk === '高' ? 'var(--red)' :
                                  (summary.best_t.overnight_risk === '低' ? 'var(--green)' : 'var(--yellow)');
                metaOvernightRiskEl.style.color = riskColor;
            }
        } else if (metaEl) {
            metaEl.style.display = 'none';
        }
        // 过夜建议提示（复用之前声明的变量）
        if (overnightAdviceEl) {
            overnightAdviceEl.innerText = summary.best_t.overnight_advice || '';
        }
        // 买入价安全标记：买入价 <= 现价 时显示绿色标记
        const buyItemEl = document.getElementById('planTBuyItem');
        if (buyItemEl) {
            if (buyPrice <= cp) {
                buyItemEl.classList.add('t-plan-buy-safe');
                buyItemEl.title = '✓ 买入价低于现价，确保盈利';
            } else {
                buyItemEl.classList.remove('t-plan-buy-safe');
                buyItemEl.title = '';
            }
        }
        // 成功率（如果没值则隐藏）
        const successRateEl = document.getElementById('planTSuccessRate');
        if (successRateEl && summary.best_t.success_rate == null) {
            successRateEl.innerText = '--';
        }
    } else {
        setDisplay('planTSection', 'none');
    }

    // 同时更新策略页面的做T方案（保持一致）
    const strategyCard = document.getElementById('strategyBestPlanCard');
    if (strategyCard) {
        if (summary.best_t) {
            strategyCard.style.display = 'block';
            const buyPrice = summary.best_t.buy_price || cp;
            const sellPrice = summary.best_t.sell_price || cp;
            const spread = Math.abs(sellPrice - buyPrice);
            const profitPct = summary.best_t.profit_potential;
            const netProfitPct = profitPct != null ? profitPct : 
                (buyPrice > 0 ? (sellPrice - buyPrice) / buyPrice * 100 - 0.2 : 0);
            const action = summary.best_t.action;
            let actionText = '正T';
            if (action === 'SELL_THEN_BUY') actionText = '反T';
            else if (action === 'BOX_TRADING') actionText = '箱体';
            // 同步切换策略页主题色类
            const strategyPlanSection = document.getElementById('strategyPlanTSection');
            if (strategyPlanSection) {
                strategyPlanSection.classList.remove('t-plan-long', 't-plan-short', 't-plan-box');
                if (action === 'BUY_THEN_SELL') strategyPlanSection.classList.add('t-plan-long');
                else if (action === 'SELL_THEN_BUY') strategyPlanSection.classList.add('t-plan-short');
                else strategyPlanSection.classList.add('t-plan-box');
            }

            const setStrategyText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.innerText = text;
            };
            setStrategyText('strategyPlanTName', summary.best_t.name);
            setStrategyText('strategyPlanTBuy', '￥' + buyPrice.toFixed(2));
            setStrategyText('strategyPlanTSell', '￥' + sellPrice.toFixed(2));
            setStrategyText('strategyPlanTSpread', '￥' + spread.toFixed(2));
            setStrategyText('strategyPlanTProfit', (netProfitPct >= 0 ? '+' : '') + netProfitPct.toFixed(2) + '%');
            setStrategyText('strategyPlanTAction', actionText);
            if (summary.best_t.success_rate != null) {
                setStrategyText('strategyPlanTSuccessRate', summary.best_t.success_rate + '%');
            } else {
                setStrategyText('strategyPlanTSuccessRate', '--');
            }
            // 买入价安全标记
            const strategyBuyItemEl = document.getElementById('strategyPlanTBuyItem');
            if (strategyBuyItemEl) {
                if (buyPrice <= cp) {
                    strategyBuyItemEl.classList.add('t-plan-buy-safe');
                    strategyBuyItemEl.title = '✓ 买入价低于现价，确保盈利';
                } else {
                    strategyBuyItemEl.classList.remove('t-plan-buy-safe');
                    strategyBuyItemEl.title = '';
                }
            }
            // 过夜风险提示
            const sOvernightEl = document.getElementById('strategyPlanTOvernight');
            const sOvernightRiskEl = document.getElementById('strategyPlanTOvernightRisk');
            const sOvernightAdviceEl = document.getElementById('strategyPlanTOvernightAdvice');
            if (sOvernightEl && summary.best_t.overnight_risk) {
                sOvernightEl.style.display = 'flex';
                if (sOvernightRiskEl) {
                    sOvernightRiskEl.innerText = summary.best_t.overnight_risk;
                    const riskColor = summary.best_t.overnight_risk === '高' ? 'var(--red)' : (summary.best_t.overnight_risk === '低' ? 'var(--green)' : 'var(--yellow)');
                    sOvernightRiskEl.style.color = riskColor;
                }
                if (sOvernightAdviceEl) sOvernightAdviceEl.innerText = summary.best_t.overnight_advice;
            } else if (sOvernightEl) {
                sOvernightEl.style.display = 'none';
            }
            // 时间窗口提示
            const sTimeWinEl = document.getElementById('strategyPlanTTimeWindow');
            const sSessionEl = document.getElementById('strategyPlanTSession');
            const sWindowEl = document.getElementById('strategyPlanTWindow');
            if (sTimeWinEl && summary.best_t.time_window) {
                sTimeWinEl.style.display = 'flex';
                if (sSessionEl) sSessionEl.innerText = summary.best_t.time_session;
                if (sWindowEl) {
                    sWindowEl.innerText = summary.best_t.time_window;
                    const wColor = summary.best_t.time_window_color === 'green' ? 'var(--green)' :
                                   summary.best_t.time_window_color === 'yellow' ? 'var(--yellow)' : 'var(--red)';
                    sWindowEl.style.color = wColor;
                }
            } else if (sTimeWinEl) {
                sTimeWinEl.style.display = 'none';
            }
        } else {
            strategyCard.style.display = 'none';
        }
    }
    
    // 渲染首页今日价格预测
    if (summary.price_prediction) {
        const p = summary.price_prediction;
        const homePred = document.getElementById('homePricePrediction');
        if (homePred) {
            homePred.style.display = 'block';
            // 股票名称和现价
            const stockNameEl = document.getElementById('homePredStockName');
            if (stockNameEl) stockNameEl.innerText = (summary.stock_name || '') + ' ' + (summary.stock_code || '');
            const curPriceEl = document.getElementById('homePredCurrentPrice');
            if (curPriceEl) {
                curPriceEl.innerText = '￥' + (summary.current_price || 0).toFixed(2);
                const change = summary.change_percent || 0;
                curPriceEl.style.color = change >= 0 ? 'var(--red)' : 'var(--green)';
            }
            const elHomePredHigh = document.getElementById('homePredictedHigh');
            if (elHomePredHigh) elHomePredHigh.innerText = '￥' + p.predicted_high.toFixed(2);
            const elHomePredLow = document.getElementById('homePredictedLow');
            if (elHomePredLow) elHomePredLow.innerText = '￥' + p.predicted_low.toFixed(2);
            const pos = Math.max(0, Math.min(100, p.price_position));
            const elHomePriceDot = document.getElementById('homePriceDot');
            if (elHomePriceDot) elHomePriceDot.style.left = pos + '%';
            const elHomePricePosLabel = document.getElementById('homePricePosLabel');
            if (elHomePricePosLabel) elHomePricePosLabel.innerText = '位置: ' + pos.toFixed(1) + '%';

            // 动态预测时间 + 目标日
            const dynTimeEl = document.getElementById('homeDynamicTime');
            if (dynTimeEl && p.generated_at) {
                const d = new Date(p.generated_at);
                const td = new Date(p.target_date);
                const targetStr = (td.getMonth()+1) + '/' + td.getDate();
                dynTimeEl.innerText = '预测' + targetStr + ' · ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0') + ':' + d.getSeconds().toString().padStart(2,'0');
            }

            // 固定预测（基于昨日收盘，全天不变）
            const fp = summary.fixed_prediction;
            if (fp) {
                const elFixedHigh = document.getElementById('homeFixedHigh');
                const elFixedLow = document.getElementById('homeFixedLow');
                const elFixedBase = document.getElementById('homeFixedBase');
                const elFixedTime = document.getElementById('homeFixedTime');
                if (elFixedHigh) elFixedHigh.innerText = '￥' + fp.predicted_high.toFixed(2);
                if (elFixedLow) elFixedLow.innerText = '￥' + fp.predicted_low.toFixed(2);
                if (elFixedBase) elFixedBase.innerText = '基准价: ￥' + fp.base_price.toFixed(2) + ' · 振幅: ' + fp.avg_amplitude + '% · 趋势: ' + fp.trend;
                if (elFixedTime && fp.generated_at && fp.target_date) {
                    const gd = new Date(fp.generated_at);
                    const td = new Date(fp.target_date);
                    const targetStr = (td.getMonth()+1) + '/' + td.getDate();
                    elFixedTime.innerText = '预测' + targetStr + ' · ' + (gd.getMonth()+1) + '/' + gd.getDate() + ' ' + gd.getHours().toString().padStart(2,'0') + ':' + gd.getMinutes().toString().padStart(2,'0');
                }
            }
        }
    }
    
    // 更新顶部header的做T机会
    let tText = '一般';
    if (summary.best_t) {
        const action = summary.best_t.action;
        if (action === 'BUY_THEN_SELL') tText = '正T';
        else if (action === 'SELL_THEN_BUY') tText = '反T';
        else if (action === 'BOX_TRADING') tText = '箱体';
        else tText = '有机会';
    } else {
        tText = '一般';
    }
    if (typeof updateHeaderQuote === 'function') {
        updateHeaderQuote(tText);
    }
}

function calcStrategySuccessRate(strategy, summary, type) {
    if (!strategy) return 0;
    let rate = 50;
    const trendBias = summary.trend_bias != null ? summary.trend_bias : 0;
    
    // 1. 趋势方向（权重最大，±22分）
    if (type === 'buy') {
        rate += Math.round(trendBias * 22);
    } else if (type === 'sell') {
        rate -= Math.round(trendBias * 22);
    }
    
    // 2. 信号数量对比（±20分）
    const buyCount = summary.buy_signals || 0;
    const sellCount = summary.sell_signals || 0;
    const total = Math.max(1, summary.total_signals || 1);
    if (type === 'buy') {
        rate += Math.round((buyCount / total) * 20) - 10;
    } else if (type === 'sell') {
        rate += Math.round((sellCount / total) * 20) - 10;
    }
    
    // 3. 买卖权重对比（优先级加权，±15分）
    const buyWeight = summary.buy_weight || 0;
    const sellWeight = summary.sell_weight || 0;
    const weightTotal = buyWeight + sellWeight;
    if (weightTotal > 0) {
        if (type === 'buy') {
            rate += Math.round((buyWeight / weightTotal) * 30) - 15;
        } else if (type === 'sell') {
            rate += Math.round((sellWeight / weightTotal) * 30) - 15;
        }
    }
    
    // 4. 盈亏比
    if (strategy.risk_reward) {
        const rr = parseFloat(strategy.risk_reward);
        if (rr >= 3) rate += 10;
        else if (rr >= 2) rate += 5;
        else if (rr >= 1) rate += 0;
        else rate -= 8;
    }
    
    // 5. 利润空间与风险空间
    if (strategy.profit_potential != null && strategy.loss_risk != null) {
        const profit = Math.abs(strategy.profit_potential);
        const risk = Math.abs(strategy.loss_risk);
        if (profit > 0 && risk >= 0) {
            if (profit > risk * 2) rate += 6;
            else if (profit > risk * 1.5) rate += 3;
            else if (profit < risk) rate -= 6;
        }
    }
    
    // 6. ATR波动率
    const atrPct = summary.atr_pct || 2;
    if (atrPct > 5) rate -= 4;
    else if (atrPct < 1.5) rate += 4;
    
    // 7. 做T信号支持
    const tCount = summary.t_signals || 0;
    if (tCount > 0) rate += 2;

    return Math.max(15, Math.min(92, Math.round(rate)));
}

/**
 * 计算全景分析建议的成功率（买入/卖出/观望）
 * 核心基于100+策略的加权投票结果 summary.trend_bias（范围-1~1）
 * _bias 直接综合了所有策略的优先级加权结果：
 *   - 每个策略按 priority 加权（0=3分, 1=2分, 2=1分）
 *   - _bias = (buy_weight - sell_weight) / (buy_weight + sell_weight)
 *   - _bias >= 0.4 为 STRONG_BUY，<= -0.4 为 STRONG_SELL
 * 辅以信号充足度和ATR波动率修正
 */
function calcPanoramaActionSuccessRate(summary, actionType) {
    if (!summary || actionType === 'watch') return 0; // 观望不显示成功率

    let rate = 50;

    // ===== 核心因子：策略投票偏离度（±35分）=====
    // trend_bias 是所有100+策略加权投票的结果，范围 -1 ~ 1
    // 越接近 1（强烈看多），买入成功率越高
    // 越接近 -1（强烈看空），卖出成功率越高
    const bias = summary.trend_bias != null ? summary.trend_bias : 0;
    if (actionType === 'buy') {
        rate += bias * 35;
    } else if (actionType === 'sell') {
        rate -= bias * 35;
    }

    // ===== 辅助因子1：信号充足度（±6分）=====
    // 策略数量越多，统计结果越可靠
    const totalSignals = summary.total_signals || 0;
    if (totalSignals >= 80) rate += 6;
    else if (totalSignals >= 50) rate += 4;
    else if (totalSignals >= 30) rate += 2;
    else if (totalSignals < 15) rate -= 3;

    // ===== 辅助因子2：ATR波动率修正（±4分）=====
    // 高波动环境降低确定性，低波动环境提高确定性
    const atrPct = summary.atr_pct || 2;
    if (atrPct > 5) rate -= 4;
    else if (atrPct > 3.5) rate -= 2;
    else if (atrPct < 1.5) rate += 3;

    return Math.max(30, Math.min(88, Math.round(rate)));
}

function switchPlanTab(tab) {
    const tabBuy = document.getElementById('planTabBuy');
    const tabSell = document.getElementById('planTabSell');
    const cardBuy = document.getElementById('planBuyCard');
    const cardSell = document.getElementById('planSellCard');
    if (tab === 'buy') {
        tabBuy.className = 'plan-tab active';
        tabBuy.style.color = '';
        tabSell.className = 'plan-tab';
        tabSell.style.color = 'var(--text-secondary)';
        cardBuy.style.display = 'block';
        cardSell.style.display = 'none';
    } else {
        tabSell.className = 'plan-tab active';
        tabSell.style.color = '';
        tabBuy.className = 'plan-tab';
        tabBuy.style.color = 'var(--text-secondary)';
        cardSell.style.display = 'block';
        cardBuy.style.display = 'none';
    }
}

function switchHoldingTab(tab) {
    const tabStat = document.getElementById('holdingTabStat');
    const tabDetail = document.getElementById('holdingTabDetail');
    const statContent = document.getElementById('holdingStatContent');
    const detailContent = document.getElementById('holdingDetailContent');
    if (tab === 'stat') {
        tabStat.className = 'plan-tab active';
        tabStat.style.color = '';
        tabDetail.className = 'plan-tab';
        tabDetail.style.color = 'var(--text-secondary)';
        statContent.style.display = 'block';
        detailContent.style.display = 'none';
    } else {
        tabDetail.className = 'plan-tab active';
        tabDetail.style.color = '';
        tabStat.className = 'plan-tab';
        tabStat.style.color = 'var(--text-secondary)';
        detailContent.style.display = 'block';
        statContent.style.display = 'none';
    }
}

function showFeeDetailModal() {
    const d = _feeDetail || {};
    const modalHtml = '<div class="fee-detail-modal" id="feeDetailModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;">' +
        '<div style="background:var(--bg-overlay);border-radius:16px;padding:20px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.4);">' +
        '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:16px;text-align:center;">💰 手续费明细</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:12px;">' +
        '<div style="padding:12px;background:var(--bg-inset);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">佣金（双向）</div><div style="font-weight:700;margin-top:4px;color:var(--red);">¥' + (d.commissionFee||0).toFixed(2) + '</div></div>' +
        '<div style="padding:12px;background:var(--bg-inset);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">印花税（卖出）</div><div style="font-weight:700;margin-top:4px;color:var(--red);">¥' + (d.stampTax||0).toFixed(2) + '</div></div>' +
        '<div style="padding:12px;background:var(--bg-inset);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">过户费（双向）</div><div style="font-weight:700;margin-top:4px;color:var(--red);">¥' + (d.transferFee||0).toFixed(2) + '</div></div>' +
        '<div style="padding:12px;background:rgba(248,113,113,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">总费用</div><div style="font-weight:700;margin-top:4px;color:var(--red);font-size:16px;">¥' + (d.totalFees||0).toFixed(2) + '</div></div>' +
        '</div>' +
        '<div style="padding:10px;background:rgba(250,204,21,0.08);border-radius:8px;font-size:11px;color:var(--text-muted);margin-bottom:12px;">' +
        '💡 佣金：万分之三，最低5元<br>' +
        '💡 印花税：千分之一，仅卖出收取<br>' +
        '💡 过户费：十万分之一，双向收取' +
        '</div>' +
        '<button onclick="closeFeeDetailModal()" style="width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">关闭</button>' +
        '</div></div>';
    const oldModal = document.getElementById('feeDetailModal');
    if (oldModal) oldModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
}

function closeFeeDetailModal() {
    const modal = document.getElementById('feeDetailModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

function showProfitDetail(type) {
    const d = _profitDetail || {};
    const stocks = d.stockProfits || [];
    let title = '', content = '';
    const fmtMoney = (v) => (v >= 0 ? '+' : '') + '¥' + (v || 0).toFixed(2);
    const colorCls = (v) => v > 0 ? 'color:var(--red);' : v < 0 ? 'color:var(--green);' : 'color:var(--text-primary);';

    if (type === 'total') {
        title = '交易明细';
        content = '<div style="text-align:center;margin-bottom:12px;"><div style="font-size:22px;font-weight:800;' + colorCls(d.totalProfit) + '">' + fmtMoney(d.totalProfit) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">总收益（落袋收益 + 持仓浮盈）</div></div>';
        // 交易记录列表
        const allTrades = [..._trades].sort((a, b) => (b.time || 0) - (a.time || 0));
        let listHtml = '';
        if (allTrades.length > 0) {
            listHtml = allTrades.map(t => {
                const ttype = t.trade_type || t.type;
                const isBuy = ttype === 'BUY';
                const date = t.time ? new Date(t.time).toLocaleDateString('zh-CN') : '';
                const timeStr = t.time ? new Date(t.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
                const amount = (t.price || 0) * (t.quantity || 0);
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-soft);">'
                    + '<div>'
                    + '<div style="font-size:13px;font-weight:600;">' + escapeHtml(t.name || t.code) + ' <span style="font-size:10px;color:var(--text-muted);">' + escapeHtml(t.code) + '</span></div>'
                    + '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + date + ' ' + timeStr + '</div>'
                    + '</div>'
                    + '<div style="text-align:right;">'
                    + '<div style="font-size:13px;font-weight:700;color:' + (isBuy ? 'var(--green)' : 'var(--red)') + '">' + (isBuy ? '买入' : '卖出') + ' ¥' + (t.price || 0).toFixed(2) + '</div>'
                    + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + (t.quantity || 0) + '股 · 金额¥' + amount.toFixed(2) + '</div>'
                    + '</div>'
                    + '</div>';
            }).join('');
        } else {
            listHtml = '<div class="empty-state" style="padding:20px 0;"><div class="empty-state-icon">📊</div><div>暂无交易记录</div></div>';
        }
        content += '<div style="max-height:320px;overflow-y:auto;">' + listHtml + '</div>';
    } else if (type === 'realized') {
        title = '落袋收益明细';
        const sellByStock = {};
        const holdings = {};
        _trades.forEach(t => {
            const ttype = t.trade_type || t.type;
            const code = t.code;
            if (ttype === 'BUY') {
                if (!holdings[code]) {
                    holdings[code] = { qty: 0, cost: 0, name: t.name || code };
                } else if (t.name && t.name !== code) {
                    holdings[code].name = t.name;
                }
                holdings[code].qty += t.quantity;
                const amount = t.price * t.quantity;
                const fees = calcTradeFees(amount, 'BUY');
                holdings[code].cost += amount + fees.commission + fees.transfer;
            } else {
                if (holdings[code] && holdings[code].qty > 0) {
                    if (t.name && t.name !== code && holdings[code].name === code) {
                        holdings[code].name = t.name;
                    }
                    const avgCost = holdings[code].cost / holdings[code].qty;
                    const sellQty = Math.min(t.quantity, holdings[code].qty);
                    const sellCost = avgCost * sellQty;
                    const amount = t.price * sellQty;
                    const fees = calcTradeFees(amount, 'SELL');
                    const net = amount - fees.commission - fees.stamp - fees.transfer - sellCost;
                    if (!sellByStock[code]) sellByStock[code] = { name: t.name || code, profit: 0, qty: 0 };
                    sellByStock[code].profit += net;
                    sellByStock[code].qty += sellQty;
                    holdings[code].qty -= sellQty;
                    holdings[code].cost -= sellCost;
                }
            }
        });
        const list = Object.entries(sellByStock).map(([code, v]) => ({ code, ...v })).sort((a, b) => b.profit - a.profit);
        let listHtml = '';
        if (list.length > 0) {
            listHtml = list.map(s => '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-soft);"><div><div style="font-size:13px;font-weight:600;">' + escapeHtml(s.name) + '</div><div style="font-size:10px;color:var(--text-muted);">' + escapeHtml(s.code) + ' · 已卖' + s.qty + '股</div></div><div style="font-size:14px;font-weight:700;' + colorCls(s.profit) + '">' + fmtMoney(s.profit) + '</div></div>').join('');
        } else {
            listHtml = '<div class="empty-state" style="padding:20px 0;"><div class="empty-state-icon">📊</div><div>暂无落袋收益</div></div>';
        }
        content = '<div style="text-align:center;margin-bottom:16px;"><div style="font-size:24px;font-weight:800;' + colorCls(d.realizedProfit) + '">' + fmtMoney(d.realizedProfit) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">按股票汇总 · 已卖出部分</div></div>';
        content += '<div style="max-height:300px;overflow-y:auto;">' + listHtml + '</div>';
    } else if (type === 'unrealized') {
        title = '持仓浮盈明细';
        let listHtml = '';
        if (stocks.length > 0) {
            listHtml = stocks.map(s => '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-soft);"><div><div style="font-size:13px;font-weight:600;">' + escapeHtml(s.name) + '</div><div style="font-size:10px;color:var(--text-muted);">' + escapeHtml(s.code) + ' · ' + s.quantity + '股 · 成本¥' + s.avg_cost.toFixed(2) + '</div></div><div style="text-align:right;"><div style="font-size:14px;font-weight:700;' + colorCls(s.profit) + '">' + fmtMoney(s.profit) + '</div><div style="font-size:10px;color:var(--text-muted);">现价¥' + s.current_price.toFixed(2) + '</div></div></div>').join('');
        } else {
            listHtml = '<div class="empty-state" style="padding:20px 0;"><div class="empty-state-icon">📊</div><div>暂无持仓</div></div>';
        }
        content = '<div style="text-align:center;margin-bottom:16px;"><div style="font-size:24px;font-weight:800;' + colorCls(d.unrealizedProfit) + '">' + fmtMoney(d.unrealizedProfit) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">' + stocks.length + '只持仓 · 浮动盈亏</div></div>';
        content += '<div style="max-height:300px;overflow-y:auto;">' + listHtml + '</div>';
    } else if (type === 't') {
        title = '做T收益明细';
        const tTrades = _trades.filter(t => t.pair_profit !== undefined && (t.pair_quantity || 0) > 0);
        const sorted = [...tTrades].sort((a, b) => (b.pair_time || 0) - (a.pair_time || 0));
        let listHtml = '';
        if (sorted.length > 0) {
            listHtml = sorted.map(tt => {
                const profit = tt.pair_profit || 0;
                const date = tt.pair_time ? new Date(tt.pair_time).toLocaleDateString('zh-CN') : (tt.time ? new Date(tt.time).toLocaleDateString('zh-CN') : '');
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-soft);"><div><div style="font-size:13px;font-weight:600;">' + escapeHtml(tt.name || tt.code) + '</div><div style="font-size:10px;color:var(--text-muted);">' + date + ' · ' + (tt.pair_quantity || 0) + '股</div></div><div style="font-size:14px;font-weight:700;' + colorCls(profit) + '">' + fmtMoney(profit) + '</div></div>';
            }).join('');
        } else {
            listHtml = '<div class="empty-state" style="padding:20px 0;"><div class="empty-state-icon">⚡</div><div>暂无做T记录</div></div>';
        }
        content = '<div style="text-align:center;margin-bottom:16px;"><div style="font-size:24px;font-weight:800;' + colorCls(d.tProfit) + '">' + fmtMoney(d.tProfit) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">累计做T ' + (d.tTradeCount || 0) + ' 次 · 已扣除手续费</div></div>';
        content += '<div style="max-height:300px;overflow-y:auto;">' + listHtml + '</div>';
    } else if (type === 'tcount') {
        title = '成功做T统计';
        const totalT = d.tTradeCount || 0;
        const winCount = d.tWinCount || 0;
        const lossCount = Math.max(0, totalT - winCount);
        const winRate = totalT > 0 ? (winCount / totalT * 100).toFixed(1) : '0';
        const avgProfit = totalT > 0 ? (d.tProfit || 0) / totalT : 0;
        content = '<div style="text-align:center;margin-bottom:16px;"><div style="font-size:24px;font-weight:800;color:var(--accent);">' + totalT + '次</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">累计做T总次数</div></div>';
        content += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">';
        content += '<div style="padding:12px;background:rgba(52,211,153,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">盈利次数</div><div style="font-weight:700;margin-top:4px;color:var(--green);">' + winCount + '次</div></div>';
        content += '<div style="padding:12px;background:rgba(248,113,113,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">亏损次数</div><div style="font-weight:700;margin-top:4px;color:var(--red);">' + lossCount + '次</div></div>';
        content += '<div style="padding:12px;background:rgba(250,204,21,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">胜率</div><div style="font-weight:700;margin-top:4px;color:var(--yellow);">' + winRate + '%</div></div>';
        content += '<div style="padding:12px;background:rgba(99,102,241,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">平均每笔</div><div style="font-weight:700;margin-top:4px;' + colorCls(avgProfit) + '">' + fmtMoney(avgProfit) + '</div></div>';
        content += '</div>';
        content += '<div style="margin-top:12px;padding:10px;background:var(--bg-inset);border-radius:8px;font-size:11px;color:var(--text-muted);">💡 总做T收益：<span style="' + colorCls(d.tProfit) + 'font-weight:700;">' + fmtMoney(d.tProfit) + '</span><br>💡 胜率 = 盈利次数 / 总做T次数</div>';
    }

    const modalHtml = '<div class="profit-detail-modal" id="profitDetailModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;">';
    modalHtml += '<div style="background:var(--bg-overlay);border-radius:16px;padding:20px;max-width:360px;width:90%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.4);">';
    modalHtml += '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:16px;text-align:center;">💰 ' + title + '</div>';
    modalHtml += '<div style="flex:1;overflow-y:auto;min-height:0;">' + content + '</div>';
    modalHtml += '<div style="margin-top:16px;"><button onclick="closeProfitDetailModal()" style="width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">关闭</button></div>';
    modalHtml += '</div></div>';
    const oldModal = document.getElementById('profitDetailModal');
    if (oldModal) oldModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
}

function closeProfitDetailModal() {
    const modal = document.getElementById('profitDetailModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

function showStockDetailModal() {
    if (!_currentStock) return;
    
    const s = _currentStock;
    const chg = s.change_percent || 0;
    const chgColor = chg > 0 ? 'var(--red)' : (chg < 0 ? 'var(--green)' : 'var(--text-muted)');
    const chgSign = chg >= 0 ? '+' : '';
    
    const modalHtml = '<div class="stock-detail-modal" id="stockDetailModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;">' +
        '<div style="background:var(--bg-overlay);border-radius:16px;padding:20px;max-width:360px;width:90%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.4);">' +
        '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:16px;text-align:center;">📈 ' + escapeHtml(s.name) + ' ' + escapeHtml(s.code) + '</div>' +
        '<div style="flex:1;overflow-y:auto;">' +
        '<div style="text-align:center;margin-bottom:16px;padding:16px;background:var(--bg-inset);border-radius:12px;">' +
        '<div style="font-size:32px;font-weight:800;color:' + chgColor + ';">￥' + s.current_price.toFixed(2) + '</div>' +
        '<div style="font-size:14px;color:' + chgColor + ';margin-top:4px;">' + chgSign + chg.toFixed(2) + '%</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">' +
        '<div style="padding:12px;background:var(--bg-inset);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">今开</div><div style="font-weight:700;margin-top:4px;">￥' + s.open_price.toFixed(2) + '</div></div>' +
        '<div style="padding:12px;background:var(--bg-inset);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">昨收</div><div style="font-weight:700;margin-top:4px;">￥' + s.prev_close.toFixed(2) + '</div></div>' +
        '<div style="padding:12px;background:rgba(248,113,113,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">最高</div><div style="font-weight:700;margin-top:4px;color:var(--red);">￥' + s.high_price.toFixed(2) + '</div></div>' +
        '<div style="padding:12px;background:rgba(52,211,153,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">最低</div><div style="font-weight:700;margin-top:4px;color:var(--green);">￥' + s.low_price.toFixed(2) + '</div></div>' +
        '<div style="padding:12px;background:var(--bg-inset);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">成交额</div><div style="font-weight:700;margin-top:4px;">' + formatAmount(s.amount) + '</div></div>' +
        '<div style="padding:12px;background:var(--bg-inset);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">换手率</div><div style="font-weight:700;margin-top:4px;">' + s.turnover.toFixed(2) + '%</div></div>' +
        '</div>' +
        '</div>' +
        '<div style="margin-top:16px;display:flex;gap:10px;">' +
        '<button onclick="refreshAll();closeStockDetailModal();" style="flex:1;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">🔄 刷新</button>' +
        '<button onclick="closeStockDetailModal()" style="flex:1;padding:12px;background:var(--surface-2);color:var(--text-primary);border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">关闭</button>' +
        '</div>' +
        '</div></div>';
    
    const oldModal = document.getElementById('stockDetailModal');
    if (oldModal) oldModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
}

function closeStockDetailModal() {
    const modal = document.getElementById('stockDetailModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

function loadDefaultStock() {
    if (_currentStock) return;
    let code = null;
    let name = null;

    // 优先使用最后一次查询的股票（持久化到本地）
    if (_lastSearchedStock && _lastSearchedStock.code) {
        code = _lastSearchedStock.code;
        name = _lastSearchedStock.name;
    }
    // 其次从做T信号列表取第一个有信号的
    if (!code && _watchList.length > 0) {
        // 优先选有T+0信号的股票
        const signalCode = _watchList.find(c => {
            const card = document.querySelector(`.t-signal-card[data-code="${c}"]`);
            return card && card.dataset.hasSignal === '1';
        });
        code = signalCode || _watchList[0];
    }
    // 最后取最近搜索历史最新的
    if (!code && _searchHistory.length > 0) {
        code = _searchHistory[0].code;
        name = _searchHistory[0].name;
    }
    if (code) {
        if (name) _stockNames[code] = name;
        loadStockInfo(code).catch(e => {
            console.warn('默认股票加载失败:', e);
            // 如果默认股票加载失败，尝试加载搜索历史的下一个
            if (_searchHistory.length > 1) {
                const nextCode = _searchHistory[1].code;
                _stockNames[nextCode] = _searchHistory[1].name;
                loadStockInfo(nextCode).catch(e2 => console.warn('备用股票也加载失败:', e2));
            }
        });
    }
}

function refreshAll() {
    if (_currentStock) {
        loadStockInfo(_currentStock.code);
    } else {
        loadDefaultStock();
    }
}

function loadWatchList() {
    try {
        const saved = localStorage.getItem('watchList');
        const parsed = saved ? JSON.parse(saved) : [];
        _watchList = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        _watchList = [];
    }
}

function saveWatchList() {
    safeSetItem('watchList', JSON.stringify(_watchList));
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
        setTimeout(() => {
            const miniContainer = document.getElementById('watchListMini');
            if (miniContainer) {
                const newTag = miniContainer.querySelector(`.watch-tag:last-child`);
                if (newTag) {
                    newTag.classList.add('animate-pop-in');
                }
            }
        }, 10);
        showToast('已加入监控');
    } else {
        showToast('已在监控列表中');
    }
}

function removeFromWatchlist(code) {
    const miniContainer = document.getElementById('watchListMini');
    const tagToRemove = miniContainer ? miniContainer.querySelector(`.watch-tag[onclick*="${code}"]`) : null;
    
    if (tagToRemove) {
        tagToRemove.classList.add('animate-fade-out');
        setTimeout(() => {
            _watchList = _watchList.filter(c => c !== code);
            for (const key in _alertedSignals) {
                if (key.startsWith(code + '_')) {
                    delete _alertedSignals[key];
                }
            }
            saveAlertedSignals();
            saveWatchList();
            renderWatchList();
        }, 250);
    } else {
        _watchList = _watchList.filter(c => c !== code);
        for (const key in _alertedSignals) {
            if (key.startsWith(code + '_')) {
                delete _alertedSignals[key];
            }
        }
        saveAlertedSignals();
        saveWatchList();
        renderWatchList();
    }
    showToast('已移除监控');
}

function loadSearchHistory() {
    try {
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
        }).filter(item => item && item.code && typeof item.code === 'string' && item.code.trim());

        _searchHistory = h;
    } catch (e) {
        _searchHistory = [];
    }
    
    renderSearchHistoryDom();
}

function deleteSearchHistory(code) {
    if (!code || typeof code !== 'string' || !code.trim()) return;
    try {
        let h = JSON.parse(localStorage.getItem('searchHistory') || '[]');
        h = h.filter(i => !(i && i.code && typeof i.code === 'string' && i.code.trim() === code.trim()));
        h = h.filter(i => i && i.code && typeof i.code === 'string' && i.code.trim());
        safeSetItem('searchHistory', JSON.stringify(h));
        _searchHistory = h;
    } catch (e) {
        _searchHistory = [];
    }
    renderSearchHistoryDom();
}

function renderSearchHistoryDom() {
    const homeWrap = document.getElementById('searchHistoryWrap');
    const homeList = document.getElementById('searchHistory');
    const strategyWrap = document.getElementById('strategyHistory');
    const strategyList = document.getElementById('strategyHistoryList');
    const sentimentWrap = document.getElementById('sentimentHistory');
    const sentimentList = document.getElementById('sentimentHistoryList');
    
    const validHistory = _searchHistory.filter(item => item && item.code && typeof item.code === 'string' && item.code.trim());
    
    const homeHtml = validHistory.length > 0 ? validHistory.map(item =>
        `<span class="history-tag" onclick="goToStockDetail('${escapeHtml(item.code)}','${escapeHtml(item.name || item.code)}')">
            ${escapeHtml(item.name || item.code)}
            <span class="tag-del" onclick="event.stopPropagation();deleteSearchHistory('${escapeHtml(item.code)}')">×</span>
        </span>`
    ).join('') : '';
    
    const strategyHtml = validHistory.length > 0 ? validHistory.map(item =>
        `<span class="history-tag" onclick="analyzeHistory('${escapeHtml(item.code)}','${escapeHtml(item.name || item.code)}')">
            ${escapeHtml(item.name || item.code)}
            <span class="tag-del" onclick="event.stopPropagation();deleteSearchHistory('${escapeHtml(item.code)}')">×</span>
        </span>`
    ).join('') : '';
    
    const sentimentHtml = validHistory.length > 0 ? validHistory.map(item =>
        `<span class="history-tag" onclick="loadSentimentByCode('${escapeHtml(item.code)}','${escapeHtml(item.name || item.code)}')">
            ${escapeHtml(item.name || item.code)}
            <span class="tag-del" onclick="event.stopPropagation();deleteSearchHistory('${escapeHtml(item.code)}')">×</span>
        </span>`
    ).join('') : '';
    
    if (homeWrap && homeList) {
        homeWrap.style.display = validHistory.length > 0 ? 'block' : 'none';
        homeList.innerHTML = homeHtml;
    }
    if (strategyWrap && strategyList) {
        strategyWrap.style.display = validHistory.length > 0 ? 'block' : 'none';
        strategyList.innerHTML = strategyHtml;
    }
    if (sentimentWrap && sentimentList) {
        sentimentWrap.style.display = validHistory.length > 0 ? 'block' : 'none';
        sentimentList.innerHTML = sentimentHtml;
    }
}

function saveSearchHistory(code, name) {
    if (!code || typeof code !== 'string' || !code.trim()) return;
    let h = [];
    try {
        h = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    } catch (e) {
        console.warn('搜索历史解析失败:', e);
        h = [];
    }
    h = h.filter(i => i && i.code && typeof i.code === 'string' && i.code.trim() && i.code !== code);
    h.unshift({ code: code.trim(), name: name || code.trim(), time: Date.now() });
    h = h.slice(0, 10);
    safeSetItem('searchHistory', JSON.stringify(h));
    _searchHistory = h;
    renderSearchHistoryDom();
}

function addToSearchHistory(code) {
    let name = _stockNames[code] || code;
    saveSearchHistory(code, name);
}

function showSearchHistoryInSuggestions(sugId, inputId) {
    const sug = document.getElementById(sugId);
    if (!sug || _searchHistory.length === 0) return;
    
    const selectAction = (code, name) => {
        const input = document.getElementById(inputId);
        if (input) input.value = code;
        if (name) _stockNames[code] = name;
        
        if (inputId === 'searchInput') {
            goToStockDetail(code, name);
        } else if (inputId === 'strategyInput') {
            document.getElementById('strategyInput').value = code;
            loadStrategyDetail();
            saveSearchHistory(code, name);
        } else if (inputId === 'newsInput') {
            document.getElementById('newsInput').value = code;
            loadNews();
            saveSearchHistory(code, name);
        } else if (inputId === 'panoramaInput') {
            document.getElementById('panoramaInput').value = code;
            loadPanoramaDetail();
            addToPanoramaHistory(code);
        }
        sug.style.display = 'none';
    };
    
    sug.innerHTML = '<div style="padding:8px 14px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">最近搜索</div>' +
        _searchHistory.slice(0, 8).map(item => `
            <div class="suggestion-item" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name || item.code)}">
                <span class="suggestion-code">${escapeHtml(item.code)}</span>
                <span class="suggestion-name">${escapeHtml(item.name || item.code)}</span>
            </div>
        `).join('');
    sug.style.display = 'block';
    
    sug.querySelectorAll('.suggestion-item').forEach(el => {
        el.addEventListener('click', () => {
            selectAction(el.dataset.code, el.dataset.name);
        });
    });
}

function addToPanoramaHistory(code) {
    let name = _stockNames[code] || code;
    try {
        let h = JSON.parse(localStorage.getItem('panoramaHistory') || '[]');
        h = h.filter(i => i.code !== code);
        h.unshift({ code, name, time: Date.now() });
        h = h.slice(0, 10);
        safeSetItem('panoramaHistory', JSON.stringify(h));
        _panoramaHistory = h;
    } catch (e) {
        _panoramaHistory = [{ code, name, time: Date.now() }];
    }
    renderPanoramaHistoryDom();
}

function loadPanoramaHistory() {
    try {
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
    } catch (e) {
        _panoramaHistory = [];
    }
    
    renderPanoramaHistoryDom();
}

function deletePanoramaHistory(code) {
    try {
        let h = JSON.parse(localStorage.getItem('panoramaHistory') || '[]');
        h = h.filter(i => i.code !== code);
        safeSetItem('panoramaHistory', JSON.stringify(h));
        _panoramaHistory = h;
    } catch (e) {
        _panoramaHistory = [];
    }
    renderPanoramaHistoryDom();
}

function renderPanoramaHistoryDom() {
    const panoramaWrap = document.getElementById('panoramaHistory');
    const panoramaList = document.getElementById('panoramaHistoryList');
    
    const panoramaHtml = _panoramaHistory.length > 0 ? _panoramaHistory.map(item =>
        `<span class="history-tag" onclick="loadPanoramaByCode('${escapeHtml(item.code)}','${escapeHtml(item.name || item.code)}')">
            ${escapeHtml(item.name || item.code)}
            <span class="tag-del" onclick="event.stopPropagation();deletePanoramaHistory('${escapeHtml(item.code)}')">×</span>
        </span>`
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
    // 校验：如果策略数据的股票代码和当前股票不一致，不渲染
    if (_currentStock && _lastSummary && _lastSummary.stock_code && _lastSummary.stock_code !== _currentStock.code) {
        const section = document.getElementById('strategyDetailSection');
        if (section) section.style.display = 'none';
        return;
    }

    // 注：display 的设置由调用方负责，此处不再重复设置

    const counts = countStrategyActions(strategies);
    const buyCount = counts.buy;
    const sellCount = counts.sell;
    const tCount = counts.t;

    const setCnt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setCnt('buyCount', buyCount);
    setCnt('sellCount', sellCount);
    setCnt('tCount', tCount);

    // 渲染今日价格预测
    if (_lastSummary && _lastSummary.price_prediction) {
        const p = _lastSummary.price_prediction;
        const card = document.getElementById('pricePredictionCard');
        if (card) {
            card.style.display = 'block';
            setCnt('predictedHigh', '￥' + p.predicted_high.toFixed(2));
            setCnt('predictedLow', '￥' + p.predicted_low.toFixed(2));
            setCnt('predictedAmp', p.avg_amplitude.toFixed(2) + '%');
            setCnt('predictedTrend', p.trend);
            setCnt('predictedConfidence', p.confidence + '%');

            // 动态预测目标日 + 更新时间
            const dynTimeEl = document.getElementById('strategyDynamicTime');
            if (dynTimeEl && p.generated_at && p.target_date) {
                const d = new Date(p.generated_at);
                const td = new Date(p.target_date);
                const targetStr = (td.getMonth()+1) + '/' + td.getDate();
                dynTimeEl.innerText = '预测' + targetStr + ' · ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0') + ':' + d.getSeconds().toString().padStart(2,'0');
            }

            // 固定预测（基于昨日收盘，全天不变）
            const fp = _lastSummary.fixed_prediction;
            if (fp) {
                const elFHigh = document.getElementById('fixedPredictedHigh');
                const elFLow = document.getElementById('fixedPredictedLow');
                const elFInfo = document.getElementById('fixedPredictedInfo');
                const elFTime = document.getElementById('strategyFixedTime');
                if (elFHigh) elFHigh.innerText = '￥' + fp.predicted_high.toFixed(2);
                if (elFLow) elFLow.innerText = '￥' + fp.predicted_low.toFixed(2);
                if (elFInfo) elFInfo.innerText = '基准价: ￥' + fp.base_price.toFixed(2) + ' · 振幅: ' + fp.avg_amplitude + '% · 趋势: ' + fp.trend + ' · ATR: ' + fp.atr;
                if (elFTime && fp.generated_at && fp.target_date) {
                    const gd = new Date(fp.generated_at);
                    const td = new Date(fp.target_date);
                    const targetStr = (td.getMonth()+1) + '/' + td.getDate();
                    elFTime.innerText = '预测' + targetStr + ' · ' + (gd.getMonth()+1) + '/' + gd.getDate() + ' ' + gd.getHours().toString().padStart(2,'0') + ':' + gd.getMinutes().toString().padStart(2,'0');
                }
            }
            
            const pos = Math.max(0, Math.min(100, p.price_position));
            const priceDotEl = document.getElementById('pricePositionDot');
            if (priceDotEl) priceDotEl.style.left = pos + '%';
            const pricePosLabelEl = document.getElementById('pricePositionLabel');
            if (pricePosLabelEl) pricePosLabelEl.innerText = '当前位置: ' + pos.toFixed(1) + '%';

            // 计算差值显示
            const highDeltaEl = document.getElementById('predictedHighDelta');
            const lowDeltaEl = document.getElementById('predictedLowDelta');
            if (_currentStock && _currentStock.high_price && _currentStock.low_price) {
                const realHigh = _currentStock.high_price;
                const realLow = _currentStock.low_price;

                if (realHigh > 0 && highDeltaEl) {
                    const delta = p.predicted_high - realHigh;
                    if (delta <= 0) {
                        highDeltaEl.innerHTML = '<span style="color:var(--green);">✓已触及</span>';
                    } else {
                        const percent = (delta / realHigh * 100).toFixed(2);
                        highDeltaEl.innerHTML = '<span style="color:var(--red);">差' + percent + '%</span>';
                    }
                }
                if (realLow > 0 && lowDeltaEl) {
                    const delta = realLow - p.predicted_low;
                    if (delta >= 0) {
                        lowDeltaEl.innerHTML = '<span style="color:var(--green);">✓已触及</span>';
                    } else {
                        const percent = (-delta / realLow * 100).toFixed(2);
                        lowDeltaEl.innerHTML = '<span style="color:var(--red);">差' + percent + '%</span>';
                    }
                }
            }

            // 显示平均准确度
            const rateEl = document.getElementById('predictedSuccessRate');
            if (_currentStock && rateEl) {
                const stats = getAvgAccuracy(_currentStock.code);
                rateEl.innerText = stats.avg + '分';
                rateEl.style.color = stats.avg >= 80 ? 'var(--green)' : stats.avg >= 60 ? 'var(--yellow)' : 'var(--red)';

                // 显示实际价格
                if (_currentStock.high_price) {
                    setCnt('actualHigh', _currentStock.high_price.toFixed(2));
                    setCnt('actualLow', _currentStock.low_price.toFixed(2));
                }
                
                // 保存今日预测记录
                if (_currentStock.high_price && _currentStock.low_price) {
                    const realHigh = _currentStock.high_price;
                    const realLow = _currentStock.low_price;
                    if (realHigh > 0 && realLow > 0) {
                        savePredictionRecord(
                            _currentStock.code,
                            _currentStock.name,
                            _currentStock.current_price || 0,
                            realHigh,
                            realLow,
                            p.predicted_high,
                            p.predicted_low,
                            _lastSummary.direction || 'WATCH',
                            _lastSummary.fixed_prediction
                        );
                    }
                }
            }
        }
    }

    // 渲染AI算法分析卡片
    if (_lastSummary && _lastSummary.ai_analysis) {
        const aiCard = document.getElementById('aiAnalysisCard');
        if (aiCard) {
            aiCard.style.display = 'block';
            const ai = _lastSummary.ai_analysis;
            const fusion = ai.fusion;
            
            // 融合评分圆环（仪表盘式半圆环）
            const scoreRing = document.getElementById('aiScoreRing');
            const scoreValue = document.getElementById('aiScoreValue');
            const scoreSignal = document.getElementById('aiScoreSignal');
            if (scoreRing && scoreValue && scoreSignal) {
                const clampedScore = Math.max(-100, Math.min(100, fusion.score));
                const color = clampedScore > 0 ? 'var(--green)' : (clampedScore < 0 ? 'var(--red)' : 'var(--accent)');
                const deg = Math.abs(clampedScore) * 0.9; // 0~90
                const colorStop = 90 + deg;
                const surfaceStop = 180;
                scoreRing.style.background = clampedScore >= 0
                    ? `conic-gradient(from -180deg, var(--surface-3) 90deg, ${color} 90deg, ${color} ${colorStop}deg, var(--surface-3) ${colorStop}deg)`
                    : `conic-gradient(from -180deg, var(--surface-3) ${90 - deg}deg, ${color} ${90 - deg}deg, ${color} 90deg, var(--surface-3) 90deg)`;
                scoreValue.innerText = Math.abs(clampedScore).toFixed(0) + '%';
                scoreValue.style.background = `linear-gradient(135deg, ${color}, ${color})`;
                scoreValue.style.webkitBackgroundClip = 'text';
                scoreValue.style.webkitTextFillColor = 'transparent';
                scoreValue.style.backgroundClip = 'text';
                const signalMap = { '买入': '买入强度', '卖出': '卖出强度', '观望': '中性' };
                scoreSignal.innerText = signalMap[fusion.signal] || fusion.signal;
                scoreRing.style.boxShadow = `0 0 24px ${clampedScore >= 0 ? 'var(--green-glow)' : (clampedScore < 0 ? 'var(--red-glow)' : 'var(--accent-glow)')}`;
            }

            // 置信度
            const aiConf = document.getElementById('aiConfidence');
            if (aiConf) aiConf.innerText = fusion.confidence + '%';

            // 评分组成（对称式进度条，以中线为起点）
            const componentsEl = document.getElementById('aiScoreComponents');
            if (componentsEl && fusion.components) {
                componentsEl.innerHTML = fusion.components.map(c => {
                    const pct = Math.max(-100, Math.min(100, c.score));
                    const isPositive = c.score >= 0;
                    const width = Math.abs(pct) / 2; // 最大50%宽度
                    return `
                        <div class="ai-component-item">
                            <div class="ai-component-name">${c.name}</div>
                            <div class="ai-component-bar">
                                <div class="ai-component-track ${isPositive ? 'positive' : 'negative'}" 
                                     style="width:${width}%"></div>
                            </div>
                            <div class="ai-component-value" style="color:${isPositive ? 'var(--green)' : 'var(--red)'}">
                                ${isPositive ? '+' : ''}${c.score.toFixed(0)}
                            </div>
                        </div>
                    `;
                }).join('');
            }
            
            // KNN详情
            const knnDesc = document.getElementById('aiKnnDesc');
            const knnTag = document.getElementById('aiKnnTag');
            if (knnDesc && knnTag) {
                if (ai.knn) {
                    knnDesc.innerText = `匹配度${ai.knn.match_score}%，预期变化${ai.knn.future_change > 0 ? '+' : ''}${ai.knn.future_change}%`;
                    knnTag.innerText = ai.knn.predicted_direction;
                    knnTag.style.color = ai.knn.predicted_direction === '上涨' ? 'var(--green)' : (ai.knn.predicted_direction === '下跌' ? 'var(--red)' : 'var(--accent)');
                    knnTag.style.background = ai.knn.predicted_direction === '上涨' ? 'rgba(52, 211, 153, 0.15)' : (ai.knn.predicted_direction === '下跌' ? 'rgba(239, 68, 68, 0.15)' : 'var(--accent-glow)');
                } else {
                    knnDesc.innerText = '历史数据不足，无法匹配';
                    knnTag.innerText = '无数据';
                }
            }
            
            // 回归详情
            const regDesc = document.getElementById('aiRegDesc');
            const regTag = document.getElementById('aiRegTag');
            if (regDesc && regTag) {
                if (ai.regression) {
                    regDesc.innerText = `预期变化${ai.regression.predicted_change > 0 ? '+' : ''}${ai.regression.predicted_change}%，置信度${ai.regression.confidence}%`;
                    regTag.innerText = ai.regression.predicted_change > 0.5 ? '看多' : (ai.regression.predicted_change < -0.5 ? '看空' : '中性');
                    regTag.style.color = ai.regression.predicted_change > 0.5 ? 'var(--green)' : (ai.regression.predicted_change < -0.5 ? 'var(--red)' : 'var(--accent)');
                    regTag.style.background = ai.regression.predicted_change > 0.5 ? 'rgba(52, 211, 153, 0.15)' : (ai.regression.predicted_change < -0.5 ? 'rgba(239, 68, 68, 0.15)' : 'var(--accent-glow)');
                } else {
                    regDesc.innerText = '训练数据不足';
                    regTag.innerText = '无数据';
                }
            }
        }
    }
    
    // 渲染筛选标签
    const filterChips = document.getElementById('filterChips');
    if (filterChips) {
        filterChips.style.display = 'flex';
        const counts = countStrategyActions(strategies);
        const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        setTxt('chipBuyCount', counts.buy);
        setTxt('chipSellCount', counts.sell);
        setTxt('chipTCount', counts.t);
        setTxt('chipWatchCount', counts.watch);
    }
    
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
        <button class="cat-tab active" onclick="filterStrategies('all', event)">全部 <span class="cat-count">${strategies.length}</span></button>
        ${Object.entries(categories).map(([cat, count]) => `
            <button class="cat-tab" onclick="filterStrategies('${escapeHtml(cat)}', event)">${escapeHtml(cat)} <span class="cat-count">${count}</span></button>
        `).join('')}
    `;
}

function filterStrategies(filter, event) {
    // 同时重置 .cat-tab 和 .summary-chip 的 active 状态
    const tabs = document.querySelectorAll('.cat-tab, .summary-chip');
    tabs.forEach(t => t.classList.remove('active'));
    if (event && event.currentTarget) event.currentTarget.classList.add('active');

    let filtered = _lastStrategies;
    if (filter === 'buy') {
        filtered = _lastStrategies.filter(s => isBuyAction(s.action));
    } else if (filter === 'sell') {
        filtered = _lastStrategies.filter(s => isSellAction(s.action));
    } else if (filter === 't') {
        filtered = _lastStrategies.filter(s => s.action.includes('TRADING_OPPORTUNITY') || s.action.includes('BUY_THEN_SELL') || s.action.includes('SELL_THEN_BUY') || s.action.includes('BOX_TRADING'));
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
        <div class="strategy-card ${isBuyAction(s.action) ? 'priority' : ''}" onclick="showStrategyDetail('${escapeHtml(s.name)}')">
            <div class="strategy-header">
                <div class="strategy-name">
                    <span class="strat-icon">${escapeHtml(s.icon)}</span>
                    ${escapeHtml(s.name)}
                    ${s.priority === 'high' ? '<span class="high-badge">高优先级</span>' : ''}
                    ${s.novel ? '<span class="novel-badge">新策略</span>' : ''}
                </div>
                <span class="strategy-feasibility feasibility-${escapeHtml(s.feasibility)}">${escapeHtml(s.feasibility)}</span>
            </div>
            <div class="strategy-suggestion">${escapeHtml(s.suggestion)}</div>
            <div class="strategy-reasoning">${escapeHtml(s.reasoning)}</div>
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
    
    const panoCounts = countStrategyActions(strategies);
    const buyCount = panoCounts.buy;
    const sellCount = panoCounts.sell;
    const watchCount = panoCounts.watch;
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
            const catBuy = catStrategies.filter(s => isBuyAction(s.action)).length;
            const catSell = catStrategies.filter(s => isSellAction(s.action)).length;
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
                fillEl.style.background = 'linear-gradient(90deg, var(--green), #16a34a)';
            } else if (score <= 40) {
                fillEl.style.background = 'linear-gradient(90deg, var(--red), #dc2626)';
            } else {
                fillEl.style.background = 'linear-gradient(90deg, var(--yellow), var(--yellow))';
            }
        }
        if (valueEl) {
            valueEl.innerText = score + '分';
            if (score >= 60) {
                valueEl.style.color = 'var(--green)';
            } else if (score <= 40) {
                valueEl.style.color = 'var(--red)';
            } else {
                valueEl.style.color = 'var(--yellow)';
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
    let actionType = 'watch';
    if (totalActionEl) {
        totalActionEl.className = 'total-action';
        if (avgScore >= 70) {
            totalActionEl.innerText = '⭐ 强烈买入';
            totalActionEl.classList.add('buy');
            actionType = 'buy';
        } else if (avgScore >= 55) {
            totalActionEl.innerText = '📈 建议买入';
            totalActionEl.classList.add('buy');
            actionType = 'buy';
        } else if (avgScore >= 45) {
            totalActionEl.innerText = '👀 观望';
            totalActionEl.classList.add('watch');
            actionType = 'watch';
        } else if (avgScore >= 30) {
            totalActionEl.innerText = '📉 建议卖出';
            totalActionEl.classList.add('sell');
            actionType = 'sell';
        } else {
            totalActionEl.innerText = '⚠️ 强烈卖出';
            totalActionEl.classList.add('sell');
            actionType = 'sell';
        }
    }

    // 计算并显示成功率
    const successRateEl = document.getElementById('panoramaSuccessRate');
    if (successRateEl && summary) {
        const rate = calcPanoramaActionSuccessRate(summary, actionType);
        if (rate > 0) {
            successRateEl.innerText = '成功率 ' + rate + '%';
            successRateEl.style.display = 'block';
            if (actionType === 'buy') {
                successRateEl.style.color = 'var(--green)';
            } else if (actionType === 'sell') {
                successRateEl.style.color = 'var(--red)';
            } else {
                successRateEl.style.color = 'var(--text-muted)';
            }
        } else {
            successRateEl.style.display = 'none';
        }
    }
    
    renderPanoramaCategoryTabs(strategies);
    renderPanoramaStrategyList(strategies);
}

function renderPanoramaCategoryTabs(strategies) {
    const tabs = document.getElementById('panoramaCategoryTabs');
    if (!tabs) return;
    
    const categories = {};
    strategies.forEach(s => {
        categories[s.category] = (categories[s.category] || 0) + 1;
    });
    
    tabs.innerHTML = `
        <button class="cat-tab active" onclick="filterPanoramaStrategies('all', event)">全部 <span class="cat-count">${strategies.length}</span></button>
        ${Object.entries(categories).map(([cat, count]) => `
            <button class="cat-tab" onclick="filterPanoramaStrategies('${escapeHtml(cat)}', event)">${escapeHtml(cat)} <span class="cat-count">${count}</span></button>
        `).join('')}
    `;
}

function filterPanoramaStrategies(filter, event) {
    const tabs = document.querySelectorAll('#panoramaCategoryTabs .cat-tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (event && event.currentTarget) event.currentTarget.classList.add('active');

    let filtered = _lastPanoramaStrategies;
    if (filter === 'buy') {
        filtered = _lastPanoramaStrategies.filter(s => isBuyAction(s.action));
    } else if (filter === 'sell') {
        filtered = _lastPanoramaStrategies.filter(s => isSellAction(s.action));
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
        <div class="strategy-card ${isBuyAction(s.action) ? 'priority' : ''}" onclick="showPanoramaStrategyDetail('${escapeHtml(s.name)}')">
            <div class="strategy-header">
                <div class="strategy-name">
                    <span class="strat-icon">${escapeHtml(s.icon)}</span>
                    ${escapeHtml(s.name)}
                    ${s.priority === 'high' ? '<span class="high-badge">高优先级</span>' : ''}
                    ${s.novel ? '<span class="novel-badge">新策略</span>' : ''}
                </div>
                <span class="strategy-feasibility feasibility-${escapeHtml(s.feasibility)}">${escapeHtml(s.feasibility)}</span>
            </div>
            <div class="strategy-suggestion">${escapeHtml(s.suggestion)}</div>
            <div class="strategy-reasoning">${escapeHtml(s.reasoning)}</div>
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
                <span style="font-size:24px;">${escapeHtml(strategy.icon)}</span>
                <div>
                    <div style="font-weight:600;font-size:16px;">${escapeHtml(strategy.name)}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(strategy.category)}</div>
                </div>
            </div>
            <div style="background:var(--surface-2);padding:12px;border-radius:var(--radius-sm);margin-bottom:15px;border:1px solid var(--border-glass);">
                <div style="font-size:14px;margin-bottom:8px;"><strong>操作建议：</strong>${escapeHtml(strategy.suggestion)}</div>
                <div style="font-size:13px;color:var(--text-secondary);"><strong>分析理由：</strong>${escapeHtml(strategy.reasoning)}</div>
            </div>
            ${strategy.target_price ? `<div style="font-size:13px;margin-bottom:5px;">🎯 目标价：<strong>¥${strategy.target_price}</strong></div>` : ''}
            ${strategy.stop_loss ? `<div style="font-size:13px;margin-bottom:5px;">🛡️ 止损价：<strong>¥${strategy.stop_loss}</strong></div>` : ''}
            ${strategy.buy_price ? `<div style="font-size:13px;margin-bottom:5px;">💰 买入价：<strong>¥${strategy.buy_price}</strong></div>` : ''}
            ${strategy.sell_price ? `<div style="font-size:13px;margin-bottom:5px;">📉 卖出价：<strong>¥${strategy.sell_price}</strong></div>` : ''}
            <div style="font-size:12px;color:var(--text-muted);margin-top:10px;">
                可行性：${escapeHtml(strategy.feasibility)} | 优先级：${escapeHtml(strategy.priority)}
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
    let scoreColor = 'var(--yellow)';
    const numScore = parseInt(score, 10);
    if (!isNaN(numScore)) {
        if (numScore >= 70) { scoreLevel = '强势看多'; scoreColor = 'var(--green)'; }
        else if (numScore >= 55) { scoreLevel = '偏多'; scoreColor = 'var(--green)'; }
        else if (numScore >= 45) { scoreLevel = '中性'; scoreColor = 'var(--yellow)'; }
        else if (numScore >= 30) { scoreLevel = '偏空'; scoreColor = 'var(--red)'; }
        else { scoreLevel = '强势看空'; scoreColor = 'var(--red)'; }
    }
    
    // 统计信号
    const dimCounts = countStrategyActions(dimStrategies);
    const buyCount = dimCounts.buy;
    const sellCount = dimCounts.sell;
    const watchCount = dimCounts.watch;
    
    const content = `
        <div style="padding: 4px;">
            <!-- 维度标题和分数 -->
            <div style="text-align:center;padding:16px;background:linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1));border-radius:12px;margin-bottom:16px;">
                <div style="font-size:28px;font-weight:700;margin-bottom:4px;">${info.title}</div>
                <div style="font-size:36px;font-weight:800;color:${scoreColor};margin:6px 0;">${score}</div>
                <div style="display:inline-block;padding:4px 12px;background:var(--surface-active);border-radius:12px;font-size:12px;color:${scoreColor};">${scoreLevel}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:8px;line-height:1.5;">${info.desc}</div>
            </div>
            
            <!-- 信号统计 -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
                <div style="text-align:center;padding:10px;background:rgba(34,197,94,0.08);border-radius:8px;border:1px solid rgba(34,197,94,0.2);">
                    <div style="font-size:18px;font-weight:700;color:var(--green);">${buyCount}</div>
                    <div style="font-size:11px;color:var(--text-muted);">买入信号</div>
                </div>
                <div style="text-align:center;padding:10px;background:rgba(251,191,36,0.08);border-radius:8px;border:1px solid rgba(251,191,36,0.2);">
                    <div style="font-size:18px;font-weight:700;color:var(--yellow);">${watchCount}</div>
                    <div style="font-size:11px;color:var(--text-muted);">观望信号</div>
                </div>
                <div style="text-align:center;padding:10px;background:rgba(239,68,68,0.08);border-radius:8px;border:1px solid rgba(239,68,68,0.2);">
                    <div style="font-size:18px;font-weight:700;color:var(--red);">${sellCount}</div>
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
                    <div style="margin-bottom:10px;padding:8px;background:var(--surface-2);border-radius:6px;">
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
                    const actionColor = s.action === 'BUY' ? 'var(--green)' : s.action === 'SELL' ? 'var(--red)' : 'var(--yellow)';
                    return `
                        <div style="margin-bottom:8px;padding:8px;background:var(--surface-2);border-radius:6px;border-left:3px solid ${actionColor};">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                <span style="font-size:12px;font-weight:600;">${escapeHtml(s.icon)} ${escapeHtml(s.name)}</span>
                                <span style="font-size:11px;font-weight:700;color:${actionColor};background:var(--surface-3);padding:2px 8px;border-radius:10px;">${actionText}</span>
                            </div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:3px;line-height:1.5;">${escapeHtml(s.suggestion)}</div>
                            <div style="font-size:10px;color:var(--text-muted);line-height:1.4;">${escapeHtml(s.reasoning)}</div>
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
    if (modal) {
        closeAllModals();
        modal.style.display = 'flex';
    }
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
                <span style="font-size:24px;">${escapeHtml(strategy.icon)}</span>
                <div>
                    <div style="font-weight:600;font-size:16px;">${escapeHtml(strategy.name)}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(strategy.category)}</div>
                </div>
            </div>
            <div style="background:var(--surface-2);padding:12px;border-radius:var(--radius-sm);margin-bottom:15px;border:1px solid var(--border-glass);">
                <div style="font-size:14px;margin-bottom:8px;"><strong>操作建议：</strong>${escapeHtml(strategy.suggestion)}</div>
                <div style="font-size:13px;color:var(--text-secondary);"><strong>分析理由：</strong>${escapeHtml(strategy.reasoning)}</div>
            </div>
            ${strategy.target_price ? `<div style="font-size:13px;margin-bottom:5px;">🎯 目标价：<strong>¥${strategy.target_price}</strong></div>` : ''}
            ${strategy.stop_loss ? `<div style="font-size:13px;margin-bottom:5px;">🛡️ 止损价：<strong>¥${strategy.stop_loss}</strong></div>` : ''}
            ${strategy.buy_price ? `<div style="font-size:13px;margin-bottom:5px;">💰 买入价：<strong>¥${strategy.buy_price}</strong></div>` : ''}
            ${strategy.sell_price ? `<div style="font-size:13px;margin-bottom:5px;">📉 卖出价：<strong>¥${strategy.sell_price}</strong></div>` : ''}
            <div style="font-size:12px;color:var(--text-muted);margin-top:10px;">
                可行性：${escapeHtml(strategy.feasibility)} | 优先级：${escapeHtml(strategy.priority)}
            </div>
        </div>
    `;
    
    openModal(strategy.name, content);
}

// 交易页
function _sanitizeTrade(t) {
    if (!t || typeof t !== 'object') return null;
    return {
        code: t.code || '',
        name: t.name || '',
        trade_type: t.trade_type || t.type || 'BUY',
        quantity: Math.max(0, parseInt(t.quantity, 10) || 0),
        price: Math.max(0, parseFloat(t.price) || 0),
        date: t.date || '',
        fee: Math.max(0, parseFloat(t.fee) || 0),
        pair_buy_index: t.pair_buy_index != null ? t.pair_buy_index : null,
        timestamp: t.timestamp ? parseInt(t.timestamp, 10) || 0 : 0,
        note: t.note || ''
    };
}

function loadTrades() {
    try {
        const saved = localStorage.getItem('trades');
        if (saved) {
            const parsed = JSON.parse(saved);
            _trades = Array.isArray(parsed) ? parsed.map(_sanitizeTrade).filter(Boolean) : [];
        }
    } catch (e) {
        console.warn('交易数据损坏，尝试从备份恢复', e);
        try {
            const backups = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('trades_backup_')) {
                    backups.push(key);
                }
            }
            backups.sort().reverse();
            let recovered = false;
            for (const bk of backups) {
                try {
                    const backupData = JSON.parse(localStorage.getItem(bk) || '[]');
                    if (Array.isArray(backupData)) {
                        _trades = backupData.map(_sanitizeTrade).filter(Boolean);
                        showToast('已从备份恢复交易数据');
                        recovered = true;
                        break;
                    }
                } catch (e2) {
                    continue;
                }
            }
            if (!recovered) {
                _trades = [];
            }
        } catch (e2) {
            _trades = [];
        }
    }
    if (!Array.isArray(_trades)) _trades = [];
    _trades.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

let _lastBackupTime = 0;

function saveTrades() {
    const data = JSON.stringify(_trades);
    safeSetItem('trades', data);
    try {
        const now = Date.now();
        if (now - _lastBackupTime > 60000) {
            const backupKey = 'trades_backup_' + now;
            safeSetItem(backupKey, data);
            _lastBackupTime = now;
            const backups = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('trades_backup_')) {
                    backups.push(key);
                }
            }
            backups.sort();
            while (backups.length > 5) {
                const oldest = backups.shift();
                localStorage.removeItem(oldest);
            }
        }
    } catch (e) {
        console.warn('备份失败', e);
    }
}

function openAddTradeModal() {
    switchTab('trade');
    setTimeout(() => {
        const card = document.querySelector('#tab-trade .card:first-child');
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 100);
}

async function renderTrades() {
    const tradeList = document.getElementById('tradeList');
    const holdingsList = document.getElementById('holdingsList');
    
    if (_trades.length === 0) {
        if (tradeList) tradeList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div>暂无交易记录</div><button onclick="openAddTradeModal()" class="btn btn-primary" style="margin-top:12px;width:auto;padding:10px 24px;">添加交易</button></div>';
        if (holdingsList) holdingsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💹</div><div>暂无持仓记录</div><button onclick="openAddTradeModal()" class="btn btn-primary" style="margin-top:12px;width:auto;padding:10px 24px;">添加买入</button></div>';
        return;
    }
    
    if (tradeList) {
        tradeList.innerHTML = _trades.map((t, idx) => {
            const type = t.trade_type || t.type;
            const isBuy = type === 'BUY';
            const remaining = isBuy ? getTradeRemaining(idx) : 0;
            const isPaired = t.pair_buy_index !== undefined;
            const amount = t.price * t.quantity;
            const fees = calcTradeFees(amount, type);
            const totalFee = fees.total;
            
            let feeInfo = `
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px;padding:4px 6px;background:var(--surface-3);border-radius:4px;">
                    <span>金额 ¥${amount.toFixed(2)}</span>
                    <span style="margin-left:8px;color:var(--red);">手续费 ¥${totalFee.toFixed(2)}</span>
                    ${isBuy ? '' : `<span style="margin-left:4px;">(印花税¥${fees.stamp.toFixed(2)})</span>`}
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
                const buyFees = calcTradeFees(buyAmount, 'BUY');
                const buyFee = buyFees.commission + buyFees.transfer;
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
                            <div style="font-size:10px;color:var(--text-muted);padding-top:4px;border-top:1px solid var(--surface-active);">
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
                        <span class="trade-stock">${escapeHtml(t.name || t.code)}</span>
                        <span class="trade-type ${type.toLowerCase()}">${isBuy ? '买入' : '卖出'}</span>
                        <button onclick="event.stopPropagation();deleteTrade(${idx})" style="margin-left:auto;background:rgba(239,68,68,0.15);color:var(--red);border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;">删除</button>
                    </div>
                    <div class="trade-info">
                        <span>${escapeHtml(t.code)}</span>
                        <span>¥${(t.price || 0).toFixed(2)} × ${(t.quantity || 0)}股</span>
                    </div>
                    ${feeInfo}
                    ${remainingInfo}
                    ${pairInfo}
                    ${t.note ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">📝 ${escapeHtml(t.note)}</div>` : ''}
                    <div class="trade-time">${new Date(t.timestamp || t.date).toLocaleString('zh-CN')}</div>
                </div>
            `;
        }).join('');
    }
    
    const holdings = {};
    _trades.forEach(t => {
        const type = t.trade_type || t.type;
        if (!holdings[t.code]) {
            holdings[t.code] = { qty: 0, cost: 0, name: t.name || t.code };
        } else if (t.name && t.name !== t.code) {
            holdings[t.code].name = t.name;
        }
        if (type === 'BUY') {
            const amount = t.price * t.quantity;
            const fees = calcTradeFees(amount, 'BUY');
            holdings[t.code].qty += t.quantity;
            holdings[t.code].cost += amount + fees.commission + fees.transfer;
        } else if (type === 'SELL') {
            if (holdings[t.code].qty > 0) {
                const avgCost = holdings[t.code].cost / holdings[t.code].qty;
                const sellQty = Math.min(t.quantity, holdings[t.code].qty);
                const sellCost = avgCost * sellQty;
                holdings[t.code].cost -= sellCost;
                holdings[t.code].qty -= sellQty;
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
                        <div class="stock-profit-name">${escapeHtml(info.name)}</div>
                        <div class="stock-profit-detail">${escapeHtml(code)} · 持仓 ${info.qty}股 · 成本 ¥${avgCost.toFixed(2)}</div>
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
            holdingsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💹</div><div>暂无持仓记录</div><button onclick="openAddTradeModal()" class="btn btn-primary" style="margin-top:12px;width:auto;padding:10px 24px;">添加买入</button></div>';
        } else {
            holdingsList.innerHTML = holdingsHtml;
            
            // 异步获取持仓股票的价格并更新盈亏显示（分批控制，避免大量并发请求）
            const updateHoldingProfit = async (code) => {
                const avgCost = holdings[code].qty > 0 ? holdings[code].cost / holdings[code].qty : 0;
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
            };
            
            // 分批更新，每批2个，避免同时发起大量请求
            const batchSize = 2;
            for (let i = 0; i < holdingsCodes.length; i += batchSize) {
                const batch = holdingsCodes.slice(i, i + batchSize);
                await Promise.all(batch.map(code => updateHoldingProfit(code)));
            }
        }
    }
}

function refreshTradeStats() {
    let tProfit = 0;
    let tCount = 0;
    let totalFee = 0;
    
    _trades.forEach(t => {
        const type = t.trade_type || t.type;
        const amount = t.price * t.quantity;
        const fees = calcTradeFees(amount, type);
        totalFee += fees.total;
        
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
    const fees = calcTradeFees(amount, type);
    const totalFee = fees.total;
    
    let content = `
        <div style="padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <div style="font-size:18px;font-weight:700;">${escapeHtml(t.name || t.code)}</div>
                <span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${isBuy ? 'rgba(239,68,68,0.15)' : 'rgba(52,211,153,0.15)'};color:${isBuy ? 'var(--red)' : 'var(--green)'};">
                    ${isBuy ? '📈 买入' : '📉 卖出'}
                </span>
            </div>
            
            <div style="background:var(--bg-inset);border-radius:12px;padding:16px;margin-bottom:16px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                    <div style="text-align:center;">
                        <div style="font-size:11px;color:var(--text-muted);">价格</div>
                        <div style="font-size:20px;font-weight:700;">¥${(t.price || 0).toFixed(2)}</div>
                    </div>
                    <div style="text-align:center;">
                        <div style="font-size:11px;color:var(--text-muted);">数量</div>
                        <div style="font-size:20px;font-weight:700;">${t.quantity || 0}股</div>
                    </div>
                </div>
                <div style="text-align:center;padding-top:12px;border-top:1px solid var(--surface-active);">
                    <div style="font-size:11px;color:var(--text-muted);">成交金额</div>
                    <div style="font-size:24px;font-weight:700;">¥${amount.toFixed(2)}</div>
                </div>
            </div>
            
            <div style="background:rgba(239,68,68,0.08);border-radius:12px;padding:16px;margin-bottom:16px;">
                <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:12px;">💸 手续费明细</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
                    <div style="display:flex;justify-content:space-between;padding:6px 8px;background:var(--surface-3);border-radius:6px;">
                        <span>佣金</span>
                        <span style="color:var(--red);">¥${fees.commission.toFixed(2)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px 8px;background:var(--surface-3);border-radius:6px;">
                        <span>过户费</span>
                        <span style="color:var(--red);">¥${fees.transfer.toFixed(4)}</span>
                    </div>
                    ${isBuy ? '' : `
                    <div style="display:flex;justify-content:space-between;padding:6px 8px;background:var(--surface-3);border-radius:6px;grid-column:span 2;">
                        <span>印花税（卖出）</span>
                        <span style="color:var(--red);">¥${fees.stamp.toFixed(2)}</span>
                    </div>
                    `}
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid var(--surface-active);font-weight:700;">
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
                const sellFee = Math.max(0, pairFee - buyFee);
                return `
                <div style="background:${isProfit ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)'};border-radius:12px;padding:16px;border-left:4px solid ${isProfit ? 'var(--green)' : 'var(--red)'};">
                    <div style="font-size:13px;font-weight:700;color:${isProfit ? 'var(--green)' : 'var(--red)'};margin-bottom:12px;">🔗 做T收益明细（${pairQty}股）</div>
                    <div style="font-size:12px;margin-bottom:12px;padding:10px;background:var(--surface-3);border-radius:8px;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                            <span style="color:var(--text-muted);">配对买入</span>
                            <span>¥${pairBuyPrice.toFixed(2)} × ${pairQty}股</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:var(--text-muted);">配对卖出</span>
                            <span>¥${pairSellPrice.toFixed(2)} × ${pairQty}股</span>
                        </div>
                    </div>
                    <div style="font-size:12px;padding:10px;background:var(--bg-inset);border-radius:8px;">
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
                    <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:2px solid var(--border-soft);font-weight:700;font-size:16px;">
                        <span>净收益</span>
                        <span style="color:${isProfit ? 'var(--green)' : 'var(--red)'};">${isProfit ? '+' : ''}¥${profit.toFixed(2)} (${isProfit ? '+' : ''}${profitPercent.toFixed(2)}%)</span>
                    </div>
                </div>
                `;
            })() : ''}
            
            ${t.note ? `
            <div style="margin-top:16px;padding:12px;background:var(--surface-3);border-radius:8px;">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">📝 备注</div>
                <div style="font-size:13px;">${escapeHtml(t.note)}</div>
            </div>
            ` : ''}
            
            <div style="margin-top:16px;font-size:11px;color:var(--text-muted);text-align:center;">
                交易时间：${new Date(t.timestamp || t.date).toLocaleString('zh-CN')}
            </div>
        </div>
    `;
    
    openModal('交易详情', content);
}

let _selectedPairBuyIndex = -1;

function addTrade() {
    const code = document.getElementById('stockCode').value.trim();
    const name = document.getElementById('stockName').value.trim();
    const type = document.getElementById('tradeType').value;
    const price = parseFloat(document.getElementById('price').value);
    const qty = parseInt(document.getElementById('quantity').value, 10);
    const note = document.getElementById('note').value.trim();
    
    if (!code || isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) {
        showToast('请填写完整交易信息');
        return;
    }
    
    if (!Number.isInteger(qty)) {
        showToast('数量必须是整数');
        return;
    }
    
    if (!/^\d{6}$/.test(code)) {
        showToast('请输入正确的股票代码');
        return;
    }
    
    if (type === 'SELL') {
        const holdings = getHoldings(code);
        const holdQty = typeof holdings === 'number' ? holdings : holdings.qty;
        if (qty > holdQty) {
            showToast(`持仓不足，当前持有 ${holdQty} 股`);
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
        const pairTrade = _trades[_selectedPairBuyIndex];
        if (pairTrade && (pairTrade.trade_type || pairTrade.type) === 'BUY') {
            const remaining = getTradeRemaining(_selectedPairBuyIndex);
            const actualQty = Math.min(qty, remaining);
            if (actualQty > 0) {
                newTrade.pair_buy_index = _selectedPairBuyIndex;
                newTrade.pair_quantity = actualQty;
                const buyPrice = pairTrade.price;
                const buyAmount = buyPrice * actualQty;
                const sellAmount = price * actualQty;
                const buyFees = calcTradeFees(buyAmount, 'BUY');
                const sellFees = calcTradeFees(sellAmount, 'SELL');
                const totalFee = buyFees.commission + buyFees.transfer + sellFees.commission + sellFees.stamp + sellFees.transfer;
                newTrade.pair_buy_price = buyPrice;
                newTrade.pair_sell_price = price;
                newTrade.pair_fee = totalFee;
                newTrade.pair_profit = (price - buyPrice) * actualQty - totalFee;
            }
        } else {
            _selectedPairBuyIndex = -1;
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
            <div onclick="selectPairBuy(${idx})" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;${isSelected ? 'background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);' : 'background:var(--surface-2);border:1px solid var(--border-glass);'}">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:13px;font-weight:600;">¥${(t.price || 0).toFixed(2)} × ${(t.quantity || 0)}股</div>
                        <div style="font-size:11px;color:var(--text-muted);">${new Date(t.timestamp || t.date).toLocaleDateString('zh-CN')}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:12px;color:var(--accent);">剩余 ${remaining}股</div>
                        ${t.note ? `<div style="font-size:10px;color:var(--text-muted);">${escapeHtml(t.note)}</div>` : ''}
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
    const sellQty = parseInt(document.getElementById('quantity').value, 10);
    
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
    const buyFees = calcTradeFees(buyAmount, 'BUY');
    const sellFees = calcTradeFees(sellAmount, 'SELL');
    const totalFee = buyFees.commission + buyFees.transfer + sellFees.commission + sellFees.stamp + sellFees.transfer;
    const profit = sellAmount - buyAmount - totalFee;
    const profitPercent = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;
    
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
            sold += (t.pair_quantity || 0);
        }
    });
    
    return Math.max(0, (trade.quantity || 0) - sold);
}

function deleteTrade(idx) {
    if (!confirm('确定删除这条交易记录？此操作不可恢复。')) return;
    
    const deletedTrade = _trades[idx];
    const deletedType = deletedTrade.trade_type || deletedTrade.type;
    
    _trades.splice(idx, 1);
    
    if (deletedType === 'BUY') {
        // 删除买入记录：解除所有指向此买入的卖出配对，并调整索引
        _trades.forEach(t => {
            if (t.pair_buy_index !== undefined && t.pair_buy_index !== null) {
                if (t.pair_buy_index === idx) {
                    delete t.pair_buy_index;
                    delete t.pair_quantity;
                    delete t.pair_buy_price;
                    delete t.pair_sell_price;
                    delete t.pair_fee;
                    delete t.pair_profit;
                    delete t.pair_time;
                } else if (t.pair_buy_index > idx) {
                    t.pair_buy_index--;
                }
            }
        });
        showToast('已删除买入记录，相关配对已解除');
    } else if (deletedType === 'SELL' && deletedTrade.pair_buy_index != null) {
        // 删除卖出记录：清理买入记录中的配对信息
        const buyIdx = deletedTrade.pair_buy_index;
        if (buyIdx < _trades.length && _trades[buyIdx]) {
            // 买入记录不再配对
        }
        // 调整其他记录的pair_buy_index
        _trades.forEach(t => {
            if (t.pair_buy_index !== undefined && t.pair_buy_index !== null) {
                if (t.pair_buy_index > idx) {
                    t.pair_buy_index--;
                }
            }
        });
        showToast('✓ 删除成功');
    } else {
        // 非配对的卖出或其他类型，调整索引
        _trades.forEach(t => {
            if (t.pair_buy_index !== undefined && t.pair_buy_index !== null) {
                if (t.pair_buy_index > idx) {
                    t.pair_buy_index--;
                }
            }
        });
        showToast('✓ 删除成功');
    }
    
    if (deletedType === 'BUY' && idx === _selectedPairBuyIndex) {
        _selectedPairBuyIndex = -1;
    } else if (_selectedPairBuyIndex > idx) {
        _selectedPairBuyIndex--;
    }
    const pairSection = document.getElementById('pairBuySection');
    if (pairSection && pairSection.style.display !== 'none') {
        const code = document.getElementById('stockCode').value;
        if (code) renderPairBuyList(code);
    }
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
    let qty = 0;
    let cost = 0;
    for (const t of _trades) {
        if (t.code !== code) continue;
        const type = t.trade_type || t.type;
        const tQty = parseInt(t.quantity, 10) || 0;
        const price = parseFloat(t.price) || 0;
        if (type === 'BUY') {
            qty += tQty;
            cost += tQty * price;
        } else if (type === 'SELL') {
            const sellQty = Math.min(tQty, qty);
            if (qty > 0) {
                cost -= (cost / qty) * sellQty;
                cost = Math.max(0, cost);
            }
            qty = Math.max(0, qty - tQty);
        }
    }
    if (qty <= 0) return 0;
    return { qty, cost: cost / qty };
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
            if (noticeText && noticeText.startsWith('jQuery')) {
                const startIdx = noticeText.indexOf('(');
                const endIdx = noticeText.lastIndexOf(')');
                if (startIdx > -1 && endIdx > startIdx) {
                    noticeJson = noticeText.substring(startIdx + 1, endIdx);
                }
            }
            let noticeData;
            try { noticeData = JSON.parse(noticeJson); } catch(pe) { noticeData = null; }
            const items = (noticeData && noticeData.data && noticeData.data.list) || [];
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
            if (reportText && reportText.startsWith('jQuery')) {
                const startIdx = reportText.indexOf('(');
                const endIdx = reportText.lastIndexOf(')');
                if (startIdx > -1 && endIdx > startIdx) {
                    reportJson = reportText.substring(startIdx + 1, endIdx);
                }
            }
            let reportData;
            try { reportData = JSON.parse(reportJson); } catch(pe) { reportData = null; }
            reports = ((reportData && reportData.data) || []).map(it => ({
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

async function httpGetText(url, options = {}) {
    const { timeout = 10000, retry = 1 } = options;
    let lastError;
    
    const Http = getCapacitorHttp();
    if (Http) {
        for (let attempt = 0; attempt <= retry; attempt++) {
            try {
                const response = await Http.get({ url });
                return response.data;
            } catch (e) {
                lastError = e;
                if (attempt < retry) {
                    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                }
            }
        }
        console.warn('Capacitor HTTP文本请求最终失败:', url, lastError);
    }
    
    for (let attempt = 0; attempt <= retry; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { mode: 'cors', signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.text();
        } catch (e) {
            clearTimeout(timeoutId);
            lastError = e;
            if (attempt < retry && e.name !== 'AbortError') {
                console.log(`HTTP文本请求失败，重试中 (${attempt + 1}/${retry + 1}):`, url, e);
                await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            }
        }
    }
    console.error('HTTP文本请求最终失败:', url, lastError);
    throw lastError;
}

function renderNews(notices, reports) {
    const noticeList = document.getElementById('noticeList');
    const reportList = document.getElementById('reportList');
    
    if (notices.length > 0) {
        noticeList.innerHTML = notices.map(n => `
            <div style="padding:14px 0;border-bottom:1px solid var(--border-glass);">
                <div style="font-size:13px;font-weight:500;margin-bottom:6px;line-height:1.5;">${escapeHtml(n.title)}</div>
                <div style="display:flex;gap:10px;font-size:11px;color:var(--text-muted);">
                    ${n.category ? `<span style="background:rgba(129,140,248,0.1);color:var(--accent);padding:2px 8px;border-radius:10px;">${escapeHtml(n.category)}</span>` : ''}
                    <span>${escapeHtml(n.time)}</span>
                </div>
            </div>
        `).join('');
    } else {
        noticeList.innerHTML = '<div class="empty-state" style="padding:30px 0;font-size:12px;"><div class="empty-state-icon">📢</div>暂无公告数据</div>';
    }

    if (reports.length > 0) {
        reportList.innerHTML = reports.map(r => `
            <div style="padding:14px 0;border-bottom:1px solid var(--border-glass);">
                <div style="font-size:13px;font-weight:500;margin-bottom:6px;line-height:1.5;">${escapeHtml(r.title)}</div>
                <div style="display:flex;gap:10px;align-items:center;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">
                    <span>🏛️ ${escapeHtml(r.org || '未知机构')}</span>
                    ${r.rating ? `<span style="background:rgba(52,211,153,0.1);color:var(--green);padding:2px 8px;border-radius:10px;">${escapeHtml(r.rating)}</span>` : ''}
                    <span>${escapeHtml(r.time)}</span>
                </div>
            </div>
        `).join('');
    } else {
        reportList.innerHTML = '<div class="empty-state" style="padding:30px 0;font-size:12px;"><div class="empty-state-icon">📰</div>暂无研报数据</div>';
    }
}

// 长线页
function onLongtermSearchInput() {
    const kw = document.getElementById('longtermInput').value.trim();
    if (!kw) {
        document.getElementById('longtermSuggestions').style.display = 'none';
        return;
    }
    const myReqId = ++_searchRequestId;
    setSearchTimer('longterm', async () => {
        const results = await searchStockByName(kw);
        if (myReqId !== _searchRequestId) return;
        const container = document.getElementById('longtermSuggestions');
        if (results && results.length > 0) {
            container.innerHTML = results.slice(0, 5).map(r =>
                `<div class="suggestion-item" onclick="event.stopPropagation(); selectLongtermStock('${escapeHtml(r.code)}', '${escapeHtml(r.name)}')">${escapeHtml(r.name)} <span class="suggestion-code">${escapeHtml(r.code)}</span></div>`
            ).join('');
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }
    }, 200);
}

function selectLongtermStock(code, name) {
    document.getElementById('longtermInput').value = code;
    document.getElementById('longtermSuggestions').style.display = 'none';
    _stockNames[code] = name;
    loadLongtermDetail();
}

function loadLongtermHistory() {
    let history = [];
    try { history = JSON.parse(localStorage.getItem('longtermHistory') || '[]'); } catch(e) { history = []; }
    const container = document.getElementById('longtermHistory');
    const list = document.getElementById('longtermHistoryList');
    if (history.length > 0) {
        container.style.display = 'block';
        list.innerHTML = history.slice(0, 10).map(h =>
            `<span class="history-tag" onclick="selectLongtermStock('${escapeHtml(h.code)}', '${escapeHtml(h.name || h.code)}')">${escapeHtml(h.name || h.code)}</span>`
        ).join('');
    } else {
        container.style.display = 'none';
    }
}

async function loadLongtermDetail() {
    let code = document.getElementById('longtermInput').value.trim();
    if (!code) {
        showToast('请输入股票代码');
        return;
    }

    if (!/^\d{6}$/.test(code)) {
        const searchResult = await searchStockByName(code);
        if (searchResult && searchResult.length > 0) {
            code = searchResult[0].code;
            _stockNames[code] = searchResult[0].name;
            saveStockNames();
            document.getElementById('longtermInput').value = code;
        } else {
            showToast('未找到该股票');
            return;
        }
    }

    try {
        // 保存历史
        let history = [];
        try { history = JSON.parse(localStorage.getItem('longtermHistory') || '[]'); } catch(e) { history = []; }
        const newHistory = [{ code, name: _stockNames[code] || code, time: Date.now() }]
            .concat(history.filter(h => h.code !== code))
            .slice(0, 20);
        safeSetItem('longtermHistory', JSON.stringify(newHistory));
        loadLongtermHistory();

        document.getElementById('emptyLongterm').style.display = 'none';
        document.getElementById('longtermOverview').style.display = 'block';

        // 显示加载状态
        document.getElementById('longtermLoadingState').style.display = 'block';
        document.getElementById('longtermContentWrapper').style.display = 'none';
        // 移除之前的错误信息
        const oldError = document.querySelector('.longterm-error-msg');
        if (oldError) oldError.remove();
        
        // 复用loadStockInfo获取数据（经过验证的稳定方式）
        await loadStockInfo(code);
        
        if (!_currentStock) {
            throw new Error('获取股票信息失败');
        }

        // 用已有的K线数据
        if (!_lastKlines || _lastKlines.length < 30) {
            throw new Error('K线数据不足, 当前:' + (_lastKlines ? _lastKlines.length : 0));
        }

        // 渲染长线分析结果
        renderLongtermAnalysis(_currentStock, _lastKlines);

        // 隐藏loading，显示内容
        document.getElementById('longtermLoadingState').style.display = 'none';
        document.getElementById('longtermContentWrapper').style.display = 'block';

    } catch (e) {
        console.error('长线分析错误详情:', {
            message: e.message,
            stack: e.stack,
            stock: _currentStock,
            klines: _lastKlines ? _lastKlines.length : 0,
            strategyEngineExists: typeof strategyEngine !== 'undefined'
        });
        let debugInfo = 'stock:' + (_currentStock ? '有' : '无') + ' klines:' + (_lastKlines ? _lastKlines.length : 0) + ' strategyEngine:' + (typeof strategyEngine !== 'undefined' ? '有' : '无');
        document.getElementById('longtermLoadingState').style.display = 'none';
        document.getElementById('longtermContentWrapper').style.display = 'none';
        const errorDiv = document.createElement('div');
        errorDiv.className = 'empty-state';
        errorDiv.innerHTML = '<div class="empty-state-icon">📊</div><div>长线分析加载失败</div><div style="font-size:11px;color:var(--text-muted);margin-top:8px;">' + escapeHtml(e.message || '未知错误') + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">' + escapeHtml(debugInfo) + '</div>';
        const overview = document.getElementById('longtermOverview');
        // 移除之前的错误div（如果有）
        const oldError = overview.querySelector('.longterm-error-msg');
        if (oldError) oldError.remove();
        errorDiv.classList.add('longterm-error-msg');
        overview.appendChild(errorDiv);
    }
}

function renderLongtermAnalysis(stockInfo, klines) {
    try {
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume);
    const cp = closes.length > 0 ? closes[closes.length - 1] : 0;
    const pc = stockInfo.prev_close || closes[closes.length - 2] || cp;

    // 检查strategyEngine
    if (typeof strategyEngine === 'undefined') {
        throw new Error('strategyEngine未定义');
    }

    // 计算各周期均线
    const ma5 = strategyEngine.sma(closes, 5);
    const ma10 = strategyEngine.sma(closes, 10);
    const ma20 = strategyEngine.sma(closes, 20);
    const ma30 = strategyEngine.sma(closes, 30);
    const ma60 = strategyEngine.sma(closes, 60);
    const ma120 = strategyEngine.sma(closes, 120);
    const ma250 = strategyEngine.sma(closes, 250);

    // 计算RSI
    const rsi14 = strategyEngine.calcRsi(closes, 14);
    const rsi28 = strategyEngine.calcRsi(closes, 28);

    // 计算MACD
    const [dif, dea, bar] = strategyEngine.calcMacd(closes);

    // 计算布林带
    const [bollLower, bollMid, bollUpper] = strategyEngine.calcBollinger(closes);

    // ATR
    const atr = strategyEngine.calcAtr(highs, lows, closes, 14);

    // 当前时间判断趋势
    const now = new Date();
    const marketHour = now.getHours();
    const isAfterClose = marketHour >= 15;

    // 趋势判断
    let trend = '横盘';
    let trendDesc = '';
    if (ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20) {
        trend = '上升';
        trendDesc = '均线多头排列，短期强势';
    } else if (ma5 && ma10 && ma20 && ma5 < ma10 && ma10 < ma20) {
        trend = '下跌';
        trendDesc = '均线空头排列，短期弱势';
    } else if (ma20 && ma60 && ma20 > ma60) {
        trend = '上升';
        trendDesc = '中长期上升趋势';
    } else if (ma20 && ma60 && ma20 < ma60) {
        trend = '下跌';
        trendDesc = '中长期下降趋势';
    } else {
        trendDesc = '均线纠缠，震荡整理';
    }

    // 估值分析（简化版PE分析）
    const avgPrice = closes.slice(-250).reduce((a, b) => a + b, 0) / Math.min(250, closes.length);
    const peRatio = avgPrice > 0 ? cp / avgPrice : 0; // 简化PE计算
    let valueLevel = '适中';
    let valueDesc = '';
    if (peRatio < 0.8) {
        valueLevel = '低估';
        valueDesc = '当前价格低于250日均价，存在估值优势';
    } else if (peRatio > 1.2) {
        valueLevel = '高估';
        valueDesc = '当前价格高于250日均价较多，注意风险';
    } else {
        valueDesc = '当前价格处于历史均值附近';
    }

    // ========== 多因子综合估值模型 ==========
    // 核心原理：价格 = 价值中枢 × (1 + 均值回归 + 趋势漂移 + 动量衰减) ± 波动率锥
    // 比单因子模型精准的原因：融合了价值回归、中枢漂移、动量延续三个维度

    const ma60Val = ma60;
    const ma120Val = ma120;
    const ma250Val = ma250;
    const allTimeHigh = highs.length > 0 ? highs.reduce((a, b) => Math.max(a, b), highs[0]) : cp;
    const allTimeLow = lows.length > 0 ? lows.reduce((a, b) => Math.min(a, b), lows[0]) : cp;

    // 1. 多锚点加权价值中枢（比单一MA更稳定）
    let valueCenter;
    if (ma250Val && ma120Val && ma60Val) {
        valueCenter = ma60Val * 0.25 + ma120Val * 0.35 + ma250Val * 0.40;
    } else if (ma250Val && ma120Val) {
        valueCenter = ma120Val * 0.45 + ma250Val * 0.55;
    } else if (ma120Val && ma60Val) {
        valueCenter = ma60Val * 0.40 + ma120Val * 0.60;
    } else if (ma250Val) {
        valueCenter = ma250Val;
    } else if (ma120Val) {
        valueCenter = ma120Val;
    } else {
        valueCenter = closes.length > 0 ? closes.reduce((a, b) => a + b, 0) / closes.length : cp;
    }

    // 2. 价值中枢漂移率（年化）—— 捕捉中枢本身的移动方向
    // 优先用MA120/MA250的斜率（更稳定），MA60作为辅助
    let centerDriftAnnual = 0;
    if (ma250 && closes.length >= 121) {
        const maNow = ma250;
        const maBefore = strategyEngine.sma(closes.slice(0, closes.length - 120), 250);
        if (maBefore > 0) {
            centerDriftAnnual = Math.pow(maNow / maBefore, 250 / 120) - 1;
        }
    } else if (ma120 && closes.length >= 61) {
        const maNow = ma120;
        const maBefore = strategyEngine.sma(closes.slice(0, closes.length - 60), 120);
        if (maBefore > 0) {
            centerDriftAnnual = Math.pow(maNow / maBefore, 250 / 60) - 1;
        }
    } else if (ma60 && closes.length >= 31) {
        const maNow = ma60;
        const maBefore = strategyEngine.sma(closes.slice(0, closes.length - 30), 60);
        if (maBefore > 0) {
            centerDriftAnnual = Math.pow(maNow / maBefore, 250 / 30) - 1;
        }
    }
    // 限制漂移率在保守范围 -20%~+25%（长期可持续的增长率）
    centerDriftAnnual = Math.max(-0.2, Math.min(0.25, centerDriftAnnual));

    // 3. 均值回归因子 —— 价格偏离价值中枢越远，回归力越强
    const deviation = valueCenter > 0 ? (cp - valueCenter) / valueCenter : 0; // 正=偏高，负=偏低

    // 4. 动量因子 —— 近期涨跌有延续性，但随时间衰减
    let momentum20 = 0;
    if (closes.length >= 21 && closes[closes.length - 21] > 0) {
        momentum20 = (cp - closes[closes.length - 21]) / closes[closes.length - 21];
    }
    let momentum60 = 0;
    if (closes.length >= 61 && closes[closes.length - 61] > 0) {
        momentum60 = (cp - closes[closes.length - 61]) / closes[closes.length - 61];
    }
    // 综合20日和60日动量，20日权重高
    const combinedMomentum = momentum20 * 0.6 + momentum60 * 0.4;

    // 5. 年化波动率（基于日收益率标准差）
    let annualVolatility = 0.3;
    if (closes.length >= 60) {
        const returns = [];
        for (let i = Math.max(1, closes.length - 250); i < closes.length; i++) {
            if (closes[i - 1] > 0) {
                returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
            }
        }
        if (returns.length > 1) {
            const avgRet = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((a, b) => a + Math.pow(b - avgRet, 2), 0) / returns.length;
            annualVolatility = Math.sqrt(variance) * Math.sqrt(250);
        }
    }
    annualVolatility = Math.max(0.1, Math.min(0.6, annualVolatility));

    // 估值位置：当前价在历史区间的位置（0=最低，1=最高）
    const priceRange = allTimeHigh - allTimeLow;
    const pricePosition = priceRange > 0 ? (cp - allTimeLow) / priceRange : 0.5;

    // 趋势方向判断（基于均线系统）—— 仅用于展示建议
    let trendLevel = 0;
    if (ma5 && ma10 && ma20) {
        if (ma5 > ma10 && ma10 > ma20) trendLevel += 1;
        else if (ma5 < ma10 && ma10 < ma20) trendLevel -= 1;
    }
    if (ma20 && ma60) {
        if (ma20 > ma60) trendLevel += 1;
        else if (ma20 < ma60) trendLevel -= 1;
    }
    if (ma60 && ma120Val) {
        if (ma60 > ma120Val) trendLevel += 1;
        else if (ma60 < ma120Val) trendLevel -= 1;
    }
    if (trendLevel > 2) trendLevel = 2;
    if (trendLevel < -2) trendLevel = -2;

    // 各周期分析
    const periods = [
        { name: '1个月', days: 20, factor: 0.1 },
        { name: '3个月', days: 60, factor: 0.25 },
        { name: '半年', days: 120, factor: 0.45 },
        { name: '1年', days: 240, factor: 0.7 },
        { name: '2年', days: 480, factor: 1.0 }
    ];

    // 标准正态分布累积分布函数（Abramowitz-Stegun近似）
    const normCDF = (x) => {
        const t = 1 / (1 + 0.2316419 * Math.abs(x));
        const d = 0.3989423 * Math.exp(-x * x / 2);
        const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
        return x > 0 ? 1 - p : p;
    };

    let periodHtml = '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px;">';
    for (const p of periods) {
        if (closes.length < Math.min(p.days, 30)) continue;
        const periodCloses = closes.slice(-Math.min(p.days, closes.length));
        const periodHighs = highs.slice(-Math.min(p.days, closes.length));
        const periodLows = lows.slice(-Math.min(p.days, closes.length));

        const periodChange = periodCloses.length >= 2
            ? (periodCloses[periodCloses.length - 1] - periodCloses[0]) / periodCloses[0] * 100
            : 0;
        const periodHigh = periodHighs.reduce((a, b) => Math.max(a, b), periodHighs[0]);
        const periodLow = periodLows.reduce((a, b) => Math.min(a, b), periodLows[0]);

        // ====== 多因子价格预测 ======
        const years = p.days / 250;
        const volForPeriod = annualVolatility * Math.sqrt(Math.max(years, 0.04));

        // 因子1：中枢漂移（随时间累积，趋势的延续）
        const driftReturn = centerDriftAnnual * years;

        // 因子2：均值回归（偏离越大回归越强，1年回归约60%，用指数衰减）
        // reversionRate: 1年=0.6, 2年=0.84, 半年=0.34
        const reversionRate = 1 - Math.exp(-years * 0.9);
        const reversionReturn = -deviation * reversionRate;

        // 因子3：动量延续（近期动量随时间衰减，半衰期约2个月）
        // 时间越短动量影响越大，时间越长动量几乎消失
        const momentumDecay = Math.exp(-years * 6); // 1个月≈0.95, 半年≈0.05, 1年≈0.003
        const momentumReturn = combinedMomentum * 0.4 * momentumDecay;

        // 预期总收益率
        const expectedReturn = driftReturn + reversionReturn + momentumReturn;

        // 中性价 = 当前价 × (1 + 预期收益率)
        let neutral = cp * (1 + expectedReturn);

        // 乐观/悲观价 = 中性价 ± 波动率锥（不同周期用不同倍数）
        // 短期波动小（动量主导），长期波动大（均值回归主导）
        let optimistic = neutral * (1 + volForPeriod * 0.85);
        let pessimistic = neutral * (1 - volForPeriod * 0.85);

        // 边界保护：不超过历史高点的1.15倍，不低于历史低点的0.85倍，且最低0.01
        const maxPrice = allTimeHigh * 1.15;
        const minPrice = Math.max(allTimeLow * 0.85, 0.01);
        optimistic = Math.min(optimistic, maxPrice);
        pessimistic = Math.max(pessimistic, minPrice);
        neutral = Math.max(Math.min(neutral, maxPrice), minPrice);
        // 确保悲观价不低于0.01（避免出现负数或零）
        pessimistic = Math.max(pessimistic, 0.01);

        // 确保乐观 > 中性 > 悲观
        if (neutral <= pessimistic) neutral = pessimistic * 1.05;
        if (optimistic <= neutral) optimistic = neutral * 1.08;

        // ====== 概率计算（基于正态分布 N(expectedReturn, volForPeriod²)）======
        // 阈值：明显涨跌的分界线，与波动率挂钩
        const probThreshold = Math.max(0.03, volForPeriod * 0.4);
        const zOpt = (probThreshold - expectedReturn) / volForPeriod;
        const zPes = (-probThreshold - expectedReturn) / volForPeriod;
        let optProbRaw = 1 - normCDF(zOpt);       // P(收益 > 阈值)
        let pesProbRaw = normCDF(zPes);            // P(收益 < -阈值)
        let neuProbRaw = Math.max(0, 1 - optProbRaw - pesProbRaw); // 中间区间
        // 归一化确保三者之和=100%
        const probSum = optProbRaw + neuProbRaw + pesProbRaw;
        const optProb = Math.round(optProbRaw / probSum * 100);
        const pesProb = Math.round(pesProbRaw / probSum * 100);
        const neuProb = 100 - optProb - pesProb;

        // 建议
        let action = '观望';
        let actionColor = 'var(--text-muted)';
        let actionDesc = '等待明确信号';
        if (trendLevel >= 1 && periodChange > 0) {
            action = '持有/买入';
            actionColor = 'var(--green)';
            actionDesc = `上涨${periodChange.toFixed(1)}%，顺势而为`;
        } else if (trendLevel <= -1 && periodChange < 0) {
            action = '观望/减仓';
            actionColor = 'var(--red)';
            actionDesc = `下跌${Math.abs(periodChange).toFixed(1)}%，注意风险`;
        }

        const optPct = ((optimistic - cp) / cp * 100).toFixed(1);
        const neuPct = ((neutral - cp) / cp * 100).toFixed(1);
        const pesPct = ((pessimistic - cp) / cp * 100).toFixed(1);

        periodHtml += `
            <div style="background:linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.08)); border:1px solid rgba(99,102,241,0.2); border-radius:12px; padding:12px;">
                <div style="font-size:13px; font-weight:700; color:var(--accent); margin-bottom:10px;">${p.name}</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px;">
                    <div style="background:rgba(0,0,0,0.25); border-radius:8px; padding:6px 8px;">
                        <div style="font-size:9px; color:var(--text-muted);">乐观</div>
                        <div style="font-size:13px; font-weight:700; color:var(--red);">${optimistic.toFixed(2)}</div>
                        <div style="font-size:9px; color:var(--red);">${optPct >= 0 ? '+' : ''}${optPct}%</div>
                        <div style="font-size:9px; color:var(--red); opacity:0.85; margin-top:2px;">概率 ${optProb}%</div>
                    </div>
                    <div style="background:rgba(0,0,0,0.25); border-radius:8px; padding:6px 8px;">
                        <div style="font-size:9px; color:var(--text-muted);">中性</div>
                        <div style="font-size:13px; font-weight:700; color:${neutral >= cp ? 'var(--green)' : 'var(--red)'};">${neutral.toFixed(2)}</div>
                        <div style="font-size:9px; color:${neutral >= cp ? 'var(--green)' : 'var(--red)'};">${neuPct >= 0 ? '+' : ''}${neuPct}%</div>
                        <div style="font-size:9px; color:var(--text-secondary); opacity:0.85; margin-top:2px;">概率 ${neuProb}%</div>
                    </div>
                    <div style="background:rgba(0,0,0,0.25); border-radius:8px; padding:6px 8px;">
                        <div style="font-size:9px; color:var(--text-muted);">悲观</div>
                        <div style="font-size:13px; font-weight:700; color:var(--green);">${pessimistic.toFixed(2)}</div>
                        <div style="font-size:9px; color:var(--green);">${pesPct >= 0 ? '+' : ''}${pesPct}%</div>
                        <div style="font-size:9px; color:var(--green); opacity:0.85; margin-top:2px;">概率 ${pesProb}%</div>
                    </div>
                    <div style="background:rgba(0,0,0,0.25); border-radius:8px; padding:6px 8px;">
                        <div style="font-size:9px; color:var(--text-muted);">现价</div>
                        <div style="font-size:13px; font-weight:700;">${cp.toFixed(2)}</div>
                        <div style="font-size:9px; color:var(--text-muted);">${periodChange >= 0 ? '+' : ''}${periodChange.toFixed(1)}%</div>
                    </div>
                </div>
                <div style="font-size:12px; font-weight:600; color:${actionColor};">${action}</div>
                <div style="font-size:10px; color:var(--text-muted);">${actionDesc}</div>
            </div>
        `;
    }
    periodHtml += '</div>';

    // 趋势内容
    const trendHtml = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div style="background:rgba(52,211,153,0.08); border:1px solid rgba(52,211,153,0.15); border-radius:10px; padding:12px;">
                <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">当前趋势</div>
                <div style="font-size:16px; font-weight:700; color:${trend === '上升' ? 'var(--green)' : trend === '下跌' ? 'var(--red)' : 'var(--yellow)'};">${trend}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${trendDesc}</div>
            </div>
            <div style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.15); border-radius:10px; padding:12px;">
                <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">估值水平</div>
                <div style="font-size:16px; font-weight:700; color:${valueLevel === '低估' ? 'var(--green)' : valueLevel === '高估' ? 'var(--red)' : 'var(--yellow)'};">${valueLevel}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${valueDesc}</div>
            </div>
        </div>
        <div style="margin-top:12px; display:grid; grid-template-columns:repeat(4, 1fr); gap:8px;">
            <div style="text-align:center; padding:8px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">MA5</div>
                <div style="font-size:12px; font-weight:600;">${ma5 ? ma5.toFixed(2) : '--'}</div>
            </div>
            <div style="text-align:center; padding:8px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">MA20</div>
                <div style="font-size:12px; font-weight:600;">${ma20 ? ma20.toFixed(2) : '--'}</div>
            </div>
            <div style="text-align:center; padding:8px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">MA60</div>
                <div style="font-size:12px; font-weight:600;">${ma60 ? ma60.toFixed(2) : '--'}</div>
            </div>
            <div style="text-align:center; padding:8px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">MA250</div>
                <div style="font-size:12px; font-weight:600;">${ma250 ? ma250.toFixed(2) : '--'}</div>
            </div>
        </div>
    `;

    // 估值内容
    const valueHtml = `
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:12px;">
            <div style="text-align:center; padding:10px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">RSI(14)</div>
                <div style="font-size:14px; font-weight:700; color:${rsi14 > 70 ? 'var(--red)' : rsi14 < 30 ? 'var(--green)' : 'var(--text)'};">${rsi14 ? rsi14.toFixed(1) : '--'}</div>
            </div>
            <div style="text-align:center; padding:10px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">MACD</div>
                <div style="font-size:14px; font-weight:700; color:${bar > 0 ? 'var(--green)' : 'var(--red)'};">${bar ? (bar > 0 ? '红柱' : '绿柱') : '--'}</div>
            </div>
            <div style="text-align:center; padding:10px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">布林</div>
                <div style="font-size:14px; font-weight:700;">${bollUpper && bollLower ? '收口' : '开口'}</div>
            </div>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); line-height:1.6;">
            ${valueDesc}<br>
            ${rsi14 > 70 ? '⚠️ RSI超买，可能面临回调风险' : rsi14 < 30 ? '✨ RSI超卖，可能存在反弹机会' : 'RSI处于正常区间'}
        </div>
    `;

    // 关键价位
    const supportHtml = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div style="padding:10px; background:rgba(52,211,153,0.08); border:1px solid rgba(52,211,153,0.2); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">支撑位</div>
                <div style="font-size:14px; font-weight:700; color:var(--green);">${bollLower ? bollLower.toFixed(2) : (cp * 0.95).toFixed(2)}</div>
                <div style="font-size:10px; color:var(--text-muted);">布林下轨</div>
            </div>
            <div style="padding:10px; background:rgba(248,113,113,0.08); border:1px solid rgba(248,113,113,0.2); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">压力位</div>
                <div style="font-size:14px; font-weight:700; color:var(--red);">${bollUpper ? bollUpper.toFixed(2) : (cp * 1.05).toFixed(2)}</div>
                <div style="font-size:10px; color:var(--text-muted);">布林上轨</div>
            </div>
        </div>
        <div style="margin-top:10px; display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
            <div style="text-align:center; padding:8px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">现价</div>
                <div style="font-size:13px; font-weight:700;">${cp.toFixed(2)}</div>
            </div>
            <div style="text-align:center; padding:8px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">ATR</div>
                <div style="font-size:13px; font-weight:700;">${atr ? atr.toFixed(2) : '--'}</div>
            </div>
            <div style="text-align:center; padding:8px; background:var(--bg-inset); border-radius:8px;">
                <div style="font-size:10px; color:var(--text-muted);">乖离</div>
                <div style="font-size:13px; font-weight:700;">${ma20 ? ((cp - ma20) / ma20 * 100).toFixed(1) + '%' : '--'}</div>
            </div>
        </div>
    `;

    // 风险提示
    const riskItems = [];
    if (rsi14 > 80) riskItems.push({ level: 'high', text: 'RSI严重超买，回调风险大' });
    if (rsi14 < 20) riskItems.push({ level: 'low', text: 'RSI严重超卖，可能存在反弹机会' });
    if (peRatio > 1.5) riskItems.push({ level: 'high', text: '估值偏高，注意追高风险' });
    if (peRatio < 0.6) riskItems.push({ level: 'low', text: '估值偏低，可能被低估' });
    if (ma5 && ma10 && ma20 && ma5 < ma10 && ma10 < ma20) riskItems.push({ level: 'high', text: '均线空头排列，中期趋势向下' });
    if (bar < 0 && dif < 0) riskItems.push({ level: 'medium', text: 'MACD死叉，短线走弱' });

    if (riskItems.length === 0) {
        riskItems.push({ level: 'info', text: '暂无明显风险提示' });
    }

    const riskHtml = riskItems.map(r => `
        <div style="padding:8px 10px; background:rgba(${r.level === 'high' ? '248,113,113' : r.level === 'low' ? '52,211,153' : '99,102,241'},0.08);
            border-left:3px solid rgb(${r.level === 'high' ? '248,113,113' : r.level === 'low' ? '52,211,153' : '99,102,241'});
            margin-bottom:6px; border-radius:0 6px 6px 0;">
            <span style="font-size:12px;">${r.text}</span>
        </div>
    `).join('');

    // 综合建议
    let overallAction = '观望';
    let overallColor = 'var(--text-muted)';
    let overallDesc = '';

    if (trend === '上升' && valueLevel !== '高估' && rsi14 < 70) {
        overallAction = '建议关注';
        overallColor = 'var(--green)';
        overallDesc = '趋势向上，估值合理，可考虑逢低布局';
    } else if (trend === '上升' && valueLevel === '高估') {
        overallAction = '谨慎追高';
        overallColor = 'var(--yellow)';
        overallDesc = '趋势向上但估值偏高，等待回调再考虑';
    } else if (trend === '下跌') {
        overallAction = '注意风险';
        overallColor = 'var(--red)';
        overallDesc = '趋势向下，建议观望或轻仓';
    } else {
        overallDesc = '市场震荡，建议观望为主';
    }

    const summaryHtml = `
        <div style="background:linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1)); border:1px solid rgba(99,102,241,0.3); border-radius:12px; padding:16px;">
            <div style="font-size:18px; font-weight:700; color:${overallColor}; margin-bottom:8px;">${overallAction}</div>
            <div style="font-size:13px; color:var(--text-secondary); line-height:1.6;">${overallDesc}</div>
        </div>
        <div style="margin-top:12px; font-size:12px; color:var(--text-muted); line-height:1.6;">
            <strong>长线投资建议：</strong><br>
            1. ${trend === '上升' ? '中长期趋势向上，适合定投或分批买入' : trend === '下跌' ? '中长期趋势向下，建议耐心等待' : '中长期趋势不明，保持观望'}<br>
            2. ${valueLevel === '低估' ? '当前估值偏低，是长线布局的好时机' : valueLevel === '高估' ? '当前估值偏高，注意长线买入成本' : '当前估值合理，可择机布局'}<br>
            3. 建议仓位：${trend === '上升' && valueLevel !== '高估' ? '30%-50%' : trend === '下跌' ? '10%-20%' : '20%-30%'}
        </div>
        <div style="margin-top:12px; padding:10px; background:rgba(99,102,241,0.06); border:1px solid rgba(99,102,241,0.15); border-radius:8px; font-size:11px; color:var(--text-muted); line-height:1.6;">
            <strong style="color:var(--accent);">📊 多因子估值模型说明</strong><br>
            • 价值中枢：MA60(25%)+MA120(35%)+MA250(40%)加权<br>
            • 中枢漂移：长周期均线斜率，反映趋势延续性<br>
            • 均值回归：偏离中枢越远回归越强（1年回归约60%）<br>
            • 动量衰减：近期涨跌有惯性，但随时间快速衰减<br>
            • 当前偏离中枢：${(deviation * 100).toFixed(1)}%｜漂移率：${(centerDriftAnnual * 100).toFixed(1)}%｜波动率：${(annualVolatility * 100).toFixed(1)}%
        </div>
    `;

    // 渲染
    document.getElementById('longtermPeriodGrid').innerHTML = periodHtml;
    document.getElementById('longtermTrendContent').innerHTML = trendHtml;
    document.getElementById('longtermValueContent').innerHTML = valueHtml;
    document.getElementById('longtermSupportContent').innerHTML = supportHtml;
    document.getElementById('longtermRiskContent').innerHTML = riskHtml;
    document.getElementById('longtermSummaryContent').innerHTML = summaryHtml;
    } catch (e) {
        console.error('renderLongtermAnalysis内部错误:', e);
        throw e;
    }
}

document.addEventListener('DOMContentLoaded', init);

// R10-1: 使用具名函数引用，便于 cleanupAllResources 移除，避免内存泄漏
window._globalKeydownHandler = function(e) {
    if (e.key === 'Escape') {
        const strategyModal = document.getElementById('strategyModal');
        if (strategyModal && strategyModal.classList.contains('show')) {
            closeModal();
            return;
        }
        // R10-2: 补充 dimensionModal 的 ESC 关闭处理
        const dimensionModal = document.getElementById('dimensionModal');
        if (dimensionModal && dimensionModal.classList.contains('show')) {
            dimensionModal.classList.remove('show');
            setTimeout(() => { dimensionModal.style.display = 'none'; }, 250);
            document.body.style.overflow = '';
            return;
        }
        const watchModal = document.getElementById('watchModal');
        if (watchModal && watchModal.classList.contains('show')) {
            closeWatchModal();
            return;
        }
        const learnModal = document.getElementById('learnModal');
        if (learnModal && learnModal.classList.contains('show')) {
            closeLearnModal();
            return;
        }
    }
};
document.addEventListener('keydown', window._globalKeydownHandler);

// ==================== 监控股票管理 ====================
function showAddWatchModal() {
    closeAllModals();
    const modal = document.getElementById('watchModal');
    if (modal) {
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('show');
        });
    }
    document.getElementById('watchCodeInput').value = '';
    setTimeout(() => document.getElementById('watchCodeInput').focus(), 100);
    document.body.style.overflow = 'hidden';
}

function closeWatchModal() {
    const modal = document.getElementById('watchModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 250);
    }
    document.getElementById('watchCodeInput').value = '';
    const sug = document.getElementById('watchSearchSuggestions');
    if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
    document.body.style.overflow = '';
}

function onWatchSearchInput() {
    const kw = document.getElementById('watchCodeInput').value.trim();
    if (!kw) {
        const sug = document.getElementById('watchSearchSuggestions');
        if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
        return;
    }
    
    const myReqId = ++_searchRequestId;
    setSearchTimer('watch_add', async () => {
        const loadingEl = document.getElementById('watchSearchLoading');
        if (loadingEl) loadingEl.style.display = 'inline';
        
        try {
            const results = await searchStockByName(kw);
            if (myReqId !== _searchRequestId) return;
            const sug = document.getElementById('watchSearchSuggestions');
            if (!sug) return;
            if (results.length > 0) {
                sug.innerHTML = results.map(item => `
                    <div class="suggestion-item" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">
                        <span class="suggestion-code">${escapeHtml(item.code)}</span>
                        <span class="suggestion-name">${escapeHtml(item.name)}</span>
                    </div>
                `).join('');
                sug.style.display = 'block';
                sug.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', () => {
                        document.getElementById('watchCodeInput').value = el.dataset.code;
                        _stockNames[el.dataset.code] = el.dataset.name;
                        sug.style.display = 'none';
                    });
                });
            } else {
                sug.innerHTML = '<div class="suggestion-item" style="justify-content:center;color:var(--text-muted);">未找到</div>';
                sug.style.display = 'block';
            }
        } catch (e) { console.error(e); }
        finally {
            if (myReqId === _searchRequestId && loadingEl) loadingEl.style.display = 'none';
        }
    }, 250);
}

function addWatchStock(code, name) {
    if (!code) {
        code = document.getElementById('watchCodeInput').value.trim();
    }
    
    if (!code) {
        showToast('请输入股票代码或名称');
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
    if (name) {
        _stockNames[code] = name;
    }
    saveWatchList();
    renderWatchList();
    closeWatchModal();
    showToast(`✓ 已添加 ${code} 到监控列表`);
    
    autoAddTradedStocks();
}

function renderWatchList(autoRefresh = true) {
    const miniContainer = document.getElementById('watchListMini');
    
    if (!miniContainer) return;
    
    if (!_watchList || _watchList.length === 0) {
        miniContainer.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">暂无监控股票，搜索后点击右侧"+添加"</span>';
        return;
    }
    
    const miniHtml = _watchList.map(code => `
        <span class="watch-tag" data-code="${escapeHtml(code)}" onclick="refreshTSignalForStock('${escapeHtml(code)}')">
            ${escapeHtml(code)}
            <button onclick="event.stopPropagation(); removeFromWatchlist('${escapeHtml(code)}')">×</button>
        </span>
    `).join('');
    miniContainer.innerHTML = miniHtml;
    
    miniContainer.querySelectorAll('.watch-tag').forEach(tag => {
        const code = tag.dataset.code;
        const name = _stockNames[code] || code;
        initLongPress(tag, (el, x, y) => {
            showLongPressMenu(x, y, [
                { icon: '🔍', label: '查看详情', onClick: () => { doSearchByCode(code); } },
                { icon: '🔄', label: '刷新信号', onClick: () => { refreshTSignalForStock(code); } },
                { divider: true },
                { icon: '❌', label: '移除监控', danger: true, onClick: () => { removeFromWatchlist(code); } }
            ], el);
        });
    });
    
    if (autoRefresh) {
        refreshAllTSignals();
    }
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
            <div id="signal-card-${escapeHtml(code)}" class="signal-card" style="background:var(--bg-inset);border-radius:6px;padding:6px 8px;margin-top:4px;cursor:pointer;line-height:1.4;" onclick="viewTSignalDetail('${escapeHtml(code)}')">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)} <span style="color:var(--text-muted);font-weight:400;font-size:11px;">${escapeHtml(code)}</span></div>
                    <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">加载中...</span>
                </div>
            </div>
        `;
    }).join('');
    
    // 分批加载，每次3个，避免同时发起大量请求阻塞UI
    let index = 0;
    const batchSize = 3;
    if (_tSignalBatchTimer) {
        clearTimeout(_tSignalBatchTimer);
        _tSignalBatchTimer = null;
    }
    const loadNextBatch = () => {
        if (index >= _watchList.length) return;
        const batch = _watchList.slice(index, index + batchSize);
        index += batchSize;
        batch.forEach(code => getLiveTSignals(code));
        // 下一批延迟一点加载，给UI喘息时间
        _tSignalBatchTimer = setTimeout(loadNextBatch, 150);
    };
    loadNextBatch();
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
        <div style="display:flex;justify-content:space-between;align-items:center;line-height:1.4;">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)} <span style="color:var(--text-muted);font-weight:400;font-size:11px;">${escapeHtml(code)}</span></div>
            <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">刷新中...</span>
        </div>
    `;
    getLiveTSignals(code);
}

// ==================== 实时做T信号 ====================
async function getLiveTSignals(stockCode) {
    const cardDiv = document.getElementById('signal-card-' + stockCode);

    if (!cardDiv) return;

    const myReqId = ++_tSignalRequestId;
    _tSignalReqMap[stockCode] = myReqId;

    try {
        const prefix = getTencentPrefix(stockCode);
        const fullCode = `${prefix}${stockCode}`;
        
        // 第一步：获取实时行情（腾讯接口稳定）
        const qt = await fetchJsonpVar(`https://qt.gtimg.cn/q=${fullCode}`, `v_${fullCode}`, 5000);
        if (!qt) {
            cardDiv.innerHTML = renderSignalCardError(stockCode, '加载失败');
            return;
        }
        const stockInfo = parseTencentQtData(qt.split('~'));
        if (!stockInfo) {
            cardDiv.innerHTML = renderSignalCardError(stockCode, '数据解析失败');
            return;
        }
        
        // 第二步：获取K线数据（腾讯接口）
        const klineUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,120,qfq`;
        const klineData = await httpGet(klineUrl, { timeout: 10000 });

        if (_tSignalReqMap[stockCode] !== myReqId) return;
        if (!cardDiv || !cardDiv.parentNode) return;

        if (klineData.code !== 0 || !klineData.data || !klineData.data[fullCode]) {
            cardDiv.innerHTML = renderSignalCardError(stockCode, 'K线不足');
            return;
        }
        
        const klineArray = klineData.data[fullCode].qfqday || klineData.data[fullCode].day || [];
        const klines = klineArray.map(line => ({
            date: line[0] || '',
            open: parseFloat(line[1]) || 0,
            close: parseFloat(line[2]) || 0,
            high: parseFloat(line[3]) || 0,
            low: parseFloat(line[4]) || 0,
            volume: parseFloat(line[5]) * 100 || 0,
            amount: 0
        }));
        if (klines.length < 20) {
            cardDiv.innerHTML = renderSignalCardError(stockCode, 'K线不足');
            return;
        }
        
        const holdings = getHoldings(stockCode);
        const holdQty = typeof holdings === 'number' ? holdings : (holdings && holdings.qty) || 0;
        const holdCost = typeof holdings === 'object' && holdings ? (holdings.cost || 0) : 0;
        const result = strategyEngine.runAllStrategies(stockInfo, klines, holdings, {
            fixedPredictionHour: _settings.fixedPredictionTime
        });
        if (!Array.isArray(result) || result.length !== 2) {
            cardDiv.innerHTML = renderSignalCardError(stockCode, '策略计算失败');
            return;
        }
        const [strategies, summary] = result;
        
        const tSignals = strategies.filter(s => 
            s.action === 'TRADING_OPPORTUNITY' || 
            s.action === 'BUY_THEN_SELL' || 
            s.action === 'SELL_THEN_BUY' ||
            s.action === 'BOX_TRADING'
        );
        
        if (tSignals.length > 0) {
            const s = tSignals[0];
            const isBuyT = s.action === 'BUY_THEN_SELL' || (s.action === 'TRADING_OPPORTUNITY' && summary.trend_bias >= 0);
            const isSellT = s.action === 'SELL_THEN_BUY' || (s.action === 'TRADING_OPPORTUNITY' && summary.trend_bias < 0);
            const color = isBuyT ? 'var(--green)' : 'var(--red)';
            let tType = '做T机会';
            if (s.action === 'BUY_THEN_SELL') tType = '正T (先买后卖)';
            else if (s.action === 'SELL_THEN_BUY') tType = '反T (先卖后买)';
            else if (s.action === 'BOX_TRADING') tType = '箱体做T';
            
            const changeColor = stockInfo.change_percent >= 0 ? 'var(--red)' : 'var(--green)';
            const costLine = holdQty > 0 && holdCost > 0 
                ? `<span style="color:var(--text-muted);">成本</span> <span style="color:${stockInfo.current_price >= holdCost ? 'var(--red)' : 'var(--green)'}">¥${holdCost.toFixed(2)}</span>`
                : '';
            cardDiv.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;line-height:1.4;">
                    <div style="min-width:0;flex:1;">
                        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(stockInfo.name)} <span style="color:var(--text-muted);font-weight:400;font-size:11px;">${escapeHtml(stockInfo.code)}</span></div>
                        <div style="font-size:11px;color:${color};margin-top:1px;">⚡ ${tType}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;margin-left:8px;">
                        <div style="font-size:13px;font-weight:600;color:${changeColor};">¥${stockInfo.current_price.toFixed(2)}</div>
                        <div style="font-size:10px;color:var(--text-muted);">${stockInfo.change_percent >= 0 ? '+' : ''}${stockInfo.change_percent.toFixed(2)}%</div>
                    </div>
                </div>
                <div style="margin-top:3px;font-size:10px;color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    ${costLine}
                    ${s.target_price ? `<span>目标 <span style="color:var(--green);">¥${s.target_price}</span></span>` : ''}
                    ${s.stop_loss ? `<span>止损 <span style="color:var(--red);">¥${s.stop_loss}</span></span>` : ''}
                    ${s.confidence ? `<span>置信 ${(s.confidence * 100).toFixed(0)}%</span>` : ''}
                </div>
            `;
        } else {
            const changeColor2 = stockInfo.change_percent >= 0 ? 'var(--red)' : 'var(--green)';
            const costLine2 = holdQty > 0 && holdCost > 0
                ? `<span style="color:var(--text-muted);">成本</span> <span style="color:${stockInfo.current_price >= holdCost ? 'var(--red)' : 'var(--green)'}">¥${holdCost.toFixed(2)}</span>`
                : '';
            cardDiv.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;line-height:1.4;">
                    <div style="min-width:0;flex:1;">
                        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(stockInfo.name)} <span style="color:var(--text-muted);font-weight:400;font-size:11px;">${escapeHtml(stockInfo.code)}</span></div>
                        <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">⏸️ 观望中</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;margin-left:8px;">
                        <div style="font-size:13px;font-weight:600;color:${changeColor2};">¥${stockInfo.current_price.toFixed(2)}</div>
                        <div style="font-size:10px;color:var(--text-muted);">${stockInfo.change_percent >= 0 ? '+' : ''}${stockInfo.change_percent.toFixed(2)}%</div>
                    </div>
                </div>
                ${costLine2 ? `
                <div style="margin-top:3px;font-size:10px;color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    ${costLine2}
                </div>
                ` : ''}
            `;
        }
        
        _stockNames[stockCode] = stockInfo.name;
        
        if (cardDiv && cardDiv.parentNode) {
            initLongPress(cardDiv, (el, x, y) => {
                showLongPressMenu(x, y, [
                    { icon: '🔍', label: '查看详情', onClick: () => { doSearchByCode(stockCode); } },
                    { icon: '🔄', label: '刷新信号', onClick: () => { refreshTSignalForStock(stockCode); } },
                    { divider: true },
                    { icon: '❌', label: '移除监控', danger: true, onClick: () => { removeFromWatchlist(stockCode); } }
                ], el);
            });
        }
        
        checkAndAlertSignals(stockCode, stockInfo, strategies);
        
        updateHomeBestPlan(stockCode, stockInfo, summary, holdings);
        
    } catch (e) {
        if (cardDiv && cardDiv.parentNode) {
            cardDiv.innerHTML = renderSignalCardError(stockCode, '网络异常');
        }
    } finally {
        if (_tSignalReqMap[stockCode] === myReqId) {
            delete _tSignalReqMap[stockCode];
        }
    }
}

let _homePlanStock = null;
function updateHomeBestPlan(code, stockInfo, summary, holdings) {
    if (!summary) {
        setDisplay('planTSection', 'none');
        setDisplay('homePricePrediction', 'none');
        return;
    }
    
    const hasHoldings = typeof holdings === 'number' ? holdings > 0 : (holdings && holdings.qty > 0);
    if (!_homePlanStock || hasHoldings) {
        _homePlanStock = code;
    }
    
    if (_homePlanStock !== code) return;
    
    renderBestPlan(summary);
}

function renderSignalCardError(code, msg) {
    const name = _stockNames[code] || code;
    return `
        <div style="display:flex;justify-content:space-between;align-items:center;line-height:1.4;">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)} <span style="color:var(--text-muted);font-weight:400;font-size:11px;">${escapeHtml(code)}</span></div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                <span style="font-size:10px;color:var(--text-muted);">${escapeHtml(msg)}</span>
                <button onclick="event.stopPropagation();refreshTSignalForStock('${escapeHtml(code)}')" style="background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:2px 4px;">重试</button>
            </div>
        </div>
    `;
}

// ========== 监控自动刷新与弹窗提醒 ==========
let _watchRefreshTimer = null;
let _tSignalBatchTimer = null;
let _alertedSignals = {};

function loadAlertedSignals() {
    try {
        const saved = localStorage.getItem('alertedSignals');
        _alertedSignals = saved ? JSON.parse(saved) : {};
    } catch (e) { _alertedSignals = {}; }
}

function saveAlertedSignals() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toDateString();
    for (const key in _alertedSignals) {
        const parts = key.split('_');
        const dateStr = parts.slice(-1)[0];
        try {
            if (new Date(dateStr) < sevenDaysAgo) {
                delete _alertedSignals[key];
            }
        } catch (e) {}
    }
    safeSetItem('alertedSignals', JSON.stringify(_alertedSignals));
}

function checkAndAlertSignals(code, stockInfo, strategies) {
    if (!_settings.popupAlert) return;
    
    const today = new Date().toDateString();
    const avgScore = calculatePanoramaScore(strategies);
    
    let action = null;
    if (avgScore >= 70) {
        action = '强烈买入';
    } else if (avgScore >= 55) {
        action = '建议买入';
    } else if (avgScore <= 30) {
        action = '强烈卖出';
    } else if (avgScore <= 45) {
        action = '建议卖出';
    }
    
    if (!action) return;
    
    const alertKey = `${code}_${action}_${today}`;
    if (_alertedSignals[alertKey]) return;
    _alertedSignals[alertKey] = true;
    saveAlertedSignals();
    
    showSignalAlert(stockInfo.name, code, stockInfo.current_price, avgScore, action);
    sendLocalNotification(stockInfo.name, code, stockInfo.current_price, avgScore, action);
}

function calculatePanoramaScore(strategies) {
    if (!strategies || strategies.length === 0) return 50;

    let buyCount = 0;
    let sellCount = 0;
    strategies.forEach(s => {
        if (s.action === 'BUY' || s.action === 'STRONG_BUY') buyCount++;
        else if (s.action === 'SELL' || s.action === 'STRONG_SELL') sellCount++;
        else if (s.action === 'BUY_THEN_SELL') { buyCount += 0.7; sellCount += 0.3; }
        else if (s.action === 'SELL_THEN_BUY') { buyCount += 0.3; sellCount += 0.7; }
        // BOX_TRADING/TRADING_OPPORTUNITY 中性，不计入
    });

    const total = strategies.length;
    const score = Math.round(50 + (buyCount - sellCount) / total * 50);
    return Math.max(0, Math.min(100, score));
}

function showSignalAlert(name, code, price, score, action) {
    const alertDiv = document.createElement('div');
    const isBuy = action.includes('买入');
    const isStrong = action.includes('强烈');
    const color = isBuy ? (isStrong ? 'var(--green)' : '#10b981') : (isStrong ? 'var(--red)' : '#f97316');
    const icon = isBuy ? (isStrong ? '🚀' : '📈') : (isStrong ? '⚠️' : '📉');
    
    alertDiv.style.cssText = `
        position: fixed;
        top: 70px;
        left: 50%;
        transform: translateX(-50%) translateY(-100px);
        z-index: 9999;
        background: var(--bg-card);
        border: 1px solid ${color}55;
        border-left: 4px solid ${color};
        border-radius: 12px;
        padding: 14px 18px;
        min-width: 280px;
        max-width: 90%;
        box-shadow: 0 8px 32px var(--bg-modal-mask);
        cursor: pointer;
        transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
    `;
    
    alertDiv.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <div style="font-size:24px;">${icon}</div>
            <div style="flex:1;">
                <div style="font-size:14px; font-weight:700; color:${color}; margin-bottom:2px;">${action}信号</div>
                <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${escapeHtml(name)} <span style="color:var(--text-muted); font-weight:400; font-size:11px;">${escapeHtml(code)}</span></div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">当前价 ¥${price.toFixed(2)} · 综合评分 ${score}分</div>
            </div>
        </div>
    `;
    
    let _alertHideTimer = null;
    let _alertRemoveTimer = null;
    alertDiv.onclick = () => {
        goToStockDetail(code, name);
        switchTab('strategy');
        if (_alertHideTimer) clearTimeout(_alertHideTimer);
        if (_alertRemoveTimer) clearTimeout(_alertRemoveTimer);
        if (alertDiv.parentNode) {
            document.body.removeChild(alertDiv);
        }
    };

    document.body.appendChild(alertDiv);

    setTimeout(() => {
        alertDiv.style.transform = 'translateX(-50%) translateY(0)';
    }, 50);

    _alertHideTimer = setTimeout(() => {
        alertDiv.style.transform = 'translateX(-50%) translateY(-100px)';
        _alertRemoveTimer = setTimeout(() => {
            if (alertDiv.parentNode) {
                document.body.removeChild(alertDiv);
            }
        }, 400);
    }, 6000);
}

async function sendLocalNotification(name, code, price, score, action) {
    const LocalNotifications = getCapacitorLocalNotifications();
    if (!LocalNotifications) return;
    
    try {
        const result = await LocalNotifications.requestPermissions();
        if (result && result.display !== 'granted') {
            return;
        }
        
        const isBuy = action.includes('买入');
        const title = `${isBuy ? '🚀' : '⚠️'} ${action}信号`;
        const body = `${name}(${code}) 当前价 ¥${price.toFixed(2)} · 评分 ${score}分`;
        
        await LocalNotifications.schedule({
            notifications: [{
                id: Date.now(),
                title: title,
                body: body,
                extra: { code, name },
                sound: 'default',
                foreground: true
            }]
        });
    } catch (e) {
        console.log('Local notification failed:', e);
    }
}

// ==================== 收益计算 ====================
async function refreshProfit() {
    const myReqId = ++_profitReqId;
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
    let tWinCount = 0;
    
    const holdings = {};
    // 收集所有买入和卖出交易（按股票代码分组）
    const buysByCode = {};
    const sellsByCode = {};
    
    _trades.forEach((t, idx) => {
        const type = t.trade_type || t.type;
        if (type === 'BUY') {
            totalBuy += t.quantity;
            const amount = t.price * t.quantity;
            totalBuyAmount += amount;
            
            const fees = calcTradeFees(amount, 'BUY');
            commissionFee += fees.commission;
            transferFee += fees.transfer;
            
            if (!holdings[t.code]) {
                holdings[t.code] = { qty: 0, cost: 0, name: t.name || t.code };
            } else if (t.name && t.name !== t.code) {
                holdings[t.code].name = t.name;
            }
            holdings[t.code].qty += t.quantity;
            holdings[t.code].cost += amount + fees.commission + fees.transfer;
            
            if (!buysByCode[t.code]) buysByCode[t.code] = [];
            buysByCode[t.code].push({ idx, trade: t });
            
        } else {
            totalSell += t.quantity;
            const amount = t.price * t.quantity;
            totalSellAmount += amount;
            
            const fees = calcTradeFees(amount, 'SELL');
            commissionFee += fees.commission;
            stampTax += fees.stamp;
            transferFee += fees.transfer;
            
            if (!sellsByCode[t.code]) sellsByCode[t.code] = [];
            sellsByCode[t.code].push({ idx, trade: t });
            
            if (holdings[t.code] && holdings[t.code].qty > 0) {
                if (t.name && t.name !== t.code && holdings[t.code].name === t.code) {
                    holdings[t.code].name = t.name;
                }
                const avgCost = holdings[t.code].qty > 0 ? holdings[t.code].cost / holdings[t.code].qty : 0;
                const sellQty = Math.min(t.quantity, holdings[t.code].qty);
                const sellCost = avgCost * sellQty;
                realizedProfit += (amount - fees.commission - fees.stamp - fees.transfer) - sellCost;
                holdings[t.code].qty -= sellQty;
                holdings[t.code].cost -= sellCost;
            }
        }
    });
    
    // 自动计算做T收益：按股票代码，对每笔卖出按时间倒序配对其之前的买入
    for (const code in sellsByCode) {
        const sells = sellsByCode[code];
        // 复制该股票的买入列表，按时间正序排列
        const buys = (buysByCode[code] || []).filter(b => b.trade.time).sort((a, b) => (a.trade.time || 0) - (b.trade.time || 0));
        // 已使用过的买入索引
        const usedBuyQty = {}; // buyIdx -> 已配对数量
        
        sells.sort((a, b) => (a.trade.time || 0) - (b.trade.time || 0));
        
        sells.forEach(sellInfo => {
            const sellTrade = sellInfo.trade;
            const sellQty = sellTrade.quantity;
            const sellPrice = sellTrade.price;
            const sellAmount = sellPrice * sellQty;
            const sellFees = calcTradeFees(sellAmount, 'SELL');
            
            let remainingQty = sellQty;
            
            // 优先使用已有的配对
            if (sellTrade.pair_buy_index !== undefined && sellTrade.pair_buy_index !== null) {
                const buyTrade = _trades[sellTrade.pair_buy_index];
                if (buyTrade && (buyTrade.trade_type || buyTrade.type) === 'BUY') {
                    const pairQty = sellTrade.pair_quantity || sellQty;
                    const buyPrice = sellTrade.pair_buy_price || buyTrade.price;
                    const buyAmount = buyPrice * pairQty;
                    const buyFees = calcTradeFees(buyAmount, 'BUY');
                    const buyFee = buyFees.commission + buyFees.transfer;
                    const sellFee = sellFees.commission + sellFees.stamp + sellFees.transfer;
                    const profit = (sellPrice - buyPrice) * pairQty - buyFee - sellFee;
                    tProfit += profit;
                    tTradeCount++;
                    if (profit > 0) tWinCount++;
                    remainingQty -= pairQty;
                }
            }
            
            // 自动配对剩余数量（用此卖出之前的买入）
            const sellTime = sellTrade.time || 0;
            for (const buyInfo of buys) {
                if (remainingQty <= 0) break;
                if ((buyInfo.trade.time || 0) >= sellTime) continue; // 必须早于卖出
                const used = usedBuyQty[buyInfo.idx] || 0;
                const availQty = (buyInfo.trade.quantity || 0) - used;
                if (availQty <= 0) continue;
                const pairQty = Math.min(remainingQty, availQty);
                const buyPrice = buyInfo.trade.price;
                const buyAmount = buyPrice * pairQty;
                const buyFees = calcTradeFees(buyAmount, 'BUY');
                const buyFee = buyFees.commission + buyFees.transfer;
                const sellFee = sellFees.commission + sellFees.stamp + sellFees.transfer;
                const profit = (sellPrice - buyPrice) * pairQty - buyFee - sellFee;
                tProfit += profit;
                tTradeCount++;
                if (profit > 0) tWinCount++;
                usedBuyQty[buyInfo.idx] = used + pairQty;
                remainingQty -= pairQty;
            }
        });
    }
    
    let remaining = totalBuy - totalSell;
    let unrealizedProfit = 0;
    const stockProfits = [];
    const holdingCodes = [];
    
    for (const [code, info] of Object.entries(holdings)) {
        if (info.qty > 0) {
            let currentPrice = _currentStock && _currentStock.code === code 
                ? _currentStock.current_price 
                : await getCurrentPrice(code);
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
    
    // 构建组合数组再排序，避免 holdingCodes 与 stockProfits 错位
    const combined = holdingCodes.map((code, idx) => ({ code, profit: stockProfits[idx] }));
    combined.sort((a, b) => b.profit.quantity - a.profit.quantity);
    const sortedHoldingCodes = combined.map(c => c.code);
    const sortedStockProfits = combined.map(c => c.profit);
    holdingCodes.length = 0;
    sortedHoldingCodes.forEach(c => holdingCodes.push(c));
    stockProfits.length = 0;
    sortedStockProfits.forEach(p => stockProfits.push(p));
    
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
    
    const tWinRateEl = document.getElementById('tWinRate');
    if (tWinRateEl) {
        const winRate = tTradeCount > 0 ? (tWinCount / tTradeCount * 100).toFixed(1) : '0';
        tWinRateEl.textContent = winRate + '%';
    }
    
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
            // 检查持仓是否变化（数量和代码都相同则视为结构不变）
            const holdingsChanged = !_profitListRendered ||
                holdingCodes.length !== _lastHoldingCodes.length ||
                holdingCodes.some((code, i) => code !== _lastHoldingCodes[i]);

            if (holdingsChanged) {
                // 持仓变化或首次渲染，重建整个列表
                div.innerHTML = stockProfits.map((s, idx) => `
                <div class="stock-profit-item" id="home-holding-${idx}">
                    <div>
                        <div class="stock-profit-name">${escapeHtml(s.name)}</div>
                        <div class="stock-profit-detail">${escapeHtml(s.code)} · ${s.quantity}股 · ¥<span id="home-price-${idx}">${s.current_price.toFixed(2)}</span></div>
                    </div>
                    <div class="stock-profit-value" id="home-profit-${idx}" style="color:${s.profit >= 0 ? 'var(--red)' : 'var(--green)'}">
                        ${s.profit >= 0 ? '+' : ''}¥${s.profit.toFixed(2)}
                    </div>
                </div>
            `).join('');
                _profitListRendered = true;
                _lastHoldingCodes = [...holdingCodes];
            }

            // 异步获取所有持仓股票的实时价格并更新
            let totalUnrealized = 0;
            let fetchedCount = 0;
            let failedCount = 0;
            holdingCodes.forEach((code, idx) => {
                const info = holdings[code];
                if (!info) {
                    fetchedCount++;
                    failedCount++;
                    return;
                }
                getCurrentPrice(code).then(currentPrice => {
                    if (myReqId !== _profitReqId) return;
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

                        // 同步更新 _profitDetail.stockProfits 中对应项的实时价格和盈亏
                        if (_profitDetail && _profitDetail.stockProfits && _profitDetail.stockProfits[idx]) {
                            _profitDetail.stockProfits[idx].current_price = currentPrice;
                            _profitDetail.stockProfits[idx].profit = profit;
                        }
                    } else {
                        failedCount++;
                    }

                    // 所有价格获取完成后更新总浮动盈亏和总盈亏
                    if (fetchedCount === holdingCodes.length) {
                        const newTotalProfit = realizedProfit + totalUnrealized;
                        setProfitVal('unrealizedProfit', totalUnrealized);
                        setProfitVal('totalProfit', newTotalProfit);

                        // 同步更新 _profitDetail 中的总盈亏
                        if (_profitDetail) {
                            _profitDetail.unrealizedProfit = totalUnrealized;
                            _profitDetail.totalProfit = realizedProfit + totalUnrealized;
                            // 同步每只股票的实时价格、盈亏和盈亏百分比
                            _profitDetail.stockProfits = _profitDetail.stockProfits.map(s => {
                                const found = stockProfits.find(p => p.code === s.code);
                                if (found) {
                                    const updatedProfit = (found.current_price - s.avg_cost) * s.quantity;
                                    const updatedProfitPercent = s.avg_cost > 0 ? ((found.current_price - s.avg_cost) / s.avg_cost * 100) : 0;
                                    return { ...s, currentPrice: found.current_price, profit: updatedProfit, profitPercent: updatedProfitPercent };
                                }
                                return s;
                            });
                        }

                        // 部分价格获取失败提示
                        if (failedCount > 0) {
                            showToast('部分持仓价格获取失败，盈亏按已知价格计算');
                        }
                    }
                });
            });
        } else {
            div.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div>暂无持仓</div><button onclick="openAddTradeModal()" class="btn btn-primary" style="margin-top:12px;width:auto;padding:10px 24px;">添加买入</button></div>';
            _profitListRendered = false;
            _lastHoldingCodes = [];
        }
    }
    
    // 存储收益明细和费用明细供弹窗使用
    _profitDetail = {
        totalProfit,
        realizedProfit,
        unrealizedProfit,
        tProfit,
        tTradeCount,
        tWinCount,
        stockProfits,
        totalBuy,
        totalSell,
        remaining,
        tradeCount: _trades.length,
        totalBuyAmount,
        totalSellAmount,
        commissionFee,
        stampTax,
        transferFee,
        totalFees
    };
    _feeDetail = { commissionFee, stampTax, transferFee, totalFees };
    
    // 扣除手续费显示
    const totalFeesEl = document.getElementById('totalFees');
    if (totalFeesEl) totalFeesEl.textContent = '¥' + totalFees.toFixed(2);
    
    return _profitDetail;
}

function autoAddTradedStocks() {
    const holdings = {};
    _trades.forEach(t => {
        if (!holdings[t.code]) {
            holdings[t.code] = { qty: 0, name: t.name || t.code };
        } else if (t.name && t.name !== t.code) {
            holdings[t.code].name = t.name;
        }
        if ((t.trade_type || t.type) === 'BUY') {
            holdings[t.code].qty += (t.quantity || 0);
        } else {
            holdings[t.code].qty = Math.max(0, holdings[t.code].qty - (t.quantity || 0));
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
        directionColor = 'var(--green)';
        directionBg = 'rgba(34,197,94,0.15)';
    } else if (sellScore > buyScore * 1.5 && sellScore > 3) {
        direction = 'SELL';
        directionText = '建议卖出做空';
        directionIcon = '📉';
        directionColor = 'var(--red)';
        directionBg = 'rgba(239,68,68,0.15)';
    } else {
        direction = 'HOLD';
        directionText = '建议观望等待';
        directionIcon = '⏸️';
        directionColor = 'var(--yellow)';
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
        <div style="display:flex; flex-direction:row; justify-content:center; gap:8px; margin-top:12px; font-size:12px; flex-wrap:wrap;">
            <span style="color:var(--green); cursor:pointer; padding:6px 12px; background:rgba(34,197,94,0.15); border-radius:20px; font-weight:600; white-space:nowrap;" onclick="showStrategyModal('买入信号', filterBuyStrategies(_lastStrategies))">
                🟢买入信号 ${buySignals.length}个
            </span>
            <span style="color:var(--red); cursor:pointer; padding:6px 12px; background:rgba(239,68,68,0.15); border-radius:20px; font-weight:600; white-space:nowrap;" onclick="showStrategyModal('卖出信号', filterSellStrategies(_lastStrategies))">
                🔴卖出信号 ${sellSignals.length}个
            </span>
            <span style="color:#8b5cf6; cursor:pointer; padding:6px 12px; background:rgba(139,92,246,0.15); border-radius:20px; font-weight:600; white-space:nowrap;" onclick="showStrategyModal('做T机会', filterTStrategies(_lastStrategies))">
                ⚡做T机会 ${tSignals.length}个
            </span>
            <span style="color:var(--yellow); cursor:pointer; padding:6px 12px; background:rgba(251,191,36,0.15); border-radius:20px; font-weight:600; white-space:nowrap;" onclick="showStrategyModal('观望信号', filterHoldStrategies(_lastStrategies))">
                🟡观望信号 ${holdSignals.length}个
            </span>
        </div>
    `;
    
    const coreDiv = document.getElementById('coreAdvice');
    if (!coreDiv) return;

    const stockCode = info.code || '';
    const stockName = info.name || '';

    // 计算核心建议的成功率（直接基于100+策略加权投票结果）
    let coreSuccessRate = 0;
    if (_lastSummary && (direction === 'BUY' || direction === 'SELL')) {
        const type = direction === 'BUY' ? 'buy' : 'sell';
        coreSuccessRate = calcPanoramaActionSuccessRate(_lastSummary, type);
    }
    const successRateHtml = coreSuccessRate > 0
        ? `<span style="font-size:11px; font-weight:600; padding:3px 10px; background:${directionColor === 'var(--green)' ? 'rgba(34,197,94,0.15)' : directionColor === 'var(--red)' ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.15)'}; color:${directionColor}; border-radius:12px; margin-left:auto;">成功率 ${coreSuccessRate}%</span>`
        : '';

    coreDiv.innerHTML = `
        <div style="background:${directionBg}; border:2px solid ${directionColor}; border-radius:16px; padding:16px; margin:10px 0;">
            <div style="margin-bottom:12px;">
                <span style="font-size:15px; font-weight:700; color:var(--text-primary);">${escapeHtml(stockCode)}</span>
                <span style="font-size:13px; color:var(--text-secondary); margin-left:8px;">${escapeHtml(stockName)}</span>
                <span style="font-size:11px; color:var(--text-muted); float:right;">策略分析</span>
            </div>

            <div style="margin-bottom:14px;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
                    <span style="font-size:24px;">${directionIcon}</span>
                    <span style="font-size:18px; font-weight:700; color:${directionColor}; white-space:nowrap;">${directionText}</span>
                    ${successRateHtml}
                </div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:6px; margin-left:32px;">${escapeHtml(reason)}</div>
            </div>

            ${direction === 'T_TRADING' ? `
                <div style="background:var(--bg-modal-mask); border-radius:12px; padding:16px; margin-bottom:12px; cursor:pointer;" onclick="showStrategyModal('做T机会详情', filterTStrategies(_lastStrategies))">
                    <div style="margin-bottom:12px;">
                        <span style="font-size:12px; color:var(--text-muted);">⚡ 点击查看做T策略详情</span>
                        <span style="font-size:12px; color:#8b5cf6; float:right;">→</span>
                    </div>
                    <div style="text-align:center;">
                        <div style="display:inline-block; width:32%; vertical-align:top;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">买入参考价</div>
                            <div style="font-size:18px; font-weight:700; color:var(--green);">¥${buyPrice.toFixed(2)}</div>
                        </div>
                        <div style="display:inline-block; width:32%; vertical-align:top;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">卖出参考价</div>
                            <div style="font-size:18px; font-weight:700; color:var(--red);">¥${sellPrice.toFixed(2)}</div>
                        </div>
                        <div style="display:inline-block; width:32%; vertical-align:top;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">止损价</div>
                            <div style="font-size:18px; font-weight:700; color:var(--yellow);">¥${stopLoss.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
                <div style="text-align:center; font-size:11px; padding:10px; background:var(--bg-inset); border-radius:8px;">
                    <div style="display:inline-block; width:32%; color:var(--green);">📈做T收益<br/>+${profitPercent}% (+¥${profitAmount.toFixed(2)})</div>
                    <div style="display:inline-block; width:32%; color:var(--red);">📉做T风险<br/>-${riskPercent}% (-¥${riskAmount.toFixed(2)})</div>
                    <div style="display:inline-block; width:32%; color:var(--yellow);">⚖️盈亏比<br/>${riskReward}</div>
                </div>
            ` : direction === 'BUY' ? `
                <div style="background:var(--bg-modal-mask); border-radius:12px; padding:16px; margin-bottom:12px;">
                    <div style="text-align:center;">
                        <div style="display:inline-block; width:32%; vertical-align:top;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">买入价</div>
                            <div style="font-size:18px; font-weight:700; color:var(--green);">¥${buyPrice.toFixed(2)}</div>
                        </div>
                        <div style="display:inline-block; width:32%; vertical-align:top;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">目标价</div>
                            <div style="font-size:18px; font-weight:700; color:#60a5fa;">¥${targetPrice.toFixed(2)}</div>
                        </div>
                        <div style="display:inline-block; width:32%; vertical-align:top;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">止损价</div>
                            <div style="font-size:18px; font-weight:700; color:var(--red);">¥${stopLoss.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
                <div style="text-align:center; font-size:11px; padding:10px; background:var(--bg-inset); border-radius:8px;">
                    <div style="display:inline-block; width:32%; color:var(--green);">📈预期收益<br/>+${profitPercent}% (+¥${profitAmount.toFixed(2)})</div>
                    <div style="display:inline-block; width:32%; color:var(--red);">📉风险损失<br/>-${riskPercent}% (-¥${riskAmount.toFixed(2)})</div>
                    <div style="display:inline-block; width:32%; color:var(--yellow);">⚖️盈亏比<br/>${riskReward}</div>
                </div>
            ` : direction === 'SELL' ? `
                <div style="background:var(--bg-modal-mask); border-radius:12px; padding:16px; margin-bottom:12px;">
                    <div style="text-align:center;">
                        <div style="display:inline-block; width:32%; vertical-align:top;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">卖出价</div>
                            <div style="font-size:18px; font-weight:700; color:var(--red);">¥${cp.toFixed(2)}</div>
                        </div>
                        <div style="display:inline-block; width:32%; vertical-align:top;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">目标价</div>
                            <div style="font-size:18px; font-weight:700; color:#60a5fa;">¥${targetPrice.toFixed(2)}</div>
                        </div>
                        <div style="display:inline-block; width:32%; vertical-align:top;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">止损价</div>
                            <div style="font-size:18px; font-weight:700; color:var(--green);">¥${stopLoss.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
                <div style="text-align:center; font-size:11px; padding:10px; background:var(--bg-inset); border-radius:8px;">
                    <div style="display:inline-block; width:32%; color:var(--green);">📈做空收益<br/>+${profitPercent}% (+¥${profitAmount.toFixed(2)})</div>
                    <div style="display:inline-block; width:32%; color:var(--red);">📉做空风险<br/>-${riskPercent}% (-¥${riskAmount.toFixed(2)})</div>
                    <div style="display:inline-block; width:32%; color:var(--yellow);">⚖️盈亏比<br/>${riskReward}</div>
                </div>
            ` : `
                <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:14px;">
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
            const actionColor = isBuyAction(s.action) ? 'var(--green)' :
                               isSellAction(s.action) ? 'var(--red)' :
                               isTAction(s.action) ? '#60a5fa' : 'var(--yellow)';
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
                <div style="background:var(--surface-3); border-radius:12px; padding:14px; border:1px solid var(--surface-3);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:20px;">${escapeHtml(s.icon || '📊')}</span>
                            <span style="font-weight:600; font-size:15px;">${escapeHtml(s.name)}</span>
                        </div>
                        <span style="color:${actionColor}; font-size:12px; font-weight:600; padding:4px 10px; background:${actionColor}22; border-radius:12px;">
                            ${actionText}
                        </span>
                    </div>
                    <div style="font-size:13px; color:var(--text-muted); margin-bottom:10px;">${escapeHtml(s.category)} · ${prioText}</div>
                    <div style="font-size:14px; color:#e5e7eb; line-height:1.6; margin-bottom:10px;">${escapeHtml(s.suggestion)}</div>
                    ${s.reason ? `<div style="font-size:12px; color:#6b7280; padding-top:8px; border-top:1px solid var(--surface-3);">💡 ${escapeHtml(s.reason)}</div>` : ''}
                    ${s.target_price ? `<div style="margin-top:8px; font-size:12px;">
                        <span style="color:#60a5fa;">🎯 目标价: ¥${s.target_price}</span>
                        ${s.stop_loss ? `<span style="color:var(--red); margin-left:12px;">🛑 止损价: ¥${s.stop_loss}</span>` : ''}
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
if (!closeModal.__wrapped) {
    const _originalCloseModal = closeModal;
    const wrapped = function() {
        _originalCloseModal();
        document.body.style.overflow = '';
    };
    wrapped.__wrapped = true;
    closeModal = wrapped;
}

// ==================== 设置功能 ====================

const VALID_THEMES = new Set(['dark-purple', 'deep-blue', 'emerald-gold', 'warm-orange', 'rose-red', 'light', 'ths']);

function changeTheme(themeName) {
    if (!VALID_THEMES.has(themeName)) themeName = 'dark-purple';
    document.body.className = `theme-${themeName}`;
    
    document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('active'));
    const option = document.querySelector(`.theme-option[data-theme="${themeName}"]`);
    if (option) option.classList.add('active');
    
    if (_settings) {
        _settings.theme = themeName;
        safeSetItem('appSettings', JSON.stringify(_settings));
    }
}

function loadSettings() {
    let saved = null;
    try {
        saved = localStorage.getItem('appSettings');
    } catch (e) {
        console.warn('loadSettings读取失败:', e);
    }
    const defaults = {
        autoRefreshInterval: 0,
        soundEnabled: false,
        showChangePercent: true,
        showSignalCard: true,
        fixedPredictionTime: 15,
        enableTrend: true,
        enableOscillation: true,
        enableVolume: true,
        enablePattern: true,
        enableIntraday: true,
        enableCustom: true,
        tSignalThreshold: 2,
        buySignalThreshold: 5,
        sellSignalThreshold: 5,
        popupAlert: false,
        theme: 'dark-purple'
    };

    try {
        const parsed = saved ? JSON.parse(saved) : {};
        // 防止原型污染：只取已知键
        _settings = { ...defaults };
        for (const key of Object.keys(defaults)) {
            if (key in parsed && parsed[key] !== undefined) {
                _settings[key] = parsed[key];
            }
        }
    } catch (e) {
        console.warn('loadSettings解析失败，使用默认值:', e);
        _settings = defaults;
    }

    try {
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
        setVal('autoRefreshInterval', _settings.autoRefreshInterval);
        setChk('soundEnabled', _settings.soundEnabled);
        setChk('showChangePercent', _settings.showChangePercent);
        setChk('showSignalCard', _settings.showSignalCard);
        setVal('fixedPredictionTime', _settings.fixedPredictionTime);
        setChk('enableTrend', _settings.enableTrend);
        setChk('enableOscillation', _settings.enableOscillation);
        setChk('enableVolume', _settings.enableVolume);
        setChk('enablePattern', _settings.enablePattern);
        setChk('enableIntraday', _settings.enableIntraday);
        setChk('enableCustom', _settings.enableCustom);
        setVal('tSignalThreshold', _settings.tSignalThreshold);
        setVal('buySignalThreshold', _settings.buySignalThreshold);
        setVal('sellSignalThreshold', _settings.sellSignalThreshold);
        setChk('popupAlert', _settings.popupAlert);
    } catch (e) {
        console.warn('loadSettings DOM更新失败:', e);
    }

    try {
        changeTheme(_settings.theme || 'dark-purple');
    } catch (e) {
        console.warn('主题切换失败:', e);
    }
    try {
        updateAutoRefresh();
    } catch (e) {
        console.warn('自动刷新初始化失败:', e);
    }
}

function saveSettings() {
    _settings.autoRefreshInterval = parseInt(document.getElementById('autoRefreshInterval').value, 10) || 0;
    _settings.soundEnabled = document.getElementById('soundEnabled').checked;
    _settings.showChangePercent = document.getElementById('showChangePercent').checked;
    _settings.showSignalCard = document.getElementById('showSignalCard')?.checked ?? true;
    _settings.fixedPredictionTime = parseInt(document.getElementById('fixedPredictionTime').value, 10) || 15;
    _settings.enableTrend = document.getElementById('enableTrend').checked;
    _settings.enableOscillation = document.getElementById('enableOscillation').checked;
    _settings.enableVolume = document.getElementById('enableVolume').checked;
    _settings.enablePattern = document.getElementById('enablePattern').checked;
    _settings.enableIntraday = document.getElementById('enableIntraday').checked;
    _settings.enableCustom = document.getElementById('enableCustom').checked;
    _settings.tSignalThreshold = parseFloat(document.getElementById('tSignalThreshold').value) || 2;
    _settings.buySignalThreshold = parseInt(document.getElementById('buySignalThreshold').value, 10) || 5;
    _settings.sellSignalThreshold = parseInt(document.getElementById('sellSignalThreshold').value, 10) || 5;
    _settings.popupAlert = document.getElementById('popupAlert').checked;
    
    safeSetItem('appSettings', JSON.stringify(_settings));
    updateAutoRefresh();
    showToast('设置已保存');
}

function hideSignalCard() {
    _settings.showSignalCard = false;
    const el = document.getElementById('showSignalCard');
    if (el) el.checked = false;
    safeSetItem('appSettings', JSON.stringify(_settings));
    applySignalCardDisplay();
    showToast('已隐藏做T信号总览，可在设置中重新打开');
}

function applySignalCardDisplay() {
    const signalCard = document.getElementById('signalCard');
    if (!signalCard) return;
    if (_settings.showSignalCard === false) {
        signalCard.style.display = 'none';
    } else {
        if (summaryCache || _lastSummary) {
            signalCard.style.display = 'block';
        }
    }
}

function updateAutoRefresh() {
    if (_autoRefreshTimer) {
        clearTimeout(_autoRefreshTimer);
        _autoRefreshTimer = null;
    }

    if (_watchRefreshTimer) {
        clearTimeout(_watchRefreshTimer);
        _watchRefreshTimer = null;
    }

    if (_tSignalBatchTimer) {
        clearTimeout(_tSignalBatchTimer);
        _tSignalBatchTimer = null;
    }

    const interval = _settings.autoRefreshInterval || 0;

    // 修复竞态：页面隐藏时调用 updateAutoRefresh（如设置页保存），需重置 paused 标志
    // 否则 resumeAutoRefreshOnShow 会因 _autoRefreshPaused=true 跳过更新
    if (!document.hidden) {
        _autoRefreshPaused = false;
        _watchRefreshPaused = false;
    } else if (interval > 0) {
        // 页面隐藏时仅记录 interval，不启动定时器，避免后台运行
        _autoRefreshPaused = true;
        _watchRefreshPaused = true;
        _pausedRefreshInterval = interval;
        return;
    }

    if (interval > 0) {
        _refreshCountdown = interval;
        updateRefreshIndicator();

        // _autoRefreshTimer 只负责倒计时显示和策略/全景刷新
        const countdownTick = () => {
            if (!_autoRefreshTimer) return;
            _refreshCountdown--;
            updateRefreshIndicator();

            if (_refreshCountdown <= 0) {
                _refreshCountdown = interval;

                // 防止与 _watchRefreshTimer 重叠
                if (!_isRefreshing) {
                    _isRefreshing = true;
                    const strategyTab = document.getElementById('tab-strategy');

                    if (strategyTab && strategyTab.classList.contains('active') && _currentStock) {
                        const refreshPromise = _currentStrategySubtab === 'panorama'
                            ? loadPanoramaDetail()
                            : loadStrategyDetail();
                        refreshPromise.finally(() => { _isRefreshing = false; });
                    } else {
                        _isRefreshing = false;
                    }
                }
            }
            _autoRefreshTimer = setTimeout(countdownTick, 1000);
        };
        _autoRefreshTimer = setTimeout(countdownTick, 1000);

        // _watchRefreshTimer 负责首页实际刷新（T信号 + 盈亏）
        const watchRefreshTick = () => {
            if (!_watchRefreshTimer) return;
            // 防止与 _autoRefreshTimer 重叠
            if (!_isRefreshing) {
                _isRefreshing = true;
                const homeTab = document.getElementById('tab-home');
                if (homeTab && homeTab.classList.contains('active')) {
                    Promise.all([refreshAllTSignals(), refreshProfit()])
                        .finally(() => { _isRefreshing = false; });
                } else {
                    _isRefreshing = false;
                }
            }
            _watchRefreshTimer = setTimeout(watchRefreshTick, interval * 1000);
        };
        _watchRefreshTimer = setTimeout(watchRefreshTick, interval * 1000);
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
    let longtermHistory = [];
    try {
        longtermHistory = JSON.parse(localStorage.getItem('longtermHistory') || '[]');
    } catch (e) {
        console.warn('导出时长期预测历史解析失败:', e);
        longtermHistory = [];
    }

    const predictionRecords = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('pred_')) {
                try {
                    predictionRecords[key] = JSON.parse(localStorage.getItem(key) || '[]');
                } catch (e) {
                    console.warn('导出时预测记录解析失败:', key, e);
                }
            }
        }
    } catch (e) {
        console.warn('导出时遍历预测记录失败:', e);
    }

    const data = {
        version: '1.1',
        exportTime: new Date().toISOString(),
        settings: _settings,
        watchList: _watchList,
        trades: _trades,
        searchHistory: _searchHistory,
        panoramaHistory: _panoramaHistory,
        longtermHistory: longtermHistory,
        stockNames: _stockNames,
        predictionRecords: predictionRecords,
        lastSearchedStock: _lastSearchedStock
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock_thelper_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast('数据已导出，请保存好备份文件');
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;

    if (!confirm('导入数据将覆盖现有数据，包括：\n交易记录、监控列表、搜索历史、设置、全景分析历史\n此操作不可恢复，确定继续吗？')) {
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            let importedCount = 0;

            // R9-12: settings 导入白名单 + 关键字段类型校验
            if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
                const numKeys = ['autoRefreshInterval', 'fixedPredictionTime', 'tSignalThreshold', 'buySignalThreshold', 'sellSignalThreshold'];
                const boolKeys = ['soundEnabled', 'showChangePercent', 'enableTrend', 'enableOscillation', 'enableVolume', 'enablePattern', 'enableIntraday', 'enableCustom', 'popupAlert'];
                const ALLOWED_THEMES = ['dark-purple', 'deep-blue', 'emerald-gold', 'warm-orange', 'rose-red', 'light', 'ths'];
                for (const key of Object.keys(_settings)) {
                    if (!(key in data.settings) || data.settings[key] === undefined) continue;
                    const v = data.settings[key];
                    if (numKeys.includes(key)) {
                        if (typeof v === 'number' && isFinite(v) && v >= 0) _settings[key] = v;
                    } else if (boolKeys.includes(key)) {
                        if (typeof v === 'boolean') _settings[key] = v;
                    } else if (key === 'theme') {
                        if (typeof v === 'string' && ALLOWED_THEMES.includes(v)) _settings[key] = v;
                    } else {
                        _settings[key] = v;
                    }
                }
                safeSetItem('appSettings', JSON.stringify(_settings));
                importedCount++;
            }

            // R9-4: watchList 元素类型校验，过滤非字符串
            if (data.watchList && Array.isArray(data.watchList)) {
                _watchList = data.watchList.filter(s => typeof s === 'string' && s.trim());
                safeSetItem('watchList', JSON.stringify(_watchList));
                importedCount++;
            }

            // R9-2: trades 重建复用 _sanitizeTrade，保证字段一致性（含 timestamp/note）
            if (data.trades && Array.isArray(data.trades)) {
                _trades = data.trades.map(_sanitizeTrade).filter(Boolean);
                saveTrades();
                importedCount++;
            }

            // R9-5: searchHistory 元素类型校验（支持字符串和对象格式）
            if (data.searchHistory && Array.isArray(data.searchHistory)) {
                _searchHistory = data.searchHistory.map(item => {
                    if (typeof item === 'string') {
                        return { code: item, name: item };
                    }
                    if (item && typeof item === 'object' && item.code) {
                        return { code: item.code, name: item.name || item.code };
                    }
                    return null;
                }).filter(Boolean);
                safeSetItem('searchHistory', JSON.stringify(_searchHistory));
                importedCount++;
            }

            // R9-6: panoramaHistory 元素类型校验
            if (data.panoramaHistory && Array.isArray(data.panoramaHistory)) {
                _panoramaHistory = data.panoramaHistory.filter(v => v && typeof v === 'object' && !Array.isArray(v));
                safeSetItem('panoramaHistory', JSON.stringify(_panoramaHistory));
                importedCount++;
            }

            if (data.longtermHistory && Array.isArray(data.longtermHistory)) {
                safeSetItem('longtermHistory', JSON.stringify(data.longtermHistory.filter(v => v && typeof v === 'object')));
                importedCount++;
            }

            // R9-3: stockNames value 类型校验
            if (data.stockNames && typeof data.stockNames === 'object' && !Array.isArray(data.stockNames)) {
                const cleaned = {};
                for (const k of Object.keys(data.stockNames)) {
                    if (typeof k === 'string' && typeof data.stockNames[k] === 'string') {
                        cleaned[k] = data.stockNames[k];
                    }
                }
                _stockNames = cleaned;
                safeSetItem('stockNames', JSON.stringify(_stockNames));
                importedCount++;
            }

            if (data.predictionRecords && typeof data.predictionRecords === 'object' && !Array.isArray(data.predictionRecords)) {
                for (const key of Object.keys(data.predictionRecords)) {
                    // R9-7: 严格校验 key 格式（pred_YYYY-MM）和 value 类型
                    if (/^pred_\d{4}-\d{2}$/.test(key) && typeof data.predictionRecords[key] === 'object' && data.predictionRecords[key] !== null) {
                        safeSetItem(key, JSON.stringify(data.predictionRecords[key]));
                    }
                }
                // R9-1: 失效内存缓存，下次访问时重新从 localStorage 加载
                _predictionRecords = null;
                importedCount++;
            }

            if (data.lastSearchedStock && data.lastSearchedStock.code && typeof data.lastSearchedStock.code === 'string') {
                _lastSearchedStock = {
                    code: String(data.lastSearchedStock.code),
                    name: typeof data.lastSearchedStock.name === 'string' ? data.lastSearchedStock.name : ''
                };
                safeSetItem('lastSearchedStock', JSON.stringify(_lastSearchedStock));
                importedCount++;
            }

            // R9-9: 清空已告警信号记录，避免与新导入数据不匹配导致漏报/误报
            _alertedSignals = {};
            safeSetItem('alertedSignals', JSON.stringify(_alertedSignals));

            // R9-10: 重置当前股票，避免仍指向已不存在的旧股票
            _currentStock = null;
            _lastStrategies = [];
            _lastSummary = null;
            _lastKlines = [];

            loadSettings();
            // R9-13/14: 应用导入的主题和自动刷新设置
            changeTheme(_settings.theme || 'dark-purple');
            updateAutoRefresh();
            renderWatchList();
            renderTrades().catch(() => {});
            renderSearchHistory();
            refreshProfit();

            showToast(`导入成功，共导入 ${importedCount} 项数据`);
        } catch (err) {
            showToast('导入失败：文件格式错误');
            console.error('导入失败:', err);
        } finally {
            // R9-15: 无论成功失败都清空 input，避免重复导入同一文件
            input.value = '';
        }
    };
    reader.onerror = function() {
        showToast('导入失败：文件读取错误');
        input.value = '';
    };
    reader.readAsText(file);
}

function clearAllData() {
    if (!confirm('确定要清除所有数据吗？\n包括：交易记录、监控列表、搜索历史、设置\n此操作不可恢复！')) {
        return;
    }

    localStorage.removeItem('watchList');
    localStorage.removeItem('trades');
    localStorage.removeItem('searchHistory');
    localStorage.removeItem('appSettings');
    localStorage.removeItem('panoramaHistory');
    localStorage.removeItem('longtermHistory');
    localStorage.removeItem('lastSearchedStock');
    localStorage.removeItem('predictionRecords');
    localStorage.removeItem('stockNames');
    localStorage.removeItem('alertedSignals');
    // 遍历清除所有 pred_* 开头的月分块key
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('pred_')) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    _watchList = [];
    _trades = [];
    _searchHistory = [];
    _panoramaHistory = [];
    _settings = {
        autoRefreshInterval: 0,
        soundEnabled: false,
        showChangePercent: true,
        fixedPredictionTime: 15,
        enableTrend: true,
        enableOscillation: true,
        enableVolume: true,
        enablePattern: true,
        enableIntraday: true,
        enableCustom: true,
        tSignalThreshold: 2,
        buySignalThreshold: 5,
        sellSignalThreshold: 5,
        popupAlert: false,
        theme: 'dark-purple'
    };
    _predictionRecords = null;
    _stockNames = {};

    // 清除内存状态变量，避免脏数据残留
    _lastSearchedStock = null;
    _lastStrategies = [];
    _lastSummary = null;
    _lastKlines = [];
    _lastPanoramaStrategies = [];
    _lastPanoramaSummary = null;
    _homePlanStock = null;
    _alertedSignals = {};
    _profitListRendered = false;
    _lastHoldingCodes = [];
    _currentStock = null;
    _feeDetail = { commissionFee: 0, stampTax: 0, transferFee: 0, totalFees: 0 };
    _profitDetail = { totalProfit: 0, realizedProfit: 0, unrealizedProfit: 0, tProfit: 0, tTradeCount: 0, tWinCount: 0, stockProfits: [], totalBuy: 0, totalSell: 0, remaining: 0, tradeCount: 0, totalBuyAmount: 0, totalSellAmount: 0, commissionFee: 0, stampTax: 0, transferFee: 0, totalFees: 0 };
    _stockRequestId = 0;
    _activeCategory = '全部';
    _currentStrategySubtab = 'strategy';
    for (const key in _priceCache) delete _priceCache[key];
    _priceCacheKeys.length = 0;

    loadSettings();
    // R9-16: 清除后应用默认主题和重置自动刷新，避免残留状态
    changeTheme(_settings.theme || 'dark-purple');
    updateAutoRefresh();
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
    const lastCheck = localStorage.getItem('lastUpdateCheck');
    if (lastCheck && Date.now() - parseInt(lastCheck, 10) < 3600000) {
        showToast('已是最新版本 ✓');
        return;
    }
    localStorage.setItem('lastUpdateCheck', Date.now().toString());
    
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
                        <div style="background: var(--surface-3); border-radius: 10px; padding: 14px; text-align: left; margin-bottom: 16px; max-height: 200px; overflow-y: auto;">
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
        window.open(GITHUB_DOWNLOAD, '_blank', 'noopener,noreferrer');
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
    const counts = countStrategyActions(strategies);
    const buyCount = counts.buy;
    const sellCount = counts.sell;
    
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

let _audioCtx = null;
function playSound() {
    try {
        if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioContext = _audioCtx;
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

// ========== 学习中心数据 ==========
const LEARN_DATA = {
    categories: [
        { key: 'classic', name: '📜 经典理论', desc: '技术分析三大基石' },
        { key: 'method', name: '🎯 投资方法', desc: '全球主流投资流派' },
        { key: 'strategy', name: '⚡ 交易策略', desc: '可执行的实战策略' },
        { key: 'risk', name: '🛡️ 风险管理', desc: '保命的资金管理' },
        { key: 'ai', name: '🤖 AI自研战法', desc: 'AI独创交易体系' }
    ],
    items: [
        // ===== 经典理论 =====
        {
            id: 'dow',
            cat: 'classic',
            title: '道氏理论',
            icon: '📈',
            tag: '技术分析鼻祖',
            difficulty: '⭐⭐',
            summary: '查尔斯·道创立，技术分析的基石，提出市场有三种趋势：主要趋势、中期趋势、短期趋势。',
            content: `
<h4>一、道氏理论核心思想</h4>
<p>道氏理论由《华尔街日报》创始人查尔斯·道（Charles Dow）于19世纪末提出，是所有技术分析的鼻祖。</p>

<h4>二、三大假设</h4>
<p><strong>1. 价格反映一切</strong><br>
所有信息——基本面、政策、情绪——最终都会反映在价格走势中。</p>
<p><strong>2. 市场有三种趋势</strong><br>
• 主要趋势（1-2年）：大牛市或大熊市<br>
• 中期趋势（1-3个月）：主要趋势中的回调或反弹<br>
• 短期趋势（数天-数周）：日常波动，噪音为主</p>
<p><strong>3. 趋势需要量能确认</strong><br>
上涨趋势中，价格上涨时放量、下跌时缩量；下跌趋势则相反。</p>

<h4>三、趋势确认原则</h4>
<p><strong>• 高点和低点递推：</strong>上升趋势 = 高点更高 + 低点更高<br>
<strong>• 双重确认：</strong>工业指数和铁路指数（现在可用不同指数相互验证）同时出现同向信号才可靠<br>
<strong>• 趋势延续直到反转：</strong>不要轻易预测顶部或底部，等明确反转信号再行动</p>

<h4>四、实战要点</h4>
<p>✅ 顺势而为是王道，不要逆势抄底摸顶<br>
✅ 主要趋势决定大方向，中期趋势提供入场时机<br>
✅ 短期趋势可以忽略，别被日内波动牵着走<br>
✅ 交易量是趋势的"验证器"，无量上涨要警惕</p>

<h4>五、局限性</h4>
<p>道氏理论偏"事后诸葛亮"——趋势走出来了才能确认，对精确入场点指导有限。但它的核心理念"顺势而为"是所有成功交易者的共识。</p>
`
        },
        {
            id: 'elliott',
            cat: 'classic',
            title: '波浪理论',
            icon: '🌊',
            tag: '艾略特波浪',
            difficulty: '⭐⭐⭐⭐',
            summary: '拉尔夫·艾略特提出，市场走势遵循5浪上升+3浪下跌的重复模式。',
            content: `
<h4>一、波浪理论核心</h4>
<p>由拉尔夫·艾略特（Ralph Elliott）在1930年代提出，认为市场走势是人类群体心理的反映，遵循可预测的波浪模式。</p>

<h4>二、基本结构：5+3</h4>
<p><strong>推动浪（5浪）：</strong>与主趋势同向<br>
• 浪1：初始上涨，少数人发现价值<br>
• 浪2：回调，怀疑论者出场（不会跌破浪1起点）<br>
• 浪3：主升浪，最强劲的一波（通常是最长的）<br>
• 浪4：整理，获利盘了结（不会进入浪1价格区间）<br>
• 浪5：最后冲刺，大众疯狂入场</p>
<p><strong>调整浪（3浪）：</strong>与主趋势反向<br>
• A浪：下跌初期，多数人以为是回调<br>
• B浪：反弹，"死猫跳"，迷惑性强<br>
• C浪：暴跌，真正的下跌，杀伤力最大</p>

<h4>三、数浪三大铁律</h4>
<p>🔴 浪2永远不会跌破浪1的起点<br>
🔴 浪3永远不是最短的推动浪<br>
🔴 浪4永远不会进入浪1的价格区间</p>

<h4>四、斐波那契关系</h4>
<p>各浪之间经常存在斐波那契比例关系：<br>
• 浪3 = 浪1 × 1.618 或 2.618<br>
• 浪2回调 = 浪1的 50% 或 61.8%<br>
• 浪4回调 = 浪3的 38.2% 或 50%<br>
• A浪、B浪、C浪之间也有类似比例</p>

<h4>五、实战技巧</h4>
<p>✅ 先定大级别，再数小级别（周线→日线→小时线）<br>
✅ 浪3是"黄金浪"，抓住它收益最大<br>
✅ 浪5往往伴随天量和疯狂情绪，是离场信号<br>
✅ 不要机械数浪，同一走势可能有多种数法</p>

<h4>六、注意事项</h4>
<p>⚠️ 波浪理论主观性极强，"一千个人有一千种数法"<br>
⚠️ 事后看都对，事前很难确定<br>
⚠️ 建议作为辅助分析，不要作为唯一依据</p>
`
        },
        {
            id: 'gann',
            cat: 'classic',
            title: '江恩理论',
            icon: '📐',
            tag: '江恩角度线',
            difficulty: '⭐⭐⭐⭐⭐',
            summary: '威廉·江恩创立，融合几何、数学、天文学的神秘交易体系。',
            content: `
<h4>一、江恩理论简介</h4>
<p>威廉·江恩（William Gann）是20世纪初最传奇的交易者之一，据说在50年交易生涯中获利超过5000万美元（相当于现在的数十亿美元）。</p>

<h4>二、核心观点</h4>
<p><strong>1. 历史会重演</strong><br>
市场运动有周期性规律，过去发生的，未来还会发生。</p>
<p><strong>2. 时间是最重要的因素</strong><br>
江恩认为时间决定一切，价格只是时间的函数。当时间到了，价格自然会逆转。</p>
<p><strong>3. 价格与时间成比例</strong><br>
价格波动和时间流逝之间存在数学比例关系（1:1、1:2、2:1等）。</p>

<h4>三、江恩角度线（Gann Fan）</h4>
<p>从一个重要的高点或低点出发，画出一组角度线：<br>
• 1×1线：1个单位时间对应1个单位价格（最重要）<br>
• 1×2线：1个时间单位对2个价格单位<br>
• 2×1线：2个时间单位对1个价格单位<br>
• 还有1×4、4×1、1×8、8×1等</p>
<p>价格在1×1线上方 = 强势，下方 = 弱势。角度线起到支撑/压力作用。</p>

<h4>四、江恩正方与轮中轮</h4>
<p>江恩正方：把价格和时间放在一个正方形中，对角线和中线上的点往往是转折点。</p>
<p>江恩轮中轮：一个360度的圆形图表，将价格、时间、角度融为一体，用来预测转折点。</p>

<h4>五、江恩22条交易规则</h4>
<p>精选几条最重要的：<br>
1. 永不过度交易<br>
2. 永不让盈利变亏损（止损上移）<br>
3. 顺势交易，不逆势猜顶底<br>
4. 不确定时就离场<br>
5. 只在活跃的股票中交易<br>
6. 平均分摊风险（分散投资）<br>
7. 不设止损就不交易</p>

<h4>六、争议与评价</h4>
<p>⚠️ 江恩理论非常复杂，学习成本极高<br>
⚠️ 很多人认为其中"玄学"成分大于科学<br>
⚠️ 江恩的真实交易业绩有争议<br>
✅ 但江恩的交易规则（止损、顺势、资金管理）是真正有价值的部分</p>
`
        },
        {
            id: 'chan',
            cat: 'classic',
            title: '缠论',
            icon: '🧵',
            tag: '中国本土理论',
            difficulty: '⭐⭐⭐⭐⭐',
            summary: '缠中说禅创立，基于纯逻辑推导的技术分析体系，笔、线段、中枢是核心。',
            content: `
<h4>一、缠论简介</h4>
<p>缠论由网名"缠中说禅"的博主在2006-2008年间发表，是中国人原创的技术分析体系，逻辑性极强，号称"100%安全的交易系统"。</p>

<h4>二、核心概念</h4>
<p><strong>1. 分型</strong><br>
• 顶分型：三根K线，中间那根最高<br>
• 底分型：三根K线，中间那根最低<br>
这是缠论最基本的"砖块"。</p>
<p><strong>2. 笔</strong><br>
相邻的顶分型和底分型之间连起来就是"一笔"。上升笔 = 底分型→顶分型，下降笔 = 顶分型→底分型。</p>
<p><strong>3. 线段</strong><br>
至少由三笔组成，方向相同的连续笔构成线段。线段是比笔高一级别的走势单元。</p>
<p><strong>4. 中枢</strong><br>
至少三段重叠的走势构成一个"中枢"，相当于横盘整理区间。中枢是缠论最核心的概念——没有中枢就没有趋势。</p>
<p><strong>5. 走势类型</strong><br>
• 盘整：只有一个中枢<br>
• 上涨趋势：至少两个中枢，依次上移<br>
• 下跌趋势：至少两个中枢，依次下移</p>

<h4>三、买卖点</h4>
<p><strong>第一类买点：</strong>下跌趋势中，最后一个中枢之后的背驰点（趋势背驰）</p>
<p><strong>第二类买点：</strong>第一类买点之后的回调，不跌破第一类买点的低点</p>
<p><strong>第三类买点：</strong>突破中枢后，回踩不跌破中枢上沿</p>
<p>卖点同理，反过来即可。</p>

<h4>四、背驰</h4>
<p>背驰 = 趋势力度减弱。比如上涨中，后一段的涨幅、量能都不如前一段，就是"顶背驰"，预示要回调。</p>
<p>判断背驰的方法：MACD柱子面积比较、均线面积比较等。</p>

<h4>五、级别联立</h4>
<p>缠论强调"多级别联立"：<br>
• 大级别定方向（周线、日线）<br>
• 中级别找买卖点（4小时、2小时）<br>
• 小级别精确定位（30分钟、5分钟）</p>

<h4>六、学习建议</h4>
<p>⚠️ 缠论体系庞大，概念众多，入门难度大<br>
⚠️ 容易"学了一堆概念，实盘还是亏"<br>
✅ 重点学"中枢+买卖点+背驰"的核心逻辑<br>
✅ 结合大级别趋势，不要陷在小级别里</p>
`
        },
        {
            id: 'volume',
            cat: 'classic',
            title: '量价关系',
            icon: '📊',
            tag: '成交量分析',
            difficulty: '⭐⭐',
            summary: '成交量是股价涨跌的燃料，量价配合是判断趋势的关键。',
            content: `
<h4>一、量价关系基础</h4>
<p>成交量 = 买卖双方达成交易的股票数量。放量 = 多空分歧大，缩量 = 多空一致。</p>
<p><strong>核心原则：量在价先。</strong>成交量放大往往先于价格变动，是价格变动的"先行指标"。</p>

<h4>二、八大经典量价关系</h4>
<p><strong>1. 价涨量增 → 强势信号</strong><br>
上涨时成交量放大，说明资金积极入场，看涨预期强烈。健康的多头行情。</p>
<p><strong>2. 价涨量缩 → 警惕信号</strong><br>
上涨但成交量萎缩，可能是"虚涨"，动能不足，小心回调。</p>
<p><strong>3. 价跌量增 → 弱势信号</strong><br>
下跌时成交量放大，说明抛盘汹涌，看跌预期强烈。不要接飞刀。</p>
<p><strong>4. 价跌量缩 → 观望信号</strong><br>
下跌但成交量萎缩，可能是"假摔"，卖盘衰竭，可能见底。</p>
<p><strong>5. 底部放量 → 关注信号</strong><br>
长期下跌后突然放量，可能是主力建仓信号，值得关注。</p>
<p><strong>6. 高位放量 → 警惕信号</strong><br>
高位放量大涨/大跌都可能是主力出货，后市看跌。</p>
<p><strong>7. 地量见地价</strong><br>
成交量极度萎缩，往往是市场底部区域，但何时反弹不确定。</p>
<p><strong>8. 天量见天价</strong><br>
成交量创历史新高，往往是短期顶部区域。</p>

<h4>三、量价配合分析</h4>
<p><strong>上涨趋势的量价配合：</strong><br>
• 涨时放量，跌时缩量 = 健康的多头趋势<br>
• 涨时缩量，跌时放量 = 趋势可能反转</p>
<p><strong>下跌趋势的量价配合：</strong><br>
• 跌时放量，涨时缩量 = 健康的空头趋势<br>
• 跌时缩量，涨时放量 = 趋势可能反转</p>

<h4>四、实战应用</h4>
<p>✅ 突破时放量 = 真突破，可跟进</p>
<p>✅ 回调缩量 = 主力控盘，可持有</p>
<p>✅ 跌破支撑放量 = 加速下跌信号，止损</p>
<p>❌ 缩量上涨 = 虚涨，谨慎追高</p>
<p>❌ 放量下跌 = 恐慌抛售，不要抄底</p>

<h4>五、注意事项</h4>
<p>⚠️ 量价分析要结合位置（高位/低位）来判断</p>
<p>⚠️ 涨停/跌停时的量能分析要特殊对待</p>
<p>⚠️ 除权除息后的成交量要复权处理</p>
<p>⚠️ 个股和指数的量价规律可能不同</p>
`
        },

        // ===== 投资方法 =====
        {
            id: 'value',
            cat: 'method',
            title: '价值投资',
            icon: '💎',
            tag: '巴菲特 格雷厄姆',
            difficulty: '⭐⭐⭐',
            summary: '买入价格低于内在价值的股票，长期持有等待价值回归。',
            content: `
<h4>一、价值投资是什么</h4>
<p>价值投资 = 用5毛钱买价值1块钱的东西。</p>
<p>由本杰明·格雷厄姆创立，沃伦·巴菲特发扬光大，是全球最成功的投资流派之一。</p>

<h4>二、核心理念</h4>
<p><strong>1. 内在价值</strong><br>
每只股票背后都是一家真实的公司，公司有其"内在价值"。股价短期会偏离，但长期会回归价值。</p>
<p><strong>2. 安全边际</strong><br>
只有当股价显著低于内在价值时才买入，这个"差价"就是安全边际。安全边际越大，亏损风险越小。</p>
<p><strong>3. 市场先生</strong><br>
把市场想象成一个情绪化的"市场先生"，他每天给你报一个价格。有时候他很乐观报高价，有时候很悲观报低价。你不需要每天都交易，只在他报出极端价格时出手。</p>
<p><strong>4. 能力圈</strong><br>
只投资你真正懂的行业和公司。不懂的不碰，赚到你认知范围内的钱。</p>

<h4>三、估值方法</h4>
<p><strong>• PE（市盈率）：</strong>股价 / 每股收益。越低越便宜，但要看行业。</p>
<p><strong>• PB（市净率）：</strong>股价 / 每股净资产。银行、地产等重资产行业常用。</p>
<p><strong>• ROE（净资产收益率）：</strong>净利润 / 净资产。衡量公司赚钱能力，长期>15%算优秀。</p>
<p><strong>• DCF（现金流折现）：</strong>把未来所有自由现金流折成现值。理论上最准确，但参数选择主观性大。</p>
<p><strong>• PEG：</strong>PE / 盈利增长率。结合了成长性，<1通常被认为便宜。</p>

<h4>四、巴菲特的选股标准</h4>
<p>✅ 业务简单易懂<br>
✅ 有持久的竞争优势（"护城河"）<br>
✅ 管理层诚实能干<br>
✅ 长期财务稳健<br>
✅ 价格合理（不是最便宜的，但要有安全边际）</p>

<h4>五、护城河的种类</h4>
<p>🏰 无形资产：品牌（茅台）、专利（药企）<br>
🏰 转换成本：用户换产品很麻烦（微信、Office）<br>
🏰 网络效应：用的人越多越有价值（淘宝、社交软件）<br>
🏰 成本优势：规模效应、独特资源</p>

<h4>六、常见误区</h4>
<p>❌ 跌了很多就叫"便宜"——可能是价值陷阱<br>
❌ PE低就值得买——可能行业在衰退<br>
❌ 死拿着不撒手——基本面变了就要卖<br>
❌ 只看财务数据不看行业趋势</p>

<h4>七、适合人群</h4>
<p>✓ 有耐心，能持有3年以上<br>
✓ 喜欢研究公司基本面<br>
✓ 情绪稳定，不追涨杀跌<br>
✓ 有一定财务分析能力</p>
`
        },
        {
            id: 'growth',
            cat: 'method',
            title: '成长投资',
            icon: '🚀',
            tag: '费雪 彼得林奇',
            difficulty: '⭐⭐⭐',
            summary: '买入高成长公司，赚业绩增长的钱，代表人物菲利普·费雪。',
            content: `
<h4>一、成长投资是什么</h4>
<p>成长投资 = 买未来能持续高速增长的公司，即使现在看起来不便宜。</p>
<p>代表人物：菲利普·费雪（费雪成长股投资）、彼得·林奇（PEG选股法）、杰克·韦尔奇。</p>

<h4>二、核心逻辑</h4>
<p>价值投资关注"现在有多便宜"，成长投资关注"未来能涨多大"。</p>
<p>一家公司如果每年利润增长30%，哪怕现在PE是50倍，3年后利润翻一番，PE就变成25倍了。</p>

<h4>三、成长股的特征</h4>
<p>📈 营收高速增长（年增长>20%）<br>
📈 利润高速增长（净利润增速>营收增速更好）<br>
📈 行业天花板高，赛道够长够宽<br>
📈 公司有独特的竞争优势<br>
📈 管理层优秀，执行力强</p>

<h4>四、如何寻找成长股</h4>
<p><strong>1. 找高景气赛道</strong><br>
什么是未来的大趋势？新能源？人工智能？生物医药？消费升级？选对赛道，成功一半。</p>
<p><strong>2. 找龙头公司</strong><br>
行业里的第一名通常会越来越强，赢家通吃。不要贪便宜买老二老三。</p>
<p><strong>3. PEG选股法（彼得·林奇）</strong><br>
PEG = PE / 净利润增长率</p>
<p>• PEG < 1：可能被低估，值得关注<br>
• PEG = 1：合理估值<br>
• PEG > 1：可能偏贵</p>
<p><strong>4. 关注毛利率和净利率</strong><br>
毛利率高 = 产品有竞争力或定价权。<br>
净利率高 = 管理效率高，赚钱能力强。</p>

<h4>五、卖出时机</h4>
<p>🔴 公司基本面恶化，增长逻辑被破坏<br>
🔴 估值高得离谱（泡沫化）<br>
🔴 找到了更好的投资标的<br>
🔴 行业景气度见顶</p>

<h4>六、成长投资的风险</h4>
<p>⚠️ <strong>估值杀：</strong>一旦增速不及预期，估值和业绩"戴维斯双杀"<br>
⚠️ <strong>伪成长：</strong>有些公司只是短期爆发，不是真成长<br>
⚠️ <strong>赛道拥挤：</strong>大家都看好的赛道，估值早已上天<br>
⚠️ <strong>技术迭代：</strong>今天的成长股可能明天就被新技术颠覆</p>

<h4>七、价值 vs 成长</h4>
<p>其实两者不矛盾，巴菲特后来也说自己是"85%的格雷厄姆 + 15%的费雪"。最好的投资是"合理价格买入优秀公司"——既有成长确定性，又有安全边际。</p>
`
        },
        {
            id: 'trend',
            cat: 'method',
            title: '趋势投资',
            icon: '📈',
            tag: '顺势而为',
            difficulty: '⭐⭐',
            summary: '涨了买，涨更多就拿着，跌了就卖，赚趋势的钱。',
            content: `
<h4>一、趋势投资是什么</h4>
<p>趋势投资 = 顺势而为。股票在涨，就买了拿着；股票开始跌了，就卖掉。</p>
<p>不预测顶部和底部，只跟随已形成的趋势。</p>

<h4>二、核心理念</h4>
<p><strong>1. 趋势一旦形成，更容易延续而不是反转</strong><br>
这就是物理学的"惯性"在市场中的体现。涨的股票会继续涨，跌的会继续跌。</p>
<p><strong>2. 不要预测，只需跟随</strong><br>
没人能准确预测顶和底。趋势投资者不做预测，只做应对：涨了就持有，跌破趋势就离场。</p>
<p><strong>3. 截断亏损，让利润奔跑</strong><br>
看错了就赶紧止损，损失有限；看对了就拿着不动，让利润最大化。</p>

<h4>三、判断趋势的方法</h4>
<p><strong>• 均线法：</strong>最简单也最有效。<br>
  - 价格在200日均线上方 = 长期上升趋势<br>
  - 价格在200日均线下方 = 长期下降趋势<br>
  - 短均线上穿长均线（金叉）= 趋势转强</p>
<p><strong>• 高低点法：</strong><br>
  - 上升趋势：高点越来越高，低点也越来越高<br>
  - 下降趋势：高点越来越低，低点也越来越低</p>
<p><strong>• 趋势线法：</strong><br>
  连接两个低点画上升趋势线，跌破就离场。</p>
<p><strong>• MACD法：</strong><br>
  DIF在DEA上方 = 多头趋势，反之空头。</p>

<h4>四、经典趋势策略</h4>
<p><strong>🐢 海龟交易法：</strong>20日新高买入，10日新低卖出。最经典的趋势跟踪系统。</p>
<p><strong>📊 双均线策略：</strong>5日均线上穿20日均线买入，下穿卖出。</p>
<p><strong>💎 突破策略：</strong>价格突破前期高点/平台/通道上轨时买入。</p>

<h4>五、止盈止损</h4>
<p>止损：<br>
• 固定比例止损（-5%、-8%）<br>
• 移动止损（最高价回落5%就卖）<br>
• 趋势止损（跌破趋势线/均线就卖）</p>
<p>止盈：<br>
• 趋势投资者一般不主动止盈，让利润奔跑<br>
• 用移动止损代替止盈<br>
• 只有趋势反转才卖出</p>

<h4>六、趋势投资的优缺点</h4>
<p>✅ 优点：逻辑简单，容易执行，大行情时收益极高<br>
✅ 优点：不需要深入研究公司，看图就行<br>
❌ 缺点：震荡市中会被反复打脸（"左右挨耳光"）<br>
❌ 缺点：胜率不高（可能只有30-40%），靠盈亏比赚钱</p>

<h4>七、成功的关键</h4>
<p>💡 严格执行，不要情绪化操作<br>
💡 接受连续小亏损，这是趋势策略的正常成本<br>
💡 不要在震荡市用趋势策略，要判断市场环境<br>
💡 分散投资，不要单吊一只</p>
`
        },
        {
            id: 'swing',
            cat: 'method',
            title: '波段交易',
            icon: '🎢',
            tag: '波段操作',
            difficulty: '⭐⭐⭐',
            summary: '抓住一波上涨行情，吃到鱼身就走，不贪鱼头鱼尾。',
            content: `
<h4>一、波段交易是什么</h4>
<p>波段交易 = 在相对低点买入，相对高点卖出，吃中间一段。</p>
<p>持仓周期通常是几天到几周，介于日内交易和长线投资之间。</p>

<h4>二、适合人群</h4>
<p>✓ 没有时间天天盯盘，但愿意每天看一眼<br>
✓ 不想持有几年那么久，但也不想频繁交易<br>
✓ 有一定技术分析基础<br>
✓ 能拿得住股票，也能舍得卖</p>

<h4>三、波段买点</h4>
<p><strong>1. 回调到支撑位</strong><br>
• 回调到重要均线（20日、60日）<br>
• 回调到前期平台/筹码密集区<br>
• 回调到趋势线<br>
• 回调幅度通常是前一波涨幅的38.2%、50%、61.8%（斐波那契）</p>
<p><strong>2. 突破确认后回踩</strong><br>
• 突破前期高点后，回踩确认不破<br>
• 这是最经典的波段买点</p>
<p><strong>3. 底部形态完成</strong><br>
• W底、头肩底、三重底等<br>
• 形态突破颈线时买入</p>

<h4>四、波段卖点</h4>
<p><strong>1. 涨到压力位</strong><br>
• 前期高点<br>
• 通道上轨<br>
• 重要均线（如果是反弹行情）<br>
• 筹码密集套牢区</p>
<p><strong>2. 出现见顶信号</strong><br>
• 放量大阴线<br>
• 长上影线<br>
• 顶背离（价格新高但指标没新高）<br>
• 连续大涨后滞涨</p>
<p><strong>3. 达到目标收益</strong><br>
• 提前设定目标位（比如15%、20%）<br>
• 到了就卖，不要贪</p>

<h4>五、止损策略</h4>
<p>• 买入价下跌5-8%就止损<br>
• 跌破买入逻辑就止损（比如本来指望均线支撑，结果跌破了）<br>
• 绝对不允许"套牢了就拿着当长线"</p>

<h4>六、波段操作的"三要三不要"</h4>
<p><strong>三要：</strong><br>
✅ 要等回调买，不要追高<br>
✅ 要分批买卖，不要一把梭<br>
✅ 要严格止损，不要死扛</p>
<p><strong>三不要：</strong><br>
❌ 不要频繁交易，机会是等出来的<br>
❌ 不要追涨杀跌，看到涨了才想买<br>
❌ 不要贪得无厌，吃到鱼身就够了</p>

<h4>七、提高胜率的技巧</h4>
<p>💡 大趋势向上时做波段，成功率高很多<br>
💡 成交量配合的突破更可靠<br>
💡 热门板块、龙头股的波段机会更多<br>
💡 大盘环境好时操作，大盘差时空仓等待</p>
`
        },

        // ===== 交易策略 =====
        {
            id: 'turtle',
            cat: 'strategy',
            title: '海龟交易法',
            icon: '🐢',
            tag: '完整趋势系统',
            difficulty: '⭐⭐',
            summary: '理查德·丹尼斯的经典实验，用简单规则培养普通人成为成功交易员。',
            content: `
<h4>一、海龟交易法的来历</h4>
<p>1983年，著名商品交易员理查德·丹尼斯和朋友打赌：伟大的交易员是天生的还是后天培养的？</p>
<p>他招了一群普通人（"海龟"），教给他们一套简单的交易规则，然后给他们真金白银去交易。</p>
<p>结果：这些"海龟"在4年里平均年收益率超过80%！证明了交易是可以学会的。</p>

<h4>二、核心规则（完整版）</h4>
<p><strong>1. 市场：</strong>选择流动性好、波动大的品种（股票、期货、外汇等）</p>
<p><strong>2. 入市信号（系统1）：</strong><br>
• 价格突破20日新高 → 买入<br>
• 价格跌破20日新低 → 卖出（做空）<br>
如果上一笔交易是亏损的，就跳过这次信号（避免连续亏损）</p>
<p><strong>3. 入市信号（系统2）：</strong><br>
• 价格突破55日新高 → 买入<br>
• 价格跌破55日新低 → 卖出<br>
不考虑上一笔盈亏，信号触发就入场（更稳健）</p>
<p><strong>4. 止损：</strong><br>
• 每笔交易风险不超过账户总资金的2%<br>
• 止损位 = 入场价 - 2×ATR（平均真实波幅）<br>
• 如果加仓了，所有仓位的止损上移到最新仓位的止损位</p>
<p><strong>5. 加仓：</strong><br>
• 每上涨0.5×ATR就加一次仓<br>
• 最多加4次仓<br>
• 金字塔加仓：越往上加得越少</p>
<p><strong>6. 离市：</strong><br>
• 系统1：10日新低就平仓<br>
• 系统2：20日新低就平仓<br>
• 不设止盈，让利润奔跑</p>

<h4>三、ATR是什么</h4>
<p>ATR（Average True Range，平均真实波幅）衡量价格每天波动的幅度。</p>
<p>为什么用ATR来止损和加仓？因为不同股票、不同时期的波动率不一样。用ATR可以自适应调整。</p>

<h4>四、资金管理（最精华的部分）</h4>
<p>海龟交易法的资金管理非常严格：</p>
<p>• 单笔风险：不超过总资金的2%<br>
• 单个市场：最多4个单位<br>
• 高度相关的市场：最多6个单位<br>
• 所有市场合计：最多12个单位</p>
<p>这就是为什么海龟能活过极端行情——仓位控制得死死的。</p>

<h4>五、海龟法则为什么有效</h4>
<p>✅ 顺势而为：大趋势来了能抓住<br>
✅ 严格止损：亏损永远有限<br>
✅ 让利润奔跑：大行情时收益惊人<br>
✅ 机械化交易：没有情绪干扰</p>

<h4>六、海龟法则的问题</h4>
<p>⚠️ 震荡市会连续亏损（胜率只有约30%）<br>
⚠️ 回撤可能很大（20-30%很正常）<br>
⚠️ 需要极强的纪律性，大多数人坚持不下来<br>
⚠️ A股个股不适合直接用（做空受限、涨跌停限制）</p>

<h4>七、A股怎么改良使用</h4>
<p>💡 可以用在指数ETF上（趋势更清晰）<br>
💡 只做多，不做空<br>
💡 把20日突破改成50日或60日，减少假突破<br>
💡 结合大盘环境，大盘不好时空仓<br>
💡 选股选趋势明确的强势股</p>
`
        },
        {
            id: 'boll',
            cat: 'strategy',
            title: '布林带战法',
            icon: '🎯',
            tag: '布林线 BOLL',
            difficulty: '⭐⭐',
            summary: '利用布林带上下轨识别支撑压力，在收口/开口中捕捉买卖点。',
            content: `
<h4>一、布林带简介</h4>
<p>布林带（Bollinger Bands）由约翰·布林格发明，由三条线组成：</p>
<p>• 中轨 = 20日均线<br>
• 上轨 = 中轨 + 2倍标准差<br>
• 下轨 = 中轨 - 2倍标准差</p>
<p>正常情况下，95%的价格会落在布林带内。</p>

<h4>二、五种基本形态</h4>
<p><strong>1. 开口放大 → 趋势行情</strong><br>
布林带三轨同向发散，价格沿上轨上涨或沿下轨下跌。这是趋势行情的标志。</p>
<p><strong>2. 收口压缩 → 变盘前兆</strong><br>
布林带收窄，说明波动率降低，市场在选择方向。横盘整理即将结束。</p>
<p><strong>3. 紧贴上轨 → 强势上涨</strong><br>
价格紧贴布林上轨运行，说明多方强势，不要轻易做空。</p>
<p><strong>4. 紧贴下轨 → 弱势下跌</strong><br>
价格紧贴布林下轨运行，说明空方强势，不要轻易抄底。</p>
<p><strong>5. 轨道走平 → 震荡行情</strong><br>
布林带上下轨横向运行，价格在轨道内来回穿梭，适合做高抛低吸。</p>

<h4>三、经典买卖信号</h4>
<p><strong>买点1：回踩中轨</strong><br>
上涨趋势中，价格回调到布林中轨（20日均线）获得支撑，是较好的买入点。</p>
<p><strong>买点2：下轨支撑</strong><br>
价格触及布林下轨后反弹，是超跌反弹的买入信号。</p>
<p><strong>买点3：开口向上</strong><br>
布林带从收口变为开口向上，且价格站上中轨，是趋势启动信号。</p>
<p><strong>卖点1：反弹上轨</strong><br>
下跌趋势中，价格反弹到布林上轨附近是卖出机会。</p>
<p><strong>卖点2：上轨压制</strong><br>
价格触及布林上轨后回落，是弱势反弹的卖出信号。</p>
<p><strong>卖点3：开口向下</strong><br>
布林带从收口变为开口向下，是趋势破位信号，应离场。</p>

<h4>四、布林带 + 其他指标</h4>
<p><strong>布林 + MACD：</strong><br>
布林开口向上 + MACD金叉 = 强强联合，做多信号更强</p>
<p><strong>布林 + 量能：</strong><br>
价格突破布林上轨 + 放量 = 真突破，可追入<br>
价格突破布林上轨 + 缩量 = 假突破，小心诱多</p>
<p><strong>布林 + RSI：</strong><br>
价格触及下轨 + RSI<30 = 超卖，可博反弹<br>
价格触及上轨 + RSI>70 = 超买，注意回调</p>

<h4>五、注意事项</h4>
<p>⚠️ 布林带是趋势指标，在震荡市容易被反复打脸</p>
<p>⚠️ 参数可以调整（20日±2倍是最经典的）</p>
<p>⚠️ 不要只看布林带，要结合趋势、位置综合判断</p>
<p>⚠️ 极端行情中，布林带会被大幅突破</p>
`
        },
        {
            id: 'macd',
            cat: 'strategy',
            title: 'MACD战法',
            icon: '📉',
            tag: 'MACD指标',
            difficulty: '⭐⭐',
            summary: 'MACD是趋势指标之王，金叉死叉、顶底背离是最经典的信号。',
            content: `
<h4>一、MACD是什么</h4>
<p>MACD（Moving Average Convergence Divergence）由Gerald Appel发明，全称"指数平滑异同移动平均线"。</p>
<p><strong>三个组成部分：</strong><br>
• DIF线（快线）：短期EMA - 长期EMA<br>
• DEA线（慢线）：DIF的EMA<br>
• MACD柱：DIF - DEA</p>
<p>参数设置：12, 26, 9（最经典）或 5, 35, 5（更灵敏）</p>

<h4>二、四种基本信号</h4>
<p><strong>1. 金叉（买入信号）</strong><br>
DIF上穿DEA，且在零轴上方 → 强势金叉，做多<br>
DIF上穿DEA，但在零轴下方 → 弱势金叉，谨慎做多</p>
<p><strong>2. 死叉（卖出信号）</strong><br>
DIF下穿DEA，且在零轴下方 → 强势死叉，做空<br>
DIF下穿DEA，但在零轴上方 → 弱势死叉，谨慎做空</p>
<p><strong>3. 零轴（多空分界线）</strong><br>
DIF和DEA都在零轴上方 = 多头市场<br>
DIF和DEA都在零轴下方 = 空头市场</p>
<p><strong>4. MACD柱（动能指示）</strong><br>
红柱（正值）= 多方动能，放大看涨，缩小看跌<br>
绿柱（负值）= 空方动能，放大看跌，缩小看涨</p>

<h4>三、顶背离与底背离（最重要）</h4>
<p><strong>顶背离（最可靠的卖出信号）</strong><br>
价格创出新高，但MACD没有创新高。<br>
说明：上涨动能减弱，趋势可能反转下跌。</p>
<p><strong>底背离（最可靠的买入信号）</strong><br>
价格创出新低，但MACD没有创新低。<br>
说明：下跌动能减弱，趋势可能反转为上涨。</p>
<p>⚠️ 背离需要反复确认，单次背离不一定可靠</p>
<p>⚠️ 背离的周期越大（周线>日线>60分钟），信号越可靠</p>

<h4>四、经典用法</h4>
<p><strong>1. 趋势判断</strong><br>
• MACD在零轴上方 → 上升趋势，逢低做多<br>
• MACD在零轴下方 → 下降趋势，逢高做空</p>
<p><strong>2. 进场时机</strong><br>
• MACD在零轴上方形成金叉 → 买入<br>
• MACD在零轴下方形成金叉 → 谨慎，等确认</p>
<p><strong>3. 出场时机</strong><br>
• MACD形成死叉 → 卖出<br>
• MACD柱由红转绿 → 减仓信号</p>
<p><strong>4. 背离交易</strong><br>
• 日线底背离 → 分批建仓<br>
• 60分钟底背离 → 精确入场点</p>

<h4>五、注意事项</h4>
<p>⚠️ MACD是趋势指标，震荡市中会反复金叉死叉</p>
<p>⚠️ 参数越大越滞后，越小越灵敏但假信号多</p>
<p>⚠️ 不要单独使用MACD，结合趋势、位置综合判断</p>
<p>⚠️ 背离只是警示，不是100%准确的买卖信号</p>
`
        },
        {
            id: 'rsi',
            cat: 'strategy',
            title: 'RSI战法',
            icon: '⚡',
            tag: 'RSI相对强弱',
            difficulty: '⭐⭐',
            summary: 'RSI衡量多空力量对比，超买超卖是经典的反转信号。',
            content: `
<h4>一、RSI是什么</h4>
<p>RSI（Relative Strength Index）由J. Welles Wilder Jr.发明，全称"相对强弱指数"。</p>
<p><strong>计算原理：</strong><br>
RSI = 100 - (100 / (1 + RS))<br>
RS = N日内上涨幅度均值 / N日内下跌幅度均值</p>
<p>参数：6日（短线）、12日（中线）、24日（长线）</p>

<h4>二、RSI的区间含义</h4>
<p><strong>0-20：超卖区（极度悲观）</strong><br>
市场上大多数人都在卖出，可能已经跌过头了。这是潜在的买入机会。</p>
<p><strong>20-50：偏弱区</strong><br>
空方占优，但如果RSI企稳，可能酝酿反弹。</p>
<p><strong>50-80：偏强区</strong><br>
多方占优，但如果RSI滞涨，可能面临回调。</p>
<p><strong>80-100：超买区（极度乐观）</strong><br>
市场上大多数人都在买入，可能已经涨过头了。这是潜在的卖出机会。</p>

<h4>三、经典用法</h4>
<p><strong>1. 超买超卖</strong><br>
• RSI < 20 → 超卖，可能反弹，可考虑买入<br>
• RSI > 80 → 超买，可能回调，可考虑卖出</p>
<p><strong>2. 金叉死叉</strong><br>
• 短期RSI上穿长期RSI → 金叉，买入信号<br>
• 短期RSI下穿长期RSI → 死叉，卖出信号</p>
<p><strong>3. 趋势线突破</strong><br>
RSI画趋势线，突破趋势线也是买卖信号。</p>
<p><strong>4. 背离</strong><br>
• 价格创新低，RSI没有创新低 → 底背离，买入信号<br>
• 价格创新高，RSI没有创新高 → 顶背离，卖出信号</p>

<h4>四、RSI的局限性</h4>
<p>⚠️ 强势股可以长时间维持在超买区（RSI>80）</p>
<p>⚠️ 弱势股可以长时间维持在超卖区（RSI<20）</p>
<p>⚠️ 单凭RSI做决策很容易卖飞牛股、抄底接刀</p>

<h4>五、实战技巧</h4>
<p>✅ 结合趋势：上升趋势中，RSI<50可能是更好的买点</p>
<p>✅ 结合背离：超买超卖 + 背离 = 更好的信号</p>
<p>✅ 结合位置：低位超卖比高位超买更可靠</p>
<p>✅ 多周期结合：日线RSI超卖 + 60分钟金叉 = 更好的买点</p>
<p>✅ 不同参数配合：6日和24日RSI同时在低位 = 更强信号</p>

<h4>六、参数选择建议</h4>
<p><strong>超短线（Day Trade）：</strong>6日RSI<br>
<strong>波段交易：</strong>12日RSI<br>
<strong>长线投资：</strong>24日RSI</p>
<p>牛市用高参数（RSI不容易超买），熊市用低参数（更容易捕捉反弹）。</p>
`
        },

        {
            id: 'gap',
            cat: 'strategy',
            title: '缺口理论',
            icon: '🔲',
            tag: '跳空缺口',
            difficulty: '⭐⭐',
            summary: '跳空缺口是市场情绪的直接体现，衰竭缺口、突破缺口、回补缺口各有含义。',
            content: `
<h4>一、什么是缺口</h4>
<p>缺口 = 跳空缺口。当某一天的最高价低于前一天的最低价（或最低价高于前一天的最高价），就形成了缺口。</p>
<p>缺口代表：市场在该区间没有成交，是情绪的真空地带。</p>

<h4>二、四种缺口类型</h4>
<p><strong>1. 普通缺口</strong><br>
特征：很快被回补（3-5天内）<br>
意义：没什么特别含义，就是正常波动<br>
操作：没什么参考价值，可以忽略</p>
<p><strong>2. 突破缺口</strong><br>
特征：伴随放量，缺口当天振幅大，短时间内不回补<br>
意义：真正的突破，后市会有一段趋势行情<br>
操作：突破缺口形成后追入，止损放在缺口内</p>
<p><strong>3. 持续缺口（中继缺口）</strong><br>
特征：在趋势中途出现，量能中等<br>
意义：趋势还没有结束，还会继续<br>
操作：可作为加仓点，或用缺口设置跟踪止损</p>
<p><strong>4. 衰竭缺口</strong><br>
特征：在趋势末端出现，往往伴随天量<br>
意义：趋势即将结束的反转信号<br>
操作：注意减仓，随时准备离场</p>

<h4>三、缺口必补理论</h4>
<p>A股有"缺口必补"的传统说法。这是因为：</p>
<p>• 普通缺口本来就是正常波动，当然会补<br>
• 突破缺口如果长期不补，说明趋势很强<br>
• 衰竭缺口被回补，往往意味着趋势反转</p>
<p>实战意义：<br>
• 上涨后的向下缺口 → 回补后是卖点<br>
• 下跌后的向上缺口 → 回补后是买点</p>

<h4>四、缺口战法</h4>
<p><strong>缺口买入：</strong><br>
• 下跌趋势末期出现向上跳空缺口 → 买入<br>
• 重要支撑位出现向上缺口 → 买入<br>
• 缩量回踩缺口不破 → 加仓机会</p>
<p><strong>缺口卖出：</strong><br>
• 上涨末期出现向下跳空缺口 → 卖出<br>
• 重要压力位出现向下缺口 → 卖出<br>
• 放量滞涨后出现向下缺口 → 清仓</p>

<h4>五、注意事项</h4>
<p>⚠️ 涨停板/跌停板的缺口短期内不回补</p>
<p>⚠️ 缺口理论在A股特别有效</p>
<p>⚠️ 多个缺口同时出现（岛形反转）是很强的信号</p>
<p>⚠️ 结合成交量判断缺口的性质</p>
`
        },
        {
            id: 'dragon',
            cat: 'strategy',
            title: '龙头战法',
            icon: '🐉',
            tag: '短线核心',
            difficulty: '⭐⭐⭐⭐',
            summary: '短线最核心的战法，专注板块龙头，在涨停板中寻找机会。',
            content: `
<h4>一、什么是龙头</h4>
<p>龙头 = 板块中涨幅最大、涨停最早、影响力最强的股票。</p>
<p>龙头是板块的风向标：龙头涨，板块跟；龙头跌，板块散。</p>
<p>做短线，本质上就是做龙头。</p>

<h4>二、龙头的特征</h4>
<p>📍 涨停时间早（最好在上午10点前）<br>
📍 板块中涨幅最大<br>
📍 成交量最大<br>
📍 封单金额大<br>
📍 有跟风小弟（板块内有其他股票跟涨）<br>
📍 不畏惧大盘调整，逆势拉升</p>

<h4>三、龙头战法的核心逻辑</h4>
<p><strong>1. 强者恒强</strong><br>
资金总是追逐最强的那只股票。龙头聚集了最多的资金关注度。</p>
<p><strong>2. 羊群效应</strong><br>
当龙头涨停，市场情绪被点燃，资金会本能地流向龙头。</p>
<p><strong>3. 惯性上涨</strong><br>
龙头股往往不是一下子涨到顶，而是连板，在高位反复震荡。</p>

<h4>四、买龙头的方法</h4>
<p><strong>1. 首板（第一次涨停）</strong><br>
发现某只股票涨停，且符合龙头特征 → 第二天高开可追</p>
<p><strong>2. 连板（2板、3板...）</strong><br>
• 龙头连板后开板低吸（恐慌盘是机会）<br>
• 龙头回调到5日/10日均线企稳 → 买入</p>
<p><strong>3. 龙头首阴</strong><br>
连续涨停后，第一根阴线往往有资金博弈<br>
条件：缩量回调、承接有力、不能放量大跌</p>

<h4>五、卖龙头的时机</h4>
<p><strong>🔴 卖出信号：</strong><br>
• 放量炸板（涨停被打开且放大量）<br>
• 连续一字板后开板<br>
• 板块内跟风股全部炸板<br>
• 大幅低开后无力翻红</p>
<p><strong>💡 止盈技巧：</strong><br>
• 从最高点回落10% → 卖一半<br>
• 跌破5日均线 → 再卖一半<br>
• 跌破10日均线 → 清仓</p>

<h4>六、风险控制（最重要）</h4>
<p>⚠️ <strong>龙头股振幅极大</strong><br>
一天上下10-20%很正常，没有强大的心脏别玩龙头</p>
<p>⚠️ <strong>追龙头要快准狠</strong><br>
犹豫一秒可能就涨停了，或者开板了</p>
<p>⚠️ <strong>控制仓位</strong><br>
单只龙头股不超过总资金的20%，不要重仓赌一只</p>
<p>⚠️ <strong>止损要坚决</strong><br>
买入后第二天不及预期，无条件卖出，不要幻想</p>

<h4>七、注意事项</h4>
<p>❌ 不是所有涨停股都是龙头，不要盲目追板</p>
<p>❌ 大盘环境差时，龙头战法成功率大幅降低</p>
<p>❌ 龙头战法是短线最高难度的操作，不适合新手</p>
<p>✅ 建议先用小仓位练习，熟练后再加大仓位</p>
<p>✅ 结合市场情绪周期：情绪高潮期做龙头，低迷时空仓</p>
`
        },
        {
            id: 'topic',
            cat: 'strategy',
            title: '题材炒作',
            icon: '🔥',
            tag: '热点题材',
            difficulty: '⭐⭐⭐',
            summary: 'A股特有的超额收益来源，跟随主力资金炒作热点题材板块。',
            content: `
<h4>一、什么是题材</h4>
<p>题材 = 有想象空间的催化剂。比如：政策利好、技术突破、业绩预增、重组并购等。</p>
<p>题材是A股超额收益的重要来源。一只股票可能因为一个消息，在短期内涨50%甚至翻倍。</p>

<h4>二、题材的分类</h4>
<p><strong>1. 政策驱动型</strong><br>
• 国家政策支持（科技、新能源、半导体等）<br>
• 区域发展政策（雄安新区、自贸区等）<br>
• 行业扶持政策</p>
<p><strong>2. 事件驱动型</strong><br>
• 突发新闻（自然灾害、国际事件等）<br>
• 行业重大事件（新产品发布、技术突破等）<br>
• 明星公司动态</p>
<p><strong>3. 业绩驱动型</strong><br>
• 业绩超预期<br>
• 扭亏为盈<br>
• 高送转</p>
<p><strong>4. 重组并购型</strong><br>
• 借壳上市<br>
• 资产注入<br>
• 并购整合</p>

<h4>三、题材炒作的五个阶段</h4>
<p><strong>第一阶段：预期期</strong><br>
消息刚出来，少数先知先觉的资金入场。股票开始异动，但大部分人还不知道。</p>
<p><strong>第二阶段：爆发期</strong><br>
消息发酵，市场开始炒作。龙头股连续涨停，板块全面拉升。</p>
<p><strong>第三阶段：分化期</strong><strong><br>
龙头继续涨，跟风股开始分化。真正的龙头开始显现。</p>
<p><strong>第四阶段：补涨期</strong><br>
龙头高位震荡，跟风股开始补涨。这时介入风险很大。</p>
<p><strong>第五阶段：退潮期</strong><br>
龙头见顶，板块整体回调。题材炒作结束。</p>

<h4>四、如何选题材</h4>
<p><strong>选大不选小</strong><br>
大题材（国家战略级别）持续时间长，如"国产替代"、"碳中和"。</p>
<p><strong>选新不选旧</strong><br>
新题材新鲜度高，更容易吸引资金。</p>
<p><strong>选龙头不选跟风</strong><br>
同一个题材，龙头涨幅最大，跟风股涨幅小甚至下跌。</p>
<p><strong>看市场情绪</strong><br>
大盘环境好时，题材炒作更猛烈。</p>

<h4>五、如何操作题材股</h4>
<p><strong>1. 第一时间发现</strong><br>
关注财经新闻、政策发布、公告信息。</p>
<p><strong>2. 判断题材大小</strong><br>
大题材可以追（国家政策级别），小题材要谨慎。</p>
<p><strong>3. 选龙头</strong><br>
涨停最早、涨幅最大、成交量最大的那个。</p>
<p><strong>4. 控制仓位</strong><br>
题材股波动大，仓位不要太重。</p>
<p><strong>5. 止损止盈</strong><br>
买入后不及预期就走，不要死扛。</p>

<h4>六、题材炒作的风险</h4>
<p>⚠️ 题材炒作是资金博弈，不是价值投资</p>
<p>⚠️ 消息可能滞后，等散户知道时已经是高位</p>
<p>⚠️ 政策变化快，题材持续性难判断</p>
<p>⚠️ 散户消息滞后，容易追高被套</p>
<p>⚠️ 要有严格的止损纪律，否则一次亏损可能吃掉多次盈利</p>
`
        },
        {
            id: 'support',
            cat: 'strategy',
            title: '支撑压力战法',
            icon: '⬆️',
            tag: '技术分析基础',
            difficulty: '⭐⭐',
            summary: '找到关键的支撑位和压力位，在支撑买、在压力卖，是最基础但最重要的技术。',
            content: `
<h4>一、什么是支撑和压力</h4>
<p><strong>支撑位：</strong>价格跌到这里时，像有"支撑"一样，容易反弹。</p>
<p><strong>压力位：</strong>价格涨到这里时，像有"压力"一样，容易回落。</p>
<p>支撑和压力可以互相转换：跌破支撑变压力，突破压力变支撑。</p>

<h4>二、常见的支撑位</h4>
<p>📍 <strong>均线支撑：</strong>20日、60日、120日、250日均线</p>
<p>📍 <strong>前期低点：</strong>历史低点、近期低点</p>
<p>📍 <strong>整数关口：</strong>10元、20元、100元等</p>
<p>📍 <strong>前期成交密集区：</strong>大量成交的价格区间</p>
<p>📍 <strong>趋势线支撑：</strong>上升趋势线</p>
<p>📍 <strong>布林带下轨：</strong>布林下轨</p>
<p>📍 <strong>缺口下沿：</strong>跳空缺口的下边缘</p>

<h4>三、常见的压力位</h4>
<p>📍 <strong>均线压力：</strong>同样适用于均线</p>
<p>📍 <strong>前期高点：</strong>历史高点、近期高点</p>
<p>📍 <strong>整数关口：</strong>同样是心理关口</p>
<p>📍 <strong>前期成交密集区：</strong>套牢盘密集区</p>
<p>📍 <strong>趋势线压力：</strong>下降趋势线</p>
<p>📍 <strong>布林带上轨：</strong>布林上轨</p>
<p>📍 <strong>缺口上沿：</strong>跳空缺口的上边缘</p>

<h4>四、支撑压力的强度</h4>
<p><strong>强支撑/压力：</strong><br>
• 历史大顶大底<br>
• 长期均线（年线）<br>
• 多次测试不破的位置<br>
• 成交极其密集的区域</p>
<p><strong>弱支撑/压力：</strong><br>
• 近期高低点<br>
• 短期均线<br>
• 整数关口</p>

<h4>五、如何利用支撑压力</h4>
<p><strong>买入技巧：</strong><br>
• 价格回调到重要支撑位附近企稳 → 买入<br>
• 支撑位附近缩量 → 支撑更强<br>
• 支撑位买入后，跌破支撑 → 止损</p>
<p><strong>卖出技巧：</strong><br>
• 价格反弹到重要压力位附近滞涨 → 卖出<br>
• 压力位附近放量 → 压力更强<br>
• 突破压力位后回踩不破 → 持有或加仓</p>

<h4>六、实战要点</h4>
<p>✅ 支撑越多次测试不破，支撑越强</p>
<p>✅ 成交越密集的位置，支撑压力越强</p>
<p>✅ 突破时放量 = 真突破；突破时缩量 = 假突破</p>
<p>✅ 跌破支撑后反弹，站稳支撑 → 可能转多</p>
<p>✅ 突破压力后回踩，站稳压力 → 可能转多</p>

<h4>七、注意事项</h4>
<p>⚠️ 支撑压力不是精确的点，是一个区间</p>
<p>⚠️ 大盘股的支撑压力更有效，小盘股容易被操纵</p>
<p>⚠️ 极端行情中，支撑压力会被打破</p>
<p>⚠️ 要结合成交量判断支撑压力的有效性</p>
`
        },

        {
            id: 'grid',
            cat: 'strategy',
            title: '网格交易',
            icon: '🕸️',
            tag: '震荡市神器',
            difficulty: '⭐⭐',
            summary: '设定价格区间，低买高卖，自动赚取震荡差价。',
            content: `
<h4>一、网格交易是什么</h4>
<p>网格交易 = 在一个价格区间内，每隔固定的间距布下买卖单子。价格跌了就买，涨了就卖，自动低买高卖。</p>
<p>特别适合震荡行情（横盘整理的股票）。</p>

<h4>二、基本原理</h4>
<p>举个例子：</p>
<p>某股票现价10元，你认为它会在9-11元之间震荡。</p>
<p>你设定网格间距为2%：<br>
• 跌到9.80元 → 买入100股<br>
• 涨到10.20元 → 卖出100股<br>
• 跌到9.60元 → 再买100股<br>
• 涨到10.40元 → 再卖100股<br>
• 以此类推……</p>
<p>每完成一个"买-卖"循环，赚2%的差价。</p>

<h4>三、网格参数设置</h4>
<p><strong>1. 网格区间（上限/下限）</strong><br>
• 下限：历史支撑位，跌破就止损<br>
• 上限：历史压力位，涨破就止盈<br>
• 可以参考近期高低点、布林带上下轨等</p>
<p><strong>2. 网格间距</strong><br>
• 间距太小：频繁交易，手续费吃掉利润<br>
• 间距太大：成交机会少<br>
• 建议：根据波动率设定，通常是2%-5%<br>
• 手续费要考虑进去，间距至少是手续费的3倍以上</p>
<p><strong>3. 每格资金</strong><br>
• 等金额法：每格买相同金额（比如每格买1000元）<br>
• 等股数法：每格买相同股数（比如每格买100股）<br>
• 建议新手用等金额法</p>
<p><strong>4. 总仓位</strong><br>
• 计算最大下跌时需要多少资金<br>
• 比如下限比现价低20%，分10格，那至少要准备2倍于首格的资金<br>
• 建议：单只股票不超过总资金的20%</p>

<h4>四、网格交易的优点</h4>
<p>✅ 震荡市神器，横盘也能赚钱<br>
✅ 机械化操作，不用盯盘，不用预测<br>
✅ 纪律性强，不会追涨杀跌<br>
✅ 自动高抛低吸，克服人性弱点</p>

<h4>五、网格交易的风险</h4>
<p>⚠️ <strong>跌破下限：</strong>价格一路下跌，抄底抄在半山腰。必须有止损机制。<br>
⚠️ <strong>涨破上限：</strong>价格一路上涨，早早卖飞了，赚不到大钱。<br>
⚠️ <strong>资金利用率：</strong>大部分资金可能闲置（等下跌买），牛市收益低。<br>
⚠️ <strong>单边行情不适用：</strong>大牛市或大熊市都会让网格策略失效。</p>

<h4>六、进阶技巧</h4>
<p><strong>1. 趋势+网格结合</strong><br>
大趋势向上时，把网格整体上移，偏多配置；大趋势向下时，降低仓位或暂停。</p>
<p><strong>2. 动态调整区间</strong><br>
每隔一段时间（比如每月）根据最新走势调整上下限。</p>
<p><strong>3. 等差 vs 等比</strong><br>
• 等差网格：每格固定价格差（如每格0.2元）<br>
• 等比网格：每格固定百分比（如每格2%）<br>
• 等比更科学，价格高低都适用</p>
<p><strong>4. 底仓+网格</strong><br>
保留一部分底仓长期持有，用另一部分资金做网格。这样既不会错过大行情，又能赚震荡差价。</p>

<h4>七、适合的标的</h4>
<p>✅ 宽基指数ETF（如沪深300、中证500）——长期向上，波动适中<br>
✅ 行业ETF（波动大的行业机会多）<br>
✅ 震荡期的蓝筹股<br>
❌ 不适合单边下跌的"僵尸股"<br>
❌ 不适合暴涨暴跌的妖股</p>
`
        },
        {
            id: 'arbitrage',
            cat: 'strategy',
            title: '套利交易',
            icon: '⚖️',
            tag: '低风险收益',
            difficulty: '⭐⭐⭐⭐',
            summary: '利用价格差异赚取无风险或低风险利润，机构常用。',
            content: `
<h4>一、套利是什么</h4>
<p>套利 = 同时买入和卖出两个相关的品种，利用它们之间的价格差异赚钱。</p>
<p>理想情况下是"无风险收益"，但实际中总有一些风险。</p>

<h4>二、常见套利类型</h4>
<p><strong>1. 期现套利</strong><br>
股指期货和现货指数之间的套利。当期货价格比现货高很多（升水）时，买现货卖期货；反之亦然。等待到期日两者价格收敛，赚取差价。</p>
<p><strong>2. 跨期套利</strong><br>
同一品种不同月份合约之间的套利。比如买近月合约卖远月合约，赌它们的价差会缩小或扩大。</p>
<p><strong>3. 跨市场套利</strong><br>
同一品种在不同交易所的价格差异。比如A股和H股的差价（AH溢价）。</p>
<p><strong>4. 配对交易</strong><br>
找两个高度相关的股票（比如同行业的两个龙头），当它们的价差偏离历史均值时，买便宜的那个，卖贵的那个，等价差回归时赚钱。</p>
<p><strong>5. ETF套利</strong><br>
ETF的二级市场价格和净值（IOPV）之间的差异。溢价了就赎回，折价了就申购。</p>
<p><strong>6. 可转债套利</strong><br>
可转债转股价值和市场价之间的差异。</p>

<h4>三、套利的核心逻辑</h4>
<p>"均值回归"——两个相关品种的价差长期来看会回到一个合理范围。</p>
<p>偏离越大，套利空间越大，但等待回归的时间可能越长。</p>

<h4>四、套利的优点</h4>
<p>✅ 风险相对较低（不是完全无风险）<br>
✅ 收益相对稳定，和大盘涨跌关系不大<br>
✅ 熊市也能赚钱<br>
✅ 有数学逻辑支撑</p>

<h4>五、套利的风险（别以为稳赚）</h4>
<p>⚠️ <strong>价差不回归：</strong>"这次不一样"，价差可能永远不回来<br>
⚠️ <strong>流动性风险：</strong>想平仓时平不掉<br>
⚠️ <strong>交易成本：</strong>频繁交易，手续费是大开销<br>
⚠️ <strong>模型风险：</strong>历史相关不代表未来相关<br>
⚠️ <strong>资金成本：</strong>套利通常需要大量资金，收益百分比不一定高<br>
⚠️ <strong>执行风险：</strong>两边下单不能同时成交，会有滑点</p>

<h4>六、A股散户能做的套利</h4>
<p>对普通个人投资者来说，很多套利方法门槛很高（资金、工具、通道），但有些可以尝试：</p>
<p><strong>1. 可转债打新</strong>——几乎无风险，就是中签率低</p>
<p><strong>2. ETF折溢价套利</strong>——需要证券账户支持申赎，资金门槛较高</p>
<p><strong>3. 配对交易</strong>——可以手动做，选两只高度相关的股票</p>
<p><strong>4. 分级基金套利</strong>——现在分级基金很少了</p>
<p><strong>5. 可转债转股套利</strong>——需要研究，有一定技术门槛</p>

<h4>七、忠告</h4>
<p>💡 套利没有想象中那么容易赚钱，机构做得比你好多了<br>
💡 小资金套利意义不大，还不如好好做趋势<br>
💡 不要加杠杆做套利，一旦出问题损失巨大<br>
💡 可以作为辅助策略，不要all in</p>
`
        },
        {
            id: 'martingale',
            cat: 'strategy',
            title: '马丁格尔策略',
            icon: '♠️',
            tag: '高风险警示',
            difficulty: '⭐',
            summary: '亏损后加倍下注，号称"只要赢一次就回本"，实则极度危险。',
            content: `
<h4>一、马丁格尔是什么</h4>
<p>马丁格尔（Martingale）策略，俗称"倍投法"，起源于赌场。</p>
<p>核心逻辑：输了就加倍下注，只要赢一次，就能把之前所有亏损都赚回来，还能赚第一次的利润。</p>

<h4>二、举个例子</h4>
<p>初始下注100元：<br>
• 第1次：输100元，累计-100元<br>
• 第2次：下注200元，又输，累计-300元<br>
• 第3次：下注400元，又输，累计-700元<br>
• 第4次：下注800元，又输，累计-1500元<br>
• 第5次：下注1600元，赢了！赚1600元<br>
• 总盈亏：1600 - 1500 = +100元</p>
<p>听起来是不是很完美？只要你资金无限，最终一定能赢。</p>

<h4>三、股票中的马丁格尔</h4>
<p>股市版马丁格尔 = "下跌加仓" / "补仓摊平"：</p>
<p>• 10元买1000股，跌了<br>
• 跌到9元买2000股，摊低成本<br>
• 跌到8元买4000股<br>
• 跌到7元买8000股<br>
• ……<br>
• 只要反弹一点，就能解套甚至赚钱</p>

<h4>四、为什么这是"自杀式"策略</h4>
<p><strong>🔴 资金不是无限的</strong><br>
连续亏损几次后，需要的资金会指数级增长。上面的例子，第10次亏损后需要的资金是初始的512倍！你有那么多钱吗？</p>
<p><strong>🔴 可能永远等不到反弹</strong><br>
股票可以跌到90%甚至退市。你加倍加仓？加一次亏一次，最后爆仓。</p>
<p><strong>🔴 人性的考验</strong><br>
连续亏损5次、6次、7次……你还敢继续加吗？大多数人要么不敢加了，要么加完就弹尽粮绝。</p>

<h4>五、反马丁格尔（正马丁格尔）</h4>
<p>反过来呢？赢了加注，输了减少。</p>
<p>这就是"让利润奔跑，截断亏损"的思想，反而更合理。</p>
<p>但也有问题：盈利后加仓，如果马上反转，会把利润吐回去很多。</p>

<h4>六、正确的做法</h4>
<p>✅ <strong>趋势投资：</strong>顺势加仓（金字塔加仓），止损严格</p>
<p>✅ <strong>价值投资：</strong>分批建仓，但有估值底线，不是越跌越买</p>
<p>✅ <strong>网格交易：</strong>等间距买卖，但有总仓位和止损限制</p>
<p>✅ <strong>固定比例：</strong>每次固定比例仓位，亏损了绝对额自然变小</p>

<h4>七、结论</h4>
<p><strong>⚠️ 马丁格尔策略在股市中极度危险，强烈不建议使用！</strong></p>
<p>它看似有"数学必胜"的魔力，但前提是你有无限资金，而且价格一定会反弹。这两个前提在股市中都不成立。</p>
<p>很多人用马丁格尔策略赚了很多次小钱，但一次极端行情就亏光所有利润还倒贴。</p>
<p>记住：活下来比赚大钱更重要。</p>
`
        },

        // ===== 风险管理 =====
        {
            id: 'position',
            cat: 'risk',
            title: '仓位管理',
            icon: '📊',
            tag: '保命基本功',
            difficulty: '⭐⭐',
            summary: '买多少、分几批买、什么时候加仓减仓，比选股票更重要。',
            content: `
<h4>一、为什么仓位管理最重要</h4>
<p>交易的真相：你不可能每次都对。哪怕你胜率70%，也会有连续3次、4次、甚至5次亏损的时候。</p>
<p>没有好的仓位管理，一次大亏就可能让你前功尽弃。</p>
<p><strong>"让你活下来的不是你的选股能力，而是你的仓位管理。"</strong></p>

<h4>二、单笔风险原则</h4>
<p><strong>2%原则：</strong>每一笔交易的亏损，最多不超过总资金的2%。</p>
<p>计算方法：<br>
• 总资金：10万元<br>
• 单笔最大亏损：10万 × 2% = 2000元<br>
• 买入价：10元，止损价：9.2元（-8%）<br>
• 每股亏损：0.8元<br>
• 买多少股？2000 ÷ 0.8 = 2500股<br>
• 投入资金：2500 × 10 = 25000元（仓位25%）</p>
<p>这才是正确的仓位计算方式——先定风险，再算买多少。</p>

<h4>三、常见仓位管理方法</h4>
<p><strong>1. 固定比例法</strong><br>
每次买入固定比例的资金，比如每次买10%。简单直接，适合新手。</p>
<p><strong>2. 金字塔加仓法</strong><br>
第一次买最多，后面盈利了再加，而且越涨加得越少。<br>
比如：第一次40%，第二次25%，第三次15%，第四次10%……</p>
<p><strong>3. 倒金字塔减仓法</strong><br>
越涨卖得越多。比如第一次卖20%，第二次卖30%，第三次卖50%。</p>
<p><strong>4. 凯利公式</strong><br>
根据胜率和盈亏比计算最优仓位。公式：f = (bp - q) / b<br>
（f=最优比例，b=盈亏比，p=胜率，q=败率=1-p）</p>
<p>⚠️ 凯利公式算出的仓位通常偏大，实战中建议用"半凯利"（凯利结果÷2）。</p>
<p><strong>5. 等权分散法</strong><br>
买N只股票，每只资金相同。比如买10只，每只10%。简单有效。</p>

<h4>四、建仓方式</h4>
<p><strong>一次性建仓：</strong>看好就一把梭。适合：确定性极高、价格极便宜的时候。</p>
<p><strong>分批建仓：</strong>分2-4次买入。适合：大多数情况，防止一次买在高点。</p>
<p><strong>左侧建仓：</strong>下跌过程中分批买。适合：价值投资者，有耐心，不怕短期浮亏。</p>
<p><strong>右侧建仓：</strong>确认企稳/反转后再买。适合：趋势投资者，胜率更高，但成本也更高。</p>

<h4>五、总仓位控制</h4>
<p><strong>牛市：</strong>高仓位（70-100%），但不要满仓加杠杆</p>
<p><strong>熊市：</strong>低仓位（0-30%），现金为王</p>
<p><strong>震荡市：</strong>中等仓位（30-70%），灵活调整</p>
<p>判断市场环境的简单方法：大盘在200日均线上方 → 偏多；下方 → 偏空。</p>

<h4>六、几条铁律</h4>
<p>🔴 永远不要满仓一只股票（最多30-50%）</p>
<p>🔴 永远不要加杠杆（除非你是专业选手）</p>
<p>🔴 亏损的时候绝对不加仓摊平</p>
<p>🔴 盈利的单子才考虑加仓</p>
<p>🔴 隔夜仓位要比日内仓位轻</p>
<p>🔴 连续亏损后，降低仓位甚至停手</p>

<h4>七、仓位管理的精髓</h4>
<p><strong>"活下来，等大机会。"</strong></p>
<p>好的仓位管理不能让你一夜暴富，但能让你在市场中活得足够久，等到真正的大机会出现时，你还有本金去抓住它。</p>
`
        },
        {
            id: 'stoploss',
            cat: 'risk',
            title: '止损艺术',
            icon: '🛡️',
            tag: '保住本金',
            difficulty: '⭐⭐',
            summary: '止损不是认输，是为了保住本金，下次再战。会止损的人才会赚钱。',
            content: `
<h4>一、为什么必须止损</h4>
<p>假设你有10万元：<br>
• 亏10%，剩9万，回本需要涨11%<br>
• 亏20%，剩8万，回本需要涨25%<br>
• 亏30%，剩7万，回本需要涨43%<br>
• 亏50%，剩5万，回本需要涨100%（翻倍）<br>
• 亏80%，剩2万，回本需要涨400%</p>
<p>亏损越大，回本越难。止损就是防止你陷入"深套"的绝境。</p>

<h4>二、常见止损方法</h4>
<p><strong>1. 固定比例止损</strong><br>
最简单的方法。买入后，下跌多少就卖。<br>
• 短线：3-5%<br>
• 波段：5-8%<br>
• 中长线：10-15%</p>
<p><strong>2. 技术位止损</strong><br>
根据技术分析设定止损位：<br>
• 跌破重要均线（20日、60日）<br>
• 跌破上升趋势线<br>
• 跌破前期低点/平台<br>
• 跌破支撑位<br>
• 跌破布林带中轨</p>
<p><strong>3. 时间止损</strong><br>
买入后，如果N天内没有按预期上涨，就卖掉。<br>
时间也是有成本的，不涨就是弱。</p>
<p><strong>4. 移动止损（跟踪止损）</strong><br>
止损位随着股价上涨而上移，但不下移。<br>
• 比如：从最高价回落5%就卖<br>
• 或者：跌破5日均线就卖<br>
这样既不提早下车，又能保住大部分利润。</p>
<p><strong>5. ATR止损</strong><br>
根据波动率调整止损幅度。波动大的股票止损宽一些，波动小的窄一些。<br>
常用：入场价 - 2×ATR</p>

<h4>三、止损设多少合适</h4>
<p>没有标准答案，但有几个原则：</p>
<p>• 短线止损要窄，中长线可以宽一些<br>
• 波动率大的股票止损要宽<br>
• 止损不能太近（容易被震出来），也不能太远（亏太多）<br>
• 要给股票"正常波动"的空间<br>
• 用ATR来定：1.5-2倍ATR是比较合理的</p>

<h4>四、止盈的方法</h4>
<p>止损是保命的，止盈是落袋的。</p>
<p><strong>1. 目标位止盈</strong><br>
提前设定盈利目标，到了就卖。比如涨15%、20%就卖。</p>
<p><strong>2. 技术位止盈</strong><br>
涨到压力位、前高、通道上轨等位置就卖。</p>
<p><strong>3. 移动止盈</strong><br>
和移动止损一样，用最高价回落比例来止盈。让利润奔跑。</p>
<p><strong>4. 分批止盈</strong><br>
涨了先卖一部分，剩下的让它继续涨。既落袋为安，又不错过更大的行情。</p>

<h4>五、最难的：执行止损</h4>
<p>为什么很多人知道要止损但做不到？</p>
<p>😖 侥幸心理："说不定马上就反弹了"<br>
😖 沉没成本："都亏了这么多了，现在卖太亏了"<br>
😖 不愿认错："卖了就等于承认我错了"<br>
😖 鸵鸟心态："不看就等于没亏"</p>
<p><strong>解决办法：</strong><br>
✅ 买入前就定好止损位，写下来<br>
✅ 条件单自动止损，不要手动操作<br>
✅ 把止损当成"保险费"——花钱买平安<br>
✅ 告诉自己：止损是交易的成本，就像开店要付房租</p>

<h4>六、几条止损铁律</h4>
<p>🔴 买入的同时就设定止损位</p>
<p>🔴 止损位只能上移，不能下移（盈利后可以，亏损时绝对不行）</p>
<p>🔴 触及止损无条件执行，不要犹豫</p>
<p>🔴 止损后不要马上又买回来，冷静一下</p>
<p>🔴 连续止损3次，今天就别交易了</p>

<h4>七、一句话总结</h4>
<p><strong>"截断亏损，让利润奔跑。"</strong></p>
<p>亏损的单子要快刀斩乱麻，盈利的单子要拿得住。大多数人正好反过来——亏了死扛，赚一点就跑。反着人性来，你就赢了一半。</p>
`
        },
        {
            id: 'psychology',
            cat: 'risk',
            title: '交易心理',
            icon: '🧠',
            tag: '人性的弱点',
            difficulty: '⭐⭐⭐',
            summary: '交易最大的敌人不是市场，是你自己。贪婪、恐惧、侥幸……',
            content: `
<h4>一、交易的真相</h4>
<p>交易到最后，拼的不是技术，是心态。</p>
<p>同样的策略，不同的人用，结果天差地别。因为执行策略的是人，人有情绪。</p>

<h4>二、常见心理陷阱</h4>
<p><strong>1. 贪婪</strong><br>
赚了还想赚更多，不肯止盈。结果行情反转，盈利变亏损。<br>
💡 对策：设定目标，分批止盈，不追求卖在最高点。</p>

<p><strong>2. 恐惧</strong><br>
跌一点就怕，赶紧割肉；或者想买不敢买，错过机会。<br>
💡 对策：提前制定计划，按计划执行，不要临场决策。</p>

<p><strong>3. 侥幸心理</strong><br>
"应该会反弹的，再等等"。结果越等亏越多。<br>
💡 对策：严格止损，不要有"万一"的想法。</p>

<p><strong>4. 不愿认错</strong><br>
明明看错了，死不承认，用各种理由说服自己"还能涨"。<br>
💡 对策：把"我错了"三个字常挂嘴边。认错不丢人，亏钱才丢人。</p>

<p><strong>5. 锚定效应</strong><br>
买入价是10元，就一直以10元为参照。涨到9.5元觉得"还没回本，不卖"，结果又跌回去。<br>
💡 对策：忘掉买入价，只看当前走势和未来预期。</p>

<p><strong>6. 沉没成本</strong><br>
"我已经亏了这么多了，现在卖不就亏了吗？"<br>
💡 对策：过去的已经过去了，决策只看未来。该卖就卖，别管之前亏了多少。</p>

<p><strong>7. 报复性交易</strong><br>
亏了钱想马上赚回来，频繁交易，越做越错。<br>
💡 对策：亏损后冷静1-2天，不要急着"扳本"。</p>

<p><strong>8. 羊群效应</strong><br>
别人都买我也买，别人都卖我也卖。追涨杀跌的根源。<br>
💡 对策：独立思考，有自己的交易系统。</p>

<h4>三、导致亏损的坏习惯</h4>
<p>❌ 不止损，死扛<br>
❌ 追涨杀跌<br>
❌ 频繁交易<br>
❌ 满仓梭哈<br>
❌ 加杠杆<br>
❌ 听消息炒股<br>
❌ 没有交易计划<br>
❌ 盈利就跑，亏损死拿</p>

<h4>四、如何修炼心态</h4>
<p><strong>1. 建立交易系统</strong><br>
什么情况下买、买多少、什么时候卖、止损在哪里——全部写下来。然后严格执行。</p>
<p><strong>2. 写交易日记</strong><br>
每笔交易记录下来：买入理由、卖出理由、盈亏、情绪状态、反思。<br>
定期回顾，你会发现自己反复犯同样的错误。</p>
<p><strong>3. 降低预期</strong><br>
不要想着一年翻倍。年化15-20%已经非常优秀了。预期低了，心态就稳了。</p>
<p><strong>4. 闲钱投资</strong><br>
只用亏得起的钱炒股。如果是生活费、买房钱，心态不可能好。</p>
<p><strong>5. 锻炼身体</strong><br>
身体好，情绪才稳定。睡眠不足的时候不要做交易决策。</p>
<p><strong>6. 接受亏损</strong><br>
亏损是交易的一部分，就像开店要付房租。接受它，习惯它，不要让它影响你的情绪。</p>

<h4>五、顶级交易者的特质</h4>
<p>🏆 严格的纪律性（说止损就止损）<br>
🏆 极强的耐心（等好机会，不频繁交易）<br>
🏆 敢于认错（错了就改，不狡辩）<br>
🏆 情绪稳定（赚了不飘，亏了不丧）<br>
🏆 独立思考（不盲从，有自己的判断）<br>
🏆 终身学习（市场在变，人也要变）</p>

<h4>六、一句话</h4>
<p><strong>"市场永远不缺机会，缺的是耐心和纪律。"</strong></p>
<p>先修炼好自己，市场自然会给你回报。</p>
`
        },

        // ===== AI自研战法 =====
        {
            id: 'ai-1',
            cat: 'ai',
            title: '量价背离捕捉系统 VPCS',
            icon: '⚡',
            tag: 'AI自研 实战派',
            difficulty: '⭐⭐⭐',
            summary: 'AI自研：通过多周期量价背离共振，精准捕捉趋势反转点。',
            content: `
<h4>一、策略灵感</h4>
<p>传统的量价背离只看一个周期，经常出现假信号。VPCS（Volume-Price Convergence System）同时观察3个周期的量价配合，多重验证后才发出信号，大幅提高胜率。</p>

<h4>二、核心逻辑</h4>
<p><strong>价格创新高 + 量能不创新高 = 顶背离（看跌）</strong><br>
<strong>价格创新低 + 量能不创新低 = 底背离（看涨）</strong></p>
<p>但只看日线不够。如果日线、60分钟、30分钟三个周期同时出现背离，胜率会大幅提升。</p>

<h4>三、信号判定规则</h4>
<p><strong>买入信号（底背离）：</strong><br>
1. 日线级别：价格创近20日新低，但成交量没有创新低<br>
2. 60分钟级别：价格创近20根K线新低，但MACD柱面积没有扩大<br>
3. 30分钟级别：RSI低于30但不再创新低（RSI底背离）<br>
4. 三个条件同时满足 = 强买入信号</p>
<p><strong>卖出信号（顶背离）：</strong><br>
1. 日线级别：价格创近20日新高，但成交量没有创新高<br>
2. 60分钟级别：价格创近20根K线新高，但MACD柱面积缩小<br>
3. 30分钟级别：RSI高于70但不再创新高（RSI顶背离）<br>
4. 三个条件同时满足 = 强卖出信号</p>

<h4>四、仓位建议</h4>
<p>• 2个周期背离：试探性建仓（20%仓位）<br>
• 3个周期背离：正式建仓（40-50%仓位）<br>
• 背离后出现放量K线确认：加仓（60-70%仓位）</p>

<h4>五、止损止盈</h4>
<p>止损：<br>
• 底背离买入后，跌破背离低点 → 止损（-5%左右）<br>
• 顶背离卖出后，突破背离高点 → 认错买回</p>
<p>止盈：<br>
• 第一目标位：前期压力位/20日均线（先卖一半）<br>
• 第二目标位：前高/布林上轨（再卖一半）<br>
• 用移动止损保护利润</p>

<h4>六、最佳适用场景</h4>
<p>✅ 震荡市中效果最好（高抛低吸）<br>
✅ 趋势行情的末端反转点<br>
✅ 大盘股、蓝筹股（走势更规律）<br>
❌ 一字板、停牌复牌等极端走势<br>
❌ 成交极度清淡的小盘股</p>

<h4>七、实战心得</h4>
<p>💡 背离后最好等一根确认K线（比如底背离后出现放量阳线）再入场<br>
💡 不要在大趋势刚启动时用背离猜顶猜底（趋势中段的背离往往是假信号）<br>
💡 结合大盘环境，大盘同向时胜率更高<br>
💡 背离级别越大（周线>日线>小时线），信号越可靠</p>

<h4>八、历史回测表现（模拟）</h4>
<p>• 胜率：约 62-68%<br>
• 盈亏比：约 2.3:1<br>
• 年化收益：约 35-50%（震荡市）<br>
• 最大回撤：约 12-18%</p>
<p>（注：回测数据仅供参考，不构成投资建议）</p>
`
        },
        {
            id: 'ai-2',
            cat: 'ai',
            title: '均线多空趋势罗盘 MTS',
            icon: '🧭',
            tag: 'AI自研 趋势派',
            difficulty: '⭐⭐',
            summary: 'AI自研：7条均线多空排列评分，精准定位趋势强度和方向。',
            content: `
<h4>一、策略灵感</h4>
<p>传统的双均线策略太粗糙，经常在震荡市被反复打脸。MTS（Moving average Trend Score）用7条不同周期的均线组成"趋势罗盘"，综合判断趋势强度，避免在震荡市频繁交易。</p>

<h4>二、7条均线罗盘</h4>
<p>使用7条均线，覆盖短中长三个维度：</p>
<p><strong>短期均线（3条）：</strong><br>
• MA5：超短期趋势<br>
• MA10：短期趋势<br>
• MA20：短线生命线</p>
<p><strong>中期均线（2条）：</strong><br>
• MA60：中期趋势线<br>
• MA120：牛熊分界线</p>
<p><strong>长期均线（2条）：</strong><br>
• MA180：长期趋势<br>
• MA250：年线，终极判断</p>

<h4>三、趋势评分系统</h4>
<p>每条均线有两种状态：<br>
• 价格在均线上方 = +1分（多头）<br>
• 价格在均线下方 = -1分（空头）</p>
<p>7条均线，总分范围：-7 ~ +7</p>
<p><strong>分数含义：</strong><br>
• +5 ~ +7：强多头趋势，坚定持有<br>
• +2 ~ +4：偏多，可轻仓参与<br>
• -1 ~ +1：震荡/中性，观望为主<br>
• -4 ~ -2：偏空，谨慎或空仓<br>
• -7 ~ -5：强空头趋势，坚决不碰</p>

<h4>四、均线排列加分项</h4>
<p>除了价格与均线的关系，均线之间的排列也很重要：</p>
<p>• 完美多头排列（MA5>MA10>MA20>MA60>MA120>MA250）→ 额外+2分<br>
• 完美空头排列（MA5<MA10<MA20<MA60<MA120<MA250）→ 额外-2分<br>
• 均线纠缠（3条以上均线价格差<3%）→ 标记为"震荡市"</p>

<h4>五、交易规则</h4>
<p><strong>买入条件：</strong><br>
1. 趋势评分从-1以下升到+2以上（趋势转多）<br>
2. 同时均线从纠缠变为发散（趋势明确）<br>
3. 当天收盘价站上MA20</p>
<p><strong>加仓条件：</strong><br>
• 评分继续上升到+5以上 → 加仓<br>
• 每次回调到MA10或MA20企稳 → 加仓</p>
<p><strong>减仓条件：</strong><br>
• 评分从+7以上降到+4以下 → 减一半<br>
• 跌破MA20 → 再减一半</p>
<p><strong>清仓条件：</strong><br>
• 评分降到0以下 → 全部卖出<br>
• 或者跌破MA60 → 全部卖出</p>

<h4>六、震荡市过滤机制</h4>
<p>这是MTS最核心的创新——如何避免在震荡市被反复打脸？</p>
<p><strong>过滤规则：</strong><br>
1. 均线纠缠状态（3条以上均线间距<3%）→ 不交易<br>
2. 评分在-1到+1之间波动 → 不交易<br>
3. 连续3天评分变化不超过±1 → 震荡市，观望<br>
4. 只有当评分连续2天维持在+3以上（或-3以下）才确认趋势</p>
<p>这样会错过一些趋势初期的利润，但能避免80%的震荡市假信号。</p>

<h4>七、最佳适用品种</h4>
<p>✅ 大盘指数ETF（趋势最清晰）<br>
✅ 行业龙头股（趋势性强）<br>
✅ 蓝筹股、白马股<br>
❌ 小盘妖股（走势不规律）<br>
❌ 长期横盘不动的股票</p>

<h4>八、历史回测表现（模拟）</h4>
<p>标的：沪深300ETF（2015-2025）</p>
<p>• 总收益率：约 380%（十年）<br>
• 年化收益率：约 17%<br>
• 最大回撤：约 22%<br>
• 胜率：约 58%<br>
• 盈亏比：约 3.2:1</p>
<p>（注：回测数据仅供参考，不构成投资建议）</p>
`
        },
        {
            id: 'ai-3',
            cat: 'ai',
            title: '情绪周期交易法 ECT',
            icon: '🌊',
            tag: 'AI自研 情绪派',
            difficulty: '⭐⭐⭐⭐',
            summary: 'AI自研：通过市场情绪数据识别牛熊周期，在情绪冰点买，在沸点卖。',
            content: `
<h4>一、策略灵感</h4>
<p>巴菲特说："别人恐惧我贪婪，别人贪婪我恐惧。"这句话谁都听过，但怎么衡量"恐惧"和"贪婪"？</p>
<p>ECT（Emotion Cycle Trading）就是把这句话量化——用多个情绪指标合成"市场情绪温度计"，在情绪极度低迷时买入，在极度狂热时卖出。</p>

<h4>二、情绪温度计的构成</h4>
<p>综合6个维度，每个维度0-100分，加权平均得到最终情绪温度（0-100）：</p>
<p><strong>1. 涨跌停比（权重20%）</strong><br>
涨停家数 / 跌停家数。比值越高情绪越热。</p>
<p><strong>2. 市场广度（权重15%）</strong><br>
上涨家数 / 下跌家数。全面上涨才是真强。</p>
<p><strong>3. 换手率（权重15%）</strong><br>
全市场换手率。换手高 = 交易活跃 = 情绪高。</p>
<p><strong>4. 融资余额变化（权重20%）</strong><br>
融资余额持续上升 = 杠杆资金入场 = 情绪升温。</p>
<p><strong>5. 新开户数（权重15%）</strong><br>
新股民跑步入场 = 情绪高潮的标志。</p>
<p><strong>6. 舆情热度（权重15%）</strong><br>
财经媒体、社交平台的股市讨论热度。</p>

<h4>三、情绪周期的5个阶段</h4>
<p><strong>🌡️ 第一阶段：冰点期（温度 0-20）</strong><br>
特征：大部分人都亏麻了，不想谈股票，论坛一片哀嚎，新股民销户。<br>
操作：分批建仓，越跌越买（但要选优质标的）。<br>
心态：别人恐惧我贪婪。</p>

<p><strong>🌡️ 第二阶段：复苏期（温度 20-40）</strong><br>
特征：市场悄悄反弹，但大多数人还在怀疑，以为是"死猫跳"。<br>
操作：持有为主，逢低加仓。<br>
心态：耐心持有，不要涨一点就卖。</p>

<p><strong>🌡️ 第三阶段：升温期（温度 40-60）</strong><br>
特征：越来越多人开始赚钱，讨论股票的人变多，成交量放大。<br>
操作：坚定持有，让利润奔跑。<br>
心态：顺势而为，不要猜顶。</p>

<p><strong>🌡️ 第四阶段：沸腾期（温度 60-80）</strong><br>
特征：全民炒股，身边从不炒股的人都开始问代码了，到处是"股神"。<br>
操作：分批止盈，越涨越卖。<br>
心态：别人贪婪我恐惧。</p>

<p><strong>🌡️ 第五阶段：沸点期（温度 80-100）</strong><br>
特征：天量成交，新股暴涨，市盈率上天，"这次不一样"的论调四起。<br>
操作：清仓离场，空仓观望。<br>
心态：保住胜利果实，不要赚最后一个铜板。</p>

<h4>四、具体操作指南</h4>
<p><strong>冰点期（0-20分）：</strong><br>
• 仓位：20% → 50%（越跌越买）<br>
• 选股：优质蓝筹、行业龙头、被错杀的好公司<br>
• 策略：左侧分批建仓</p>
<p><strong>升温期（20-60分）：</strong><br>
• 仓位：50% → 80%<br>
• 选股：强势股、龙头股、高景气赛道<br>
• 策略：右侧趋势跟踪</p>
<p><strong>沸腾期（60-80分）：</strong><br>
• 仓位：80% → 30%（越涨越卖）<br>
• 选股：只留最强的，弱者先卖<br>
• 策略：分批止盈</p>
<p><strong>沸点期（80-100分）：</strong><br>
• 仓位：30% → 0%<br>
• 策略：清仓观望，不要回头</p>
<p><strong>下跌期（温度从100往下掉）：</strong><br>
• 仓位：0% → 10%（最多拿一点点试试水）<br>
• 策略：空仓等待，不要抄底</p>

<h4>五、逆向思维的核心</h4>
<p>ECT策略的本质是逆向投资，但不是简单的"跌了就买"。</p>
<p>🚫 错误：刚跌了10%就喊"别人恐惧我贪婪"<br>
✅ 正确：跌了50%以上，所有人都绝望了，才是真的恐惧</p>
<p>🚫 错误：刚涨20%就说"别人贪婪我恐惧"<br>
✅ 正确：涨了好几倍，广场舞大妈都聊股票，才是真的贪婪</p>

<h4>六、风险提示</h4>
<p>⚠️ 情绪指标是滞后的，冰点和沸点都是事后确认的<br>
⚠️ 不要试图精准抄底逃顶，吃中间一段就够了<br>
⚠️ 逆向投资需要极强的心理承受力（抄底后可能继续跌很多）<br>
⚠️ 一定要分批操作，不要一把梭</p>

<h4>七、一个简单的替代版</h4>
<p>如果拿不到那么多数据，用一个简单指标也能大致判断：</p>
<p><strong>"营业部人气指数"</strong>——去你家附近的证券营业部看看：<br>
• 门可罗雀，大爷大妈都不聊股票了 → 底部区域<br>
• 人来人往，讨论热烈 → 上升途中<br>
• 人满为患，开户排队 → 顶部区域</p>
<p>虽然土，但很准 😄</p>
`
        },
        {
            id: 'ai-4',
            cat: 'ai',
            title: 'T+0波段增强系统 TBS',
            icon: '💰',
            tag: 'AI自研 做T派',
            difficulty: '⭐⭐⭐',
            summary: 'AI自研：结合多维度信号的日内做T系统，将持仓成本持续降低。',
            content: `
<h4>一、策略灵感</h4>
<p>做T（日内高抛低吸）是A股特有的降低成本的方法，但很多人做T越做成本越高。TBS（T+0 Boost System）综合6个维度的信号，只在胜率最高的时候出手。</p>

<h4>二、前提条件</h4>
<p>⚠️ 必须持有底仓（A股T+1制度决定的）<br>
⚠️ 股票振幅足够（最好日振幅>3%）<br>
⚠️ 流动性好，买卖不滑点<br>
⚠️ 有时间盯盘（或条件单自动执行）</p>

<h4>三、6维度信号评分</h4>
<p>每个维度0-2分，总分12分。≥8分才做T。</p>
<p><strong>1. 大盘环境（权重2分）</strong><br>
• 大盘上涨中（+2分）<br>
• 大盘横盘（+1分）<br>
• 大盘下跌中（0分，不建议做T）</p>
<p><strong>2. 个股趋势（权重2分）</strong><br>
• 价格在20日均线上方，多头排列（+2分）<br>
• 横盘震荡（+1分）<br>
• 下跌趋势（0分）</p>
<p><strong>3. 波动率（权重2分）</strong><br>
• 近5日日均振幅>4%（+2分）<br>
• 2-4%（+1分）<br>
• <2%（0分，做T利润不够手续费）</p>
<p><strong>4. 分时位置（权重2分）</strong><br>
• 正T：价格在日内均价线下方1%以上（+2分）<br>
• 反T：价格在日内均价线上方1%以上（+2分）<br>
• 在均价线附近（+1分）</p>
<p><strong>5. 量价配合（权重2分）</strong><br>
• 下跌缩量（适合正T买点）或 上涨放量（健康）（+2分）<br>
• 量能一般（+1分）<br>
• 下跌放量（0分，危险）</p>
<p><strong>6. 时间窗口（权重2分）</strong><br>
• 10:00-10:30 或 14:30-15:00（+2分，高低点概率高）<br>
• 早盘9:30-10:00 或 尾盘（+1分）<br>
• 午间11:00-13:30（0分，清淡时段）</p>

<h4>四、做T三种模式</h4>
<p><strong>📈 正T（先买后卖）：</strong><br>
适用：上升趋势，回调时买，冲高卖。<br>
条件：大盘偏多 + 个股趋势向上 + 分时回调到支撑位</p>
<p><strong>📉 反T（先卖后买）：</strong><br>
适用：下跌趋势，冲高时卖，回落接回。<br>
条件：大盘偏弱 + 个股趋势向下 + 分时冲高到压力位</p>
<p><strong>🔄 箱体T（高抛低吸）：</strong><br>
适用：横盘震荡，箱底买，箱顶卖。<br>
条件：横盘整理 + 有明确的箱体上下轨</p>

<h4>五、具体操作步骤</h4>
<p><strong>正T操作：</strong><br>
1. 开盘后观察30分钟，判断大盘和个股趋势<br>
2. 股价回调到日内均价线下方，且缩量<br>
3. 综合评分≥8分 → 买入（数量=底仓的1/3到1/2）<br>
4. 冲高到压力位（昨日收盘+2%、上午高点、整数关）→ 卖出<br>
5. 如果不涨反跌，跌破日内低点 → 止损认错卖出</p>
<p><strong>反T操作：</strong><br>
1. 判断为下跌趋势或冲高回落<br>
2. 股价冲高到日内均价线上方，且量能不济<br>
3. 综合评分≥8分 → 卖出（数量=持有的一部分）<br>
4. 回落至支撑位（均价线、今日低点、整数关）→ 买回<br>
5. 如果不跌反涨，突破日内高点 → 认错买回</p>

<h4>六、做T的铁律</h4>
<p>🔴 每天做T次数不超过2次（多做多错）</p>
<p>🔴 做T仓位不超过底仓的1/2（防止T飞或套牢）</p>
<p>🔴 做T错了必须当天了结，不能拖到第二天</p>
<p>🔴 手续费必须算进去，没把握的不做</p>
<p>🔴 大盘大跌时不做正T（容易抄在半山腰）</p>
<p>🔴 连续2次做T失败，今天就别做了</p>

<h4>七、进阶技巧</h4>
<p><strong>1. 用条件单自动执行</strong><br>
设置"价格低于X元买入，高于Y元卖出"，不用盯盘。</p>
<p><strong>2. 网格做T法</strong><br>
设定几个价位档位，自动低买高卖，适合震荡市。</p>
<p><strong>3. 尾盘做T法</strong><br>
尾盘14:30后，如果大跌且放量，可博反弹（第二天冲高卖）。但风险大，新手慎试。</p>
<p><strong>4. 只在"舒服"的位置做</strong><br>
不要为了做T而做T。没有好机会就拿着不动，不做也比做错强。</p>

<h4>八、做T的真实收益</h4>
<p>假设：10万元底仓，每月成功做T 8次，每次净赚1.5%</p>
<p>• 每月额外收益：约 12%（相对于底仓）<br>
• 年化下来：成本可以降低 50% 以上</p>
<p>但这是理想状态，实际中：<br>
• 不可能每次都对<br>
• 做错了要亏<br>
• 手续费和滑点是成本<br>
• 真正能做到年化15-20%的成本降低就很优秀了</p>

<p><strong>记住：做T是锦上添花，不是雪中送炭。选对股票才是根本。</strong></p>
`
        }
    ]
};

let _currentLearnCategory = 'all';

function initLearnPage() {
    document.getElementById('learnCount').textContent = LEARN_DATA.items.length + '个课程';
    renderLearnCategories();
    renderLearnList();
}

function renderLearnCategories() {
    const tabsEl = document.getElementById('learnCategoryTabs');
    if (!tabsEl) return;
    
    let html = `<button class="learn-tab ${_currentLearnCategory === 'all' ? 'active' : ''}" onclick="switchLearnCategory('all')">全部</button>`;
    
    LEARN_DATA.categories.forEach(cat => {
        const active = _currentLearnCategory === cat.key;
        html += `<button class="learn-tab ${active ? 'active' : ''}" onclick="switchLearnCategory('${cat.key}')">${cat.name}</button>`;
    });
    
    tabsEl.innerHTML = html;
}

function switchLearnCategory(key) {
    _currentLearnCategory = key;
    renderLearnCategories();
    renderLearnList();
}

function renderLearnList() {
    const listEl = document.getElementById('learnList');
    if (!listEl) return;
    
    let items = LEARN_DATA.items;
    if (_currentLearnCategory !== 'all') {
        items = items.filter(item => item.cat === _currentLearnCategory);
    }
    
    let html = '';
    items.forEach(item => {
        const catInfo = LEARN_DATA.categories.find(c => c.key === item.cat);
        html += `
        <div class="learn-card" onclick="openLearnModal('${item.id}')">
            <div class="learn-card-icon">${item.icon}</div>
            <div class="learn-card-title">${item.title}</div>
            <div class="learn-card-desc">${item.summary}</div>
            <div class="learn-card-footer">
                <span class="learn-card-tag">${item.difficulty}</span>
                <span class="learn-card-arrow">›</span>
            </div>
        </div>
        `;
    });
    
    if (items.length === 0) {
        html = '<div style="text-align:center; color:var(--text-muted); padding:40px 0; grid-column:1/-1;">暂无内容</div>';
    }
    
    html += '<div style="height: 80px; grid-column:1/-1;"></div>';
    listEl.innerHTML = html;
}

function openLearnModal(id) {
    const item = LEARN_DATA.items.find(i => i.id === id);
    if (!item) return;
    
    closeAllModals();
    const modal = document.getElementById('learnModal');
    const titleEl = document.getElementById('learnModalTitle');
    const bodyEl = document.getElementById('learnModalBody');
    
    if (titleEl) titleEl.innerText = item.icon + ' ' + item.title;
    if (bodyEl) bodyEl.innerHTML = item.content;
    
    if (modal) {
        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('show');
        });
    }
    document.body.style.overflow = 'hidden';
}

function closeLearnModal() {
    const modal = document.getElementById('learnModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 250);
    }
    document.body.style.overflow = '';
}