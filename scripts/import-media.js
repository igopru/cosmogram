#!/usr/bin/env node
/**
 * Cosmogram Bulk Media Import — двухэтапный
 * 
 * Этап 1: scan     — сканирует файлы, читает EXIF даты, сохраняет в import_queue
 * Этап 2: import   — читает import_queue, создаёт посты и копирует файлы
 * 
 * Использование:
 *   node scripts/import-media.js scan     — сканирование
 *   node scripts/import-media.js import   — импорт из очереди
 *   node scripts/import-media.js status   — статус очереди
 *   node scripts/import-media.js clear    — очистить очередь
 * 
 * Конфигурация ниже в CONFIG.
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const CONFIG = {
    sourceDir: '/opt/media/files/',
    thumbSourceDir: '/opt/media/thumbs/',
    username: 'admin',
    groupByMinutes: 1440,         // группировка по дате (минуты)
    dateFrom: '',                 // фильтр 'YYYY-MM-DD'
    dateTo: '',
    maxFiles: 0,                  // 0 = без лимита
    dryRun: false,
    recursive: true,
    batchSize: 20,                // файлов в одном посте
    skipThumbnails: false,        // используем готовые миниатюры из thumbSourceDir
    thumbnailDir: path.join(__dirname, '../uploads/thumbnails'),
    thumbnailSize: 600,
    thumbnailQuality: 80,
    allowedImageTypes: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    allowedVideoTypes: ['.mp4', '.webm', '.mov', '.avi'],
};

// ============================================================
// Helpers
// ============================================================

function getDB() {
    return new Database(path.join(__dirname, '../data/media.db'));
}

function getMediaType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (CONFIG.allowedImageTypes.includes(ext)) return 'image';
    if (CONFIG.allowedVideoTypes.includes(ext)) return 'video';
    return null;
}

function isAllowedType(filename) {
    const ext = path.extname(filename).toLowerCase();
    return [...CONFIG.allowedImageTypes, ...CONFIG.allowedVideoTypes].includes(ext);
}

function readExifDate(filePath) {
    // Быстрое чтение EXIF через exiftool (установлен вместе с exiftool-vendored)
    // Если нет — fallback к stat
    try {
        const ext = path.extname(filePath).toLowerCase();
        if (['.jpg', '.jpeg', '.tiff', '.tif'].includes(ext)) {
            // Прямой вызов exiftool — быстро для одного файла
            const result = execSync(
                `exiftool -d "%Y:%m:%d %H:%M:%S" -DateTimeOriginal -s3 "${filePath}" 2>/dev/null`,
                { timeout: 3000, maxBuffer: 1024 }
            ).toString().trim();
            
            if (result && /^\d{4}:\d{2}:\d{2}/.test(result)) {
                // Формат EXIF: 2024:01:15 10:30:00
                const fixed = result.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
                return new Date(fixed);
            }
        }
    } catch (e) {
        // exiftool не установлен или файл битый
    }
    
    // Fallback: дата создания файла
    try {
        const stats = fs.statSync(filePath);
        return new Date(stats.birthtimeMs || stats.mtimeMs);
    } catch (e) {
        return new Date();
    }
}

// ============================================================
// Этап 1: СКАНИРОВАНИЕ
// ============================================================

function scanFiles() {
    const db = getDB();
    
    // Создаём очередь импорта
    db.exec(`
        CREATE TABLE IF NOT EXISTS import_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            media_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_date DATETIME NOT NULL,
            status TEXT DEFAULT 'pending',
            error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_import_queue_status ON import_queue(status);
        CREATE INDEX IF NOT EXISTS idx_import_queue_date ON import_queue(file_date);
        CREATE INDEX IF NOT EXISTS idx_import_queue_status_date ON import_queue(status, file_date);
    `);

    // Очищаем предыдущую очередь
    db.exec('DELETE FROM import_queue');

    console.log('═══════════════════════════════════════════════');
    console.log('  Этап 1: Сканирование файлов');
    console.log('═══════════════════════════════════════════════\n');
    
    if (!fs.existsSync(CONFIG.sourceDir)) {
        console.error(`❌ Directory not found: ${CONFIG.sourceDir}`);
        process.exit(1);
    }

    // Рекурсивный обход — сразу пишем в БД, без накопления в памяти
    console.log(`📁 Scanning: ${CONFIG.sourceDir}`);

    const insertQueue = db.prepare(`
        INSERT INTO import_queue (source_path, filename, media_type, file_size, file_date)
        VALUES (?, ?, ?, ?, ?)
    `);

    const insertBatch = db.transaction((items) => {
        for (const item of items) {
            insertQueue.run(item.sourcePath, item.filename, item.mediaType, item.fileSize, item.fileDate);
        }
    });

    let fileCount = 0;
    const startTime = Date.now();
    const BATCH = 500;
    let batch = [];

    function scanDir(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory() && CONFIG.recursive) {
                scanDir(fullPath);
            } else if (entry.isFile() && isAllowedType(entry.name)) {
                const stats = fs.statSync(fullPath);
                const fileDate = readExifDate(fullPath);

                batch.push({
                    sourcePath: fullPath,
                    filename: path.basename(fullPath),
                    mediaType: getMediaType(fullPath),
                    fileSize: stats.size,
                    fileDate: fileDate.toISOString().slice(0, 19).replace('T', ' ')
                });

                fileCount++;

                if (batch.length >= BATCH) {
                    insertBatch(batch);
                    batch = [];
                    if (fileCount % 1000 === 0) {
                        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                        const speed = Math.round(fileCount / (Date.now() - startTime) * 1000);
                        console.log(`   ${fileCount} files processed (${speed} files/sec, ${elapsed}s elapsed)`);
                    }
                    // GC hint — сбрасываем batch чтобы не держать в памяти
                }
            }
        }
    }
    scanDir(CONFIG.sourceDir);

    // Остаток batch
    if (batch.length > 0) {
        insertBatch(batch);
        batch = [];
    }

    console.log(`\n   Found ${fileCount} media files`);

    const count = db.prepare('SELECT COUNT(*) as count FROM import_queue').get();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    
    console.log(`\n   ✅ ${count.count} files saved to queue (${elapsed}s)`);
    
    // Статистика по датаам
    const dateRange = db.prepare(`
        SELECT MIN(file_date) as min_date, MAX(file_date) as max_date FROM import_queue
    `).get();
    console.log(`   📅 Date range: ${dateRange.min_date} → ${dateRange.max_date}`);
    
    db.close();
}

// ============================================================
// Этап 2: ИМПОРТ
// ============================================================

function importFiles() {
    const db = getDB();
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    
    console.log('═══════════════════════════════════════════════');
    console.log('  Этап 2: Импорт файлов');
    console.log('═══════════════════════════════════════════════\n');

    const user = db.prepare('SELECT id, username FROM users WHERE username = ? AND active = 1').get(CONFIG.username);
    if (!user) {
        console.error(`❌ User "${CONFIG.username}" not found`);
        db.close();
        process.exit(1);
    }

    const pendingCount = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'pending'").get();
    console.log(`📋 Pending: ${pendingCount.count}`);
    console.log(`👤 User: ${user.username}`);
    console.log(`📦 Post size: ${CONFIG.batchSize} files`);
    console.log(`🏃 Dry run: ${CONFIG.dryRun}\n`);

    if (pendingCount.count === 0) {
        console.log('📭 Queue is empty. Run "scan" first.');
        db.close();
        return;
    }

    const uploadDir = path.join(__dirname, '../uploads/images');
    const videoDir = path.join(__dirname, '../uploads/videos');
    const thumbDir = CONFIG.thumbnailDir;
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.mkdirSync(videoDir, { recursive: true });
    fs.mkdirSync(thumbDir, { recursive: true });

    const insertPost = db.prepare(`
        INSERT INTO posts (user_id, description, allow_comments, created_at)
        VALUES (?, ?, ?, ?)
    `);
    const insertMedia = db.prepare(`
        INSERT INTO post_media (post_id, media_type, media_path, thumbnail_path, sort_order)
        VALUES (?, ?, ?, ?, ?)
    `);
    const markDone = db.prepare(`
        UPDATE import_queue SET status = 'done' WHERE id = ?
    `);
    const markError = db.prepare(`
        UPDATE import_queue SET status = 'error', error = ? WHERE id = ?
    `);

    let successCount = 0;
    let errorCount = 0;
    const startTime = Date.now();

    const CHUNK_SIZE = 2000;

    while (true) {
        const chunk = db.prepare(`
            SELECT * FROM import_queue
            WHERE status = 'pending'
            ORDER BY file_date ASC
            LIMIT ?
        `).all(CHUNK_SIZE);

        if (chunk.length === 0) break;

        // Группируем по дате
        const groups = [];
        let currentGroup = [chunk[0]];
        let currentDate = new Date(chunk[0].file_date).getTime();
        const thresholdMs = CONFIG.groupByMinutes * 60 * 1000;

        for (let i = 1; i < chunk.length; i++) {
            const fileDate = new Date(chunk[i].file_date).getTime();
            if (Math.abs(fileDate - currentDate) <= thresholdMs && currentGroup.length < CONFIG.batchSize) {
                currentGroup.push(chunk[i]);
            } else {
                groups.push(currentGroup);
                currentGroup = [chunk[i]];
                currentDate = fileDate;
            }
        }
        if (currentGroup.length > 0) groups.push(currentGroup);

        for (const group of groups) {
            if (group.length === 0) continue;

            const firstDate = new Date(group[0].file_date);
            const dateStr = firstDate.toLocaleDateString('ru-RU', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            const description = group.length > 1
                ? `📸 ${group.length} фото — ${dateStr}`
                : `📷 ${dateStr}`;
            const createdAt = firstDate.toISOString();

            if (CONFIG.dryRun) {
                console.log(`[DRY RUN] ${group.length} file(s) — ${dateStr}`);
                for (const item of group) markDone.run(item.id);
                successCount++;
                continue;
            }

            try {
                const postResult = insertPost.run(user.id, description, 1, createdAt);
                const postId = postResult.lastInsertRowid;

                for (let i = 0; i < group.length; i++) {
                    const item = group[i];
                    const ext = path.extname(item.filename).toLowerCase();
                    let destPath = null;

                    try {
                        if (item.media_type === 'image') {
                            // Для изображений — копия миниатюры (~8KB)
                            const baseName = path.basename(item.filename, ext);
                            const thumbRelDir = path.relative(CONFIG.sourceDir, path.dirname(item.source_path));
                            const thumbSourcePath = path.join(CONFIG.thumbSourceDir, thumbRelDir, `${baseName}.thumb.webp`);

                            if (fs.existsSync(thumbSourcePath)) {
                                const destName = `${uuidv4()}.webp`;
                                destPath = path.join(uploadDir, destName);
                                fs.copyFileSync(thumbSourcePath, destPath);
                            } else {
                                console.error(`  ⚠️  No thumb for ${item.filename}`);
                                markError.run('Thumbnail not found', item.id);
                                continue;
                            }
                        } else {
                            // Для видео — симлинк на оригинал (быстро, без копирования)
                            const destName = `${uuidv4()}${ext}`;
                            destPath = path.join(videoDir, destName);
                            fs.symlinkSync(item.source_path, destPath);
                        }
                        markDone.run(item.id);
                    } catch (e) {
                        console.error(`  ⚠️  Skip ${item.filename}: ${e.message.substring(0, 60)}`);
                        markError.run(e.message.substring(0, 200), item.id);
                        continue;
                    }

                    insertMedia.run(postId, item.media_type, destPath, null, i);
                }

                successCount++;
            } catch (e) {
                errorCount++;
                console.error(`  ❌ Post error: ${e.message.substring(0, 100)}`);
                for (const item of group) markError.run(e.message.substring(0, 200), item.id);
            }
        }

        // Прогресс
        const remaining = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'pending'").get();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const speed = successCount > 0 ? Math.round(successCount / (elapsed / 60)) : 0;
        const eta = speed > 0 ? Math.round(remaining.count / speed) : '?';
        
        console.log(`✅ Posts: ${successCount} | Pending: ${remaining.count} | Speed: ${speed}/min | ETA: ~${eta}min`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('  Import Complete');
    console.log('═══════════════════════════════════════════════');
    console.log(`   ✅ Success: ${successCount} posts`);
    console.log(`   ❌ Errors: ${errorCount} posts`);
    console.log(`   ⏱️  Time: ${elapsed}s`);
    console.log('═══════════════════════════════════════════════\n');

    db.close();
}

// ============================================================
// Статус
// ============================================================

function showStatus() {
    const db = getDB();
    
    try {
        const total = db.prepare('SELECT COUNT(*) as count FROM import_queue').get();
        if (!total.count) {
            console.log('📭 Queue is empty. Run "scan" first.');
            db.close();
            return;
        }

        const pending = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'pending'").get();
        const done = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'done'").get();
        const errors = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'error'").get();

        const dateRange = db.prepare(`
            SELECT MIN(file_date) as min_date, MAX(file_date) as max_date FROM import_queue
        `).get();

        console.log('═══════════════════════════════════════════════');
        console.log('  Import Queue Status');
        console.log('═══════════════════════════════════════════════');
        console.log(`   Total:    ${total.count}`);
        console.log(`   Pending:  ${pending.count}`);
        console.log(`   Done:     ${done.count}`);
        console.log(`   Errors:   ${errors.count}`);
        console.log(`   Dates:    ${dateRange.min_date} → ${dateRange.max_date}`);
        console.log('═══════════════════════════════════════════════');
    } catch (e) {
        console.log('📭 Queue does not exist. Run "scan" first.');
    }
    
    db.close();
}

function clearQueue() {
    const db = getDB();
    db.exec('DROP TABLE IF EXISTS import_queue');
    console.log('✅ Queue cleared');
    db.close();
}

// ============================================================
// Main
// ============================================================

const command = process.argv[2] || '';

switch (command) {
    case 'scan':
        scanFiles();
        break;
    case 'import':
        importFiles();
        break;
    case 'status':
        showStatus();
        break;
    case 'clear':
        clearQueue();
        break;
    default:
        console.log(`
╔═══════════════════════════════════════════════════╗
║  Cosmogram Bulk Media Import (Two-Stage)          ║
╚═══════════════════════════════════════════════════╝

${'Usage:'}
  node scripts/import-media.js <command>

${'Commands:'}
  scan    - Scan files, read EXIF dates, save to queue
  import  - Import files from queue (creates posts)
  status  - Show queue status
  clear   - Clear queue

${'Example:'}
  # Step 1: Scan (быстро — только метаданные)
  node scripts/import-media.js scan

  # Step 2: Import (медленно — копирование файлов)
  node scripts/import-media.js import

${'Config:'}
  Edit CONFIG at the top of the script to change:
  - sourceDir
  - username
  - groupByMinutes
  - maxFiles
  - dryRun
`);
        process.exit(0);
}
