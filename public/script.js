let currentUser = null;
let currentFeed = [];
let allTags = [];
let currentFilter = 'all';
let uploadTags = [];

// Video management - pause videos when not visible
let videoObserver = null;
let activeVideos = new Map(); // Track all videos and their visibility

function initVideoManagement() {
    // IntersectionObserver to pause videos when they leave viewport
    videoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
                // Video is visible - can play
                video.muted = false;
                video.dataset.visible = 'true';
            } else {
                // Video is not visible - pause and mute
                video.pause();
                video.muted = true;
                video.dataset.visible = 'false';
            }
        });
    }, {
        threshold: [0, 0.5]
    });
}

// Register a video element for management
function registerVideo(video) {
    if (!videoObserver) initVideoManagement();
    
    video.muted = true; // Start muted
    video.dataset.visible = 'true';
    activeVideos.set(video, true);
    videoObserver.observe(video);
    
    // Also mute on play if not in viewport
    video.addEventListener('play', () => {
        const rect = video.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const isVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
        
        if (!isVisible) {
            video.pause();
        }
    });
}

// Pause all videos except the specified one
function pauseAllVideosExcept(exceptVideo = null) {
    activeVideos.forEach((_, video) => {
        if (video !== exceptVideo) {
            video.pause();
            video.muted = true;
        }
    });
}

// Pause all videos in a specific carousel
function pauseCarouselVideos(carouselId) {
    const carousel = document.getElementById(`carousel-${carouselId}`);
    if (!carousel) return;
    
    const videos = carousel.querySelectorAll('video');
    videos.forEach(video => {
        video.pause();
        video.muted = true;
    });
}

// Play visible video in carousel (unmuted)
function playCarouselVideo(video) {
    pauseAllVideosExcept(video);
    video.muted = false;
    video.play().catch(e => {
        // Autoplay blocked - keep muted
        video.muted = true;
    });
}

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
            currentUser = null;
            showPublicMode();
        }
    } catch (e) {
        currentUser = null;
        showPublicMode();
    }
}

function showAuth() {
    document.getElementById('authForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('feed').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('uploadBtn').style.display = 'none';
    document.getElementById('textPostBtn').style.display = 'none';
    document.getElementById('profileBtn').style.display = 'none';
    document.getElementById('adminBtn').style.display = 'none';
    // Close admin modal if open
    const adminModal = document.getElementById('adminModal');
    if (adminModal) adminModal.style.display = 'none';
}

function showPublicMode() {
    document.getElementById('authForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('feed').style.display = 'block';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('uploadBtn').style.display = 'none';
    document.getElementById('textPostBtn').style.display = 'none';
    document.getElementById('profileBtn').style.display = 'none';
    document.getElementById('adminBtn').style.display = 'none';
    
    // Add public mode banner if not already present
    const feed = document.getElementById('feed');
    let banner = document.getElementById('publicBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'publicBanner';
        banner.className = 'public-banner';
        banner.innerHTML = `
            <div class="public-banner-content">
                <span>👋 Browse public posts</span>
                <button class="public-login-btn" onclick="showAuth()">Sign In</button>
                <button class="public-register-btn" onclick="showRegister()">Sign Up</button>
            </div>
        `;
        feed.parentNode.insertBefore(banner, feed);
    }
    banner.style.display = 'block';
    
    loadFeed();
}

function showRegister() {
    document.getElementById('authForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('feed').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('uploadBtn').style.display = 'none';
    document.getElementById('profileBtn').style.display = 'none';
    document.getElementById('adminBtn').style.display = 'none';
}

function showFeed() {
    document.getElementById('authForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('feed').style.display = 'block';
    document.getElementById('logoutBtn').style.display = 'block';
    document.getElementById('uploadBtn').style.display = 'block';
    document.getElementById('textPostBtn').style.display = 'block';
    document.getElementById('profileBtn').style.display = 'block';
    
    // Hide public mode banner
    const banner = document.getElementById('publicBanner');
    if (banner) banner.style.display = 'none';
    
    // Show admin button if user is admin
    if (currentUser?.role === 'admin') {
        document.getElementById('adminBtn').style.display = 'inline-block';
    }
    
    loadFeed();
}

// Load feed
async function loadFeed() {
    const feed = document.getElementById('feed');
    const filters = document.getElementById('feedFilters');
    if (filters) filters.style.display = 'flex';
    
    feed.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading...</p></div>';

    try {
        const res = await apiFetch(`/api/posts/feed?filter=${encodeURIComponent(currentFilter)}`);
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
    
    // Setup scroll-based video management after render
    setupScrollVideoManagement();
}

function createPostElement(post) {
    const div = document.createElement('div');
    div.className = 'post';
    div.dataset.postId = post.id;

    const mediaCount = post.media ? post.media.length : 0;
    const isLoggedIn = !!currentUser;
    const isOwner = Number(post.user_id) === Number(currentUser?.id);
    const isAdmin = currentUser?.role === 'admin';

    // Определяем тип медиаконтейнера
    let mediaContainer;
    const canDeleteMedia = isOwner || isAdmin;
    if (mediaCount > 1) {
        // Карусель для нескольких медиа
        mediaContainer = `
            <div class="post-media-carousel" id="carousel-${post.id}">
                ${post.media.map((m, i) => `
                    <div class="carousel-slide ${i === 0 ? 'active' : ''}" data-index="${i}" data-media-id="${m.id}">
                        ${m.media_type === 'video'
                            ? `<video src="${m.media_url}" controls preload="metadata" loop playsinline></video>`
                            : `<img src="${m.media_url}" alt="Post" loading="lazy">`}
                        <button class="fullscreen-enter-btn" onclick="openFullscreen(this.closest('.carousel-slide').querySelector('img, video'))" title="Fullscreen">⛶</button>
                        ${canDeleteMedia ? `<button class="delete-media-btn" onclick="deleteMediaFromPost(${post.id}, ${m.id}, '${m.media_type}', this)" title="Delete this ${m.media_type}">🗑️</button>` : ''}
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
        // Одиночное медиа с fullscreen
        const m = post.media[0];
        mediaContainer = `
            <div class="post-media-single" data-post-id="${post.id}">
                ${m.media_type === 'video'
                    ? `<video src="${m.media_url}" controls preload="metadata" loop playsinline></video>`
                    : `<img src="${m.media_url}" alt="Post" loading="lazy">`}
                <button class="fullscreen-btn-inline" onclick="openInlineFullscreen(this.closest('.post-media-single').querySelector('img, video'))" title="Fullscreen">⛶</button>
                ${canDeleteMedia ? `<button class="delete-media-btn single-media" onclick="deleteMediaFromPost(${post.id}, ${m.id}, '${m.media_type}', this)" title="Delete this ${m.media_type}">🗑️</button>` : ''}
            </div>
        `;
    } else {
        mediaContainer = post.description
            ? `<div class="text-post-card">${escapeHtml(post.description)}</div>`
            : `<div class="text-post-card text-post-empty">📝</div>`;
    }

    div.innerHTML = `
        <div class="post-header">
            <div class="post-avatar">${getAvatarEmoji(post.username)}</div>
            <div class="post-header-info">
                <div class="post-header-row">
                    <div class="post-username" onclick="viewProfile(${post.user_id})" style="cursor: pointer;">${escapeHtml(post.username)}</div>
                    ${!isOwner ? `<button class="subscribe-btn ${post.is_subscribed ? 'subscribed' : ''}" onclick="toggleSubscribeUser(${post.user_id}, this)">${post.is_subscribed ? '✓ Subscribed' : '+ Follow'}</button>` : ''}
                </div>
                <div class="post-time">${formatDate(post.created_at)}</div>
            </div>
            ${isOwner ? `<button class="post-menu" onclick="deletePost(${post.id}, this)">🗑️</button>` : ''}
            ${isAdmin && !isOwner ? `<button class="post-menu admin-delete-btn" onclick="adminDeletePost(${post.id}, this)" title="Admin delete">🗑️</button>` : ''}
            <button class="post-menu share-header-btn" onclick="sharePost(${post.id})" title="Share">🔗</button>
        </div>

        ${mediaContainer}

        ${post.tags && post.tags.length > 0 ? `
        <div class="post-tags">
            ${post.tags.map(t => `<span class="post-tag" onclick="filterByTag('${escapeHtml(t.name)}')">#${escapeHtml(t.name)}</span>`).join('')}
        </div>
        ` : ''}

        <div class="post-actions">
            ${isLoggedIn ? `
            <button class="action-btn like-btn ${post.user_liked ? 'liked' : ''}" onclick="toggleLike(${post.id}, this)">${post.user_liked ? '❤️' : '🤍'}</button>
            <button class="action-btn" onclick="focusComment(${post.id})">💬</button>
            <button class="action-btn" onclick="sharePost(${post.id})">📤</button>
            ` : `
            <span class="public-like-count">❤️ ${post.likes_count || 0}</span>
            <button class="action-btn" onclick="showAuth()">💬</button>
            <button class="action-btn" onclick="sharePost(${post.id})">📤</button>
            `}
        </div>

        <div class="post-likes" id="likes-${post.id}">${post.likes_count || 0} likes</div>

        ${post.description && mediaCount > 0 ? `
        <div class="post-caption">
            <strong>${escapeHtml(post.username)}</strong> ${escapeHtml(post.description)}
        </div>
        ` : ''}

        <div class="post-comments" id="comments-${post.id}">
            ${(post.comments && post.comments.length > 0) ? post.comments.map(c => `
                <div class="comment">
                    <strong>${escapeHtml(c.username)}</strong>
                    <span>${escapeHtml(c.text)}</span>
                    <span class="comment-time">${formatDate(c.created_at)}</span>
                </div>
            `).join('') : ''}
        </div>

        ${isLoggedIn ? `
        <div class="comment-form">
            <input type="text" id="comment-input-${post.id}" class="comment-input" placeholder="Add a comment..." maxlength="500">
            <button class="comment-submit" onclick="addComment(${post.id})">Post</button>
        </div>
        ` : ''}
    `;

    if (mediaCount > 1) carouselInit(post.id);
    return div;
}

// Carousel functions
const carouselState = {};

function carouselInit(postId) {
    if (!carouselState[postId]) {
        carouselState[postId] = { currentIndex: 0 };
    }
    
    const carousel = document.getElementById(`carousel-${postId}`);
    if (!carousel) return;

    // Register videos
    carousel.querySelectorAll('video').forEach(video => registerVideo(video));

    // Disable native drag on images
    carousel.querySelectorAll('img').forEach(img => {
        img.draggable = false;
        img.addEventListener('dragstart', e => e.preventDefault());
    });

    // Setup double-tap on each slide (more reliable than on individual elements)
    carousel.querySelectorAll('.carousel-slide').forEach(slide => {
        setupDoubleTapOnSlide(slide, carousel.id);
    });

    // Touch swipe on mobile
    setupCarouselSwipe(carousel, postId);
}

function setupCarouselSwipe(carousel, postId) {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let swiping = false;

    carousel.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
        swiping = false;
    }, { passive: true });

    carousel.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1) return; // ignore pinch
        const touch = e.touches[0];
        const diffX = touch.clientX - touchStartX;
        const diffY = touch.clientY - touchStartY;

        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
            swiping = true;
        }
    }, { passive: true });

    carousel.addEventListener('touchend', (e) => {
        if (!swiping) return;
        const diffX = e.changedTouches[0].clientX - touchStartX;
        const elapsed = Date.now() - touchStartTime;

        if (Math.abs(diffX) > 50 || (Math.abs(diffX) > 20 && elapsed < 300)) {
            if (diffX > 0) carouselPrev(postId);
            else carouselNext(postId);
        }
        swiping = false;
    }, { passive: true });
}

