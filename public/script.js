let currentUser = null;
let currentFeed = [];
let selectedMedia = null;

// Обёртка для fetch с credentials
const apiFetch = async (url, options = {}) => {
    options.credentials = 'include';
    if (!options.headers) options.headers = {};
    if (options.body && !(options.body instanceof FormData)) {
        options.headers['Content-Type'] = 'application/json';
    }
    return window.fetch(url, options);
};

// Check authorization
async function checkAuth() {
    try {
        const res = await apiFetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            showFeed();
        } else {
            showAuth();
        }
    } catch (e) {
        showAuth();
    }
}

function showAuth() {
    document.getElementById('authForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('feed').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('uploadBtn').style.display = 'none';
    document.getElementById('profileBtn').style.display = 'none';
}

function showFeed() {
    document.getElementById('authForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('feed').style.display = 'block';
    document.getElementById('logoutBtn').style.display = 'block';
    document.getElementById('uploadBtn').style.display = 'block';
    document.getElementById('profileBtn').style.display = 'block';
    loadFeed();
}

// Load feed
async function loadFeed() {
    const feed = document.getElementById('feed');
    feed.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading...</p></div>';

    try {
        const res = await apiFetch('/api/posts/feed');
        if (!res.ok) throw new Error('Failed to load feed');
        const data = await res.json();
        currentFeed = data.posts;
        renderFeed();
    } catch (e) {
        feed.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📷</div>
                <h3>No posts yet</h3>
                <p>Be the first to share something!</p>
            </div>
        `;
    }
}

function renderFeed() {
    const feed = document.getElementById('feed');
    feed.innerHTML = '';

    if (currentFeed.length === 0) {
        feed.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📷</div>
                <h3>No posts yet</h3>
                <p>Be the first to share something!</p>
            </div>
        `;
        return;
    }

    currentFeed.forEach(post => {
        const postEl = createPostElement(post);
        feed.appendChild(postEl);
    });
}

function createPostElement(post) {
    const div = document.createElement('div');
    div.className = 'post';

    const mediaCount = post.media ? post.media.length : 0;
    const isOwner = Number(post.user_id) === Number(currentUser?.id);

    // Определяем тип медиаконтейнера
    let mediaContainer;
    if (mediaCount > 1) {
        // Карусель для нескольких медиа
        mediaContainer = `
            <div class="post-media-carousel" id="carousel-${post.id}">
                ${post.media.map((m, i) => `
                    <div class="carousel-slide" data-index="${i}" style="${i > 0 ? 'display:none;' : ''}">
                        ${m.media_type === 'video'
                            ? `<video src="${m.media_url}" controls preload="metadata"></video>`
                            : `<img src="${m.media_url}" alt="Post" loading="lazy">`}
                    </div>
                `).join('')}
                ${mediaCount > 1 ? `
                    <button class="carousel-btn carousel-prev" onclick="carouselPrev(${post.id})">&#10094;</button>
                    <button class="carousel-btn carousel-next" onclick="carouselNext(${post.id})">&#10095;</button>
                    <div class="carousel-dots">
                        ${post.media.map((_, i) => `<span class="dot ${i === 0 ? 'active' : ''}" onclick="carouselGoTo(${post.id}, ${i})"></span>`).join('')}
                    </div>
                    <span class="carousel-counter">1/${mediaCount}</span>
                ` : ''}
            </div>
        `;
    } else if (mediaCount === 1) {
        // Одиночное медиа
        const m = post.media[0];
        mediaContainer = `
            <div class="post-media">
                ${m.media_type === 'video'
                    ? `<video src="${m.media_url}" controls preload="metadata"></video>`
                    : `<img src="${m.media_url}" alt="Post" loading="lazy">`}
            </div>
        `;
    } else {
        mediaContainer = '';
    }

    div.innerHTML = `
        <div class="post-header">
            <div class="post-avatar">${getAvatarEmoji(post.username)}</div>
            <div class="post-header-info">
                <div class="post-username">${escapeHtml(post.username)}</div>
                <div class="post-time">${formatDate(post.created_at)}</div>
            </div>
            ${isOwner ? `<button class="post-menu" onclick="deletePost(${post.id}, this)">🗑️</button>` : ''}
        </div>

        ${mediaContainer}

        <div class="post-actions">
            <button class="action-btn like-btn ${post.user_liked ? 'liked' : ''}" onclick="toggleLike(${post.id}, this)">${post.user_liked ? '❤️' : '🤍'}</button>
            <button class="action-btn" onclick="focusComment(${post.id})">💬</button>
            <button class="action-btn" onclick="sharePost(${post.id})">📤</button>
        </div>

        <div class="post-likes" id="likes-${post.id}">${post.likes_count || 0} likes</div>

        ${post.description ? `
        <div class="post-caption">
            <strong>${escapeHtml(post.username)}</strong> ${escapeHtml(post.description)}
        </div>
        ` : ''}

        <div class="post-comments" id="comments-${post.id}"></div>

        <div class="comment-form">
            <input type="text" id="comment-input-${post.id}" class="comment-input" placeholder="Add a comment..." maxlength="500">
            <button class="comment-submit" onclick="addComment(${post.id})">Post</button>
        </div>
    `;

    loadComments(post.id);
    if (mediaCount > 1) carouselInit(post.id);
    return div;
}

// Carousel functions
const carouselState = {};

function carouselInit(postId) {
    if (!carouselState[postId]) {
        carouselState[postId] = { currentIndex: 0, touchStartX: 0, touchStartY: 0 };
    }
    const carousel = document.getElementById(`carousel-${postId}`);
    if (!carousel) return;

    // Touch/swipe events for mobile
    carousel.addEventListener('touchstart', (e) => {
        carouselState[postId].touchStartX = e.touches[0].clientX;
        carouselState[postId].touchStartY = e.touches[0].clientY;
    }, { passive: true });

    carousel.addEventListener('touchend', (e) => {
        const state = carouselState[postId];
        if (!state) return;
        const diffX = e.changedTouches[0].clientX - state.touchStartX;
        const diffY = e.changedTouches[0].clientY - state.touchStartY;

        // Только горизонтальный свайп (проверяем что |diffX| > |diffY|)
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            e.preventDefault();
            if (diffX > 0) carouselPrev(postId);
            else carouselNext(postId);
        }
    }, { passive: false });

    // Mouse swipe для десктопа (drag)
    let isDragging = false;
    let dragStartX = 0;
    carousel.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'VIDEO') return; // Не блокируем взаимодействие с видео
        isDragging = true;
        dragStartX = e.clientX;
        carousel.style.cursor = 'grabbing';
        e.preventDefault();
    });
    carousel.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        carousel.style.cursor = 'grab';
        const diffX = e.clientX - dragStartX;
        if (Math.abs(diffX) > 50) {
            if (diffX > 0) carouselPrev(postId);
            else carouselNext(postId);
        }
    });
    carousel.addEventListener('mouseleave', () => {
        isDragging = false;
        carousel.style.cursor = 'grab';
    });
    carousel.style.cursor = 'grab';
}

