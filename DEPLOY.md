# Deployment Guide

## 1. Clone

```bash
git clone https://github.com/your-username/cosmogram.git
cd cosmogram
```

## 2. Install

```bash
npm install
```

## 3. Configure

```bash
cp .env.example .env
# Edit .env — change secrets and your domain
nano .env
```

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## 4. Start

```bash
# Development
npm run dev

# Production
npm start
```

## 5. Systemd (optional)

```bash
# Edit paths in cosmogram.service
nano cosmogram.service

# Install
sudo cp cosmogram.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cosmogram
```

## 6. Nginx (optional, for HTTPS)

```bash
# Edit nginx-updated-config.conf — change domain and SSL paths
sudo cp nginx-updated-config.conf /etc/nginx/sites-available/cosmogram
sudo ln -s /etc/nginx/sites-available/cosmogram /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Admin user

Default: `admin@localhost` / `Admin123!`

Create users:
```bash
node scripts/manage-users.js create --username john --email john@example.com --password "SecurePass123!"
```

## 8. Import media

```bash
# Edit CONFIG in scripts/import-media.js
node scripts/import-media.js
```
