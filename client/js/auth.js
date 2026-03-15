// Auth helper module for the main app

let cachedToken = null;
let currentUser = null;

function getCsrfToken() {
    const match = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('webvnc_csrf='));
    return match ? match.split('=')[1] : '';
}

async function authFetch(url, options = {}) {
    const headers = { ...options.headers };
    headers['X-WebVNC-CSRF'] = getCsrfToken();

    if (cachedToken) {
        headers['Authorization'] = 'Bearer ' + cachedToken;
    }

    return fetch(url, { ...options, headers, credentials: 'same-origin' });
}

async function checkAuth() {
    try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
        if (!res.ok) {
            window.location.href = '/login';
            return null;
        }
        currentUser = await res.json();

        if (currentUser.mustChangePassword) {
            window.location.href = '/login';
            return null;
        }

        return currentUser;
    } catch {
        window.location.href = '/login';
        return null;
    }
}

async function logout() {
    try {
        await authFetch('/api/v1/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    window.location.href = '/login';
}

function getUser() {
    return currentUser;
}

async function getToken() {
    try {
        const res = await authFetch('/api/v1/auth/ws-token');
        if (res.ok) {
            const data = await res.json();
            return data.token;
        }
    } catch {}
    return null;
}

export { authFetch, checkAuth, logout, getUser, getToken, getCsrfToken };
