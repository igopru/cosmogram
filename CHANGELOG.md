# Changelog

## [2.0.0] — 2026-04-08 🎉 **MAJOR RELEASE**

> **Cosmogram 2.0** — Private, secure, local media gallery with full content management.
> The most convenient and functional media service for personal and team use.

### 🛡️ Security & Privacy
- **100% Local** — all data stored on your server, no cloud dependencies
- **JWT Authentication** — secure session management with httpOnly cookies
- **Role-based access control** — admin and user roles with middleware enforcement
- **Path validation** — all file operations restricted to allowed directories
- **Rate limiting** — strict limits on API endpoints (login, posts, comments, likes)
- **Security headers** — Helmet, CSP, XSS protection, frame-ancestors blocked
- **Input sanitization** — express-mongo-sanitize, XSS filtering, validation middleware

### 👑 Admin Panel
- **Web-based admin interface** — no CLI needed, full control from browser
- **⚙️ Admin button** in header (visible only to admin users)
- **Folder browser** — view all source media folders at a glance
- **Import queue management** — monitor pending/done/error statuses
- **Queue clearing** — safe cleanup with confirmation

### 🖼️ Preview Gallery with Selective Import
- **Full folder preview** — see ALL files from ALL subfolders before importing
- **Click to select** — choose exactly which photos/videos to include (up to 20 per post)
- **Mix from subfolders** — combine files from different subfolders into one post
- **Real-time counter** — shows selected/total/max count
- **"Select First 20"** — quick select button
- **Bad quality exclusion** — easily skip blurry, duplicate, or unwanted shots
- **Auto-generated descriptions** — includes folder name, file count, and EXIF date

### 🗑️ Granular Content Control
- **Delete individual media** — remove specific photos/videos from any post
  - **Owner:** can delete media from own posts
  - **Admin:** can delete ANY media from ANY post
- **Delete entire posts** — with confirmation and cascade cleanup
- **Admin post deletion** — remove any post (with content moderation in mind)
- **Smart UI updates** — carousel updates without full page reload

### 🔧 Thumbnail Generation
- **`generate-thumbnails.js`** — high-quality WebP thumbnails from originals
- **Sharp library** — superior quality vs old pre-generated thumbnails
- **Configurable** — width, quality, force regeneration, dry-run mode
- **On-the-fly generation** — if thumbnail doesn't exist, generates automatically
- **Video frame previews** — first frame extracted for video thumbnails

### 🐛 Bug Fixes
- **Login broken** — fixed `db.close()` calls in admin routes that broke shared DB connection
- **Likes broken** — fixed `validateId` middleware mismatch with `:postId` parameter
- **Admin button disappearing** — fixed `showFeed()` to restore admin button visibility
- **Comment scroll jump** — removed `loadFeed()` after comment, now uses lightweight badge update
- **Import queue migration** — automatic `ALTER TABLE` for existing databases adding `excluded` column
- **Variable name collision** — renamed `selectedFiles` → `adminSelectedFiles` to avoid upload modal conflict

### 📚 Documentation
- **ADMIN_PANEL.md** — complete admin panel usage guide
- **PREVIEW_AND_THUMBNAILS.md** — thumbnail generation and preview workflow
- **SECURITY.md** — security architecture and hardening guide
- **Updated README.md** — comprehensive feature list for 2.0

### 📊 What Changed Since 1.x
| Feature | 1.x | 2.0 |
|---------|-----|-----|
| Import method | CLI only, all-or-nothing | Web UI, selective, preview-first |
| Media deletion | Whole post only | Individual photos/videos |
| Admin controls | None | Full web panel |
| Thumbnail quality | Old pre-generated | Sharp, high-quality, on-demand |
| Comment UX | Full page reload | Lightweight update, no scroll jump |
| Security headers | Basic | Full CSP, Helmet, XSS, rate limits |
| Documentation | Minimal | Comprehensive guides |

---

## [1.1.0] — 2026-04-06

### 🏷️ Теги и Подписки

#### Backend
- **Новые таблицы БД:**
  - `tags` — теги (id, name UNIQUE, created_at)
  - `post_tags` — связь постов и тегов (post_id, tag_id, PRIMARY KEY, CASCADE)
  - `subscriptions` — подписки пользователей (follower_id, following_user_id/tag_id, CHECK constraint)
