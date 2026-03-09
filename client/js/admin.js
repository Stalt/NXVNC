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
        });
    });

    document.getElementById('btn-add-user').addEventListener('click', showAddUserDialog);
    document.getElementById('btn-upload-license').addEventListener('click', uploadLicense);
    document.getElementById('btn-refresh-audit').addEventListener('click', () => loadAuditLog());
    document.getElementById('audit-filter-action').addEventListener('change', () => loadAuditLog());
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

    const role = prompt(`Role for ${user.username} (admin/operator/viewer):`, user.role);
    if (!role || !['admin', 'operator', 'viewer'].includes(role)) return;

    const displayName = prompt('Display name:', user.display_name || '');

    await authFetch(`/api/v1/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, displayName }),
    });
    loadUsers();
};

window._adminResetPw = async (id) => {
    const newPassword = prompt('Enter new password (min 8 chars):');
    if (!newPassword || newPassword.length < 8) {
        alert('Password must be at least 8 characters');
        return;
    }

    await authFetch(`/api/v1/users/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
    });
    alert('Password reset. User will be required to change it on next login.');
};

window._adminDeleteUser = async (id) => {
    if (!confirm('Disable this user?')) return;
    await authFetch(`/api/v1/users/${id}`, { method: 'DELETE' });
    loadUsers();
};

function showAddUserDialog() {
    const username = prompt('Username:');
    if (!username) return;
    const password = prompt('Password (min 8 chars):');
    if (!password || password.length < 8) {
        alert('Password must be at least 8 characters');
        return;
    }
    const role = prompt('Role (admin/operator/viewer):', 'operator');
    if (!role || !['admin', 'operator', 'viewer'].includes(role)) return;

    authFetch('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
    }).then(res => {
        if (res.ok) loadUsers();
        else res.json().then(d => alert(d.error || 'Failed'));
    });
}

// --- Connections ---

async function loadAllConnections() {
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
            <thead><tr><th>Name</th><th>Host:Port</th><th>Owner</th><th>Has PW</th><th>Shared With</th></tr></thead>
            <tbody>
                ${connections.map(c => `
                    <tr>
                        <td>${esc(c.name)}</td>
                        <td>${esc(c.host)}:${c.port}</td>
                        <td>${esc(c.ownerName || 'N/A')}</td>
                        <td>${c.hasPassword ? 'Yes' : 'No'}</td>
                        <td>${(c.sharedWith || []).length ? c.sharedWith.join(', ') : 'None'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
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
        alert('Please paste the license file content');
        return;
    }

    const res = await authFetch('/api/v1/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseData }),
    });

    const data = await res.json();
    if (res.ok) {
        alert('License uploaded successfully');
        textarea.value = '';
        loadLicense();
    } else {
        alert(data.error || 'Failed to upload license');
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

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
