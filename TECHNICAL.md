# Cosmogram — Technical Documentation

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                    Browser                       │
│  index.html + style.css + script.js (SPA)       │
└───────────────────┬─────────────────────────────┘
                    │ HTTPS (nginx)
                    ▼
┌─────────────────────────────────────────────────┐
│                   nginx                          │
│  Reverse proxy, SSL, video range requests       │
└───────────────────┬─────────────────────────────┘
                    │ HTTP :8000
                    ▼
┌─────────────────────────────────────────────────┐
│              Node.js (Express)                   │
│                                                  │
│  middleware/                                     │
│  ├── auth.js          — JWT session validation   │
│  ├── security.js      — XSS, headers, sanitize   │
│  └── validation.js    — Request validation       │
│                                                  │
│  routes/                                         │
│  ├── auth.js          — /api/auth/*              │
│  ├── posts.js         — /api/posts/*             │
│  ├── comments.js      — /api/comments/*          │
│  ├── likes.js         — /api/likes/*             │
│  └── tags.js          — /api/tags/*              │
│                                                  │
│  models/database.js   — SQLite init + config     │
│  server.js            — Express app entry         │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│              SQLite (better-sqlite3)             │
│  data/media.db (WAL mode)                       │
└─────────────────────────────────────────────────┘
```

## Database Schema

### Users
```sql
users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    fullname TEXT,
    avatar TEXT,
    bio TEXT,
    role TEXT DEFAULT 'user',       -- 'user' | 'admin'
    active INTEGER DEFAULT 1,       -- 0 = blocked
    created_at DATETIME,
    updated_at DATETIME
)
```

### Posts
```sql
posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL → users(id) ON DELETE CASCADE,
    description TEXT,
    allow_comments INTEGER DEFAULT 1,
    created_at DATETIME,
    updated_at DATETIME
)
```

### Post Media
```sql
post_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL → posts(id) ON DELETE CASCADE,
    media_type TEXT CHECK IN ('image', 'video'),
    media_path TEXT NOT NULL,       -- absolute path
    thumbnail_path TEXT,            -- absolute path or null
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME
)
```

### Comments
```sql
comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL → posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL → users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at DATETIME
)
```

### Likes
```sql
likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL → posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL → users(id) ON DELETE CASCADE,
    created_at DATETIME,
    UNIQUE(post_id, user_id)        -- one like per user per post
)
```

### Tags
```sql
tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,      -- lowercase, sanitized
    created_at DATETIME
)

post_tags (
    post_id INTEGER NOT NULL → posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL → tags(id) ON DELETE CASCADE,
    created_at DATETIME,
    PRIMARY KEY (post_id, tag_id)
)
```

### Subscriptions
```sql
subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL → users(id) ON DELETE CASCADE,
    following_user_id INTEGER → users(id) ON DELETE CASCADE,  -- OR null
    tag_id INTEGER → tags(id) ON DELETE CASCADE,              -- OR null
    created_at DATETIME,
    UNIQUE(follower_id, following_user_id),
    UNIQUE(follower_id, tag_id),
    CHECK (
        (following_user_id IS NOT NULL AND tag_id IS NULL) OR
        (following_user_id IS NULL AND tag_id IS NOT NULL)
    )
)
```

## API Reference

### Authentication (`/api/auth`)

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| POST | `/register` | ❌ | `{username, email, password}` | `{success, user}` |
| POST | `/login` | ❌ | `{email, password}` | `{success, user}` (sets JWT cookie) |
| POST | `/logout` | ✅ | — | `{success}` (clears cookie) |
| GET | `/me` | ✅ | — | `{user}` or 401 |
| POST | `/forgot-password` | ❌ | `{email}` | `{success, resetLink}` |
| POST | `/reset-password` | ❌ | `{token, newPassword}` | `{success}` |

### Posts (`/api/posts`)

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| GET | `/feed?filter=all\|subscribed\|tag:xxx` | ✅ | — | `{posts, filter}` |
| POST | `/` | ✅ | multipart: `media`[], `description`, `tags` (JSON) | `{success, postId, mediaCount}` |
| DELETE | `/:id` | ✅ (owner) | — | `{success}` |

**Post object structure:**
```json
{
    "id": 1,
    "user_id": 2,
    "username": "photographer",
    "avatar": "avatar.jpg",
    "description": "Sunset vibes",
    "created_at": "2026-04-05T12:00:00Z",
    "likes_count": 15,
    "comments_count": 3,
    "user_liked": false,
    "is_subscribed": true,
    "media": [
        {
            "id": 1,
            "media_type": "image",
            "media_url": "//domain/uploads/images/xxx.jpg",
            "thumbnail_url": "//domain/uploads/thumbnails/thumb_xxx.jpg",
            "sort_order": 0
        }
    ],
    "tags": [
        {"id": 1, "name": "sunset"},
        {"id": 2, "name": "photography"}
    ],
    "comments": [...]
}
```

### Comments (`/api/comments`)

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| GET | `/post/:postId` | ✅ | — | `{comments}` |
| POST | `/` | ✅ | `{postId, text}` | `{success, comment}` |
| DELETE | `/:id` | ✅ (owner) | — | `{success}` |

### Likes (`/api/likes`)

| Method | Endpoint | Auth | Response |
|--------|----------|------|----------|
| POST | `/toggle/:postId` | ✅ | `{success, liked: boolean}` |
| GET | `/post/:postId` | ✅ | `{likes}` |

### Tags & Subscriptions (`/api/tags`)

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| GET | `/` | ✅ | — | `{tags: [{id, name, post_count, user_subscribed}]}` |
| POST | `/` | ✅ | `{name}` | `{id, name}` |
| POST | `/post/:postId` | ✅ (owner) | `{tags: string[]}` | `{success, tags}` |
| DELETE | `/post/:postId/:tagId` | ✅ (owner) | — | `{success}` |
| POST | `/subscribe/user/:userId` | ✅ | — | `{success, subscribed: boolean}` |
| POST | `/subscribe/tag/:tagId` | ✅ | — | `{success, subscribed: boolean}` |
| GET | `/subscriptions` | ✅ | — | `{users: [...], tags: [...]}` |

## Authentication Flow

1. **Login:** POST `/api/auth/login` → server sets JWT cookie (`httpOnly`, `Secure`, `SameSite=Strict`)
2. **Session validation:** `validateSession` middleware reads JWT from cookie
3. **Logout:** POST `/api/auth/logout` → clears cookie
4. **Password reset:** Token generated → emailed (or shown in UI if SMTP not configured) → POST with token

## Feed Filters

### `?filter=all` (default)
```sql
SELECT posts ... ORDER BY created_at DESC LIMIT 50
```

### `?filter=subscribed`
```sql
SELECT posts ... 
WHERE EXISTS (
    SELECT 1 FROM subscriptions 
    WHERE follower_id = ? AND following_user_id = posts.user_id
)
ORDER BY created_at DESC LIMIT 50
```

### `?filter=tag:sunset`
```sql
SELECT posts ...
JOIN post_tags pt ON posts.id = pt.post_id
JOIN tags t ON pt.tag_id = t.id
WHERE t.name = 'sunset'
ORDER BY created_at DESC LIMIT 50
```

## File Upload Flow

1. User selects files (max 10, 10MB each)
2. Images compressed client-side via `sharp` (resize to 600x600, JPEG 80%)
3. `POST /api/posts` with multipart form:
   - `media[]` — files
   - `description` — text
   - `tags` — JSON string array
4. Server:
   - Stores files in `uploads/images/` or `uploads/videos/`
   - Generates thumbnails in `uploads/thumbnails/`
   - Creates tags if new
   - Links post_tags
   - Returns postId

## Carousel Implementation

- **Container:** fixed height (500px desktop, 350px mobile)
- **Slides:** absolute positioned, `.active` class controls visibility
- **Transitions:** opacity 0.15s + visibility
- **Navigation:** buttons (◀ ▶), dots, counter (1/5)
- **No swipe:** scroll works normally, only buttons change slides

## Fullscreen Implementation

- **Trigger:** double-tap/click on media, or ⛶ button
- **Display:** fixed overlay, single media centered
- **Carousel in fullscreen:** horizontal scroll via swipe (mobile) or wheel (desktop), with fade transition between slides
- **Navigation:** ← → keys, wheel, swipe, counter badge
- **Close:** ⛶ button (bottom-right), Esc key, click on background
- **Cleanup:** all event listeners removed on close

## Security

| Measure | Implementation |
|---------|---------------|
| XSS | `preventXSS` middleware sanitizes input/output |
| SQL Injection | `express-mongo-sanitize` + parameterized queries |
| CSRF | JWT in httpOnly cookies |
| Rate Limiting | 500 req/15min general, 30 req/15min auth |
| Headers | Helmet (CSP, X-Content-Type, etc.) |
| File Upload | Type whitelist, size limit, UUID filenames |
| Password | bcrypt (12 rounds) |

## Performance Tuning

### SQLite Pragmas
```javascript
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -64000');       // 64MB
db.pragma('temp_store = MEMORY');
db.pragma('synchronous = NORMAL');
db.pragma('wal_autocheckpoint = 100');  // every 100 pages
db.pragma('mmap_size = 268435456');     // 256MB
```

### Auto-optimization
- WAL checkpoint every 30 minutes
- Database `PRAGMA optimize` periodically

### Frontend
- Batch comments loading (single query for all posts in feed)
- IntersectionObserver for video management (pause when off-screen)
- Lazy loading images
- Image compression before upload

## Monitoring

### Automated (cron every 5 min)
```bash
/opt/cosmogram/scripts/system-monitor.sh
```
Tracks: CPU, memory, IOWAIT, SQLite WAL size, top processes

### Manual diagnostics
```bash
/opt/cosmogram/scripts/diagnose.sh
```
Creates snapshot: `/opt/cosmogram/data/diag-YYYYMMDD-HHMMSS.log`

### In-app health logging
```
[HEALTH] Memory: 87.5MB RSS | System: 64.2% free | Load: 0.67, 0.66, 0.59
[SLOW] GET /api/posts/feed - 1234ms
[DB] Periodic optimization completed
```

### Alert thresholds
| Metric | Threshold |
|--------|-----------|
| IOWAIT | > 10% |
| Load average | > 5 |
| Cosmogram memory | > 500MB |
| SQLite WAL file | > 100MB |

## Deployment

### Requirements
- Node.js 20+
- SQLite3
- nginx (for HTTPS)
- sharp (image processing)

### Environment (.env)
```env
NODE_ENV=production
PORT=8000
JWT_SECRET=<64 hex chars>
SESSION_SECRET=<64 hex chars>
BCRYPT_ROUNDS=12
ALLOWED_ORIGINS=https://yourdomain.com
MAX_FILE_SIZE=10485760
```

### Systemd
```bash
sudo cp cosmogram.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cosmogram
```

### Nginx
```nginx
proxy_pass http://localhost:8000;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_cookie_path / /;
proxy_http_version 1.1;
proxy_set_header Range $http_range;
proxy_set_header If-Range $http_if_range;
proxy_buffering off;
```

## CLI Scripts

### User Management
```bash
node scripts/manage-users.js create --username john --email john@test.com --password "pass"
node scripts/manage-users.js list
node scripts/manage-users.js block --username john
node scripts/manage-users.js resetpw --username john --password "new"
```

### Media Import
```bash
# Edit CONFIG in scripts/import-media.js
node scripts/import-media.js scan
node scripts/import-media.js import
node scripts/import-media.js reset
```

## File Structure
```
/opt/cosmogram/
├── server.js                    # Express entry
├── package.json
├── .env
├── cosmogram.service            # systemd
├── CHANGELOG.md
│
├── models/
│   └── database.js              # SQLite init + pragmas
├── middleware/
│   ├── auth.js                  # JWT validation
│   ├── security.js              # XSS, headers
│   └── validation.js            # Request validation
├── routes/
│   ├── auth.js                  # Auth endpoints
│   ├── posts.js                 # Posts + feed + tags
│   ├── comments.js              # Comments
│   ├── likes.js                 # Likes
│   └── tags.js                  # Tags + subscriptions
├── scripts/
│   ├── manage-users.js          # User CLI
│   ├── import-media.js          # Mass import
│   ├── system-monitor.sh        # Monitoring (cron)
│   └── diagnose.sh              # Manual diagnostics
├── public/
│   ├── index.html               # SPA
│   ├── style.css                # Styles
│   └── script.js                # Frontend logic
├── uploads/
│   ├── images/
│   ├── thumbnails/
│   └── videos/
└── data/
    ├── media.db                 # SQLite
    ├── media.db-wal             # WAL journal
    └── system-monitor.log       # Monitoring logs
```
