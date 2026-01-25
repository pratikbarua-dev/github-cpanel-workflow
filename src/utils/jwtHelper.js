const jwt = require('jsonwebtoken');

const SECRET = process.env.SESSION_SECRET || 'secret_key'; // Reuse session secret or new JWT_SECRET

exports.generateToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        SECRET,
        { expiresIn: '7d' }
    );
};

exports.verifyToken = (token) => {
    try {
        return jwt.verify(token, SECRET);
    } catch (error) {
        return null; // Invalid or expired
    }
};
