// ==================================
// 설정 (Configuration)
// ==================================
const config = {
    apiEndpoint: '',
    refreshInterval: 2000,
    maxChartPoints: 30,
    maxLogEntries: 50,
    maxAlerts: 5,
    // 하트비트(옵션): 정적 루트로 HEAD 요청을 주기적으로 보내
    // LB의 통계 미들웨어가 RPS/응답시간을 지속 갱신하도록 유도
    heartbeat: {
        enabled: false,
        // 실제 API 트래픽으로 집계되도록 API 게이트웨리 헬스 체크 경로로 전송
        // (LB는 /api/*만 실제 트래픽으로 계산하고 HEAD/X-Heartbeat 는 제외)
        path: '/api/health',
        method: 'GET',
        interval: 2000,
        // 하트비트 헤더를 "true"로 보내면 LB가 하트비트로 분류하여 제외하므로 false로 둠
        headerName: 'X-Heartbeat',
        headerValue: 'false',
    },
};

// ==================================
// WS 하트비트 (gorilla/websocket 서버와 연결)
// ==================================
const wsHeartbeat = {
    socket: null,
    enabled: false,
    hbTimer: null,
    reconnectTimer: null,
    heartbeatIntervalMs: 5000,
    reconnectDelayMs: 2000,
    _connecting: false,
    _send(data) {
        try {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(data);
            }
        } catch (e) {
            eventBus.publish('log', { message: `WS send error: ${e.message}`, type: 'error' });
        }
    },
    _startHeartbeatLoop() {
        this._stopHeartbeatLoop();
        this.hbTimer = setInterval(() => this._send('hb'), this.heartbeatIntervalMs);
    },
    _stopHeartbeatLoop() {
        if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    },
    _scheduleReconnect() {
        if (!this.enabled) return;
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectDelayMs);
    },
    connect() {
        if (!this.enabled || this._connecting) return;
        this._connecting = true;
        try {
            const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
            const url = `${proto}://${location.host}/api/ws-heartbeat`;
            this.socket = new WebSocket(url);
            this.socket.onopen = () => {
                this._connecting = false;
                eventBus.publish('log', { message: 'WS heartbeat connected.' });
                this._startHeartbeatLoop();
            };
            this.socket.onclose = () => {
                this._connecting = false;
                eventBus.publish('log', { message: 'WS heartbeat disconnected.' });
                this._stopHeartbeatLoop();
                this._scheduleReconnect();
            };
            this.socket.onerror = () => {
                eventBus.publish('log', { message: 'WS heartbeat error.' , type: 'error'});
            };
            this.socket.onmessage = () => {
                // 서버에서 메시지를 받으면 최근 활동으로 취급되도록 주기 메시지를 계속 보냄
            };
        } catch (e) {
            this._connecting = false;
            eventBus.publish('log', { message: `WS heartbeat init failed: ${e.message}`, type: 'error' });
            this._scheduleReconnect();
        }
    },
    disconnect() {
        if (this.socket) {
            try { this.socket.close(); } catch (_) {}
            this.socket = null;
        }
        this._stopHeartbeatLoop();
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    },
    start() {
        if (this.enabled) return;
        this.enabled = true;
        this.connect();
    },
    stop() {
        this.enabled = false;
        this.disconnect();
    }
};

// ==================================
// 이벤트 버스 (Event Bus)
// ==================================
const eventBus = {
    events: {},
    subscribe(eventName, callback) {
        if (!this.events[eventName]) {
            this.events[eventName] = [];
        }
        this.events[eventName].push(callback);
    },
    publish(eventName, data) {
        if (this.events[eventName]) {
            this.events[eventName].forEach(callback => callback(data));
        }
    }
};

