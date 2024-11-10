const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const File = require('../models/File');
const s3 = require('../config/awsConfig'); // Assuming AWS SDK is properly configured
const multer = require('multer');
const unzipper = require('unzipper'); // For handling folder uploads as zip files

// File size limit (50 MB for example)
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Upload file to S3 and save file metadata in DB
exports.uploadFile = async (req, res) => {
    try {
        const { userId, fileName, parentFolder, size } = req.body;

        if (!req.file || size <= 0) {
            return res.status(400).json({ message: 'File and size must be provided and greater than 0' });
        }

        // Validate file size
        if (size > MAX_FILE_SIZE) {
            return res.status(400).json({ message: `File size exceeds the ${MAX_FILE_SIZE / 1024 / 1024}MB limit` });
        }

        // Read file from request (assuming you're using multer for file uploads)
        const fileContent = fs.readFileSync(req.file.path);

        // Define the S3 upload parameters
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${userId}/${fileName}`, // Path in the S3 bucket
            Body: fileContent,
            ContentType: req.file.mimetype
        };

        // Upload file to S3
        s3.upload(params, async (err, data) => {
            if (err) {
                console.error('Error uploading to S3:', err);
                return res.status(500).json({ message: 'Failed to upload to S3', error: err.message });
            }

            // File upload successful, save file details in the database
            const newFile = new File({
                userId,
                fileName,
                path: data.Location, // URL of the uploaded file in S3
                parentFolder: parentFolder || null,
                size,
                isFolder: false
            });

            await newFile.save();

            // Update the size of the parent folder recursively, if applicable
            if (parentFolder) {
                await updateFolderSizeRecursively(parentFolder);
            }

            // Delete the local file after uploading to S3
            fs.unlinkSync(req.file.path);

            res.status(201).json({ message: 'File uploaded successfully', file: newFile });
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Handle uploading an entire folder by first compressing it into a zip file
exports.uploadFolder = async (req, res) => {
    try {
        const { userId, parentFolder } = req.body;

        // Extract the zip file containing the folder from the request
        if (!req.file) {
            return res.status(400).json({ message: 'No folder (zip file) provided' });
        }

        const zipPath = req.file.path;

        // Unzip the file and get all files inside the folder
        fs.createReadStream(zipPath)
            .pipe(unzipper.Extract({ path: 'uploads/unzipped' }))
            .on('close', async () => {
                const folderPath = path.join(__dirname, 'uploads/unzipped');
                const folderFiles = await getAllFilesInFolder(folderPath);

                // Upload all files inside the folder to S3
                const folderPromises = folderFiles.map(file => uploadFileToS3(file, userId, parentFolder));
                const uploadedFiles = await Promise.all(folderPromises);

                // Optionally: Save metadata of uploaded files to the DB
                const newFiles = await Promise.all(
                    uploadedFiles.map(async (file) => {
                        const newFile = new File({
                            userId,
                            fileName: file.fileName,
                            path: file.s3Url,
                            parentFolder,
                            size: file.size,
                            isFolder: false,
                        });
                        return newFile.save();
                    })
                );

                // Delete the unzipped files from the local server after uploading
                fs.rmSync(folderPath, { recursive: true, force: true });

                res.status(201).json({ message: 'Folder and its files uploaded successfully', files: newFiles });
            })
            .on('error', (err) => {
                console.error('Error unzipping folder:', err);
                res.status(500).json({ message: 'Failed to unzip folder', error: err.message });
            });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Helper function to get all files inside a folder, including nested subfolders
const getAllFilesInFolder = async (folderPath) => {
    const files = [];
    const items = fs.readdirSync(folderPath);

    for (let item of items) {
        const fullPath = path.join(folderPath, item);
        const stat = fs.lstatSync(fullPath);

        if (stat.isDirectory()) {
            const nestedFiles = await getAllFilesInFolder(fullPath);
            files.push(...nestedFiles);
        } else {
            files.push(fullPath);
        }
    }
    return files;
};

// Helper function to upload files to S3
const uploadFileToS3 = async (filePath, userId, parentFolder) => {
    const fileName = path.basename(filePath);
    const fileContent = fs.readFileSync(filePath);
    const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `${userId}/${fileName}`,
        Body: fileContent,
        ContentType: 'application/octet-stream', // You can improve this by setting specific mime types
    };

    return new Promise((resolve, reject) => {
        s3.upload(params, async (err, data) => {
            if (err) {
                reject(err);
            } else {
                const file = {
                    fileName,
                    s3Url: data.Location,
                    size: fs.statSync(filePath).size,
                };
                resolve(file);
            }
        });
    });
};

// Download individual file from S3
exports.downloadFile = (req, res) => {
    const { fileId } = req.params;

    File.findById(fileId, async (err, file) => {
        if (err || !file) {
            return res.status(404).json({ message: 'File not found' });
        }

        // Fetch the file from S3 and stream it back to the user
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: file.fileName, // Adjust path if necessary
        };

        s3.getObject(params, (err, data) => {
            if (err) {
                return res.status(500).json({ message: 'Error downloading file', error: err.message });
            }

            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename=${file.fileName}`);
            res.send(data.Body);
        });
    });
};

// Download the entire folder (simulated by downloading its contents)
exports.downloadFolder = async (req, res) => {
    const { folderId } = req.params;

    const filesInFolder = await File.find({ parentFolder: folderId });

    if (!filesInFolder.length) {
        return res.status(404).json({ message: 'No files in this folder to download' });
    }

    // Create a zip of the folder files to download
    const zipPath = path.join(__dirname, 'uploads', 'folder.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = require('archiver')('zip');

    archive.pipe(output);

    const filePromises = filesInFolder.map((file) => {
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: file.fileName,
        };

        return new Promise((resolve, reject) => {
            s3.getObject(params, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    archive.append(data.Body, { name: file.fileName });
                    resolve();
                }
            });
        });
    });

    try {
        await Promise.all(filePromises);
        archive.finalize();

        output.on('close', () => {
            res.download(zipPath, 'folder.zip', (err) => {
                if (err) {
                    console.error('Error sending folder download:', err);
                }

                // Optionally: Clean up the zip file after download
                fs.unlinkSync(zipPath);
            });
        });
    } catch (err) {
        res.status(500).json({ message: 'Error downloading folder', error: err.message });
    }
};
