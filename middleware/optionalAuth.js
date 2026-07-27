import jwt from 'jsonwebtoken';
import { getDB } from '../models/database.js';

export async function optionalAuth(req, res, next) {
    try {
        const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

        if (!token) {
            req.user = null;
            req.userId = null;
            return next();
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const db = getDB();

        const user = db.prepare(`
            SELECT id, username, email, role FROM users
            WHERE id = ? AND active = 1
        `).get(decoded.userId);

        if (user) {
            req.user = user;
            req.userId = user.id;
        } else {
            req.user = null;
            req.userId = null;
        }
    } catch {
        req.user = null;
        req.userId = null;
    }

    next();
}
