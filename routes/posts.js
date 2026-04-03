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
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
        cb(null, allowedTypes.includes(file.mimetype));
    }
});

router.get('/feed', (req, res) => {
    try {
        const posts = db.prepare(`
            SELECT p.id, p.user_id, p.description, p.allow_comments, p.created_at, p.updated_at,
                   u.username, u.avatar, u.fullname,
                   COUNT(DISTINCT l.id) as likes_count,
                   COUNT(DISTINCT c.id) as comments_count,
                   EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN likes l ON p.id = l.post_id
            LEFT JOIN comments c ON p.id = c.post_id
            WHERE u.active = 1
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT 20
        `).all(req.userId);

        const baseUrl = `//${req.hostname}`;

        // Загружаем медиа для каждого поста
        const getMedia = db.prepare(`
            SELECT id, media_type, media_path, thumbnail_path, sort_order
            FROM post_media
            WHERE post_id = ?
            ORDER BY sort_order ASC
        `);

        const postsWithMedia = posts.map(post => {
            const mediaItems = getMedia.all(post.id).map(m => ({
                ...m,
                media_url: `${baseUrl}/uploads/${m.media_type === 'video' ? 'videos' : 'images'}/${path.basename(m.media_path)}`,
                thumbnail_url: m.thumbnail_path ? `${baseUrl}/uploads/thumbnails/${path.basename(m.thumbnail_path)}` : null
            }));

            return {
                ...post,
                media: mediaItems,
                media_type: mediaItems[0]?.media_type || 'image',
                description: sanitizeInput(post.description)
            };
        });

        res.json({ posts: postsWithMedia });
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

        // Обрабатываем каждый файл
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
            let thumbnailPath = null;

            if (mediaType === 'image') {
                const thumbFilename = `thumb_${path.basename(file.filename)}`;
                thumbnailPath = path.join(__dirname, '../uploads/thumbnails', thumbFilename);
                try {
                    await sharp(file.path)
                        .resize(600, 600, { fit: 'inside' })
                        .jpeg({ quality: 80 })
                        .toFile(thumbnailPath);
                } catch (e) {
                    console.error('Thumbnail generation error:', e);
                }
            }

            insertMedia.run(
                postId,
                mediaType,
                file.path,
                thumbnailPath,
                i
            );
        }

        res.status(201).json({ success: true, postId, mediaCount: req.files.length });
    } catch (error) {
        console.error('Post creation error:', error);
        res.status(500).json({ error: 'Failed to create post' });
    }
});

router.delete('/:id', checkPostOwner, (req, res) => {
    try {
        // Удаляем все медиафайлы поста
        const mediaFiles = db.prepare('SELECT media_path, thumbnail_path FROM post_media WHERE post_id = ?').all(req.params.id);
        
        mediaFiles.forEach(m => {
            if (m.media_path && fs.existsSync(m.media_path)) {
                fs.unlinkSync(m.media_path);
            }
            if (m.thumbnail_path && fs.existsSync(m.thumbnail_path)) {
                fs.unlinkSync(m.thumbnail_path);
            }
        });
        
        // Удаляем пост (cascade удалит post_media)
        db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

export default router;
