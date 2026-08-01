# Cosmogram 2.0 🎉

> **Private. Secure. Local.** Your media, your rules.

Cosmogram is a self-hosted media gallery server for personal and team use. Upload, organize, and share photos and videos with full admin controls, selective import, and granular content management — all running on your own hardware.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

### 🔒 Security & Privacy
- **100% Local** — no cloud, no third-party services, no data leaving your server
- **JWT Authentication** — secure sessions with httpOnly cookies
- **Role-based access** — admin and user roles with strict middleware enforcement
- **Rate limiting** — protects against brute-force and abuse
- **Security headers** — Helmet, CSP, XSS protection, clickjacking prevention
- **Input sanitization** — all user input validated and filtered

### 🖼️ Media Management
- **Photo & Video uploads** — JPEG, PNG, WebP, GIF, MP4, WebM, 3GPP, QuickTime/MOV
- **Client-side video compression** — auto-compress to WebM (854×480, 800 kbps); falls back to original if browser can't decode blob URL
- **Text-only posts** — publish without media via ✍️ button; text renders as styled card
- **Carousel view** — multi-media posts with smooth navigation, touch swipe support
- **Fullscreen mode** — immersive viewing with pinch-to-zoom, pan, double-tap reset, scroll-wheel zoom
- **High-quality thumbnails** — Sharp library generates WebP previews from originals
- **Scroll-based video** — auto-pause when off-screen

### 👑 Admin Panel
- **Full-screen web interface** — удобная панель на весь экран с вкладками
- **Folder browser** — просмотр всех папок с поиском, сканирование, превью файлов
- **Import queue** — мониторинг и управление очередью импорта
- **Action cards** — быстрые действия (очистка очереди, создание тестового поста)
- **Inline preview** — предпросмотр файлов перед импортом прямо в панели
- **Content moderation** — удаление любых постов и отдельных медиа

### 🌍 Public Access
- **Public gallery** — unauthenticated users can browse public posts
- **Public/private toggle** — per-post visibility control in upload modal
- **Smart feed** — public posts for guests, all posts for authenticated users
- **Login/register banner** — shown to guests with contextual CTA
- **Shareable post links** — `GET /post/:id` for individual posts (respects privacy)

### 👤 User Profiles & Private Posts
- **User profiles** — click any username to view their profile, stats and posts grid
- **Private posts** — family/private photos visible only to the author, admins and manually granted followers
- **Private access control** — grant/revoke access per follower in your profile (🔒 Manage private access)
- **Visibility enforcement** — applied in feed, single-post view and profiles

### 🗑️ Granular Control
- **Delete individual media** — remove specific photos/videos from posts
- **Delete entire posts** — with confirmation and cascade cleanup
- **Owner & Admin permissions** — owners manage own posts, admins manage everything

### 🏷️ Tags & Subscriptions
- **Auto-tagging** — tags parsed from upload description
- **Tag cloud** — discover and filter by tags
- **User subscriptions** — follow other users
- **Tag subscriptions** — subscribe to specific tags
- **Filtered feed** — All / Subscriptions / Specific tag

### 📱 Responsive Design
- **Desktop & Mobile** — optimized for all screen sizes
- **Dark/Light theme** — toggle with one click
- **Touch-friendly** — swipe gestures, tap-to-fullscreen, pinch-to-zoom
- **Public gallery mode** — unauthenticated users can browse public posts

### 🤖 Android App
- **Two variants** — `android/` (fixed URL) and `android_all/` (configurable URL dialog)
- **File picker** — `ACTION_OPEN_DOCUMENT` for gallery, `ACTION_IMAGE_CAPTURE` for camera
- **Camera support** — FileProvider for captured photos/videos
- **Pull-to-refresh** — only when WebView `scrollY == 0`
- **Permissions** — CAMERA, READ_MEDIA_IMAGES, READ_MEDIA_VIDEO

### ⚡ Performance
- **SQLite with WAL** — fast, reliable, zero-config database
- **Batch queries** — optimized comment loading (~95% reduction)
- **Auto-optimization** — periodic WAL checkpoint and vacuum
- **Compression** — gzip responses, WebP thumbnails
- **Range requests** — video seeking supported

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20.0.0
- Linux server (Ubuntu/Debian recommended)
- exiftool (for reading EXIF dates from photos)

### Installation

```bash
# Clone or copy the project
cd /opt/cosmogram

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your JWT_SECRET, SESSION_SECRET, etc.

# Generate secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Start the server
npm start
```

### First Run
1. Open `http://localhost:8000`
2. Login with admin credentials (auto-created on first run)
3. Check the [Admin Panel Guide](docs/ADMIN_PANEL.md) for importing media

---

## 📁 Project Structure

