Структура проекта

media-server/
├── package.json
├── server.js
├── .env
├── .gitignore
├── middleware/
│   ├── auth.js
│   ├── security.js
│   └── validation.js
├── routes/
│   ├── auth.js
│   ├── posts.js
│   ├── comments.js
│   └── likes.js
├── models/
│   ├── User.js
│   ├── Post.js
│   ├── Comment.js
│   └── Like.js
├── utils/
│   ├── fileHandler.js
│   ├── sanitizer.js
│   └── rateLimiter.js
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
└── uploads/
    ├── images/
    ├── thumbnails/
    └── videos/
