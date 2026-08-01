import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../models/database.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { validateSession } from '../middleware/auth.js';
import { sanitizeInput } from '../middleware/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const db = getDB();

// Posts visible to a given viewer:
// public posts OR own posts OR posts from users who granted private access
function visibilityClause(viewerId) {
    if (viewerId == null) {
        return 'p.is_public = 1';
    }
    return `(p.is_public = 1 OR p.user_id = ? OR EXISTS(
        SELECT 1 FROM private_access pa WHERE pa.owner_id = p.user_id AND pa.viewer_id = ?
    ))`;
}

// Does viewer have private access to posts of ownerId?
function hasPrivateAccess(ownerId, viewerId) {
    if (viewerId == null) return false;
    if (Number(ownerId) === Number(viewerId)) return true;
    return !!db.prepare(
        'SELECT 1 FROM private_access WHERE owner_id = ? AND viewer_id = ?'
    ).get(ownerId, viewerId);
}

function getProfilePosts(userId, viewerId, limit = 50) {
    const isAuth = viewerId != null;

    let query = `
        SELECT p.id, p.user_id, p.description, p.allow_comments, p.created_at, p.updated_at, p.is_public,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
               (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count
        FROM posts p
        WHERE p.user_id = ? AND ${visibilityClause(viewerId)}
        ORDER BY p.created_at DESC
        LIMIT ${parseInt(limit) || 50}
    `;
    const params = isAuth ? [userId, viewerId, viewerId] : [userId];

    const posts = db.prepare(query).all(...params);

    const getMedia = db.prepare(`
        SELECT id, media_type, media_path, thumbnail_path, sort_order
        FROM post_media
        WHERE post_id = ?
        ORDER BY sort_order ASC
    `);

    const getTags = db.prepare(`
        SELECT t.id, t.name
        FROM tags t
        JOIN post_tags pt ON t.id = pt.tag_id
        WHERE pt.post_id = ?
    `);

    return posts.map(post => {
        const mediaItems = getMedia.all(post.id).map(m => ({
            ...m,
            media_url: `/uploads/${m.media_type === 'video' ? 'videos' : 'images'}/${path.basename(m.media_path)}`,
            thumbnail_url: m.thumbnail_path ? `/uploads/thumbnails/${path.basename(m.thumbnail_path)}` : null
        }));

        return {
            ...post,
            description: sanitizeInput(post.description),
            media: mediaItems,
            media_type: mediaItems[0]?.media_type || 'image',
            tags: getTags.all(post.id)
        };
    });
}

// === Private access management (own account) ===

// List my followers with their private-access status
router.get('/me/access', validateSession, (req, res) => {
    try {
        const followers = db.prepare(`
            SELECT u.id, u.username, u.avatar, u.fullname,
                   s.created_at as subscribed_at,
                   EXISTS(
                       SELECT 1 FROM private_access pa
                       WHERE pa.owner_id = ? AND pa.viewer_id = u.id
                   ) as has_access
            FROM subscriptions s
            JOIN users u ON u.id = s.follower_id
            WHERE s.following_user_id = ? AND u.active = 1
            ORDER BY u.username ASC
        `).all(req.userId, req.userId);

        res.json({ followers });
    } catch (error) {
        console.error('Get private access list error:', error);
        res.status(500).json({ error: 'Failed to get access list' });
    }
});

// Grant private access to a follower
router.post('/me/access/:viewerId', validateSession, (req, res) => {
    try {
        const viewerId = parseInt(req.params.viewerId);
        if (isNaN(viewerId) || viewerId < 1) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        if (viewerId === req.userId) {
            return res.status(400).json({ error: 'Cannot grant access to yourself' });
        }

        const viewer = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(viewerId);
        if (!viewer) return res.status(404).json({ error: 'User not found' });

        db.prepare('INSERT OR IGNORE INTO private_access (owner_id, viewer_id) VALUES (?, ?)')
            .run(req.userId, viewerId);

        res.json({ success: true, has_access: true });
    } catch (error) {
        console.error('Grant private access error:', error);
        res.status(500).json({ error: 'Failed to grant access' });
    }
});

// Revoke private access
router.delete('/me/access/:viewerId', validateSession, (req, res) => {
    try {
        const viewerId = parseInt(req.params.viewerId);
        if (isNaN(viewerId) || viewerId < 1) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        db.prepare('DELETE FROM private_access WHERE owner_id = ? AND viewer_id = ?')
            .run(req.userId, viewerId);

        res.json({ success: true, has_access: false });
    } catch (error) {
        console.error('Revoke private access error:', error);
        res.status(500).json({ error: 'Failed to revoke access' });
    }
});

// === User profile ===

// Profile page: user info + their posts (visibility-aware)
router.get('/:id', optionalAuth, (req, res) => {
    try {
        const profileId = parseInt(req.params.id);
        if (isNaN(profileId) || profileId < 1) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const viewerId = req.userId ?? null;
        const isAuth = viewerId != null;

        const user = db.prepare(`
            SELECT id, username, fullname, avatar, bio, created_at, role
            FROM users
            WHERE id = ? AND active = 1
        `).get(profileId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const stats = db.prepare(`
            SELECT
                (SELECT COUNT(*) FROM posts p WHERE p.user_id = ?) as posts_count,
                (SELECT COUNT(*) FROM subscriptions WHERE following_user_id = ?) as followers_count,
                (SELECT COUNT(*) FROM subscriptions WHERE follower_id = ?) as following_count
        `).get(profileId, profileId, profileId);

        const isSelf = Number(profileId) === Number(viewerId);
        const isFollowing = isAuth && !isSelf && !!db.prepare(
            'SELECT 1 FROM subscriptions WHERE follower_id = ? AND following_user_id = ?'
        ).get(viewerId, profileId);

        const viewerHasAccess = hasPrivateAccess(profileId, viewerId);
        const privatePostsCount = db.prepare(
            'SELECT COUNT(*) as c FROM posts WHERE user_id = ? AND is_public = 0'
        ).get(profileId).c;

        res.json({
            user: {
                id: user.id,
                username: user.username,
                fullname: user.fullname,
                avatar: user.avatar,
                bio: user.bio,
                created_at: user.created_at,
                role: user.role
            },
            stats: {
                posts_count: stats.posts_count,
                followers_count: stats.followers_count,
                following_count: stats.following_count,
                private_posts_count: privatePostsCount
            },
            is_self: isSelf,
            is_following: isFollowing,
            viewer_has_access: viewerHasAccess,
            posts: getProfilePosts(profileId, viewerId)
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

export default router;
