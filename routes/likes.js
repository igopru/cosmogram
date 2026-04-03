import express from 'express';
import { getDB } from '../models/database.js';

const router = express.Router();
const db = getDB();

router.post('/toggle/:postId', (req, res) => {
    try {
        const postId = req.params.postId;
        
        const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        
        const existingLike = db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(postId, req.userId);
        
        let liked = false;
        if (existingLike) {
            db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(postId, req.userId);
            liked = false;
        } else {
            db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(postId, req.userId);
            liked = true;
        }
        
        const likesCount = db.prepare('SELECT COUNT(*) as count FROM likes WHERE post_id = ?').get(postId);
        
        res.json({ success: true, liked, count: likesCount.count });
    } catch (error) {
        console.error('Toggle like error:', error);
        res.status(500).json({ error: 'Failed to toggle like' });
    }
});

router.get('/post/:postId', (req, res) => {
    try {
        const likes = db.prepare(`
            SELECT u.id, u.username, u.avatar, l.created_at
            FROM likes l
            JOIN users u ON l.user_id = u.id
            WHERE l.post_id = ?
            ORDER BY l.created_at DESC
        `).all(req.params.postId);
        
        res.json({ likes });
    } catch (error) {
        console.error('Get likes error:', error);
        res.status(500).json({ error: 'Failed to get likes' });
    }
});

export default router;
