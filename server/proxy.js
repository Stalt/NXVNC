const WebSocket = require('ws');
const net = require('net');
const url = require('url');
const dns = require('dns');
const config = require('./config');
const { verifyWsToken } = require('./auth/auth');
const { logAudit } = require('./audit/audit');
const { checkLimits, isFreeMode, FREE_SESSION_LIMIT_MS, FREE_COOLDOWN_MS } = require('./license/license');

const HOSTNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/;
const MAX_HOSTNAME_LENGTH = 255;

/**
 * Checks whether an IP address falls within private or reserved ranges.
 * Supports both IPv4 and IPv6.
 */
function isPrivateIP(ip) {
    // IPv4 checks
    const ipv4Parts = ip.split('.').map(Number);
    if (ipv4Parts.length === 4 && ipv4Parts.every(p => p >= 0 && p <= 255)) {
        const [a, b] = ipv4Parts;
        if (a === 127) return true;                              // 127.0.0.0/8
        if (a === 10) return true;                               // 10.0.0.0/8
        if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12
        if (a === 192 && b === 168) return true;                 // 192.168.0.0/16
        if (a === 0) return true;                                // 0.0.0.0/8
        if (a === 169 && b === 254) return true;                 // 169.254.0.0/16 (link-local/cloud metadata)
        if (a === 100 && b >= 64 && b <= 127) return true;      // 100.64.0.0/10 (CGNAT)
        return false;
    }

    // IPv6 checks
    const normalized = ip.toLowerCase();
    if (normalized === '::1') return true;                       // IPv6 loopback
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7
    if (normalized.startsWith('fe80')) return true;              // fe80::/10 (link-local)
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Mapped) return isPrivateIP(v4Mapped[1]);

    return false;
}

/**
 * Validates a target host and port for SSRF protection.
 * Resolves hostnames via DNS and checks the resulting IP against blocked ranges.
 * Throws an error string if the target is not allowed.
 */
async function validateTarget(host, port) {
    // Port validation
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw 'Invalid port number';
    }

    // Hostname format validation
    if (host.length > MAX_HOSTNAME_LENGTH) {
        throw 'Hostname too long';
    }
    if (!HOSTNAME_REGEX.test(host)) {
        throw 'Invalid hostname format';
    }

    // Block known dangerous hostnames (unless private IPs are allowed)
    if (!config.allowPrivateIPs) {
        const lowerHost = host.toLowerCase();
        if (lowerHost === 'localhost' || lowerHost.endsWith('.local') || lowerHost.endsWith('.internal')) {
            throw 'Blocked hostname';
        }
    }

    // If host is already an IP, check it directly
    if (net.isIP(host)) {
        if (!config.allowPrivateIPs && isPrivateIP(host)) {
            throw 'Connection to private/reserved IP is not allowed';
        }
        return;
    }

    // Resolve hostname and check the resulting IP
    let result;
    try {
        result = await dns.promises.lookup(host);
    } catch (e) {
        throw 'DNS resolution failed';
    }

    if (!config.allowPrivateIPs && isPrivateIP(result.address)) {
        throw 'Hostname resolves to a private/reserved IP';
    }
}

