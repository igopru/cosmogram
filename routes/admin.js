import express from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { getDB } from '../models/database.js';
import { requireAdmin } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configuration for media scanning
const MEDIA_CONFIG = {
    allowedImageTypes: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    allowedVideoTypes: ['.mp4', '.webm', '.mov', '.avi'],
    thumbSourceDir: '/opt/media/thumbs/',
    batchSize: 20,                // max files in one post
    groupByMinutes: 1440,         // time window for grouping within a folder (minutes)
    thumbnailDir: path.join(__dirname, '../uploads/thumbnails'),
    uploadDir: path.join(__dirname, '../uploads/images'),
    videoDir: path.join(__dirname, '../uploads/videos'),
    previewWidth: 400,            // width for preview thumbnails
    previewQuality: 75,
    minVideoDuration: parseFloat(process.env.MIN_VIDEO_DURATION) || 1.0, // seconds
};

function getVideoDuration(filePath) {
    try {
        const result = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
            { timeout: 10000, maxBuffer: 1024 }
        ).toString().trim();
        const duration = parseFloat(result);
        return isNaN(duration) ? null : duration;
    } catch {
        return null;
    }
}

function getMediaType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (MEDIA_CONFIG.allowedImageTypes.includes(ext)) return 'image';
    if (MEDIA_CONFIG.allowedVideoTypes.includes(ext)) return 'video';
    return null;
}

function isAllowedType(filename) {
    const ext = path.extname(filename).toLowerCase();
    return [...MEDIA_CONFIG.allowedImageTypes, ...MEDIA_CONFIG.allowedVideoTypes].includes(ext);
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

// Generate preview thumbnail on-the-fly
async function generatePreview(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        
        const preview = await sharp(filePath)
            .resize(MEDIA_CONFIG.previewWidth, MEDIA_CONFIG.previewWidth, {
                fit: 'inside',
                withoutEnlargement: true,
            })
            .webp({
                quality: MEDIA_CONFIG.previewQuality,
                effort: 4,
            })
            .toBuffer();
        
        return preview;
    } catch (error) {
        console.error(`Preview generation error for ${filePath}:`, error.message);
        return null;
    }
}

// Get existing thumbnail or generate preview
function getThumbnailOrPreview(filePath, filename) {
    const ext = path.extname(filename).toLowerCase();
    const baseName = path.basename(filename, ext);
    const fileDir = path.relative('/opt/media/files/', path.dirname(filePath));
    const thumbPath = path.join(MEDIA_CONFIG.thumbSourceDir, fileDir, `${baseName}.thumb.webp`);
    
    if (fs.existsSync(thumbPath)) {
        return { type: 'thumbnail', path: thumbPath };
    }
    
    return { type: 'needs_preview', path: filePath };
}

// ============================================================
// Admin API Routes
// ============================================================

// GET /api/admin/media/sources - List available source directories
router.get('/media/sources', requireAdmin, (req, res) => {
    try {
        const db = getDB();

        // Get the default source directory
        const sourceDir = '/opt/media/files/';

        // Scan for subdirectories
        let folders = [];
        if (fs.existsSync(sourceDir)) {
            const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
            folders = entries
                .filter(e => e.isDirectory())
                .map(e => ({
                    name: e.name,
                    path: path.join(sourceDir, e.name),
                    label: e.name
                }));
        }

        // Get already imported folders from import_queue
        const importedFolders = db.prepare(`
            SELECT DISTINCT folder_path, COUNT(*) as file_count 
            FROM import_queue 
            WHERE status = 'done' 
            GROUP BY folder_path
        `).all();

        res.json({
            sourceDir,
            folders,
            importedFolders: importedFolders
        });
    } catch (error) {
        console.error('Error getting source folders:', error);
        res.status(500).json({ error: 'Failed to get source folders' });
    }
});

