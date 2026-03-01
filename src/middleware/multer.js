const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const AVATARS_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
const FILES_DIR = path.join(__dirname, '..', '..', 'uploads', 'files');

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // quick access test
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (err) {
    console.error('Failed to create or access upload directory', dir, err);
    throw err;
  }
}

function createAvatarUpload() {
  ensureDir(AVATARS_DIR);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, AVATARS_DIR);
    },
    filename: (req, file, cb) => {
      const userId = req.user?.id || 'unknown';
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const unique = crypto.randomBytes(8).toString('hex');
      cb(null, `${userId}-${Date.now()}-${unique}${ext}`);
    },
  });

  const fileFilter = (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const mimetype = (file.mimetype || '').toLowerCase();
    if (!mimetype) return cb(new Error('Missing mimetype'));
    if (allowed.includes(mimetype)) {
      // also check extension
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!ext || !['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        return cb(new Error('Invalid file extension'));
      }
      cb(null, true);
    } else {
      cb(new Error('Only JPG, JPEG, PNG, and WEBP images are allowed'));
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 },
  }).single('avatar');
}

function createDocumentUpload() {
  ensureDir(FILES_DIR);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, FILES_DIR);
    },
    filename: (req, file, cb) => {
      const userId = req.user?.id || 'unknown';
      const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
      const unique = crypto.randomBytes(8).toString('hex');
      cb(null, `${userId}-${Date.now()}-${unique}${ext}`);
    },
  });

  const fileFilter = (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const mimetype = (file.mimetype || '').toLowerCase();
    if (!mimetype) return cb(new Error('Missing mimetype'));
    if (allowed.includes(mimetype)) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!ext || !['.pdf', '.doc', '.docx'].includes(ext)) {
        return cb(new Error('Invalid file extension'));
      }
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  }).single('file');
}

module.exports = { createAvatarUpload, createDocumentUpload };
