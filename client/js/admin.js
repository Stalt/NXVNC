import { authFetch, logout } from './auth.js';

let adminVisible = false;
let appRef = null;

export function initAdmin(app) {
    appRef = app;
    createAdminPanel();
    toggleAdmin();
}

export function toggleAdmin() {
    const panel = document.getElementById('admin-panel');
    if (!panel) return;
    adminVisible = !adminVisible;
    panel.classList.toggle('hidden', !adminVisible);
    if (adminVisible) {
        loadUsers();
        loadAllConnections();
        loadLicense();
        loadAuditLog();
        loadLogging();
    }
}

function createAdminPanel() {
    if (document.getElementById('admin-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'admin-panel';
    panel.className = 'admin-panel hidden';
    panel.innerHTML = `
        <div class="admin-overlay" id="admin-overlay"></div>
        <div class="admin-window">
            <div class="admin-header">
                <h2>Administration</h2>
                <button class="modal-close" id="admin-close">&times;</button>
            </div>
            <div class="admin-tabs">
                <button class="admin-tab active" data-tab="users">Users</button>
                <button class="admin-tab" data-tab="connections">Connections</button>
                <button class="admin-tab" data-tab="license">License</button>
                <button class="admin-tab" data-tab="audit">Audit Log</button>
                <button class="admin-tab" data-tab="logging">Logging</button>
            </div>
            <div class="admin-body">
                <!-- Users Tab -->
                <div class="admin-tab-content active" id="tab-users">
                    <div class="admin-toolbar">
                        <button class="btn btn-primary" id="btn-add-user">Add User</button>
                    </div>
                    <div id="users-table-container"></div>
                </div>
                <!-- Connections Tab -->
                <div class="admin-tab-content" id="tab-connections">
                    <div class="admin-toolbar">
                        <button class="btn btn-primary" id="btn-add-connection">Add Connection</button>
                    </div>
                    <div id="admin-connections-container"></div>
                </div>
                <!-- License Tab -->
                <div class="admin-tab-content" id="tab-license">
                    <div id="license-info-container"></div>
                    <div class="form-group" style="margin-top:16px">
                        <label for="license-upload">Upload License File</label>
                        <textarea id="license-upload" rows="6" placeholder="Paste license file content here..." style="width:100%;padding:10px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-family:monospace;font-size:12px;resize:vertical;"></textarea>
                    </div>
                    <button class="btn btn-primary" id="btn-upload-license">Upload License</button>
                </div>
                <!-- Audit Tab -->
                <div class="admin-tab-content" id="tab-audit">
                    <div class="admin-toolbar">
                        <select id="audit-filter-action" style="padding:6px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:12px;">
                            <option value="">All Actions</option>
                            <option value="login">Login</option>
                            <option value="login_failed">Login Failed</option>
                            <option value="logout">Logout</option>
                            <option value="vnc_connect">VNC Connect</option>
                            <option value="vnc_disconnect">VNC Disconnect</option>
                            <option value="user_create">User Create</option>
                            <option value="user_update">User Update</option>
                            <option value="user_delete">User Delete</option>
                            <option value="password_change">Password Change</option>
                            <option value="password_reset">Password Reset</option>
                            <option value="connection_create">Connection Create</option>
                            <option value="connection_delete">Connection Delete</option>
                            <option value="license_update">License Update</option>
                        </select>
                        <button class="btn btn-secondary" id="btn-refresh-audit">Refresh</button>
                    </div>
                    <div id="audit-table-container"></div>
                    <div class="admin-pagination" id="audit-pagination"></div>
                </div>
                <!-- Logging Tab -->
                <div class="admin-tab-content" id="tab-logging">
                    <div class="admin-toolbar">
                        <button class="btn btn-secondary" id="btn-refresh-logging">Refresh</button>
                    </div>
                    <div id="logging-stats-container"></div>
                    <div class="logging-settings" style="margin-top:20px">
                        <h3 style="color:#e0e0e0;margin-bottom:12px;font-size:15px;">Log Settings</h3>
                        <div class="form-group">
                            <label for="log-retention-days">Audit Log Retention</label>
                            <select id="log-retention-days" class="form-control">
                                <option value="7">7 days</option>
                                <option value="30">30 days</option>
                                <option value="60">60 days</option>
                                <option value="90">90 days</option>
                                <option value="180">180 days</option>
                                <option value="365">365 days</option>
                                <option value="0">Never (keep all)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="log-level-select">Server Log Level</label>
                            <select id="log-level-select" class="form-control">
                                <option value="debug">Debug</option>
                                <option value="info">Info</option>
                                <option value="warn">Warning</option>
                                <option value="error">Error only</option>
                            </select>
                        </div>
                        <div style="display:flex;gap:8px;margin-top:12px">
                            <button class="btn btn-primary" id="btn-save-log-settings">Save Settings</button>
                            <button class="btn btn-secondary" id="btn-purge-audit">Purge Old Records Now</button>
                            <button class="btn btn-secondary" id="btn-download-service-log">Download Service Log</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(panel);
    bindAdminEvents();
}

function bindAdminEvents() {
    document.getElementById('admin-close').addEventListener('click', toggleAdmin);
    document.getElementById('admin-overlay').addEventListener('click', toggleAdmin);

    // Tabs
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            if (tab.dataset.tab === 'logging') loadLogging();
        });
    });

    document.getElementById('btn-add-user').addEventListener('click', showAddUserDialog);
    document.getElementById('btn-add-connection').addEventListener('click', showAddConnectionDialog);
    document.getElementById('btn-upload-license').addEventListener('click', uploadLicense);
    document.getElementById('btn-refresh-audit').addEventListener('click', () => loadAuditLog());
    document.getElementById('audit-filter-action').addEventListener('change', () => loadAuditLog());

    // Logging tab handlers
    document.getElementById('btn-refresh-logging')?.addEventListener('click', loadLogging);

    document.getElementById('btn-save-log-settings')?.addEventListener('click', async () => {
        const retentionDays = document.getElementById('log-retention-days').value;
        const logLevel = document.getElementById('log-level-select').value;

        try {
            await authFetch('/api/v1/settings/auditRetentionDays', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: retentionDays })
            });

            await authFetch('/api/v1/settings/logLevel', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: logLevel })
            });

            showToast('Log settings saved', 'success');
            loadLogging();
        } catch (e) {
            showToast('Failed to save settings', 'error');
        }
    });

    document.getElementById('btn-purge-audit')?.addEventListener('click', async () => {
        if (!confirm('Purge audit records older than the retention period?')) return;

        try {
            const res = await authFetch('/api/v1/settings/logging/purge', {
                method: 'POST'
            });
            const data = await res.json();
            showToast(`Purged ${data.deleted} records (retention: ${data.retentionDays} days)`, 'success');
            loadLogging();
        } catch (e) {
            showToast('Failed to purge records', 'error');
        }
    });

    document.getElementById('btn-download-service-log')?.addEventListener('click', () => {
        window.open('/api/v1/settings/logging/service-log', '_blank');
    });

    // Modal form handlers
    document.getElementById('add-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('add-user-username').value.trim();
        const password = document.getElementById('add-user-password').value;
        const role = document.getElementById('add-user-role').value;
        const errorEl = document.getElementById('add-user-error');

        if (password.length < 8) {
            errorEl.textContent = 'Password must be at least 8 characters';
            errorEl.classList.remove('hidden');
            return;
        }

        const res = await authFetch('/api/v1/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role }),
        });
        if (res.ok) {
            document.getElementById('add-user-modal').classList.add('hidden');
            showToast('User created successfully');
            loadUsers();
        } else {
            const d = await res.json();
            errorEl.textContent = d.error || 'Failed to create user';
            errorEl.classList.remove('hidden');
        }
    });

    document.getElementById('edit-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-user-id').value;
        const role = document.getElementById('edit-user-role').value;
        const displayName = document.getElementById('edit-user-display').value.trim();

        await authFetch(`/api/v1/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, displayName }),
        });
        document.getElementById('edit-user-modal').classList.add('hidden');
        showToast('User updated successfully');
        loadUsers();
    });

    document.getElementById('reset-pw-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('reset-pw-user-id').value;
        const newPassword = document.getElementById('reset-pw-input').value;
        const errorEl = document.getElementById('reset-pw-error');

        if (newPassword.length < 8) {
            errorEl.textContent = 'Password must be at least 8 characters';
            errorEl.classList.remove('hidden');
            return;
        }

        await authFetch(`/api/v1/users/${id}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword }),
        });
        document.getElementById('reset-pw-modal').classList.add('hidden');
        showToast('Password reset. User will be required to change it on next login.');
    });

    // Connection form handlers
    document.getElementById('add-conn-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('add-conn-name').value.trim();
        const host = document.getElementById('add-conn-host').value.trim();
        const port = document.getElementById('add-conn-port').value.trim();
        const password = document.getElementById('add-conn-password').value;
        const errorEl = document.getElementById('add-conn-error');

        if (!name || !host || !port) {
            errorEl.textContent = 'Name, host and port are required';
            errorEl.classList.remove('hidden');
            return;
        }

        const res = await authFetch('/api/v1/connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, host, port, protocol: 'vnc', password }),
        });
        if (res.ok) {
            document.getElementById('add-conn-modal').classList.add('hidden');
            showToast('Connection created');
            loadAllConnections();
            if (appRef) appRef.loadConnections();
        } else {
            const d = await res.json();
            errorEl.textContent = d.error || 'Failed to create connection';
            errorEl.classList.remove('hidden');
        }
    });

    document.getElementById('edit-conn-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-conn-id').value;
        const name = document.getElementById('edit-conn-name').value.trim();
        const host = document.getElementById('edit-conn-host').value.trim();
        const port = document.getElementById('edit-conn-port').value.trim();
        const password = document.getElementById('edit-conn-password').value;

        const body = { name, host, port };
        if (password) body.password = password;

        await authFetch(`/api/v1/connections/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        document.getElementById('edit-conn-modal').classList.add('hidden');
        showToast('Connection updated');
        loadAllConnections();
        if (appRef) appRef.loadConnections();
    });

    document.getElementById('assign-conn-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('assign-conn-id').value;
        const checkboxes = document.querySelectorAll('#assign-conn-users input[type="checkbox"]:checked');
        const userIds = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

        await authFetch(`/api/v1/connections/${id}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds }),
        });
        document.getElementById('assign-conn-modal').classList.add('hidden');
        showToast('Connection assignment updated');
        loadAllConnections();
    });

    // Close modal buttons (for new modals)
    document.querySelectorAll('[data-modal]').forEach(btn => {
        if (btn.classList.contains('modal-close') || btn.tagName === 'BUTTON') {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.modal;
                if (modalId) document.getElementById(modalId).classList.add('hidden');
            });
        }
    });
}

// --- Users ---

async function loadUsers() {
    const res = await authFetch('/api/v1/users');
    if (!res.ok) return;
    const users = await res.json();

    const container = document.getElementById('users-table-container');
    if (!users.length) {
        container.innerHTML = '<p class="empty-state">No users</p>';
        return;
    }

    container.innerHTML = `
        <table class="admin-table">
            <thead><tr><th>Username</th><th>Display Name</th><th>Role</th><th>Enabled</th><th>Actions</th></tr></thead>
            <tbody>
                ${users.map(u => `
                    <tr>
                        <td>${esc(u.username)}</td>
                        <td>${esc(u.display_name || '')}</td>
                        <td><span class="role-badge role-${u.role}">${u.role}</span></td>
                        <td>${u.enabled ? 'Yes' : 'No'}</td>
                        <td class="action-cell">
                            <button class="btn-sm" onclick="window._adminEditUser(${u.id})">Edit</button>
                            <button class="btn-sm" onclick="window._adminResetPw(${u.id})">Reset PW</button>
                            ${u.enabled ? `<button class="btn-sm btn-sm-danger" onclick="window._adminDeleteUser(${u.id})">Disable</button>` : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

window._adminEditUser = async (id) => {
    const res = await authFetch(`/api/v1/users/${id}`);
    if (!res.ok) return;
    const user = await res.json();

    document.getElementById('edit-user-id').value = id;
    document.getElementById('edit-user-title').textContent = user.username;
    document.getElementById('edit-user-role').value = user.role;
    document.getElementById('edit-user-display').value = user.display_name || '';
    document.getElementById('edit-user-modal').classList.remove('hidden');
};

window._adminResetPw = async (id) => {
    document.getElementById('reset-pw-user-id').value = id;
    document.getElementById('reset-pw-input').value = '';
    document.getElementById('reset-pw-error').classList.add('hidden');
    document.getElementById('reset-pw-modal').classList.remove('hidden');
};

window._adminDeleteUser = async (id) => {
    showConfirm('Disable User', 'Are you sure you want to disable this user?', async () => {
        await authFetch(`/api/v1/users/${id}`, { method: 'DELETE' });
        loadUsers();
    });
};

function showAddUserDialog() {
    document.getElementById('add-user-form').reset();
    document.getElementById('add-user-error').classList.add('hidden');
    document.getElementById('add-user-modal').classList.remove('hidden');
}

function showConfirm(title, message, onConfirm) {
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-message').textContent = message;
    document.getElementById('confirm-modal').classList.remove('hidden');
    const yesBtn = document.getElementById('confirm-modal-yes');
    const handler = () => {
        yesBtn.removeEventListener('click', handler);
        document.getElementById('confirm-modal').classList.add('hidden');
        onConfirm();
    };
    yesBtn.replaceWith(yesBtn.cloneNode(true));
    document.getElementById('confirm-modal-yes').addEventListener('click', handler);
}

export function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast-fade'); }, 2500);
    setTimeout(() => { toast.remove(); }, 3000);
}

// --- Connections ---

let cachedUsers = [];

async function fetchUsers() {
    const res = await authFetch('/api/v1/users');
    if (res.ok) cachedUsers = await res.json();
    return cachedUsers;
}

function getUsernameById(id) {
    const u = cachedUsers.find(u => u.id === id);
    return u ? u.username : `#${id}`;
}

async function loadAllConnections() {
    await fetchUsers();
    const res = await authFetch('/api/v1/connections');
    if (!res.ok) return;
    const connections = await res.json();

    const container = document.getElementById('admin-connections-container');
    if (!connections.length) {
        container.innerHTML = '<p class="empty-state">No connections</p>';
        return;
    }

    container.innerHTML = `
        <table class="admin-table">
            <thead><tr><th>Name</th><th>Host:Port</th><th>Has PW</th><th>Assigned To</th><th>Actions</th></tr></thead>
            <tbody>
                ${connections.map(c => `
                    <tr>
                        <td>${esc(c.name)}</td>
                        <td>${esc(c.host)}:${c.port}</td>
                        <td>${c.hasPassword ? 'Yes' : 'No'}</td>
                        <td>${(c.sharedWith || []).length ? c.sharedWith.map(id => esc(getUsernameById(id))).join(', ') : '<span class="empty-state-inline">None</span>'}</td>
                        <td class="action-cell">
                            <button class="btn-sm" data-conn-edit="${c.id}">Edit</button>
                            <button class="btn-sm" data-conn-assign="${c.id}">Assign</button>
                            <button class="btn-sm btn-sm-danger" data-conn-delete="${c.id}">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.querySelectorAll('[data-conn-edit]').forEach(btn => {
        btn.addEventListener('click', () => editConn(parseInt(btn.dataset.connEdit, 10)));
    });
    container.querySelectorAll('[data-conn-assign]').forEach(btn => {
        btn.addEventListener('click', () => assignConn(parseInt(btn.dataset.connAssign, 10)));
    });
    container.querySelectorAll('[data-conn-delete]').forEach(btn => {
        btn.addEventListener('click', () => deleteConn(parseInt(btn.dataset.connDelete, 10)));
    });
}

function showAddConnectionDialog() {
    document.getElementById('add-conn-modal').classList.remove('hidden');
    document.getElementById('add-conn-form').reset();
    document.getElementById('add-conn-error').classList.add('hidden');
}

async function editConn(id) {
    const res = await authFetch(`/api/v1/connections/${id}`);
    if (!res.ok) return;
    const conn = await res.json();

    document.getElementById('edit-conn-id').value = id;
    document.getElementById('edit-conn-name').value = conn.name;
    document.getElementById('edit-conn-host').value = conn.host;
    document.getElementById('edit-conn-port').value = conn.port;
    document.getElementById('edit-conn-password').value = '';
    document.getElementById('edit-conn-modal').classList.remove('hidden');
}

async function assignConn(id) {
    try {
        const [connRes, usersRes] = await Promise.all([
            authFetch(`/api/v1/connections/${id}`),
            authFetch('/api/v1/users'),
        ]);
        if (!connRes.ok) return;
        const conn = await connRes.json();
        const users = usersRes.ok ? await usersRes.json() : [];

        const nonAdminUsers = users.filter(u => u.role !== 'admin' && u.enabled);
        const assigned = conn.sharedWith || [];

        document.getElementById('assign-conn-id').value = id;
        document.getElementById('assign-conn-title').textContent = conn.name;
        const listEl = document.getElementById('assign-conn-users');

        if (!nonAdminUsers.length) {
            listEl.innerHTML = '<p class="empty-state" style="padding:12px">No non-admin users found. Create operator or viewer users first.</p>';
        } else {
            listEl.innerHTML = nonAdminUsers.map(u => `
                <label class="assign-user-row">
                    <input type="checkbox" value="${u.id}" ${assigned.includes(u.id) ? 'checked' : ''}>
                    <span>${esc(u.username)}</span>
                    <span class="role-badge role-${u.role}">${u.role}</span>
                </label>
            `).join('');
        }

        document.getElementById('assign-conn-modal').classList.remove('hidden');
    } catch (err) {
        console.error('Failed to load assign dialog:', err);
        showToast('Failed to load assignment data', 'error');
    }
}

async function deleteConn(id) {
    showConfirm('Delete Connection', 'Are you sure you want to delete this connection?', async () => {
        await authFetch(`/api/v1/connections/${id}`, { method: 'DELETE' });
        showToast('Connection deleted');
        loadAllConnections();
        if (appRef) appRef.loadConnections();
    });
}

// --- License ---

async function loadLicense() {
    const res = await authFetch('/api/v1/license');
    if (!res.ok) return;
    const lic = await res.json();

    const container = document.getElementById('license-info-container');
    if (!lic.installed) {
        container.innerHTML = '<p class="empty-state">No license installed. Running in unlicensed mode.</p>';
        return;
    }

    const statusClass = lic.expired ? (lic.gracePeriod ? 'warning' : 'danger') : 'success';
    const statusText = lic.expired ? (lic.gracePeriod ? 'Grace Period' : 'Expired') : 'Active';

    container.innerHTML = `
        <div class="license-card">
            <div class="license-row"><span class="license-label">Status</span><span class="license-value license-${statusClass}">${statusText}</span></div>
            <div class="license-row"><span class="license-label">Licensee</span><span class="license-value">${esc(lic.licensee || 'N/A')}</span></div>
            <div class="license-row"><span class="license-label">Edition</span><span class="license-value">${esc(lic.edition || 'N/A')}</span></div>
            <div class="license-row"><span class="license-label">Max Users</span><span class="license-value">${lic.maxUsers || 'Unlimited'}</span></div>
            <div class="license-row"><span class="license-label">Max Connections</span><span class="license-value">${lic.maxConnections || 'Unlimited'}</span></div>
            <div class="license-row"><span class="license-label">Expires</span><span class="license-value">${lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString() : 'Never'}</span></div>
            <div class="license-row"><span class="license-label">Signature</span><span class="license-value">${lic.signatureValid ? 'Valid' : 'INVALID'}</span></div>
        </div>
    `;
}

async function uploadLicense() {
    const textarea = document.getElementById('license-upload');
    const licenseData = textarea.value.trim();
    if (!licenseData) {
        showToast('Please paste the license file content', 'error');
        return;
    }

    const res = await authFetch('/api/v1/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseData }),
    });

    const data = await res.json();
    if (res.ok) {
        showToast('License uploaded successfully');
        textarea.value = '';
        loadLicense();
    } else {
        showToast(data.error || 'Failed to upload license', 'error');
    }
}

// --- Audit Log ---

let auditPage = 1;

async function loadAuditLog(page = 1) {
    auditPage = page;
    const action = document.getElementById('audit-filter-action').value;
    let url = `/api/v1/audit?page=${page}&limit=25`;
    if (action) url += `&action=${encodeURIComponent(action)}`;

    const res = await authFetch(url);
    if (!res.ok) return;
    const data = await res.json();

    const container = document.getElementById('audit-table-container');
    if (!data.rows.length) {
        container.innerHTML = '<p class="empty-state">No audit entries</p>';
        document.getElementById('audit-pagination').innerHTML = '';
        return;
    }

    container.innerHTML = `
        <table class="admin-table">
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
            <tbody>
                ${data.rows.map(r => `
                    <tr>
                        <td>${new Date(r.created_at + 'Z').toLocaleString()}</td>
                        <td>${esc(r.username || 'System')}</td>
                        <td>${esc(r.action)}</td>
                        <td>${esc(r.target || '')}</td>
                        <td>${esc(r.ip_address || '')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Pagination
    const pagEl = document.getElementById('audit-pagination');
    if (data.pages > 1) {
        let btns = '';
        for (let i = 1; i <= data.pages; i++) {
            btns += `<button class="btn-sm ${i === data.page ? 'btn-sm-active' : ''}" onclick="window._auditPage(${i})">${i}</button> `;
        }
        pagEl.innerHTML = btns;
    } else {
        pagEl.innerHTML = '';
    }
}

window._auditPage = (p) => loadAuditLog(p);

// --- Logging ---

async function loadLogging() {
    const container = document.getElementById('logging-stats-container');
    if (!container) return;

    try {
        const res = await authFetch('/api/v1/settings/logging/stats');
        if (!res.ok) throw new Error('Failed to load logging stats');
        const data = await res.json();

        const formatBytes = (bytes) => {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        };

        const formatDate = (d) => d ? new Date(d).toLocaleString() : 'N/A';

        container.innerHTML = `
            <div class="license-card">
                <div class="license-row"><span class="license-label">Total Audit Records</span><span class="license-value">${data.auditStats.totalRecords.toLocaleString()}</span></div>
                <div class="license-row"><span class="license-label">Oldest Entry</span><span class="license-value">${formatDate(data.auditStats.oldestEntry)}</span></div>
                <div class="license-row"><span class="license-label">Newest Entry</span><span class="license-value">${formatDate(data.auditStats.newestEntry)}</span></div>
                <div class="license-row"><span class="license-label">Database Size</span><span class="license-value">${formatBytes(data.auditStats.dbSizeBytes)}</span></div>
                <div class="license-row"><span class="license-label">Current Log Level</span><span class="license-value">${data.logLevel}</span></div>
                <div class="license-row"><span class="license-label">Retention Policy</span><span class="license-value">${data.auditRetentionDays === 0 ? 'Keep all records' : data.auditRetentionDays + ' days'}</span></div>
            </div>
        `;

        // Set current values in dropdowns
        const retentionSelect = document.getElementById('log-retention-days');
        const levelSelect = document.getElementById('log-level-select');
        if (retentionSelect) retentionSelect.value = String(data.auditRetentionDays);
        if (levelSelect) levelSelect.value = data.logLevel;
    } catch (e) {
        container.innerHTML = '<p style="color:#ff6b6b">Failed to load logging stats</p>';
    }
}

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
