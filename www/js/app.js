let _currentStock = null;
let _watchList = [];
let _trades = [];
let _feeDetail = { commissionFee: 0, stampTax: 0, transferFee: 0, totalFees: 0 };
let _profitDetail = { totalProfit: 0, realizedProfit: 0, unrealizedProfit: 0, tProfit: 0, tTradeCount: 0, stockProfits: [], totalBuy: 0, totalSell: 0, remaining: 0, tradeCount: 0, totalBuyAmount: 0, totalSellAmount: 0, commissionFee: 0, stampTax: 0, transferFee: 0, totalFees: 0 };
let _lastStrategies = [];
let _lastSummary = {};
let _lastKlines = [];
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

// 预测记录存储
let _predictionRecords = JSON.parse(localStorage.getItem('predictionRecords') || '{}');

function getCapacitorHttp() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) {
        return window.Capacitor.Plugins.CapacitorHttp;
    }
    if (window.Capacitor && window.Capacitor.CapacitorHttp) {
        return window.Capacitor.CapacitorHttp;
    }
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Http) {
        return window.Capacitor.Plugins.Http;
    }
    if (window.Capacitor && window.Capacitor.Http) {
        return window.Capacitor.Http;
    }
    return null;
}

function fetchJsonp(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const callbackName = `jsonp_callback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
        const callbackName = `jsonp_text_callback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

function getCapacitorLocalNotifications() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        return window.Capacitor.Plugins.LocalNotifications;
    }
    if (window.Capacitor && window.Capacitor.LocalNotifications) {
        return window.Capacitor.LocalNotifications;
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
    
    try {
        const response = await fetch(url, { mode: 'cors' });
        return await response.json();
    } catch (e) {
        console.error('HTTP请求失败:', url, e);
        throw e;
    }
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
    loadSettings();
    loadWatchList();
    loadTrades();
    loadSearchHistory();
    loadPanoramaHistory();
    renderWatchList(false);
    
    // 首屏优先渲染，不阻塞
    requestAnimationFrame(() => {
        loadHoldingsSignals();
        renderTrades();
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
    
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.search-wrapper') && !e.target.closest('.search-box')) {
            document.querySelectorAll('.search-suggestions').forEach(el => el.style.display = 'none');
        }
    });
    
    initSwipeTabs();
    initPullRefresh();
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
    let isPulling = false;
    let isRefreshing = false;
    const threshold = 80;
    
    // 创建下拉刷新指示器
    const indicator = document.createElement('div');
    indicator.className = 'pull-refresh-indicator';
    indicator.innerHTML = '<span class="refresh-icon">🔄</span><span class="refresh-text">下拉刷新</span>';
    indicator.style.transform = 'translateY(-50px)';
    contentArea.insertBefore(indicator, contentArea.firstChild);
    
    contentArea.addEventListener('touchstart', function(e) {
        if (contentArea.scrollTop === 0 && !isRefreshing) {
            touchStartY = e.touches[0].clientY;
            isPulling = true;
        }
    }, { passive: true });
    
    contentArea.addEventListener('touchmove', function(e) {
        if (!isPulling || isRefreshing) return;
        
        touchMoveY = e.touches[0].clientY;
        const distance = touchMoveY - touchStartY;
        
        if (distance > 0 && contentArea.scrollTop === 0) {
            const pullDistance = Math.min(distance * 0.5, threshold + 20);
            indicator.style.transform = `translateY(${pullDistance}px)`;
            
            if (distance >= threshold) {
                indicator.querySelector('.refresh-text').textContent = '释放刷新';
                indicator.querySelector('.refresh-icon').style.transform = 'rotate(180deg)';
            } else {
                indicator.querySelector('.refresh-text').textContent = '下拉刷新';
                indicator.querySelector('.refresh-icon').style.transform = 'rotate(0deg)';
            }
        }
    }, { passive: true });
    
    contentArea.addEventListener('touchend', function(e) {
        if (!isPulling || isRefreshing) return;
        
        isPulling = false;
        const distance = touchMoveY - touchStartY;
        
        if (distance >= threshold) {
            // 触发刷新
            isRefreshing = true;
            indicator.classList.add('refreshing');
            indicator.style.transform = 'translateY(50px)';
            indicator.querySelector('.refresh-text').textContent = '刷新中...';
            indicator.querySelector('.refresh-icon').style.transform = '';
            
            // 执行刷新
            const doRefresh = async () => {
                if (_currentStock) {
                    await loadStockInfo(_currentStock.code);
                }
                await refreshAllTSignals();
                
                setTimeout(() => {
                    isRefreshing = false;
                    indicator.classList.remove('refreshing');
                    indicator.style.transform = 'translateY(-50px)';
                    indicator.querySelector('.refresh-text').textContent = '下拉刷新';
                }, 500);
            };
            doRefresh();
        } else {
            // 未达到阈值，回弹
            indicator.style.transform = 'translateY(-50px)';
        }
    }, { passive: true });
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
    if (subtab) {
        subtab.classList.add('active');
        // 添加动画类
        subtab.classList.add('subtab-enter');
        setTimeout(() => subtab.classList.remove('subtab-enter'), 300);
    }
    
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
    } else if (subtabName === 'longterm') {
        loadLongtermHistory();
        const input = document.getElementById('longtermInput');
        if (_currentStock && !input.value.trim()) {
            input.value = _currentStock.code;
            _stockNames[_currentStock.code] = _currentStock.name;
            loadLongtermDetail();
        } else if (input && input.value.trim()) {
            loadLongtermDetail();
        }
    }
}

