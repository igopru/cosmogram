#!/usr/bin/env node
/**
 * Reset all posts, media, comments, and likes from the database.
 * Keeps users table intact.
 * Also removes all uploaded files (images, videos, thumbnails).
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../data/media.db');
const UPLOAD_DIRS = [
    path.join(__dirname, '../uploads/images'),
    path.join(__dirname, '../uploads/videos'),
    path.join(__dirname, '../uploads/thumbnails'),
];

function getDB() {
    return new Database(DB_PATH);
}

function askQuestion(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans.toLowerCase()); }));
}

async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  ⚠️  DATABASE RESET');
    console.log('═══════════════════════════════════════════════\n');

    console.log('This will:');
    console.log('  • Delete ALL posts');
    console.log('  • Delete ALL media records');
    console.log('  • Delete ALL comments');
    console.log('  • Delete ALL likes');
    console.log('  • Remove ALL uploaded files (images, videos, thumbnails)');
    console.log('  • Keep users table intact\n');

    const answer = await askQuestion('Are you sure? (yes/no): ');

    if (answer !== 'yes') {
        console.log('❌ Cancelled');
        process.exit(0);
    }

    const db = getDB();

    // 1. Delete uploaded files
    console.log('\n📁 Removing uploaded files...');

    for (const dir of UPLOAD_DIRS) {
        if (fs.existsSync(dir)) {
            let count = 0;
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                try {
                    const stat = fs.lstatSync(filePath);
                    if (stat.isSymbolicLink()) {
                        fs.unlinkSync(filePath);
                        count++;
                    } else if (stat.isFile()) {
                        fs.unlinkSync(filePath);
                        count++;
                    }
                } catch (e) {
                    console.error(`   ⚠️  Failed to remove ${file}: ${e.message}`);
                }
            }
            console.log(`   Removed ${count} files from ${path.basename(dir)}/`);
        }
    }

    // 2. Delete all posts (cascade handles media, comments, likes)
    console.log('\n🗑️  Deleting database records...');

    const postsCount = db.prepare('SELECT COUNT(*) as count FROM posts').get();
    const mediaCount = db.prepare('SELECT COUNT(*) as count FROM post_media').get();
    const commentsCount = db.prepare('SELECT COUNT(*) as count FROM comments').get();
    const likesCount = db.prepare('SELECT COUNT(*) as count FROM likes').get();

    // Delete in order (likes and comments first, then posts which cascades to media)
    db.prepare('DELETE FROM likes').run();
    db.prepare('DELETE FROM comments').run();
    db.prepare('DELETE FROM posts').run();
    // post_media is deleted by CASCADE

    console.log(`   Deleted ${postsCount.count} posts`);
    console.log(`   Deleted ${mediaCount.count} media records`);
    console.log(`   Deleted ${commentsCount.count} comments`);
    console.log(`   Deleted ${likesCount.count} likes`);

    // Reset autoincrement
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('posts', 'post_media', 'comments', 'likes')");

    db.close();

    console.log('\n═══════════════════════════════════════════════');
    console.log('  ✅ Database reset complete');
    console.log('═══════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
