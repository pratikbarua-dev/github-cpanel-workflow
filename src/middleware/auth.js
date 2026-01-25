const { verifyToken } = require('../utils/jwtHelper');
const { User } = require('../models');

module.exports = {
    ensureAuthenticated: async function (req, res, next) {
        // Check for JWT Cookie
        const token = req.cookies.auth_token;

        if (!token) {
            return res.redirect('/admin/login');
        }

        const decoded = verifyToken(token);
        if (!decoded) {
            // Invalid token - clear it and redirect
            res.clearCookie('auth_token');
            return res.redirect('/admin/login?error=Session+expired');
        }

        try {
            // Fetch fresh user data
            const user = await User.findByPk(decoded.id);

            if (!user) {
                res.clearCookie('auth_token');
                return res.redirect('/admin/login?error=User+not+found');
            }

            if (!user.is_active) {
                res.clearCookie('auth_token');
                return res.redirect('/admin/login?error=Account+disabled');
            }

            // Attach user to request
            req.user = user;
            res.locals.user = user; // For views
            return next();
        } catch (error) {
            console.error('Auth Middleware Error:', error);
            res.clearCookie('auth_token');
            return res.redirect('/admin/login?error=Server+Error');
        }
    },
    forwardAuthenticated: function (req, res, next) {
        const token = req.cookies.auth_token;
        if (token && verifyToken(token)) {
            return res.redirect('/admin/dashboard');
        }
        next();
    },
    checkPermission: (permission) => {
        return (req, res, next) => {
            if (!req.user) return res.redirect('/admin/login');

            // Admins have access to everything
            if (req.user.role === 'admin') return next();

            // Check specific permission
            const userPermissions = req.user.permissions || [];
            if (userPermissions.includes(permission)) {
                return next();
            }

            // Deny access
            console.warn(`[Security] Access Denied: User ${req.user.email} (Role: ${req.user.role}) attempted to access protected route. Missing permission: ${permission}`);

            res.status(403).render('admin/error', {
                message: 'Access Restricted',
                reason: 'Your account does not have permission to access this section.',
                error: { status: 403 },
                title: 'Permission Denied',
                user: req.user
            });
        };
    }
};