// ==================================
// API 서비스 모듈 (apiService)
// ==================================
const apiService = {
    monitoringEnabled: true,
    fetchIntervalId: null,
    heartbeatIntervalId: null,
    async fetchAllStats() {
        if (!this.monitoringEnabled) return;
        try {
            const response = await fetch(config.apiEndpoint + '/stats');
            if (!response.ok) {
               throw new Error("Backend communication error");
            }
            const combinedStats = await response.json();
            eventBus.publish('statsUpdated', { stats: combinedStats, isFetchSuccess: true });
        } catch (error) {
            eventBus.publish('fetchError', { error, isFetchSuccess: false });
        }
    },
    async sendHeartbeat() {
        if (!config.heartbeat.enabled) return;
        try {
            await fetch(config.heartbeat.path, {
                method: config.heartbeat.method,
                cache: 'no-store',
                headers: { [config.heartbeat.headerName]: config.heartbeat.headerValue },
            });
        } catch (_) {
            // 하트비트 실패는 조용히 무시 (RPS/응답시간 유지를 위한 보조 수단)
        }
    },
    async resetAllStats() {
        // 이 기능은 현재 구현되지 않음
        console.warn('Reset stats functionality is not implemented in the backend.');
        return Promise.resolve(true);
    },
    start() {
        this.monitoringEnabled = true;
        this.fetchAllStats();
        if (this.fetchIntervalId) clearInterval(this.fetchIntervalId);
        this.fetchIntervalId = setInterval(() => this.fetchAllStats(), config.refreshInterval);
        // 하트비트 루프 시작
        if (config.heartbeat.enabled) {
            if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = setInterval(() => this.sendHeartbeat(), config.heartbeat.interval);
        }
        eventBus.publish('log', { message: 'Monitoring started.' });
    },
    stop() {
        this.monitoringEnabled = false;
        if (this.fetchIntervalId) clearInterval(this.fetchIntervalId);
        if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId);
        eventBus.publish('log', { message: 'Monitoring paused.' });
    }
};

// ==================================
// 차트 모듈 (chartModule)
// ==================================
const chartModule = {
    charts: {},
    init() {
        const commonOptions = {
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { x: { ticks: { color: '#fff' } }, y: { ticks: { color: '#fff' }, beginAtZero: true } }
        };
        const throughputCanvas = document.getElementById('throughputChart');
        if (throughputCanvas) {
            this.charts.throughput = new Chart(throughputCanvas.getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [{ data: [], backgroundColor: '#3b82f6' }] },
            options: commonOptions
            });
        } else {
            this.charts.throughput = null;
        }
        eventBus.subscribe('statsUpdated', ({ stats }) => this.update(stats));
        eventBus.subscribe('reset', () => this.reset());
    },
    update(stats) {
        const lb = stats?.['load-balancer'];
        if (lb && lb.has_real_traffic === false) {
            // 실제 트래픽이 없으면 차트 포인트를 추가하지 않음
            return;
        }
        const now = new Date().toLocaleTimeString();
        const updateChart = (chart, data) => {
            if (!chart) return;
            chart.data.labels.push(now);
            chart.data.datasets[0].data.push(data);
            if (chart.data.labels.length > config.maxChartPoints) {
                chart.data.labels.shift();
                chart.data.datasets[0].data.shift();
            }
            chart.update('none');
        };
        updateChart(this.charts.throughput, stats?.['load-balancer']?.requests_per_second || 0);
    },
    reset() {
        Object.values(this.charts).forEach(chart => {
            if(chart) {
                chart.data.labels = [];
                chart.data.datasets[0].data = [];
                chart.update();
            }
        });
    }
};