// Double-tap tracking per slide (key: carouselId-slideIndex)
const slideTapCounters = new Map();
let fullscreenOverlay = null;

function setupDoubleTapOnSlide(slide, carouselId) {
    const key = `${carouselId}-${slide.dataset.index}`;
    slideTapCounters.set(key, { count: 0, timer: null });

    slide.addEventListener('touchend', (e) => {
        // Ignore if tapping the fullscreen button
        if (e.target.classList.contains('fullscreen-enter-btn')) return;
        
        const media = slide.querySelector('img, video');
        if (!media) return;

        const data = slideTapCounters.get(key);
        data.count++;
        
        if (data.count === 1) {
            data.timer = setTimeout(() => {
                data.count = 0;
            }, 350);
        } else if (data.count === 2) {
            clearTimeout(data.timer);
            data.count = 0;
            toggleFullscreen(media);
        }
    }, { passive: true });

    // Desktop double-click
    slide.addEventListener('dblclick', (e) => {
        if (e.target.classList.contains('fullscreen-enter-btn')) return;
        const media = slide.querySelector('img, video');
        if (media) {
            e.preventDefault();
            toggleFullscreen(media);
        }
    });
}

function toggleFullscreen(mediaElement) {
    if (!mediaElement) return;

    const singleContainer = mediaElement.closest('.post-media-single');
    const isSingleMedia = !!singleContainer;
    const slide = mediaElement.closest('.carousel-slide');
    const carousel = mediaElement.closest('.post-media-carousel');
    const allSlides = carousel ? Array.from(carousel.querySelectorAll('.carousel-slide')) : [];
    const currentSlideIndex = slide ? allSlides.indexOf(slide) : -1;
    const hasMultipleSlides = allSlides.length > 1;
    const allMediaItems = isSingleMedia ? [mediaElement] : allSlides;

    if (fullscreenOverlay) {
        const video = fullscreenOverlay.querySelector('video');
        if (video) video.pause();
        fullscreenOverlay.remove();
        fullscreenOverlay = null;
        document.removeEventListener('keydown', handleKey);
        document.removeEventListener('wheel', handleWheel, { capture: true });
        return;
    }

    let currentFullscreenIndex = isSingleMedia ? 0 : (currentSlideIndex >= 0 ? currentSlideIndex : 0);
    let zoomState = { scale: 1, x: 0, y: 0 };

    function resetZoom() {
        zoomState = { scale: 1, x: 0, y: 0 };
        applyZoom();
    }

    function applyZoom() {
        const img = mediaContainer.querySelector('img');
        if (!img) return;
        const { scale, x, y } = zoomState;
        img.style.transform = scale > 1 ? `translate(${x}px, ${y}px) scale(${scale})` : '';
        img.style.cursor = scale > 1 ? 'grab' : '';
    }

    fullscreenOverlay = document.createElement('div');
    fullscreenOverlay.className = 'carousel-fullscreen-overlay';
    fullscreenOverlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.95);
        z-index: 10000;
        -webkit-tap-highlight-color: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    `;

    const mediaContainer = document.createElement('div');
    mediaContainer.style.cssText = `
        width: 100vw; height: 100vh;
        display: flex; align-items: center; justify-content: center;
        position: relative;
        transition: opacity 0.2s ease;
    `;

    function showSlide(index) {
        mediaContainer.style.opacity = '0';
        resetZoom();

        setTimeout(() => {
            mediaContainer.innerHTML = '';

            let origMedia;
            if (isSingleMedia) {
                origMedia = mediaElement;
            } else {
                const s = allSlides[index];
                if (!s) return;
                origMedia = s.querySelector('img, video');
            }

            if (origMedia) {
                const clone = origMedia.cloneNode(true);
                clone.style.cssText = `
                    max-width: 100vw;
                    max-height: 100vh;
                    object-fit: contain;
                    user-select: none;
                    -webkit-user-drag: none;
                    transition: transform 0.2s ease;
                `;

                if (clone.tagName === 'VIDEO') {
                    clone.controls = true;
                    clone.autoplay = true;
                }

                if (clone.tagName === 'IMG') {
                    setupPinchZoom(clone);
                }

                mediaContainer.appendChild(clone);
            }

            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '⛶';
            closeBtn.style.cssText = `
                position: absolute; bottom: 20px; right: 20px;
                width: 40px; height: 40px; border-radius: 8px;
                background: rgba(0,0,0,0.6); color: white; border: none;
                font-size: 20px; cursor: pointer; display: flex;
                align-items: center; justify-content: center;
                z-index: 10002; -webkit-tap-highlight-color: transparent;
                line-height: 1;
            `;
            closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeFullscreen(); });
            mediaContainer.appendChild(closeBtn);

            if (hasMultipleSlides) {
                const counter = document.createElement('span');
                counter.style.cssText = `
                    position: absolute; top: 20px; right: 20px;
                    background: rgba(0,0,0,0.6); color: white;
                    font-size: 13px; font-weight: 600;
                    padding: 6px 12px; border-radius: 14px;
                    z-index: 10002; pointer-events: none; user-select: none;
                `;
                counter.textContent = `${index + 1}/${allSlides.length}`;
                mediaContainer.appendChild(counter);
            }

            mediaContainer.style.opacity = '1';
        }, 150);
    }

    function setupPinchZoom(img) {
        let lastTouchEnd = 0;
        let pinchState = null;
        let panState = null;

        img.addEventListener('touchstart', (e) => {
            const now = Date.now();
            if (now - lastTouchEnd < 350) {
                e.preventDefault();
                if (zoomState.scale > 1) {
                    resetZoom();
                } else {
                    zoomState.scale = 3;
                    zoomState.x = 0;
                    zoomState.y = 0;
                    applyZoom();
                }
                return;
            }
            lastTouchEnd = now;

            if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchState = {
                    dist: Math.sqrt(dx * dx + dy * dy),
                    scale: zoomState.scale,
                    cx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    cy: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
            } else if (e.touches.length === 1 && zoomState.scale > 1) {
                e.preventDefault();
                panState = {
                    x: e.touches[0].clientX - zoomState.x,
                    y: e.touches[0].clientY - zoomState.y
                };
            }
        }, { passive: false });

        img.addEventListener('touchmove', (e) => {
            if (pinchState && e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                let newScale = pinchState.scale * (dist / pinchState.dist);
                newScale = Math.max(1, Math.min(10, newScale));
                zoomState.scale = newScale;
                if (newScale <= 1) resetZoom();
                else applyZoom();
            } else if (panState && e.touches.length === 1 && zoomState.scale > 1) {
                e.preventDefault();
                zoomState.x = e.touches[0].clientX - panState.x;
                zoomState.y = e.touches[0].clientY - panState.y;
                applyZoom();
            }
        }, { passive: false });

        img.addEventListener('touchend', (e) => {
            pinchState = null;
            panState = null;
        }, { passive: true });

        // Wheel zoom for desktop
        img.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            let newScale = zoomState.scale * delta;
            newScale = Math.max(1, Math.min(10, newScale));
            zoomState.scale = newScale;
            if (newScale <= 1) resetZoom();
            else applyZoom();
        }, { passive: false });
    }

    showSlide(currentFullscreenIndex);

    const goNext = () => {
        if (!hasMultipleSlides || isSingleMedia) return;
        if (currentFullscreenIndex >= allSlides.length - 1) return;
        currentFullscreenIndex++;
        showSlide(currentFullscreenIndex);
    };

    const goPrev = () => {
        if (!hasMultipleSlides || isSingleMedia) return;
        if (currentFullscreenIndex <= 0) return;
        currentFullscreenIndex--;
        showSlide(currentFullscreenIndex);
    };

    let closeFullscreen;
    const handleKey = (e) => {
        if (e.key === 'ArrowRight') goNext();
        else if (e.key === 'ArrowLeft') goPrev();
        else if (e.key === 'Escape') closeFullscreen();
    };

    let wheelTimeout = null;
    const handleWheel = (e) => {
        if (!hasMultipleSlides || isSingleMedia) return;
        e.preventDefault();
        if (wheelTimeout) return;
        wheelTimeout = setTimeout(() => { wheelTimeout = null; }, 400);
        if (e.deltaY > 0 || e.deltaX > 0) goNext();
        else goPrev();
    };

    closeFullscreen = () => {
        const video = fullscreenOverlay?.querySelector('video');
        if (video) video.pause();
        fullscreenOverlay?.remove();
        fullscreenOverlay = null;
        document.removeEventListener('keydown', handleKey);
        document.removeEventListener('wheel', handleWheel, { capture: true });
    };

    document.addEventListener('keydown', handleKey);
    if (hasMultipleSlides && !isSingleMedia) {
        document.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    }

    if (hasMultipleSlides && !isSingleMedia) {
        let touchStartX = 0, touchStartY = 0, isSwiping = false;
        fullscreenOverlay.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isSwiping = false;
        }, { passive: true });

        fullscreenOverlay.addEventListener('touchmove', (e) => {
            if (e.touches.length > 1) return;
            const diffX = Math.abs(e.touches[0].clientX - touchStartX);
            const diffY = Math.abs(e.touches[0].clientY - touchStartY);
            if (diffX > diffY && diffX > 30) isSwiping = true;
        }, { passive: true });

        fullscreenOverlay.addEventListener('touchend', (e) => {
            if (!isSwiping) return;
            const diffX = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(diffX) > 60) {
                if (diffX > 0) goPrev();
                else goNext();
            }
            isSwiping = false;
        }, { passive: true });
    }

    fullscreenOverlay.appendChild(mediaContainer);
    document.body.appendChild(fullscreenOverlay);

    fullscreenOverlay.addEventListener('click', (e) => {
        if (e.target === fullscreenOverlay || e.target === mediaContainer) {
            closeFullscreen();
        }
    });
}

// Public function for HTML onclick (carousel)
function openFullscreen(mediaElement) {
    toggleFullscreen(mediaElement);
}

// Public function for single media inline
function openInlineFullscreen(mediaElement) {
    toggleFullscreen(mediaElement);
}

function carouselPrev(postId) {
    const state = carouselState[postId];
    if (!state) return;

    const carousel = document.getElementById(`carousel-${postId}`);
    if (!carousel) return;
    
    const slides = carousel.querySelectorAll('.carousel-slide');
    const dots = carousel.querySelectorAll('.dot');
    const counter = carousel.querySelector('.carousel-counter');

    // Pause video in current slide
    const currentVideo = slides[state.currentIndex]?.querySelector('video');
    if (currentVideo) {
        currentVideo.pause();
        currentVideo.muted = true;
    }

    // Deactivate current slide
    slides[state.currentIndex].classList.remove('active');
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.remove('active');

    // Activate new slide
    state.currentIndex = (state.currentIndex - 1 + slides.length) % slides.length;
    slides[state.currentIndex].classList.add('active');
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.add('active');
    if (counter) counter.textContent = `${state.currentIndex + 1}/${slides.length}`;

    // Register video in new slide
    const newVideo = slides[state.currentIndex]?.querySelector('video');
    if (newVideo) {
        registerVideo(newVideo);
    }
}

function carouselNext(postId) {
    const state = carouselState[postId];
    if (!state) return;

    const carousel = document.getElementById(`carousel-${postId}`);
    if (!carousel) return;
    
    const slides = carousel.querySelectorAll('.carousel-slide');
    const dots = carousel.querySelectorAll('.dot');
    const counter = carousel.querySelector('.carousel-counter');

    // Pause video in current slide
    const currentVideo = slides[state.currentIndex]?.querySelector('video');
    if (currentVideo) {
        currentVideo.pause();
        currentVideo.muted = true;
    }

    // Deactivate current slide
    slides[state.currentIndex].classList.remove('active');
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.remove('active');

    // Activate new slide
    state.currentIndex = (state.currentIndex + 1) % slides.length;
    slides[state.currentIndex].classList.add('active');
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.add('active');
    if (counter) counter.textContent = `${state.currentIndex + 1}/${slides.length}`;

    // Register video in new slide
    const newVideo = slides[state.currentIndex]?.querySelector('video');
    if (newVideo) {
        registerVideo(newVideo);
    }
}

function carouselGoTo(postId, index) {
    const state = carouselState[postId];
    if (!state) return;

    const carousel = document.getElementById(`carousel-${postId}`);
    if (!carousel) return;
    
    const slides = carousel.querySelectorAll('.carousel-slide');
    const dots = carousel.querySelectorAll('.dot');
    const counter = carousel.querySelector('.carousel-counter');

    // Pause video in current slide
    const currentVideo = slides[state.currentIndex]?.querySelector('video');
    if (currentVideo) {
        currentVideo.pause();
        currentVideo.muted = true;
    }

    // Deactivate current slide
    slides[state.currentIndex].classList.remove('active');
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.remove('active');

    // Activate target slide
    state.currentIndex = index;
    slides[state.currentIndex].classList.add('active');
    if (dots[state.currentIndex]) dots[state.currentIndex].classList.add('active');
    if (counter) counter.textContent = `${state.currentIndex + 1}/${slides.length}`;

    // Register video in new slide
    const newVideo = slides[state.currentIndex]?.querySelector('video');
    if (newVideo) {
        registerVideo(newVideo);
    }
}

function getAvatarEmoji(username) {
    const emojis = ['👤', '🎨', '📸', '🌟', '🎯', '🚀', '💫', '🔥'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return emojis[Math.abs(hash) % emojis.length];
}

// Setup scroll-based video management
let scrollVideoObserver = null;

function setupScrollVideoManagement() {
    if (!scrollVideoObserver) {
        scrollVideoObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const postEl = entry.target;
                const postId = postEl.dataset.postId;
                if (!postId) return;
                
                if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
                    // Post is visible - allow videos to play
                    postEl.dataset.visible = 'true';
                } else {
                    // Post is not visible - pause all videos
                    postEl.dataset.visible = 'false';
                    pauseCarouselVideos(postId);
                }
            });
        }, {
            threshold: [0, 0.6]
        });
    }
    
    // Observe all post elements
    const posts = document.querySelectorAll('.post');
    posts.forEach(post => {
        if (post.dataset.postId) {
            scrollVideoObserver.observe(post);
        }
    });
}

// Handle scroll events to pause videos outside viewport
let scrollTimeout = null;
window.addEventListener('scroll', () => {
    if (scrollTimeout) return;
    
    scrollTimeout = setTimeout(() => {
        scrollTimeout = null;
        
        const viewportTop = window.scrollY;
        const viewportBottom = viewportTop + window.innerHeight;
        
        // Check all videos
        activeVideos.forEach((_, video) => {
            const rect = video.getBoundingClientRect();
            const videoTop = rect.top + viewportTop;
            const videoBottom = videoTop + rect.height;
            
            // Check if video is mostly in viewport
            const isVisible = videoBottom > viewportTop && videoTop < viewportBottom;
            
            if (!isVisible) {
                video.pause();
                video.muted = true;
            }
        });
    }, 100);
}, { passive: true });

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

// Admin delete any post
async function adminDeletePost(postId, btn) {
    if (!confirm('⚠️ Admin delete: Are you sure you want to delete this post? This cannot be undone.')) return;

    try {
        const res = await apiFetch(`/api/admin/posts/${postId}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (data.success) {
            btn.closest('.post').remove();
            currentFeed = currentFeed.filter(p => p.id !== postId);
            showNotification('Post deleted by admin');
        } else {
            showError(data.error || 'Failed to delete post');
        }
    } catch (e) {
        console.error('Admin delete error:', e);
        showError('Failed to delete post');
    }
}

