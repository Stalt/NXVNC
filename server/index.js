const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketProxy } = require('./proxy');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 6080;

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '..', 'client')));

// Serve noVNC library files
app.use('/novnc', express.static(path.join(__dirname, '..', 'node_modules', '@novnc', 'novnc', 'lib')));

// API endpoint for connection info (could be expanded for saved connections)
app.use(express.json());

// Store connections in memory (could be replaced with a database)
let savedConnections = [];

app.get('/api/connections', (req, res) => {
    res.json(savedConnections);
});

app.post('/api/connections', (req, res) => {
    const { name, host, port, protocol } = req.body;
    if (!name || !host || !port) {
        return res.status(400).json({ error: 'name, host, and port are required' });
    }
    const connection = {
        id: Date.now().toString(36),
        name,
        host,
        port: parseInt(port, 10),
        protocol: protocol || 'vnc',
        createdAt: new Date().toISOString()
    };
    savedConnections.push(connection);
    res.status(201).json(connection);
});

app.delete('/api/connections/:id', (req, res) => {
    savedConnections = savedConnections.filter(c => c.id !== req.params.id);
    res.json({ ok: true });
});

// WebSocket proxy — upgrades HTTP connections to WebSocket and bridges to TCP
const proxy = new WebSocketProxy(server);

server.listen(PORT, () => {
    console.log(`NXVNC server running on http://localhost:${PORT}`);
    console.log(`WebSocket proxy ready for VNC connections`);
});
