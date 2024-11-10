const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    fileName: {
        type: String,
        required: true
    },
    path: {
        type: String,
        required: true
    },
    parentFolder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File',
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    isFolder: {
        type: Boolean,
        default: false
    },
    size: {
        type: Number, // Size in bytes
        required: true,
        default: 0 
    }
});

module.exports = mongoose.model('File', fileSchema);