// Delete single media from a post (owner or admin only)
async function deleteMediaFromPost(postId, mediaId, mediaType, btn) {
    const confirmMsg = mediaType === 'video'
        ? 'Delete this video from the post?'
        : 'Delete this photo from the post?';
    
    if (!confirm(confirmMsg)) return;

    try {
        // Determine endpoint based on whether user is owner or admin
        const post = currentFeed.find(p => p.id === postId);
        const isOwner = Number(post?.user_id) === Number(currentUser?.id);
        const isAdmin = currentUser?.role === 'admin';
        
        if (!isOwner && !isAdmin) {
            showError('You can only delete media from your own posts');
            return;
        }

        const endpoint = isAdmin ? `/api/admin/media/${mediaId}` : `/api/posts/media/${mediaId}`;
        
        const res = await apiFetch(endpoint, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (data.success) {
            // Remove the slide from carousel
            const slide = btn.closest('.carousel-slide, .post-media-single');
            const carousel = btn.closest('.post-media-carousel, .post-media-single');
            
            if (carousel) {
                const allSlides = carousel.querySelectorAll('.carousel-slide');
                
                if (allSlides.length <= 1) {
                    // Last media deleted - reload feed to update UI
                    showNotification('Media deleted');
                    // Update the post in currentFeed
                    if (post) {
                        post.media = [];
                    }
                    // Simple approach: remove and re-render single post
                    slide.closest('.post')?.remove();
                    // Reload just this post's data would be ideal, but for now show notification
                } else {
                    // More slides remain - just remove this one
                    slide.remove();
                    
                    // Update counter
                    const remainingSlides = carousel.querySelectorAll('.carousel-slide');
                    const counter = carousel.querySelector('.carousel-counter');
                    if (counter) {
                        const currentIndex = Math.min(
                            Array.from(allSlides).indexOf(slide),
                            remainingSlides.length - 1
                        );
                        counter.textContent = `${currentIndex + 1}/${remainingSlides.length}`;
                        
                        // Update dots
                        const dotsContainer = carousel.querySelector('.carousel-dots');
                        if (dotsContainer) {
                            dotsContainer.innerHTML = Array.from(remainingSlides).map((_, i) => 
                                `<span class="dot ${i === 0 ? 'active' : ''}" onclick="carouselGoTo(${postId}, ${i})"></span>`
                            ).join('');
                        }
                        
                        // Activate first slide if current was removed
                        if (remainingSlides.length > 0) {
                            remainingSlides.forEach((s, i) => {
                                s.classList.toggle('active', i === 0);
                            });
                        }
                    }
                    
                    // Update media array in currentFeed
                    if (post && post.media) {
                        post.media = post.media.filter(m => m.id !== mediaId);
                    }
                    
                    showNotification(`${mediaType === 'video' ? 'Video' : 'Photo'} deleted`);
                }
            }
        } else {
            showError(data.error || 'Failed to delete media');
        }
    } catch (e) {
        console.error('Delete media error:', e);
        showError('Failed to delete media');
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
            
            // Just reload comments for this post - no full feed refresh
            loadComments(postId);
            
            // Update comment count badge without full reload
            updateCommentCountBadge(postId);
        } else {
            const data = await res.json();
            showError(data.error || 'Failed to add comment');
        }
    } catch (e) {
        console.error('Add comment error:', e);
        showError('Failed to add comment');
    }
}

