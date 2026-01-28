const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { ensureAuthenticated, forwardAuthenticated, checkPermission } = require('../middleware/auth');

// Login Routes
router.get('/login', forwardAuthenticated, adminController.getLogin);
router.post('/login', adminController.postLogin);
router.get('/logout', adminController.logout);

const upload = require('../middleware/upload');

// Dashboard
router.get('/dashboard', ensureAuthenticated, adminController.getDashboard);

// Global Search
router.get('/search', ensureAuthenticated, adminController.search);

// Projects
router.get('/projects', ensureAuthenticated, checkPermission('manage_projects'), adminController.getProjects);
router.get('/projects/new', ensureAuthenticated, checkPermission('manage_projects'), adminController.getNewProject);
router.post('/projects', ensureAuthenticated, checkPermission('manage_projects'), upload.single('image'), adminController.postProject);
router.get('/projects/:id/edit', ensureAuthenticated, checkPermission('manage_projects'), adminController.getEditProject);
router.post('/projects/:id', ensureAuthenticated, checkPermission('manage_projects'), upload.single('image'), adminController.updateProject);
router.post('/projects/:id/delete', ensureAuthenticated, checkPermission('manage_projects'), adminController.deleteProject);

// Publications
const pubUpload = upload.fields([{ name: 'file', maxCount: 1 }, { name: 'image', maxCount: 1 }]);
router.get('/publications', ensureAuthenticated, checkPermission('manage_publications'), adminController.getPublications);
router.get('/publications/new', ensureAuthenticated, checkPermission('manage_publications'), adminController.getNewPublication);
router.post('/publications', ensureAuthenticated, checkPermission('manage_publications'), pubUpload, adminController.postPublication);
router.get('/publications/:id/edit', ensureAuthenticated, checkPermission('manage_publications'), adminController.getEditPublication);
router.post('/publications/:id', ensureAuthenticated, checkPermission('manage_publications'), pubUpload, adminController.updatePublication);
router.post('/publications/:id/delete', ensureAuthenticated, checkPermission('manage_publications'), adminController.deletePublication);

// Posts
router.get('/posts', ensureAuthenticated, checkPermission('manage_posts'), adminController.getPosts);
router.get('/posts/new', ensureAuthenticated, checkPermission('manage_posts'), adminController.getNewPost);
router.post('/posts', ensureAuthenticated, checkPermission('manage_posts'), upload.single('image'), adminController.postPost);
router.get('/import-facebook', ensureAuthenticated, checkPermission('manage_posts'), adminController.getImportFacebook);
router.get('/import-processing', ensureAuthenticated, checkPermission('manage_posts'), adminController.getImportProcessing);

// API Routes for Quill
router.post('/posts/api/create', ensureAuthenticated, checkPermission('manage_posts'), express.json(), adminController.createPostApi);
router.post('/posts/:id/api', ensureAuthenticated, checkPermission('manage_posts'), express.json(), adminController.updatePostApi);

router.get('/posts/:id/edit', ensureAuthenticated, checkPermission('manage_posts'), adminController.getEditPost);
router.post('/posts/:id', ensureAuthenticated, checkPermission('manage_posts'), upload.single('image'), adminController.updatePost);
router.post('/posts/:id/delete', ensureAuthenticated, checkPermission('manage_posts'), adminController.deletePost);
router.post('/posts/:id/status', ensureAuthenticated, checkPermission('manage_posts'), adminController.updatePostStatus);

// Team
router.get('/team', ensureAuthenticated, checkPermission('manage_team'), adminController.getTeam);
router.get('/team/new', ensureAuthenticated, checkPermission('manage_team'), adminController.getNewTeamMember);
router.post('/team', ensureAuthenticated, checkPermission('manage_team'), upload.single('image'), adminController.postTeamMember);
router.get('/team/:id/edit', ensureAuthenticated, checkPermission('manage_team'), adminController.getEditTeamMember);
router.post('/team/:id', ensureAuthenticated, checkPermission('manage_team'), upload.single('image'), adminController.updateTeamMember);
router.post('/team/:id/delete', ensureAuthenticated, checkPermission('manage_team'), adminController.deleteTeamMember);

// Users / Moderators (Admin Only)
// 'manage_users' is not assignable to moderators, so only Admins (via role bypass) can access this.
router.get('/users', ensureAuthenticated, checkPermission('manage_users'), adminController.getUsers);
router.get('/users/new', ensureAuthenticated, checkPermission('manage_users'), adminController.getNewUser);
router.post('/users', ensureAuthenticated, checkPermission('manage_users'), adminController.postUser);
router.post('/users/:id/delete', ensureAuthenticated, checkPermission('manage_users'), adminController.deleteUser);

// API Routes for Quill (All Sections)
router.post('/projects/api/create', ensureAuthenticated, checkPermission('manage_projects'), express.json(), adminController.createProjectApi);
router.post('/projects/:id/api', ensureAuthenticated, checkPermission('manage_projects'), express.json(), adminController.updateProjectApi);

router.post('/publications/api/create', ensureAuthenticated, checkPermission('manage_publications'), express.json(), adminController.createPublicationApi);
router.post('/publications/:id/api', ensureAuthenticated, checkPermission('manage_publications'), express.json(), adminController.updatePublicationApi);

router.post('/team/api/create', ensureAuthenticated, checkPermission('manage_team'), express.json(), adminController.createTeamMemberApi);
router.post('/team/:id/api', ensureAuthenticated, checkPermission('manage_team'), express.json(), adminController.updateTeamMemberApi);

// Custom Forms
router.get('/forms', ensureAuthenticated, checkPermission('manage_forms'), adminController.getForms);
router.get('/forms/new', ensureAuthenticated, checkPermission('manage_forms'), adminController.getNewForm);
router.post('/forms', ensureAuthenticated, checkPermission('manage_forms'), adminController.postForm);
router.get('/forms/:id/builder', ensureAuthenticated, checkPermission('manage_forms'), adminController.getFormBuilder);
router.post('/forms/:id/fields/api', ensureAuthenticated, checkPermission('manage_forms'), express.json(), adminController.saveFormFieldsApi);
router.get('/forms/:id/export', ensureAuthenticated, checkPermission('manage_forms'), adminController.exportFormResponses);
router.get('/forms/:id/responses', ensureAuthenticated, checkPermission('manage_forms'), adminController.getFormResponses);

// Form Submissions (Detail View & Delete)
router.get('/submissions/:id', ensureAuthenticated, adminController.getSubmissionDetail);
router.post('/submissions/:id/delete', ensureAuthenticated, adminController.deleteSubmission);

// Admin Settings
router.get('/settings', ensureAuthenticated, adminController.getSettings);
router.post('/settings', ensureAuthenticated, adminController.postSettings);

// Media Library
router.get('/media', ensureAuthenticated, adminController.getMedia);
router.post('/media', ensureAuthenticated, upload.single('image'), adminController.postMedia);
router.post('/media/:filename/delete', ensureAuthenticated, adminController.deleteMedia);

// Notifications API
router.get('/api/notifications', ensureAuthenticated, adminController.getNotifications);

// Comments Management
router.get('/comments', ensureAuthenticated, adminController.getComments);
router.get('/comments/:type/:id', ensureAuthenticated, adminController.getThreadComments);
router.post('/comments/:id/delete', ensureAuthenticated, adminController.deleteComment);

module.exports = router;
