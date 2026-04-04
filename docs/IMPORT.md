# Импорт медиа в Cosmogram

## Кратко

Скрипт импорта работает в **две фазы**:
1. **scan** — сканирует `/opt/media/files/`, читает EXIF-даты, сохраняет очередь в БД
2. **import** — читает очередь, создаёт посты, копирует файлы

## Ключевые параметры

| Параметр | Значение | Описание |
|---|---|---|
| `sourceDir` | `/opt/media/files/` | Источник медиафайлов |
| `thumbSourceDir` | `/opt/media/thumbs/` | Готовые миниатюры (для изображений) |
| `batchSize` | `20` | Макс. файлов в одном посте |
| `groupByMinutes` | `1440` | Группировка по дате (24 часа) |
| `username` | `admin` | Пользователь, от которого создаются посты |

## Как работает

### Фаза 1: Scan
```bash
node scripts/import-media.js scan
```
- Рекурсивно сканирует `sourceDir`
- Для каждого файла читает EXIF дату (или fallback к mtime)
- Сохраняет в таблицу `import_queue` с датой, типом, размером
- **Память**: файлы пишутся в БД сразу при обходе, без накопления в памяти
- Прогресс: каждые 1000 файлов

### Фаза 2: Import
```bash
node scripts/import-media.js import
```
- Берёт файлы из `import_queue` по дате (ORDER BY file_date)
- Группирует файлы с близкими датами (в пределах `groupByMinutes`)
- **Максимум 20 файлов на пост**
- Для **изображений**: копирует `.thumb.webp` из `thumbSourceDir` (~8KB)
- Для **видео**: создаёт **симлинк** на оригинал в `sourceDir` (мгновенно)
- Создаёт посты с описанием вида `📸 20 фото — 7 июня 2025 г.`

## Очистка и повторный запуск

```bash
# Очистить БД (посты + медиа + очередь)
sqlite3 data/media.db "DELETE FROM post_media; DELETE FROM posts; DELETE FROM sqlite_sequence WHERE name IN ('posts','post_media'); DROP TABLE IF EXISTS import_queue;"

# Очистить uploads
rm -f uploads/images/* uploads/videos/* uploads/thumbnails/*

# Перезапустить с нуля
node scripts/import-media.js scan
node scripts/import-media.js import
```

## Мониторинг прогресса

```bash
# Статус очереди
node scripts/import-media.js status

# Или напрямую в БД
sqlite3 data/media.db "
    SELECT 
        (SELECT COUNT(*) FROM posts) as posts,
        (SELECT COUNT(*) FROM import_queue WHERE status='done') as done,
        (SELECT COUNT(*) FROM import_queue WHERE status='pending') as pending,
        (SELECT COUNT(*) FROM import_queue WHERE status='error') as errors;
"

# Файлы на диске
ls uploads/images/ | wc -l   # изображений
ls uploads/videos/ | wc -l   # видео
```

## Важные детали

1. **Изображения** — используются **миниатюры** (~8KB), а не оригиналы (~7MB). Без этого браузер/сервер задыхаются.
2. **Видео** — **симлинки** на оригиналы в `/opt/media/files/`. Мгновенно, без копирования.
3. **Синхронность** — скрипт полностью последовательный, без async. Всё через `fs.copyFileSync` / `fs.symlinkSync`.
4. **Ограничение памяти** — scan пишет файлы в БД сразу при обходе дерева (batch по 500), без накопления массива всех файлов.
5. **Запуск** — для больших библиотек запускать через `timeout` в несколько раундов (процесс может умереть после ~10K записей):
   ```bash
   timeout 180 node scripts/import-media.js import
   # Повторять пока pending != 0
   ```

## Статус сервиса

```bash
# Проверить работу сервера
systemctl status cosmogram

# Перезапустить после изменений
systemctl restart cosmogram

# Логи
journalctl -u cosmogram -f
```