// Update comment count badge without full feed reload
async function updateCommentCountBadge(postId) {
    try {
        const res = await apiFetch(`/api/comments/post/${postId}`);
        if (!res.ok) return;
        const data = await res.json();
        const countEl = document.getElementById(`comment-count-${postId}`);
        if (countEl) {
            countEl.textContent = data.comments.length;
        }
    } catch (e) {
        // Ignore errors - badge update is non-critical
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
    if (!dateString) return '';
    
    let date;
    try {
        // If already has timezone info, parse as-is
        if (dateString.includes('T') && (dateString.includes('Z') || dateString.includes('+') || dateString.includes('-', 10))) {
            date = new Date(dateString);
        } else {
            // SQLite format without timezone — treat as UTC
            date = new Date(dateString + 'Z');
        }
        
        if (isNaN(date.getTime())) {
            console.warn('Invalid date:', dateString);
            return '';
        }
    } catch (e) {
        console.warn('Date parse error:', dateString);
        return '';
    }
    
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

// === Tags & Subscriptions ===

async function loadTags() {
    try {
        const res = await apiFetch('/api/tags');
        if (!res.ok) return;
        const data = await res.json();
        allTags = data.tags || [];
        renderTagCloud();
    } catch (e) {
        console.error('Load tags error:', e);
    }
}

function renderTagCloud() {
    const cloud = document.getElementById('tagCloud');
    if (!cloud || allTags.length === 0) {
        if (cloud) cloud.style.display = 'none';
        return;
    }
    cloud.style.display = 'flex';
    cloud.innerHTML = allTags.slice(0, 30).map(t => `
        <div class="tag-cloud-item" onclick="filterByTag('${escapeHtml(t.name)}')">
            #${escapeHtml(t.name)}
            <span class="tag-subscribe ${t.user_subscribed ? 'subscribed' : ''}" 
                  onclick="event.stopPropagation(); toggleSubscribeTag(${t.id}, this)">
                ${t.user_subscribed ? '🔔' : '○'}
            </span>
        </div>
    `).join('');
}

async function toggleSubscribeUser(userId, btn) {
    try {
        const res = await apiFetch(`/api/tags/subscribe/user/${userId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            btn.classList.toggle('subscribed', data.subscribed);
            btn.textContent = data.subscribed ? '✓ Subscribed' : '+ Follow';
        }
    } catch (e) {
        console.error('Subscribe error:', e);
    }
}

async function toggleSubscribeTag(tagId, el) {
    try {
        const res = await apiFetch(`/api/tags/subscribe/tag/${tagId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            el.classList.toggle('subscribed', data.subscribed);
            el.innerHTML = data.subscribed ? '🔔' : '○';
            // Reload tags to update cloud
            loadTags();
        }
    } catch (e) {
        console.error('Subscribe tag error:', e);
    }
}

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filter);
    });
    // Deselect tag filter buttons
    document.querySelectorAll('.filter-tag-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tag === filter);
    });
    loadFeed();
}

function filterByTag(tagName) {
    currentFilter = `tag:${tagName}`;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.filter-tag-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tag === `tag:${tagName}`);
    });
    loadFeed();
}

// Logo click — reset to the very beginning of the feed
document.getElementById('logoLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    const onSinglePost = getPostIdFromUrl() !== null;
    // Reset URL from /post/:id to /
    if (onSinglePost) {
        history.pushState({}, '', '/');
        // Restore the normal feed loader overridden by the single-post view
        loadFeed = originalLoadFeed;
    }
    // Reset filter to All
    if (currentFilter !== 'all') {
        setFilter('all');
    } else {
        loadFeed();
    }
    document.title = 'Cosmogram';
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// === Tags & Subscriptions (loadFeed is defined below) ===

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
const uploadDropzone = document.getElementById('uploadDropzone');
const uploadLabel = document.getElementById('uploadLabel');
const previewGrid = document.getElementById('previewGrid');
const captionInput = document.getElementById('captionInput');
const charCount = document.getElementById('charCount');
const fileCountEl = document.getElementById('fileCount');
const uploadSubmit = document.getElementById('uploadSubmit');
const uploadError = document.getElementById('uploadError');
const uploadWarning = document.getElementById('uploadWarning');
const uploadProgress = document.getElementById('uploadProgress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

const MAX_FILES = 10;
let selectedFiles = []; // Array of { file, previewUrl, compressed }

// Настройки сжатия изображений на клиенте
const IMAGE_RESIZE_CONFIG = {
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 0.82,
    outputType: 'image/jpeg'
};

// Настройки сжатия видео на клиенте
const VIDEO_COMPRESS_CONFIG = {
    maxWidth: 854,
    maxHeight: 480,
    bitrate: 800000,
    fps: 24,
    sizeThreshold: 5 * 1024 * 1024 // 5MB — видео больше этого будут сжаты
};

/**
 * Сжимает видео через Canvas + MediaRecorder.
 * Уменьшает разрешение, битрейт и FPS.
 * Аудио не сохраняется (типично для коротких видео).
 * @param {File} file — оригинальный видеофайл
 * @returns {Promise<Blob>} — сжатый WebM
 */
function compressVideo(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('video/')) return resolve(file);

        // Если видео меньше порога — не сжимаем
        // if (file.size <= VIDEO_COMPRESS_CONFIG.sizeThreshold) return resolve(file);

        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.crossOrigin = 'anonymous';

        const url = URL.createObjectURL(file);
        video.src = url;

        let aborted = false;
        const timeout = setTimeout(() => {
            aborted = true;
            cleanup();
            reject(new Error('Video compression timeout'));
        }, 600000); // 10 min max — для больших файлов

        function cleanup() {
            clearTimeout(timeout);
            video.removeAttribute('src');
            video.load();
            URL.revokeObjectURL(url);
        }

        video.onloadedmetadata = () => {
            if (aborted) return;

            // Расчет новых размеров
            let width = video.videoWidth;
            let height = video.videoHeight;
            const maxW = VIDEO_COMPRESS_CONFIG.maxWidth;
            const maxH = VIDEO_COMPRESS_CONFIG.maxHeight;

            if (width > maxW || height > maxH) {
                const ratio = Math.min(maxW / width, maxH / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            // Убедимся что чётные (требование для видео)
            if (width % 2 !== 0) width++;
            if (height % 2 !== 0) height++;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            const fps = VIDEO_COMPRESS_CONFIG.fps;
            let mediaRecorder = null;
            let recordedChunks = [];

            try {
                const stream = canvas.captureStream(fps);
                const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                    ? 'video/webm;codecs=vp9'
                    : 'video/webm';
                if (!MediaRecorder.isTypeSupported(mimeType)) {
                    cleanup();
                    return resolve(file);
                }
                mediaRecorder = new MediaRecorder(stream, {
                    mimeType,
                    videoBitsPerSecond: VIDEO_COMPRESS_CONFIG.bitrate
                });
            } catch (e) {
                cleanup();
                return resolve(file);
            }

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                cleanup();
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                if (blob.size > 0) {
                    resolve(blob);
                } else {
                    reject(new Error('Compressed video is empty'));
                }
            };

            mediaRecorder.onerror = () => {
                cleanup();
                reject(new Error('MediaRecorder error during compression'));
            };

            mediaRecorder.start(1000 / fps);

            video.play().catch(() => {
                mediaRecorder.stop();
                cleanup();
                reject(new Error('Video playback failed'));
            });

            let lastTime = 0;

            function drawFrame() {
                if (aborted || video.ended || video.paused) {
                    if (mediaRecorder && mediaRecorder.state === 'recording') {
                        mediaRecorder.stop();
                    }
                    return;
                }

                // Пропускаем кадры для соблюдения целевого FPS
                const elapsed = video.currentTime - lastTime;
                if (elapsed >= 1 / fps) {
                    ctx.drawImage(video, 0, 0, width, height);
                    lastTime = video.currentTime;
                }

                requestAnimationFrame(drawFrame);
            }

            video.onended = () => {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    // Дорисовываем последний кадр
                    ctx.drawImage(video, 0, 0, width, height);
                    setTimeout(() => {
                        if (mediaRecorder && mediaRecorder.state === 'recording') {
                            mediaRecorder.stop();
                        }
                    }, 200);
                }
            };

            video.onerror = () => {
                cleanup();
                reject(new Error('Failed to load video for compression'));
            };

            drawFrame();
        };

        video.onerror = () => {
            cleanup();
            resolve(file);
        };
    });
}