function carouselPrev(postId) {
    const state = carouselState[postId];
    if (!state) return;

    const slides = document.querySelectorAll(`#carousel-${postId} .carousel-slide`);
    const dots = document.querySelectorAll(`#carousel-${postId} .dot`);
    const counter = document.querySelector(`#carousel-${postId} .carousel-counter`);

    slides[state.currentIndex].style.display = 'none';
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.remove('active');

    state.currentIndex = (state.currentIndex - 1 + slides.length) % slides.length;

    slides[state.currentIndex].style.display = 'flex';
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.add('active');
    if (counter) counter.textContent = `${state.currentIndex + 1}/${slides.length}`;
}

function carouselNext(postId) {
    const state = carouselState[postId];
    if (!state) return;

    const slides = document.querySelectorAll(`#carousel-${postId} .carousel-slide`);
    const dots = document.querySelectorAll(`#carousel-${postId} .dot`);
    const counter = document.querySelector(`#carousel-${postId} .carousel-counter`);

    slides[state.currentIndex].style.display = 'none';
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.remove('active');

    state.currentIndex = (state.currentIndex + 1) % slides.length;

    slides[state.currentIndex].style.display = 'flex';
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.add('active');
    if (counter) counter.textContent = `${state.currentIndex + 1}/${slides.length}`;
}

