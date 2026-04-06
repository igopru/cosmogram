# Security Audit Report — Cosmogram v1.1.1

**Date:** 2026-04-06  
**Auditor:** AI Security Analyst (attacker perspective simulation)  
**Scope:** Full application — backend API, frontend, file handling, authentication  

---

## Summary

| Severity | Found | Fixed |
|----------|-------|-------|
| **Critical** | 3 | ✅ 3 |
| **High** | 4 | ✅ 4 |
| **Medium** | 5 | ✅ 5 |
| **Low** | 2 | ✅ 2 |
| **Total** | **14** | **14** |

---

## Critical Vulnerabilities (FIXED)

### 1. Hardcoded Default Admin Credentials
- **Location:** `models/database.js`
- **Attack:** Every deployment creates `admin` / `Admin123!` — attacker knows default creds
- **Fix:** Random 16-char hex password via `crypto.randomBytes(8)`. Log once at creation.
- **Status:** ✅ Fixed

### 2. Password Reset Token Leakage
- **Location:** `routes/auth.js` — `POST /forgot-password`
- **Attack:** Without SMTP configured, ANY attacker calls `/forgot-password` with victim's email → gets full reset URL with token → resets victim's password
- **Fix:** Token logged server-side only. Client receives: "Contact an administrator for the reset link."
- **Status:** ✅ Fixed

### 3. Default JWT_SECRET Not Validated
- **Location:** `server.js` startup
- **Attack:** If deployer forgets to change `JWT_SECRET` from placeholder, anyone can forge valid admin tokens → full auth bypass
- **Fix:** Startup check: `JWT_SECRET` and `SESSION_SECRET` must be ≥32 chars or app refuses to start
- **Status:** ✅ Fixed

---

## High Vulnerabilities (FIXED)

### 4. Path Traversal in File Deletion
- **Location:** `routes/posts.js` — `DELETE /api/posts/:id`
- **Attack:** If attacker manipulates `media_path` in DB (via SQLi or crafted upload), delete operation could unlink arbitrary files on filesystem
- **Fix:** `path.resolve()` + prefix validation — only delete files within `uploads/` and `uploads/thumbnails/`. Suspicious paths are logged and skipped.
- **Status:** ✅ Fixed

### 5. Stored XSS via Quote Characters
- **Location:** `middleware/security.js` — `sanitizeInput()`
- **Attack:** `sanitizeInput` only stripped `<>` but NOT quotes. Attacker could inject: `onclick="evil"` in attributes. Output used in `innerHTML` context.
- **Fix:** `sanitizeInput` now strips `[<>"'&]` — all dangerous characters including quotes. Added `htmlEncode()` for safe HTML-context output.
- **Status:** ✅ Fixed

### 6. XSS Middleware Misses Nested Objects
- **Location:** `middleware/security.js` — `preventXSS()`
- **Attack:** `preventXSS` only sanitized top-level string body values. `JSON.parse(req.body.tags)` bypassed it entirely. Nested objects with script payloads passed through.
- **Fix:** Recursive `sanitizeObject()` traverses all nested objects and arrays, sanitizing every string value.
- **Status:** ✅ Fixed

### 7. Missing Integer Validation on Route Parameters
- **Location:** All route files — `:id`, `:postId`, `:tagId`, `:userId`
- **Attack:** Non-numeric params (`DELETE /api/posts/abc`) cause type coercion, potential database errors, information leakage via error messages
- **Fix:** `validateId` and `parseInt()` validation on ALL route parameters across posts, comments, likes, tags, subscriptions. Invalid IDs → 400 Bad Request.
- **Status:** ✅ Fixed

---

## Medium Vulnerabilities (FIXED)

### 8. Overly Permissive Rate Limiting
- **Before:** 500 req/15min general, 30 auth
- **After:** 200 general, 20 auth, 50 write ops (posts/comments/likes)
- **Impact:** Prevents scraping, brute force, automated abuse
- **Status:** ✅ Fixed

