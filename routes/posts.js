import express from 'express';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fileTypeFromBuffer } from 'file-type';
import { getDB } from '../models/database.js';
import { validatePost } from '../middleware/validation.js';
import { checkPostOwner } from '../middleware/auth.js';
import { sanitizeInput, logSecurityEvent } from '../middleware/security.js';

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

const upload = multer({
    storage: memoryStorage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760,
        files: 10  // Max 10 files per post
    },
    fileFilter: (req, file, cb) => {
        // Basic MIME type check from header (verified later by magic bytes)
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
        if (!allowedTypes.includes(file.mimetype)) {
            logSecurityEvent(req, 'upload_rejected_mime', { filename: file.originalname, type: file.mimetype });
            return cb(new Error('Invalid file type'), false);
        }

        // Verify extension matches claimed MIME type
        const ext = path.extname(file.originalname).toLowerCase();
        const validExtensions = {
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/webp': ['.webp'],
            'image/gif': ['.gif'],
            'video/mp4': ['.mp4'],
            'video/webm': ['.webm']
        };

        if (!validExtensions[file.mimetype]?.includes(ext)) {
            logSecurityEvent(req, 'upload_rejected_ext_mismatch', {
                filename: file.originalname,
                mime: file.mimetype,
                ext
            });
            return cb(new Error('File extension does not match MIME type'), false);
        }

        cb(null, true);
    }
});

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
        'video/webm': { ext: '.webm', dir: 'videos' }
    };

    const config = allowedMimes[fileType.mime];
    if (!config) {
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

    return {
        path: filePath,
        mediaType: config.dir === 'videos' ? 'video' : 'image',
        filename: filename
    };
}

router.get('/feed', (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        let query, params;

        if (filter === 'subscribed') {
            // Posts from subscribed users first, then others
            query = `
                SELECT p.id, p.user_id, p.description, p.allow_comments, p.created_at, p.updated_at,
                       u.username, u.avatar, u.fullname,
                       (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
                       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
                       EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked,
                       EXISTS(SELECT 1 FROM subscriptions WHERE follower_id = ? AND following_user_id = p.user_id) as is_subscribed
                FROM posts p
                JOIN users u ON p.user_id = u.id
                WHERE u.active = 1
                  AND EXISTS(
                      SELECT 1 FROM subscriptions s 
                      WHERE s.follower_id = ? AND s.following_user_id = p.user_id
                  )
                ORDER BY p.created_at DESC
                LIMIT 50
            `;
            params = [req.userId, req.userId, req.userId];
        } else if (filter.startsWith('tag:')) {
            const tagName = filter.substring(4);
            query = `
                SELECT p.id, p.user_id, p.description, p.allow_comments, p.created_at, p.updated_at,
                       u.username, u.avatar, u.fullname,
                       (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
                       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
                       EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked,
                       EXISTS(SELECT 1 FROM subscriptions WHERE follower_id = ? AND following_user_id = p.user_id) as is_subscribed
                FROM posts p
                JOIN users u ON p.user_id = u.id
                JOIN post_tags pt ON p.id = pt.post_id
                JOIN tags t ON pt.tag_id = t.id
                WHERE u.active = 1 AND t.name = ?
                ORDER BY p.created_at DESC
                LIMIT 50
            `;
            params = [req.userId, req.userId, tagName];
        } else {
            // All posts
            query = `
                SELECT p.id, p.user_id, p.description, p.allow_comments, p.created_at, p.updated_at,
                       u.username, u.avatar, u.fullname,
                       (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
                       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
                       EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked,
                       EXISTS(SELECT 1 FROM subscriptions WHERE follower_id = ? AND following_user_id = p.user_id) as is_subscribed
                FROM posts p
                JOIN users u ON p.user_id = u.id
                WHERE u.active = 1
                ORDER BY p.created_at DESC
                LIMIT 50
            `;
            params = [req.userId, req.userId];
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

router.post('/', upload.array('media', 20), validatePost, async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Media required' });
        }

        const insertPost = db.prepare(`
            INSERT INTO posts (user_id, description, allow_comments)
            VALUES (?, ?, ?)
        `);

        const insertMedia = db.prepare(`
            INSERT INTO post_media (post_id, media_type, media_path, thumbnail_path, sort_order)
            VALUES (?, ?, ?, ?, ?)
        `);

        // NEVER accept created_at from user — always server-side
        const result = insertPost.run(
            req.userId,
            sanitizeInput(req.body.description),
            1
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

export default router;
