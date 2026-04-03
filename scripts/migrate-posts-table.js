#!/usr/bin/env node
/**
 * Миграция: перестроение таблицы posts для поддержки нескольких медиа
 * Удаляет старые колонки media_type, media_path, thumbnail_path из posts
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../data/media.db');

const db = new Database(dbPath);
db.pragma('foreign_keys = OFF');
db.pragma('journal_mode = WAL');

function migrate() {
    const columns = db.prepare("PRAGMA table_info(posts)").all();
    const hasOldColumns = columns.some(c => c.name === 'media_type' || c.name === 'media_path');

    if (!hasOldColumns) {
        console.log('✅ Таблица posts уже обновлена, миграция не нужна.');
        db.close();
        return;
    }

    console.log('🔄 Начинаем миграцию таблицы posts...');

    db.transaction(() => {
        // 1. Создаём новую таблицу posts_new
        db.exec(`
            CREATE TABLE posts_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT,
                allow_comments INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 2. Копируем данные из старой таблицы
        db.exec(`
            INSERT INTO posts_new (id, user_id, description, allow_comments, created_at, updated_at)
            SELECT id, user_id, description, allow_comments, created_at, updated_at FROM posts
        `);

        // 3. Переносим медиа из старых колонок в post_media
        const oldPosts = db.prepare(`
            SELECT id, media_type, media_path, thumbnail_path
            FROM posts
            WHERE media_path IS NOT NULL
        `).all();

        if (oldPosts.length > 0) {
            console.log(`   Переносим ${oldPosts.length} постов со старыми медиа в post_media...`);
            
            const insertMedia = db.prepare(`
                INSERT INTO post_media (post_id, media_type, media_path, thumbnail_path, sort_order)
                VALUES (?, ?, ?, ?, ?)
            `);

            for (const post of oldPosts) {
                if (post.media_path) {
                    insertMedia.run(post.id, post.media_type || 'image', post.media_path, post.thumbnail_path, 0);
                }
            }
            console.log('   ✅ Медиа перенесены в post_media');
        }

        // 4. Удаляем старую таблицу
        db.exec('DROP TABLE posts');

        // 5. Переименовываем новую
        db.exec('ALTER TABLE posts_new RENAME TO posts');

        // 6. Пересоздаём индексы
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
            CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
        `);

        console.log('✅ Миграция завершена!');
    })();

    db.pragma('foreign_keys = ON');
    db.close();
}

try {
    migrate();
} catch (e) {
    console.error('❌ Ошибка миграции:', e.message);
    process.exit(1);
}
