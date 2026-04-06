import express from 'express';
import { getDB } from '../models/database.js';
import { sanitizeInput } from '../middleware/security.js';

const router = express.Router();
const db = getDB();

// === TAGS ===

// Get all tags with post counts
router.get('/', (req, res) => {
    try {
        const tags = db.prepare(`
            SELECT t.id, t.name, COUNT(pt.post_id) as post_count,
                   EXISTS(SELECT 1 FROM subscriptions WHERE tag_id = t.id AND follower_id = ?) as user_subscribed
            FROM tags t
            LEFT JOIN post_tags pt ON t.id = pt.tag_id
            GROUP BY t.id
            ORDER BY post_count DESC, t.name ASC
        `).all(req.userId);

        res.json({ tags });
    } catch (error) {
        console.error('Get tags error:', error);
        res.status(500).json({ error: 'Failed to get tags' });
    }
});

// Create tag
router.post('/', (req, res) => {
    try {
        const { name } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Tag name is required' });
        }

        const tagName = name.trim().toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '');
        if (tagName.length === 0) {
            return res.status(400).json({ error: 'Invalid tag name' });
        }

        const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
        if (existing) {
            return res.status(200).json({ id: existing.id, name: tagName });
        }

        const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
        res.status(201).json({ id: result.lastInsertRowid, name: tagName });
    } catch (error) {
        console.error('Create tag error:', error);
        res.status(500).json({ error: 'Failed to create tag' });
    }
});

// Add tags to a post
router.post('/post/:postId', (req, res) => {
    try {
        const { tags } = req.body; // Array of tag names
        if (!Array.isArray(tags) || tags.length === 0) {
            return res.status(400).json({ error: 'Tags array is required' });
        }

        const postId = req.params.postId;
        const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.user_id !== req.userId) return res.status(403).json({ error: 'Not your post' });

        const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
        const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
        const insertPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');

        const addedTags = [];
        for (const tagName of tags) {
            const cleanName = tagName.trim().toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '');
            if (cleanName.length === 0) continue;

            insertTag.run(cleanName);
            const tag = getTag.get(cleanName);
            if (tag) {
                insertPostTag.run(postId, tag.id);
                addedTags.push({ id: tag.id, name: cleanName });
            }
        }

        res.json({ success: true, tags: addedTags });
    } catch (error) {
        console.error('Add post tags error:', error);
        res.status(500).json({ error: 'Failed to add tags' });
    }
});

// Remove tag from post
router.delete('/post/:postId/:tagId', (req, res) => {
    try {
        const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.postId);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.user_id !== req.userId) return res.status(403).json({ error: 'Not your post' });

        db.prepare('DELETE FROM post_tags WHERE post_id = ? AND tag_id = ?')
            .run(req.params.postId, req.params.tagId);

        res.json({ success: true });
    } catch (error) {
        console.error('Remove tag error:', error);
        res.status(500).json({ error: 'Failed to remove tag' });
    }
});

// === SUBSCRIPTIONS ===

// Toggle subscription to user
router.post('/subscribe/user/:userId', (req, res) => {
    try {
        const targetUserId = req.params.userId;
        if (targetUserId === req.userId) {
            return res.status(400).json({ error: 'Cannot subscribe to yourself' });
        }

        const target = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(targetUserId);
        if (!target) return res.status(404).json({ error: 'User not found' });

        const existing = db.prepare(
            'SELECT id FROM subscriptions WHERE follower_id = ? AND following_user_id = ?'
        ).get(req.userId, targetUserId);

        if (existing) {
            db.prepare('DELETE FROM subscriptions WHERE follower_id = ? AND following_user_id = ?')
                .run(req.userId, targetUserId);
            return res.json({ success: true, subscribed: false });
        } else {
            db.prepare('INSERT INTO subscriptions (follower_id, following_user_id) VALUES (?, ?)')
                .run(req.userId, targetUserId);
            return res.json({ success: true, subscribed: true });
        }
    } catch (error) {
        console.error('Subscribe user error:', error);
        res.status(500).json({ error: 'Failed to toggle subscription' });
    }
});

// Toggle subscription to tag
router.post('/subscribe/tag/:tagId', (req, res) => {
    try {
        const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(req.params.tagId);
        if (!tag) return res.status(404).json({ error: 'Tag not found' });

        const existing = db.prepare(
            'SELECT id FROM subscriptions WHERE follower_id = ? AND tag_id = ?'
        ).get(req.userId, req.params.tagId);

        if (existing) {
            db.prepare('DELETE FROM subscriptions WHERE follower_id = ? AND tag_id = ?')
                .run(req.userId, req.params.tagId);
            return res.json({ success: true, subscribed: false });
        } else {
            db.prepare('INSERT INTO subscriptions (follower_id, tag_id) VALUES (?, ?)')
                .run(req.userId, req.params.tagId);
            return res.json({ success: true, subscribed: true });
        }
    } catch (error) {
        console.error('Subscribe tag error:', error);
        res.status(500).json({ error: 'Failed to toggle subscription' });
    }
});

// Get user subscriptions
router.get('/subscriptions', (req, res) => {
    try {
        const userSubs = db.prepare(`
            SELECT s.id, s.following_user_id, s.tag_id, s.created_at,
                   CASE WHEN s.following_user_id IS NOT NULL THEN u.username END as username,
                   CASE WHEN s.following_user_id IS NOT NULL THEN u.avatar END as avatar,
                   CASE WHEN s.tag_id IS NOT NULL THEN t.name END as tag_name
            FROM subscriptions s
            LEFT JOIN users u ON s.following_user_id = u.id
            LEFT JOIN tags t ON s.tag_id = t.id
            WHERE s.follower_id = ?
            ORDER BY s.created_at DESC
        `).all(req.userId);

        const users = userSubs.filter(s => s.following_user_id).map(s => ({
            id: s.following_user_id,
            username: s.username,
            avatar: s.avatar
        }));

        const tags = userSubs.filter(s => s.tag_id).map(s => ({
            id: s.tag_id,
            name: s.tag_name
        }));

        res.json({ users, tags });
    } catch (error) {
        console.error('Get subscriptions error:', error);
        res.status(500).json({ error: 'Failed to get subscriptions' });
    }
});

export default router;