class WebSocketProxy {
    constructor(server) {
        this.wss = new WebSocket.Server({ noServer: true });
        this.wssCompressed = null;
        this.activeConnections = new Map();
        this.activeUsers = new Set();
        // Track cooldown per user: userId -> cooldownExpiresAt (timestamp)
        this.cooldowns = new Map();
        this.connectionAttempts = new Map(); // userId -> [timestamps]

        server.on('upgrade', (request, socket, head) => {
            const parsed = url.parse(request.url, true);

            if (parsed.pathname === '/websockify') {
                // Authenticate WebSocket upgrade
                const token = parsed.query.token;
                if (!token) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }

                let authResult;
                try {
                    authResult = verifyWsToken(token);
                } catch (e) {
                    authResult = null;
                }

                if (!authResult || !authResult.user) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }

                const user = authResult.user;

                // WebSocket connection rate limiting
                if (!this.checkConnectionRate(user.id)) {
                    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
                    socket.destroy();
                    return;
                }

                // Check license limits
                const limits = checkLimits(this.activeUsers.size, this.activeConnections.size);
                if (!limits.allowed) {
                    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                    socket.destroy();
                    return;
                }

                // Free mode: check cooldown
                if (isFreeMode()) {
                    const cooldownUntil = this.cooldowns.get(user.id);
                    if (cooldownUntil && Date.now() < cooldownUntil) {
                        const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
                        socket.write(`HTTP/1.1 429 Too Many Requests\r\nX-WebVNC-Cooldown: ${remaining}\r\n\r\n`);
                        socket.destroy();
                        return;
                    }
                }

                const useCompression = parsed.query.compress === '1';
                if (useCompression && !this.wssCompressed) {
                    this.wssCompressed = new WebSocket.Server({
                        noServer: true,
                        perMessageDeflate: {
                            zlibDeflateOptions: { level: 6 },
                            threshold: 128,
                        }
                    });
                }

                const targetWss = useCompression && this.wssCompressed ? this.wssCompressed : this.wss;
                targetWss.handleUpgrade(request, socket, head, (ws) => {
                    this.handleConnection(ws, request, user);
                });
            } else {
                socket.destroy();
            }
        });
    }

    checkConnectionRate(userId, maxAttempts = 5, windowMs = 60000) {
        const now = Date.now();
        const attempts = this.connectionAttempts.get(userId) || [];
        const recent = attempts.filter(t => now - t < windowMs);
        recent.push(now);
        this.connectionAttempts.set(userId, recent);
        return recent.length <= maxAttempts;
    }

    async handleConnection(ws, request, user) {
        const params = url.parse(request.url, true).query;
        const targetHost = params.host;
        const targetPort = parseInt(params.port, 10);

        if (!targetHost || !targetPort) {
            ws.close(1008, 'Missing host or port parameter');
            return;
        }

        // SSRF protection: validate target before connecting
        try {
            await validateTarget(targetHost, targetPort);
        } catch (reason) {
            console.warn(`[proxy] Blocked connection attempt by ${user.username} to ${targetHost}:${targetPort} — ${reason}`);
            ws.close(1008, 'Connection to this host is not allowed');
            return;
        }

        const isViewer = user.role === 'viewer';
        const freeMode = isFreeMode();

        console.log(`[proxy] ${user.username} (${user.role}) connecting to ${targetHost}:${targetPort}${freeMode ? ' [FREE MODE]' : ''}`);

        const tcp = net.createConnection(targetPort, targetHost, () => {
            console.log(`[proxy] TCP connected to ${targetHost}:${targetPort}`);
        });

        const connectionId = `${targetHost}:${targetPort}:${Date.now()}`;
        this.activeConnections.set(connectionId, { ws, tcp, targetHost, targetPort, user, sessionTimer: null });
        this.activeUsers.add(user.id);

        logAudit(user.id, 'vnc_connect', `${targetHost}:${targetPort}`, null, { role: user.role, freeMode });

        // Send metadata to client
        const meta = { type: 'webvnc_meta', freeMode };
        if (isViewer) meta.viewOnly = true;
        if (freeMode) {
            meta.sessionLimitMs = FREE_SESSION_LIMIT_MS;
            meta.cooldownMs = FREE_COOLDOWN_MS;
        }
        // Send meta as text before VNC binary data starts
        ws.send(JSON.stringify(meta));

        // Free mode: set server-side session timer
        if (freeMode) {
            const timer = setTimeout(() => {
                console.log(`[proxy] Free session expired for ${user.username} at ${targetHost}:${targetPort}`);
                // Set cooldown
                this.cooldowns.set(user.id, Date.now() + FREE_COOLDOWN_MS);
                // Close with a specific code so client knows it's a session limit
                ws.close(4001, 'Free session time limit reached');
            }, FREE_SESSION_LIMIT_MS);

            const conn = this.activeConnections.get(connectionId);
            if (conn) conn.sessionTimer = timer;
        }

        // TCP -> WebSocket
        tcp.on('data', (data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });

        // WebSocket -> TCP
        ws.on('message', (data) => {
            if (tcp.writable) {
                tcp.write(data);
            }
        });

        tcp.on('close', () => {
            console.log(`[proxy] TCP connection closed for ${targetHost}:${targetPort}`);
            this.cleanup(connectionId);
        });

        tcp.on('error', (err) => {
            console.error(`[proxy] TCP error for ${targetHost}:${targetPort}:`, err.message);
            ws.close(1011, `TCP connection error: ${err.message}`);
            this.cleanup(connectionId);
        });

        ws.on('close', (code) => {
            console.log(`[proxy] WebSocket closed for ${targetHost}:${targetPort} (code: ${code})`);
            logAudit(user.id, 'vnc_disconnect', `${targetHost}:${targetPort}`, null, { code });
            tcp.destroy();
            this.cleanup(connectionId);
        });

        ws.on('error', (err) => {
            console.error('[proxy] WebSocket error:', err.message);
            tcp.destroy();
            this.cleanup(connectionId);
        });
    }

    cleanup(connectionId) {
        const conn = this.activeConnections.get(connectionId);
        if (conn) {
            // Clear session timer
            if (conn.sessionTimer) {
                clearTimeout(conn.sessionTimer);
                conn.sessionTimer = null;
            }

            if (conn.ws.readyState === WebSocket.OPEN) conn.ws.close();
            if (!conn.tcp.destroyed) conn.tcp.destroy();

            const userId = conn.user.id;
            this.activeConnections.delete(connectionId);

            const stillActive = [...this.activeConnections.values()].some(c => c.user.id === userId);
            if (!stillActive) {
                this.activeUsers.delete(userId);
            }
        }
    }

    getActiveCount() {
        return this.activeConnections.size;
    }

    getActiveUserCount() {
        return this.activeUsers.size;
    }
}

module.exports = { WebSocketProxy };