// GET /api/admin/media/preview/:folderPath - Get preview images for a folder
router.get('/media/preview/:folderPath', requireAdmin, async (req, res) => {
    try {
        const { folderPath } = req.params;
        const sourceDir = '/opt/media/files/';
        const fullPath = path.join(sourceDir, folderPath);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: `Folder not found: ${fullPath}` });
        }

        // Scan files and generate previews on-the-fly
        const files = [];

        function scanDir(dir) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else if (entry.isFile() && isAllowedType(entry.name)) {
                    const stats = fs.statSync(fullPath);
                    const fileDate = readExifDate(fullPath);
                    const folderPathRel = path.relative(sourceDir, dir) || folderPath;

                    files.push({
                        sourcePath: fullPath,
                        filename: path.basename(fullPath),
                        folderPath: folderPathRel,
                        mediaType: getMediaType(fullPath),
                        fileSize: stats.size,
                        fileDate: fileDate.toISOString().slice(0, 19).replace('T', ' '),
                        hasPreview: false
                    });
                }
            }
        }

        scanDir(fullPath);

        // Sort by date
        files.sort((a, b) => new Date(a.fileDate) - new Date(b.fileDate));

        res.json({
            folderPath,
            totalFiles: files.length,
            files: files.slice(0, 100) // Limit to 100 for performance
        });
    } catch (error) {
        console.error('Error getting preview files:', error);
        res.status(500).json({ error: 'Failed to get preview files' });
    }
});

// GET /api/admin/media/thumb/* - Serve thumbnail or generate preview on-the-fly
router.get('/media/thumb/*', requireAdmin, async (req, res) => {
    try {
        const filePath = path.join('/opt/media/files/', req.params[0]);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const ext = path.extname(filePath).toLowerCase();

        // For videos - return a frame preview
        if (MEDIA_CONFIG.allowedVideoTypes.includes(ext)) {
            try {
                const preview = await sharp(filePath)
                    .resize(MEDIA_CONFIG.previewWidth, MEDIA_CONFIG.previewWidth, {
                        fit: 'inside',
                        withoutEnlargement: true,
                    })
                    .webp({ quality: MEDIA_CONFIG.previewQuality })
                    .toBuffer();

                res.set('Content-Type', 'image/webp');
                res.set('Cache-Control', 'public, max-age=3600');
                return res.send(preview);
            } catch (error) {
                return res.status(500).json({ error: 'Video preview failed' });
            }
        }

        // Check for existing thumbnail first
        const baseName = path.basename(filePath, ext);
        const fileDir = path.relative('/opt/media/files/', path.dirname(filePath));
        const thumbPath = path.join(MEDIA_CONFIG.thumbSourceDir, fileDir, `${baseName}.thumb.webp`);

        if (fs.existsSync(thumbPath)) {
            return res.sendFile(thumbPath, {
                headers: {
                    'Content-Type': 'image/webp',
                    'Cache-Control': 'public, max-age=86400'
                }
            });
        }

        // Generate preview on-the-fly
        const preview = await generatePreview(filePath);
        if (!preview) {
            return res.status(500).json({ error: 'Preview generation failed' });
        }

        res.set('Content-Type', 'image/webp');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(preview);
    } catch (error) {
        console.error('Error serving thumb/preview:', error);
        res.status(500).json({ error: 'Failed to serve preview' });
    }
});

