import jwt from 'jsonwebtoken';
import { getDB } from '../models/database.js';

export async function validateSession(req, res, next) {
    try {
        const db = getDB();
        const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = db.prepare(`
            SELECT id, username, email, role FROM users
            WHERE id = ? AND active = 1
        `).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        req.user = user;
        req.userId = user.id;

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
}

export function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

export function checkPostOwner(req, res, next) {
    const db = getDB();
    
    // Validate ID is integer
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) {
        return res.status(400).json({ error: 'Invalid post ID' });
    }
    
    const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);

    if (!post) {
        return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user_id !== req.userId) {
        return res.status(403).json({ error: 'Not your post' });
    }

    // Normalize the ID for downstream handlers
    req.params.id = postId;
    next();
}