function carouselGoTo(postId, index) {
    const state = carouselState[postId];
    if (!state) return;

    const slides = document.querySelectorAll(`#carousel-${postId} .carousel-slide`);
    const dots = document.querySelectorAll(`#carousel-${postId} .dot`);
    const counter = document.querySelector(`#carousel-${postId} .carousel-counter`);

    slides[state.currentIndex].style.display = 'none';
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.remove('active');

    state.currentIndex = index;

    slides[state.currentIndex].style.display = 'flex';
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.add('active');
    if (counter) counter.textContent = `${state.currentIndex + 1}/${slides.length}`;
}

function getAvatarEmoji(username) {
    const emojis = ['👤', '🎨', '📸', '🌟', '🎯', '🚀', '💫', '🔥'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return emojis[Math.abs(hash) % emojis.length];
}

async function toggleLike(postId, btn) {
    try {
        const res = await apiFetch(`/api/likes/toggle/${postId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.success) {
            btn.textContent = data.liked ? '❤️' : '🤍';
            btn.classList.toggle('liked', data.liked);
            const likesSpan = document.getElementById(`likes-${postId}`);
            if (likesSpan) {
                likesSpan.textContent = `${data.count} like${data.count !== 1 ? 's' : ''}`;
            }
        }
    } catch (e) {
        console.error('Like error:', e);
        showError('Failed to like post');
    }
}

async function deletePost(postId, btn) {
    if (!confirm('Are you sure you want to delete this post?')) return;

    try {
        const res = await apiFetch(`/api/posts/${postId}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (data.success) {
            btn.closest('.post').remove();
            currentFeed = currentFeed.filter(p => p.id !== postId);
            showNotification('Post deleted');
        } else {
            showError(data.error || 'Failed to delete post');
        }
    } catch (e) {
        console.error('Delete error:', e);
        showError('Failed to delete post');
    }
}

async function loadComments(postId) {
    try {
        const res = await apiFetch(`/api/comments/post/${postId}`);
        const data = await res.json();
        const container = document.getElementById(`comments-${postId}`);

        if (!container) return;

        if (!data.comments || data.comments.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = data.comments.map(c => `
            <div class="comment">
                <strong>${escapeHtml(c.username)}</strong>
                <span>${escapeHtml(c.text)}</span>
                <span class="comment-time">${formatDate(c.created_at)}</span>
            </div>
        `).join('');
    } catch (e) {
        console.error('Load comments error:', e);
    }
}

async function addComment(postId) {
    const input = document.getElementById(`comment-input-${postId}`);
    const text = input?.value.trim();
    if (!text) return;

    try {
        const res = await apiFetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId, text })
        });

        if (res.ok) {
            input.value = '';
            const submitBtn = input.nextElementSibling;
            if (submitBtn) submitBtn.classList.remove('active');
            loadComments(postId);
            loadFeed(); // Refresh to update comment count
        } else {
            const data = await res.json();
            showError(data.error || 'Failed to add comment');
        }
    } catch (e) {
        console.error('Add comment error:', e);
        showError('Failed to add comment');
    }
}

function focusComment(postId) {
    const input = document.getElementById(`comment-input-${postId}`);
    if (input) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
    }
}

async function sharePost(postId) {
    const post = currentFeed.find(p => p.id === postId);
    if (!post) return;

    const shareUrl = `${window.location.origin}/post/${postId}`;
    
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Check out this post',
                text: post.description || 'Amazing post!',
                url: shareUrl
            });
        } catch (e) {
            if (e.name !== 'AbortError') console.error('Share error:', e);
        }
    } else {
        await navigator.clipboard.writeText(shareUrl);
        showNotification('Link copied to clipboard');
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000 / 60);
    
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    if (diff < 10080) return `${Math.floor(diff / 1440)}d ago`;
    
    return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showError(message) {
    console.error(message);
    // Could show a toast notification here
}