// POST /api/admin/media/scan - Scan a specific folder
router.post('/media/scan', requireAdmin, (req, res) => {
    try {
        const { folderPath, recursive = true, excludedFiles = [] } = req.body;

        if (!folderPath) {
            return res.status(400).json({ error: 'folderPath is required' });
        }

        const sourceDir = '/opt/media/files/';
        const fullPath = path.join(sourceDir, folderPath);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: `Folder not found: ${fullPath}` });
        }

        const db = getDB();

        // Create import_queue table if it doesn't exist
        db.exec(`
            CREATE TABLE IF NOT EXISTS import_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_path TEXT NOT NULL,
                filename TEXT NOT NULL,
                folder_path TEXT NOT NULL,
                media_type TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                file_date DATETIME NOT NULL,
                status TEXT DEFAULT 'pending',
                error TEXT,
                excluded INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_import_queue_status ON import_queue(status);
            CREATE INDEX IF NOT EXISTS idx_import_queue_date ON import_queue(file_date);
            CREATE INDEX IF NOT EXISTS idx_import_queue_folder ON import_queue(folder_path);
            CREATE INDEX IF NOT EXISTS idx_import_queue_status_folder_date ON import_queue(status, folder_path, file_date);
        `);

        // Migration: add 'excluded' column if it doesn't exist (for existing tables)
        try {
            db.exec(`ALTER TABLE import_queue ADD COLUMN excluded INTEGER DEFAULT 0`);
        } catch (e) {
            // Column already exists, ignore error
        }

        let fileCount = 0;
        const startTime = Date.now();
        const BATCH = 100;
        let batch = [];

        const insertQueue = db.prepare(`
            INSERT INTO import_queue (source_path, filename, folder_path, media_type, file_size, file_date, excluded)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const insertBatch = db.transaction((items) => {
            for (const item of items) {
                insertQueue.run(item.sourcePath, item.filename, item.folderPath, item.mediaType, item.fileSize, item.fileDate, item.excluded ? 1 : 0);
            }
        });

        function scanDir(dir) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory() && recursive) {
                    scanDir(fullPath);
                } else if (entry.isFile() && isAllowedType(entry.name)) {
                    const stats = fs.statSync(fullPath);
                    const fileDate = readExifDate(fullPath);
                    const folderPathRel = path.relative(sourceDir, dir) || folderPath;
                    const isExcluded = excludedFiles.includes(path.basename(fullPath));

                    batch.push({
                        sourcePath: fullPath,
                        filename: path.basename(fullPath),
                        folderPath: folderPathRel,
                        mediaType: getMediaType(fullPath),
                        fileSize: stats.size,
                        fileDate: fileDate.toISOString().slice(0, 19).replace('T', ' '),
                        excluded: isExcluded
                    });

                    fileCount++;

                    if (batch.length >= BATCH) {
                        insertBatch(batch);
                        batch = [];
                    }
                }
            }
        }

        scanDir(fullPath);

        // Remaining batch
        if (batch.length > 0) {
            insertBatch(batch);
            batch = [];
        }

        const count = db.prepare('SELECT COUNT(*) as count FROM import_queue WHERE folder_path = ?').get(folderPath);
        const pendingCount = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'pending' AND folder_path = ?").get(folderPath);
        const excludedCount = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE folder_path = ? AND excluded = 1").get(folderPath);


        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        res.json({
            success: true,
            folderPath,
            filesFound: fileCount,
            filesInQueue: count.count,
            pendingFiles: pendingCount.count,
            excludedFiles: excludedCount.count,
            scanTime: elapsed
        });
    } catch (error) {
        console.error('Error scanning folder:', error);
        res.status(500).json({ error: 'Failed to scan folder: ' + error.message });
    }
});

// POST /api/admin/media/scan-preview - Scan with preview mode (doesn't insert to queue)
router.post('/media/scan-preview', requireAdmin, async (req, res) => {
    try {
        const { folderPath, recursive = true } = req.body;

        if (!folderPath) {
            return res.status(400).json({ error: 'folderPath is required' });
        }

        const sourceDir = '/opt/media/files/';
        const fullPath = path.join(sourceDir, folderPath);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: `Folder not found: ${fullPath}` });
        }

        const files = [];
        const subfolders = new Set();

        function scanDir(dir) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory() && recursive) {
                    scanDir(fullPath);
                } else if (entry.isFile() && isAllowedType(entry.name)) {
                    const stats = fs.statSync(fullPath);
                    const fileDate = readExifDate(fullPath);
                    const folderPathRel = path.relative(sourceDir, dir) || folderPath;
                    subfolders.add(folderPathRel);

                    files.push({
                        sourcePath: fullPath,
                        filename: path.basename(fullPath),
                        folderPath: folderPathRel,
                        folderLabel: folderPathRel === folderPath ? folderPath : folderPath + '/' + folderPathRel,
                        mediaType: getMediaType(fullPath),
                        fileSize: stats.size,
                        fileDate: fileDate.toISOString().slice(0, 19).replace('T', ' '),
                        thumbUrl: `/api/admin/media/thumb/${path.relative(sourceDir, fullPath)}`
                    });
                }
            }
        }

        scanDir(fullPath);

        // Sort by date
        files.sort((a, b) => new Date(a.fileDate) - new Date(b.fileDate));

        res.json({
            success: true,
            folderPath,
            totalFiles: files.length,
            subfolders: Array.from(subfolders),
            files
        });
    } catch (error) {
        console.error('Error scanning for preview:', error);
        res.status(500).json({ error: 'Failed to scan for preview: ' + error.message });
    }
});

// POST /api/admin/media/import-selected - Import selected files as a single post
router.post('/media/import-selected', requireAdmin, async (req, res) => {
    try {
        const { files, description, createdAt } = req.body;

        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: 'No files selected for import' });
        }

        if (files.length > 20) {
            return res.status(400).json({ error: 'Maximum 20 files per post' });
        }

        const db = getDB();
        db.pragma('foreign_keys = ON');
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');

        // Get admin user
        const user = db.prepare('SELECT id, username FROM users WHERE username = ? AND active = 1').get('admin');
        if (!user) {
            return res.status(404).json({ error: 'Admin user not found' });
        }

        // Create directories if needed
        fs.mkdirSync(MEDIA_CONFIG.uploadDir, { recursive: true });
        fs.mkdirSync(MEDIA_CONFIG.videoDir, { recursive: true });
        fs.mkdirSync(MEDIA_CONFIG.thumbnailDir, { recursive: true });

        const insertPost = db.prepare(`
            INSERT INTO posts (user_id, description, allow_comments, created_at, is_public)
            VALUES (?, ?, ?, ?, ?)
        `);
        const insertMedia = db.prepare(`
            INSERT INTO post_media (post_id, media_type, media_path, thumbnail_path, sort_order)
            VALUES (?, ?, ?, ?, ?)
        `);

        // Use provided description and date, or generate from first file
        let postDescription = description;
        let postCreatedAt = createdAt;

        if (!postDescription && files.length > 0) {
            const firstFile = files[0];
            const firstDate = new Date(firstFile.fileDate);
            const dateStr = firstDate.toLocaleDateString('ru-RU', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            const folderLabel = firstFile.folderLabel || firstFile.folderPath;
            postDescription = files.length > 1
                ? `📸 [${folderLabel}] ${files.length} фото — ${dateStr}`
                : `📷 [${folderLabel}] ${dateStr}`;
            postCreatedAt = firstFile.fileDate;
        }

        try {
            const postResult = insertPost.run(user.id, postDescription, 1, postCreatedAt, 1);
            const postId = postResult.lastInsertRowid;

            let successCount = 0;
            const errors = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const sourcePath = path.join('/opt/media/files/', file.relativePath);
                const ext = path.extname(file.filename).toLowerCase();
                let destPath = null;

                try {
                    if (file.mediaType === 'image') {
                        // For images — copy thumbnail from thumbSourceDir or generate
                        const baseName = path.basename(file.filename, ext);
                        const fileDir = path.relative('/opt/media/files/', path.dirname(sourcePath));
                        const thumbSourcePath = path.join(MEDIA_CONFIG.thumbSourceDir, fileDir, `${baseName}.thumb.webp`);

                        if (fs.existsSync(thumbSourcePath)) {
                            const destName = `${uuidv4()}.webp`;
                            destPath = path.join(MEDIA_CONFIG.uploadDir, destName);
                            fs.copyFileSync(thumbSourcePath, destPath);
                        } else {
                            // Generate thumbnail on-the-fly using sharp
                            const preview = await generatePreview(sourcePath);
                            if (preview) {
                                const destName = `${uuidv4()}.webp`;
                                destPath = path.join(MEDIA_CONFIG.uploadDir, destName);
                                fs.writeFileSync(destPath, preview);
                            } else {
                                errors.push(`${file.filename}: Thumbnail not found`);
                                continue;
                            }
                        }
                    } else {
                        // For videos — check duration then create symlink
                        const duration = getVideoDuration(sourcePath);
                        if (duration !== null && duration < MEDIA_CONFIG.minVideoDuration) {
                            errors.push(`${file.filename}: Video too short (${duration.toFixed(2)}s, min ${MEDIA_CONFIG.minVideoDuration}s)`);
                            continue;
                        }
                        const destName = `${uuidv4()}${ext}`;
                        destPath = path.join(MEDIA_CONFIG.videoDir, destName);
                        fs.symlinkSync(sourcePath, destPath);
                    }
                } catch (e) {
                    errors.push(`${file.filename}: ${e.message.substring(0, 100)}`);
                    continue;
                }

                insertMedia.run(postId, file.mediaType, destPath, null, i);
                successCount++;
            }

            res.json({
                success: true,
                postId,
                filesImported: successCount,
                errors: errors.length > 0 ? errors : undefined
            });
        } catch (e) {
            console.error('Post creation error:', e);
            res.status(500).json({ error: 'Failed to create post: ' + e.message });
        }
    } catch (error) {
        console.error('Error importing selected files:', error);
        res.status(500).json({ error: 'Failed to import selected files: ' + error.message });
    }
});

// POST /api/admin/media/import - Import from queue for specific folder
router.post('/media/import', requireAdmin, (req, res) => {
    try {
        const { folderPath } = req.body;
        
        if (!folderPath) {
            return res.status(400).json({ error: 'folderPath is required' });
        }
        
        const db = getDB();
        db.pragma('foreign_keys = ON');
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        
        // Get admin user
        const user = db.prepare('SELECT id, username FROM users WHERE username = ? AND active = 1').get('admin');
        if (!user) {
            return res.status(404).json({ error: 'Admin user not found' });
        }
        
        // Create directories if needed
        fs.mkdirSync(MEDIA_CONFIG.uploadDir, { recursive: true });
        fs.mkdirSync(MEDIA_CONFIG.videoDir, { recursive: true });
        fs.mkdirSync(MEDIA_CONFIG.thumbnailDir, { recursive: true });
        
        const insertPost = db.prepare(`
            INSERT INTO posts (user_id, description, allow_comments, created_at, is_public)
            VALUES (?, ?, ?, ?, ?)
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
        
        // Get pending files for this folder (excluding marked as excluded)
        const files = db.prepare(`
            SELECT * FROM import_queue
            WHERE status = 'pending' AND folder_path = ? AND excluded = 0
            ORDER BY file_date ASC
        `).all(folderPath);
        
        if (files.length === 0) {
            return res.json({
                success: false,
                message: 'No pending files found for this folder',
                postsCreated: 0
            });
        }
        
        // Group files by time window
        const groups = [];
        let currentGroup = [files[0]];
        let currentDate = new Date(files[0].file_date).getTime();
        const thresholdMs = MEDIA_CONFIG.groupByMinutes * 60 * 1000;
        
        for (let i = 1; i < files.length; i++) {
            const fileDate = new Date(files[i].file_date).getTime();
            const timeDiff = Math.abs(fileDate - currentDate);
            
            if (timeDiff > thresholdMs || currentGroup.length >= MEDIA_CONFIG.batchSize) {
                groups.push(currentGroup);
                currentGroup = [files[i]];
                currentDate = fileDate;
            } else {
                currentGroup.push(files[i]);
            }
        }
        if (currentGroup.length > 0) groups.push(currentGroup);
        
        let successCount = 0;
        let errorCount = 0;
        const createdPosts = [];
        
        // Create posts for each group
        for (const group of groups) {
            if (group.length === 0) continue;
            
            const firstDate = new Date(group[0].file_date);
            const dateStr = firstDate.toLocaleDateString('ru-RU', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            
            const folderLabel = folderPath !== '.' ? `[${folderPath}] ` : '';
            const description = group.length > 1
                ? `📸 ${folderLabel}${group.length} фото — ${dateStr}`
                : `📷 ${folderLabel}${dateStr}`;
            const createdAt = firstDate.toISOString();
            
            try {
                const postResult = insertPost.run(user.id, description, 1, createdAt, 1);
                const postId = postResult.lastInsertRowid;
                
                for (let i = 0; i < group.length; i++) {
                    const item = group[i];
                    const ext = path.extname(item.filename).toLowerCase();
                    let destPath = null;
                    
                    try {
                        if (item.media_type === 'image') {
                            // For images — copy thumbnail from thumbSourceDir
                            const baseName = path.basename(item.filename, ext);
                            const thumbRelDir = path.relative('/opt/media/files/', path.dirname(item.source_path));
                            const thumbSourcePath = path.join(MEDIA_CONFIG.thumbSourceDir, thumbRelDir, `${baseName}.thumb.webp`);
                            
                            if (fs.existsSync(thumbSourcePath)) {
                                const destName = `${uuidv4()}.webp`;
                                destPath = path.join(MEDIA_CONFIG.uploadDir, destName);
                                fs.copyFileSync(thumbSourcePath, destPath);
                            } else {
                                console.error(`No thumb for ${item.filename}`);
                                markError.run('Thumbnail not found', item.id);
                                continue;
                            }
                        } else {
                            // For videos — check duration then create symlink
                            const duration = getVideoDuration(item.source_path);
                            if (duration !== null && duration < MEDIA_CONFIG.minVideoDuration) {
                                markError.run(`Video too short (${duration.toFixed(2)}s)`, item.id);
                                continue;
                            }
                            const destName = `${uuidv4()}${ext}`;
                            destPath = path.join(MEDIA_CONFIG.videoDir, destName);
                            fs.symlinkSync(item.source_path, destPath);
                        }
                        markDone.run(item.id);
                    } catch (e) {
                        console.error(`Skip ${item.filename}: ${e.message.substring(0, 60)}`);
                        markError.run(e.message.substring(0, 200), item.id);
                        continue;
                    }
                    
                    insertMedia.run(postId, item.media_type, destPath, null, i);
                }
                
                successCount++;
                createdPosts.push({ id: postId, description, fileCount: group.length });
            } catch (e) {
                errorCount++;
                console.error(`Post error: ${e.message.substring(0, 100)}`);
                for (const item of group) markError.run(e.message.substring(0, 200), item.id);
            }
        }
        
        
        res.json({
            success: true,
            postsCreated: successCount,
            errors: errorCount,
            createdPosts
        });
    } catch (error) {
        console.error('Error importing media:', error);
        res.status(500).json({ error: 'Failed to import media: ' + error.message });
    }
});

