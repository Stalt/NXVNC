import RFB from '/novnc/rfb.js';

class NXVNCApp {
    constructor() {
        this.rfb = null;
        this.connected = false;
        this.scaleToFit = true;

        this.elements = {
            sidebar: document.getElementById('sidebar'),
            toggleSidebar: document.getElementById('btn-toggle-sidebar'),
            toolbar: document.getElementById('toolbar'),
            vncContainer: document.getElementById('vnc-container'),
            vncStatus: document.getElementById('vnc-status'),
            vncScreen: document.getElementById('vnc-screen'),
            connectionInfo: document.getElementById('connection-info'),
            connectionsList: document.getElementById('connections-list'),
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
        };

        this.bindEvents();
        this.loadConnections();
    }

    bindEvents() {
        // Connect / Save
        this.elements.btnConnect.addEventListener('click', () => this.connect());
        this.elements.btnSave.addEventListener('click', () => this.saveConnection());
        this.elements.btnDisconnect.addEventListener('click', () => this.disconnect());

        // Sidebar toggle
        this.elements.toggleSidebar.addEventListener('click', () => this.toggleSidebar());

        // Toolbar buttons
        this.elements.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
        this.elements.btnScale.addEventListener('click', () => this.toggleScale());
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
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.connect();
            });
        });
    }

    connect() {
        const host = this.elements.connHost.value.trim();
        const port = this.elements.connPort.value.trim();
        const password = this.elements.connPassword.value;

        if (!host || !port) {
            this.showStatus('Please enter host and port');
            return;
        }

        this.showStatus('<div class="spinner"></div><p>Connecting to ' + this.escapeHtml(host) + ':' + this.escapeHtml(port) + '...</p>');

        // Disconnect existing session
        if (this.rfb) {
            this.rfb.disconnect();
            this.rfb = null;
        }

        // Build WebSocket URL pointing to our proxy
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/websockify?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`;

        try {
            this.rfb = new RFB(this.elements.vncScreen, wsUrl, {
                credentials: { password: password || undefined },
                wsProtocols: ['binary'],
            });

            this.rfb.scaleViewport = this.scaleToFit;
            this.rfb.resizeSession = false;
            this.rfb.clipViewport = false;

            // Event handlers
            this.rfb.addEventListener('connect', () => {
                this.connected = true;
                this.elements.vncStatus.classList.add('hidden');
                this.elements.vncScreen.classList.remove('hidden');
                this.elements.toolbar.classList.remove('hidden');
                this.elements.vncContainer.classList.add('has-toolbar');
                this.elements.connectionInfo.innerHTML =
                    `<span class="status-dot"></span>${this.escapeHtml(host)}:${this.escapeHtml(port)}`;
                console.log('[nxvnc] Connected');
            });

            this.rfb.addEventListener('disconnect', (e) => {
                this.connected = false;
                this.elements.vncScreen.classList.add('hidden');
                this.elements.toolbar.classList.add('hidden');
                this.elements.vncContainer.classList.remove('has-toolbar');
                if (e.detail.clean) {
                    this.showStatus('Disconnected');
                } else {
                    this.showStatus('Connection lost');
                }
                this.rfb = null;
                console.log('[nxvnc] Disconnected', e.detail.clean ? '(clean)' : '(unexpected)');
            });

            this.rfb.addEventListener('credentialsrequired', () => {
                const pw = this.elements.connPassword.value || prompt('VNC Password:');
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
            this.showStatus('Connection failed: ' + err.message);
            console.error('[nxvnc] Connection error:', err);
        }
    }

    disconnect() {
        if (this.rfb) {
            this.rfb.disconnect();
            this.rfb = null;
        }
        this.connected = false;
    }

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

    toggleScale() {
        this.scaleToFit = !this.scaleToFit;
        this.elements.vncScreen.classList.toggle('scale-to-fit', this.scaleToFit);
        if (this.rfb) {
            this.rfb.scaleViewport = this.scaleToFit;
        }
        this.elements.btnScale.textContent = this.scaleToFit ? 'Scale: On' : 'Scale: Off';
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
            'f1': 'F1',
            'f2': 'F2',
            'f3': 'F3',
            'f4': 'F4',
            'c': 'KeyC',
            'v': 'KeyV',
            'z': 'KeyZ',
        };

        const keys = keyCombo.split('+').map(k => keyMap[k.toLowerCase()] || k);

        // Press all keys down
        keys.forEach(key => {
            this.rfb.sendKey(this.domKeyToKeySym(key), key, true);
        });

        // Release all keys
        keys.reverse().forEach(key => {
            this.rfb.sendKey(this.domKeyToKeySym(key), key, false);
        });

        // Close the modal
        this.elements.keysModal.classList.add('hidden');
    }

    domKeyToKeySym(domKey) {
        // Map DOM key codes to X11 KeySyms used by VNC
        const map = {
            'ControlLeft': 0xFFE3,
            'ControlRight': 0xFFE4,
            'AltLeft': 0xFFE9,
            'AltRight': 0xFFEA,
            'ShiftLeft': 0xFFE1,
            'ShiftRight': 0xFFE2,
            'MetaLeft': 0xFFEB,
            'MetaRight': 0xFFEC,
            'Delete': 0xFFFF,
            'Tab': 0xFF09,
            'Escape': 0xFF1B,
            'F1': 0xFFBE,
            'F2': 0xFFBF,
            'F3': 0xFFC0,
            'F4': 0xFFC1,
            'KeyC': 0x0063,
            'KeyV': 0x0076,
            'KeyZ': 0x007A,
        };
        return map[domKey] || 0;
    }

    // --- Saved connections ---

    async loadConnections() {
        try {
            const res = await fetch('/api/connections');
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

        if (!host || !port) {
            this.showStatus('Please enter host and port to save');
            return;
        }

        try {
            await fetch('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, host, port, protocol }),
            });
            this.loadConnections();
        } catch (err) {
            console.error('Failed to save connection:', err);
        }
    }

    async deleteConnection(id) {
        try {
            await fetch(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
                    <button class="card-btn-delete" data-id="${c.id}">Delete</button>
                </div>
            </div>
        `).join('');

        // Bind card buttons
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

// Initialize app
const app = new NXVNCApp();
