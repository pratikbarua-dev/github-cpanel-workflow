const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');
const upload = require('../middleware/upload');

router.get('/', publicController.getHome);
router.get('/projects', publicController.getProjects);
router.get('/projects/:slug', publicController.getProjectDetail);
router.get('/news', publicController.getNews);
router.get('/news/:slug', publicController.getPostDetail);
router.get('/publications', publicController.getPublications);
router.get('/publications/:id', publicController.getPublicationDetail);
router.get('/team', publicController.getTeam);
router.get('/contact', publicController.getContact);
router.post('/contact', publicController.postContact);

// Static Content Pages
router.get('/about', publicController.getAbout);
router.get('/focus-areas', publicController.getFocusAreas);
router.get('/partnerships', publicController.getPartnerships);
router.get('/events', publicController.getEvents);
router.get('/partner-with-us', publicController.getPartnerWithUs);

// Apply / Get Involved
router.get('/get-involved', publicController.getGetInvolved); // "Apply" page
router.get('/apply', publicController.getApply); // Dedicated apply form
router.post('/apply', upload.single('file'), publicController.postApply); // Form submission

// Search
router.get('/search', publicController.getSearch);

// Custom Forms
router.get('/forms/:slug', publicController.getForm);
router.post('/forms/:id/submit', publicController.submitForm);

// CAPTCHA
router.get('/captcha', publicController.getCaptcha);

// Like and Comment API routes
router.post('/api/like/:type/:id', publicController.postLike);
router.post('/api/comment/:type/:id', publicController.postComment);

module.exports = router;
