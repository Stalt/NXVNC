import RFB from '/novnc/core/rfb.js';
import { authFetch, checkAuth, logout, getUser, getToken } from './auth.js';

class NXVNCApp {
    constructor() {
        this.rfb = null;
        this.connected = false;
        this.reconnectTimer = null;
        this.connectionTimeout = null;
        this.lastHost = '';
        this.lastPort = '';
        this.lastPassword = '';
        this.frameRateInterval = null;
        this.user = null;
        this.freeMode = false;
        this.sessionTimer = null;
        this.sessionCountdownInterval = null;
        this.cooldownTimer = null;
        this.cooldownEndTime = 0;

        this.settings = this.loadSettings();

        this.elements = {
            sidebar: document.getElementById('sidebar'),
            toggleSidebar: document.getElementById('btn-toggle-sidebar'),
            toolbar: document.getElementById('toolbar'),
            vncContainer: document.getElementById('vnc-container'),
            vncStatus: document.getElementById('vnc-status'),
            vncScreen: document.getElementById('vnc-screen'),
            connectionInfo: document.getElementById('connection-info'),
            connectionsList: document.getElementById('connections-list'),
            // User info
            userInfo: document.getElementById('user-info'),
            btnLogout: document.getElementById('btn-logout'),
            btnAdmin: document.getElementById('btn-admin'),
            // Form inputs
            connName: document.getElementById('conn-name'),
            connHost: document.getElementById('conn-host'),
            connPort: document.getElementById('conn-port'),
            connPassword: document.getElementById('conn-password'),
            connProtocol: document.getElementById('conn-protocol'),
            // Buttons
            btnConnect: document.getElementById('btn-connect'),
            btnSave: document.getElementById('btn-save'),
            btnDisconnect: document.getElementById('btn-disconnect'),
            btnFullscreen: document.getElementById('btn-fullscreen'),
            btnScale: document.getElementById('btn-scale'),
            btnKeys: document.getElementById('btn-keys'),
            btnClipboard: document.getElementById('btn-clipboard'),
            // Modals
            clipboardModal: document.getElementById('clipboard-modal'),
            keysModal: document.getElementById('keys-modal'),
            clipboardText: document.getElementById('clipboard-text'),
            btnClipboardSend: document.getElementById('btn-clipboard-send'),
            btnClipboardClear: document.getElementById('btn-clipboard-clear'),
            // Settings
            settingsToggle: document.getElementById('settings-toggle'),
            settingsBody: document.getElementById('settings-body'),
            settingsArrow: document.getElementById('settings-arrow'),
            setQuality: document.getElementById('set-quality'),
            setQualityVal: document.getElementById('set-quality-val'),
            setCompression: document.getElementById('set-compression'),
            setCompressionVal: document.getElementById('set-compression-val'),
            setColorDepth: document.getElementById('set-color-depth'),
            setVideoStreaming: document.getElementById('set-video-streaming'),
            setScaleMode: document.getElementById('set-scale-mode'),
            setZoom: document.getElementById('set-zoom'),
            setZoomVal: document.getElementById('set-zoom-val'),
            zoomGroup: document.getElementById('zoom-group'),
            setResizeSession: document.getElementById('set-resize-session'),
            setClipViewport: document.getElementById('set-clip-viewport'),
            setLockAspect: document.getElementById('set-lock-aspect'),
            setFramerate: document.getElementById('set-framerate'),
            setCursor: document.getElementById('set-cursor'),
            setShared: document.getElementById('set-shared'),
            setReconnect: document.getElementById('set-reconnect'),
            setReconnectDelay: document.getElementById('set-reconnect-delay'),
            reconnectDelayGroup: document.getElementById('reconnect-delay-group'),
            setViewOnly: document.getElementById('set-view-only'),
            setKeyboardGrab: document.getElementById('set-keyboard-grab'),
            setTouchMode: document.getElementById('set-touch-mode'),
            setTimeout: document.getElementById('set-timeout'),
            setWsCompression: document.getElementById('set-ws-compression'),
        };

        this.init();
    }

    async init() {
        this.user = await checkAuth();
        if (!this.user) return; // Redirected to login

        this.applyRoleRestrictions();
        this.applySettingsToUI();
        this.bindEvents();
        this.loadConnections();
        this.checkFreeMode();
    }

