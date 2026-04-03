# Cosmogram — Media Gallery Platform

Инстаграм-подобная платформа для хранения и просмотра фото/видео с массовым импортом архивов.

---

## 📋 Содержание

1. [Быстрый старт](#быстрый-старт)
2. [Установка](#установка)
3. [Настройка nginx](#настройка-nginx)
4. [Systemd сервис](#systemd-сервис)
5. [Функции платформы](#функции-платформы)
6. [Управление пользователями](#управление-пользователями)
7. [Массовый импорт](#массовый-импорт)
8. [API Endpoints](#api-endpoints)
9. [Структура проекта](#структура-проекта)
10. [Устранение проблем](#устранение-проблем)

---

## Быстрый старт

```bash
# 1. Установка
cd /path/to/cosmogram
npm install

# 2. Настройка (отредактируй .env)
nano .env

# 3. Запуск
npm start

# 4. Открыть в браузере
# http://localhost:8000 или https://yourdomain.com
```

**Демо доступ:** `admin@localhost` / `Admin123!`

---

## Установка

### Требования

| Компонент | Версия |
|-----------|--------|
| Node.js | 20+ |
| npm | 10+ |
| nginx | 1.18+ (для HTTPS) |

### Шаги

```bash
cd /path/to/cosmogram
npm install
```

### Конфигурация (.env)

```env
# Сервер
NODE_ENV=production
PORT=8000

# Безопасность
JWT_SECRET=<сгенерируй случайный ключ>
SESSION_SECRET=<сгенерируй случайный ключ>
BCRYPT_ROUNDS=12

# CORS
ALLOWED_ORIGINS=https://yourdomain.com

# Загрузки
MAX_FILE_SIZE=10485760
```

---

## Настройка nginx

### Конфигурация

Создай файл `/etc/nginx/sites-available/yourdomain.com`:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/ssl/cert.t;
    ssl_certificate_key /path/to/ssl/key.;

    location / {
        proxy_pass http://localhost:8000;

        # Базовые заголовки
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # КРИТИЧНО ДЛЯ COOKIE (авторизация)
        proxy_cookie_path / /;

        # КРИТИЧНО ДЛЯ ВИДЕО (перемотка)
        proxy_http_version 1.1;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;

        # Без буферизации — видео играет сразу
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;

        # Таймауты
        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;

        # WebSocket
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_ignore_headers X-Accel-Buffering;
    }
}
```

### Активация

```bash
ln -s /etc/nginx/sites-available/yourdomain.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## Systemd сервис

### Установка

```bash
cp /path/to/cosmogram/cosmogram.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable cosmogram
systemctl start cosmogram
systemctl status cosmogram
```

### Команды управления

```bash
systemctl status cosmogram      # Статус
journalctl -u cosmogram -f      # Логи в реальном времени
systemctl restart cosmogram     # Перезапуск
systemctl stop cosmogram        # Остановка
```

---

## Функции платформы

### 👤 Авторизация
- Регистрация с валидацией
- Вход по email + пароль
- JWT куки (7 дней)
- Выход из аккаунта

### 📸 Медиа посты
- Загрузка фото/видео через UI
- Несколько медиа в одном посте (карусель)
- Свайп фото на мобильных (touch)
- Drag мышкой на десктопе
- Точки-индикаторы + счётчик `1/5`
- Описание к постам (до 2200 символов)

### ❤️ Лайки
- Like/unlike с анимацией
- Счётчик лайков в реальном времени
- Защита от повторных лайков

### 💬 Комментарии
- Добавление комментариев
- Отображение имени автора
- Удаление своих комментариев

### 🗑️ Управление постами
- Удаление своих постов
- Автоматическое удаление файлов
- Каскадное удаление комментариев/лайков

### 🌓 Темы
- Светлая и тёмная тема
- Сохранение выбора в localStorage

### 👤 Профиль
- Просмотр профиля
- Статистика (посты, подписчики)
- Аватар с эмодзи

---

## Управление пользователями

### CLI скрипт

```bash
node scripts/manage-users.js <command> [options]
```

### Команды

| Команда | Описание | Пример |
|---------|----------|--------|
| `create` | Создать пользователя | `node scripts/manage-users.js create --username john --email john@test.com --password "pass1234"` |
| `list` | Все пользователи | `node scripts/manage-users.js list` |
| `info` | Информация | `node scripts/manage-users.js info --username john` |
| `block` | Заблокировать | `node scripts/manage-users.js block --username john` |
| `unblock` | Разблокировать | `node scripts/manage-users.js unblock --id 5` |
| `delete` | Удалить | `node scripts/manage-users.js delete --id 5 --force` |
| `promote` | Сделать админом | `node scripts/manage-users.js promote --username john` |
| `demote` | Убрать админа | `node scripts/manage-users.js demote --username john` |
| `resetpw` | Сброс пароля | `node scripts/manage-users.js resetpw --username john --password "newpass123"` |

### Примеры использования

```bash
# Создать пользователя
node scripts/manage-users.js create \
  --username photographer \
  --email photo@example.com \
  --password "SecurePass123!" \
  --fullname "Иван Петров"

# Показать всех
node scripts/manage-users.js list

# Заблокировать
node scripts/manage-users.js block --username photographer

# Разблокировать
node scripts/manage-users.js unblock --username photographer

# Удалить (мягкое — сохраняет посты)
node scripts/manage-users.js delete --username photographer

# Удалить навсегда
node scripts/manage-users.js delete --id 5 --force

# Сделать админом
node scripts/manage-users.js promote --username photographer

# Сбросить пароль
node scripts/manage-users.js resetpw --username photographer --password "NewPass456!"
```

### Роли

| Роль | Права |
|------|-------|
| `user` | Посты, комментарии, лайки |
| `admin` | Всё + управление пользователями через CLI |

### Блокировка

- **Мягкая (`block`)**: `active = 0`, пользователь не может войти, посты сохраняются
- **Жёсткая (`delete --force`)**: полное удаление из БД с постами

---

## Массовый импорт

### Настройка

Открой `scripts/import-media.js` и измени `CONFIG`:

```javascript
const CONFIG = {
    sourceDir: '/path/to/your/media/archive',    // Папка с архивом
    username: 'admin',                  // От чьего имени
    groupByMinutes: 1440,               // Группировка по дням
    dateFrom: '',                       // Фильтр с даты
    dateTo: '',                         // Фильтр по дату
    maxFiles: 0,                        // Лимит (0 = без лимита)
    dryRun: false,                      // true = тест без загрузки
    recursive: true,                    // Подпапки
};
```

### Группировка

| Значение | Поведение |
|----------|-----------|
| `0` | Каждый файл = отдельный пост |
| `30` | Файлы в пределах 30 мин = один пост |
| `1440` | Файлы одного дня = один пост ✅ |

### Запуск

```bash
# 1. Тест (dry run)
# Установи dryRun: true в CONFIG
node scripts/import-media.js

# 2. Реальный импорт
# Установи dryRun: false, maxFiles: 100 (для начала)
node scripts/import-media.js
```

### Что происходит

1. Сканирует папку рекурсивно
2. Читает EXIF даты (JPEG) или дату файла
3. Фильтрует по `dateFrom`/`dateTo`
4. Сортирует по дате
5. Группирует по `groupByMinutes`
6. Для каждой группы:
   - Создаёт пост с датой
   - Копирует файлы в `uploads/`
   - Генерирует миниатюры
   - Сохраняет в БД

### Поддерживаемые форматы

- **Фото:** JPG, JPEG, PNG, WebP, GIF
- **Видео:** MP4, WebM, MOV, AVI

---

## API Endpoints

### Authentication

| Method | Endpoint | Auth | Описание |
|--------|----------|------|----------|
| POST | `/api/auth/register` | ❌ | Регистрация |
| POST | `/api/auth/login` | ❌ | Вход |
| POST | `/api/auth/logout` | ✅ | Выход |
| GET | `/api/auth/me` | ✅ | Текущий пользователь |

### Posts

| Method | Endpoint | Auth | Описание |
|--------|----------|------|----------|
| GET | `/api/posts/feed` | ✅ | Лента (последние 20) |
| POST | `/api/posts` | ✅ | Создать пост (multipart) |
| DELETE | `/api/posts/:id` | ✅ | Удалить пост (owner only) |

### Comments

| Method | Endpoint | Auth | Описание |
|--------|----------|------|----------|
| GET | `/api/comments/post/:postId` | ✅ | Комментарии поста |
| POST | `/api/comments` | ✅ | Добавить комментарий |
| DELETE | `/api/comments/:id` | ✅ | Удалить комментарий |

### Likes

| Method | Endpoint | Auth | Описание |
|--------|----------|------|----------|
| POST | `/api/likes/toggle/:postId` | ✅ | Like/unlike |
| GET | `/api/likes/post/:postId` | ✅ | Список лайков |

---

## Структура проекта

```
/path/to/cosmogram/
├── server.js                    # Express сервер
├── package.json                 # Зависимости
├── .env                         # Переменные окружения
├── cosmogram.service            # Systemd сервис
│
├── models/
│   └── database.js              # Инициализация БД
├── middleware/
│   ├── auth.js                  # JWT аутентификация
│   ├── security.js              # XSS защита, заголовки
│   └── validation.js            # Валидация запросов
├── routes/
│   ├── auth.js                  # Auth endpoints
│   ├── posts.js                 # Posts endpoints
│   ├── comments.js              # Comments endpoints
│   └── likes.js                 # Likes endpoints
├── scripts/
│   ├── import-media.js          # Массовый импорт файлов
│   ├── manage-users.js          # Управление пользователями
│   └── migrate-posts-table.js   # Миграция БД
├── public/
│   ├── index.html               # Фронтенд
│   ├── style.css                # Стили (+ тёмная тема)
│   ├── script.js                # Frontend логика
│   └── favicon.ico              # Иконка
├── uploads/
│   ├── images/                  # Загруженные фото
│   ├── thumbnails/              # Миниатюры
│   └── videos/                  # Видео
└── data/
    └── media.db                 # SQLite база
```

---

## Устранение проблем

### Авторизация не работает через HTTPS

**Проблема:** Вхожу через `https://yourdomain.com`, но после перезагрузки сессия теряется.

**Решение:** Добавь в nginx:
```nginx
proxy_cookie_path / /;
```
Перезапусти: `systemctl reload nginx`

### Видео не играет

**Проблема:** Видео загружается, но не перемотка не работает.

**Решение:** Проверь nginx:
```nginx
proxy_set_header Range $http_range;
proxy_set_header If-Range $http_if_range;
proxy_buffering off;
```

### Mixed Content ошибка

**Проблема:** Браузер блокирует загрузку фото/видео.

**Решение:** API возвращает protocol-relative URL (`//yourdomain.com/...`). Проверь что `trust proxy` включён в server.js.

### Импорт зависает

**Проблема:** Скрипт импорта показывает прогресс но не двигается.

**Решение:** 
- Для 220+ файлов это нормально — генерация миниатюр занимает время
- Уменьши `maxFiles: 100` для теста
- Увеличь лимит в `import-media.js`

### Сброс БД

```bash
# Останови сервис
systemctl stop cosmogram

# Удали базу (ВНИМАНИЕ: все данные удалятся)
rm /path/to/cosmogram/data/media.db*

# Перезапусти — БД создастся заново с admin пользователем
systemctl start cosmogram
```

### Логи

```bash
# Сервис
journalctl -u cosmogram -f

# nginx
journalctl -u nginx -f

# В браузере — DevTools Console (F12)
```

---

## Лицензия

MIT License
# cosmogram
