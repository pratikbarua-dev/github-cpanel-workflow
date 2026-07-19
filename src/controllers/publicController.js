const { Project, Post, TeamMember, Publication, FormSubmission, CustomForm, FormField, FormResponse, Like, Comment, Partner } = require('../models');
const emailService = require('../utils/emailService');
const Sequelize = require('sequelize');
const svgCaptcha = require('svg-captcha');

exports.getHome = async (req, res) => {
    try {
        const projects = await Project.findAll({
            where: { status: { [Sequelize.Op.ne]: 'Archived' } },
            limit: 3,
            order: [['createdAt', 'DESC']]
        });
        const newsPosts = await Post.findAll({
            where: {
                status: 'published',
                type: ['News', 'Event']
            },
            limit: 3,
            order: [['date', 'DESC']]
        });

        const articlePosts = await Post.findAll({
            where: {
                status: 'published',
                type: 'Article'
            },
            limit: 3,
            order: [['date', 'DESC']]
        });

        res.render('index', { title: 'Home', projects, newsPosts, articlePosts });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getProjects = async (req, res) => {
    try {
        const projects = await Project.findAll({
            where: { status: { [Sequelize.Op.ne]: 'Archived' } },
            order: [['createdAt', 'DESC']]
        });
        res.render('projects', { title: 'Projects', projects });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getProjectDetail = async (req, res) => {
    try {
        const project = await Project.findOne({ where: { slug: req.params.slug } });
        if (!project) return res.status(404).render('404', { title: 'Not Found' });

        const comments = await Comment.findAll({
            where: { projectId: project.id, status: 'approved' },
            order: [['createdAt', 'DESC']]
        });

        console.log('Client IP:', req.ip);
        const isLiked = await Like.findOne({
            where: {
                ip_address: req.ip,
                projectId: project.id
            }
        });
        console.log('Is Liked Query Result:', isLiked);

        res.render('project-detail', { title: project.title, project, comments, isLiked: !!isLiked });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getPostDetail = async (req, res) => {
    try {
        const post = await Post.findOne({ where: { slug: req.params.slug } });
        if (!post) return res.status(404).render('404', { title: 'Not Found' });

        // Fetch comments for this post
        const comments = await Comment.findAll({
            where: { postId: post.id, status: 'approved' },
            order: [['createdAt', 'DESC']]
        });

        const isLiked = await Like.findOne({
            where: {
                ip_address: req.ip,
                postId: post.id
            }
        });

        res.render('post-detail', { title: post.title, post, comments, isLiked: !!isLiked });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getNews = async (req, res) => {
    try {
        const posts = await Post.findAll({
            where: {
                status: 'published',
                type: { [Sequelize.Op.in]: ['News', 'Event', 'Article'] }
            },
            order: [['date', 'DESC']]
        });
        res.render('news', { title: 'News & Articles', posts });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getPublications = async (req, res) => {
    try {
        const publications = await Publication.findAll({
            where: { is_archived: false },
            order: [['published_date', 'DESC']]
        });
        res.render('publications', { title: 'Publications', publications });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getPublicationDetail = async (req, res) => {
    try {
        const publication = await Publication.findByPk(req.params.id);
        if (!publication) return res.status(404).render('404', { title: 'Not Found' });

        res.render('publication-detail', { title: publication.title, publication });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getTeam = async (req, res) => {
    try {
        const team = await TeamMember.findAll({ order: [['display_order', 'ASC']] });
        res.render('team', { title: 'Our Team', team });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getTeamDetail = async (req, res) => {
    try {
        const member = await TeamMember.findByPk(req.params.id);
        if (!member) return res.status(404).render('404', { title: 'Not Found' });
        res.render('team-detail', { title: member.name, member });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getContact = (req, res) => {
    res.render('contact', { title: 'Contact Us' });
};

exports.postContact = async (req, res) => {
    try {
        if (!req.session.captcha || req.body.captcha !== req.session.captcha) {
            return res.render('contact', {
                title: 'Contact Us',
                error: 'Invalid CAPTCHA. Please try again.',
                formData: req.body // Pass back data to repopulate form
            });
        }
        req.session.captcha = null; // Clear captcha

        await FormSubmission.create(req.body);

        // Send Email Notification to Admin
        const emailSubject = `New Contact Message: ${req.body.subject}`;
        const emailBody = `
            <h3>New Message from Website</h3>
            <p><strong>Name:</strong> ${req.body.name}</p>
            <p><strong>Email:</strong> ${req.body.email}</p>
            <p><strong>Subject:</strong> ${req.body.subject}</p>
            <p><strong>Message:</strong></p>
            <p>${req.body.message}</p>
        `;
        await emailService.sendEmail('morph@morphbangladesh.org', emailSubject, emailBody);

        // Send Professional Auto-Reply to User
        const userSubject = `We received your message: ${req.body.subject}`;
        const userMessage = `
            <p>Thank you for contacting MoRPH. We have received your message and will get back to you shortly.</p>
        `;
        await emailService.sendAutoReply(req.body.email, req.body.name, userSubject, userMessage);

        res.render('contact', { title: 'Contact Us', success: 'Message sent successfully!' });
    } catch (error) {
        console.error(error);
        res.render('contact', { title: 'Contact Us', error: 'Error sending message.' });
    }
};

exports.getAbout = (req, res) => {
    res.render('about', { title: 'Who We Are - MoRPH' });
};

exports.getFocusAreas = (req, res) => {
    res.render('focus-areas', { title: 'Focus Areas - MoRPH' });
};

exports.getPartnerships = async (req, res) => {
    try {
        const partners = await Partner.findAll({ order: [['display_order', 'ASC']] });
        res.render('partnerships', { title: 'Partnerships - MoRPH', partners });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getPartnerWithUs = (req, res) => {
    res.render('partner-with-us', { title: 'Partner With Us - MoRPH' });
};

exports.getTraining = async (req, res) => {
    try {
        const posts = await Post.findAll({
            where: {
                status: 'published',
                type: 'Training'
            },
            order: [['date', 'DESC']]
        });
        res.render('news', { title: 'Training & Workshops', posts });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getCSRSection = async (req, res) => {
    try {
        const subSection = req.params.sub_section;

        // Check if this section slug has been renamed — redirect if so
        const { GlobalSetting } = require('../models');
        const redirectSetting = await GlobalSetting.findOne({ where: { key: 'csr_section_redirects' } });
        if (redirectSetting) {
            const redirects = JSON.parse(redirectSetting.value);
            let target = subSection.toLowerCase();
            // Follow redirect chain (in case of multiple renames)
            while (redirects[target]) {
                target = redirects[target];
            }
            if (target !== subSection.toLowerCase()) {
                return res.redirect(301, `/csr/${target}`);
            }
        }

        // Normalize the subSection name (replace hyphens back to spaces if needed)
        const posts = await Post.findAll({
            where: {
                status: 'published',
                type: 'CSR',
                [Sequelize.Op.or]: [
                    Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('sub_type')), subSection.toLowerCase().replace(/-/g, ' ')),
                    Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('sub_type')), subSection.toLowerCase())
                ]
            },
            order: [['date', 'DESC']]
        });

        // Find the actual sub-section name for the title
        const displayTitle = subSection.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

        res.render('news', { title: `CSR: ${displayTitle}`, posts });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getEvents = async (req, res) => {
    try {
        const posts = await Post.findAll({
            where: {
                status: 'published',
                type: 'Event'
            },
            order: [['date', 'DESC']]
        });
        res.render('events', { title: 'Events', posts });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getGetInvolved = (req, res) => {
    // Landing page for involvement options
    res.render('get-involved', { title: 'Get Involved' });
};

exports.getApply = async (req, res) => {
    try {
        const { GlobalSetting } = require('../models');
        const appTypesSetting = await GlobalSetting.findOne({ where: { key: 'application_types' } });
        const applicationTypes = appTypesSetting ? JSON.parse(appTypesSetting.value) : ['Volunteer', 'Internship', 'Partnership', 'Researcher'];

        res.render('apply', { title: 'Apply - MoRPH', applicationTypes });
    } catch (error) {
        console.error(error);
        res.render('apply', { title: 'Apply - MoRPH', applicationTypes: ['Volunteer', 'Internship', 'Partnership', 'Researcher'] });
    }
};

exports.postApply = async (req, res) => {
    try {
        const { name, email, message, type, captcha } = req.body;

        if (!req.session.captcha || captcha !== req.session.captcha) {
            return res.render('apply', {
                title: 'Apply - MoRPH',
                error: 'Invalid CAPTCHA. Please try again.',
                formData: req.body
            });
        }
        req.session.captcha = null;

        const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

        await FormSubmission.create({
            type: type || 'Application',
            name,
            email,
            message: message + (req.file ? ` [Attached: ${req.file.originalname}]` : ''),
            file_url: fileUrl,
            status: 'New'
        });


        // Send Email Notification to Admin
        const appSubject = `New Application: ${type} - ${name}`;
        const appBody = `
            <h3>New Application Received</h3>
            <p><strong>Type:</strong> ${type}</p>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Message:</strong></p>
            <p>${message}</p>
            ${fileUrl ? `<p><strong>Attachment:</strong> <a href="${process.env.BASE_URL || 'https://morphbangladesh.org'}${fileUrl}">View File</a></p>` : ''}
        `;
        await emailService.sendEmail('morph@morphbangladesh.org', appSubject, appBody);

        // Send Professional Auto-Reply to User
        const userAppSubject = `Application Received: ${type}`;
        const userAppMessage = `
            <p>Thank you for your interest in MoRPH. We have received your application for <strong>${type}</strong>.</p>
            <p>Our team will review your details and contact you if your profile matches our requirements.</p>
        `;
        await emailService.sendAutoReply(email, name, userAppSubject, userAppMessage);

        res.render('contact', { title: 'Application Received', success: 'Thank you! Your application has been submitted successfully.' });
    } catch (error) {
        console.error(error);
        res.render('contact', { title: 'Get Involved', error: 'Error submitting application.' });
    }
};

exports.getSearch = async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.render('search', { title: 'Search', results: [] });

        const { Op } = require('sequelize');
        const projects = await Project.findAll({
            where: {
                [Op.or]: [
                    { title: { [Op.like]: `%${query}%` } },
                    { summary: { [Op.like]: `%${query}%` } },
                    { content: { [Op.like]: `%${query}%` } }
                ]
            },
            limit: 5
        });

        const posts = await Post.findAll({
            where: {
                status: 'published',
                [Op.or]: [
                    { title: { [Op.like]: `%${query}%` } },
                    { content: { [Op.like]: `%${query}%` } },
                    { excerpt: { [Op.like]: `%${query}%` } }
                ]
            },
            limit: 5
        });

        const publications = await Publication.findAll({
            where: {
                [Op.or]: [
                    { title: { [Op.like]: `%${query}%` } },
                    { description: { [Op.like]: `%${query}%` } }
                ]
            },
            limit: 5
        });

        res.render('search', { title: `Search Results: ${query}`, query, projects, posts, publications });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getForm = async (req, res) => {
    try {
        const form = await CustomForm.findOne({
            where: { slug: req.params.slug, status: 'Active' },
            include: [{ model: FormField }]
        });

        if (!form) return res.status(404).render('404', { title: 'Form Not Found' });

        // Sort fields
        if (form.form_fields) {
            form.form_fields.sort((a, b) => a.order - b.order);
        }

        res.render('form-render', { title: form.title, form });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.submitForm = async (req, res) => {
    try {
        const form = await CustomForm.findByPk(req.params.id);
        if (!form) return res.status(404).send('Form not found');

        // Capture all body data
        const formData = JSON.stringify(req.body);

        await FormResponse.create({
            customFormId: form.id,
            data: formData,
            ip_address: req.ip
        });

        // Fetch form with fields to map names
        const formWithFields = await CustomForm.findByPk(req.params.id, {
            include: [{ model: FormField }]
        });

        // Construct HTML data table
        let dataTable = '<table style="width:100%; border-collapse: collapse;">';

        // Helper to find label by field ID
        const getLabel = (key) => {
            if (!formWithFields || !formWithFields.form_fields) return key;
            const field = formWithFields.form_fields.find(f => `field_${f.id}` === key || f.name === key);
            return field ? field.label : key;
        };

        for (const [key, value] of Object.entries(req.body)) {
            // Skip automated fields if necessary, or just show everything
            dataTable += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; width: 40%;">${getLabel(key)}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${value}</td>
                </tr>
            `;
        }
        dataTable += '</table>';

        // Send Professional Email Notification to Admin
        const adminSubject = `New Submission: ${form.title}`;
        const adminMessage = `
            <h3>New Form Submission Received</h3>
            <p><strong>Form:</strong> ${form.title}</p>
            <p><strong>Submission Details:</strong></p>
            ${dataTable}
        `;
        await emailService.sendAutoReply('morph@morphbangladesh.org', 'Admin', adminSubject, adminMessage);

        // Send Professional Auto-Reply to User (Intelligent Field Detection)
        let userEmail = null;
        let userName = 'User';

        if (formWithFields && formWithFields.form_fields) {
            // Priority 1: Find field of type 'email'
            const emailField = formWithFields.form_fields.find(f => f.type === 'email');
            if (emailField) {
                // Try finding value by ID (field_123) or exact name
                const keyById = `field_${emailField.id}`;
                userEmail = req.body[keyById] || req.body[emailField.name];
            }

            // Priority 2: If no type='email', look for label containing "Email"
            if (!userEmail) {
                const labelEmailField = formWithFields.form_fields.find(f => f.label.toLowerCase().includes('email'));
                if (labelEmailField) {
                    const keyById = `field_${labelEmailField.id}`;
                    userEmail = req.body[keyById] || req.body[labelEmailField.name];
                }
            }

            // Attempt to find Name for personalization
            const nameField = formWithFields.form_fields.find(f => f.label.toLowerCase().includes('name'));
            if (nameField) {
                const keyById = `field_${nameField.id}`;
                userName = req.body[keyById] || req.body[nameField.name] || 'User';
            }
        }

        // Fallback: Check standard keys
        if (!userEmail) {
            userEmail = req.body.email || req.body.Email;
        }

        if (userEmail) {
            const formUserSubject = `Submission Received: ${form.title}`;
            const formUserMessage = `
                <p>Thank you for your submission to <strong>${form.title}</strong>.</p>
                <p>We have successfully recorded your response. Here is a copy of the information you submitted:</p>
                ${dataTable}
            `;
            await emailService.sendAutoReply(userEmail, userName, formUserSubject, formUserMessage);
        }

        res.render('form-success', { title: 'Submission Received', form });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error submitting form');
    }
};

exports.postLike = async (req, res) => {
    try {
        const { type, id } = req.params;
        const ip_address = req.ip;

        // Simple spam check: limit likes per IP per item
        const existingLike = await Like.findOne({
            where: {
                ip_address,
                [type === 'project' ? 'projectId' : 'postId']: id
            }
        });

        if (existingLike) {
            return res.status(400).json({ error: 'You have already liked this.' });
        }

        await Like.create({
            ip_address,
            [type === 'project' ? 'projectId' : 'postId']: id
        });

        res.json({ success: true, message: 'Liked!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server Error' });
    }
};

exports.postComment = async (req, res) => {
    try {
        const { type, id } = req.params;
        const { content, author_name } = req.body;

        if (!content) return res.status(400).json({ error: 'Comment cannot be empty.' });

        await Comment.create({
            content,
            author_name: author_name || 'Guest',
            status: 'approved', // Auto-approve for testing
            [type === 'project' ? 'projectId' : 'postId']: id
        });

        res.json({ success: true, message: 'Comment posted!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server Error' });
    }
};

exports.getCaptcha = (req, res) => {
    const captcha = svgCaptcha.create();
    req.session.captcha = captcha.text;

    res.type('svg');
    res.status(200).send(captcha.data);
};

exports.getSitemap = async (req, res) => {
    try {
        const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        const escapeXml = (unsafe) => {
            return unsafe.replace(/[<>&'"]/g, (c) => {
                switch (c) {
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '&': return '&amp;';
                    case "'": return '&apos;';
                    case '"': return '&quot;';
                }
            });
        };

        const addUrl = (path, updatedAt = null) => {
            const loc = escapeXml(`${baseUrl}${path}`);
            xml += `  <url>\n    <loc>${loc}</loc>\n`;
            if (updatedAt) {
                try {
                    const dateStr = new Date(updatedAt).toISOString().split('T')[0];
                    xml += `    <lastmod>${dateStr}</lastmod>\n`;
                } catch(e) {}
            }
            xml += `  </url>\n`;
        };

        // Static routes
        const staticRoutes = [
            '/', '/projects', '/news', '/publications', '/team', '/contact', 
            '/about', '/focus-areas', '/partnerships', '/events', '/partner-with-us', 
            '/training', '/get-involved', '/apply'
        ];
        staticRoutes.forEach(route => addUrl(route));

        // Dynamic Routes - Projects
        const projects = await Project.findAll({ where: { status: { [Sequelize.Op.ne]: 'Archived' } } });
        projects.forEach(p => { if (p.slug) addUrl(`/projects/${p.slug}`, p.updatedAt); });

        // Dynamic Routes - Posts
        const posts = await Post.findAll({ where: { status: 'published' } });
        posts.forEach(p => { if (p.slug) addUrl(`/news/${p.slug}`, p.updatedAt); });

        // Dynamic Routes - Publications
        const publications = await Publication.findAll({ where: { is_archived: false } });
        publications.forEach(p => { if (p.id) addUrl(`/publications/${p.id}`, p.updatedAt); });

        // Dynamic Routes - Team
        const team = await TeamMember.findAll();
        team.forEach(t => { if (t.id) addUrl(`/team/${t.id}`, t.updatedAt); });

        // Dynamic Routes - Forms
        const forms = await CustomForm.findAll({ where: { status: 'Active' } });
        forms.forEach(f => { if (f.slug) addUrl(`/forms/${f.slug}`, f.updatedAt); });

        xml += '</urlset>';

        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error generating sitemap');
    }
};

exports.getRobotsTxt = (req, res) => {
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    const robotsTxt = `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`;
    res.type('text/plain');
    res.send(robotsTxt);
};