/**
 * Сжимает изображение через Canvas.
 * @param {File} file — оригинальный файл
 * @returns {Promise<Blob>} — сжатый JPEG
 */
function resizeImage(file) {
    return new Promise((resolve, reject) => {
        if (file.type.startsWith('video/')) return resolve(file);

        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {

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
            img.onerror = () => reject(new Error('Failed to load image for compression'));
            img.src = reader.result; // data: URL — всегда разрешено в CSP
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

uploadBtn?.addEventListener('click', () => {
    uploadModal.dataset.mode = 'media';
    document.getElementById('uploadArea').style.display = 'block';
    document.querySelector('.file-counter').style.display = 'flex';
    document.querySelector('.upload-footer .visibility-toggle').style.display = 'flex';
    document.querySelector('.modal-header h2').textContent = 'Create New Post';
    uploadModal.style.display = 'flex';
    resetUploadForm();
});

const textPostBtn = document.getElementById('textPostBtn');
textPostBtn?.addEventListener('click', () => {
    uploadModal.dataset.mode = 'text';
    document.getElementById('uploadArea').style.display = 'none';
    document.querySelector('.file-counter').style.display = 'none';
    document.querySelector('.upload-footer .visibility-toggle').style.display = 'flex';
    document.querySelector('.modal-header h2').textContent = '✍️ New Text Post';
    uploadModal.style.display = 'flex';
    resetUploadForm();
    captionInput.focus();
    uploadSubmit.disabled = true;
});

closeUpload?.addEventListener('click', () => {
    uploadModal.style.display = 'none';
    document.querySelector('.modal-header h2').textContent = 'Create New Post';
});

uploadModal?.addEventListener('click', (e) => {
    if (e.target === uploadModal) {
        uploadModal.style.display = 'none';
        document.querySelector('.modal-header h2').textContent = 'Create New Post';
    }
});

// Drag and drop
uploadDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadDropzone.classList.add('drag-over');
});

uploadDropzone?.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadDropzone.classList.remove('drag-over');
});

uploadDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDropzone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    handleFilesSelect(files);
});

mediaInput?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    handleFilesSelect(files);
    // Reset input so same files can be re-selected
    mediaInput.value = '';
});

/**
 * Converts a File to data: URL (CSP-safe alternative to blob: URLs)
 */
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

function handleFilesSelect(files) {
    handleFilesSelectAsync(files).catch(e => console.error('handleFilesSelect error:', e));
}

async function handleFilesSelectAsync(files) {
    uploadError.style.display = 'none';

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];

    for (const file of files) {
        if (selectedFiles.length >= MAX_FILES) {
            uploadError.textContent = `Maximum ${MAX_FILES} files per post.`;
            uploadError.style.display = 'block';
            break;
        }

        if (!allowedTypes.includes(file.type)) {
            uploadError.textContent = `Invalid file type: ${file.name}. Please upload JPEG, PNG, WebP, GIF, MP4, or WebM.`;
            uploadError.style.display = 'block';
            continue;
        }

        // Create preview URL using FileReader → data: URL (CSP-safe)
        const previewUrl = await fileToDataUrl(file);
        selectedFiles.push({ file, previewUrl, compressed: null });
    }

    renderPreviewGrid();
    updateFileCounter();
    updateWarning();
}

function renderPreviewGrid() {
    previewGrid.innerHTML = '';

    if (selectedFiles.length === 0) {
        previewGrid.style.display = 'none';
        uploadLabel.style.display = 'flex';
        uploadSubmit.disabled = true;
        return;
    }

    previewGrid.style.display = 'grid';
    uploadLabel.style.display = selectedFiles.length < MAX_FILES ? 'flex' : 'none';

    selectedFiles.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'preview-grid-item';

        if (item.file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = item.previewUrl;
            video.muted = true;
            video.preload = 'metadata';
            div.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = item.previewUrl;
            img.loading = 'lazy';
            div.appendChild(img);
        }

        // File index badge
        const indexBadge = document.createElement('span');
        indexBadge.className = 'file-index';
        indexBadge.textContent = index + 1;
        div.appendChild(indexBadge);

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.className = 'preview-remove';
        removeBtn.onclick = () => {
            URL.revokeObjectURL(item.previewUrl);
            selectedFiles.splice(index, 1);
            renderPreviewGrid();
            updateFileCounter();
            updateWarning();
        };
        div.appendChild(removeBtn);

        previewGrid.appendChild(div);
    });

    uploadSubmit.disabled = false;
}

function updateFileCounter() {
    fileCountEl.textContent = selectedFiles.length;
}

function updateWarning() {
    const imageCount = selectedFiles.filter(f => f.file.type.startsWith('image/')).length;

    if (imageCount > 3) {
        uploadWarning.textContent = `⏱️ ${imageCount} images will be compressed. This may take a moment…`;
        uploadWarning.style.display = 'block';
    } else if (selectedFiles.length > 5) {
        uploadWarning.textContent = `⏱️ ${selectedFiles.length} files — upload may take a moment.`;
        uploadWarning.style.display = 'block';
    } else {
        uploadWarning.style.display = 'none';
    }
}

captionInput?.addEventListener('input', () => {
    charCount.textContent = captionInput.value.length;
    const hasText = captionInput.value.trim().length > 0;
    if (selectedFiles.length === 0) {
        uploadSubmit.disabled = !hasText;
    }
});

function resetUploadForm() {
    // Revoke old preview URLs
    selectedFiles.forEach(f => URL.revokeObjectURL(f.previewUrl));
    selectedFiles = [];
    mediaInput.value = '';
    previewGrid.innerHTML = '';
    previewGrid.style.display = 'none';
    uploadLabel.style.display = 'flex';
    captionInput.value = '';
    charCount.textContent = '0';
    fileCountEl.textContent = '0';
    uploadSubmit.disabled = true;
    uploadSubmit.style.display = 'block';
    uploadError.style.display = 'none';
    uploadWarning.style.display = 'none';
    uploadProgress.style.display = 'none';
    progressFill.style.width = '0%';
    // Reset tags
    uploadTags = [];
    if (tagInput) tagInput.value = '';
    const selTags = document.getElementById('selectedTags');
    if (selTags) selTags.innerHTML = '';
}