// ==================================
// 상태 표시 모듈 (statusModule)
// ==================================
const statusModule = {
    elements: {},
    serviceDisplayNames: {
        'api-gateway': 'API Gateway', 'auth': 'Auth Service',
        'user_service': 'User Service', 'blog_service': 'Blog Service',
        'database': 'Database', 'cache': 'Cache'
    },
    init() {
        this.elements = {
            overallStatus: document.getElementById('overall-status'),
            activeServices: document.getElementById('active-services'),
            serverList: document.getElementById('server-list'),
            currentRps: document.getElementById('current-rps'),
            avgResponseTime: document.getElementById('avg-response-time'),
            dbStatus: document.getElementById('db-status'),
            cacheStatus: document.getElementById('cache-status'),
        };
        eventBus.subscribe('statsUpdated', ({ stats, isFetchSuccess }) => this.update(stats, isFetchSuccess));
        eventBus.subscribe('fetchError', ({ isFetchSuccess }) => this.update(null, isFetchSuccess));

        this.setInitialState();
    },
    setInitialState() {
        this.elements.overallStatus.textContent = 'CONNECTING...';
        this.elements.overallStatus.className = 'metric-value metric-warning';
        this.elements.activeServices.textContent = '0/0';
        this.elements.currentRps.textContent = '0.0';
        this.elements.avgResponseTime.textContent = '0ms';
        this.elements.dbStatus.textContent = 'N/A';
        if (this.elements.cacheStatus) this.elements.cacheStatus.textContent = 'N/A';
        this.elements.serverList.innerHTML = '';
    },
    update(stats, isFetchSuccess) {
        if (!isFetchSuccess || !stats) {
            this.elements.overallStatus.textContent = 'DISCONNECTED';
            this.elements.overallStatus.className = 'metric-value metric-danger';
            this.updateServerList(null, false);
            return;
        }

        const lbData = stats['load-balancer'];
        // IDLE 상태 표시는 유지하되, 핵심 KPI만 표기
        const hasReal = lbData?.has_real_traffic === true;
        if (!hasReal) {
            this.elements.overallStatus.textContent = 'IDLE';
            this.elements.overallStatus.className = 'metric-value metric-warning';
        }
        const serviceStates = this.updateServerList(stats, true);
        const healthyCount = serviceStates.filter(s => s.isHealthy).length;
        const totalCount = serviceStates.length;

        this.elements.activeServices.textContent = `${healthyCount}/${totalCount}`;

        if (healthyCount < totalCount) {
            this.elements.overallStatus.textContent = 'DEGRADED';
            this.elements.overallStatus.className = 'metric-value metric-danger';
        } else if ((lbData?.success_rate || 100) < 95) {
            this.elements.overallStatus.textContent = 'WARNING';
            this.elements.overallStatus.className = 'metric-value metric-warning';
        } else {
            this.elements.overallStatus.textContent = 'HEALTHY';
            this.elements.overallStatus.className = 'metric-value metric-good';
        }

        this.elements.currentRps.textContent = (lbData?.requests_per_second || 0).toFixed(1);
        const avgLifetime = (lbData?.avg_response_time_ms_lifetime ?? lbData?.avg_response_time_ms ?? 0);
        this.elements.avgResponseTime.textContent = `${avgLifetime.toFixed(1)}ms`;

        const dbIsHealthy = stats?.database?.status === 'healthy';
        this.elements.dbStatus.textContent = dbIsHealthy ? 'ONLINE' : 'OFFLINE';
        this.elements.dbStatus.className = `metric-value ${dbIsHealthy ? 'metric-good' : 'metric-danger'}`;
        if (this.elements.cacheStatus) {
            const cacheIsHealthy = stats?.cache?.status === 'healthy';
            this.elements.cacheStatus.textContent = cacheIsHealthy ? 'ONLINE' : 'OFFLINE';
            this.elements.cacheStatus.className = `metric-value ${cacheIsHealthy ? 'metric-good' : 'metric-danger'}`;
        }
    },
    updateServerList(stats, isLbHealthy) {
        // ... (이전과 동일한 리팩터링된 함수) ...
        const serverListElement = this.elements.serverList;
        if (!serverListElement) return [];
        serverListElement.innerHTML = '';

        const allServiceStates = [];
        allServiceStates.push({ name: 'Load Balancer', isHealthy: isLbHealthy });

        if (stats) {
            for (const key in this.serviceDisplayNames) {
                if (stats[key]) {
                    const serviceData = stats[key];
                    const isHealthy = serviceData.status === 'healthy' || serviceData.service_status === 'online';
                    allServiceStates.push({ name: this.serviceDisplayNames[key], isHealthy: isHealthy });
                }
            }
        }
        allServiceStates.forEach(service => {
            const li = document.createElement('li');
            li.className = 'server-item';
            const statusClass = service.isHealthy ? 'status-healthy' : 'status-error';
            li.innerHTML = `<span><span class="status-indicator ${statusClass}"></span>${service.name}</span><span>${service.isHealthy ? 'Online' : 'Offline'}</span>`;
            serverListElement.appendChild(li);
        });

        return allServiceStates;
    }
};