```
cosmogram/
├── server.js                 # Main Express server
├── routes/
│   ├── auth.js              # Authentication endpoints
│   ├── posts.js             # Post CRUD + media deletion
│   ├── comments.js          # Comments management
│   ├── likes.js             # Likes management
│   ├── tags.js              # Tags & subscriptions
│   ├── users.js             # User profiles & private access
│   └── admin.js             # Admin panel API
├── public/
│   ├── index.html           # Frontend HTML
│   ├── style.css            # Styles (dark/light theme)
│   └── script.js            # Frontend JavaScript
├── middleware/
│   ├── auth.js              # JWT validation, role checks
│   ├── optionalAuth.js      # Non-blocking auth for public endpoints
│   ├── validation.js        # Input validation
│   ├── security.js          # XSS, headers, sanitization
│   └── logger.js            # Winston logger config
├── models/
│   └── database.js          # SQLite schema & initialization
├── scripts/
│   ├── generate-thumbnails.js    # High-quality thumbnail generator
│   ├── manage-users.js           # User management CLI
│   ├── system-monitor.sh         # System monitoring script
│   └── diagnose.sh               # Diagnostic script
├── android/                  # WebView app (fixed URL)
├── android_all/              # WebView app (configurable URL)
├── docs/
│   ├── ADMIN_PANEL.md            # Admin panel guide
│   ├── ADMIN_PASSWORD.md         # Password reset guide
│   ├── ANDROID.md                # Android app build guide
│   ├── PREVIEW_AND_THUMBNAILS.md # Thumbnail & preview guide
│   ├── PRIVACY.md                # User profiles & private access
│   ├── SECURITY.md               # Security architecture
│   ├── SERVICE.md                # Systemd service setup
│   └── VIDEO_COMPRESSION.md      # Video compression guide
├── nginx-updated-config.conf     # Nginx config template
├── data/
│   └── media.db                  # SQLite database (auto-created)
└── uploads/                      # Uploaded media files
    ├── images/
    ├── videos/
    └── thumbnails/
```

---

## 🔧 Configuration

### Environment Variables (`.env`)

```env
# Required
JWT_SECRET=your-64-char-secret-here
SESSION_SECRET=your-64-char-secret-here

# Optional
PORT=8000
NODE_ENV=production
ALLOWED_ORIGINS=http://localhost:8000,https://yourdomain.com
```

### Media Source Configuration

For the admin import feature, media should be organized in:

```
/opt/media/files/          # Source photos and videos
├── vacation2024/
│   ├── beach/
│   │   ├── IMG_001.jpg
│   │   └── IMG_002.jpg
│   └── sunset/
│       └── IMG_003.jpg
└── wedding/
    └── IMG_004.jpg

/opt/media/thumbs/         # Auto-generated thumbnails
└── (mirrors files/ structure)
```

---

## 📖 Documentation

- **[Admin Panel Guide](docs/ADMIN_PANEL.md)** — How to use the admin panel for importing and managing media
- **[Preview & Thumbnails](docs/PREVIEW_AND_THUMBNAILS.md)** — Thumbnail generation, preview gallery, selective import
- **[Android App](docs/ANDROID.md)** — WebView приложение, сборка, установка
- **[Admin Password](docs/ADMIN_PASSWORD.md)** — Восстановление пароля администратора
- **[Privacy & Profiles](docs/PRIVACY.md)** — User profiles, private posts, access management
- **[Video Compression](docs/VIDEO_COMPRESSION.md)** — Client-side compression, settings, browser support
- **[Security Guide](docs/SECURITY.md)** — Security architecture, hardening, best practices
- **[Service Setup](docs/SERVICE.md)** — Production setup, nginx, systemd, SSL
- **[Technical Docs](TECHNICAL.md)** — Architecture, database schema, API reference

---

## 🔐 Security

Cosmogram is designed with security as a first-class concern:

- **No cloud dependencies** — all data stays on your server
- **JWT with httpOnly cookies** — immune to XSS token theft
- **Role-based middleware** — every admin endpoint requires `requireAdmin`
- **Path validation** — file operations restricted to allowed directories
- **Rate limiting** — 20 login attempts, 200 API requests per 15 minutes
- **CSP headers** — prevents inline script injection (except necessary unsafe-inline)
- **Input sanitization** — all user input filtered through express-validator and xss

See [SECURITY.md](docs/SECURITY.md) for full details.

---

## 🛠️ Scripts

### Thumbnail Generation

```bash
# Generate thumbnails for all media
node scripts/generate-thumbnails.js

# Specific folder
node scripts/generate-thumbnails.js --folder vacation2024

# Preview without generating
node scripts/generate-thumbnails.js --dry-run

# Force regeneration (high quality)
node scripts/generate-thumbnails.js --force --quality 90
```

### User Management

```bash
# List users
node scripts/manage-users.js list

# Create user
node scripts/manage-users.js create --username john --email john@example.com

# Reset admin password
node scripts/manage-users.js reset --username admin
```

### System Monitoring

```bash
# Run diagnostic
./scripts/diagnose.sh

# Check system health
systemctl status cosmogram
journalctl -u cosmogram -f
```

---

## 🆚 Version Comparison

| Feature | 1.x | 2.0 |
|---------|-----|------|
| Import method | CLI only | Web UI with preview |
| Media selection | All-or-nothing | Selective, up to 20 per post |
| Media deletion | Whole post only | Individual photos/videos |
| Admin controls | None | Full-screen web panel with tabs |
| Thumbnail quality | Pre-generated | Sharp, on-demand |
| Comment UX | Page reload | Lightweight update |
| Public access | No | Public gallery mode with auth banner |
| Video compression | None | Client-side (Canvas + MediaRecorder) |
| Mobile UX | Basic | Swipe carousel, pinch-to-zoom, pan |
| Documentation | Minimal | Comprehensive |

---

## 🐛 Known Issues & Limitations

- Max 20 files per post (by design for performance)
- Video thumbnails use first frame only
- Import requires files organized in folders under `/opt/media/files/`
- Client-side video compression produces silent WebM (audio track not preserved)
- Some mobile browsers/WebViews cannot decode video via blob URL — falls back to original format
- Pinch-to-zoom supports images only (not videos)

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **Sharp** — blazing fast image processing
- **SQLite** — reliable, zero-config database
- **Express** — minimal web framework
- **Better-sqlite3** — synchronous SQLite bindings

---

**Built with ❤️ for privacy and simplicity.**