uploadSubmit?.addEventListener('click', async () => {
    if (selectedFiles.length === 0 && !captionInput.value.trim()) {
        uploadError.textContent = 'Add a caption or select media to create a post.';
        uploadError.style.display = 'block';
        return;
    }

    uploadSubmit.disabled = true;
    uploadSubmit.style.display = 'none';
    uploadProgress.style.display = 'flex';
    uploadError.style.display = 'none';
    uploadWarning.style.display = 'none';

    try {
        const formData = new FormData();
        if (captionInput.value.trim()) {
            formData.append('description', captionInput.value.trim());
        }
        const isPublicCheckbox = document.getElementById('isPublicToggle');
        formData.append('is_public', isPublicCheckbox ? isPublicCheckbox.checked : true);
        if (uploadTags.length > 0) {
            formData.append('tags', JSON.stringify(uploadTags));
        }

        const totalFiles = selectedFiles.length;
        let processedFiles = 0;

        // Compress images one by one with progress
        for (const item of selectedFiles) {
            processedFiles++;
            const percent = Math.round((processedFiles / totalFiles) * 50); // first 50% = compression
            progressFill.style.width = `${percent}%`;
            progressText.textContent = `Compressing ${processedFiles}/${totalFiles}…`;

            if (item.file.type.startsWith('image/')) {
                const compressed = await resizeImage(item.file);
                item.compressed = compressed;
                const fileName = `upload_${Date.now()}_${processedFiles}.jpg`;
                formData.append('media', compressed, fileName);
            } else {
                progressText.textContent = `Compressing video ${processedFiles}/${totalFiles}…`;
                const compressed = await compressVideo(item.file);
                const ext = compressed === item.file ? item.file.name.split('.').pop() : 'webm';
                const fileName = `upload_${Date.now()}_${processedFiles}.${ext}`;
                formData.append('media', compressed, fileName);
            }
        }

        // Upload phase — second 50% of progress
        progressFill.style.width = '60%';
        progressText.textContent = 'Uploading…';

        const res = await apiFetch('/api/posts', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();

        if (res.ok) {
            progressFill.style.width = '100%';
            progressText.textContent = 'Published!';

            setTimeout(() => {
                uploadModal.style.display = 'none';
                resetUploadForm();
                loadFeed();
                showNotification('Post published successfully!');
            }, 500);
        } else {
            uploadError.textContent = data.error || 'Failed to create post';
            uploadError.style.display = 'block';
            uploadSubmit.style.display = 'block';
            uploadSubmit.disabled = false;
            uploadProgress.style.display = 'none';
        }
    } catch (e) {
        uploadError.textContent = e.message || 'Network error. Please try again.';
        uploadError.style.display = 'block';
        uploadSubmit.style.display = 'block';
        uploadSubmit.disabled = false;
        uploadProgress.style.display = 'none';
        console.error('Upload error:', e);
    }
});

// Profile functionality
const profileBtn = document.getElementById('profileBtn');
const profileModal = document.getElementById('profileModal');
const closeProfile = document.getElementById('closeProfile');

profileBtn?.addEventListener('click', () => {
    if (!currentUser) return;
    viewProfile(currentUser.id);
});

closeProfile?.addEventListener('click', () => {
    profileModal.style.display = 'none';
});

profileModal?.addEventListener('click', (e) => {
    if (e.target === profileModal) {
        profileModal.style.display = 'none';
    }
});

// Open a full single post (used by profile grid + share links)
async function openSinglePost(postId) {
    try {
        const res = await apiFetch(`/api/posts/${postId}`);
        if (!res.ok) {
            showNotification('Post not found or private');
            return;
        }
        const post = await res.json();
        profileModal.style.display = 'none';
        const filters = document.getElementById('feedFilters');
        if (filters) filters.style.display = 'none';
        currentFeed = [post];
        renderFeed();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
        showNotification('Failed to load post');
    }
}

// View any user's profile (own or other)
async function viewProfile(userId) {
    if (!userId) return;
    profileModal.style.display = 'flex';
    document.getElementById('profileTitle').textContent = 'Profile';
    document.getElementById('profileUsername').textContent = 'Loading...';
    document.getElementById('profileFullname').textContent = '';
    document.getElementById('profileEmail').textContent = '';
    document.getElementById('profileBio').textContent = '';
    document.getElementById('profileActions').innerHTML = '';
    document.getElementById('privateAccessSection').style.display = 'none';
    document.getElementById('profilePostsGrid').innerHTML =
        '<div class="loading"><div class="loading-spinner"></div><p>Loading...</p></div>';

    try {
        const res = await apiFetch(`/api/users/${userId}`);
        if (!res.ok) {
            document.getElementById('profileUsername').textContent = 'Profile not found';
            document.getElementById('profilePostsGrid').innerHTML = '';
            return;
        }
        const data = await res.json();
        const u = data.user;

        document.getElementById('profileTitle').textContent = data.is_self ? 'My Profile' : `@${u.username}`;
        document.getElementById('profileUsername').textContent = `@${u.username}`;
        document.getElementById('profileFullname').textContent = u.fullname || '';
        document.getElementById('profileEmail').textContent = data.is_self && currentUser ? currentUser.email : '';
        document.getElementById('profileBio').textContent = u.bio || '';
        document.getElementById('profileAvatar').textContent = getAvatarEmoji(u.username);
        document.getElementById('postsCount').textContent = data.stats.posts_count;
        document.getElementById('followersCount').textContent = data.stats.followers_count;
        document.getElementById('followingCount').textContent = data.stats.following_count;

        // Actions: follow button for others, private access for self
        const actions = document.getElementById('profileActions');
        actions.innerHTML = '';
        if (data.is_self) {
            const accessBtn = document.createElement('button');
            accessBtn.className = 'btn btn-secondary';
            accessBtn.textContent = '🔒 Manage private access';
            accessBtn.onclick = () => {
                const section = document.getElementById('privateAccessSection');
                section.style.display = section.style.display === 'none' ? 'block' : 'none';
                if (section.style.display === 'block') loadPrivateAccessList();
            };
            actions.appendChild(accessBtn);
        } else if (currentUser) {
            const followBtn = document.createElement('button');
            followBtn.className = `btn ${data.is_following ? 'btn-secondary' : 'btn-primary'} subscribe-btn ${data.is_following ? 'subscribed' : ''}`;
            followBtn.textContent = data.is_following ? '✓ Subscribed' : '+ Follow';
            followBtn.onclick = (e) => toggleSubscribeUser(userId, e.currentTarget);
            actions.appendChild(followBtn);
            if (data.stats.private_posts_count > 0 && !data.viewer_has_access) {
                const lockHint = document.createElement('p');
                lockHint.className = 'private-access-hint';
                lockHint.textContent = `🔒 ${data.stats.private_posts_count} private post(s) are hidden`;
                actions.appendChild(lockHint);
            }
        }

        // Posts grid
        const grid = document.getElementById('profilePostsGrid');
        if (!data.posts || data.posts.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>No posts yet</p></div>';
        } else {
            grid.innerHTML = data.posts.map(p => {
                const thumb = p.media?.[0];
                const src = thumb?.thumbnail_url || thumb?.media_url || '';
                const isVideo = thumb?.media_type === 'video';
                return `
                    <div class="profile-post-tile" onclick="openSinglePost(${p.id})">
                        ${src
                            ? (isVideo
                                ? `<img src="${src}" alt="Video post" loading="lazy"><span class="tile-video-badge">▶</span>`
                                : `<img src="${src}" alt="Post" loading="lazy">`)
                            : `<div class="tile-text">${escapeHtml((p.description || '📝').slice(0, 60))}</div>`}
                        ${p.is_public ? '' : '<span class="tile-private-badge">🔒</span>'}
                    </div>
                `;
            }).join('');
        }

        // Load private access list for own profile
        if (data.is_self) {
            loadPrivateAccessList();
        }
    } catch (e) {
        document.getElementById('profileUsername').textContent = 'Failed to load profile';
        document.getElementById('profilePostsGrid').innerHTML = '';
    }
}

// Load followers with private-access status (own profile)
async function loadPrivateAccessList() {
    const listEl = document.getElementById('privateAccessList');
    try {
        const res = await apiFetch('/api/users/me/access');
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        if (!data.followers || data.followers.length === 0) {
            listEl.innerHTML = '<p class="private-access-hint">You have no followers yet. When someone follows you, you can grant them access to your private posts.</p>';
            return;
        }
        listEl.innerHTML = data.followers.map(f => `
            <div class="private-access-item">
                <span class="private-access-user">${getAvatarEmoji(f.username)} @${escapeHtml(f.username)}</span>
                <button class="btn ${f.has_access ? 'btn-primary' : 'btn-secondary'} access-toggle-btn"
                        onclick="togglePrivateAccess(${f.id}, this)">
                    ${f.has_access ? '✅ Access granted' : '🔒 Grant access'}
                </button>
            </div>
        `).join('');
    } catch (e) {
        listEl.innerHTML = '<p class="private-access-hint">Failed to load followers</p>';
    }
}

// Grant/revoke private access to a follower
async function togglePrivateAccess(viewerId, btn) {
    const hasAccess = btn.textContent.includes('granted');
    btn.disabled = true;
    try {
        const res = await apiFetch(`/api/users/me/access/${viewerId}`, {
            method: hasAccess ? 'DELETE' : 'POST'
        });
        if (!res.ok) throw new Error('Failed');
        btn.disabled = false;
        btn.className = `btn ${hasAccess ? 'btn-secondary' : 'btn-primary'} access-toggle-btn`;
        btn.textContent = hasAccess ? '🔒 Grant access' : '✅ Access granted';
        showNotification(hasAccess ? 'Access revoked' : 'Access granted — user can now see your private posts');
    } catch (e) {
        btn.disabled = false;
        showNotification('Failed to update access');
    }
}

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

document.getElementById('forgotEmail')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('forgotBtn')?.click();
});

document.getElementById('confirmPassword')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('resetPasswordBtn')?.click();
});

// Forgot password
document.getElementById('showForgot')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('authForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'block';
    document.getElementById('forgotError').style.display = 'none';
    document.getElementById('forgotSuccess').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
});

document.getElementById('showLoginFromForgot')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('authForm').style.display = 'block';
    document.getElementById('forgotError').style.display = 'none';
    document.getElementById('forgotSuccess').style.display = 'none';
});

document.getElementById('forgotBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('forgotEmail').value.trim();
    const errorEl = document.getElementById('forgotError');
    const successEl = document.getElementById('forgotSuccess');

    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    if (!email) {
        errorEl.textContent = 'Please enter your email';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const res = await apiFetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await res.json();

        if (res.ok) {
            successEl.textContent = data.message || 'Reset link sent! Check your email.';
            successEl.style.display = 'block';
        } else {
            errorEl.textContent = data.error || 'Failed to send reset link';
            errorEl.style.display = 'block';
        }
    } catch (e) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.style.display = 'block';
    }
});

// Reset password (with token from URL)
document.getElementById('resetPasswordBtn')?.addEventListener('click', async () => {
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorEl = document.getElementById('resetError');
    const successEl = document.getElementById('resetSuccess');

    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    if (!newPassword || !confirmPassword) {
        errorEl.textContent = 'Please fill in both fields';
        errorEl.style.display = 'block';
        return;
    }

    if (newPassword !== confirmPassword) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.style.display = 'block';
        return;
    }

    if (newPassword.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters';
        errorEl.style.display = 'block';
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
        errorEl.textContent = 'Invalid reset link. Please request a new one.';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const res = await apiFetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword })
        });

        const data = await res.json();

        if (res.ok) {
            successEl.textContent = data.message || 'Password reset successfully! You can now log in.';
            successEl.style.display = 'block';
            // Redirect to login after 2 seconds
            setTimeout(() => {
                window.location.search = '';
                document.getElementById('resetPasswordForm').style.display = 'none';
                document.getElementById('authForm').style.display = 'block';
            }, 2000);
        } else {
            errorEl.textContent = data.error || 'Failed to reset password';
            errorEl.style.display = 'block';
        }
    } catch (e) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.style.display = 'block';
    }
});

