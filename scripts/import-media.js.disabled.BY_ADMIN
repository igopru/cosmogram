#!/usr/bin/env node
/**
 * Cosmogram Bulk Media Import — groups by folder AND time
 *
 * Key logic:
 * • Files from DIFFERENT folders are NEVER merged into one post
 * • Within a folder, files are grouped by time window (groupByMinutes)
 * • Each folder is processed independently
 *
 * Usage:
 *   node scripts/import-media.js scan     — scan files, save to queue
 *   node scripts/import-media.js import   — import from queue (creates posts)
 *   node scripts/import-media.js status   — show queue status
 *   node scripts/import-media.js clear    — clear queue
 *   node scripts/import-media.js reset    — reset all posts + media (keeps users)
 *
 * Configuration below in CONFIG.
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
    sourceDir: '/opt/media/files/',
    thumbSourceDir: '/opt/media/thumbs/',
    username: 'admin',
    groupByMinutes: 1440,         // time window for grouping within a folder (minutes)
    dateFrom: '',                 // filter 'YYYY-MM-DD'
    dateTo: '',
    maxFiles: 0,                  // 0 = no limit
    dryRun: false,
    recursive: true,
    batchSize: 20,                // max files in one post
    skipThumbnails: false,
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
    try {
        const ext = path.extname(filePath).toLowerCase();
        if (['.jpg', '.jpeg', '.tiff', '.tif'].includes(ext)) {
            const result = execSync(
                `exiftool -d "%Y:%m:%d %H:%M:%S" -DateTimeOriginal -s3 "${filePath}" 2>/dev/null`,
                { timeout: 3000, maxBuffer: 1024 }
            ).toString().trim();

            if (result && /^\d{4}:\d{2}:\d{2}/.test(result)) {
                const fixed = result.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
                return new Date(fixed);
            }
        }
    } catch (e) {
        // exiftool not available or file corrupted
    }

    // Fallback: file creation/modification time
    try {
        const stats = fs.statSync(filePath);
        return new Date(stats.birthtimeMs || stats.mtimeMs);
    } catch (e) {
        return new Date();
    }
}

// ============================================================
// Stage 1: SCAN
// ============================================================

function scanFiles() {
    const db = getDB();

    // Drop old table (without folder_path) and recreate
    db.exec('DROP TABLE IF EXISTS import_queue');

    // Create queue table — includes folder_path for grouping
    db.exec(`
        CREATE TABLE import_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            folder_path TEXT NOT NULL,
            media_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_date DATETIME NOT NULL,
            status TEXT DEFAULT 'pending',
            error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_import_queue_status ON import_queue(status);
        CREATE INDEX IF NOT EXISTS idx_import_queue_date ON import_queue(file_date);
        CREATE INDEX IF NOT EXISTS idx_import_queue_folder ON import_queue(folder_path);
        CREATE INDEX IF NOT EXISTS idx_import_queue_status_folder_date ON import_queue(status, folder_path, file_date);
    `);

    console.log('═══════════════════════════════════════════════');
    console.log('  Stage 1: Scanning files');
    console.log('═══════════════════════════════════════════════\n');

    if (!fs.existsSync(CONFIG.sourceDir)) {
        console.error(`❌ Directory not found: ${CONFIG.sourceDir}`);
        process.exit(1);
    }

    console.log(`📁 Scanning: ${CONFIG.sourceDir}`);

    const insertQueue = db.prepare(`
        INSERT INTO import_queue (source_path, filename, folder_path, media_type, file_size, file_date)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertBatch = db.transaction((items) => {
        for (const item of items) {
            insertQueue.run(item.sourcePath, item.filename, item.folderPath, item.mediaType, item.fileSize, item.fileDate);
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

                // folder_path is relative to sourceDir for clean grouping
                const folderPath = path.relative(CONFIG.sourceDir, dir) || '.';

                batch.push({
                    sourcePath: fullPath,
                    filename: path.basename(fullPath),
                    folderPath: folderPath,
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
                }
            }
        }
    }
    scanDir(CONFIG.sourceDir);

    // Remaining batch
    if (batch.length > 0) {
        insertBatch(batch);
        batch = [];
    }

    console.log(`\n   Found ${fileCount} media files`);

    const count = db.prepare('SELECT COUNT(*) as count FROM import_queue').get();
    const folderCount = db.prepare('SELECT COUNT(DISTINCT folder_path) as count FROM import_queue').get();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    console.log(`\n   ✅ ${count.count} files saved to queue (${elapsed}s)`);
    console.log(`   📁 ${folderCount.count} unique folders`);

    const dateRange = db.prepare(`
        SELECT MIN(file_date) as min_date, MAX(file_date) as max_date FROM import_queue
    `).get();
    console.log(`   📅 Date range: ${dateRange.min_date} → ${dateRange.max_date}`);

    db.close();
}

// ============================================================
// Stage 2: IMPORT
// ============================================================

function importFiles() {
    const db = getDB();
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    console.log('═══════════════════════════════════════════════');
    console.log('  Stage 2: Importing files');
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

    // Get all unique folders
    const folders = db.prepare(`
        SELECT DISTINCT folder_path FROM import_queue WHERE status = 'pending'
    `).all().map(f => f.folder_path);

    console.log(`📁 Processing ${folders.length} folder(s):\n`);
    folders.forEach(f => console.log(`   • ${f === '.' ? '(root)' : f}`));
    console.log('');

    for (const folder of folders) {
        console.log(`\n📂 Folder: ${folder === '.' ? '(root)' : folder}`);

        // Get all pending files for this folder, sorted by date
        const files = db.prepare(`
            SELECT * FROM import_queue
            WHERE status = 'pending' AND folder_path = ?
            ORDER BY file_date ASC
        `).all(folder);

        if (files.length === 0) continue;

        // Group files by time window WITHIN this folder
        const groups = [];
        let currentGroup = [files[0]];
        let currentDate = new Date(files[0].file_date).getTime();
        const thresholdMs = CONFIG.groupByMinutes * 60 * 1000;

        for (let i = 1; i < files.length; i++) {
            const fileDate = new Date(files[i].file_date).getTime();
            const timeDiff = Math.abs(fileDate - currentDate);

            // Start new group if:
            // 1. Time difference exceeds threshold, OR
            // 2. Current group reached batch size limit
            if (timeDiff > thresholdMs || currentGroup.length >= CONFIG.batchSize) {
                groups.push(currentGroup);
                currentGroup = [files[i]];
                currentDate = fileDate;
            } else {
                currentGroup.push(files[i]);
            }
        }
        if (currentGroup.length > 0) groups.push(currentGroup);

        console.log(`   📊 ${files.length} files → ${groups.length} post(s)`);

        // Create posts for each group
        for (const group of groups) {
            if (group.length === 0) continue;

            const firstDate = new Date(group[0].file_date);
            const dateStr = firstDate.toLocaleDateString('ru-RU', {
                year: 'numeric', month: 'long', day: 'numeric'
            });

            // Include folder name in description if not root
            const folderLabel = folder !== '.' ? `[${folder}] ` : '';
            const description = group.length > 1
                ? `📸 ${folderLabel}${group.length} фото — ${dateStr}`
                : `📷 ${folderLabel}${dateStr}`;
            const createdAt = firstDate.toISOString();

            if (CONFIG.dryRun) {
                console.log(`   [DRY RUN] ${group.length} file(s) — ${description}`);
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
                            // For images — copy thumbnail from thumbSourceDir
                            const baseName = path.basename(item.filename, ext);
                            const thumbRelDir = path.relative(CONFIG.sourceDir, path.dirname(item.source_path));
                            const thumbSourcePath = path.join(CONFIG.thumbSourceDir, thumbRelDir, `${baseName}.thumb.webp`);

                            if (fs.existsSync(thumbSourcePath)) {
                                const destName = `${uuidv4()}.webp`;
                                destPath = path.join(uploadDir, destName);
                                fs.copyFileSync(thumbSourcePath, destPath);
                            } else {
                                console.error(`      ⚠️  No thumb for ${item.filename}`);
                                markError.run('Thumbnail not found', item.id);
                                continue;
                            }
                        } else {
                            // For videos — create symlink to original
                            const destName = `${uuidv4()}${ext}`;
                            destPath = path.join(videoDir, destName);
                            fs.symlinkSync(item.source_path, destPath);
                        }
                        markDone.run(item.id);
                    } catch (e) {
                        console.error(`      ⚠️  Skip ${item.filename}: ${e.message.substring(0, 60)}`);
                        markError.run(e.message.substring(0, 200), item.id);
                        continue;
                    }

                    insertMedia.run(postId, item.media_type, destPath, null, i);
                }

                successCount++;
            } catch (e) {
                errorCount++;
                console.error(`      ❌ Post error: ${e.message.substring(0, 100)}`);
                for (const item of group) markError.run(e.message.substring(0, 200), item.id);
            }
        }

        // Progress
        const remaining = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'pending'").get();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const speed = successCount > 0 ? Math.round(successCount / (elapsed / 60)) : 0;
        const eta = speed > 0 ? Math.round(remaining.count / speed) : '?';

        console.log(`   ✅ Done | Total posts: ${successCount} | Pending: ${remaining.count} | Speed: ${speed}/min | ETA: ~${eta}min`);
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
// Status
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
        const folders = db.prepare("SELECT COUNT(DISTINCT folder_path) as count FROM import_queue").get();

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
        console.log(`   Folders:  ${folders.count}`);
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
    case 'reset':
        // Execute reset script
        execSync(`node ${path.join(__dirname, 'reset-database.js')}`, { stdio: 'inherit' });
        break;
    default:
        console.log(`
╔═══════════════════════════════════════════════════╗
║  Cosmogram Bulk Media Import                      ║
╚═══════════════════════════════════════════════════╝

${'Usage:'}
  node scripts/import-media.js <command>

${'Commands:'}
  scan    - Scan files, read EXIF dates, save to queue
  import  - Import files from queue (creates posts)
  status  - Show queue status
  clear   - Clear queue
  reset   - Reset all posts and media (keeps users)

${'Grouping logic:'}
  • Files from DIFFERENT folders → separate posts
  • Files within same folder + time window → one post
  • Max ${CONFIG.batchSize} files per post

${'Config:'}
  Edit CONFIG at the top of the script to change:
  - sourceDir
  - username
  - groupByMinutes
  - batchSize
  - dryRun
`);
        process.exit(0);
}
