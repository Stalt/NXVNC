const WebSocket = require('ws');
const net = require('net');
const url = require('url');

class WebSocketProxy {
    constructor(server) {
        this.wss = new WebSocket.Server({ noServer: true });
        this.activeConnections = new Map();

        server.on('upgrade', (request, socket, head) => {
            const pathname = url.parse(request.url, true).pathname;

            // Expected path: /websockify?host=x&port=y
            if (pathname === '/websockify') {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.handleConnection(ws, request);
                });
            } else {
                socket.destroy();
            }
        });
    }

    handleConnection(ws, request) {
        const params = url.parse(request.url, true).query;
        const targetHost = params.host;
        const targetPort = parseInt(params.port, 10);

        if (!targetHost || !targetPort) {
            ws.close(1008, 'Missing host or port parameter');
            return;
        }

        console.log(`[proxy] Connecting to ${targetHost}:${targetPort}`);

        const tcp = net.createConnection(targetPort, targetHost, () => {
            console.log(`[proxy] TCP connected to ${targetHost}:${targetPort}`);
        });

        const connectionId = `${targetHost}:${targetPort}:${Date.now()}`;
        this.activeConnections.set(connectionId, { ws, tcp, targetHost, targetPort });

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

        // Cleanup on TCP close/error
        tcp.on('close', () => {
            console.log(`[proxy] TCP connection closed for ${targetHost}:${targetPort}`);
            this.cleanup(connectionId);
        });

        tcp.on('error', (err) => {
            console.error(`[proxy] TCP error for ${targetHost}:${targetPort}:`, err.message);
            ws.close(1011, `TCP connection error: ${err.message}`);
            this.cleanup(connectionId);
        });

        // Cleanup on WebSocket close/error
        ws.on('close', () => {
            console.log(`[proxy] WebSocket closed for ${targetHost}:${targetPort}`);
            tcp.destroy();
            this.cleanup(connectionId);
        });

        ws.on('error', (err) => {
            console.error(`[proxy] WebSocket error:`, err.message);
            tcp.destroy();
            this.cleanup(connectionId);
        });
    }

    cleanup(connectionId) {
        const conn = this.activeConnections.get(connectionId);
        if (conn) {
            if (conn.ws.readyState === WebSocket.OPEN) conn.ws.close();
            if (!conn.tcp.destroyed) conn.tcp.destroy();
            this.activeConnections.delete(connectionId);
        }
    }

    getActiveCount() {
        return this.activeConnections.size;
    }
}

module.exports = { WebSocketProxy };
