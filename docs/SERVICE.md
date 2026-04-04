# Сервис Cosmogram

## Архитектура

```
Internet
   │
   ▼
nginx (10.222.0.25, mail server)
   │  SSL: /etc/ssl/certs/iRedMail.crt
   │  HTTPS: https://video.rupru.ru
   │
   ▼ proxy_pass http://10.222.0.98:8000
Cosmogram (10.222.0.98)
   │  Node.js / Express
   │  Port: 8000
   │  systemd: cosmogram.service
   │
   ├── /opt/cosmogram/server.js          — сервер
   ├── /opt/cosmogram/data/media.db      — SQLite база
   ├── /opt/cosmogram/uploads/images/    — миниатюры изображений (.webp, ~8KB)
   ├── /opt/cosmogram/uploads/videos/    — симлинки → /opt/media/files/**/video/*.mp4
   └── /opt/cosmogram/uploads/thumbnails/
```

## systemd сервис

### Файл юнита

`/etc/systemd/system/cosmogram.service` — копия `/opt/cosmogram/cosmogram.service`

```ini
[Unit]
Description=Cosmogram Media Gallery Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cosmogram
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cosmogram

# Limits
LimitNOFILE=65536
LimitNPROC=4096

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/cosmogram/data /opt/cosmogram/uploads

# Environment
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Установка / обновление сервиса

```bash
# После изменений в cosmogram.service — переустановка
cp /opt/cosmogram/cosmogram.service /etc/systemd/system/cosmogram.service
systemctl daemon-reload
systemctl restart cosmogram
```

### Управление

```bash
# Запуск / остановка / рестарт
systemctl start cosmogram
systemctl stop cosmogram
systemctl restart cosmogram

# Автозагрузка при boot
systemctl enable cosmogram
systemctl disable cosmogram

# Статус
systemctl status cosmogram

# Логи
journalctl -u cosmogram -f          # follow
journalctl -u cosmogram --since "1 hour ago"
journalctl -u cosmogram -n 50       # последние 50 строк
```

## nginx proxy (на mail-сервере 10.222.0.25)

### Конфиг

`/etc/nginx/sites-available/cosmogram` → symlink → `/etc/nginx/sites-enabled/`

```nginx
server {
    listen 443 ssl;
    server_name video.rupru.ru;

    ssl_certificate     /etc/ssl/certs/iRedMail.crt;
    ssl_certificate_key /etc/ssl/private/iRedMail.key;

    location / {
        proxy_pass http://10.222.0.98:8000;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Для видео (seek, range requests)
        proxy_http_version 1.1;
        proxy_set_header Range        $http_range;
        proxy_set_header If-Range     $http_if_range;
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;

        # Таймауты
        proxy_connect_timeout 60s;
        proxy_send_timeout    600s;
        proxy_read_timeout    600s;

        # WebSocket
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Cookies авторизации
        proxy_cookie_path / /;
    }
}
```

### Проверка / перезагрузка nginx

```bash
# На mail-сервере (10.222.0.25)
nginx -t                          # проверить конфиг
systemctl reload nginx            # перечитать конфиг без простоя
```

## Импорт медиа

См. [`IMPORT.md`](IMPORT.md) — полное описание скрипта импорта.

### Кратко

```bash
# Фаза 1: сканирование (читает EXIF, сохраняет в очередь)
node scripts/import-media.js scan

# Фаза 2: импорт (создаёт посты, копирует миниатюры, симлинки на видео)
node scripts/import-media.js import

# Если процесс умирает — запускать timeout-раундами
timeout 180 node scripts/import-media.js import   # повторять пока pending != 0
```

### Что импортируется

| Тип | Источник | Действие | Размер |
|---|---|---|---|
| Изображения | `/opt/media/thumbs/**/*.thumb.webp` | Копия | ~8KB |
| Видео | `/opt/media/files/**/*.mp4` | Симлинк | 0B (ссылка) |

### Итог импорта (текущее состояние)

```
Постов:     1268
Медиа:      25265
Изображений: 23775  (миниатюры .webp)
Видео:       1492  (симлинки на оригиналы)
Ошибок:         0
```

## Клиентское сжатие при загрузке

При публикации новых фото через интерфейс — **браузер автоматически сжимает** изображение перед отправкой:

| Параметр | Значение |
|---|---|
| Макс. разрешение | 1920×1920px |
| Формат | JPEG |
| Качество | 0.82 |
| Видео | без изменений |

Типичный результат: 7MB → 300KB (96% экономия).

## Бэкап

```bash
# Критичные данные
tar czf /backup/cosmogram-$(date +%F).tar.gz \
    /opt/cosmogram/data/media.db \
    /opt/cosmogram/cosmogram.service

# Полная копия (включая uploads)
tar czf /backup/cosmogram-full-$(date +%F).tar.gz \
    /opt/cosmogram/data/ \
    /opt/cosmogram/uploads/ \
    /opt/cosmogram/cosmogram.service
```

## Восстановление

```bash
# Распаковать бэкап
tar xzf /backup/cosmogram-full-YYYY-MM-DD.tar.gz -C /

# Переустановить сервис
cp /opt/cosmogram/cosmogram.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cosmogram
```

## Диагностика

```bash
# Сервис работает?
systemctl is-active cosmogram

# Порт 8000 слушается?
ss -tlnp | grep 8000

# API отвечает?
curl -s http://127.0.0.1:8000/health

# Медиа доступно?
curl -sI http://127.0.0.1:8000/uploads/images/test.webp

# Проход через nginx-прокси?
curl -skI https://10.222.0.25/ -H "Host: video.rupru.ru"

# Статистика БД
sqlite3 /opt/cosmogram/data/media.db \
    "SELECT COUNT(*) as posts FROM posts;
     SELECT COUNT(*) as media FROM post_media;"

# Симлинки видео валидны?
find /opt/cosmogram/uploads/videos/ -type l ! -exec test -e {} \; -print
```