function showNotification(message) {
    // Simple notification - could be enhanced with a toast library
    console.log('Notification:', message);
}

// Auth
document.getElementById('loginBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');

    if (!email || !password) {
        errorEl.textContent = 'Please fill in all fields';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const res = await apiFetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.ok) {
            errorEl.style.display = 'none';
            checkAuth();
        } else {
            errorEl.textContent = data.error || 'Login failed';
            errorEl.style.display = 'block';
        }
    } catch (e) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.style.display = 'block';
    }
});

document.getElementById('registerBtn')?.addEventListener('click', async () => {
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const fullname = document.getElementById('regFullname').value.trim();
    const password = document.getElementById('regPassword').value;
    const errorEl = document.getElementById('registerError');

    if (!username || !email || !password) {
        errorEl.textContent = 'Please fill in all required fields';
        errorEl.style.display = 'block';
        return;
    }

    if (username.length < 3 || username.length > 30) {
        errorEl.textContent = 'Username must be 3-30 characters';
        errorEl.style.display = 'block';
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorEl.textContent = 'Please enter a valid email';
        errorEl.style.display = 'block';
        return;
    }

    if (password.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const res = await apiFetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, fullname, password })
        });

        const data = await res.json();

        if (res.ok) {
            errorEl.style.display = 'none';
            checkAuth();
        } else {
            errorEl.textContent = data.error || 'Registration failed';
            errorEl.style.display = 'block';
        }
    } catch (e) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.style.display = 'block';
    }
});

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        currentUser = null;
        selectedMedia = null;
        showAuth();
    } catch (e) {
        console.error('Logout error:', e);
    }
});

document.getElementById('showRegister')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('authForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('registerError').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
});

document.getElementById('showLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('authForm').style.display = 'block';
    document.getElementById('registerError').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
});

// Upload functionality
const uploadBtn = document.getElementById('uploadBtn');
const uploadModal = document.getElementById('uploadModal');
const closeUpload = document.getElementById('closeUpload');
const mediaInput = document.getElementById('mediaInput');
const uploadArea = document.getElementById('uploadArea');
const previewContainer = document.getElementById('previewContainer');
const captionInput = document.getElementById('captionInput');
const charCount = document.getElementById('charCount');
const uploadSubmit = document.getElementById('uploadSubmit');
const uploadError = document.getElementById('uploadError');

// Настройки сжатия изображений на клиенте
const IMAGE_RESIZE_CONFIG = {
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 0.82,          // JPEG качество
    outputType: 'image/jpeg'
};

/**
 * Сжимает изображение через Canvas.
 * @param {File} file — оригинальный файл
 * @returns {Promise<Blob>} — сжатый JPEG
 */
function resizeImage(file) {
    return new Promise((resolve, reject) => {
        // Видео не сжимаем
        if (file.type.startsWith('video/')) return resolve(file);

        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(img.src);

            let { width, height } = img;
            const { maxWidth, maxHeight } = IMAGE_RESIZE_CONFIG;

            // Уменьшаем, если больше максимума
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas toBlob failed'));
                },
                IMAGE_RESIZE_CONFIG.outputType,
                IMAGE_RESIZE_CONFIG.quality
            );
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
    });
}

uploadBtn?.addEventListener('click', () => {
    uploadModal.style.display = 'flex';
    resetUploadForm();
});

closeUpload?.addEventListener('click', () => {
    uploadModal.style.display = 'none';
});

uploadModal?.addEventListener('click', (e) => {
    if (e.target === uploadModal) {
        uploadModal.style.display = 'none';
    }
});

mediaInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
    if (!allowedTypes.includes(file.type)) {
        uploadError.textContent = 'Invalid file type. Please upload an image or video.';
        uploadError.style.display = 'block';
        return;
    }

    // Validate file size (10MB)
    if (file.size > 10485760) {
        uploadError.textContent = 'File is too large. Maximum size is 10MB.';
        uploadError.style.display = 'block';
        return;
    }

    uploadError.style.display = 'none';
    selectedMedia = file;

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        previewContainer.innerHTML = '';
        
        if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = e.target.result;
            video.className = 'preview-media';
            video.controls = true;
            previewContainer.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.className = 'preview-media';
            previewContainer.appendChild(img);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'preview-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = resetUploadForm;
        previewContainer.appendChild(removeBtn);

        previewContainer.style.display = 'flex';
        uploadSubmit.disabled = false;
    };
    reader.readAsDataURL(file);
});