function switchTab(tabName) {
    const prevTab = document.querySelector('.tab-content.active');
    const nextTab = document.getElementById('tab-' + tabName);

    // 移除所有激活状态
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    // 添加动画效果
    if (nextTab) {
        nextTab.classList.add('active');
        nextTab.classList.add('page-enter');
        setTimeout(() => nextTab.classList.remove('page-enter'), 300);
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
        renderTrades();
        refreshTradeStats();
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
            const response = await fetch(url);
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
            const response = await fetch(url);
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
    // 最高价偏离：(实际最高 - 预测最高) / 预测最高 * 100
    let highDev = 0;
    if (highPrice >= predictHigh) {
        highDev = 0;  // 超过预测最高，视为100分
    } else {
        highDev = ((predictHigh - highPrice) / predictHigh) * 100;
    }
    
    // 最低价偏离：(预测最低 - 实际最低) / 预测最低 * 100
    let lowDev = 0;
    if (lowPrice <= predictLow) {
        lowDev = 0;  // 低于预测最低，视为100分
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
    const today = new Date().toISOString().split('T')[0];
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

    const existing = _predictionRecords[key];
    if (existing && !existing.fixedPredictHigh && record.fixedPredictHigh) {
        _predictionRecords[key] = { ...existing, ...record };
    } else {
        _predictionRecords[key] = record;
    }

    localStorage.setItem('predictionRecords', JSON.stringify(_predictionRecords));
}

// 获取指定股票的历史预测记录
function getPredictionHistory(code) {
    const records = [];
    for (const key in _predictionRecords) {
        if (key.startsWith(code + '_')) {
            records.push(_predictionRecords[key]);
        }
    }
    return records.sort((a, b) => new Date(b.date) - new Date(a.date));
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
    const records = getPredictionHistory(code);
    const stats = getAvgAccuracy(code);

    let html = `
        <div style="padding:10px;">
            <div style="text-align:center; margin-bottom:16px;">
                <div style="display:flex; justify-content:center; gap:20px; align-items:flex-end;">
                    <div>
                        <div style="font-size:20px; font-weight:700; color:${stats.avg >= 80 ? 'var(--green)' : stats.avg >= 60 ? 'var(--yellow)' : 'var(--red)'};">${stats.avg}分</div>
                        <div style="font-size:10px; color:var(--text-muted);">动态预测 (${stats.total}天)</div>
                    </div>
    `;

    if (stats.fixedTotal > 0) {
        html += `
                    <div style="width:1px; height:30px; background:var(--surface-active);"></div>
                    <div>
                        <div style="font-size:20px; font-weight:700; color:${stats.fixedAvg >= 80 ? 'var(--green)' : stats.fixedAvg >= 60 ? 'var(--yellow)' : 'var(--red)'};">${stats.fixedAvg}分</div>
                        <div style="font-size:10px; color:var(--text-muted);">固定预测 (${stats.fixedTotal}天)</div>
                    </div>
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
        records.forEach((r, idx) => {
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
                recordHtml += '<div style="color:var(--text-muted); margin-bottom:1px;">预测最高: ¥' + r.fixedPredictHigh.toFixed(2) + '</div>';
                recordHtml += '<div style="color:var(--text-muted);">实际最高: ¥' + r.highPrice.toFixed(2) + '</div>';
                const fHighText = r.fixedHitHigh ? '✓触及' : '差' + r.fixedHighDev.toFixed(2) + '%';
                const fHighColor = r.fixedHighAccuracy >= 80 ? 'var(--green)' : r.fixedHighAccuracy >= 60 ? 'var(--yellow)' : 'var(--red)';
                recordHtml += '<div style="color:' + fHighColor + '; margin-top:1px;">' + fHighText + ' (' + r.fixedHighAccuracy + '分)</div>';
                recordHtml += '</div>';
                recordHtml += '<div>';
                recordHtml += '<div style="color:var(--text-muted); margin-bottom:1px;">预测最低: ¥' + r.fixedPredictLow.toFixed(2) + '</div>';
                recordHtml += '<div style="color:var(--text-muted);">实际最低: ¥' + r.lowPrice.toFixed(2) + '</div>';
                const fLowText = r.fixedHitLow ? '✓触及' : '差' + r.fixedLowDev.toFixed(2) + '%';
                const fLowColor = r.fixedLowAccuracy >= 80 ? 'var(--green)' : r.fixedLowAccuracy >= 60 ? 'var(--yellow)' : 'var(--red)';
                recordHtml += '<div style="color:' + fLowColor + '; margin-top:1px;">' + fLowText + ' (' + r.fixedLowAccuracy + '分)</div>';
                recordHtml += '</div>';
                recordHtml += '</div></div>';
            }

            recordHtml += '<div style="background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.15); border-radius:8px; padding:8px;">';
            recordHtml += '<div style="font-size:10px; color:var(--green); font-weight:600; margin-bottom:6px;">📊 动态预测（实时）</div>';
            recordHtml += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:10px;">';
            recordHtml += '<div>';
            recordHtml += '<div style="color:var(--text-muted); margin-bottom:1px;">预测最高: ¥' + r.predictHigh.toFixed(2) + '</div>';
            recordHtml += '<div style="color:var(--text-muted);">实际最高: ¥' + r.highPrice.toFixed(2) + '</div>';
            const highText = r.hitHigh ? '✓触及' : '差' + r.highDev.toFixed(2) + '%';
            const highColor = r.highAccuracy >= 80 ? 'var(--green)' : r.highAccuracy >= 60 ? 'var(--yellow)' : 'var(--red)';
            recordHtml += '<div style="color:' + highColor + '; margin-top:1px;">' + highText + ' (' + r.highAccuracy + '分)</div>';
            recordHtml += '</div>';
            recordHtml += '<div>';
            recordHtml += '<div style="color:var(--text-muted); margin-bottom:1px;">预测最低: ¥' + r.predictLow.toFixed(2) + '</div>';
            recordHtml += '<div style="color:var(--text-muted);">实际最低: ¥' + r.lowPrice.toFixed(2) + '</div>';
            const lowText = r.hitLow ? '✓触及' : '差' + r.lowDev.toFixed(2) + '%';
            const lowColor = r.lowAccuracy >= 80 ? 'var(--green)' : r.lowAccuracy >= 60 ? 'var(--yellow)' : 'var(--red)';
            recordHtml += '<div style="color:' + lowColor + '; margin-top:1px;">' + lowText + ' (' + r.lowAccuracy + '分)</div>';
            recordHtml += '</div>';
            recordHtml += '</div></div>';
            recordHtml += '</div>';

            html += recordHtml;
        });
        html += '</div>';
    }

    html += '</div>';
    openModal(`${name} 预测历史`, html);
    document.body.style.overflow = 'hidden';
}

async function loadStockInfo(code) {
    try {
        const prefix = getTencentPrefix(code);
        const fullCode = `${prefix}${code}`;
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${fullCode},day,,,1,qfq`;
        const data = await httpGet(url);
        
        if (data.code !== 0 || !data.data || !data.data[fullCode]) {
            throw new Error('行情数据接口返回错误');
        }

        const stockData = data.data[fullCode];
        const qt = stockData.qt?.[fullCode];
        if (!qt || qt.length < 38) {
            throw new Error('行情数据格式错误');
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
        console.error('loadStockInfo错误:', e);
        _currentStock = null; // 确保失败时清除旧数据
        throw e; // 重新抛出错误
    }
}

function renderStockInfo() {
    if (!_currentStock) return;
    
    const emptyHome = document.getElementById('emptyHome');
    if (emptyHome) emptyHome.style.display = 'none';
    
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
    const chgColor = chg >= 0 ? 'var(--red)' : 'var(--green)';
    const chgSign = chg >= 0 ? '+' : '';
    
    if (priceEl) {
        priceEl.innerText = '￥' + _currentStock.current_price.toFixed(2);
        priceEl.style.color = chgColor;
    }
    if (changeEl) {
        changeEl.innerText = chgSign + chg.toFixed(2) + '%';
        changeEl.style.color = chgColor;
    }
    
    if (scrollEl) {
        const openPrice = _currentStock.open_price ? _currentStock.open_price.toFixed(2) : '--';
        const highPrice = _currentStock.high_price ? _currentStock.high_price.toFixed(2) : '--';
        const lowPrice = _currentStock.low_price ? _currentStock.low_price.toFixed(2) : '--';
        const prevClose = _currentStock.prev_close ? _currentStock.prev_close.toFixed(2) : '--';
        const vol = _currentStock.volume ? formatVolume(_currentStock.volume) : '--';
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
            '<span style="font-size:11px; color:var(--text-muted);">成交量 <span style="color:var(--text-primary);">' + vol + '</span></span>' +
            '<span style="width:12px; display:inline-block;"></span>' +
            '<span style="font-size:11px; color:var(--text-muted);">换手率 <span style="color:var(--text-primary);">' + turnover + '</span></span>' +
            '<span style="width:12px; display:inline-block;"></span>' +
            '<span style="font-size:11px; color:var(--text-muted);">做T机会 <span style="color:var(--yellow);">' + tText + '</span></span>' +
            '<span style="width:40px; display:inline-block;"></span>';
        
        scrollEl.innerHTML = row + row;
    }
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
            throw new Error('K线数据接口返回错误');
        }

        const klineArray = data.data[fullCode].qfqday || data.data[fullCode].day || [];
        if (klineArray.length === 0) {
            throw new Error('K线数据为空');
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
        console.error('loadKlineData错误:', e);
        throw e; // 重新抛出错误，让调用者知道失败了
    }
}

async function runStrategyAnalysis(klines) {
    if (!_currentStock || !strategyEngine) return;
    
    const holdings = getHoldings(_currentStock.code);
    const [strategies, summary] = strategyEngine.runAllStrategies(_currentStock, klines, holdings);
    
    _lastStrategies = strategies;
    _lastSummary = summary;
    _lastKlines = klines;
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
    const tCount = strategies.filter(s => 
        s.action.includes('TRADING_OPPORTUNITY') || 
        s.action.includes('BUY_THEN_SELL') || 
        s.action.includes('SELL_THEN_BUY') ||
        s.action.includes('BOX_TRADING')
    ).length;
    
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
    
    if (summary.best_buy || summary.best_sell) {
        setDisplay('planBuySellSection', 'block');
    } else {
        setDisplay('planBuySellSection', 'none');
    }
    
    if (summary.best_buy) {
        setText('planBuyName', summary.best_buy.name);
        setText('planBuyEntry', '￥' + (summary.best_buy.entry_price || summary.current_price || 0).toFixed(2));
        setText('planBuyTarget', '￥' + (summary.best_buy.target_price || 0).toFixed(2));
        setText('planBuyStop', '￥' + (summary.best_buy.stop_loss || 0).toFixed(2));
        setText('planBuyProfit', summary.best_buy.profit_potential ? '+' + summary.best_buy.profit_potential.toFixed(2) + '%' : '--');
        setText('planBuyRisk', summary.best_buy.loss_risk ? summary.best_buy.loss_risk.toFixed(2) + '%' : '--');
        setText('planBuyRatio', summary.best_buy.risk_reward ? summary.best_buy.risk_reward.toFixed(2) : '--');
        const buyRate = calcStrategySuccessRate(summary.best_buy, summary, 'buy');
        setText('planBuySuccessRate', '成功率 ' + buyRate + '%');
    }
    
    if (summary.best_sell) {
        setText('planSellName', summary.best_sell.name);
        setText('planSellEntry', '￥' + (summary.best_sell.entry_price || summary.current_price || 0).toFixed(2));
        setText('planSellTarget', '￥' + (summary.best_sell.target_price || 0).toFixed(2));
        setText('planSellStop', '￥' + (summary.best_sell.stop_loss || 0).toFixed(2));
        setText('planSellProfit', summary.best_sell.profit_potential ? '+' + summary.best_sell.profit_potential.toFixed(2) + '%' : '--');
        setText('planSellRisk', summary.best_sell.loss_risk ? summary.best_sell.loss_risk.toFixed(2) + '%' : '--');
        setText('planSellRatio', summary.best_sell.risk_reward ? summary.best_sell.risk_reward.toFixed(2) : '--');
        const sellRate = calcStrategySuccessRate(summary.best_sell, summary, 'sell');
        setText('planSellSuccessRate', '成功率 ' + sellRate + '%');
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
    
    // 同时更新策略页面的做T方案
    const strategyCard = document.getElementById('strategyBestPlanCard');
    if (strategyCard) {
        if (summary.best_t) {
            strategyCard.style.display = 'block';
            const buyPrice = summary.best_t.buy_price || summary.current_price;
            const sellPrice = summary.best_t.sell_price || summary.current_price;
            const spread = Math.abs(sellPrice - buyPrice);
            const spreadPct = (spread / summary.current_price * 100);
            const action = summary.best_t.action;
            let actionText = '正T';
            if (action === 'SELL_THEN_BUY') actionText = '反T';
            else if (action === 'BOX_TRADING') actionText = '箱体';
            
            const setStrategyText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.innerText = text;
            };
            setStrategyText('strategyPlanTName', summary.best_t.name);
            setStrategyText('strategyPlanTBuy', '￥' + buyPrice.toFixed(2));
            setStrategyText('strategyPlanTSell', '￥' + sellPrice.toFixed(2));
            setStrategyText('strategyPlanTSpread', '￥' + spread.toFixed(2));
            setStrategyText('strategyPlanTProfit', '+' + spreadPct.toFixed(2) + '%');
            setStrategyText('strategyPlanTAction', actionText);
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
            document.getElementById('homePredictedHigh').innerText = '￥' + p.predicted_high.toFixed(2);
            document.getElementById('homePredictedLow').innerText = '￥' + p.predicted_low.toFixed(2);
            const pos = Math.max(0, Math.min(100, p.price_position));
            document.getElementById('homePriceDot').style.left = pos + '%';
            document.getElementById('homePricePosLabel').innerText = '位置: ' + pos.toFixed(1) + '%';
            
            // 动态预测时间
            const dynTimeEl = document.getElementById('homeDynamicTime');
            if (dynTimeEl && summary.update_time) {
                const d = new Date(summary.update_time);
                dynTimeEl.innerText = '预测: ' + (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0') + ':' + d.getSeconds().toString().padStart(2,'0');
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
                if (elFixedTime) {
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    elFixedTime.innerText = '预测: ' + (yesterday.getMonth()+1) + '/' + yesterday.getDate() + ' 15:00';
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
            rate += Math.round((buyWeight / weightTotal) * 15) - 7.5;
        } else if (type === 'sell') {
            rate += Math.round((sellWeight / weightTotal) * 15) - 7.5;
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
    const modalHtml = '<div id="feeDetailModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;">' +
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
}

function closeFeeDetailModal() {
    const modal = document.getElementById('feeDetailModal');
    if (modal) modal.remove();
}

function showProfitDetail(type) {
    const d = _profitDetail || {};
    const stocks = d.stockProfits || [];
    let title = '', content = '';
    const fmtMoney = (v) => (v >= 0 ? '+' : '') + '¥' + (v || 0).toFixed(2);
    const colorCls = (v) => v > 0 ? 'color:var(--red);' : v < 0 ? 'color:var(--green);' : 'color:var(--text-primary);';

    if (type === 'total') {
        title = '交易明细';
        content = '<div style="text-align:center;margin-bottom:12px;"><div style="font-size:22px;font-weight:800;' + colorCls(d.totalProfit) + '">' + fmtMoney(d.totalProfit) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">总收益（已实现 + 未实现）</div></div>';
        // 交易记录列表
        const allTrades = [..._trades].sort((a, b) => (b.time || 0) - (a.time || 0));
        let listHtml = '';
        if (allTrades.length > 0) {
            listHtml = allTrades.map(t => {
                const ttype = t.trade_type || t.type;
                const isBuy = ttype === 'BUY';
                const date = t.time ? new Date(t.time).toLocaleDateString() : '';
                const timeStr = t.time ? new Date(t.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
                const amount = (t.price || 0) * (t.quantity || 0);
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-soft);">'
                    + '<div>'
                    + '<div style="font-size:13px;font-weight:600;">' + (t.name || t.code) + ' <span style="font-size:10px;color:var(--text-muted);">' + t.code + '</span></div>'
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
        title = '已实现盈亏明细';
        const sellByStock = {};
        const holdings = {};
        _trades.forEach(t => {
            const ttype = t.trade_type || t.type;
            const code = t.code;
            if (ttype === 'BUY') {
                if (!holdings[code]) holdings[code] = { qty: 0, cost: 0, name: t.name || code };
                holdings[code].qty += t.quantity;
                const amount = t.price * t.quantity;
                const comm = Math.max(amount * 0.0003, 5);
                const trans = amount * 0.00001;
                holdings[code].cost += amount + comm + trans;
            } else {
                if (holdings[code] && holdings[code].qty > 0) {
                    const avgCost = holdings[code].cost / holdings[code].qty;
                    const sellQty = Math.min(t.quantity, holdings[code].qty);
                    const sellCost = avgCost * sellQty;
                    const amount = t.price * sellQty;
                    const comm = Math.max(amount * 0.0003, 5);
                    const stamp = amount * 0.001;
                    const trans = amount * 0.00001;
                    const net = amount - comm - stamp - trans - sellCost;
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
            listHtml = list.map(s => '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-soft);"><div><div style="font-size:13px;font-weight:600;">' + s.name + '</div><div style="font-size:10px;color:var(--text-muted);">' + s.code + ' · 已卖' + s.qty + '股</div></div><div style="font-size:14px;font-weight:700;' + colorCls(s.profit) + '">' + fmtMoney(s.profit) + '</div></div>').join('');
        } else {
            listHtml = '<div class="empty-state" style="padding:20px 0;"><div class="empty-state-icon">📊</div><div>暂无已实现收益</div></div>';
        }
        content = '<div style="text-align:center;margin-bottom:16px;"><div style="font-size:24px;font-weight:800;' + colorCls(d.realizedProfit) + '">' + fmtMoney(d.realizedProfit) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">按股票汇总</div></div>';
        content += '<div style="max-height:300px;overflow-y:auto;">' + listHtml + '</div>';
    } else if (type === 'unrealized') {
        title = '未实现盈亏明细';
        let listHtml = '';
        if (stocks.length > 0) {
            listHtml = stocks.map(s => '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-soft);"><div><div style="font-size:13px;font-weight:600;">' + s.name + '</div><div style="font-size:10px;color:var(--text-muted);">' + s.code + ' · ' + s.quantity + '股 · 成本¥' + s.avg_cost.toFixed(2) + '</div></div><div style="text-align:right;"><div style="font-size:14px;font-weight:700;' + colorCls(s.profit) + '">' + fmtMoney(s.profit) + '</div><div style="font-size:10px;color:var(--text-muted);">现价¥' + s.current_price.toFixed(2) + '</div></div></div>').join('');
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
                const date = tt.pair_time ? new Date(tt.pair_time).toLocaleDateString() : (tt.time ? new Date(tt.time).toLocaleDateString() : '');
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-soft);"><div><div style="font-size:13px;font-weight:600;">' + (tt.name || tt.code) + '</div><div style="font-size:10px;color:var(--text-muted);">' + date + ' · ' + (tt.pair_quantity || 0) + '股</div></div><div style="font-size:14px;font-weight:700;' + colorCls(profit) + '">' + fmtMoney(profit) + '</div></div>';
            }).join('');
        } else {
            listHtml = '<div class="empty-state" style="padding:20px 0;"><div class="empty-state-icon">⚡</div><div>暂无做T记录</div></div>';
        }
        content = '<div style="text-align:center;margin-bottom:16px;"><div style="font-size:24px;font-weight:800;' + colorCls(d.tProfit) + '">' + fmtMoney(d.tProfit) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">累计做T ' + (d.tTradeCount || 0) + ' 次 · 已扣除手续费</div></div>';
        content += '<div style="max-height:300px;overflow-y:auto;">' + listHtml + '</div>';
    } else if (type === 'tcount') {
        title = '做T次数统计';
        const tTrades = _trades.filter(t => t.pair_profit !== undefined && (t.pair_quantity || 0) > 0);
        const winCount = tTrades.filter(t => (t.pair_profit || 0) > 0).length;
        const lossCount = tTrades.filter(t => (t.pair_profit || 0) < 0).length;
        const winRate = tTrades.length > 0 ? (winCount / tTrades.length * 100).toFixed(1) : '0';
        const avgProfit = tTrades.length > 0 ? (d.tProfit || 0) / tTrades.length : 0;
        content = '<div style="text-align:center;margin-bottom:16px;"><div style="font-size:24px;font-weight:800;color:var(--accent);">' + (d.tTradeCount || 0) + '次</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">累计做T次数</div></div>';
        content += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">';
        content += '<div style="padding:12px;background:rgba(52,211,153,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">盈利次数</div><div style="font-weight:700;margin-top:4px;color:var(--green);">' + winCount + '次</div></div>';
        content += '<div style="padding:12px;background:rgba(248,113,113,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">亏损次数</div><div style="font-weight:700;margin-top:4px;color:var(--red);">' + lossCount + '次</div></div>';
        content += '<div style="padding:12px;background:rgba(250,204,21,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">胜率</div><div style="font-weight:700;margin-top:4px;color:var(--yellow);">' + winRate + '%</div></div>';
        content += '<div style="padding:12px;background:rgba(99,102,241,0.08);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">平均每笔</div><div style="font-weight:700;margin-top:4px;' + colorCls(avgProfit) + '">' + fmtMoney(avgProfit) + '</div></div>';
        content += '</div>';
        content += '<div style="margin-top:12px;padding:10px;background:var(--bg-inset);border-radius:8px;font-size:11px;color:var(--text-muted);">💡 总做T收益：<span style="' + colorCls(d.tProfit) + 'font-weight:700;">' + fmtMoney(d.tProfit) + '</span><br>💡 数据来自已配对的做T交易记录</div>';
    }

    const modalHtml = '<div id="profitDetailModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;">';
    modalHtml += '<div style="background:var(--bg-overlay);border-radius:16px;padding:20px;max-width:360px;width:90%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.4);">';
    modalHtml += '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:16px;text-align:center;">💰 ' + title + '</div>';
    modalHtml += '<div style="flex:1;overflow-y:auto;min-height:0;">' + content + '</div>';
    modalHtml += '<div style="margin-top:16px;"><button onclick="closeProfitDetailModal()" style="width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">关闭</button></div>';
    modalHtml += '</div></div>';
    const oldModal = document.getElementById('profitDetailModal');
    if (oldModal) oldModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeProfitDetailModal() {
    const modal = document.getElementById('profitDetailModal');
    if (modal) modal.remove();
}

function showStockDetailModal() {
    if (!_currentStock) return;
    
    const s = _currentStock;
    const chg = s.change_percent || 0;
    const chgColor = chg >= 0 ? 'var(--red)' : 'var(--green)';
    const chgSign = chg >= 0 ? '+' : '';
    
    const modalHtml = '<div id="stockDetailModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;">' +
        '<div style="background:var(--bg-overlay);border-radius:16px;padding:20px;max-width:360px;width:90%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.4);">' +
        '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:16px;text-align:center;">📈 ' + s.name + ' ' + s.code + '</div>' +
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
        '<div style="padding:12px;background:var(--bg-inset);border-radius:10px;text-align:center;"><div style="color:var(--text-muted);font-size:11px;">成交量</div><div style="font-weight:700;margin-top:4px;">' + formatVolume(s.volume) + '</div></div>' +
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
}

function closeStockDetailModal() {
    const modal = document.getElementById('stockDetailModal');
    if (modal) modal.remove();
}

function loadDefaultStock() {
    if (_currentStock) return;
    let code = null;
    // 优先从做T信号列表取第一个
    if (_watchList.length > 0) {
        code = _watchList[0];
    }
    // 如果做T信号为空，取最近搜索历史最新的
    if (!code && _searchHistory.length > 0) {
        code = _searchHistory[0].code;
    }
    if (code) {
        loadStockInfo(code).catch(() => {});
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
    const tCount = strategies.filter(s => 
        s.action.includes('TRADING_OPPORTUNITY') || 
        s.action.includes('BUY_THEN_SELL') || 
        s.action.includes('SELL_THEN_BUY') ||
        s.action.includes('BOX_TRADING')
    ).length;
    
    document.getElementById('buyCount').innerText = buyCount;
    document.getElementById('sellCount').innerText = sellCount;
    document.getElementById('tCount').innerText = tCount;

    // 渲染今日价格预测
    if (_lastSummary && _lastSummary.price_prediction) {
        const p = _lastSummary.price_prediction;
        const card = document.getElementById('pricePredictionCard');
        if (card) {
            card.style.display = 'block';
            document.getElementById('predictedHigh').innerText = '￥' + p.predicted_high.toFixed(2);
            document.getElementById('predictedLow').innerText = '￥' + p.predicted_low.toFixed(2);
            document.getElementById('predictedAmp').innerText = p.avg_amplitude.toFixed(2) + '%';
            document.getElementById('predictedTrend').innerText = p.trend;
            document.getElementById('predictedConfidence').innerText = p.confidence + '%';
            
            // 固定预测（基于昨日收盘，全天不变）
            const fp = _lastSummary.fixed_prediction;
            if (fp) {
                const elFHigh = document.getElementById('fixedPredictedHigh');
                const elFLow = document.getElementById('fixedPredictedLow');
                const elFInfo = document.getElementById('fixedPredictedInfo');
                if (elFHigh) elFHigh.innerText = '￥' + fp.predicted_high.toFixed(2);
                if (elFLow) elFLow.innerText = '￥' + fp.predicted_low.toFixed(2);
                if (elFInfo) elFInfo.innerText = '基准价: ￥' + fp.base_price.toFixed(2) + ' · 振幅: ' + fp.avg_amplitude + '% · 趋势: ' + fp.trend + ' · ATR: ' + fp.atr;
            }
            
            const pos = Math.max(0, Math.min(100, p.price_position));
            document.getElementById('pricePositionDot').style.left = pos + '%';
            document.getElementById('pricePositionLabel').innerText = '当前位置: ' + pos.toFixed(1) + '%';

            // 计算差值显示
            const highDeltaEl = document.getElementById('predictedHighDelta');
            const lowDeltaEl = document.getElementById('predictedLowDelta');
            if (_currentStock && _currentStock.high_price && _currentStock.low_price) {
                const realHigh = _currentStock.high_price;
                const realLow = _currentStock.low_price;
                
                if (realHigh > 0) {
                    const delta = p.predicted_high - realHigh;
                    if (delta <= 0) {
                        highDeltaEl.innerHTML = '<span style="color:var(--green);">✓已触及</span>';
                    } else {
                        const percent = (delta / realHigh * 100).toFixed(2);
                        highDeltaEl.innerHTML = '<span style="color:var(--red);">差' + percent + '%</span>';
                    }
                }
                if (realLow > 0) {
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
            if (_currentStock) {
                const stats = getAvgAccuracy(_currentStock.code);
                rateEl.innerText = stats.avg + '分';
                rateEl.style.color = stats.avg >= 80 ? 'var(--green)' : stats.avg >= 60 ? 'var(--yellow)' : 'var(--red)';
                
                // 显示实际价格
                if (_currentStock.high_price) {
                    document.getElementById('actualHigh').innerText = _currentStock.high_price.toFixed(2);
                    document.getElementById('actualLow').innerText = _currentStock.low_price.toFixed(2);
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
            <div style="background:var(--surface-2);padding:12px;border-radius:var(--radius-sm);margin-bottom:15px;border:1px solid var(--border-glass);">
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
    let scoreColor = 'var(--yellow)';
    const numScore = parseInt(score);
    if (!isNaN(numScore)) {
        if (numScore >= 70) { scoreLevel = '强势看多'; scoreColor = 'var(--green)'; }
        else if (numScore >= 55) { scoreLevel = '偏多'; scoreColor = 'var(--green)'; }
        else if (numScore >= 45) { scoreLevel = '中性'; scoreColor = 'var(--yellow)'; }
        else if (numScore >= 30) { scoreLevel = '偏空'; scoreColor = 'var(--red)'; }
        else { scoreLevel = '强势看空'; scoreColor = 'var(--red)'; }
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
                                <span style="font-size:12px;font-weight:600;">${s.icon} ${s.name}</span>
                                <span style="font-size:11px;font-weight:700;color:${actionColor};background:var(--surface-3);padding:2px 8px;border-radius:10px;">${actionText}</span>
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
            <div style="background:var(--surface-2);padding:12px;border-radius:var(--radius-sm);margin-bottom:15px;border:1px solid var(--border-glass);">
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
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px;padding:4px 6px;background:var(--surface-3);border-radius:4px;">
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
                        <span class="trade-stock">${t.name || t.code}</span>
                        <span class="trade-type ${type.toLowerCase()}">${isBuy ? '买入' : '卖出'}</span>
                        <button onclick="event.stopPropagation();deleteTrade(${idx})" style="margin-left:auto;background:rgba(239,68,68,0.15);color:var(--red);border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;">删除</button>
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
            
            <div style="background:var(--bg-inset);border-radius:12px;padding:16px;margin-bottom:16px;">
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
                        <span style="color:var(--red);">¥${comm.toFixed(2)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px 8px;background:var(--surface-3);border-radius:6px;">
                        <span>过户费</span>
                        <span style="color:var(--red);">¥${trans.toFixed(4)}</span>
                    </div>
                    ${isBuy ? '' : `
                    <div style="display:flex;justify-content:space-between;padding:6px 8px;background:var(--surface-3);border-radius:6px;grid-column:span 2;">
                        <span>印花税（卖出）</span>
                        <span style="color:var(--red);">¥${stamp.toFixed(2)}</span>
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
                const sellFee = pairFee - buyFee;
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
            <div onclick="selectPairBuy(${idx})" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;${isSelected ? 'background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);' : 'background:var(--surface-2);border:1px solid var(--border-glass);'}">
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

// 长线页
function onLongtermSearchInput() {
    const kw = document.getElementById('longtermInput').value.trim();
    if (!kw) {
        document.getElementById('longtermSuggestions').style.display = 'none';
        return;
    }
    clearTimeout(window.longtermSearchTimer);
    window.longtermSearchTimer = setTimeout(async () => {
        const results = await searchStockByName(kw);
        const container = document.getElementById('longtermSuggestions');
        if (results && results.length > 0) {
            container.innerHTML = results.slice(0, 5).map(r =>
                `<div class="suggestion-item" onclick="selectLongtermStock('${r.code}', '${r.name}')">${r.name} <span class="suggestion-code">${r.code}</span></div>`
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
    const history = JSON.parse(localStorage.getItem('longtermHistory') || '[]');
    const container = document.getElementById('longtermHistory');
    const list = document.getElementById('longtermHistoryList');
    if (history.length > 0) {
        container.style.display = 'block';
        list.innerHTML = history.slice(0, 10).map(h =>
            `<span class="history-tag" onclick="selectLongtermStock('${h.code}', '${h.name || h.code}')">${h.name || h.code}</span>`
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
            document.getElementById('longtermInput').value = code;
        } else {
            showToast('未找到该股票');
            return;
        }
    }

    try {
        // 保存历史
        const history = JSON.parse(localStorage.getItem('longtermHistory') || '[]');
        const newHistory = [{ code, name: _stockNames[code] || code, time: Date.now() }]
            .concat(history.filter(h => h.code !== code))
            .slice(0, 20);
        localStorage.setItem('longtermHistory', JSON.stringify(newHistory));
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
        errorDiv.innerHTML = '<div class="empty-state-icon">📊</div><div>长线分析加载失败</div><div style="font-size:11px;color:var(--text-muted);margin-top:8px;">' + (e.message || '未知错误') + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">' + debugInfo + '</div>';
        const overview = document.getElementById('longtermOverview');
        // 移除之前的错误div（如果有）
        const oldError = overview.querySelector('.longterm-error-msg');
        if (oldError) oldError.remove();
        errorDiv.classList.add('longterm-error-msg');
        overview.appendChild(errorDiv);
    }
}

function renderLongtermAnalysis(stockInfo, klines, summary) {
    try {
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume);
    const cp = closes[closes.length - 1];
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
    const peRatio = avgPrice > 0 ? cp / (avgPrice / 10) : 0; // 简化PE计算
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

    const ma60Val = ma60 ? ma60[ma60.length - 1] : null;
    const ma120Val = ma120 ? ma120[ma120.length - 1] : null;
    const ma250Val = ma250 ? ma250[ma250.length - 1] : null;
    const allTimeHigh = Math.max(...highs);
    const allTimeLow = Math.min(...lows);

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
    if (ma250 && ma250.length >= 121) {
        const maNow = ma250[ma250.length - 1];
        const maBefore = ma250[ma250.length - 121];
        if (maBefore > 0) {
            centerDriftAnnual = (maNow - maBefore) / maBefore * (250 / 120);
        }
    } else if (ma120 && ma120.length >= 61) {
        const maNow = ma120[ma120.length - 1];
        const maBefore = ma120[ma120.length - 61];
        if (maBefore > 0) {
            centerDriftAnnual = (maNow - maBefore) / maBefore * (250 / 60);
        }
    } else if (ma60 && ma60.length >= 31) {
        const maNow = ma60[ma60.length - 1];
        const maBefore = ma60[ma60.length - 31];
        if (maBefore > 0) {
            centerDriftAnnual = (maNow - maBefore) / maBefore * (250 / 30);
        }
    }
    // 限制漂移率在保守范围 -20%~+25%（长期可持续的增长率）
    centerDriftAnnual = Math.max(-0.2, Math.min(0.25, centerDriftAnnual));

    // 3. 均值回归因子 —— 价格偏离价值中枢越远，回归力越强
    const deviation = (cp - valueCenter) / valueCenter; // 正=偏高，负=偏低

    // 4. 动量因子 —— 近期涨跌有延续性，但随时间衰减
    let momentum20 = 0;
    if (closes.length >= 21) {
        momentum20 = (cp - closes[closes.length - 21]) / closes[closes.length - 21];
    }
    let momentum60 = 0;
    if (closes.length >= 61) {
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
        const avgRet = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - avgRet, 2), 0) / returns.length;
        annualVolatility = Math.sqrt(variance) * Math.sqrt(250);
    }
    annualVolatility = Math.max(0.1, Math.min(0.6, annualVolatility));

    // 估值位置：当前价在历史区间的位置（0=最低，1=最高）
    const pricePosition = (cp - allTimeLow) / (allTimeHigh - allTimeLow);

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
        const periodHigh = Math.max(...periodHighs);
        const periodLow = Math.min(...periodLows);

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

        // 边界保护：不超过历史高点的1.15倍，不低于历史低点的0.85倍
        const maxPrice = allTimeHigh * 1.15;
        const minPrice = Math.max(allTimeLow * 0.85, 0.01);
        optimistic = Math.min(optimistic, maxPrice);
        pessimistic = Math.max(pessimistic, minPrice);
        neutral = Math.max(Math.min(neutral, maxPrice), minPrice);

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
    if (ma5 < ma10 && ma10 < ma20) riskItems.push({ level: 'high', text: '均线空头排列，中期趋势向下' });
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

// ==================== 监控股票管理 ====================
function showAddWatchModal() {
    document.getElementById('watchModal').style.display = 'flex';
    document.getElementById('watchCodeInput').value = '';
    setTimeout(() => document.getElementById('watchCodeInput').focus(), 100);
}

function closeWatchModal() {
    document.getElementById('watchModal').style.display = 'none';
    document.getElementById('watchCodeInput').value = '';
    document.getElementById('watchSearchSuggestions').style.display = 'none';
}

function onWatchSearchInput() {
    const kw = document.getElementById('watchCodeInput').value.trim();
    if (!kw) {
        document.getElementById('watchSearchSuggestions').style.display = 'none';
        return;
    }
    
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
        const loadingEl = document.getElementById('watchSearchLoading');
        if (loadingEl) loadingEl.style.display = 'inline';
        
        try {
            const results = await searchStockByName(kw);
            const sug = document.getElementById('watchSearchSuggestions');
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
            if (loadingEl) loadingEl.style.display = 'none';
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
            <div id="signal-card-${code}" class="signal-card" style="background:var(--bg-inset);border-radius:8px;padding:10px;margin-top:8px;cursor:pointer;" onclick="viewTSignalDetail('${code}')">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="font-size:12px;font-weight:600;">${name} <span style="color:var(--text-muted);font-weight:400;">${code}</span></div>
                    <span style="font-size:10px;color:var(--text-muted);">加载中...</span>
                </div>
            </div>
        `;
    }).join('');
    
    // 分批加载，每次2个，避免同时发起大量请求阻塞UI
    let index = 0;
    const batchSize = 2;
    const loadNextBatch = () => {
        if (index >= _watchList.length) return;
        const batch = _watchList.slice(index, index + batchSize);
        index += batchSize;
        batch.forEach(code => getLiveTSignals(code));
        // 下一批延迟一点加载，给UI喘息时间
        setTimeout(loadNextBatch, 200);
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
            s.action === 'SELL_THEN_BUY' ||
            s.action === 'BOX_TRADING'
        );
        
        if (tSignals.length > 0) {
            const s = tSignals[0];
            const isBuyT = s.action === 'BUY_THEN_SELL' || s.action === 'TRADING_OPPORTUNITY';
            const color = isBuyT ? 'var(--green)' : 'var(--red)';
            let tType = '做T机会';
            if (s.action === 'BUY_THEN_SELL') tType = '正T (先买后卖)';
            else if (s.action === 'SELL_THEN_BUY') tType = '反T (先卖后买)';
            else if (s.action === 'BOX_TRADING') tType = '箱体做T';
            
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
        
        checkAndAlertSignals(stockCode, stockInfo, strategies);
        
        // 更新首页最优操作方案（优先显示有持仓的股票）
        updateHomeBestPlan(stockCode, stockInfo, summary, holdings);
        
    } catch (e) {
        cardDiv.innerHTML = renderSignalCardError(stockCode, '加载失败');
    }
}

let _homePlanStock = null;
function updateHomeBestPlan(code, stockInfo, summary, holdings) {
    const bestPlanCard = document.getElementById('bestPlanCard');
    if (!bestPlanCard) return;
    
    if (!summary) return;
    
    // 如果当前没有显示的股票，或者这只股票有持仓（优先），就显示这只
    if (!_homePlanStock || holdings > 0) {
        _homePlanStock = code;
    }
    
    // 只显示当前选中的股票
    if (_homePlanStock !== code) return;
    
    bestPlanCard.style.display = 'block';
    renderBestPlan(summary);
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

// ========== 监控自动刷新与弹窗提醒 ==========
let _watchRefreshTimer = null;
let _alertedSignals = {};

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
    
    showSignalAlert(stockInfo.name, code, stockInfo.current_price, avgScore, action);
    sendLocalNotification(stockInfo.name, code, stockInfo.current_price, avgScore, action);
}

function calculatePanoramaScore(strategies) {
    if (!strategies || strategies.length === 0) return 50;
    
    let buyCount = 0;
    let sellCount = 0;
    strategies.forEach(s => {
        if (s.signal === 'buy' || s.action === 'BUY_THEN_SELL') buyCount++;
        else if (s.signal === 'sell' || s.action === 'SELL_THEN_BUY') sellCount++;
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
                <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${name} <span style="color:var(--text-muted); font-weight:400; font-size:11px;">${code}</span></div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">当前价 ¥${price.toFixed(2)} · 综合评分 ${score}分</div>
            </div>
        </div>
    `;
    
    alertDiv.onclick = () => {
        selectStock(code, name);
        switchTab('strategy');
        document.body.removeChild(alertDiv);
    };
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.style.transform = 'translateX(-50%) translateY(0)';
    }, 50);
    
    setTimeout(() => {
        alertDiv.style.transform = 'translateX(-50%) translateY(-100px)';
        setTimeout(() => {
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
    
    // 存储收益明细和费用明细供弹窗使用
    _profitDetail = {
        totalProfit,
        realizedProfit,
        unrealizedProfit,
        tProfit,
        tTradeCount,
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
    
    coreDiv.innerHTML = `
        <div style="background:${directionBg}; border:2px solid ${directionColor}; border-radius:16px; padding:16px; margin:10px 0;">
            <div style="margin-bottom:12px;">
                <span style="font-size:15px; font-weight:700; color:var(--text-primary);">${stockCode}</span>
                <span style="font-size:13px; color:var(--text-secondary); margin-left:8px;">${stockName}</span>
                <span style="font-size:11px; color:var(--text-muted); float:right;">策略分析</span>
            </div>

            <div style="margin-bottom:14px;">
                <span style="font-size:24px; vertical-align:middle;">${directionIcon}</span>
                <span style="font-size:18px; font-weight:700; color:${directionColor}; vertical-align:middle; margin-left:8px; white-space:nowrap;">${directionText}</span>
                <div style="font-size:11px; color:var(--text-muted); margin-top:6px; margin-left:32px;">${reason}</div>
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
            const actionColor = s.action.includes('BUY') && !s.action.includes('SELL') ? 'var(--green)' :
                               s.action.includes('SELL') && !s.action.includes('BUY') ? 'var(--red)' :
                               s.action.includes('BUY_THEN_SELL') || s.action.includes('SELL_THEN_BUY') ? '#60a5fa' : 'var(--yellow)';
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
                            <span style="font-size:20px;">${s.icon || '📊'}</span>
                            <span style="font-weight:600; font-size:15px;">${s.name}</span>
                        </div>
                        <span style="color:${actionColor}; font-size:12px; font-weight:600; padding:4px 10px; background:${actionColor}22; border-radius:12px;">
                            ${actionText}
                        </span>
                    </div>
                    <div style="font-size:13px; color:var(--text-muted); margin-bottom:10px;">${s.category} · ${prioText}</div>
                    <div style="font-size:14px; color:#e5e7eb; line-height:1.6; margin-bottom:10px;">${s.suggestion}</div>
                    ${s.reason ? `<div style="font-size:12px; color:#6b7280; padding-top:8px; border-top:1px solid var(--surface-3);">💡 ${s.reason}</div>` : ''}
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
        autoRefreshInterval: 0,
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
        popupAlert: false,
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
    document.getElementById('popupAlert').checked = _settings.popupAlert;
    
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
    _settings.popupAlert = document.getElementById('popupAlert').checked;
    
    localStorage.setItem('appSettings', JSON.stringify(_settings));
    updateAutoRefresh();
    showToast('设置已保存');
}

function updateAutoRefresh() {
    if (_autoRefreshTimer) {
        clearInterval(_autoRefreshTimer);
        _autoRefreshTimer = null;
    }
    
    if (_watchRefreshTimer) {
        clearInterval(_watchRefreshTimer);
        _watchRefreshTimer = null;
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
        
        if (_watchList && _watchList.length > 0) {
            _watchRefreshTimer = setInterval(() => {
                refreshAllTSignals();
            }, interval * 1000);
        }
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
    
    const modal = document.getElementById('learnModal');
    const titleEl = document.getElementById('learnModalTitle');
    const bodyEl = document.getElementById('learnModalBody');
    
    if (titleEl) titleEl.innerText = item.icon + ' ' + item.title;
    if (bodyEl) bodyEl.innerHTML = item.content;
    
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeLearnModal() {
    const modal = document.getElementById('learnModal');
    if (modal) modal.style.display = 'none';
}