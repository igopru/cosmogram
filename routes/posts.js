import express from 'express';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fileTypeFromBuffer } from 'file-type';
import { execSync } from 'child_process';
import { getDB } from '../models/database.js';
import { validatePost, validateNumericParam } from '../middleware/validation.js';
import { checkPostOwner, validateSession } from '../middleware/auth.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { sanitizeInput, logSecurityEvent } from '../middleware/security.js';

const MIN_VIDEO_DURATION = parseFloat(process.env.MIN_VIDEO_DURATION) || 1.0; // seconds

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure sharp with memory limits to prevent VM hangs
sharp.cache({ memory: 100, files: 0 }); // Limit cache to 100MB, disable file cache

const router = express.Router();
const db = getDB();

// Create upload directories
const uploadDirs = ['uploads/images', 'uploads/thumbnails', 'uploads/videos'];
uploadDirs.forEach(dir => {
    const fullPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
});

// Use memory storage — files buffered in memory for magic byte validation BEFORE disk write
const memoryStorage = multer.memoryStorage();

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10485760;
const MAX_VIDEO_SIZE = parseInt(process.env.MAX_VIDEO_SIZE) || 52428800; // 50MB for videos

const upload = multer({
    storage: memoryStorage,
    limits: {
        fileSize: MAX_VIDEO_SIZE,  // Use larger limit (videos are compressed client-side)
        files: 20
    },
    fileFilter: (req, file, cb) => {
        // Coarse pre-filter — strict validation is done by magic bytes in validateAndSaveFile
        // Some mobile WebViews send empty MIME type — accept through, magic bytes will catch bad files
        const mime = file.mimetype.toLowerCase();
        const knownImageVideo = /^(image|video)\//;
        if (mime && !knownImageVideo.test(mime) && mime !== 'application/octet-stream') {
            logSecurityEvent(req, 'upload_rejected_mime', { filename: file.originalname, type: file.mimetype });
            return cb(new Error('Invalid file type'), false);
        }

        // Extension check for known MIME types (skip when unknown — magic bytes will validate)
        if (knownImageVideo.test(mime)) {
            const ext = path.extname(file.originalname).toLowerCase();
            const validExtensions = {
                'image/jpeg': ['.jpg', '.jpeg'],
                'image/png': ['.png'],
                'image/webp': ['.webp'],
                'image/gif': ['.gif'],
                'video/mp4': ['.mp4'],
                'video/webm': ['.webm']
            };
            if (validExtensions[mime] && !validExtensions[mime].includes(ext)) {
                logSecurityEvent(req, 'upload_rejected_ext_mismatch', {
                    filename: file.originalname,
                    mime: file.mimetype,
                    ext
                });
                return cb(new Error('File extension does not match MIME type'), false);
            }
        }

        cb(null, true);
    }
});

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

// Magic byte validation + save to disk
// This function runs AFTER multer buffers the file but BEFORE it's written to disk
async function validateAndSaveFile(buffer, originalName, claimedMime) {
    const fileType = await fileTypeFromBuffer(buffer);

    if (!fileType) {
        throw { status: 400, message: 'Unable to determine file type — file may be corrupted or malicious' };
    }

    // Whitelist of allowed MIME types (by magic bytes, not headers)
    const allowedMimes = {
        'image/jpeg': { ext: '.jpg', dir: 'images' },
        'image/png': { ext: '.png', dir: 'images' },
        'image/webp': { ext: '.webp', dir: 'images' },
        'image/gif': { ext: '.gif', dir: 'images' },
        'video/mp4': { ext: '.mp4', dir: 'videos' },
        'video/webm': { ext: '.webm', dir: 'videos' },
        'video/3gpp': { ext: '.mp4', dir: 'videos' },
        'video/3gpp2': { ext: '.mp4', dir: 'videos' },
        'video/quicktime': { ext: '.mp4', dir: 'videos' }
    };

    const config = allowedMimes[fileType.mime];
    if (!config) {
        console.error('validateAndSaveFile: unknown mime', { detected: fileType.mime, ext: fileType.ext, claimed: claimedMime });
        throw { status: 400, message: `File type '${fileType.mime}' is not allowed (claimed: ${claimedMime})` };
    }

    // Verify magic byte category matches claimed category (prevent伪装 attacks)
    const claimedCategory = claimedMime.split('/')[0];
    const detectedCategory = fileType.mime.split('/')[0];
    if (claimedCategory !== detectedCategory) {
        throw { status: 400, message: `File content '${fileType.mime}' does not match claimed '${claimedMime}'` };
    }

    // Generate UUID filename with CORRECT extension (from magic bytes, not user input)
    const uuid = uuidv4();
    const filename = `${uuid}${config.ext}`;
    const uploadDir = path.join(__dirname, '..', 'uploads', config.dir);
    const filePath = path.join(uploadDir, filename);

    // Write to disk
    await fs.promises.writeFile(filePath, buffer);

    // Validate video minimum duration
    if (config.dir === 'videos') {
        const duration = getVideoDuration(filePath);
        if (duration !== null && duration < MIN_VIDEO_DURATION) {
            await fs.promises.unlink(filePath).catch(() => {});
            throw {
                status: 400,
                message: `Video is too short (${duration.toFixed(2)}s). Minimum duration is ${MIN_VIDEO_DURATION}s.`
            };
        }
    }

    return {
        path: filePath,
        mediaType: config.dir === 'videos' ? 'video' : 'image',
        filename: filename
    };
}