    applyRoleRestrictions() {
        // Show user info
        if (this.elements.userInfo) {
            this.elements.userInfo.innerHTML = `
                <span class="user-name">${this.escapeHtml(this.user.displayName || this.user.username)}</span>
                <span class="user-role role-${this.user.role}">${this.user.role}</span>
            `;
        }

        // Show admin button only for admins
        if (this.elements.btnAdmin) {
            this.elements.btnAdmin.classList.toggle('hidden', this.user.role !== 'admin');
        }

        // Viewers: force view-only, hide save button and input controls
        if (this.user.role === 'viewer') {
            this.settings.viewOnly = true;
            if (this.elements.btnSave) this.elements.btnSave.classList.add('hidden');
            if (this.elements.btnKeys) this.elements.btnKeys.classList.add('hidden');
            if (this.elements.btnClipboard) this.elements.btnClipboard.classList.add('hidden');
            if (this.elements.connPassword) this.elements.connPassword.parentElement.classList.add('hidden');
            // Hide the new connection form for viewers
            const connectForm = document.querySelector('.connect-form');
            if (connectForm) connectForm.classList.add('hidden');
        }
    }

    // --- Settings persistence ---

    defaultSettings() {
        return {
            qualityLevel: 6,
            compressionLevel: 2,
            colorDepth: 24,
            videoStreaming: true,
            scaleMode: 'fit',
            zoom: 100,
            resizeSession: false,
            clipViewport: false,
            lockAspect: true,
            framerate: 0,
            cursor: 'local',
            shared: true,
            reconnect: false,
            reconnectDelay: 3,
            viewOnly: false,
            keyboardGrab: false,
            touchMode: false,
            timeout: 30,
            wsCompression: false,
        };
    }

    loadSettings() {
        try {
            const saved = localStorage.getItem('nxvnc-settings');
            if (saved) return { ...this.defaultSettings(), ...JSON.parse(saved) };
        } catch (e) { /* ignore */ }
        return this.defaultSettings();
    }

    saveSettings() {
        localStorage.setItem('nxvnc-settings', JSON.stringify(this.settings));
    }

    applySettingsToUI() {
        const s = this.settings;
        const el = this.elements;
        el.setQuality.value = s.qualityLevel;
        el.setQualityVal.textContent = s.qualityLevel;
        el.setCompression.value = s.compressionLevel;
        el.setCompressionVal.textContent = s.compressionLevel;
        el.setColorDepth.value = s.colorDepth;
        el.setVideoStreaming.checked = s.videoStreaming;
        el.setScaleMode.value = s.scaleMode;
        el.setZoom.value = s.zoom;
        el.setZoomVal.textContent = s.zoom;
        el.zoomGroup.style.display = s.scaleMode === 'manual' ? '' : 'none';
        el.setResizeSession.checked = s.resizeSession;
        el.setClipViewport.checked = s.clipViewport;
        el.setLockAspect.checked = s.lockAspect;
        el.setFramerate.value = s.framerate;
        el.setCursor.value = s.cursor;
        el.setShared.checked = s.shared;
        el.setReconnect.checked = s.reconnect;
        el.setReconnectDelay.value = s.reconnectDelay;
        el.reconnectDelayGroup.style.display = s.reconnect ? '' : 'none';
        el.setViewOnly.checked = s.viewOnly;
        el.setKeyboardGrab.checked = s.keyboardGrab;
        el.setTouchMode.checked = s.touchMode;
        el.setTimeout.value = s.timeout;
        el.setWsCompression.checked = s.wsCompression;

        this.applyScaleMode();
        this.applyAspectRatio();
        this.applyCursorMode();
        this.applyTouchMode();
    }

