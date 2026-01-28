const passport = require('passport');
const { Project, Post, Publication, TeamMember, FormSubmission, User, CustomForm, FormField, FormResponse, Comment } = require('../models');
const { sendWelcomeEmail, sendAccountDeletedEmail } = require('../utils/emailService');
const { Parser } = require('json2csv');
const fs = require('fs');
const path = require('path');
const { generateToken } = require('../utils/jwtHelper');
const bcrypt = require('bcryptjs');

// Helper to process Base64 or URL images
async function processImage(inputData) {
    if (!inputData) return null;

    // Check if it's base64
    if (inputData.startsWith('data:image')) {
        const matches = inputData.match(/^data:image\/([a-z]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return null;
        }

        const ext = matches[1];
        const data = matches[2];
        const buffer = Buffer.from(data, 'base64');
        const filename = `post-${Date.now()}.${ext}`;
        const uploadPath = path.join(__dirname, '../../public/uploads', filename);

        // Ensure directory exists
        const dir = path.dirname(uploadPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        await fs.promises.writeFile(uploadPath, buffer);
        return `/uploads/${filename}`;
    }

    // Assume it's a URL
    return inputData;
}

// Login Page
exports.getLogin = (req, res) => {
    const error = req.query.error;
    res.render('admin/login', { title: 'Admin Login', error: error });
};

// Login Handle
exports.postLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Check User
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.redirect('/admin/login?error=That+email+is+not+registered');
        }

        // 2. Check Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.redirect('/admin/login?error=Password+incorrect');
        }

        // 3. Generate JWT
        const token = generateToken(user);

        // 4. Set Cookie (7 Days)
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
        });

        // 5. Redirect
        res.redirect('/admin/dashboard');

    } catch (error) {
        console.error(error);
        res.redirect('/admin/login?error=Server+Error');
    }
};

// Logout Handle
exports.logout = (req, res) => {
    res.clearCookie('auth_token');
    res.redirect('/admin/login');
};

// Dashboard
// Dashboard
exports.getDashboard = async (req, res) => {
    try {
        const projectCount = await Project.count();
        const postCount = await Post.count();
        const publicationCount = await Publication.count();
        const formCount = await CustomForm.count();

        // Fetch legacy submissions
        const legacySubmissions = await FormSubmission.findAll({
            order: [['createdAt', 'DESC']],
            limit: 10
        });

        // Fetch custom form responses with form fields
        const customResponses = await FormResponse.findAll({
            include: [{
                model: CustomForm,
                include: [{ model: FormField }]
            }],
            order: [['createdAt', 'DESC']],
            limit: 10
        });

        // Parse and normalize custom responses
        const normalizedCustom = customResponses.map(r => {
            let parsedData = {};
            try { parsedData = JSON.parse(r.data); } catch (e) { }

            // Build field name -> label map for smarter detection
            const fieldLabelMap = {};
            if (r.custom_form && r.custom_form.form_fields) {
                r.custom_form.form_fields.forEach(field => {
                    fieldLabelMap[field.name] = field.label;
                });
            }

            // Smarter Name Detection using field labels
            let name = 'Anonymous';
            const keys = Object.keys(parsedData);

            // First, check by field label (preferred)
            for (const key of keys) {
                const label = fieldLabelMap[key] || key;
                if (/name|full name|first name|your name/i.test(label)) {
                    name = parsedData[key];
                    break;
                }
            }

            // Smarter Email Detection using field labels
            let email = '';
            for (const key of keys) {
                const label = fieldLabelMap[key] || key;
                if (/email/i.test(label)) {
                    email = parsedData[key];
                    break;
                }
            }

            return {
                id: r.id,
                customFormId: r.customFormId,
                type: 'Custom Form',
                name: name,
                email: email,
                subject: r.custom_form ? r.custom_form.title : 'Form Response',
                status: 'New',
                createdAt: r.createdAt,
                isCustom: true
            };
        });

        // Combine and Sort
        let allMixed = [...legacySubmissions, ...normalizedCustom];
        allMixed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Ensure Date objects
        const submissions = allMixed.slice(0, 5);

        // Chart Data (Last 30 Days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const { Op } = require('sequelize');

        // Fetch ALL recent records for chart accuracy
        const recentLegacy = await FormSubmission.findAll({
            where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
            attributes: ['createdAt']
        });
        const recentCustom = await FormResponse.findAll({
            where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
            attributes: ['createdAt']
        });

        const submissionMap = {};
        [...recentLegacy, ...recentCustom].forEach(s => {
            const date = new Date(s.createdAt).toISOString().split('T')[0];
            submissionMap[date] = (submissionMap[date] || 0) + 1;
        });

        const labels = [];
        const data = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            labels.push(dateStr);
            data.push(submissionMap[dateStr] || 0);
        }

        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            user: req.user,
            projectCount,
            postCount,
            publicationCount,
            formCount,
            submissions,
            chartData: {
                labels: JSON.stringify(labels),
                data: JSON.stringify(data),
                breakdown: JSON.stringify([projectCount, postCount, publicationCount])
            },
            path: '/dashboard'
        });
    } catch (error) {
        console.error(error);
        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            user: req.user,
            projectCount: 0,
            postCount: 0,
            publicationCount: 0,
            submissions: [],
            chartData: { labels: '[]', data: '[]', breakdown: '[]' },
            path: '/dashboard',
            error: 'Error loading dashboard data'
        });
    }
};