router.get('/feed', (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        const userId = req.userId;
        const isAuth = userId !== null && userId !== undefined;

        // For unauthenticated users, only show public posts
        // For authenticated users, show all posts
        const publicFilter = isAuth ? '1=1' : 'p.is_public = 1';

        let query, params;

        if (filter === 'subscribed') {
            if (!isAuth) {
                return res.json({ posts: [], filter });
            }
            query = `
                SELECT p.id, p.user_id, p.description, p.allow_comments, p.created_at, p.updated_at, p.is_public,
                       u.username, u.avatar, u.fullname,
                       (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
                       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
                       EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked,
                       EXISTS(SELECT 1 FROM subscriptions WHERE follower_id = ? AND following_user_id = p.user_id) as is_subscribed
                FROM posts p
                JOIN users u ON p.user_id = u.id
                WHERE u.active = 1
                  AND ${publicFilter}
                  AND EXISTS(
                      SELECT 1 FROM subscriptions s 
                      WHERE s.follower_id = ? AND s.following_user_id = p.user_id
                  )
                ORDER BY p.created_at DESC
                LIMIT 50
            `;
            params = [userId, userId, userId];
        } else if (filter.startsWith('tag:')) {
            const tagName = filter.substring(4);
            query = `
                SELECT p.id, p.user_id, p.description, p.allow_comments, p.created_at, p.updated_at, p.is_public,
                       u.username, u.avatar, u.fullname,
                       (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
                       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
                       ${isAuth ? "EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?)" : "0"} as user_liked,
                       ${isAuth ? "EXISTS(SELECT 1 FROM subscriptions WHERE follower_id = ? AND following_user_id = p.user_id)" : "0"} as is_subscribed
                FROM posts p
                JOIN users u ON p.user_id = u.id
                JOIN post_tags pt ON p.id = pt.post_id
                JOIN tags t ON pt.tag_id = t.id
                WHERE u.active = 1 AND t.name = ?
                  AND ${publicFilter}
                ORDER BY p.created_at DESC
                LIMIT 50
            `;
            params = isAuth ? [userId, userId, tagName] : [tagName];
        } else {
            query = `
                SELECT p.id, p.user_id, p.description, p.allow_comments, p.created_at, p.updated_at, p.is_public,
                       u.username, u.avatar, u.fullname,
                       (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
                       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
                       ${isAuth ? "EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?)" : "0"} as user_liked,
                       ${isAuth ? "EXISTS(SELECT 1 FROM subscriptions WHERE follower_id = ? AND following_user_id = p.user_id)" : "0"} as is_subscribed
                FROM posts p
                JOIN users u ON p.user_id = u.id
                WHERE u.active = 1
                  AND ${publicFilter}
                ORDER BY p.created_at DESC
                LIMIT 50
            `;
            params = isAuth ? [userId, userId] : [];
        }

        const posts = db.prepare(query).all(...params);

        const baseUrl = `//${req.hostname}`;

        // Get media for all posts
        const getMedia = db.prepare(`
            SELECT id, media_type, media_path, thumbnail_path, sort_order
            FROM post_media
            WHERE post_id = ?
            ORDER BY sort_order ASC
        `);

        // Get tags for all posts
        const getTags = db.prepare(`
            SELECT t.id, t.name
            FROM tags t
            JOIN post_tags pt ON t.id = pt.tag_id
            WHERE pt.post_id = ?
        `);

        // Get comments for all posts in one query
        const postIds = posts.map(p => p.id);
        let allComments = [];
        if (postIds.length > 0) {
            const placeholders = postIds.map(() => '?').join(',');
            allComments = db.prepare(`
                SELECT c.post_id, c.id, c.user_id, c.text, c.created_at, u.username, u.avatar
                FROM comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.post_id IN (${placeholders})
                ORDER BY c.post_id, c.created_at DESC
                LIMIT 100
            `).all(...postIds);
        }

        const commentsByPost = {};
        allComments.forEach(c => {
            if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = [];
            commentsByPost[c.post_id].push({
                id: c.id, post_id: c.post_id, user_id: c.user_id,
                text: sanitizeInput(c.text), username: c.username, avatar: c.avatar, created_at: c.created_at
            });
        });

        const postsWithMedia = posts.map(post => {
            const mediaItems = getMedia.all(post.id).map(m => ({
                ...m,
                media_url: `${baseUrl}/uploads/${m.media_type === 'video' ? 'videos' : 'images'}/${path.basename(m.media_path)}`,
                thumbnail_url: m.thumbnail_path ? `${baseUrl}/uploads/thumbnails/${path.basename(m.thumbnail_path)}` : null
            }));

            const tags = getTags.all(post.id);

            return {
                ...post,
                media: mediaItems,
                media_type: mediaItems[0]?.media_type || 'image',
                description: sanitizeInput(post.description),
                comments: commentsByPost[post.id] || [],
                tags
            };
        });

        res.json({ posts: postsWithMedia, filter });
    } catch (error) {
        console.error('Feed error:', error);
        res.status(500).json({ error: 'Failed to load feed' });
    }
});