// ==================================
// 알림 모듈 (alertModule)
// ==================================
const alertModule = {
    init() {
        eventBus.subscribe('statsUpdated', ({ stats }) => this.checkAlerts(stats));
    },
    checkAlerts(stats) {
        if (!stats) return;
        // [단순화] 서비스 다운 상태만 알람
        const serviceStates = statusModule.updateServerList(stats, true);
        const downServices = serviceStates.filter(s => !s.isHealthy && s.name !== 'Load Balancer');
        if (downServices.length > 0) {
            this.addAlert('error', `${downServices.map(s => s.name).join(', ')} service(s) are offline.`);
        }
    },
    addAlert(type, message) {
        const container = document.getElementById('alerts-container');
        if (!container) return;
        const alertExists = [...container.children].some(child => child.textContent.includes(message));
        if (alertExists) return;
        const alert = document.createElement('li');
        alert.className = `alert-box alert-${type}`;
        alert.innerHTML = `<strong>${type.toUpperCase()}:</strong> ${message}`;
        container.insertBefore(alert, container.firstChild);
        if (container.children.length > config.maxAlerts) {
            container.removeChild(container.lastChild);
        }
    }
};

// ==================================
// 컨트롤 모듈 (controlsModule)
// ==================================
const controlsModule = {
    init() {
        document.getElementById('toggle-monitoring-btn')?.addEventListener('click', this.toggleMonitoring.bind(this));
        document.getElementById('refresh-btn')?.addEventListener('click', this.refresh);
        document.getElementById('reset-stats-btn')?.addEventListener('click', this.reset);
        document.getElementById('toggle-ws-heartbeat-btn')?.addEventListener('click', this.toggleWsHeartbeat.bind(this));
    },
    toggleMonitoring(event) {
        const btn = event.currentTarget;
        apiService.monitoringEnabled = !apiService.monitoringEnabled;
        if (apiService.monitoringEnabled) {
            btn.textContent = '모니터링 ON';
            btn.classList.add('active');
            apiService.start();
        } else {
            btn.textContent = '모니터링 OFF';
            btn.classList.remove('active');
            apiService.stop();
        }
    },
    toggleWsHeartbeat(event) {
        const btn = event.currentTarget;
        if (wsHeartbeat.enabled) {
            wsHeartbeat.stop();
            btn.textContent = 'WS 하트비트 OFF';
            btn.classList.remove('active');
        } else {
            wsHeartbeat.start();
            btn.textContent = 'WS 하트비트 ON';
            btn.classList.add('active');
        }
    },
    async reset() {
        eventBus.publish('log', { message: 'Resetting statistics...' });
        const success = await apiService.resetAllStats();
        if (success) {
            eventBus.publish('log', { message: 'Statistics have been reset.' });
            eventBus.publish('reset');
            await apiService.fetchAllStats();
        } else {
            eventBus.publish('log', { message: 'Failed to reset stats.', type: 'error' });
        }
    },
    refresh() {
        eventBus.publish('log', { message: 'Manual refresh triggered.' });
        apiService.fetchAllStats();
    }
};

// ==================================
// 유틸리티 모듈 (utilityModule)
// ==================================
const utilityModule = {
    startTime: Date.now(),
    init() {
        eventBus.subscribe('log', ({ message, type = 'info' }) => this.addLog(message, type));
        eventBus.subscribe('fetchError', ({ error }) => this.addLog(`[ERROR] ${error.message}`, 'error'));
        setInterval(() => this.updateTime(), 1000);
    },
    addLog(message, type = 'info') {
        const logsContainer = document.getElementById('logs-container');
        if (!logsContainer) return;
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logEntry.style.color = type === 'error' ? '#f87171' : '#ecf0f1';
        logsContainer.insertBefore(logEntry, logsContainer.firstChild);
        if (logsContainer.children.length > config.maxLogEntries) {
            logsContainer.removeChild(logsContainer.lastChild);
        }
    },
    updateTime() {
        const uptimeElem = document.getElementById('uptime');
        const timeElem = document.getElementById('current-time');
        if (timeElem) timeElem.textContent = new Date().toLocaleString();
        if (uptimeElem) {
            const uptime = Date.now() - this.startTime;
            const h = String(Math.floor(uptime / 3600000)).padStart(2, '0');
            const m = String(Math.floor((uptime % 3600000) / 60000)).padStart(2, '0');
            const s = String(Math.floor((uptime % 60000) / 1000)).padStart(2, '0');
            uptimeElem.textContent = `Uptime: ${h}:${m}:${s}`;
        }
    }
};

// ==================================
// 메인 실행 함수 (Main Entry Point)
// ==================================
function main() {
    chartModule.init();
    statusModule.init();
    alertModule.init();
    controlsModule.init();
    utilityModule.init();
    eventBus.publish('log', { message: 'Monitoring dashboard initialized.' });
    apiService.start();
}

document.addEventListener('DOMContentLoaded', main);
