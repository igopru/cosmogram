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
import os from 'os';

import { initDatabase, getDB } from './models/database.js';
import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import commentsRoutes from './routes/comments.js';
import likesRoutes from './routes/likes.js';
import tagsRoutes from './routes/tags.js';
import { preventXSS, securityHeaders } from './middleware/security.js';
import { validateSession } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Security: Validate critical environment variables
const requiredEnvVars = {
    JWT_SECRET: 'Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"',
    SESSION_SECRET: 'Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
};

for (const [key, hint] of Object.entries(requiredEnvVars)) {
    const value = process.env[key];
    if (!value || value.length < 32) {
        console.error(`\n❌ CRITICAL: ${key} is not set or too short (min 32 chars)`);
        console.error(`   ${hint}\n`);
        process.exit(1);
    }
}

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

// Log slow requests
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000) { // Log requests taking more than 1 second
            console.log(`[SLOW] ${req.method} ${req.url} - ${duration}ms`);
        }
    });
    next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(preventXSS);
app.use(securityHeaders);

// Rate limiting — stricter for security
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200, // Reduced from 500
    message: { error: 'Too many requests, please slow down' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // Reduced from 30
    skipSuccessfulRequests: true,
    message: { error: 'Too many login attempts' }
});
app.use('/api/auth/', authLimiter);

// Stricter limits for write operations
const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50, // Max 50 posts/comments/likes per 15 min
    message: { error: 'Too many write operations' }
});
app.use('/api/posts', writeLimiter);
app.use('/api/comments', writeLimiter);
app.use('/api/likes', writeLimiter);

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
app.use('/api/tags', validateSession, tagsRoutes);

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

// Error handler — never expose internals to client
app.use((err, req, res, next) => {
    // Log full error server-side
    console.error('Server Error:', err.message);
    if (err.stack && process.env.NODE_ENV !== 'production') {
        console.error(err.stack);
    }
    
    // Never expose err.message to client
    res.status(err.status || 500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📁 Uploads: ${path.join(__dirname, 'uploads')}`);
    console.log(`💾 Database: ${path.join(__dirname, 'data/media.db')}\n`);
});

// System health monitoring
function logSystemHealth() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const loadAvg = os.loadavg();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const memPercent = ((freeMem / totalMem) * 100).toFixed(1);
    
    console.log(`[HEALTH] Memory: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB RSS | System: ${memPercent}% free | Load: ${loadAvg.join(', ')}`);
}

// Log health every 5 minutes
setInterval(logSystemHealth, 5 * 60 * 1000);
logSystemHealth(); // Initial log

// Periodic SQLite WAL checkpoint and optimization
function optimizeDatabase() {
    try {
        const db = getDB();
        
        // Checkpoint WAL
        db.pragma('wal_checkpoint(TRUNCATE)');
        
        // Optimize database
        db.pragma('optimize');
        
        console.log('[DB] Periodic optimization completed');
    } catch (error) {
        console.error('[DB] Optimization error:', error.message);
    }
}

// Run optimization every 30 minutes
setInterval(optimizeDatabase, 30 * 60 * 1000);
setTimeout(optimizeDatabase, 5 * 60 * 1000); // First run after 5 minutes

process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        console.log('Server closed');
        db.close();
    });
});

// Prevent crashes from unhandled promise rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
    // Gracefully close server before exiting
    server.close(() => {
        console.log('Server closed due to uncaught exception');
        db.close();
        process.exit(1);
    });
    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => process.exit(1), 5000).unref();
});

export { db };