// GET single post by ID — для шаринга ссылок
router.get('/:id', optionalAuth, validateNumericParam('id'), (req, res) => {
    try {
        const userId = req.userId;
        const isAuth = userId !== null && userId !== undefined;

        const post = db.prepare(`
            SELECT p.id, p.user_id, p.description, p.allow_comments, p.created_at, p.updated_at, p.is_public,
                   u.username, u.avatar, u.fullname,
                   (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
                   (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
                   ${isAuth ? "EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?)" : "0"} as user_liked,
                   ${isAuth ? "EXISTS(SELECT 1 FROM subscriptions WHERE follower_id = ? AND following_user_id = p.user_id)" : "0"} as is_subscribed
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.id = ? AND u.active = 1
        `).get(...(isAuth ? [userId, userId, req.params.id] : [req.params.id]));

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (!isAuth && !post.is_public) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const baseUrl = `//${req.hostname}`;

        const mediaItems = db.prepare(`
            SELECT id, media_type, media_path, thumbnail_path, sort_order
            FROM post_media
            WHERE post_id = ?
            ORDER BY sort_order ASC
        `).all(post.id).map(m => ({
            ...m,
            media_url: `${baseUrl}/uploads/${m.media_type === 'video' ? 'videos' : 'images'}/${path.basename(m.media_path)}`,
            thumbnail_url: m.thumbnail_path ? `${baseUrl}/uploads/thumbnails/${path.basename(m.thumbnail_path)}` : null
        }));

        const tags = db.prepare(`
            SELECT t.id, t.name
            FROM tags t
            JOIN post_tags pt ON t.id = pt.tag_id
            WHERE pt.post_id = ?
        `).all(post.id);

        const comments = db.prepare(`
            SELECT c.id, c.user_id, c.text, c.created_at, u.username, u.avatar
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.post_id = ?
            ORDER BY c.created_at DESC
            LIMIT 100
        `).all(post.id).map(c => ({
            ...c,
            text: sanitizeInput(c.text)
        }));

        res.json({
            ...post,
            description: sanitizeInput(post.description),
            media: mediaItems,
            media_type: mediaItems[0]?.media_type || null,
            tags,
            comments
        });
    } catch (error) {
        console.error('Single post error:', error);
        res.status(500).json({ error: 'Failed to load post' });
    }
});

