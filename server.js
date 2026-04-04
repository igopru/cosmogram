import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { initDatabase, getDB } from './models/database.js';
import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import commentsRoutes from './routes/comments.js';
import likesRoutes from './routes/likes.js';
import { preventXSS, securityHeaders } from './middleware/security.js';
import { validateSession } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// Создание папок (ДО инициализации БД!)
const uploadDirs = ['uploads/images', 'uploads/thumbnails', 'uploads/videos', 'data'];
uploadDirs.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
});

const db = initDatabase();

// Доверять прокси (nginx)
app.set('trust proxy', true);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            mediaSrc: ["'self'", "blob:", "data:"],
            connectSrc: ["'self'"],
            upgradeInsecureRequests: null,
        },
    },
    hsts: false,
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true,
    credentials: true,
}));

app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(preventXSS);
app.use(securityHeaders);

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests' },
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: true,
    message: { error: 'Too many login attempts' }
});
app.use('/api/auth/', authLimiter);

// Static files
app.use('/static', express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => {
        res.set('X-Content-Type-Options', 'nosniff');
    }
}));

// Uploads — с правильными MIME типами для видео
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res, filePath) => {
        res.set('X-Content-Type-Options', 'nosniff');
        // Правильные MIME типы для видео
        if (filePath.endsWith('.mp4')) {
            res.set('Content-Type', 'video/mp4');
        } else if (filePath.endsWith('.webm')) {
            res.set('Content-Type', 'video/webm');
        } else if (filePath.endsWith('.mov')) {
            res.set('Content-Type', 'video/quicktime');
        } else if (filePath.endsWith('.avi')) {
            res.set('Content-Type', 'video/x-msvideo');
        } else if (filePath.endsWith('.webp')) {
            res.set('Content-Type', 'image/webp');
        }
    },
    // Включаем поддержку range requests для видео (seek)
    acceptRanges: true,
    cacheControl: true,
    maxAge: '1d'
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', validateSession, postsRoutes);
app.use('/api/comments', validateSession, commentsRoutes);
app.use('/api/likes', validateSession, likesRoutes);

// Frontend - главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Favicon
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    const errorMessage = process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message;
    res.status(err.status || 500).json({ error: errorMessage });
});

const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📁 Uploads: ${path.join(__dirname, 'uploads')}`);
    console.log(`💾 Database: ${path.join(__dirname, 'data/media.db')}\n`);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        console.log('Server closed');
        db.close();
    });
});

export { db };
