import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDB } from '../models/database.js';
import { validateRegistration } from '../middleware/validation.js';
import { sanitizeInput } from '../middleware/security.js';

const router = express.Router();
const db = getDB();

router.post('/register', validateRegistration, async (req, res) => {
    try {
        const { username, email, password, fullname } = req.body;
        
        const existingUser = db.prepare(
            'SELECT id FROM users WHERE username = ? OR email = ?'
        ).get(username, email);
        
        if (existingUser) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        
        const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
        
        const result = db.prepare(`
            INSERT INTO users (username, email, password_hash, fullname) 
            VALUES (?, ?, ?, ?)
        `).run(sanitizeInput(username), sanitizeInput(email), passwordHash, sanitizeInput(fullname));
        
        const token = jwt.sign(
            { userId: result.lastInsertRowid, username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.status(201).json({
            success: true,
            user: { id: result.lastInsertRowid, username, email, fullname }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = db.prepare(`
            SELECT id, username, email, password_hash, role 
            FROM users WHERE email = ? AND active = 1
        `).get(email);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { userId: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({
            success: true,
            user: { id: user.id, username: user.username, email: user.email, role: user.role }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

router.get('/me', (req, res) => {
    try {
        const token = req.cookies?.token;
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = db.prepare(`
            SELECT id, username, email, fullname, avatar, bio, role
            FROM users WHERE id = ?
        `).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = db.prepare('SELECT id, username, email FROM users WHERE email = ? AND active = 1').get(email);
        if (!user) {
            // Don't reveal if email exists (security best practice)
            return res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

        // Store reset token in DB
        db.prepare(`
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                used INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `).exec();

        db.prepare(`
            INSERT INTO password_reset_tokens (user_id, token, expires_at)
            VALUES (?, ?, ?)
        `).run(user.id, resetToken, resetExpires);

        // Build reset URL
        const baseUrl = process.env.APP_URL || 'http://localhost:8000';
        const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

        // Send email (if configured) or return token for debugging
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
            try {
                await sendPasswordResetEmail(user.email, user.username, resetUrl);
                res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
            } catch (emailError) {
                console.error('Failed to send reset email:', emailError);
                res.status(500).json({ error: 'Failed to send reset email' });
            }
        } else {
            // No email configured — return token for manual use
            res.json({
                success: true,
                message: 'Email not configured. Use this reset link:',
                resetUrl
            });
        }
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Failed to process password reset request' });
    }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Find valid token
        const resetRecord = db.prepare(`
            SELECT user_id, expires_at, used FROM password_reset_tokens
            WHERE token = ?
        `).get(token);

        if (!resetRecord) {
            return res.status(400).json({ error: 'Invalid reset token' });
        }

        if (resetRecord.used) {
            return res.status(400).json({ error: 'This reset link has already been used' });
        }

        if (new Date(resetRecord.expires_at) < new Date()) {
            return res.status(400).json({ error: 'This reset link has expired' });
        }

        // Hash new password and update user
        const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
        db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, resetRecord.user_id);

        // Mark token as used
        db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?').run(token);

        res.json({ success: true, message: 'Password has been reset successfully' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// Helper: send password reset email
async function sendPasswordResetEmail(email, username, resetUrl) {
    // Dynamic import to avoid error when nodemailer is not installed
    let nodemailer;
    try {
        nodemailer = await import('nodemailer');
    } catch {
        throw new Error('nodemailer is not installed. Install it with: npm install nodemailer');
    }

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'Cosmogram'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: email,
        subject: 'Password Reset — Cosmogram',
        html: `
            <h2>Password Reset Request</h2>
            <p>Hello ${username},</p>
            <p>You requested a password reset for your Cosmogram account.</p>
            <p>Click the link below to reset your password (valid for 1 hour):</p>
            <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#007bff;color:#fff;text-decoration:none;border-radius:4px;">Reset Password</a></p>
            <p>If you didn't request this, you can safely ignore this email.</p>
            <br>
            <p>— Cosmogram Team</p>
        `
    });
}

export default router;
