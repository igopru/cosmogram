# Security Guide 🔒

> Cosmogram is designed to be **private, secure, and self-contained**. This document explains the security architecture and best practices.

---

## 🏗️ Security Architecture

### Defense in Depth

Cosmogram uses multiple layers of security:

```
Request → Rate Limit → Security Headers → Input Validation → Auth Check → Business Logic → Response
```

Each layer independently validates and filters requests.

---

## 🔐 Authentication & Authorization

### JWT Tokens
- **Signed** with `JWT_SECRET` (minimum 32 characters)
- **Stored** in httpOnly cookies (inaccessible to JavaScript)
- **Expires** after 7 days
- **Contains**: `userId`, `username`, `role`
- **Validated** on every authenticated request

### Session Management
```javascript
// Cookie configuration
res.cookie('token', token, {
    httpOnly: true,        // Not accessible via document.cookie
    sameSite: 'lax',       // CSRF protection
    secure: false,         // Set to true with HTTPS
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
});
```

### Role-Based Access Control
| Role | Capabilities |
|------|-------------|
| `user` | Create posts, comment, like, manage own posts |
| `admin` | All user capabilities + delete any post/media, import media |

**Middleware enforcement:**
```javascript
requireAdmin       // Blocks non-admin users
validateSession    // Blocks unauthenticated requests
optionalAuth       // Non-blocking — sets req.user or null for public endpoints
checkPostOwner     // Blocks users from accessing others' posts
```

### Public Feed Access
- **`optionalAuth` middleware** — used for `/api/posts` and `/api/likes` routers
- Unauthenticated requests receive `req.user = null` instead of 401
- Feed returns only `is_public = 1` posts for guests
- All write operations (create, update, delete) still require `validateSession`
- `checkPostOwner` returns 401 if `req.userId` is falsy, preventing anonymous mutations

---

## 🛡️ Security Headers (Helmet)

```javascript
{
    contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:", "data:"],
        connectSrc: ["'self'"],
    },
    hsts: false,  // Handled by nginx
}
```

### Additional Headers
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-XSS-Protection: 1; mode=block` — browser XSS filter
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## 🔒 Rate Limiting

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| General API | 200 requests | 15 minutes | Prevent abuse |
| Login | 20 attempts | 15 minutes | Prevent brute-force |
| Posts/Comments/Likes | 50 writes | 15 minutes | Prevent spam |

**Implementation:**
```javascript
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
});
```

---

## 📥 Input Validation & Sanitization

### Express Validator
All user input validated with `express-validator`:

```javascript
// Registration
body('username').trim().isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_а-яёА-ЯЁ]+$/);
body('email').isEmail().normalizeEmail();
body('password').isLength({ min: 8 });
```

### XSS Protection
- **`xss` library** — sanitizes HTML content
- **`escape-html`** — escapes output in templates
- **`express-mongo-sanitize`** — prevents NoSQL injection

### File Upload Validation
```javascript
// Allowed file types
allowedImageTypes: ['.jpg', '.jpeg', '.png', '.webp', '.gif']
allowedVideoTypes: ['.mp4', '.webm', '.mov', '.avi']

// Magic byte validation (not just extension)
const fileType = await fileTypeFromBuffer(buffer);

// Size limits
max: 10MB per file
max: 10 files per upload
```

---

## 📁 File System Security

### Path Validation
All file operations restricted to allowed directories:

```javascript
const allowedPrefixes = [
    path.join(__dirname, '../uploads'),
    path.join(__dirname, '../uploads/thumbnails')
];

// Check before any file operation
const isAllowed = allowedPrefixes.some(prefix => 
    resolvedPath.startsWith(prefix)
);
if (!isAllowed) {
    console.error(`⚠️ Blocked suspicious file deletion`);
    return;
}
```

### What This Prevents
- **Path traversal attacks** — `../../../etc/passwd`
- **Arbitrary file deletion** — deleting system files
- **Symlink attacks** — following symlinks outside uploads/

### Upload Directory Structure
```
uploads/
├── images/        # Photo thumbnails (WebP)
├── videos/        # Video symlinks to originals
└── thumbnails/    # Post thumbnails
```

---

## 🗄️ Database Security

### SQLite Configuration
```javascript
// WAL mode for performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Foreign keys for data integrity
db.pragma('foreign_keys = ON');

// Periodic optimization
db.pragma('wal_checkpoint(TRUNCATE)');
db.pragma('optimize');
```

### Parameterized Queries
**ALL queries use parameterized statements** — never string concatenation:

```javascript
// ✅ Safe
db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

// ❌ Dangerous (never used)
db.prepare(`SELECT * FROM users WHERE id = ${userId}`).get();
```

### Database File Protection
- **Location:** `/opt/cosmogram/data/media.db`
- **Permissions:** Only readable by service user
- **Backup:** Regular snapshots recommended

---

## 🔍 Audit & Logging

### What Gets Logged
```javascript
// Authentication
- Successful/failed logins
- Token validation errors

// File Operations
- Blocked file deletions (suspicious paths)
- Media import errors
- Thumbnail generation errors

// System Health
- Memory usage every 5 minutes
- Load average
- Slow requests (>1 second)
```

### What Does NOT Get Logged
- Passwords (never stored or logged)
- File contents
- User browsing activity
- Successful file deletions (only blocked ones)

### Log Location
```bash
# Application logs
journalctl -u cosmogram -f

# System monitoring
/opt/cosmogram/data/system-monitor.log

# Daily rotate logs
/opt/cosmogram/data/app-YYYY-MM-DD.log
```

---

## 🚨 Security Checklist

### Deployment
- [ ] Generate strong `JWT_SECRET` (64+ characters)
- [ ] Generate strong `SESSION_SECRET` (64+ characters)
- [ ] Set `NODE_ENV=production`
- [ ] Configure `ALLOWED_ORIGINS` in `.env`
- [ ] Enable HTTPS (nginx with Let's Encrypt)
- [ ] Set `secure: true` in cookie options (with HTTPS)
- [ ] Restrict database file permissions
- [ ] Set up automatic backups
- [ ] Configure firewall (only 80, 443, SSH)

### Ongoing
- [ ] Monitor logs for suspicious activity
- [ ] Review failed login attempts
- [ ] Keep Node.js and dependencies updated
- [ ] Regular database backups
- [ ] Monitor disk space (uploads, logs, WAL)
- [ ] Review admin actions (post/media deletions)

---

## 🛡️ Hardening Recommendations

### Server Level
```bash
# Disable root login
sudo usermod -L root

# SSH key-only authentication
PasswordAuthentication no

# Automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### Nginx Level
```nginx
# SSL configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_prefer_server_ciphers on;

# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

# Security headers
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header X-XSS-Protection "1; mode=block" always;
```

### Application Level
```bash
# Run as non-root user
sudo useradd --system --no-create-home cosmogram
sudo chown -R cosmogram:cosmogram /opt/cosmogram

# Systemd service restrictions
[Service]
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=yes
```

---

## 🐛 Reporting Vulnerabilities

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. Document the vulnerability
3. Contact the maintainer privately
4. Allow time for a fix before public disclosure

---

## 📚 References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Helmet Documentation](https://helmetjs.github.io/)

---

**Security is not a feature, it's a process. Stay vigilant.** 🔒
