/**
 * HTX Pi Monitor - Frontend JavaScript
 * Touch-optimized portfolio monitoring interface
 */

class PortfolioUI {
    constructor() {
        // Configuration
        this.config = {
            autoRefreshInterval: 30000, // 30 seconds default
            enableSound: false,
            compactView: false,
            hideSmallPositions: false,
            highlightUnreconciled: true,
            minPositionValue: 10 // $10 minimum for "small" positions
        };

        // State
        this.sortBy = 'value';
        this.pinnedAssets = new Set(JSON.parse(localStorage.getItem('pinnedAssets') || '[]'));
        this.hiddenAssets = new Set(JSON.parse(localStorage.getItem('hiddenAssets') || '[]'));
        this.lastSnapshot = null;
        this.autoRefreshTimer = null;
        this.isRefreshing = false;
        this.touchStartY = 0;
        this.pullThreshold = 100;
        
        // DOM elements
        this.elements = {};
        
        // Initialize
        this.init();
    }

    /**
     * Initialize the application
     */
    async init() {
        this.bindElements();
        this.bindEvents();
        this.loadSettings();
        this.applySettings();
        
        // Initial data load
        await this.fetchAndRender();
        
        // Fetch scheduler status
        await this.fetchSchedulerStatus();
        
        // Start auto-refresh if enabled
        if (this.config.autoRefreshInterval > 0) {
            this.startAutoRefresh();
        }
        
        // Periodically update scheduler status
        setInterval(() => this.fetchSchedulerStatus(), 30000); // Every 30 seconds
        
        console.log('HTX Pi Monitor initialized');
    }

