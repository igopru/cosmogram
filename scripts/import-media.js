#!/usr/bin/env node
/**
 * Bulk Import Script for Cosmogram Media Gallery
 * 
 * Сканирует указанную папку, группирует файлы по дате создания
 * и загружает их как посты в ленту.
 * 
 * Использование:
 *   node scripts/import-media.js
 * 
 * Конфигурация ниже в CONFIG объекте.
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { exiftool } from 'exiftool-vendored';

// ============================================================
// КОНФИГУРАЦИЯ - измените эти параметры
// ============================================================
const CONFIG = {
    // Путь к папке с фото/видео для импорта
    // ИЗМЕНИТЕ на путь к вашему архиву
    sourceDir: '/path/to/your/media/archive',

    // Имя пользователя, от имени которого создавать посты
    username: 'admin',

    // Группировка по дате (в минутах).
    // 0 = каждый файл отдельный пост
    // 30 = файлы в пределах 30 минут объединяются
    // 1440 = файлы одного дня объединяются (рекомендуется для архивов)
    groupByMinutes: 1440,

    // Фильтр по дате (опционально)
    // Оставить пустыми строками для импорта всех файлов
    dateFrom: '',  // например '2023-01-01'
    dateTo: '',    // например '2023-12-31'

    // Папка для миниатюр
    thumbnailDir: path.join(import.meta.dirname, '../uploads/thumbnails'),
    thumbnailSize: 600,
    thumbnailQuality: 80,

    // Максимальное количество файлов за раз (0 = без лимита)
    // Рекомендуется для тестирования — начните с 50-100
    maxFiles: 0,

    // Сухой запуск (true = только показать что будет сделано, без загрузки)
    // Всегда начинайте с dryRun: true для проверки!
    dryRun: false,

    // Рекурсивно обходить подпапки
    recursive: true,

    // Какие типы файлов импортировать
    allowedImageTypes: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    allowedVideoTypes: ['.mp4', '.webm', '.mov', '.avi'],
};

// ============================================================
// Вспомогательные функции
// ============================================================

function getDB() {
    const dbPath = path.join(import.meta.dirname, '../data/media.db');
    return new Database(dbPath);
}

function getFileDate(filePath) {
    // Пытаемся получить дату из EXIF
    // Если не получается - используем дату модификации файла
    return new Promise(async (resolve) => {
        try {
            const stats = fs.statSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            
            // Для изображений пробуем EXIF
            if (['.jpg', '.jpeg', '.tiff', '.tif'].includes(ext)) {
                try {
                    const tags = await exiftool.read(filePath);
                    if (tags.DateTimeOriginal) {
                        resolve(new Date(tags.DateTimeOriginal));
                        return;
                    }
                    if (tags.CreateDate) {
                        resolve(new Date(tags.CreateDate));
                        return;
                    }
                } catch (e) {
                    // EXIF нечитаем, fallback к mtime
                }
            }
            
            // Fallback: дата создания/модификации файла
            resolve(stats.birthtime || stats.mtime);
        } catch (e) {
            console.error(`Error reading file date for ${filePath}:`, e.message);
            resolve(new Date());
        }
    });
}

function isAllowedType(filename) {
    const ext = path.extname(filename).toLowerCase();
    return [...CONFIG.allowedImageTypes, ...CONFIG.allowedVideoTypes].includes(ext);
}

function getMediaType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (CONFIG.allowedImageTypes.includes(ext)) return 'image';
    if (CONFIG.allowedVideoTypes.includes(ext)) return 'video';
    return null;
}

function scanDirectory(dirPath) {
    const files = [];
    
    function scan(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory() && CONFIG.recursive) {
                scan(fullPath);
            } else if (entry.isFile() && isAllowedType(entry.name)) {
                files.push(fullPath);
            }
        }
    }
    
    scan(dirPath);
    return files;
}

function filterByDate(files, dates) {
    if (!CONFIG.dateFrom && !CONFIG.dateTo) return { files, dates };
    
    const filtered = [];
    const filteredDates = [];
    
    const from = CONFIG.dateFrom ? new Date(CONFIG.dateFrom) : new Date('1900-01-01');
    const to = CONFIG.dateTo ? new Date(CONFIG.dateTo + 'T23:59:59') : new Date('2100-12-31');
    
    for (let i = 0; i < files.length; i++) {
        if (dates[i] >= from && dates[i] <= to) {
            filtered.push(files[i]);
            filteredDates.push(dates[i]);
        }
    }
    
    return { files: filtered, dates: filteredDates };
}

function groupFilesByDate(files, dates) {
    if (CONFIG.groupByMinutes <= 0) {
        // Каждый файл - отдельный пост
        return files.map((file, i) => [file]);
    }
    
    const groups = [];
    let currentGroup = [files[0]];
    let currentGroupDate = dates[0];
    const thresholdMs = CONFIG.groupByMinutes * 60 * 1000;
    
    for (let i = 1; i < files.length; i++) {
        const timeDiff = Math.abs(dates[i] - currentGroupDate);
        
        if (timeDiff <= thresholdMs) {
            // Добавляем в текущую группу
            currentGroup.push(files[i]);
        } else {
            // Начинаем новую группу
            groups.push(currentGroup);
            currentGroup = [files[i]];
            currentGroupDate = dates[i];
        }
    }
    
    // Добавляем последнюю группу
    if (currentGroup.length > 0) {
        groups.push(currentGroup);
    }
    
    return groups;
}

async function generateThumbnail(sourcePath, destPath) {
    try {
        await sharp(sourcePath)
            .resize(CONFIG.thumbnailSize, CONFIG.thumbnailSize, { fit: 'inside' })
            .jpeg({ quality: CONFIG.thumbnailQuality })
            .toFile(destPath);
        return true;
    } catch (e) {
        console.error(`  ⚠️  Thumbnail generation failed: ${e.message}`);
        return false;
    }
}

async function importPost(db, userId, files, fileDates, description) {
    const createdAt = fileDates[0].toISOString();
    const uploadDir = path.join(import.meta.dirname, '../uploads/images');
    const videoDir = path.join(import.meta.dirname, '../uploads/videos');
    
    const insertPost = db.prepare(`
        INSERT INTO posts (user_id, description, allow_comments, created_at)
        VALUES (?, ?, ?, ?)
    `);
    
    const insertMedia = db.prepare(`
        INSERT INTO post_media (post_id, media_type, media_path, thumbnail_path, sort_order)
        VALUES (?, ?, ?, ?, ?)
    `);
    
    let postId;
    
    if (CONFIG.dryRun) {
        console.log(`  [DRY RUN] Post with ${files.length} file(s), date: ${createdAt}`);
        return;
    }
    
    try {
        const result = insertPost.run(userId, description, 1, createdAt);
        postId = result.lastInsertRowid;

        for (let i = 0; i < files.length; i++) {
            const sourceFile = files[i];
            const mediaType = getMediaType(sourceFile);
            const ext = path.extname(sourceFile);
            const newFilename = `${uuidv4()}${ext}`;
            const destDir = mediaType === 'video' ? videoDir : uploadDir;
            const destPath = path.join(destDir, newFilename);

            // Копируем файл
            fs.copyFileSync(sourceFile, destPath);
            process.stdout.write(`\r    📁 Copying file ${i + 1}/${files.length}...`);

            let thumbnailPath = null;
            if (mediaType === 'image') {
                const thumbFilename = `thumb_${newFilename}`;
                thumbnailPath = path.join(CONFIG.thumbnailDir, thumbFilename);
                await generateThumbnail(destPath, thumbnailPath);
            }

            insertMedia.run(postId, mediaType, destPath, thumbnailPath, i);
        }
        
        process.stdout.write('\n');
        console.log(`  ✅ Post created with ${files.length} media file(s)`);
    } catch (e) {
        process.stdout.write('\n');
        console.error(`  ❌ Import failed: ${e.message}`);
    }
}

// ============================================================
// Основная функция
// ============================================================
async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  Cosmogram Bulk Media Import');
    console.log('═══════════════════════════════════════════════\n');
    
    // Валидация конфигурации
    if (!fs.existsSync(CONFIG.sourceDir)) {
        console.error(`❌ Source directory not found: ${CONFIG.sourceDir}`);
        console.error('   Please update CONFIG.sourceDir in the script.');
        process.exit(1);
    }
    
    // Получаем пользователя
    const db = getDB();
    const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(CONFIG.username);
    
    if (!user) {
        console.error(`❌ User "${CONFIG.username}" not found in database.`);
        const users = db.prepare('SELECT username FROM users').all();
        if (users.length > 0) {
            console.log(`   Available users: ${users.map(u => u.username).join(', ')}`);
        }
        process.exit(1);
    }
    
    console.log(`📁 Source: ${CONFIG.sourceDir}`);
    console.log(`👤 User: ${user.username} (ID: ${user.id})`);
    console.log(`📅 Group by: ${CONFIG.groupByMinutes} minutes`);
    console.log(`🔄 Recursive: ${CONFIG.recursive}`);
    console.log(`🏃 Dry run: ${CONFIG.dryRun}`);
    console.log('');
    
    // Создаём директории
    fs.mkdirSync(CONFIG.thumbnailDir, { recursive: true });
    
    // Сканируем файлы
    console.log('🔍 Scanning directory...');
    const allFiles = scanDirectory(CONFIG.sourceDir);
    console.log(`   Found ${allFiles.length} media files`);
    
    if (allFiles.length === 0) {
        console.log('   No files to import. Exiting.');
        process.exit(0);
    }
    
    // Ограничиваем количество
    if (CONFIG.maxFiles > 0 && allFiles.length > CONFIG.maxFiles) {
        console.log(`   Limiting to first ${CONFIG.maxFiles} files`);
        allFiles.length = CONFIG.maxFiles;
    }
    
    // Получаем даты файлов
    console.log('📅 Reading file dates...');
    const dates = [];
    for (let i = 0; i < allFiles.length; i++) {
        const date = await getFileDate(allFiles[i]);
        dates.push(date);
        if ((i + 1) % 100 === 0) {
            console.log(`   Processed ${i + 1}/${allFiles.length} files...`);
        }
    }
    
    // Фильтруем по дате
    const { files: filteredFiles, dates: filteredDates } = filterByDate(allFiles, dates);
    console.log(`   ${filteredFiles.length} files after date filtering`);
    
    if (filteredFiles.length === 0) {
        console.log('   No files in date range. Exiting.');
        process.exit(0);
    }
    
    // Сортируем по дате
    const sorted = filteredFiles.map((f, i) => ({ file: f, date: filteredDates[i] }))
        .sort((a, b) => a.date - b.date);
    const sortedFiles = sorted.map(s => s.file);
    const sortedDates = sorted.map(s => s.date);
    
    // Группируем файлы
    const groups = groupFilesByDate(sortedFiles, sortedDates);
    console.log(`   Grouped into ${groups.length} posts`);
    console.log('');
    
    // Импортируем
    console.log('📤 Importing posts...');
    let successCount = 0;
    let errorCount = 0;
    
    for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        const groupDates = group.map(f => sortedDates[sortedFiles.indexOf(f)]);
        const firstDate = groupDates[0];
        
        // Формируем описание из даты
        const dateStr = firstDate.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const description = group.length > 1 ? `📸 ${group.length} фото — ${dateStr}` : `📷 ${dateStr}`;
        
        console.log(`[${g + 1}/${groups.length}] ${group.length} file(s) — ${dateStr}`);
        
        try {
            await importPost(db, user.id, group, groupDates, description);
            successCount++;
        } catch (e) {
            errorCount++;
            console.error(`   ❌ Error: ${e.message}`);
        }
    }
    
    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('  Import Summary');
    console.log('═══════════════════════════════════════════════');
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📊 Total posts: ${successCount + errorCount}`);
    console.log('═══════════════════════════════════════════════\n');
    
    await exiftool.end();
    db.close();
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
