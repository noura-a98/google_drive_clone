const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');

// Route to upload a file to S3
router.post('/upload', fileController.uploadFile);

// Route to upload a folder (as a zip file)
router.post('/upload-folder', fileController.uploadFolder);

// Route to create a folder (if needed)
router.post('/create-folder', fileController.createFolder);

// Route to get all files of a user
router.get('/user-files/:userId', fileController.getUserFiles);

// Route to get the contents of a folder
router.get('/folder/:folderId', fileController.getFolderContents);

// Route to download an individual file from S3
router.get('/download-file/:fileId', fileController.downloadFile);

// Route to download an entire folder as a zip file
router.get('/download-folder/:folderId', fileController.downloadFolder);

module.exports = router;
