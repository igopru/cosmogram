# 🔐 Admin Password Management

### Default Credentials (First Run)
- **Username**: `admin`
- **Password**: Auto-generated random 16-char hex string (check server logs on startup)

> ⚠️ **Important**: Change the default password immediately after first login!

### How to Change Admin Password

```bash
# Interactive mode (will prompt for new password):
node scripts/manage-users.js resetpw --username admin

# Or with password in command (be careful with shell history):
node scripts/manage-users.js resetpw --username admin --password "YourNewSecurePassword123!"

# After changing, clear your shell history:
history -d $(history | tail -2 | head -1 | awk '{print $1}')

# Tips
autority logon: admin@localhost

# After changing, clear your shell history:
history -d $(history | tail -2 | head -1 | awk '{print $1}')

### 🔐 Create New Admin User

node scripts/manage-users.js create \
  --username newadmin \
  --email admin@example.com \
  --fullname "New Administrator" \
  --password "SecurePass123!" \
  --role admin

### 🔐 List All Users
node scripts/manage-users.js list

### 🔐 Delete User
node scripts/manage-users.js delete --username olduser

🔐 Security Tips:

    Always use strong passwords (12+ chars, mixed case, numbers, symbols)
    Clear shell history after commands with passwords: history -c
    Store passwords in a password manager, not in plaintext files
    Rotate admin passwords periodically (every 90 days recommended)

