import express from 'express';
import { getDB } from '../models/database.js';
import { sanitizeInput } from '../middleware/security.js';
import { validateComment, validateId } from '../middleware/validation.js';

const router = express.Router();
const db = getDB();

// Batch comments — authenticated
router.post('/batch', (req, res) => {
    try {
        const { postIds } = req.body;
        if (!Array.isArray(postIds) || postIds.length === 0) {
            return res.status(400).json({ error: 'postIds array is required' });
        }

        // Limit to prevent abuse
        if (postIds.length > 50) {
            return res.status(400).json({ error: 'Maximum 50 post IDs per request' });
        }

        // Validate all postIds are integers
        const validIds = postIds.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0);
        if (validIds.length === 0) {
            return res.status(400).json({ error: 'No valid post IDs provided' });
        }

        const placeholders = validIds.map(() => '?').join(',');
        const comments = db.prepare(`
            SELECT c.post_id, c.id, c.user_id, c.text, c.created_at, u.username, u.avatar
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.post_id IN (${placeholders})
            ORDER BY c.post_id, c.created_at DESC
        `).all(...validIds);

        // Group comments by post_id
        const commentsByPost = {};
        comments.forEach(c => {
            if (!commentsByPost[c.post_id]) {
                commentsByPost[c.post_id] = [];
            }
            commentsByPost[c.post_id].push({
                id: c.id,
                post_id: c.post_id,
                user_id: c.user_id,
                text: sanitizeInput(c.text),
                username: c.username,
                avatar: c.avatar,
                created_at: c.created_at
            });
        });

        res.json({ comments: commentsByPost });
    } catch (error) {
        console.error('Batch comments error:', error);
        res.status(500).json({ error: 'Failed to load comments' });
    }
});

router.get('/post/:postId', (req, res) => {
    try {
        const comments = db.prepare(`
            SELECT c.*, u.username, u.avatar
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.post_id = ?
            ORDER BY c.created_at DESC
            LIMIT 20
        `).all(req.params.postId);

        res.json({ comments: comments.map(c => ({ ...c, text: sanitizeInput(c.text) })) });
    } catch (error) {
        console.error('Get comments error:', error);
        res.status(500).json({ error: 'Failed to load comments' });
    }
});

router.post('/', validateComment, (req, res) => {
    try {
        const { postId, text } = req.body;
        
        const post = db.prepare('SELECT allow_comments FROM posts WHERE id = ?').get(postId);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (!post.allow_comments) return res.status(403).json({ error: 'Comments disabled' });
        
        const result = db.prepare(`
            INSERT INTO comments (post_id, user_id, text) VALUES (?, ?, ?)
        `).run(postId, req.userId, sanitizeInput(text));
        
        const user = db.prepare('SELECT username, avatar FROM users WHERE id = ?').get(req.userId);
        
        res.status(201).json({
            success: true,
            comment: {
                id: result.lastInsertRowid,
                post_id: postId,
                user_id: req.userId,
                text: sanitizeInput(text),
                username: user.username,
                avatar: user.avatar,
                created_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Add comment error:', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

router.delete('/:id', validateId, (req, res) => {
    try {
        const comment = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(req.params.id);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        if (comment.user_id !== req.userId) return res.status(403).json({ error: 'Not your comment' });
        
        db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete comment error:', error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

export default router;