// GET /api/admin/media/queue - Get queue status
router.get('/media/queue', requireAdmin, (req, res) => {
    try {
        const db = getDB();
        
        const total = db.prepare('SELECT COUNT(*) as count FROM import_queue').get();
        if (!total.count) {
            return res.json({
                hasQueue: false,
                total: 0,
                pending: 0,
                done: 0,
                errors: 0,
                folders: []
            });
        }
        
        const pending = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'pending'").get();
        const done = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'done'").get();
        const errors = db.prepare("SELECT COUNT(*) as count FROM import_queue WHERE status = 'error'").get();
        
        const folders = db.prepare(`
            SELECT folder_path, 
                   COUNT(*) as total,
                   SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                   SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
                   SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
            FROM import_queue
            GROUP BY folder_path
            ORDER BY folder_path
        `).all();
        
        
        res.json({
            hasQueue: true,
            total: total.count,
            pending: pending.count,
            done: done.count,
            errors: errors.count,
            folders
        });
    } catch (error) {
        console.error('Error getting queue status:', error);
        res.status(500).json({ error: 'Failed to get queue status' });
    }
});

// DELETE /api/admin/posts/:id - Admin can delete any post
router.delete('/posts/:id', requireAdmin, (req, res) => {
    try {
        const db = getDB();
        const postId = parseInt(req.params.id);
        if (isNaN(postId)) {
            return res.status(400).json({ error: 'Invalid post ID' });
        }

        // Check if post exists
        const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(postId);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        // Get all media files for this post
        const mediaFiles = db.prepare('SELECT media_path, thumbnail_path FROM post_media WHERE post_id = ?').all(postId);

        // Validate paths are within expected directories
        const allowedPrefixes = [
            path.join(__dirname, '../uploads'),
            path.join(__dirname, '../uploads/thumbnails')
        ];

        mediaFiles.forEach(m => {
            // Delete main media file
            if (m.media_path) {
                const resolvedPath = path.resolve(m.media_path);
                const isAllowed = allowedPrefixes.some(prefix => resolvedPath.startsWith(prefix));
                if (!isAllowed) {
                    console.error(`⚠️ Blocked suspicious file deletion: ${m.media_path}`);
                    return;
                }
                try {
                    const stat = fs.lstatSync(resolvedPath);
                    fs.unlinkSync(resolvedPath);
                } catch (e) {
                    if (e.code !== 'ENOENT') {
                        console.error(`Failed to delete media ${m.media_path}:`, e.message);
                    }
                }
            }
            // Delete thumbnail if exists
            if (m.thumbnail_path) {
                const resolvedPath = path.resolve(m.thumbnail_path);
                const isAllowed = allowedPrefixes.some(prefix => resolvedPath.startsWith(prefix));
                if (!isAllowed) {
                    console.error(`⚠️ Blocked suspicious thumbnail deletion: ${m.thumbnail_path}`);
                    return;
                }
                try {
                    fs.unlinkSync(resolvedPath);
                } catch (e) {
                    if (e.code !== 'ENOENT') {
                        console.error(`Failed to delete thumbnail ${m.thumbnail_path}:`, e.message);
                    }
                }
            }
        });

        // Delete post (cascade will delete post_media, comments, likes, post_tags)
        db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
        
        console.log(`Admin deleted post ${postId} (originally by user ${post.user_id})`);
        res.json({ success: true });
    } catch (error) {
        console.error('Admin delete error:', error);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

// DELETE /api/admin/media/:mediaId - Admin can delete any media from a post
router.delete('/media/:mediaId', requireAdmin, (req, res) => {
    try {
        const db = getDB();
        const mediaId = parseInt(req.params.mediaId);
        if (isNaN(mediaId)) {
            return res.status(400).json({ error: 'Invalid media ID' });
        }

        // Get media record
        const media = db.prepare(`
            SELECT pm.id, pm.post_id, pm.media_type, pm.media_path, pm.thumbnail_path, p.user_id as post_user_id
            FROM post_media pm
            JOIN posts p ON pm.post_id = p.id
            WHERE pm.id = ?
        `).get(mediaId);

        if (!media) {
            return res.status(404).json({ error: 'Media not found' });
        }

        // Delete media files
        const allowedPrefixes = [
            path.join(__dirname, '../uploads'),
            path.join(__dirname, '../uploads/thumbnails')
        ];

        // Delete main media file
        if (media.media_path) {
            const resolvedPath = path.resolve(media.media_path);
            const isAllowed = allowedPrefixes.some(prefix => resolvedPath.startsWith(prefix));
            if (!isAllowed) {
                console.error(`⚠️ Blocked suspicious file deletion: ${media.media_path}`);
                return res.status(403).json({ error: 'File path not allowed' });
            }
            try {
                fs.unlinkSync(resolvedPath);
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    console.error(`Failed to delete media ${media.media_path}:`, e.message);
                }
            }
        }

        // Delete thumbnail if exists
        if (media.thumbnail_path) {
            const resolvedPath = path.resolve(media.thumbnail_path);
            const isAllowed = allowedPrefixes.some(prefix => resolvedPath.startsWith(prefix));
            if (!isAllowed) {
                console.error(`⚠️ Blocked suspicious thumbnail deletion: ${media.thumbnail_path}`);
            } else {
                try {
                    fs.unlinkSync(resolvedPath);
                } catch (e) {
                    if (e.code !== 'ENOENT') {
                        console.error(`Failed to delete thumbnail ${media.thumbnail_path}:`, e.message);
                    }
                }
            }
        }

        // Delete media record from database
        db.prepare('DELETE FROM post_media WHERE id = ?').run(mediaId);

        console.log(`Admin deleted media ${mediaId} from post ${media.post_id}`);
        res.json({ success: true, mediaId });
    } catch (error) {
        console.error('Admin delete media error:', error);
        res.status(500).json({ error: 'Failed to delete media' });
    }
});

// DELETE /api/admin/media/queue - Clear queue (optional, with confirmation)
router.delete('/media/queue', requireAdmin, (req, res) => {
    try {
        const { confirm } = req.body;
        
        if (confirm !== 'YES_DELETE_ALL') {
            return res.status(400).json({ 
                error: 'Confirmation required. Send { confirm: "YES_DELETE_ALL" }' 
            });
        }
        
        const db = getDB();
        db.exec('DROP TABLE IF EXISTS import_queue');
        
        res.json({ success: true, message: 'Queue cleared' });
    } catch (error) {
        console.error('Error clearing queue:', error);
        res.status(500).json({ error: 'Failed to clear queue' });
    }
});

export default router;