// --- PROJECTS CRUD ---

exports.getProjects = async (req, res) => {
    try {
        const projects = await Project.findAll({ order: [['createdAt', 'DESC']] });
        res.render('admin/projects/index', { projects, path: '/projects' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getNewProject = (req, res) => {
    res.render('admin/projects/form', { project: {}, path: '/projects' });
};

exports.postProject = async (req, res) => {
    try {
        const { title, slug, status, summary, content } = req.body;
        const imageData = req.file ? `/uploads/${req.file.filename}` : null;

        const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

        await Project.create({
            title,
            slug: finalSlug,
            status,
            summary,
            content,
            image_url: imageData || 'https://placehold.co/600x400'
        });

        res.redirect('/admin/projects');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error creating project');
    }
};

exports.getEditProject = async (req, res) => {
    try {
        const project = await Project.findByPk(req.params.id);
        if (!project) return res.status(404).send('Project not found');
        res.render('admin/projects/form', { project, path: '/projects' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.updateProject = async (req, res) => {
    try {
        const { title, slug, status, summary, content } = req.body;
        const project = await Project.findByPk(req.params.id);

        if (!project) return res.status(404).send('Project not found');

        const updateData = { title, slug, status, summary, content };
        if (req.file) {
            updateData.image_url = `/uploads/${req.file.filename}`;
        }

        await project.update(updateData);
        res.redirect('/admin/projects');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating project');
    }
};

exports.deleteProject = async (req, res) => {
    try {
        await Project.destroy({ where: { id: req.params.id } });
        res.redirect('/admin/projects');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error deleting project');
    }
};

// --- PUBLICATIONS CRUD ---

exports.getPublications = async (req, res) => {
    try {
        const publications = await Publication.findAll({ order: [['published_date', 'DESC']] });
        res.render('admin/publications/index', { publications, path: '/publications' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getNewPublication = (req, res) => {
    res.render('admin/publications/form', { publication: {}, path: '/publications' });
};

exports.postPublication = async (req, res) => {
    try {
        const { title, category, published_date } = req.body;

        let fileUrl = null;
        let imageUrl = null;

        if (req.files) {
            if (req.files['file']) fileUrl = `/uploads/${req.files['file'][0].filename}`;
            if (req.files['image']) imageUrl = `/uploads/${req.files['image'][0].filename}`;
        }

        await Publication.create({
            title,
            category,
            published_date,
            file_url: fileUrl,
            image_url: imageUrl
        });

        res.redirect('/admin/publications');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error creating publication');
    }
};

exports.getEditPublication = async (req, res) => {
    try {
        const publication = await Publication.findByPk(req.params.id);
        if (!publication) return res.status(404).send('Publication not found');
        res.render('admin/publications/form', { publication, path: '/publications' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.updatePublication = async (req, res) => {
    try {
        const { title, category, published_date } = req.body;
        const publication = await Publication.findByPk(req.params.id);

        if (!publication) return res.status(404).send('Publication not found');

        const updateData = { title, category, published_date };

        if (req.files) {
            if (req.files['file']) updateData.file_url = `/uploads/${req.files['file'][0].filename}`;
            if (req.files['image']) updateData.image_url = `/uploads/${req.files['image'][0].filename}`;
        }

        await publication.update(updateData);
        res.redirect('/admin/publications');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating publication');
    }
};

exports.deletePublication = async (req, res) => {
    try {
        await Publication.destroy({ where: { id: req.params.id } });
        res.redirect('/admin/publications');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error deleting publication');
    }
};

// --- POSTS CRUD ---

exports.getPosts = async (req, res) => {
    try {
        const posts = await Post.findAll({ order: [['date', 'DESC']] });
        res.render('admin/posts/index', { posts, path: '/posts' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getNewPost = (req, res) => {
    res.render('admin/posts/form', { post: {}, path: '/posts' });
};

// Create Post (Legacy Form)
exports.postPost = async (req, res) => {
    // ... logic for legacy form ...
};

// --- API METHODS FOR QUILL ---

exports.createPostApi = async (req, res) => {
    try {
        const { title, type, date, slug, excerpt, content, status, heading_image } = req.body;

        let finalSlug = slug;
        if (!finalSlug && title) {
            finalSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
        }

        let imageUrl = null;
        if (heading_image) {
            imageUrl = await processImage(heading_image);
        }

        const newPost = await Post.create({
            title,
            type: type || 'News',
            date: date || new Date(),
            slug: finalSlug,
            excerpt,
            content,
            status: status || 'draft',
            image_url: imageUrl
        });

        res.json({ success: true, id: newPost.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
};

exports.updatePostApi = async (req, res) => {
    try {
        const { title, type, date, slug, excerpt, content, status, heading_image } = req.body;
        const post = await Post.findByPk(req.params.id);

        if (!post) {
            return res.status(404).json({ success: false, error: 'Post not found' });
        }

        const updateData = {
            title, type, date, slug, excerpt, content, status
        };

        if (heading_image) {
            const imageUrl = await processImage(heading_image);
            if (imageUrl) {
                updateData.image_url = imageUrl;
            }
        }

        await post.update(updateData);

        res.json({ success: true, id: post.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
};

exports.getEditPost = async (req, res) => {
    // ... existing getEditPost
    try {
        const post = await Post.findByPk(req.params.id);
        if (!post) return res.status(404).send('Post not found');
        res.render('admin/posts/form', { post, path: '/posts' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.updatePost = async (req, res) => {
    try {
        const { title, type, date, content } = req.body;
        const post = await Post.findByPk(req.params.id);

        if (!post) return res.status(404).send('Post not found');

        const updateData = { title, type, date, content };
        if (req.file) {
            updateData.image_url = `/uploads/${req.file.filename}`;
        }

        await post.update(updateData);
        res.redirect('/admin/posts');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating post');
    }
};

exports.deletePost = async (req, res) => {
    try {
        await Post.destroy({ where: { id: req.params.id } });
        res.redirect('/admin/posts');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error deleting post');
    }
};

// --- CUSTOM FORMS CRUD ---

exports.getForms = async (req, res) => {
    try {
        const forms = await CustomForm.findAll({ order: [['createdAt', 'DESC']] });
        res.render('admin/forms/index', { forms, path: '/forms' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getNewForm = (req, res) => {
    res.render('admin/forms/form', { form: {}, path: '/forms' });
};

exports.postForm = async (req, res) => {
    try {
        const { title, description, status } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

        const form = await CustomForm.create({ title, slug, description, status });
        res.redirect(`/admin/forms/${form.id}/builder`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error creating form');
    }
};

exports.getFormBuilder = async (req, res) => {
    try {
        const form = await CustomForm.findByPk(req.params.id, {
            include: [{ model: FormField }]
        });
        if (!form) return res.status(404).send('Form not found');

        // Sort fields by order
        if (form.form_fields) {
            form.form_fields.sort((a, b) => a.order - b.order);
        }

        res.render('admin/forms/builder', { form, path: '/forms' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.saveFormFieldsApi = async (req, res) => {
    try {
        const formId = req.params.id;
        const { fields } = req.body; // Array of field objects

        // Transactional could be better, but simple approach: delete old, create new
        // Or update existing if they have IDs. For simplicity in this Prototype:
        // We will "Sync" fields.

        // 1. Delete all fields for this form (simplest "update" logic for re-ordering/changing types)
        // In a real prod app, you'd want to be careful not to lose data if fields are renamed.
        // But for structure updates, this is acceptable for V1.
        await FormField.destroy({ where: { customFormId: formId } });

        // 2. Create new fields
        const newFields = fields.map((f, index) => {
            // Exclude 'id' (frontend generated string) to let DB generate AutoIncrement ID
            // We keep 'name' as the stable identifier if needed
            const { id, ...fieldData } = f;
            return {
                ...fieldData,
                customFormId: formId,
                order: index
            };
        });

        await FormField.bulkCreate(newFields);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
};

exports.getFormResponses = async (req, res) => {
    try {
        const form = await CustomForm.findByPk(req.params.id, {
            include: [
                { model: FormField },
                { model: FormResponse, order: [['createdAt', 'DESC']] }
            ]
        });

        if (!form) return res.status(404).send('Form not found');

        res.render('admin/forms/responses', { form, path: '/forms' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.exportFormResponses = async (req, res) => {
    try {
        const form = await CustomForm.findByPk(req.params.id, {
            include: [
                { model: FormField },
                { model: FormResponse, order: [['createdAt', 'DESC']] }
            ]
        });

        if (!form) return res.status(404).send('Form not found');

        const fields = form.form_fields.sort((a, b) => a.order - b.order).map(f => f.label);
        const data = form.form_responses.map(r => {
            const row = { 'Submission Date': r.createdAt.toISOString() };
            const parsedData = JSON.parse(r.data);
            form.form_fields.forEach(f => {
                row[f.label] = parsedData[f.name] || '';
            });
            return row;
        });

        const json2csvParser = new Parser({ fields: ['Submission Date', ...fields] });
        const csv = json2csvParser.parse(data);

        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="${form.slug}-responses.csv"`);
        res.send(csv);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error exporting CSV');
    }
};

// --- TEAM CRUD ---

exports.getTeam = async (req, res) => {
    try {
        const team = await TeamMember.findAll({ order: [['display_order', 'ASC']] });
        res.render('admin/team/index', { team, path: '/team' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getNewTeamMember = (req, res) => {
    res.render('admin/team/form', { member: {}, path: '/team' });
};

exports.postTeamMember = async (req, res) => {
    try {
        const { name, role, bio, display_order } = req.body;
        const imageData = req.file ? `/uploads/${req.file.filename}` : null;

        await TeamMember.create({
            name,
            role,
            bio,
            display_order: display_order || 0,
            image_url: imageData || 'https://placehold.co/150'
        });

        res.redirect('/admin/team');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error creating team member');
    }
};

exports.getEditTeamMember = async (req, res) => {
    try {
        const member = await TeamMember.findByPk(req.params.id);
        if (!member) return res.status(404).send('Member not found');
        res.render('admin/team/form', { member, path: '/team' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.updateTeamMember = async (req, res) => {
    try {
        const { name, role, bio, display_order } = req.body;
        const member = await TeamMember.findByPk(req.params.id);

        if (!member) return res.status(404).send('Member not found');

        const updateData = { name, role, bio, display_order };
        if (req.file) {
            updateData.image_url = `/uploads/${req.file.filename}`;
        }

        await member.update(updateData);
        res.redirect('/admin/team');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating team member');
    }
};

exports.deleteTeamMember = async (req, res) => {
    try {
        await TeamMember.destroy({ where: { id: req.params.id } });
        res.redirect('/admin/team');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error deleting team member');
    }
};

// --- USERS / MODERATORS CRUD ---

exports.getUsers = async (req, res) => {
    try {
        const users = await User.findAll({ order: [['createdAt', 'DESC']] });
        res.render('admin/users/index', { users, path: '/users' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getNewUser = (req, res) => {
    res.render('admin/users/form', { user: {}, path: '/users' });
};

exports.postUser = async (req, res) => {
    try {
        const { email, password, role, permissions } = req.body;

        // Basic validation
        if (!email || !password) return res.status(400).send('Email and Password required');

        // Check exists
        const exists = await User.findOne({ where: { email } });
        if (exists) return res.status(400).send('User already exists');

        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);

        // Ensure permissions is an array (checkboxes can return string or array)
        let permsArray = [];
        if (permissions) {
            permsArray = Array.isArray(permissions) ? permissions : [permissions];
        }

        await User.create({
            email,
            password: hashedPassword,
            role: role || 'moderator',
            permissions: permsArray,
            is_active: true
        });

        // Send Welcome Email (Non-blocking catch)
        await sendWelcomeEmail(email, role || 'moderator', password, permsArray).catch(err => console.error('Failed to send welcome email:', err));

        res.redirect('/admin/users');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error creating user');
    }
};

exports.deleteUser = async (req, res) => {
    try {
        // Prevent deleting self
        if (req.user.id == req.params.id) {
            return res.status(400).send('Cannot delete yourself');
        }

        const userToDelete = await User.findByPk(req.params.id);
        if (!userToDelete) {
            return res.status(404).send('User not found');
        }

        const userEmail = userToDelete.email;

        await User.destroy({ where: { id: req.params.id } });

        // Send Deletion Email (Non-blocking)
        await sendAccountDeletedEmail(userEmail).catch(err => console.error('Failed to send deletion email:', err));

        res.redirect('/admin/users');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error deleting user');
    }
};

// --- API METHODS FOR QUILL (PROJECTS, PUBLICATIONS, TEAM) ---

// Projects API
exports.createProjectApi = async (req, res) => {
    try {
        const { title, slug, status, summary, content, image_url } = req.body;
        const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

        const project = await Project.create({
            title,
            slug: finalSlug,
            status,
            summary,
            content,
            image_url // Assuming URL string from client or placeholder handling
        });
        res.json({ success: true, id: project.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'DB Error' });
    }
};

exports.updateProjectApi = async (req, res) => {
    try {
        const project = await Project.findByPk(req.params.id);
        if (!project) return res.status(404).json({ success: false, error: 'Not Found' });

        await project.update(req.body); // Body should match model fields
        res.json({ success: true, id: project.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'DB Error' });
    }
};

// Publications API
exports.createPublicationApi = async (req, res) => {
    try {
        const publication = await Publication.create(req.body);
        res.json({ success: true, id: publication.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'DB Error' });
    }
};

exports.updatePublicationApi = async (req, res) => {
    try {
        const publication = await Publication.findByPk(req.params.id);
        if (!publication) return res.status(404).json({ success: false, error: 'Not Found' });

        await publication.update(req.body);
        res.json({ success: true, id: publication.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'DB Error' });
    }
};

// Team API
exports.createTeamMemberApi = async (req, res) => {
    try {
        const member = await TeamMember.create(req.body);
        res.json({ success: true, id: member.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'DB Error' });
    }
};

exports.updateTeamMemberApi = async (req, res) => {
    try {
        const member = await TeamMember.findByPk(req.params.id);
        if (!member) return res.status(404).json({ success: false, error: 'Not Found' });

        await member.update(req.body);
        res.json({ success: true, id: member.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'DB Error' });
    }
};

// --- SETTINGS (Profile & Security) ---

exports.getSettings = (req, res) => {
    res.render('admin/settings', { user: req.user, path: '/settings', success: req.query.success });
};

exports.postSettings = async (req, res) => {
    try {
        const { email, password, new_password, confirm_password } = req.body;
        const user = await User.findByPk(req.user.id);

        // Verify current password logic if strict, 
        // but typically we just verify the user is logged in (which they are).
        // However, standard practice is to ask for OLD password to change NEW password.

        // Simple implementation: Just update if authenticated.

        const updateData = {};
        if (new_password) {
            if (new_password !== confirm_password) {
                return res.render('admin/settings', { user: req.user, path: '/settings', error: 'Passwords do not match' });
            }
            const bcrypt = require('bcryptjs');
            updateData.password = await bcrypt.hash(new_password, 10);
        }

        await user.update(updateData);
        res.redirect('/admin/settings?success=Profile updated');
    } catch (error) {
        console.error(error);
        res.render('admin/settings', {
            user: req.user,
            path: '/settings',
            error: 'Error updating settings'
        });
    }
};

// --- MEDIA LIBRARY ---

exports.getMedia = (req, res) => {
    const uploadDir = path.join(__dirname, '../../public/uploads');
    fs.readdir(uploadDir, (err, files) => {
        if (err) {
            console.error(err);
            files = [];
        }
        // Filter images
        const images = files.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
        res.render('admin/media', { images, path: '/media' });
    });
};

exports.postMedia = (req, res) => {
    // Multer upload handled in route info, just redirect or error handle
    if (!req.file) {
        return res.redirect('/admin/media?error=No+file+uploaded');
    }
    res.redirect('/admin/media?success=Image+uploaded');
};

exports.deleteMedia = (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '../../public/uploads', filename);

    // Security check to prevent directory traversal
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).send('Invalid filename');
    }

    fs.unlink(filePath, (err) => {
        if (err) {
            console.error('Error deleting file:', err);
            return res.redirect('/admin/media?error=Delete+failed');
        }
        res.redirect('/admin/media?success=Image+deleted');
    });
};

// --- GLOBAL SEARCH ---

exports.search = async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.redirect('/admin/dashboard');

        const { Op } = require('sequelize');

        const projects = await Project.findAll({
            where: {
                [Op.or]: [
                    { title: { [Op.like]: `%${query}%` } },
                    { summary: { [Op.like]: `%${query}%` } }
                ]
            },
            limit: 5
        });

        const posts = await Post.findAll({
            where: {
                [Op.or]: [
                    { title: { [Op.like]: `%${query}%` } },
                    { content: { [Op.like]: `%${query}%` } }
                ]
            },
            limit: 5
        });

        const publications = await Publication.findAll({
            where: {
                title: { [Op.like]: `%${query}%` }
            },
            limit: 5
        });

        res.render('admin/search', {
            title: `Search Results for "${query}"`,
            path: '/search',
            query,
            projects,
            posts,
            publications,
            user: req.user
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Search Error');
    }
};

// --- FORM SUBMISSIONS ---

exports.getSubmissionDetail = async (req, res) => {
    try {
        const id = req.params.id;
        const type = req.query.type || 'legacy'; // 'legacy' or 'custom'

        let submission;
        if (type === 'custom') {
            submission = await FormResponse.findOne({
                where: { id },
                include: [{
                    model: CustomForm,
                    include: [{ model: FormField, order: [['order', 'ASC']] }]
                }]
            });
        } else {
            submission = await FormSubmission.findByPk(id);
        }

        if (!submission) {
            return res.status(404).send('Submission not found');
        }

        res.render('admin/submission-detail', {
            title: 'Submission Detail',
            submission,
            type,
            path: '/forms'
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.deleteSubmission = async (req, res) => {
    try {
        const id = req.params.id;
        const type = req.query.type || 'legacy';

        if (type === 'custom') {
            await FormResponse.destroy({ where: { id } });
        } else {
            await FormSubmission.destroy({ where: { id } });
        }

        res.redirect('/admin/dashboard?success=Submission+deleted');
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

// --- NOTIFICATIONS API ---

exports.getNotifications = async (req, res) => {
    try {
        const { Comment } = require('../models');

        // Fetch recent form submissions (last 10)
        const recentSubmissions = await FormSubmission.findAll({
            order: [['createdAt', 'DESC']],
            limit: 5
        });

        // Fetch recent custom form responses (last 10)
        const recentResponses = await FormResponse.findAll({
            include: [{ model: CustomForm, attributes: ['title'] }],
            order: [['createdAt', 'DESC']],
            limit: 5
        });

        // Fetch recent comments
        const recentComments = await Comment.findAll({
            order: [['createdAt', 'DESC']],
            limit: 5
        });

        // Build unified notifications array
        const notifications = [];

        // Add form submissions
        recentSubmissions.forEach(sub => {
            notifications.push({
                id: sub.id,
                type: 'submission',
                title: `New ${sub.type} submission`,
                subtitle: sub.name || sub.email || 'Anonymous',
                link: `/admin/submissions/${sub.id}?type=legacy`,
                createdAt: sub.createdAt
            });
        });

        // Add custom form responses
        recentResponses.forEach(resp => {
            const formTitle = resp.custom_form ? resp.custom_form.title : 'Custom Form';
            notifications.push({
                id: resp.id,
                type: 'form_response',
                title: `New response: ${formTitle}`,
                subtitle: 'New form submission received',
                link: `/admin/submissions/${resp.id}?type=custom`,
                createdAt: resp.createdAt
            });
        });

        // Add comments
        recentComments.forEach(comment => {
            let link = '#';
            if (comment.postId) link = `/admin/comments/post/${comment.postId}`;
            else if (comment.projectId) link = `/admin/comments/project/${comment.projectId}`;

            notifications.push({
                id: comment.id,
                type: 'comment',
                title: 'New comment',
                subtitle: comment.author_name || 'Guest',
                link: link,
                createdAt: comment.createdAt
            });
        });

        // Sort by createdAt (most recent first) and limit to 10
        notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const topNotifications = notifications.slice(0, 10);

        res.json({
            success: true,
            count: topNotifications.length,
            notifications: topNotifications
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

// --- COMMENTS MANAGEMENT ---

exports.getComments = async (req, res) => {
    try {
        const { Op } = require('sequelize');
        const query = req.query.q;

        // If searching, show flat list of matches
        if (query) {
            const comments = await Comment.findAll({
                where: {
                    [Op.or]: [
                        { content: { [Op.like]: `%${query}%` } },
                        { author_name: { [Op.like]: `%${query}%` } }
                    ]
                },
                order: [['createdAt', 'DESC']],
                include: [
                    { model: Post, attributes: ['id', 'title'] },
                    { model: Project, attributes: ['id', 'title'] }
                ]
            });
            return res.render('admin/comments/thread', {
                comments,
                title: `Search Results for "${query}"`,
                path: '/comments'
            });
        }

        // Default: Show list of Threads (Post/Project w/ comments)

        // Ensure threads is defined
        let threads = [];

        try {
            const postsWithComments = await Post.findAll({
                include: [{ model: Comment, required: true, attributes: ['id', 'createdAt'] }],
                attributes: ['id', 'title'],
                group: ['post.id']
            });

            const projectsWithComments = await Project.findAll({
                include: [{ model: Comment, required: true, attributes: ['id', 'createdAt'] }],
                attributes: ['id', 'title'],
                group: ['project.id']
            });

            // Count for Posts
            if (postsWithComments) {
                for (const p of postsWithComments) {
                    const count = await Comment.count({ where: { postId: p.id } });
                    const lastComment = await Comment.findOne({ where: { postId: p.id }, order: [['createdAt', 'DESC']] });
                    threads.push({
                        id: p.id,
                        title: p.title,
                        type: 'Post',
                        count: count || 0,
                        lastActivity: lastComment ? lastComment.createdAt : new Date()
                    });
                }
            }

            // Count for Projects
            if (projectsWithComments) {
                for (const p of projectsWithComments) {
                    const count = await Comment.count({ where: { projectId: p.id } });
                    const lastComment = await Comment.findOne({ where: { projectId: p.id }, order: [['createdAt', 'DESC']] });
                    threads.push({
                        id: p.id,
                        title: p.title,
                        type: 'Project',
                        count: count || 0,
                        lastActivity: lastComment ? lastComment.createdAt : new Date()
                    });
                }
            }

            // Sort by last activity
            threads.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

        } catch (dbError) {
            console.error('Error fetching threads:', dbError);
            // threads remains []
        }

        res.render('admin/comments/index', { threads: threads, path: '/comments' });

    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getThreadComments = async (req, res) => {
    try {
        const { type, id } = req.params;
        const whereClause = {};
        let title = '';

        if (type === 'post') {
            whereClause.postId = id;
            const item = await Post.findByPk(id);
            if (item) title = item.title;
        } else if (type === 'project') {
            whereClause.projectId = id;
            const item = await Project.findByPk(id);
            if (item) title = item.title;
        } else {
            return res.redirect('/admin/comments');
        }

        const comments = await Comment.findAll({
            where: whereClause,
            order: [['createdAt', 'DESC']],
            include: [
                { model: Post, attributes: ['id', 'title'] },
                { model: Project, attributes: ['id', 'title'] }
            ]
        });

        res.render('admin/comments/thread', {
            comments,
            title: `Comments on: ${title}`,
            path: '/comments'
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.deleteComment = async (req, res) => {
    try {
        await Comment.destroy({ where: { id: req.params.id } });
        const backURL = req.header('Referer') || '/admin/comments';
        res.redirect(backURL);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error deleting comment');
    }
};

