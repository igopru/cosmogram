import xss from 'xss';
import escapeHtml from 'escape-html';

// Security event logger
export function logSecurityEvent(req, action, details = {}) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
        user: req.user?.id || 'anonymous',
        action,
        details: JSON.stringify(details).slice(0, 500), // Limit to prevent log injection
        ua: req.get('user-agent') || 'unknown'
    };
    console.warn(`[SECURITY] ${action}:`, JSON.stringify(logEntry));
}

export function preventXSS(req, res, next) {
    // Recursively sanitize all string values in req.body (handles nested objects)
    const sanitizeObject = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        
        if (Array.isArray(obj)) {
            return obj.map(item => 
                typeof item === 'string' ? xss(item, {
                    whiteList: {},
                    stripIgnoreTag: true,
                    stripIgnoreTagBody: ['script', 'style', 'iframe', 'img', 'svg']
                }) : sanitizeObject(item)
            );
        }
        
        for (let key in obj) {
            if (typeof obj[key] === 'string') {
                obj[key] = xss(obj[key], {
                    whiteList: {},
                    stripIgnoreTag: true,
                    stripIgnoreTagBody: ['script', 'style', 'iframe', 'img', 'svg']
                });
            } else if (typeof obj[key] === 'object') {
                sanitizeObject(obj[key]);
            }
        }
        return obj;
    };
    
    if (req.body) {
        sanitizeObject(req.body);
    }
    next();
}

export function sanitizeInput(str) {
    if (!str) return '';
    return str
        .replace(/[<>"'&]/g, '')  // Strip dangerous chars including quotes
        .trim()
        .slice(0, 500);
}

// HTML-encode for safe output in HTML context
export function htmlEncode(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

export function securityHeaders(req, res, next) {
    res.set({
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        // Content Security Policy — prevents XSS execution even if injection occurs
        'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",  // unsafe-inline needed for SPA event handlers
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "media-src 'self' blob: data:",
            "connect-src 'self'",
            "font-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'"
        ].join('; ')
    });
    next();
}

export { escapeHtml };
