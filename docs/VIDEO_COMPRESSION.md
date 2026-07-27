# Client-Side Video Compression Guide 🎬

> Cosmogram automatically compresses large videos **in the browser** before upload, reducing bandwidth and server load.

---

## 🔄 How It Works

### Upload Flow

```
User selects video → Check size → If > 5MB → Compress in browser → Upload compressed WebM
                                                      ↓
                                          Canvas + MediaRecorder
                                          • Resolution ≤ 854×480
                                          • Bitrate ≤ 800 kbps
                                          • Framerate ≤ 24 fps
```

### What Changes

| Before | After |
|--------|-------|
| Video sent as-is (uncompressed) | Video auto-compressed when > 5MB |
| 10MB max file size | 50MB max (after compression, much smaller) |
| Any resolution/bitrate | Max 854×480, 800 kbps, 24 fps |

---

## ⚙️ Client-Side Compression Settings

Configured in `public/script.js`:

```js
const VIDEO_COMPRESS_CONFIG = {
    maxWidth: 854,
    maxHeight: 480,
    bitrate: 800000,      // 800 kbps
    fps: 24,
    sizeThreshold: 5 * 1024 * 1024  // 5MB — files below this skip compression
};
```

### What Each Setting Does

| Setting | Default | Description |
|---------|---------|-------------|
| `maxWidth` | 854 | Maximum video width in pixels |
| `maxHeight` | 480 | Maximum video height in pixels |
| `bitrate` | 800000 | Target bitrate in bits per second |
| `fps` | 24 | Target framerate |
| `sizeThreshold` | 5MB | Videos smaller than this are uploaded as-is |

### Trade-offs

- **Smaller files** → faster upload, less server storage
- **Lower quality** → acceptable for social-media style short videos
- **No audio** → compressed video is silent (canvas.captureStream limitation)

---

## 📦 Server-Side Limits

Set in `.env`:

```env
# Maximum file size for uploads (bytes)
MAX_FILE_SIZE=10485760        # 10MB — for images
MAX_VIDEO_SIZE=52428800       # 50MB — лимит multer (видео уже сжаты на клиенте)
MIN_VIDEO_DURATION=1.0        # Minimum video duration in seconds
```

### Client-Side Size Gate

На клиенте **нет** ограничения на размер файла — видео любого размера будут сжаты до 854×480 / 800 kbps перед отправкой. Это позволяет обрабатывать файлы десятками гигабайт без нагрузки на сервер. Таймаут компрессии: **10 минут**.

---

## 🧪 Testing

1. Select a large video file (> 5MB) in the upload dialog
2. Watch the progress bar: "Compressing video 1/1…"
3. The video plays in a hidden element while being re-encoded
4. Upload starts automatically when compression finishes

**Expected compression ratios** (approximate):

| Original | Compressed | Ratio |
|----------|-----------|-------|
| 50 MB 1080p | ~3-5 MB 480p | 90% smaller |
| 20 MB 720p | ~2-3 MB 480p | 85% smaller |
| 8 MB 480p | ~1-2 MB 480p | 75% smaller |
| 3 MB 480p | 3 MB (no compression) | 0% (below threshold) |

---

## 🐛 Troubleshooting

### "MediaRecorder not supported"
- Use **Chrome**, **Firefox**, or **Edge** (latest versions)
- Safari support is limited

### Video compression is slow
- Compression runs at real-time speed (a 30-second video takes ~30 seconds)
- Progress is shown in the upload dialog

### Compressed video is silent
- This is expected. The Canvas API does not capture audio tracks
- For videos that need sound, keep them under 5MB to skip compression

### "Video compression timeout"
- Videos longer than ~2 minutes are aborted
- Split long videos into shorter clips

---

## 🔒 Security Notes

- All compression happens **in the browser** — no data leaves the client until upload
- The original file is never sent to the server (compressed version only)
- MediaRecorder output is standard WebM/VP8 — safe and widely supported