router.post('/', validateSession, upload.array('media', 20), validatePost, async (req, res) => {
    try {
        const isPublic = req.body.is_public !== undefined ? (req.body.is_public === true || req.body.is_public === 'true' ? 1 : 0) : 1;

        const insertPost = db.prepare(`
            INSERT INTO posts (user_id, description, allow_comments, is_public)
            VALUES (?, ?, ?, ?)
        `);

        const insertMedia = db.prepare(`
            INSERT INTO post_media (post_id, media_type, media_path, thumbnail_path, sort_order)
            VALUES (?, ?, ?, ?, ?)
        `);

        // NEVER accept created_at from user — always server-side
        const result = insertPost.run(
            req.userId,
            sanitizeInput(req.body.description),
            1,
            isPublic
        );

        const postId = result.lastInsertRowid;

        // Validate magic bytes + save files to disk + generate thumbnails
        const CONCURRENCY_LIMIT = 3;
        const processedMedia = [];

        for (let i = 0; i < req.files.length; i += CONCURRENCY_LIMIT) {
            const batch = req.files.slice(i, i + CONCURRENCY_LIMIT);
            const promises = batch.map(async (file) => {
                // Validate magic bytes BEFORE writing to disk
                const savedFile = await validateAndSaveFile(file.buffer, file.originalname, file.mimetype);

                let thumbnailPath = null;

                if (savedFile.mediaType === 'image') {
                    const thumbFilename = `thumb_${savedFile.filename}`;
                    thumbnailPath = path.join(__dirname, '..', 'uploads', 'thumbnails', thumbFilename);
                    try {
                        // Add timeout to sharp operations (30 seconds)
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('Thumbnail generation timeout')), 30000);
                        });

                        await Promise.race([
                            sharp(file.buffer)  // Use buffer directly (already in memory)
                                .resize(600, 600, { fit: 'inside' })
                                .jpeg({ quality: 80 })
                                .toFile(thumbnailPath),
                            timeoutPromise
                        ]);
                    } catch (e) {
                        console.error('Thumbnail generation error:', e.message);
                        thumbnailPath = null;
                    }
                }

                return { file: savedFile, mediaType: savedFile.mediaType, thumbnailPath };
            });

            const results = await Promise.all(promises);
            processedMedia.push(...results);
        }

        // Insert all media records
        for (let i = 0; i < processedMedia.length; i++) {
            const { file, mediaType, thumbnailPath } = processedMedia[i];
            insertMedia.run(postId, mediaType, file.path, thumbnailPath, i);
        }

        // Add tags if provided
        if (req.body.tags) {
            try {
                const tags = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
                if (Array.isArray(tags) && tags.length > 0) {
                    const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
                    const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
                    const insertPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');

                    for (const tagName of tags) {
                        const cleanName = tagName.trim().toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '');
                        if (cleanName.length === 0) continue;

                        insertTag.run(cleanName);
                        const tag = getTag.get(cleanName);
                        if (tag) {
                            insertPostTag.run(postId, tag.id);
                        }
                    }
                }
            } catch (e) {
                console.error('Tag parsing error:', e.message, 'raw:', req.body.tags);
            }
        }

        res.status(201).json({ success: true, postId, mediaCount: req.files.length });
    } catch (error) {
        // If validation failed, return the specific error
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error('Post creation error:', error);
        res.status(500).json({ error: 'Failed to create post' });
    }
});

router.delete('/:id', checkPostOwner, (req, res) => {
    try {
        // Validate ID is integer
        const postId = parseInt(req.params.id);
        if (isNaN(postId)) {
            return res.status(400).json({ error: 'Invalid post ID' });
        }

        // Get all media files for this post
        const mediaFiles = db.prepare('SELECT media_path, thumbnail_path FROM post_media WHERE post_id = ?').all(postId);

        // Validate paths are within expected directories
        const allowedPrefixes = [
            path.join(__dirname, '../uploads'),
            path.join(__dirname, '../uploads/thumbnails')
        ];

        mediaFiles.forEach(m => {
            // Delete main media file (handles both regular files and symlinks)
            if (m.media_path) {
                const resolvedPath = path.resolve(m.media_path);
                const isAllowed = allowedPrefixes.some(prefix => resolvedPath.startsWith(prefix));
                if (!isAllowed) {
                    console.error(`⚠️ Blocked suspicious file deletion: ${m.media_path}`);
                    return; // Skip deletion if path is outside allowed directories
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

        // Delete post (cascade will delete post_media records)
        db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

// DELETE /api/posts/media/:mediaId - Delete media from own post
router.delete('/media/:mediaId', validateSession, (req, res) => {
    try {
        const db = getDB();
        const mediaId = parseInt(req.params.mediaId);
        if (isNaN(mediaId)) {
            return res.status(400).json({ error: 'Invalid media ID' });
        }

        // Get media record and verify ownership
        const media = db.prepare(`
            SELECT pm.id, pm.post_id, pm.media_type, pm.media_path, pm.thumbnail_path, p.user_id as post_user_id
            FROM post_media pm
            JOIN posts p ON pm.post_id = p.id
            WHERE pm.id = ?
        `).get(mediaId);

        if (!media) {
            return res.status(404).json({ error: 'Media not found' });
        }

        // Check ownership
        if (media.post_user_id !== req.userId) {
            return res.status(403).json({ error: 'Not your post' });
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

        res.json({ success: true, mediaId, postId: media.post_id });
    } catch (error) {
        console.error('Delete media error:', error);
        res.status(500).json({ error: 'Failed to delete media' });
    }
});

export default router;
