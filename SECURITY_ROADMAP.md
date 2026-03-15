# WebVNC Security Roadmap

## Phase 1 — Critical (Immediate) ✓
- [x] 1.1 SSRF Protection — Block private/reserved IPs in WebSocket proxy
- [x] 1.2 Secrets to Environment Variables — Remove from config.json, load from env
- [x] 1.3 File Permissions — Restrict DB, keys, config to owner-only (Linux deployments)
- [x] 1.4 Separate WebSocket Token — Short-lived 60s single-use WS auth token

## Phase 2 — High Priority ✓
- [x] 2.1 Host Input Validation — Regex validation on connection host/port/name
- [x] 2.2 Rate Limiting — WebSocket (5/min/user) + admin API (30/min)
- [x] 2.3 Secure Cookie Flag — Force secure:true (always HTTPS)
- [x] 2.4 Session Activity Timeout — 30-min idle auto-revoke with last_activity tracking

## Phase 3 — Medium Priority ✓
- [x] 3.1 CSRF Enforcement — Token validation on all state-changing routes
- [x] 3.2 Trust Proxy Configuration — Configurable trust proxy for req.ip accuracy
- [x] 3.3 Sanitize Error Messages — Generic client errors, detailed server logs
- [x] 3.4 Password Reuse Prevention — Stores last 5 hashes, blocks reuse
- [x] 3.5 Faster Session Cleanup — Every 5 minutes instead of hourly

## Phase 4 — Hardening ✓
- [x] 4.1 Additional Security Headers — X-Frame-Options DENY, X-Content-Type-Options nosniff, X-XSS-Protection, Referrer-Policy, CSP frame-ancestors, HSTS preload
- [x] 4.2 Self-signed cert validity reduced to 90 days (was 365)
- [x] 4.3 Concurrent session limits — Max 5 per user, oldest auto-revoked
- [x] 4.4 Bcrypt rounds increased to 13 (was 12)
- [x] 4.5 Distinct login failure audit — user_not_found / account_disabled / wrong_password
- [ ] 4.6 SQLite encryption (sqlcipher) — Deferred (requires native module swap)

## Additional
- [x] TLS certificate auto-renewal — Self-signed certs auto-regenerate at 30 days remaining
- [x] TLS certificate monitoring — 24-hour check cycle with escalating warnings for user-provided certs
- [x] Global error handler — Prevents stack trace leaks to clients
