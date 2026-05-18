import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_123';

export const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
};

export const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

export const generateToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

export const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
};

// Hono Middleware for Authentication
import { getCookie } from 'hono/cookie';

export const authMiddleware = async (c, next) => {
    const token = getCookie(c, 'token') || c.req.header('Authorization')?.split(' ')[1];
    if (!token) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const user = verifyToken(token);
    if (!user) {
        return c.json({ error: 'Invalid token' }, 401);
    }
    
    c.set('user', user);
    await next();
};

export const isAdmin = async (c, next) => {
    const user = c.get('user');
    if (!user || user.role !== 'admin') {
        return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
};
