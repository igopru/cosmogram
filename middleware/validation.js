import { body, validationResult } from 'express-validator';

export const validateRegistration = [
    body('username').trim().isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_а-яёА-ЯЁ]+$/),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

export const validatePost = [
    body('description').optional().trim().isLength({ max: 2200 }),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

export const validateComment = [
    body('text').trim().isLength({ min: 1, max: 500 }),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

// Validate ID route parameter
export function validateId(req, res, next) {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1) {
        return res.status(400).json({ error: 'Invalid ID parameter' });
    }
    req.params.id = id;
    next();
}

// Validate any numeric route param
export function validateNumericParam(paramName) {
    return (req, res, next) => {
        const value = parseInt(req.params[paramName]);
        if (isNaN(value) || value < 1) {
            return res.status(400).json({ error: `Invalid ${paramName} parameter` });
        }
        req.params[paramName] = value;
        next();
    };
}