- **Новые API endpoints (`/api/tags`):**
  - `GET /` — список всех тегов с количеством постов и статусом подписки
  - `POST /` — создание тега
  - `POST /post/:postId` — добавить теги к посту
  - `DELETE /post/:postId/:tagId` — удалить тег с поста
  - `POST /subscribe/user/:userId` — подписка/отписка на пользователя (toggle)
  - `POST /subscribe/tag/:tagId` — подписка/отписка на тег (toggle)
  - `GET /subscriptions` — получить подписки текущего пользователя
- **Обновлён `GET /api/posts/feed`:**
  - Параметр `?filter=all|subscribed|tag:xxx`
  - `subscribed` — только посты от подписанных пользователей
  - `tag:xxx` — посты с конкретным тегом
  - Каждый пост содержит поле `tags` (массив) и `is_subscribed` (boolean)
- **Обновлён `POST /api/posts`:**
  - Принимает `tags` в body (JSON array) — автоматически создаёт и привязывает теги

#### Frontend
- **Фильтры ленты:**
  - Вкладки: "All" / "Subscriptions" / теги-фильтры
  - Клик по тегу в облаке или на посте → фильтрация
- **Облако тегов:**
  - Отображает до 30 тегов с индикатором подписки (○/🔔)
  - Клик по тегу → фильтрация ленты
  - Клик по колокольчику → подписка/отписка
- **Теги на постах:**
  - Отображаются под медиа как `#tagname`
  - Клик → фильтрация по тегу
- **Кнопка подписки на автора:**
  - "+ Follow" / "✓ Subscribed" рядом с именем
  - Обновляется без перезагрузки
- **Ввод тегов при создании поста:**
  - Поле с автодополнением (предлагает существующие теги)
  - Enter или запятая — добавление тега
  - Визуальные бейджи с возможностью удаления
  - Очистка при reset формы

### 🖼️ Fullscreen режим

- **Горизонтальный скролл (карусель):**
  - Свайп на мобильных / колёсико мыши на десктопе
  - Полная замена слайда (fade transition), не scroll-snap
  - Клавиши ← → для навигации, Esc для выхода
- **Одиночные фото:**
  - Кнопка ⛶ для входа в fullscreen
  - Нет навигации (один элемент)
- **Кнопки:**
  - ⛶ выхода в правом нижнем углу (поверх изображения)
  - Счётчик `2/5` в правом верхнем углу
  - Закрытие по клику на фон
- **Исправления:**
  - Wheel handler корректно удаляется при выходе (скролл страницы восстанавливается)
  - Поддержка одиночных медиа (не только карусель)

### 🎠 Карусель

- **Фиксированная высота:** 500px (350px mobile)
- **Opacity transitions** вместо display:none — плавные переходы
- **Нет свайпа** — только кнопки ◀ ▶ и точки
- **Первый слайд видим** — класс `.active` в HTML при генерации
- **Счётчик** в правом верхнем углу, кнопки навигации фиксированы

### ⬆️ Загрузка файлов

- **Компактная сетка превью:** 70px ячейки, max-height 280px со скроллом
- **Кнопка Publish** всегда видна даже с 10 файлами
- **Поле тегов** с автодополнением и визуальными бейджами

### 🐛 Bug Fixes

- **Invalid Date:** корректный парсинг дат с/без timezone
- **Publish button пропадала:** `resetUploadForm` восстанавливает `display: block`
- **Первая картинка чёрная:** `.active` класс в HTML при генерации
- **Наложение изображений:** `visibility: hidden/visible` вместо opacity-only
- **Скролл после fullscreen:** корректный `removeEventListener` для wheel handler
- **VM зависания:** устранены зомби процессы из старой папки `old`

### ⚡ Performance

- **Feed оптимизация:** batch query комментариев — ~95% reduction в DB запросах
- **SQLite WAL:** aggressive checkpoint (100 страниц), mmap 256MB
- **Автооптимизация БД:** каждые 30 минут
- **IOWAIT:** снижен с 6%+ до ~4%

### 🛠️ Мониторинг

- **system-monitor.sh:** каждые 5 минут через cron
- **diagnose.sh:** ручная диагностика при зависаниях
- **Health logging:** каждые 5 минут в journalctl
- **Slow requests:** логирование запросов >1 сек
- **Алерты:** IOWAIT >10%, Load >5, Memory >500MB, WAL >100MB

---

## [1.0.0] — Initial Release

- Instagram-like media gallery
- Photo/video uploads with carousel
- Likes, comments
- User authentication (JWT)
- SQLite database
- Mass import from archives
- Dark/light theme
- Responsive design