// Check URL for reset password token on page load
function checkResetTokenInUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('token')) {
        document.getElementById('authForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('forgotForm').style.display = 'none';
        document.getElementById('resetPasswordForm').style.display = 'block';
    }
}

// Initialize
checkResetTokenInUrl();
checkAuth();

// === Single post view via /post/:id ===
function getPostIdFromUrl() {
    const match = window.location.pathname.match(/^\/post\/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
}

// Saved original feed loader — restored when logo resets the view
const originalLoadFeed = loadFeed;

const sharedPostId = getPostIdFromUrl();
if (sharedPostId) {
    // Override loadFeed to load single post instead
    loadFeed = async function() {
        const feed = document.getElementById('feed');
        const filters = document.getElementById('feedFilters');
        if (filters) filters.style.display = 'none';

        feed.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading...</p></div>';

        try {
            const res = await apiFetch(`/api/posts/${sharedPostId}`);
            if (!res.ok) {
                feed.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🔗</div>
                        <h3>Post not found</h3>
                        <p>This post may have been deleted or is private.</p>
                        <button class="btn btn-primary" onclick="window.location.href='/'">Go to feed</button>
                    </div>`;
                return;
            }
            const post = await res.json();
            currentFeed = [post];
            renderFeed();
            document.title = post.description
                ? `${post.description.slice(0, 50)} — Cosmogram`
                : 'Cosmogram';
        } catch (e) {
            feed.innerHTML = `<div class="empty-state"><h3>Failed to load post</h3></div>`;
        }
    };
}

// === Tag Input Handler ===
const tagInput = document.getElementById('tagInput');
const tagSuggestions = document.getElementById('tagSuggestions');
const selectedTagsEl = document.getElementById('selectedTags');

let tagInputTimeout = null;

tagInput?.addEventListener('input', (e) => {
    const value = e.target.value;
    
    // Check for comma — add as tag
    if (value.includes(',')) {
        const parts = value.split(',');
        for (const part of parts) {
            const trimmed = part.trim().toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '');
            if (trimmed && trimmed.length > 0 && !uploadTags.includes(trimmed)) {
                addUploadTag(trimmed);
            }
        }
        e.target.value = '';
        hideTagSuggestions();
        return;
    }

    // Show suggestions
    clearTimeout(tagInputTimeout);
    tagInputTimeout = setTimeout(() => {
        const query = value.trim().toLowerCase();
        if (query.length < 1) {
            hideTagSuggestions();
            return;
        }
        
        const matches = allTags.filter(t => t.name.includes(query)).slice(0, 8);
        if (matches.length === 0) {
            hideTagSuggestions();
            return;
        }
        
        tagSuggestions.innerHTML = matches.map(t => `
            <div class="tag-suggestion" onclick="addUploadTag('${escapeHtml(t.name)}'); hideTagSuggestions(); tagInput.value = '';">
                #${escapeHtml(t.name)}
            </div>
        `).join('');
        tagSuggestions.style.display = 'block';
    }, 150);
});

// Enter key to add tag
tagInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const value = e.target.value.trim().toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '');
        if (value && !uploadTags.includes(value)) {
            addUploadTag(value);
            e.target.value = '';
            hideTagSuggestions();
        }
    }
});

function addUploadTag(name) {
    const clean = name.toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '');
    if (!clean || uploadTags.includes(clean)) return;
    uploadTags.push(clean);
    renderUploadTags();
}

function removeUploadTag(name) {
    uploadTags = uploadTags.filter(t => t !== name);
    renderUploadTags();
}

function renderUploadTags() {
    if (!selectedTagsEl) return;
    selectedTagsEl.innerHTML = uploadTags.map(t => `
        <span class="selected-tag">
            #${escapeHtml(t)}
            <span class="remove-tag" onclick="removeUploadTag('${escapeHtml(t)}')">×</span>
        </span>
    `).join('');
}

function hideTagSuggestions() {
    if (tagSuggestions) tagSuggestions.style.display = 'none';
}

// Close suggestions on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.tag-input-area')) {
        hideTagSuggestions();
    }
});

// === Feed Filter Buttons ===
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setFilter(btn.dataset.filter);
    });
});

// Load tags after auth
const _origCheckAuth = checkAuth;
checkAuth = async function() {
    await _origCheckAuth();
    if (currentUser) {
        loadTags();
        // Show admin button for admin users
        if (currentUser.role === 'admin') {
            document.getElementById('adminBtn').style.display = 'inline-block';
        }
    }
};

// === Admin Panel ===
let adminModal = null;
let currentPreviewFiles = [];
let adminSelectedFiles = [];
let currentPreviewFolder = null;
const MAX_FILES_PER_POST = 20;

function openAdminPanel() {
    if (!adminModal) adminModal = document.getElementById('adminModal');
    if (adminModal) {
        adminModal.style.display = 'flex';
        loadAdminData();
    }
}

function closeAdminPanel() {
    if (!adminModal) adminModal = document.getElementById('adminModal');
    if (adminModal) {
        adminModal.style.display = 'none';
        clearAdminMessages();
        closePreview();
    }
}

function showAdminError(message) {
    const errorEl = document.getElementById('adminError');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        setTimeout(() => { errorEl.style.display = 'none'; }, 5000);
    }
}

function showAdminSuccess(message) {
    const successEl = document.getElementById('adminSuccess');
    if (successEl) {
        successEl.textContent = message;
        successEl.style.display = 'block';
        setTimeout(() => { successEl.style.display = 'none'; }, 5000);
    }
}

function clearAdminMessages() {
    const errorEl = document.getElementById('adminError');
    const successEl = document.getElementById('adminSuccess');
    if (errorEl) errorEl.style.display = 'none';
    if (successEl) successEl.style.display = 'none';
}

async function loadAdminData() {
    await Promise.all([
        loadFolders(),
        loadQueueStatus()
    ]);
}

// Tab switching
function switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.admin-tab[data-tab="${tabName}"]`)?.classList.add('active');
    document.getElementById(`tab-${tabName}`)?.classList.add('active');
}

// Folder search
function initFolderSearch() {
    const searchInput = document.getElementById('folderSearch');
    if (!searchInput) return;
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
        document.querySelectorAll('.folder-item').forEach(item => {
            const name = item.querySelector('.folder-name')?.textContent?.toLowerCase() || '';
            item.classList.toggle('hidden', !name.includes(query));
        });
    });
}

async function loadFolders() {
    try {
        const response = await apiFetch('/api/admin/media/sources');
        const data = await response.json();
        
        const folderList = document.getElementById('folderList');
        if (!folderList) return;
        
        if (!data.folders || data.folders.length === 0) {
            folderList.innerHTML = '<div class="loading">No folders found in source directory</div>';
            return;
        }
        
        const importedMap = new Map();
        if (data.importedFolders) {
            data.importedFolders.forEach(f => {
                importedMap.set(f.folder_path, f.file_count);
            });
        }
        
        folderList.innerHTML = data.folders.map(folder => {
            const imported = importedMap.get(folder.name);
            const importedCount = imported || 0;
            const hasImported = importedCount > 0;
            
            return `
                <div class="folder-item" data-folder="${escapeHtml(folder.name)}" id="folder-${escapeHtml(folder.name)}">
                    <div class="folder-name">📁 ${escapeHtml(folder.label)}</div>
                    <div class="folder-stats">
                        ${hasImported ? `✓ ${importedCount} files imported` : 'Not imported yet'}
                        <div class="folder-preview-hint">Click to preview</div>
                    </div>
                    <div class="folder-actions">
                        <button class="admin-btn primary" onclick="event.stopPropagation(); scanFolder('${escapeHtml(folder.name)}')" style="flex: 1; font-size: 12px; padding: 6px;">
                            🔍 Scan
                        </button>
                        <button class="admin-btn primary" onclick="event.stopPropagation(); importFolder('${escapeHtml(folder.name)}')" style="flex: 1; font-size: 12px; padding: 6px;">
                            📥 Import
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        document.querySelectorAll('.folder-item').forEach(item => {
            item.addEventListener('click', () => {
                const folder = item.dataset.folder;
                previewFolder(folder);
            });
        });
        
        initFolderSearch();
    } catch (error) {
        console.error('Error loading folders:', error);
        showAdminError('Failed to load folders: ' + error.message);
    }
}

async function loadQueueStatus() {
    try {
        const response = await apiFetch('/api/admin/media/queue');
        const data = await response.json();
        
        const queueStatus = document.getElementById('queueStatus');
        if (!queueStatus) return;
        
        if (!data.hasQueue || data.total === 0) {
            queueStatus.innerHTML = '<div class="loading">Queue is empty</div>';
            return;
        }
        
        let html = `
            <div class="queue-stats">
                <div class="queue-stat">
                    <div class="queue-stat-value">${data.total}</div>
                    <div class="queue-stat-label">Total</div>
                </div>
                <div class="queue-stat">
                    <div class="queue-stat-value" style="color: #ffa500;">${data.pending}</div>
                    <div class="queue-stat-label">Pending</div>
                </div>
                <div class="queue-stat">
                    <div class="queue-stat-value" style="color: #00c853;">${data.done}</div>
                    <div class="queue-stat-label">Done</div>
                </div>
                <div class="queue-stat">
                    <div class="queue-stat-value" style="color: #ed4956;">${data.errors}</div>
                    <div class="queue-stat-label">Errors</div>
                </div>
            </div>
        `;
        
        if (data.folders && data.folders.length > 0) {
            html += '<div class="queue-folders">';
            html += data.folders.map(f => `
                <div class="queue-folder-item">
                    <div class="queue-folder-name">📁 ${escapeHtml(f.folder_path)}</div>
                    <div class="queue-folder-stats">
                        <span>⏳ ${f.pending}</span>
                        <span>✓ ${f.done}</span>
                        <span>✗ ${f.errors}</span>
                    </div>
                </div>
            `).join('');
            html += '</div>';
        }
        
        queueStatus.innerHTML = html;
    } catch (error) {
        console.error('Error loading queue:', error);
        showAdminError('Failed to load queue: ' + error.message);
    }
}

function closePreview() {
    const previewSection = document.getElementById('previewSection');
    if (previewSection) previewSection.style.display = 'none';
    currentPreviewFiles = [];
    adminSelectedFiles = [];
    currentPreviewFolder = null;
}

async function previewFolder(folderPath) {
    currentPreviewFolder = folderPath;
    adminSelectedFiles = [];
    currentPreviewFiles = [];
    
    const previewSection = document.getElementById('previewSection');
    const previewFolderName = document.getElementById('previewFolderName');
    const adminPreviewGrid = document.getElementById('adminPreviewGrid');

    if (!previewSection || !adminPreviewGrid) return;

    previewSection.style.display = 'block';
    previewFolderName.textContent = folderPath;
    adminPreviewGrid.innerHTML = '<div class="loading">Loading preview...</div>';
    
    try {
        const response = await apiFetch(`/api/admin/media/scan-preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath, recursive: true })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Preview failed');
        }
        
        currentPreviewFiles = data.files;
        
        if (data.subfolders && data.subfolders.length > 0) {
            previewFolderName.textContent = `${folderPath} (${data.subfolders.length} subfolders, ${data.totalFiles} files)`;
        }
        
        renderAdminPreviewGrid();
    } catch (error) {
        console.error('Error previewing folder:', error);
        showAdminError('Preview failed: ' + error.message);
        adminPreviewGrid.innerHTML = '<div class="loading">Error loading preview</div>';
    }
}

