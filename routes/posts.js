import express from 'express';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDB } from '../models/database.js';
import { validatePost } from '../middleware/validation.js';
import { checkPostOwner } from '../middleware/auth.js';
import { sanitizeInput } from '../middleware/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure sharp with memory limits to prevent VM hangs
sharp.cache({ memory: 100, files: 0 }); // Limit cache to 100MB, disable file cache

const router = express.Router();
const db = getDB();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const isVideo = file.mimetype.startsWith('video/');
        const uploadDir = path.join(__dirname, '../uploads', isVideo ? 'videos' : 'images');
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760,
        files: 10  // Max 10 files per post
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
        cb(null, allowedTypes.includes(file.mimetype));
    }
});

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
            INSERT INTO posts (user_id, description, allow_comments, created_at)
            VALUES (?, ?, ?, ?)
        `);

        const insertMedia = db.prepare(`
            INSERT INTO post_media (post_id, media_type, media_path, thumbnail_path, sort_order)
            VALUES (?, ?, ?, ?, ?)
        `);

        // Определяем дату создания из body или используем текущую
        const createdAt = req.body.created_at || new Date().toISOString();
        
        const result = insertPost.run(
            req.userId,
            sanitizeInput(req.body.description),
            1,
            createdAt
        );

        const postId = result.lastInsertRowid;

        // Process files with concurrency limit to prevent event loop blocking
        const CONCURRENCY_LIMIT = 3;
        const processedMedia = [];

        for (let i = 0; i < req.files.length; i += CONCURRENCY_LIMIT) {
            const batch = req.files.slice(i, i + CONCURRENCY_LIMIT);
            const promises = batch.map(async (file) => {
                const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
                let thumbnailPath = null;

                if (mediaType === 'image') {
                    const thumbFilename = `thumb_${path.basename(file.filename)}`;
                    thumbnailPath = path.join(__dirname, '../uploads/thumbnails', thumbFilename);
                    try {
                        // Add timeout to sharp operations (30 seconds)
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('Thumbnail generation timeout')), 30000);
                        });

                        await Promise.race([
                            sharp(file.path)
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

                return { file, mediaType, thumbnailPath };
            });

            const results = await Promise.all(promises);
            processedMedia.push(...results);
        }

        // Insert all media records (using the insertMedia prepared statement from above)
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
                    console.log(`✅ Tags added to post ${postId}:`, tags);
                }
            } catch (e) {
                console.error('Tag parsing error:', e.message, 'raw:', req.body.tags);
            }
        }

        res.status(201).json({ success: true, postId, mediaCount: req.files.length });
    } catch (error) {
        console.error('Post creation error:', error);
        res.status(500).json({ error: 'Failed to create post' });
    }
});

router.delete('/:id', checkPostOwner, (req, res) => {
    try {
        // Get all media files for this post
        const mediaFiles = db.prepare('SELECT media_path, thumbnail_path FROM post_media WHERE post_id = ?').all(req.params.id);

        mediaFiles.forEach(m => {
            // Delete main media file (handles both regular files and symlinks)
            if (m.media_path) {
                try {
                    // lstat to check if it's a symlink before trying to delete
                    const stat = fs.lstatSync(m.media_path);
                    // unlink works for both symlinks and regular files
                    fs.unlinkSync(m.media_path);
                } catch (e) {
                    if (e.code !== 'ENOENT') {
                        console.error(`Failed to delete media ${m.media_path}:`, e.message);
                    }
                }
            }
            // Delete thumbnail if exists
            if (m.thumbnail_path) {
                try {
                    fs.unlinkSync(m.thumbnail_path);
                } catch (e) {
                    if (e.code !== 'ENOENT') {
                        console.error(`Failed to delete thumbnail ${m.thumbnail_path}:`, e.message);
                    }
                }
            }
        });

        // Delete post (cascade will delete post_media records)
        db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

export default router;
