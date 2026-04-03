import xss from 'xss';

export function preventXSS(req, res, next) {
    if (req.body) {
        for (let key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = xss(req.body[key], {
                    whiteList: {},
                    stripIgnoreTag: true,
                    stripIgnoreTagBody: ['script', 'style', 'iframe']
                });
            }
        }
    }
    next();
}

export function sanitizeInput(str) {
    if (!str) return '';
    return str
        .replace(/[<>]/g, '')
        .replace(/[&]/g, '&amp;')
        .trim()
        .slice(0, 500);
}

export function securityHeaders(req, res, next) {
    res.set({
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    next();
}
