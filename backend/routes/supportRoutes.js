const express = require('express');
const controller = require('../controllers/supportController');

const router = express.Router();
router.get('/threads', controller.listThreads);
router.post('/threads', controller.createThread);
router.get('/threads/:id/messages', controller.listMessages);
router.post('/threads/:id/messages', controller.createMessage);
router.patch('/threads/:id', controller.updateThread);

module.exports = router;
