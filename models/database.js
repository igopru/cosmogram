import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance = null;

export function getDB() {
    if (!dbInstance) {
        dbInstance = new Database(path.join(__dirname, '../data/media.db'));

        // Performance and stability pragmas
        dbInstance.pragma('foreign_keys = ON');
        dbInstance.pragma('journal_mode = WAL');
        dbInstance.pragma('busy_timeout = 5000');        // Wait 5s before SQLITE_BUSY error
        dbInstance.pragma('cache_size = -64000');        // 64MB cache (negative = KB)
        dbInstance.pragma('temp_store = MEMORY');         // Faster temp table operations
        dbInstance.pragma('synchronous = NORMAL');        // Safe but faster than FULL
        dbInstance.pragma('wal_autocheckpoint = 100');   // Checkpoint WAL every 100 pages (more aggressive)
        dbInstance.pragma('mmap_size = 268435456');      // 256MB memory-mapped I/O

        // Initial checkpoint to keep WAL small
        dbInstance.pragma('wal_checkpoint(TRUNCATE)');
    }
    return dbInstance;
}

export function initDatabase() {
    const db = getDB();

    const tables = `
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            fullname TEXT,
            avatar TEXT,
            bio TEXT,
            role TEXT DEFAULT 'user',
            active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            description TEXT,
            allow_comments INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS post_media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            media_type TEXT CHECK(media_type IN ('image', 'video')) NOT NULL,
            media_path TEXT NOT NULL,
            thumbnail_path TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(post_id, user_id),
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS post_tags (
            post_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (post_id, tag_id),
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            follower_id INTEGER NOT NULL,
            following_user_id INTEGER,
            tag_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(follower_id, following_user_id),
            UNIQUE(follower_id, tag_id),
            FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (following_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            CHECK (
                (following_user_id IS NOT NULL AND tag_id IS NULL) OR
                (following_user_id IS NULL AND tag_id IS NOT NULL)
            )
        );

        CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
        CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
        CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id);
        CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
        CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id);
        CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);
        CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
        CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_follower ON subscriptions(follower_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_following ON subscriptions(following_user_id);
    `;

    db.exec(tables);

    // Migrate: add is_public column to posts if not exists
    try {
        db.exec(`ALTER TABLE posts ADD COLUMN is_public INTEGER DEFAULT 1`);
    } catch (e) {
        // Column already exists
    }

    const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (!adminExists) {
        // Generate a strong random password — force change on first login
        const tempPassword = crypto.randomBytes(8).toString('hex'); // 16 char password
        const passwordHash = bcrypt.hashSync(tempPassword, 12);
        db.prepare(`
            INSERT INTO users (username, email, password_hash, fullname, role)
            VALUES (?, ?, ?, ?, ?)
        `).run('admin', 'admin@localhost', passwordHash, 'Administrator', 'admin');
        console.log('⚠️  Admin created with RANDOM password (check logs ONCE):');
        console.log('   Username: admin');
        console.log(`   Password: ${tempPassword}`);
        console.log('   ⚠️  CHANGE THIS PASSWORD IMMEDIATELY!');
    }

    return db;
}

export default getDB;
