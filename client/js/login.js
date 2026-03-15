const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');
let authToken = null;

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
        const res = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.error || 'Login failed';
            errorEl.classList.remove('hidden');
            return;
        }

        authToken = data.token;

        if (data.user.mustChangePassword) {
            document.getElementById('change-pw-current').value = password;
            document.getElementById('change-pw-modal').classList.remove('hidden');
            return;
        }

        window.location.href = '/';
    } catch (err) {
        errorEl.textContent = 'Connection error';
        errorEl.classList.remove('hidden');
    }
});

// Change password form
const changePwForm = document.getElementById('change-pw-form');
const changePwError = document.getElementById('change-pw-error');

changePwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    changePwError.classList.add('hidden');

    const currentPassword = document.getElementById('change-pw-current').value;
    const newPassword = document.getElementById('change-pw-new').value;
    const confirmPassword = document.getElementById('change-pw-confirm').value;

    if (newPassword !== confirmPassword) {
        changePwError.textContent = 'Passwords do not match';
        changePwError.classList.remove('hidden');
        return;
    }

    if (newPassword.length < 8) {
        changePwError.textContent = 'Password must be at least 8 characters';
        changePwError.classList.remove('hidden');
        return;
    }

    try {
        const csrfCookie = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('webvnc_csrf='));
        const csrf = csrfCookie ? csrfCookie.split('=')[1] : '';

        const res = await fetch('/api/v1/auth/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken,
                'X-WebVNC-CSRF': csrf,
            },
            body: JSON.stringify({ currentPassword, newPassword }),
        });

        const data = await res.json();

        if (!res.ok) {
            changePwError.textContent = data.error || 'Failed to change password';
            changePwError.classList.remove('hidden');
            return;
        }

        window.location.href = '/';
    } catch (err) {
        changePwError.textContent = 'Connection error';
        changePwError.classList.remove('hidden');
    }
});