    /**
     * Bind DOM elements
     */
    bindElements() {
        const ids = [
            'loading-screen', 'error-screen', 'main-app', 'retry-btn',
            'portfolio-header', 'total-value', 'total-change', 'position-count',
            'last-update', 'connection-status', 'positions-container',
            'empty-state', 'refresh-btn', 'settings-btn', 'sort-select',
            'hide-small', 'show-unreconciled', 'settings-modal', 'close-settings',
            'refresh-interval', 'enable-sound', 'compact-view',
            'clear-pinned', 'reset-hidden', 'pull-to-refresh'
        ];
        
        ids.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Control events - only bind if elements exist
        if (this.elements['refresh-btn']) {
            this.elements['refresh-btn'].addEventListener('click', () => this.handleRefresh());
        }
        if (this.elements['retry-btn']) {
            this.elements['retry-btn'].addEventListener('click', () => this.handleRefresh());
        }
        if (this.elements['settings-btn']) {
            this.elements['settings-btn'].addEventListener('click', () => this.showSettings());
        }
        if (this.elements['close-settings']) {
            this.elements['close-settings'].addEventListener('click', () => this.hideSettings());
        }
        
        // Filter and sort events - only bind if elements exist
        if (this.elements['sort-select']) {
            this.elements['sort-select'].addEventListener('change', (e) => this.handleSortChange(e));
        }
        if (this.elements['hide-small']) {
            this.elements['hide-small'].addEventListener('change', (e) => this.handleFilterChange(e));
        }
        if (this.elements['show-unreconciled']) {
            this.elements['show-unreconciled'].addEventListener('change', (e) => this.handleFilterChange(e));
        }
        
        // Settings events - only bind if elements exist
        if (this.elements['refresh-interval']) {
            this.elements['refresh-interval'].addEventListener('change', (e) => this.handleSettingsChange(e));
        }
        if (this.elements['enable-sound']) {
            this.elements['enable-sound'].addEventListener('change', (e) => this.handleSettingsChange(e));
        }
        if (this.elements['compact-view']) {
            this.elements['compact-view'].addEventListener('change', (e) => this.handleSettingsChange(e));
        }
        if (this.elements['clear-pinned']) {
            this.elements['clear-pinned'].addEventListener('click', () => this.clearPinned());
        }
        if (this.elements['reset-hidden']) {
            this.elements['reset-hidden'].addEventListener('click', () => this.resetHidden());
        }
        
        // Touch events for pull-to-refresh
        document.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
        document.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });
        
        // Modal close on backdrop click
        if (this.elements['settings-modal']) {
            this.elements['settings-modal'].addEventListener('click', (e) => {
                if (e.target === this.elements['settings-modal']) {
                    this.hideSettings();
                }
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
        
        // Visibility change (tab focus/blur)
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        const saved = localStorage.getItem('portfolioSettings');
        if (saved) {
            try {
                const settings = JSON.parse(saved);
                this.config = { ...this.config, ...settings };
            } catch (error) {
                console.warn('Failed to load settings:', error);
            }
        }
    }

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        localStorage.setItem('portfolioSettings', JSON.stringify(this.config));
        localStorage.setItem('pinnedAssets', JSON.stringify([...this.pinnedAssets]));
        localStorage.setItem('hiddenAssets', JSON.stringify([...this.hiddenAssets]));
    }

    /**
     * Apply settings to UI
     */
    applySettings() {
        // Update form controls - only if elements exist
        if (this.elements['refresh-interval']) {
            this.elements['refresh-interval'].value = this.config.autoRefreshInterval;
        }
        if (this.elements['enable-sound']) {
            this.elements['enable-sound'].checked = this.config.enableSound;
        }
        if (this.elements['compact-view']) {
            this.elements['compact-view'].checked = this.config.compactView;
        }
        if (this.elements['hide-small']) {
            this.elements['hide-small'].checked = this.config.hideSmallPositions;
        }
        if (this.elements['show-unreconciled']) {
            this.elements['show-unreconciled'].checked = this.config.highlightUnreconciled;
        }
        
        // Apply compact view
        document.body.classList.toggle('compact-mode', this.config.compactView);
        
        // Restart auto-refresh with new interval
        this.startAutoRefresh();
    }

    /**
     * Fetch portfolio data and render
     */
    async fetchAndRender() {
        try {
            this.showLoading();
            this.setConnectionStatus('connecting');
            
            const response = await fetch('/api/snapshot');
            
            if (!response.ok) {
                if (response.status === 404) {
                    // No data available yet
                    this.showEmptyState();
                    this.setConnectionStatus('connected');
                    return;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const snapshot = await response.json();
            this.lastSnapshot = snapshot;
            
            this.renderPortfolio(snapshot);
            this.setConnectionStatus('connected');
            this.hideLoading();
            this.updateLastRefreshTime();
            
        } catch (error) {
            console.error('Failed to fetch portfolio data:', error);
            this.showError(error.message);
            this.setConnectionStatus('disconnected');
        }
    }

    /**
     * Render portfolio data
     */
    renderPortfolio(snapshot) {
        if (!snapshot || !snapshot.positions) {
            this.showEmptyState();
            return;
        }

        // Update simple HTML elements - check if they exist first
        const totalValueEl = document.getElementById('totalValue');
        const dayChangeEl = document.getElementById('dayChange');
        const totalPnlEl = document.getElementById('totalPnl');
        const positionCountEl = document.getElementById('positionCount');
        const positionsBodyEl = document.getElementById('positionsBody');
        const loadingIndicatorEl = document.getElementById('loadingIndicator');
        const lastUpdateEl = document.getElementById('lastUpdate');
        
        // Update values if elements exist
        if (totalValueEl) {
            totalValueEl.textContent = this.formatCurrency(snapshot.total_value_usd);
        }
        
        if (dayChangeEl && snapshot.total_change_24h_usd !== undefined) {
            const change24h = snapshot.total_change_24h_usd || 0;
            const changePct = snapshot.total_change_24h_pct || 0;
            dayChangeEl.textContent = `${this.formatCurrency(change24h)} (${this.formatPercentage(changePct)})`;
            dayChangeEl.className = `value ${this.getChangeClass(changePct)}`;
        }
        
        if (totalPnlEl && snapshot.total_pnl_usd !== undefined) {
            const pnl = snapshot.total_pnl_usd || 0;
            const pnlPct = snapshot.total_pnl_pct || 0;
            totalPnlEl.textContent = `${this.formatCurrency(pnl)} (${this.formatPercentage(pnlPct)})`;
            totalPnlEl.className = `value ${this.getChangeClass(pnlPct)}`;
        }
        
        if (positionCountEl) {
            positionCountEl.textContent = snapshot.positions.length;
        }
        
        if (lastUpdateEl) {
            lastUpdateEl.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
        }
        
        // Hide loading indicator
        if (loadingIndicatorEl) {
            loadingIndicatorEl.style.display = 'none';
        }
        
        // For elements that might not exist in simple HTML, use safe fallback
        if (this.elements['total-value']) {
            this.elements['total-value'].textContent = this.formatCurrency(snapshot.total_value_usd);
        }
        if (this.elements['total-change']) {
            this.elements['total-change'].textContent = this.formatPercentage(snapshot.total_change_24h_pct);
            this.elements['total-change'].className = `change-amount ${this.getChangeClass(snapshot.total_change_24h_pct)}`;
        }
        if (this.elements['position-count']) {
            this.elements['position-count'].textContent = snapshot.positions.length;
        }

        // Filter and sort positions
        let positions = [...snapshot.positions];
        
        // Apply filters
        if (this.config.hideSmallPositions) {
            positions = positions.filter(p => p.value >= this.config.minPositionValue);
        }
        
        // Sort positions
        positions = this.sortPositions(positions, this.sortBy);
        
        // Render position cards
        this.renderPositions(positions);
        
        // Show main app if element exists
        if (this.elements['main-app']) {
            this.elements['main-app'].classList.remove('hidden');
        }
        if (this.elements['empty-state']) {
            this.elements['empty-state'].classList.add('hidden');
        }
    }

    /**
     * Render position cards
     */
    renderPositions(positions) {
        // Try to render to table if it exists (simple HTML)
        const tableBody = document.getElementById('positionsBody');
        if (tableBody) {
            tableBody.innerHTML = '';
            
            positions.forEach(position => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${position.symbol}</td>
                    <td>${this.formatNumber(position.balance)}</td>
                    <td>${this.formatCurrency(position.price)}</td>
                    <td>${this.formatCurrency(position.value)}</td>
                    <td class="${this.getChangeClass(position.change_24h_pct)}">${this.formatPercentage(position.change_24h_pct)}</td>
                    <td>${position.avg_cost ? this.formatCurrency(position.avg_cost) : 'N/A'}</td>
                    <td class="${this.getChangeClass(position.pnl_pct)}">${position.pnl ? this.formatCurrency(position.pnl) : 'N/A'}</td>
                `;
                tableBody.appendChild(row);
            });
            return;
        }
        
        // Fallback to card rendering if positions-container exists
        const container = this.elements['positions-container'];
        if (!container) {
            console.warn('No container found for rendering positions');
            return;
        }
        
        container.innerHTML = '';

        if (positions.length === 0) {
            this.showEmptyState();
            return;
        }

        positions.forEach(position => {
            const card = this.createPositionCard(position);
            container.appendChild(card);
        });
    }

    /**
     * Create a position card element
     */
    createPositionCard(position) {
        const card = document.createElement('div');
        card.className = 'position-card';
        card.dataset.symbol = position.symbol;
        
        // Apply styling based on state
        if (this.pinnedAssets.has(position.symbol)) {
            card.classList.add('pinned');
        }
        
        if (this.hiddenAssets.has(position.symbol)) {
            card.classList.add('hidden');
        }
        
        if (position.unreconciled && this.config.highlightUnreconciled) {
            card.classList.add('unreconciled');
        }

        card.innerHTML = `
            <div class="position-header">
                <div class="position-symbol">${position.symbol}</div>
                <div class="position-indicators">
                    ${this.pinnedAssets.has(position.symbol) ? '<span class="indicator-pin" title="Pinned">📌</span>' : ''}
                    ${position.unreconciled ? '<span class="indicator-unreconciled" title="Unreconciled">⚠️</span>' : ''}
                </div>
            </div>
            
            <div class="position-metrics">
                <div class="metric-group">
                    <div class="metric-label">Value</div>
                    <div class="metric-value large">${this.formatCurrency(position.value)}</div>
                </div>
                
                <div class="metric-group">
                    <div class="metric-label">24h Change</div>
                    <div class="metric-value ${this.getChangeClass(position.day_pct)}">
                        ${this.formatPercentage(position.day_pct)}
                    </div>
                </div>
                
                <div class="metric-group">
                    <div class="metric-label">P/L</div>
                    <div class="metric-value ${this.getChangeClass(position.pnl_pct)}">
                        ${position.pnl_pct !== null ? this.formatPercentage(position.pnl_pct) : 'N/A'}
                    </div>
                </div>
                
                <div class="metric-group">
                    <div class="metric-label">Avg Cost</div>
                    <div class="metric-value">
                        ${position.avg_cost ? this.formatCurrency(position.avg_cost) : 'N/A'}
                    </div>
                </div>
            </div>
            
            <div class="position-footer">
                <div class="position-balance">${position.free.toFixed(8)} ${position.symbol}</div>
                <div class="position-price">${this.formatCurrency(position.price)}</div>
            </div>
        `;

        // Add touch event handlers
        this.addCardTouchHandlers(card, position);
        
        return card;
    }

    /**
     * Add touch event handlers to position card
     */
    addCardTouchHandlers(card, position) {
        let touchStartTime = 0;
        let touchStartPos = { x: 0, y: 0 };
        let longPressTimer = null;
        
        card.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
            const touch = e.touches[0];
            touchStartPos = { x: touch.clientX, y: touch.clientY };
            
            // Start long press timer
            longPressTimer = setTimeout(() => {
                this.handleCardLongPress(position.symbol);
                this.vibrate(50);
            }, 500);
        }, { passive: true });
        
        card.addEventListener('touchmove', (e) => {
            // Cancel long press if finger moves too much
            const touch = e.touches[0];
            const distance = Math.sqrt(
                Math.pow(touch.clientX - touchStartPos.x, 2) +
                Math.pow(touch.clientY - touchStartPos.y, 2)
            );
            
            if (distance > 10) {
                clearTimeout(longPressTimer);
            }
        }, { passive: true });
        
        card.addEventListener('touchend', (e) => {
            clearTimeout(longPressTimer);
            
            const touchDuration = Date.now() - touchStartTime;
            const touch = e.changedTouches[0];
            const distance = Math.sqrt(
                Math.pow(touch.clientX - touchStartPos.x, 2) +
                Math.pow(touch.clientY - touchStartPos.y, 2)
            );
            
            // Handle different touch gestures
            if (distance < 10) { // Tap (no movement)
                if (touchDuration < 300) {
                    // Single tap - select/highlight
                    this.handleCardTap(position.symbol);
                } else if (touchDuration >= 300 && touchDuration < 500) {
                    // Double tap - pin/unpin
                    this.handleCardDoubleTap(position.symbol);
                }
            }
        }, { passive: true });
    }

    /**
     * Handle card tap (selection)
     */
    handleCardTap(symbol) {
        // Remove previous selections
        document.querySelectorAll('.position-card.selected').forEach(card => {
            card.classList.remove('selected');
        });
        
        // Select this card
        const card = document.querySelector(`[data-symbol="${symbol}"]`);
        if (card) {
            card.classList.add('selected');
            setTimeout(() => card.classList.remove('selected'), 1000);
        }
    }

    /**
     * Handle card double tap (pin/unpin)
     */
    handleCardDoubleTap(symbol) {
        if (this.pinnedAssets.has(symbol)) {
            this.pinnedAssets.delete(symbol);
            this.showToast(`${symbol} unpinned`);
        } else {
            this.pinnedAssets.add(symbol);
            this.showToast(`${symbol} pinned to top`);
        }
        
        this.saveSettings();
        this.renderPortfolio(this.lastSnapshot);
        this.vibrate(30);
    }

    /**
     * Handle card long press (hide/show)
     */
    handleCardLongPress(symbol) {
        if (this.hiddenAssets.has(symbol)) {
            this.hiddenAssets.delete(symbol);
            this.showToast(`${symbol} shown`);
        } else {
            this.hiddenAssets.add(symbol);
            this.showToast(`${symbol} hidden`);
        }
        
        this.saveSettings();
        this.renderPortfolio(this.lastSnapshot);
    }

    /**
     * Sort positions array
     */
    sortPositions(positions, sortBy) {
        const sorted = [...positions];
        
        // First, separate pinned items
        const pinned = sorted.filter(p => this.pinnedAssets.has(p.symbol));
        const unpinned = sorted.filter(p => !this.pinnedAssets.has(p.symbol));
        
        // Sort each group
        const sortFunctions = {
            'value': (a, b) => b.value - a.value,
            'value-asc': (a, b) => a.value - b.value,
            'symbol': (a, b) => a.symbol.localeCompare(b.symbol),
            'symbol-desc': (a, b) => b.symbol.localeCompare(a.symbol),
            'change': (a, b) => b.day_pct - a.day_pct,
            'pnl': (a, b) => {
                const aPnl = a.pnl_pct !== null ? a.pnl_pct : -Infinity;
                const bPnl = b.pnl_pct !== null ? b.pnl_pct : -Infinity;
                return bPnl - aPnl;
            }
        };
        
        const sortFn = sortFunctions[sortBy] || sortFunctions.value;
        pinned.sort(sortFn);
        unpinned.sort(sortFn);
        
        return [...pinned, ...unpinned];
    }

    /**
     * Handle refresh button click
     */
    async handleRefresh() {
        if (this.isRefreshing) return;
        
        this.isRefreshing = true;
        this.elements['refresh-btn'].classList.add('refreshing');
        
        try {
            await this.fetchAndRender();
            this.playSound('success');
        } catch (error) {
            this.playSound('error');
        } finally {
            this.isRefreshing = false;
            this.elements['refresh-btn'].classList.remove('refreshing');
        }
    }

    /**
     * Handle sort change
     */
    handleSortChange(event) {
        this.sortBy = event.target.value;
        if (this.lastSnapshot) {
            this.renderPortfolio(this.lastSnapshot);
        }
    }

    /**
     * Handle filter change
     */
    handleFilterChange(event) {
        const { id, checked } = event.target;
        
        if (id === 'hide-small') {
            this.config.hideSmallPositions = checked;
        } else if (id === 'show-unreconciled') {
            this.config.highlightUnreconciled = checked;
        }
        
        this.saveSettings();
        
        if (this.lastSnapshot) {
            this.renderPortfolio(this.lastSnapshot);
        }
    }

    /**
     * Handle settings change
     */
    handleSettingsChange(event) {
        const { id, value, checked, type } = event.target;
        
        if (id === 'refresh-interval') {
            this.config.autoRefreshInterval = parseInt(value) || 0;
            this.startAutoRefresh();
        } else if (id === 'enable-sound') {
            this.config.enableSound = checked;
        } else if (id === 'compact-view') {
            this.config.compactView = checked;
            document.body.classList.toggle('compact-mode', checked);
        }
        
        this.saveSettings();
    }

    /**
     * Start auto-refresh timer
     */
    startAutoRefresh() {
        this.stopAutoRefresh();
        
        if (this.config.autoRefreshInterval > 0) {
            this.autoRefreshTimer = setInterval(() => {
                if (!document.hidden && !this.isRefreshing) {
                    this.fetchAndRender();
                }
            }, this.config.autoRefreshInterval);
        }
    }

    /**
     * Stop auto-refresh timer
     */
    stopAutoRefresh() {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
            this.autoRefreshTimer = null;
        }
    }

    /**
     * Handle touch start for pull-to-refresh
     */
    handleTouchStart(event) {
        if (window.scrollY === 0) {
            this.touchStartY = event.touches[0].clientY;
        }
    }

    /**
     * Handle touch move for pull-to-refresh
     */
    handleTouchMove(event) {
        if (window.scrollY > 0) return;
        
        const touchY = event.touches[0].clientY;
        const deltaY = touchY - this.touchStartY;
        
        if (deltaY > 0 && deltaY < this.pullThreshold * 2) {
            event.preventDefault();
            
            // Show pull indicator
            if (deltaY > this.pullThreshold) {
                this.elements['pull-to-refresh'].classList.remove('hidden');
                this.elements['pull-to-refresh'].style.transform = 
                    `translateX(-50%) translateY(${Math.min(deltaY - this.pullThreshold, 50)}px)`;
            }
        }
    }

    /**
     * Handle touch end for pull-to-refresh
     */
    handleTouchEnd(event) {
        if (window.scrollY > 0) return;
        
        const touchY = event.changedTouches[0].clientY;
        const deltaY = touchY - this.touchStartY;
        
        // Hide pull indicator
        this.elements['pull-to-refresh'].classList.add('hidden');
        this.elements['pull-to-refresh'].style.transform = 'translateX(-50%) translateY(0)';
        
        // Trigger refresh if pulled enough
        if (deltaY > this.pullThreshold && !this.isRefreshing) {
            this.handleRefresh();
            this.vibrate(50);
        }
        
        this.touchStartY = 0;
    }

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboard(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') {
            return; // Don't handle when typing in inputs
        }
        
        switch (event.code) {
            case 'KeyR':
                if (!event.ctrlKey && !event.metaKey) {
                    event.preventDefault();
                    this.handleRefresh();
                }
                break;
            case 'KeyS':
                event.preventDefault();
                this.showSettings();
                break;
            case 'Escape':
                this.hideSettings();
                break;
        }
    }

    /**
     * Handle visibility change (tab focus/blur)
     */
    handleVisibilityChange() {
        if (!document.hidden) {
            // Tab became visible, fetch fresh data
            this.fetchAndRender();
        }
    }

    /**
     * Show/hide UI states - with null checks
     */
    showLoading() {
        if (this.elements['loading-screen']) {
            this.elements['loading-screen'].classList.remove('hidden');
        }
        if (this.elements['error-screen']) {
            this.elements['error-screen'].classList.add('hidden');
        }
        if (this.elements['main-app']) {
            this.elements['main-app'].classList.add('hidden');
        }
        // For simple HTML, show loading indicator
        const loadingEl = document.getElementById('loadingIndicator');
        if (loadingEl) {
            loadingEl.style.display = 'block';
        }
    }

    hideLoading() {
        if (this.elements['loading-screen']) {
            this.elements['loading-screen'].classList.add('hidden');
        }
        // For simple HTML, hide loading indicator
        const loadingEl = document.getElementById('loadingIndicator');
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
    }

    showError(message) {
        if (this.elements['error-screen']) {
            this.elements['error-screen'].classList.remove('hidden');
            const errorMsg = this.elements['error-screen'].querySelector('.error-message');
            if (errorMsg) {
                errorMsg.textContent = message;
            }
        }
        if (this.elements['main-app']) {
            this.elements['main-app'].classList.add('hidden');
        }
        // For simple HTML, show error in console
        console.error('Portfolio Error:', message);
    }

    showEmptyState() {
        if (this.elements['main-app']) {
            this.elements['main-app'].classList.remove('hidden');
        }
        if (this.elements['empty-state']) {
            this.elements['empty-state'].classList.remove('hidden');
        }
        if (this.elements['positions-container']) {
            this.elements['positions-container'].innerHTML = '';
        }
        this.hideLoading();
    }

    showSettings() {
        if (this.elements['settings-modal']) {
            this.elements['settings-modal'].classList.remove('hidden');
        }
    }
    
    showApp() {
        // Simple method to show the app - for basic HTML
        if (this.elements['main-app']) {
            this.elements['main-app'].classList.remove('hidden');
        }
        this.hideLoading();
    }

    hideSettings() {
        if (this.elements['settings-modal']) {
            this.elements['settings-modal'].classList.add('hidden');
        }
    }

    /**
     * Set connection status indicator
     */
    setConnectionStatus(status) {
        const indicator = this.elements['connection-status'];
        if (!indicator) {
            // If no status indicator element, just log the status
            console.log('Connection status:', status);
            return;
        }
        
        indicator.className = `connection-indicator ${status}`;
        
        const statusText = {
            connected: '●',
            connecting: '●',
            disconnected: '●'
        };
        
        indicator.textContent = statusText[status] || '●';
    }

    /**
     * Update last refresh time
     */
    updateLastRefreshTime() {
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        // Check if element exists before updating
        if (this.elements['last-update']) {
            this.elements['last-update'].textContent = timeString;
        }
        
        // Also try updating the simple HTML element
        const lastUpdateEl = document.getElementById('lastUpdate');
        if (lastUpdateEl) {
            lastUpdateEl.textContent = `Last update: ${timeString}`;
        }
    }

    /**
     * Fetch and update scheduler status
     */
    async fetchSchedulerStatus() {
        try {
            const response = await fetch('/api/status');
            if (response.ok) {
                const data = await response.json();
                // The scheduler status is nested under the scheduler property
                if (data.scheduler && data.scheduler.scheduler) {
                    this.updateSchedulerStatus(data.scheduler.scheduler);
                }
            }
        } catch (error) {
            console.error('Failed to fetch scheduler status:', error);
        }
    }
    
    /**
     * Update scheduler status display
     */
    updateSchedulerStatus(status) {
        // Update simple HTML elements
        const schedulerStatusEl = document.getElementById('schedulerStatus');
        const nextPullEl = document.getElementById('nextPull');
        const successRateEl = document.getElementById('successRate');
        const uptimeEl = document.getElementById('uptime');
        
        if (schedulerStatusEl) {
            schedulerStatusEl.textContent = status.isRunning ? 'Running' : 'Stopped';
            schedulerStatusEl.className = status.isRunning ? 'status-running' : 'status-stopped';
        }
        
        if (nextPullEl && status.nextPullTime) {
            const nextTime = new Date(status.nextPullTime);
            nextPullEl.textContent = nextTime.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        }
        
        if (successRateEl && status.metrics) {
            const successRate = status.metrics.totalPulls > 0 
                ? (status.metrics.successfulPulls / status.metrics.totalPulls * 100).toFixed(1)
                : 0;
            successRateEl.textContent = `${successRate}%`;
        }
        
        if (uptimeEl && status.uptime) {
            const hours = Math.floor(status.uptime / 3600000);
            const minutes = Math.floor((status.uptime % 3600000) / 60000);
            uptimeEl.textContent = `${hours}h ${minutes}m`;
        }
    }
    
    /**
     * Clear all pinned assets
     */
    clearPinned() {
        this.pinnedAssets.clear();
        this.saveSettings();
        if (this.lastSnapshot) {
            this.renderPortfolio(this.lastSnapshot);
        }
        this.showToast('All pins cleared');
    }

    /**
     * Reset all hidden assets
     */
    resetHidden() {
        this.hiddenAssets.clear();
        this.saveSettings();
        if (this.lastSnapshot) {
            this.renderPortfolio(this.lastSnapshot);
        }
        this.showToast('All hidden positions shown');
    }

    /**
     * Utility functions
     */
    formatCurrency(value, currency = 'USD') {
        if (typeof value !== 'number' || isNaN(value)) return '$0.00';
        
        return value.toLocaleString('en-US', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    formatPercentage(value) {
        if (typeof value !== 'number' || isNaN(value)) return 'N/A';
        
        const sign = value >= 0 ? '+' : '';
        return `${sign}${value.toFixed(2)}%`;
    }

    formatNumber(value, decimals = 4) {
        if (typeof value !== 'number' || isNaN(value)) return '0';
        
        // For very small numbers, use more decimals
        if (value < 0.0001 && value > 0) {
            return value.toFixed(8);
        }
        
        // For regular numbers, use standard formatting
        return value.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: decimals
        });
    }

    getChangeClass(value) {
        if (typeof value !== 'number' || isNaN(value)) return 'neutral';
        return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
    }

    showToast(message) {
        // Simple toast implementation
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--bg-secondary);
            color: var(--text-primary);
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: var(--shadow-md);
            z-index: 1000;
            font-size: 14px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        
        document.body.appendChild(toast);
        
        // Animate in
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });
        
        // Remove after delay
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 2000);
    }

    playSound(type) {
        if (!this.config.enableSound) return;
        
        // Simple sound generation using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            const frequencies = {
                success: [523, 659], // C5, E5
                error: [392, 311]    // G4, Eb4
            };
            
            const freq = frequencies[type] || frequencies.success;
            oscillator.frequency.setValueAtTime(freq[0], audioContext.currentTime);
            oscillator.frequency.setValueAtTime(freq[1], audioContext.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (error) {
            // Sound not supported
        }
    }

    vibrate(duration) {
        if ('vibrate' in navigator) {
            navigator.vibrate(duration);
        }
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.portfolioUI = new PortfolioUI();
});

// Service worker registration (for offline functionality)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // For now, we'll skip service worker to keep it simple
        // navigator.serviceWorker.register('/sw.js');
    });
}