    bindEvents() {
        // Connect / Save
        this.elements.btnConnect.addEventListener('click', () => this.connect());
        if (this.elements.btnSave) {
            this.elements.btnSave.addEventListener('click', () => this.saveConnection());
        }
        this.elements.btnDisconnect.addEventListener('click', () => this.disconnect());

        // Logout
        if (this.elements.btnLogout) {
            this.elements.btnLogout.addEventListener('click', () => logout());
        }

        // Admin panel
        if (this.elements.btnAdmin) {
            this.elements.btnAdmin.addEventListener('click', () => this.toggleAdminPanel());
        }

        // Sidebar toggle
        this.elements.toggleSidebar.addEventListener('click', () => this.toggleSidebar());

        // Toolbar buttons
        this.elements.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
        this.elements.btnScale.addEventListener('click', () => this.cycleScaleMode());
        this.elements.btnKeys.addEventListener('click', () => this.toggleModal('keys-modal'));
        this.elements.btnClipboard.addEventListener('click', () => this.toggleModal('clipboard-modal'));

        // Clipboard
        this.elements.btnClipboardSend.addEventListener('click', () => this.sendClipboard());
        this.elements.btnClipboardClear.addEventListener('click', () => {
            this.elements.clipboardText.value = '';
        });

        // Modal close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.modal;
                document.getElementById(modalId).classList.add('hidden');
            });
        });

        // Special key buttons
        document.querySelectorAll('.key-btn').forEach(btn => {
            btn.addEventListener('click', () => this.sendSpecialKeys(btn.dataset.keys));
        });

        // Allow Enter to connect from form fields
        [this.elements.connHost, this.elements.connPort, this.elements.connPassword].forEach(el => {
            if (el) {
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') this.connect();
                });
            }
        });

        // Settings toggle
        this.elements.settingsToggle.addEventListener('click', () => {
            this.elements.settingsBody.classList.toggle('hidden');
            this.elements.settingsArrow.textContent =
                this.elements.settingsBody.classList.contains('hidden') ? '\u25BE' : '\u25B4';
        });

        // --- Settings change handlers ---
        this.elements.setQuality.addEventListener('input', (e) => {
            this.settings.qualityLevel = parseInt(e.target.value);
            this.elements.setQualityVal.textContent = e.target.value;
            if (this.rfb) this.rfb.qualityLevel = this.settings.qualityLevel;
            this.saveSettings();
        });

        this.elements.setCompression.addEventListener('input', (e) => {
            this.settings.compressionLevel = parseInt(e.target.value);
            this.elements.setCompressionVal.textContent = e.target.value;
            if (this.rfb) this.rfb.compressionLevel = this.settings.compressionLevel;
            this.saveSettings();
        });

        this.elements.setColorDepth.addEventListener('change', (e) => {
            this.settings.colorDepth = parseInt(e.target.value);
            this.saveSettings();
            if (this.connected) this.showReconnectHint('Color depth');
        });

        this.elements.setVideoStreaming.addEventListener('change', (e) => {
            this.settings.videoStreaming = e.target.checked;
            this.saveSettings();
            if (this.connected) this.showReconnectHint('Video streaming');
        });

        this.elements.setScaleMode.addEventListener('change', (e) => {
            this.settings.scaleMode = e.target.value;
            this.elements.zoomGroup.style.display = e.target.value === 'manual' ? '' : 'none';
            this.applyScaleMode();
            this.saveSettings();
        });

        this.elements.setZoom.addEventListener('input', (e) => {
            this.settings.zoom = parseInt(e.target.value);
            this.elements.setZoomVal.textContent = e.target.value;
            this.applyScaleMode();
            this.saveSettings();
        });

        this.elements.setResizeSession.addEventListener('change', (e) => {
            this.settings.resizeSession = e.target.checked;
            if (this.rfb) this.rfb.resizeSession = this.settings.resizeSession;
            this.saveSettings();
        });

        this.elements.setClipViewport.addEventListener('change', (e) => {
            this.settings.clipViewport = e.target.checked;
            if (this.rfb) this.rfb.clipViewport = this.settings.clipViewport;
            this.applyScaleMode();
            this.saveSettings();
        });

        this.elements.setLockAspect.addEventListener('change', (e) => {
            this.settings.lockAspect = e.target.checked;
            this.applyAspectRatio();
            this.saveSettings();
        });

        this.elements.setFramerate.addEventListener('change', (e) => {
            this.settings.framerate = parseInt(e.target.value);
            this.applyFrameRateLimit();
            this.saveSettings();
        });

        this.elements.setCursor.addEventListener('change', (e) => {
            this.settings.cursor = e.target.value;
            this.applyCursorMode();
            this.saveSettings();
        });

        this.elements.setShared.addEventListener('change', (e) => {
            this.settings.shared = e.target.checked;
            this.saveSettings();
            if (this.connected) this.showReconnectHint('Shared session');
        });

        this.elements.setReconnect.addEventListener('change', (e) => {
            this.settings.reconnect = e.target.checked;
            this.elements.reconnectDelayGroup.style.display = e.target.checked ? '' : 'none';
            this.saveSettings();
        });

        this.elements.setReconnectDelay.addEventListener('change', (e) => {
            this.settings.reconnectDelay = parseInt(e.target.value) || 3;
            this.saveSettings();
        });

        this.elements.setViewOnly.addEventListener('change', (e) => {
            // Viewers can't uncheck this
            if (this.user.role === 'viewer') {
                e.target.checked = true;
                return;
            }
            this.settings.viewOnly = e.target.checked;
            if (this.rfb) this.rfb.viewOnly = this.settings.viewOnly;
            this.saveSettings();
        });

        this.elements.setKeyboardGrab.addEventListener('change', (e) => {
            this.settings.keyboardGrab = e.target.checked;
            if (this.rfb) this.rfb.focusOnClick = this.settings.keyboardGrab;
            this.saveSettings();
        });

        this.elements.setTouchMode.addEventListener('change', (e) => {
            this.settings.touchMode = e.target.checked;
            this.applyTouchMode();
            this.saveSettings();
        });

        this.elements.setTimeout.addEventListener('change', (e) => {
            this.settings.timeout = parseInt(e.target.value) || 30;
            this.saveSettings();
        });

        this.elements.setWsCompression.addEventListener('change', (e) => {
            this.settings.wsCompression = e.target.checked;
            this.saveSettings();
            if (this.connected) this.showReconnectHint('WebSocket compression');
        });

        // Keyboard grab
        document.addEventListener('keydown', (e) => {
            if (this.connected && this.settings.keyboardGrab) {
                if (e.altKey || e.metaKey || (e.ctrlKey && e.key !== 'c' && e.key !== 'v')) {
                    e.preventDefault();
                }
            }
        });
    }

    showReconnectHint(settingName) {
        console.log(`[nxvnc] ${settingName} changed — will apply on next connection`);
    }

    connect() {
        // Block if in cooldown
        if (this.cooldownEndTime && Date.now() < this.cooldownEndTime) {
            return;
        }

        const host = this.elements.connHost.value.trim();
        const port = this.elements.connPort.value.trim();
        const password = this.elements.connPassword ? this.elements.connPassword.value : '';

        if (!host || !port) {
            this.showStatus('Please enter host and port');
            return;
        }

        this.lastHost = host;
        this.lastPort = port;
        this.lastPassword = password;

        this.clearReconnectTimer();
        this.clearConnectionTimeout();
        this.clearSessionTimers();

        this.showStatus('<div class="spinner"></div><p>Connecting to ' + this.escapeHtml(host) + ':' + this.escapeHtml(port) + '...</p>');

        if (this.rfb) {
            this.rfb.disconnect();
            this.rfb = null;
        }

        // Build WebSocket URL with auth token
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = getToken();
        let wsUrl = `${wsProtocol}//${window.location.host}/websockify?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&token=${encodeURIComponent(token)}`;
        if (this.settings.wsCompression) wsUrl += '&compress=1';

        try {
            this.rfb = new RFB(this.elements.vncScreen, wsUrl, {
                credentials: { password: password || undefined },
                wsProtocols: ['binary'],
                shared: this.settings.shared,
            });

            this.applyAllSettings();

            // Connection timeout
            this.connectionTimeout = setTimeout(() => {
                if (!this.connected && this.rfb) {
                    this.rfb.disconnect();
                    this.showStatus('Connection timed out after ' + this.settings.timeout + 's');
                }
            }, this.settings.timeout * 1000);

            this.rfb.addEventListener('connect', () => {
                this.connected = true;
                this.clearConnectionTimeout();
                this.elements.vncStatus.classList.add('hidden');
                this.elements.vncScreen.classList.remove('hidden');
                this.elements.toolbar.classList.remove('hidden');
                this.elements.vncContainer.classList.add('has-toolbar');
                this.elements.connectionInfo.innerHTML =
                    `<span class="status-dot"></span>${this.escapeHtml(host)}:${this.escapeHtml(port)}`;
                this.updateScaleButton();
                this.applyFrameRateLimit();
                this.updateWatermark();

                // Free mode: start session countdown
                if (this.freeMode) {
                    this.showSessionCountdown(5 * 60 * 1000);
                }

                console.log('[nxvnc] Connected');
            });

            this.rfb.addEventListener('disconnect', (e) => {
                this.connected = false;
                this.clearConnectionTimeout();
                this.stopFrameRateLimit();
                this.clearSessionTimers();
                this.elements.vncScreen.classList.add('hidden');
                this.elements.toolbar.classList.add('hidden');
                this.elements.vncContainer.classList.remove('has-toolbar');

                // Check if disconnect was due to free session limit (code 4001)
                if (e.detail.reason === 'Free session time limit reached' || !e.detail.clean) {
                    // Re-check cooldown status from server
                    this.checkFreeMode().then(() => {
                        if (this.cooldownEndTime && Date.now() < this.cooldownEndTime) {
                            // Cooldown is active, UI already showing
                        } else if (e.detail.clean) {
                            this.showStatus('Disconnected');
                        } else {
                            this.showStatus('Connection lost');
                            if (this.settings.reconnect && !this.freeMode) {
                                this.scheduleReconnect();
                            }
                        }
                    });
                } else {
                    this.showStatus('Disconnected');
                }

                this.rfb = null;
                console.log('[nxvnc] Disconnected', e.detail.clean ? '(clean)' : '(unexpected)');
            });

            this.rfb.addEventListener('credentialsrequired', () => {
                const pw = (this.elements.connPassword && this.elements.connPassword.value) || prompt('VNC Password:');
                if (pw) {
                    this.rfb.sendCredentials({ password: pw });
                } else {
                    this.disconnect();
                }
            });

            this.rfb.addEventListener('clipboard', (e) => {
                this.elements.clipboardText.value = e.detail.text;
            });

            this.rfb.addEventListener('desktopname', (e) => {
                document.title = `NXVNC - ${e.detail.name}`;
            });

        } catch (err) {
            this.clearConnectionTimeout();
            this.showStatus('Connection failed: ' + err.message);
            console.error('[nxvnc] Connection error:', err);
        }
    }

    applyAllSettings() {
        if (!this.rfb) return;
        const s = this.settings;

        this.rfb.qualityLevel = s.qualityLevel;
        this.rfb.compressionLevel = s.compressionLevel;
        this.rfb.scaleViewport = (s.scaleMode === 'fit');
        this.rfb.resizeSession = s.resizeSession;
        this.rfb.clipViewport = s.clipViewport;
        this.rfb.viewOnly = s.viewOnly || (this.user && this.user.role === 'viewer');
        this.rfb.focusOnClick = s.keyboardGrab;

        this.applyCursorMode();
        this.applyScaleMode();
        this.applyAspectRatio();
    }

    disconnect() {
        this.clearReconnectTimer();
        this.clearConnectionTimeout();
        this.stopFrameRateLimit();
        this.clearSessionTimers();
        if (this.rfb) {
            this.rfb.disconnect();
            this.rfb = null;
        }
        this.connected = false;
    }

    // --- Auto-reconnect ---

    scheduleReconnect() {
        const delay = this.settings.reconnectDelay;
        let remaining = delay;
        this.showStatus(`Connection lost. Reconnecting in <span id="reconnect-countdown">${remaining}</span>s... <button id="btn-cancel-reconnect" class="btn btn-secondary" style="margin-left:12px">Cancel</button>`);

        const countdownEl = document.getElementById('reconnect-countdown');
        const cancelBtn = document.getElementById('btn-cancel-reconnect');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.clearReconnectTimer();
                this.showStatus('Reconnection cancelled');
            });
        }

        this.reconnectTimer = setInterval(() => {
            remaining--;
            if (countdownEl) countdownEl.textContent = remaining;
            if (remaining <= 0) {
                this.clearReconnectTimer();
                this.connect();
            }
        }, 1000);
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    clearConnectionTimeout() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }

    // --- Scale & Layout ---

    applyScaleMode() {
        const screen = this.elements.vncScreen;
        screen.classList.remove('scale-to-fit', 'scale-manual', 'scale-none');
        screen.style.removeProperty('--manual-zoom');

        switch (this.settings.scaleMode) {
            case 'fit':
                screen.classList.add('scale-to-fit');
                if (this.rfb) {
                    this.rfb.scaleViewport = true;
                    this.rfb.clipViewport = this.settings.clipViewport;
                }
                break;
            case 'manual':
                screen.classList.add('scale-manual');
                screen.style.setProperty('--manual-zoom', this.settings.zoom / 100);
                if (this.rfb) {
                    this.rfb.scaleViewport = false;
                    this.rfb.clipViewport = true;
                }
                break;
            case 'none':
                screen.classList.add('scale-none');
                if (this.rfb) {
                    this.rfb.scaleViewport = false;
                    this.rfb.clipViewport = this.settings.clipViewport;
                }
                break;
        }
        this.updateScaleButton();
    }

    applyAspectRatio() {
        this.elements.vncScreen.classList.toggle('lock-aspect', this.settings.lockAspect);
    }

    cycleScaleMode() {
        const modes = ['fit', 'manual', 'none'];
        const idx = modes.indexOf(this.settings.scaleMode);
        this.settings.scaleMode = modes[(idx + 1) % modes.length];
        this.elements.setScaleMode.value = this.settings.scaleMode;
        this.elements.zoomGroup.style.display = this.settings.scaleMode === 'manual' ? '' : 'none';
        this.applyScaleMode();
        this.saveSettings();
    }

    updateScaleButton() {
        const labels = { fit: 'Scale: Fit', manual: `Scale: ${this.settings.zoom}%`, none: 'Scale: 1:1' };
        this.elements.btnScale.textContent = labels[this.settings.scaleMode] || 'Scale';
    }

    // --- Frame rate limiter ---

    applyFrameRateLimit() {
        this.stopFrameRateLimit();
        if (!this.rfb || this.settings.framerate === 0) return;

        const canvas = this.elements.vncScreen.querySelector('canvas');
        if (!canvas) return;

        let lastDraw = 0;
        const interval = 1000 / this.settings.framerate;

        const originalStyle = canvas.style.visibility;
        this.frameRateInterval = setInterval(() => {
            const now = performance.now();
            if (now - lastDraw < interval) {
                canvas.style.visibility = 'hidden';
            } else {
                canvas.style.visibility = originalStyle || 'visible';
                lastDraw = now;
            }
        }, interval / 2);
    }

    stopFrameRateLimit() {
        if (this.frameRateInterval) {
            clearInterval(this.frameRateInterval);
            this.frameRateInterval = null;
            const canvas = this.elements.vncScreen.querySelector('canvas');
            if (canvas) canvas.style.visibility = 'visible';
        }
    }

    // --- Cursor mode ---

    applyCursorMode() {
        const screen = this.elements.vncScreen;
        screen.classList.remove('cursor-local', 'cursor-remote', 'cursor-hidden');

        switch (this.settings.cursor) {
            case 'local':
                screen.classList.add('cursor-local');
                if (this.rfb) this.rfb.showDotCursor = false;
                break;
            case 'remote':
                screen.classList.add('cursor-remote');
                if (this.rfb) this.rfb.showDotCursor = true;
                break;
            case 'hidden':
                screen.classList.add('cursor-hidden');
                if (this.rfb) this.rfb.showDotCursor = false;
                break;
        }
    }

    // --- Touch mode ---

    applyTouchMode() {
        this.elements.vncScreen.classList.toggle('touch-mode', this.settings.touchMode);
        if (this.rfb) {
            this.rfb.dragViewport = this.settings.touchMode;
        }
    }

    // --- Free mode / watermark ---

    async checkFreeMode() {
        try {
            const res = await authFetch('/api/v1/license/status');
            if (!res.ok) return;
            const data = await res.json();
            this.freeMode = data.freeMode;
            if (data.freeMode && data.cooldownRemaining > 0) {
                this.startCooldown(data.cooldownRemaining * 1000);
            }
            this.updateWatermark();
        } catch { /* ignore */ }
    }

    updateWatermark() {
        let watermark = document.getElementById('nxvnc-watermark');
        if (this.freeMode) {
            if (!watermark) {
                watermark = document.createElement('div');
                watermark.id = 'nxvnc-watermark';
                watermark.className = 'free-watermark';
                this.elements.vncContainer.appendChild(watermark);
            }
            watermark.innerHTML = 'NXVNC Free Edition &mdash; <a href="#" id="watermark-upgrade">Upgrade for unlimited sessions</a>';
            watermark.classList.remove('hidden');
            const link = document.getElementById('watermark-upgrade');
            if (link) link.addEventListener('click', (e) => { e.preventDefault(); });
        } else if (watermark) {
            watermark.classList.add('hidden');
        }
    }

    showSessionCountdown(limitMs) {
        this.clearSessionTimers();
        const startTime = Date.now();
        const endTime = startTime + limitMs;

        // Create or get countdown element in toolbar
        let el = document.getElementById('session-countdown');
        if (!el) {
            el = document.createElement('span');
            el.id = 'session-countdown';
            el.className = 'session-countdown';
            this.elements.toolbar.querySelector('.toolbar-left').appendChild(el);
        }
        el.classList.remove('hidden');

        this.sessionCountdownInterval = setInterval(() => {
            const remaining = Math.max(0, endTime - Date.now());
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            el.textContent = `Session: ${mins}:${secs.toString().padStart(2, '0')}`;
            if (remaining <= 60000) {
                el.classList.add('countdown-warn');
            }
            if (remaining <= 0) {
                this.clearSessionTimers();
            }
        }, 1000);
    }

    clearSessionTimers() {
        if (this.sessionCountdownInterval) {
            clearInterval(this.sessionCountdownInterval);
            this.sessionCountdownInterval = null;
        }
        const el = document.getElementById('session-countdown');
        if (el) el.classList.add('hidden');
    }

    startCooldown(durationMs) {
        this.cooldownEndTime = Date.now() + durationMs;
        this.elements.btnConnect.disabled = true;

        const updateCooldownUI = () => {
            const remaining = Math.max(0, this.cooldownEndTime - Date.now());
            if (remaining <= 0) {
                this.endCooldown();
                return;
            }
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            this.showStatus(
                `<div class="cooldown-notice">` +
                `<h3>Free Session Limit</h3>` +
                `<p>Session time limit reached. Please wait before reconnecting.</p>` +
                `<p class="cooldown-timer">${mins}:${secs.toString().padStart(2, '0')}</p>` +
                `<p class="cooldown-upgrade">Upgrade to remove all limits</p>` +
                `</div>`
            );
        };

        updateCooldownUI();
        this.cooldownTimer = setInterval(updateCooldownUI, 1000);
    }

    endCooldown() {
        if (this.cooldownTimer) {
            clearInterval(this.cooldownTimer);
            this.cooldownTimer = null;
        }
        this.cooldownEndTime = 0;
        this.elements.btnConnect.disabled = false;
        this.showStatus('Cooldown ended. You can connect again.');
    }

    // --- Admin panel ---

    toggleAdminPanel() {
        // Lazy-load admin module
        if (!this.adminLoaded) {
            import('./admin.js').then(mod => {
                this.adminModule = mod;
                mod.initAdmin(this);
                this.adminLoaded = true;
            }).catch(err => {
                console.error('[nxvnc] Failed to load admin module:', err);
            });
        } else if (this.adminModule) {
            this.adminModule.toggleAdmin();
        }
    }

    // --- UI helpers ---

    showStatus(html) {
        this.elements.vncStatus.innerHTML = html;
        this.elements.vncStatus.classList.remove('hidden');
        this.elements.vncScreen.classList.add('hidden');
    }

    toggleSidebar() {
        const collapsed = this.elements.sidebar.classList.toggle('collapsed');
        this.elements.toggleSidebar.classList.toggle('shifted', collapsed);
        this.elements.toolbar.classList.toggle('sidebar-collapsed', collapsed);
        this.elements.vncContainer.classList.toggle('sidebar-collapsed', collapsed);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    toggleModal(modalId) {
        document.getElementById(modalId).classList.toggle('hidden');
    }

    sendClipboard() {
        if (this.rfb && this.elements.clipboardText.value) {
            this.rfb.clipboardPasteFrom(this.elements.clipboardText.value);
        }
    }

    sendSpecialKeys(keyCombo) {
        if (!this.rfb) return;

        const keyMap = {
            'ctrl': 'ControlLeft',
            'alt': 'AltLeft',
            'del': 'Delete',
            'delete': 'Delete',
            'tab': 'Tab',
            'escape': 'Escape',
            'super': 'MetaLeft',
            'shift': 'ShiftLeft',
            'f1': 'F1', 'f2': 'F2', 'f3': 'F3', 'f4': 'F4',
            'c': 'KeyC', 'v': 'KeyV', 'z': 'KeyZ',
        };

        const keys = keyCombo.split('+').map(k => keyMap[k.toLowerCase()] || k);

        keys.forEach(key => {
            this.rfb.sendKey(this.domKeyToKeySym(key), key, true);
        });

        keys.reverse().forEach(key => {
            this.rfb.sendKey(this.domKeyToKeySym(key), key, false);
        });

        this.elements.keysModal.classList.add('hidden');
    }

    domKeyToKeySym(domKey) {
        const map = {
            'ControlLeft': 0xFFE3, 'ControlRight': 0xFFE4,
            'AltLeft': 0xFFE9, 'AltRight': 0xFFEA,
            'ShiftLeft': 0xFFE1, 'ShiftRight': 0xFFE2,
            'MetaLeft': 0xFFEB, 'MetaRight': 0xFFEC,
            'Delete': 0xFFFF, 'Tab': 0xFF09, 'Escape': 0xFF1B,
            'F1': 0xFFBE, 'F2': 0xFFBF, 'F3': 0xFFC0, 'F4': 0xFFC1,
            'KeyC': 0x0063, 'KeyV': 0x0076, 'KeyZ': 0x007A,
        };
        return map[domKey] || 0;
    }

    // --- Saved connections ---

    async loadConnections() {
        try {
            const res = await authFetch('/api/v1/connections');
            if (!res.ok) {
                if (res.status === 401) return logout();
                return;
            }
            const connections = await res.json();
            this.renderConnections(connections);
        } catch (err) {
            console.error('Failed to load connections:', err);
        }
    }

    async saveConnection() {
        const name = this.elements.connName.value.trim() || this.elements.connHost.value.trim();
        const host = this.elements.connHost.value.trim();
        const port = this.elements.connPort.value.trim();
        const protocol = this.elements.connProtocol.value;
        const password = this.elements.connPassword ? this.elements.connPassword.value : '';

        if (!host || !port) {
            this.showStatus('Please enter host and port to save');
            return;
        }

        try {
            const res = await authFetch('/api/v1/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, host, port, protocol, password }),
            });
            if (!res.ok) {
                const data = await res.json();
                this.showStatus(data.error || 'Failed to save');
                return;
            }
            this.loadConnections();
        } catch (err) {
            console.error('Failed to save connection:', err);
        }
    }

    async deleteConnection(id) {
        try {
            await authFetch(`/api/v1/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
            this.loadConnections();
        } catch (err) {
            console.error('Failed to delete connection:', err);
        }
    }

    renderConnections(connections) {
        if (!connections.length) {
            this.elements.connectionsList.innerHTML = '<p class="empty-state">No saved connections</p>';
            return;
        }

        this.elements.connectionsList.innerHTML = connections.map(c => `
            <div class="connection-card" data-id="${c.id}">
                <div class="card-name">${this.escapeHtml(c.name)}</div>
                <div class="card-details">${this.escapeHtml(c.host)}:${c.port} (${c.protocol})</div>
                <div class="card-actions">
                    <button class="card-btn-connect" data-host="${this.escapeHtml(c.host)}" data-port="${c.port}">Connect</button>
                    ${this.user.role !== 'viewer' ? `<button class="card-btn-delete" data-id="${c.id}">Delete</button>` : ''}
                </div>
            </div>
        `).join('');

        this.elements.connectionsList.querySelectorAll('.card-btn-connect').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.elements.connHost.value = btn.dataset.host;
                this.elements.connPort.value = btn.dataset.port;
                this.connect();
            });
        });

        this.elements.connectionsList.querySelectorAll('.card-btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteConnection(btn.dataset.id);
            });
        });
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

const app = new NXVNCApp();