captionInput?.addEventListener('input', () => {
    charCount.textContent = captionInput.value.length;
});

function resetUploadForm() {
    selectedMedia = null;
    mediaInput.value = '';
    previewContainer.innerHTML = '';
    previewContainer.style.display = 'none';
    captionInput.value = '';
    charCount.textContent = '0';
    uploadSubmit.disabled = true;
    uploadError.style.display = 'none';
}

uploadSubmit?.addEventListener('click', async () => {
    if (!selectedMedia) return;

    uploadSubmit.disabled = true;
    uploadSubmit.textContent = 'Processing...';
    uploadError.style.display = 'none';

    try {
        // Сжимаем изображение перед отправкой (только для картинок)
        let uploadFile = selectedMedia;
        const originalSize = selectedMedia.size;

        if (selectedMedia.type.startsWith('image/')) {
            uploadSubmit.textContent = 'Compressing...';
            uploadFile = await resizeImage(selectedMedia);

            const compressedSize = uploadFile.size;
            const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(0);
            console.log(`Image compressed: ${originalSize >> 10}KB → ${compressedSize >> 10}KB (${ratio}% smaller)`);
        }

        uploadSubmit.textContent = 'Publishing...';

        const formData = new FormData();
        const fileName = uploadFile.type.startsWith('image/') ? `upload_${Date.now()}.jpg` : selectedMedia.name;
        formData.append('media', uploadFile, fileName);
        if (captionInput.value.trim()) {
            formData.append('description', captionInput.value.trim());
        }

        const res = await apiFetch('/api/posts', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();

        if (res.ok) {
            uploadModal.style.display = 'none';
            resetUploadForm();
            loadFeed();
            showNotification('Post published successfully!');
        } else {
            uploadError.textContent = data.error || 'Failed to create post';
            uploadError.style.display = 'block';
        }
    } catch (e) {
        uploadError.textContent = 'Network error. Please try again.';
        uploadError.style.display = 'block';
        console.error('Upload error:', e);
    } finally {
        uploadSubmit.disabled = false;
        uploadSubmit.textContent = 'Publish';
    }
});

// Profile functionality
const profileBtn = document.getElementById('profileBtn');
const profileModal = document.getElementById('profileModal');
const closeProfile = document.getElementById('closeProfile');

profileBtn?.addEventListener('click', () => {
    if (!currentUser) return;
    
    document.getElementById('profileUsername').textContent = `@${currentUser.username}`;
    document.getElementById('profileFullname').textContent = currentUser.fullname || '';
    document.getElementById('profileEmail').textContent = currentUser.email;
    document.getElementById('profileAvatar').textContent = getAvatarEmoji(currentUser.username);
    
    // Load user stats (simplified - would need additional API endpoints)
    document.getElementById('postsCount').textContent = currentFeed.filter(p => p.user_id === currentUser.id).length;
    document.getElementById('followersCount').textContent = '0';
    document.getElementById('followingCount').textContent = '0';
    
    profileModal.style.display = 'flex';
});

closeProfile?.addEventListener('click', () => {
    profileModal.style.display = 'none';
});

profileModal?.addEventListener('click', (e) => {
    if (e.target === profileModal) {
        profileModal.style.display = 'none';
    }
});

// Dark theme
const themeToggle = document.getElementById('themeToggle');
themeToggle?.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    themeToggle.textContent = isDark ? '☀️' : '🌙';
});

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
    document.body.classList.add('dark');
    if (themeToggle) themeToggle.textContent = '☀️';
}

// Handle enter key in forms
document.getElementById('password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('loginBtn')?.click();
});

document.getElementById('regPassword')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('registerBtn')?.click();
});

// Initialize
checkAuth();