function renderAdminPreviewGrid() {
    const adminPreviewGrid = document.getElementById('adminPreviewGrid');
    if (!adminPreviewGrid) return;

    if (currentPreviewFiles.length === 0) {
        adminPreviewGrid.innerHTML = '<div class="loading">No files found</div>';
        return;
    }

    adminPreviewGrid.innerHTML = currentPreviewFiles.map((file, index) => {
        const isSelected = adminSelectedFiles.some(f => f.relativePath === file.relativePath);
        const fileSize = formatFileSize(file.fileSize);
        const fileDate = new Date(file.fileDate).toLocaleDateString('ru-RU');
        const folderBadge = file.folderPath !== currentPreviewFolder ? `<span class="folder-badge">${escapeHtml(file.folderPath)}</span>` : '';
        
        return `
            <div class="preview-item ${isSelected ? 'selected' : ''}" data-index="${index}" onclick="toggleSelectFile(${index})">
                <div class="preview-item-overlay">
                    <img src="${file.thumbUrl}" alt="${escapeHtml(file.filename)}" loading="lazy">
                    ${isSelected ? '<div class="selected-badge">✓</div>' : ''}
                </div>
                <div class="preview-item-info">
                    <div class="preview-item-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</div>
                    <div class="preview-item-meta">
                        <span class="preview-item-size">${fileSize}</span>
                        <span class="preview-item-date">${fileDate}</span>
                    </div>
                    ${folderBadge}
                </div>
            </div>
        `;
    }).join('');
    
    updatePreviewCounts();
}

function toggleSelectFile(index) {
    const file = currentPreviewFiles[index];
    if (!file) return;
    
    const existingIndex = adminSelectedFiles.findIndex(f => f.relativePath === file.relativePath);
    
    if (existingIndex >= 0) {
        adminSelectedFiles.splice(existingIndex, 1);
    } else {
        if (adminSelectedFiles.length >= MAX_FILES_PER_POST) {
            showAdminError(`Maximum ${MAX_FILES_PER_POST} files per post`);
            return;
        }
        adminSelectedFiles.push(file);
    }
    
    renderAdminPreviewGrid();
}

function updatePreviewCounts() {
    const totalCount = document.getElementById('totalCount');
    const selectedCount = document.getElementById('selectedCount');
    const importCount = document.getElementById('importCount');
    
    if (!totalCount || !selectedCount || !importCount) return;
    
    const total = currentPreviewFiles.length;
    const selected = adminSelectedFiles.length;
    
    totalCount.textContent = total;
    selectedCount.textContent = selected;
    importCount.textContent = selected;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function importSelectedFolder() {
    if (!currentPreviewFolder || currentPreviewFiles.length === 0) {
        showAdminError('No folder selected for import');
        return;
    }
    
    if (adminSelectedFiles.length === 0) {
        showAdminError('No files selected. Click on photos to select them first.');
        return;
    }
    
    if (adminSelectedFiles.length > MAX_FILES_PER_POST) {
        showAdminError(`Maximum ${MAX_FILES_PER_POST} files per post`);
        return;
    }
    
    clearAdminMessages();
    
    const filesForImport = adminSelectedFiles.map(file => {
        const sourceDir = '/opt/media/files/';
        let relativePath = file.sourcePath;
        if (relativePath.startsWith(sourceDir)) {
            relativePath = relativePath.substring(sourceDir.length);
        }
        return { ...file, relativePath };
    });
    
    try {
        const response = await apiFetch('/api/admin/media/import-selected', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: filesForImport,
                folderPath: currentPreviewFolder
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Import failed');
        }
        
        showAdminSuccess(`✅ Created post with ${data.filesImported} files`);
        
        if (data.errors && data.errors.length > 0) {
            console.warn('Import warnings:', data.errors);
        }
        
        adminSelectedFiles = [];
        closePreview();
        
        await Promise.all([
            loadQueueStatus(),
            loadFolders()
        ]);
    } catch (error) {
        console.error('Error importing:', error);
        showAdminError('Import failed: ' + error.message);
    }
}

function selectAllFiles() {
    adminSelectedFiles = currentPreviewFiles.slice(0, MAX_FILES_PER_POST);
    renderAdminPreviewGrid();
}

function deselectAllFiles() {
    adminSelectedFiles = [];
    renderAdminPreviewGrid();
}

async function scanFolder(folderPath) {
    const folderEl = document.getElementById(`folder-${folderPath}`);
    if (!folderEl) return;
    
    folderEl.classList.add('scanning');
    clearAdminMessages();
    
    try {
        const response = await apiFetch('/api/admin/media/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath, recursive: true })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Scan failed');
        }
        
        showAdminSuccess(`✅ Scanned ${data.filesFound} files from ${folderPath}`);
        await loadQueueStatus();
    } catch (error) {
        console.error('Error scanning folder:', error);
        showAdminError('Scan failed: ' + error.message);
    } finally {
        folderEl.classList.remove('scanning');
    }
}

async function importFolder(folderPath) {
    const folderEl = document.getElementById(`folder-${folderPath}`);
    if (!folderEl) return;
    
    folderEl.classList.add('importing');
    clearAdminMessages();
    
    try {
        const response = await apiFetch('/api/admin/media/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Import failed');
        }
        
        if (data.postsCreated > 0) {
            showAdminSuccess(`✅ Created ${data.postsCreated} posts from ${folderPath}`);
            await Promise.all([
                loadQueueStatus(),
                loadFolders()
            ]);
        } else {
            showAdminError('No pending files found for import');
        }
    } catch (error) {
        console.error('Error importing folder:', error);
        showAdminError('Import failed: ' + error.message);
    } finally {
        folderEl.classList.remove('importing');
    }
}

async function clearQueue() {
    if (!confirm('⚠️ Are you sure you want to clear the entire import queue? This cannot be undone.')) {
        return;
    }
    
    clearAdminMessages();
    
    try {
        const response = await apiFetch('/api/admin/media/queue', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: 'YES_DELETE_ALL' })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Clear failed');
        }
        
        showAdminSuccess('✅ Queue cleared');
        await Promise.all([
            loadQueueStatus(),
            loadFolders()
        ]);
    } catch (error) {
        console.error('Error clearing queue:', error);
        showAdminError('Clear failed: ' + error.message);
    }
}

// Admin panel event listeners
document.getElementById('adminBtn')?.addEventListener('click', openAdminPanel);
document.getElementById('closeAdmin')?.addEventListener('click', closeAdminPanel);

// Tab switching
document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        switchAdminTab(tab.dataset.tab);
    });
});

// Preview close
document.getElementById('closePreview')?.addEventListener('click', closePreview);

// Refresh buttons
document.getElementById('refreshFoldersBtn')?.addEventListener('click', () => {
    loadFolders();
    const search = document.getElementById('folderSearch');
    if (search) search.value = '';
});

document.getElementById('refreshQueueBtn')?.addEventListener('click', loadQueueStatus);

// Selection buttons
document.getElementById('selectAllBtn')?.addEventListener('click', selectAllFiles);
document.getElementById('deselectAllBtn')?.addEventListener('click', deselectAllFiles);
document.getElementById('importSelectedBtn')?.addEventListener('click', importSelectedFolder);

// Clear queue handler for the action card button (if it's in the actions tab)
// The clearQueueBtn handler still works via onclick in the action card

// Close admin modal on escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAdminPanel();
    }
});