### 9. Error Message Information Disclosure
- **Before:** `NODE_ENV !== 'production'` → `err.message` exposed to client
- **After:** Always returns `"Internal server error"` regardless of environment
- **Impact:** Attackers can't learn DB schema, file paths, or stack traces via crafted inputs
- **Status:** ✅ Fixed

### 10. User-Controllable `created_at`
- **Before:** `req.body.created_at || new Date().toISOString()` — user sets any timestamp
- **After:** Always server-generated via `DEFAULT CURRENT_TIMESTAMP`
- **Impact:** Prevents feed ordering manipulation, future-dated posts, confusion
- **Status:** ✅ Fixed

### 11. File Extension ≠ MIME Type Mismatch
- **Attack:** Upload `evil.js` with `Content-Type: image/jpeg` → multer accepts it, served as JPEG by nginx but could execute in some contexts
- **Fix:** File extension must match MIME type whitelist (`.jpg` ↔ `image/jpeg`, etc.)
- **Status:** ✅ Fixed

### 12. No Per-Endpoint Rate Limits
- **Added:** Separate rate limiters for write operations (posts, comments, likes) — 50 per 15 min
- **Status:** ✅ Fixed

---

## Low Vulnerabilities (FIXED)

### 13. `.npmrc strict-ssl=false`
- **Risk:** MITM attack on `npm install` → malicious packages
- **Fix:** File removed entirely
- **Status:** ✅ Fixed

### 14. Username Allows Special Characters
- **Before:** No regex — usernames like `<script>` possible
- **After:** `/^[a-zA-Z0-9_а-яёА-ЯЁ]+$/` — alphanumeric + underscore + cyrillic only
- **Status:** ✅ Fixed

---

## What Remains (Known Limitations)

| Issue | Risk | Recommendation |
|-------|------|---------------|
| No CSRF token | Medium (mitigated by sameSite=lax) | Add `csurf` middleware or custom header validation |
| No magic byte validation | Low (mitigated by ext+MIME match) | Add `file-type` package for content inspection |
| No file content-type header on served uploads | Low | Serve with `Content-Disposition: inline` and correct MIME |
| No audit logging | Low | Log all write operations (create/delete/subscribe) |
| Video files served from same domain | Low | Use separate subdomain `uploads.domain.com` |

---

## Attack Simulation: What a Hacker Would Do

### Phase 1: Reconnaissance
1. **Scan API endpoints** — rate limited now (200/15min vs 500 before)
2. **Try default credentials** — `admin/Admin123!` no longer works (random password)
3. **Check for info leaks** — error messages always return `"Internal server error"`

### Phase 2: Authentication Attacks
4. **Brute force login** — rate limited to 20 attempts/15min (was 30)
5. **Password reset abuse** — token no longer returned in API response (server-side only)
6. **JWT forgery** — app refuses to start without proper `JWT_SECRET`

### Phase 3: Injection
7. **SQL injection** — all queries parameterized, IDs validated as integers
8. **XSS in comments/tags** — recursive XSS sanitization, quotes stripped
9. **Path traversal** — file paths validated against allowed prefixes

### Phase 4: File Upload
10. **Malicious file type** — extension must match MIME type
11. **Double extension** — `.jpg.php` rejected (extension mismatch)
12. **Oversized files** — 10MB limit enforced

### Phase 5: Data Harvesting
13. **Scrape all posts** — rate limited to 200 req/15min
14. **Mass subscribe/unsubscribe** — 50 write ops/15min limit
15. **Enumerate users** — `forgot-password` doesn't reveal if email exists

---

## Recommendations for Future

1. **Add CSRF tokens** — use `csurf` or require `X-Requested-With` header
2. **Implement audit logging** — log all mutations (create, delete, subscribe)
3. **Add Content-Security-Policy** — tighten CSP headers to prevent inline scripts
4. **Enable HTTPS-only cookies** — ensure `Secure` flag on JWT cookie
5. **Add file content validation** — use `file-type` to verify magic bytes
6. **Implement 2FA** — optional TOTP for admin accounts
7. **Add request ID tracking** — `X-Request-ID` header for log correlation
8. **Set up fail2ban for API** — auto-ban IPs hitting rate limits repeatedly
