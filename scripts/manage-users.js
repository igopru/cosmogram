#!/usr/bin/env node
/**
 * Cosmogram User Management CLI
 * 
 * Использование:
 *   node scripts/manage-users.js <command> [options]
 * 
 * Команды:
 *   create    - Создать нового пользователя
 *   list      - Показать всех пользователей
 *   info      - Показать информацию о пользователе
 *   block     - Заблокировать пользователя
 *   unblock   - Разблокировать пользователя
 *   delete    - Удалить пользователя
 *   promote   - Сделать администратором
 *   demote    - Убрать права администратора
 *   resetpw   - Сбросить пароль
 * 
 * Примеры:
 *   node scripts/manage-users.js create --username john --email john@example.com --password "secure123"
 *   node scripts/manage-users.js list
 *   node scripts/manage-users.js info --username john
 *   node scripts/manage-users.js block --username john
 *   node scripts/manage-users.js unblock --id 5
 *   node scripts/manage-users.js delete --id 5
 *   node scripts/manage-users.js delete --username john --force
 *   node scripts/manage-users.js promote --username john
 *   node scripts/manage-users.js resetpw --username john --password "newpass456"
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CLI Helper
// ============================================================

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

function parseArgs(args) {
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            parsed[key] = args[i + 1] || true;
        }
    }
    return parsed;
}

// ============================================================
// Colors
// ============================================================

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m'
};

function log(color, ...args) {
    console.log(`${color}${args.join(' ')}${colors.reset}`);
}

function success(...args) { log(colors.green, '✅', ...args); }
function error(...args) { log(colors.red, '❌', ...args); }
function warn(...args) { log(colors.yellow, '⚠️', ...args); }
function info(...args) { log(colors.cyan, 'ℹ️ ', ...args); }
function title(...args) { log(colors.bold + colors.blue, ...args); }

// ============================================================
// Database
// ============================================================

function getDB() {
    const dbPath = path.join(__dirname, '../data/media.db');
    return new Database(dbPath);
}

// ============================================================
// Commands
// ============================================================

async function createUser(args) {
    const db = getDB();
    
    let username = args.username;
    let email = args.email;
    let password = args.password;
    let fullname = args.fullname || '';
    let role = args.role || 'user';
    
    // Interactive mode
    if (!username) {
        username = await ask('Username: ');
    }
    if (!email) {
        email = await ask('Email: ');
    }
    if (!password) {
        password = await ask('Password (min 8 chars): ');
    }
    if (!fullname) {
        fullname = await ask('Full name (optional): ') || '';
    }
    
    // Validation
    if (!username || username.length < 3) {
        error('Username must be at least 3 characters');
        rl.close();
        db.close();
        process.exit(1);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        error('Invalid email format');
        rl.close();
        db.close();
        process.exit(1);
    }
    if (!password || password.length < 8) {
        error('Password must be at least 8 characters');
        rl.close();
        db.close();
        process.exit(1);
    }
    
    // Check existing
    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) {
        error('User with this username or email already exists');
        rl.close();
        db.close();
        process.exit(1);
    }
    
    // Create
    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const result = db.prepare(
        'INSERT INTO users (username, email, password_hash, fullname, role, active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(username, email, passwordHash, fullname, role);
    
    rl.close();
    success(`User "${username}" created with ID ${result.lastInsertRowid}`);
    db.close();
}

async function listUsers(args) {
    const db = getDB();
    
    const users = db.prepare(`
        SELECT id, username, email, fullname, role, active, created_at,
               (SELECT COUNT(*) FROM posts WHERE user_id = users.id) as post_count
        FROM users
        ORDER BY id ASC
    `).all();
    
    if (users.length === 0) {
        info('No users found');
        db.close();
        return;
    }
    
    title(`\nUsers (${users.length}):\n`);
    
    // Table header
    const header = `${'ID'.padEnd(4)} | ${'Username'.padEnd(16)} | ${'Email'.padEnd(28)} | ${'Role'.padEnd(8)} | ${'Status'.padEnd(10)} | ${'Posts'.padEnd(5)} | Created`;
    console.log(colors.bold + header + colors.reset);
    console.log('─'.repeat(header.length));
    
    for (const u of users) {
        const status = u.active ? colors.green + 'Active' + colors.reset : colors.red + 'Blocked' + colors.reset;
        const role = u.role === 'admin' ? colors.yellow + u.role + colors.reset : u.role;
        const created = new Date(u.created_at).toLocaleDateString('ru-RU');
        
        console.log(
            `${String(u.id).padEnd(4)} | ${u.username.padEnd(16)} | ${u.email.padEnd(28)} | ${role.padEnd(8)} | ${status.padEnd(18)} | ${String(u.post_count).padEnd(5)} | ${created}`
        );
    }
    console.log();
    
    db.close();
}

async function userInfo(args) {
    const db = getDB();
    
    let user;
    if (args.id) {
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(args.id);
    } else if (args.username) {
        user = db.prepare('SELECT * FROM users WHERE username = ?').get(args.username);
    } else {
        error('Specify --id or --username');
        db.close();
        process.exit(1);
    }
    
    if (!user) {
        error('User not found');
        db.close();
        process.exit(1);
    }
    
    title(`\nUser: ${user.username}\n`);
    console.log(`  ID:        ${user.id}`);
    console.log(`  Username:  ${user.username}`);
    console.log(`  Email:     ${user.email}`);
    console.log(`  Full Name: ${user.fullname || '—'}`);
    console.log(`  Role:      ${user.role}`);
    console.log(`  Status:    ${user.active ? 'Active' : 'Blocked'}`);
    console.log(`  Created:   ${new Date(user.created_at).toLocaleString('ru-RU')}`);
    console.log(`  Updated:   ${new Date(user.updated_at).toLocaleString('ru-RU')}`);
    
    const stats = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM posts WHERE user_id = ?) as posts,
            (SELECT COUNT(*) FROM comments WHERE user_id = ?) as comments,
            (SELECT COUNT(*) FROM likes WHERE user_id = ?) as likes
    `).get(user.id, user.id, user.id);
    
    console.log(`\n  Statistics:`);
    console.log(`    Posts:    ${stats.posts}`);
    console.log(`    Comments: ${stats.comments}`);
    console.log(`    Likes:    ${stats.likes}`);
    console.log();
    
    db.close();
}

async function blockUser(args) {
    const db = getDB();
    const identifier = args.username || args.id;
    
    if (!identifier) {
        error('Specify --username or --id');
        db.close();
        process.exit(1);
    }
    
    let user;
    if (args.username) {
        user = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(args.username);
    } else {
        user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(args.id);
    }
    
    if (!user) {
        error('User not found');
        db.close();
        process.exit(1);
    }
    
    if (user.role === 'admin') {
        warn('Cannot block admin user');
        db.close();
        process.exit(1);
    }
    
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(user.id);
    success(`User "${user.username}" blocked`);
    db.close();
}

async function unblockUser(args) {
    const db = getDB();
    const identifier = args.username || args.id;
    
    if (!identifier) {
        error('Specify --username or --id');
        db.close();
        process.exit(1);
    }
    
    let user;
    if (args.username) {
        user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(args.username);
    } else {
        user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(args.id);
    }
    
    if (!user) {
        error('User not found');
        db.close();
        process.exit(1);
    }
    
    db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(user.id);
    success(`User "${user.username}" unblocked`);
    db.close();
}

async function deleteUser(args) {
    const db = getDB();
    
    let user;
    if (args.id) {
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(args.id);
    } else if (args.username) {
        user = db.prepare('SELECT * FROM users WHERE username = ?').get(args.username);
    } else {
        error('Specify --id or --username');
        db.close();
        process.exit(1);
    }
    
    if (!user) {
        error('User not found');
        db.close();
        process.exit(1);
    }
    
    if (user.role === 'admin' && !args.force) {
        warn('Cannot delete admin user. Use --force to override.');
        db.close();
        process.exit(1);
    }
    
    // Stats before delete
    const stats = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM posts WHERE user_id = ?) as posts,
            (SELECT COUNT(*) FROM comments WHERE user_id = ?) as comments,
            (SELECT COUNT(*) FROM likes WHERE user_id = ?) as likes
    `).get(user.id, user.id, user.id);
    
    warn(`Deleting user "${user.username}" will remove:`);
    console.log(`  Posts:    ${stats.posts}`);
    console.log(`  Comments: ${stats.comments}`);
    console.log(`  Likes:    ${stats.likes}`);
    
    if (args.force) {
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
        success(`User "${user.username}" deleted`);
    } else {
        // Soft delete
        db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(user.id);
        success(`User "${user.username}" deactivated (posts preserved, use --force to permanently delete)`);
    }
    
    db.close();
}

async function promoteUser(args) {
    const db = getDB();
    
    let user;
    if (args.username) {
        user = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(args.username);
    } else {
        user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(args.id);
    }
    
    if (!user) {
        error('User not found');
        db.close();
        process.exit(1);
    }
    
    if (user.role === 'admin') {
        info(`User "${user.username}" is already an admin`);
        db.close();
        return;
    }
    
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', user.id);
    success(`User "${user.username}" promoted to admin`);
    db.close();
}

async function demoteUser(args) {
    const db = getDB();
    
    let user;
    if (args.username) {
        user = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(args.username);
    } else {
        user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(args.id);
    }
    
    if (!user) {
        error('User not found');
        db.close();
        process.exit(1);
    }
    
    if (user.role !== 'admin') {
        info(`User "${user.username}" is not an admin`);
        db.close();
        return;
    }
    
    // Check if this is the last admin
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
    if (adminCount.count <= 1) {
        error('Cannot demote the last admin user');
        db.close();
        process.exit(1);
    }
    
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('user', user.id);
    success(`User "${user.username}" demoted to regular user`);
    db.close();
}

async function resetPassword(args) {
    const db = getDB();
    
    let user;
    if (args.username) {
        user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(args.username);
    } else {
        user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(args.id);
    }
    
    if (!user) {
        error('User not found');
        db.close();
        process.exit(1);
    }
    
    let password = args.password;
    if (!password) {
        password = await ask(`New password for "${user.username}": `);
    }
    
    if (password.length < 8) {
        error('Password must be at least 8 characters');
        rl.close();
        db.close();
        process.exit(1);
    }
    
    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, user.id);
    
    rl.close();
    success(`Password for "${user.username}" has been reset`);
    db.close();
}

// ============================================================
// Main
// ============================================================

const args = parseArgs(process.argv.slice(2));
const command = args._ || process.argv[2] || Object.keys(args)[0];

const commands = {
    create: createUser,
    list: listUsers,
    info: userInfo,
    block: blockUser,
    unblock: unblockUser,
    delete: deleteUser,
    promote: promoteUser,
    demote: demoteUser,
    resetpw: resetPassword,
};

if (!command || !commands[command]) {
    console.log(`
╔═══════════════════════════════════════════════════╗
║  Cosmogram User Management CLI                    ║
╚═══════════════════════════════════════════════════╝

${colors.bold}Usage:${colors.reset}
  node scripts/manage-users.js <command> [options]

${colors.bold}Commands:${colors.reset}
  create    - Create new user
  list      - List all users
  info      - Show user details
  block     - Block user
  unblock   - Unblock user
  delete    - Delete user (soft by default)
  promote   - Make user admin
  demote    - Remove admin rights
  resetpw   - Reset user password

${colors.bold}Examples:${colors.reset}
  node scripts/manage-users.js create --username john --email john@example.com --password "secure123"
  node scripts/manage-users.js list
  node scripts/manage-users.js info --username john
  node scripts/manage-users.js block --username john
  node scripts/manage-users.js unblock --id 5
  node scripts/manage-users.js delete --username john --force
  node scripts/manage-users.js promote --username john
  node scripts/manage-users.js resetpw --username john --password "newpass456"

${colors.bold}Options:${colors.reset}
  --username    Username
  --id          User ID
  --email       Email
  --password    Password
  --fullname    Full name
  --role        Role (user/admin)
  --force       Force destructive operations
`);
    process.exit(0);
}

commands[command](args).catch(e => {
    error(e.message);
    process.exit(1);
});
