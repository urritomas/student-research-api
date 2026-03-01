const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

const UPLOADS_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'avatars');

function ensureUploadsDir() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    fs.accessSync(UPLOADS_DIR, fs.constants.W_OK);
  } catch (err) {
    console.error('Unable to create or write to uploads dir', UPLOADS_DIR, err);
    throw err;
  }
}

ensureUploadsDir();

async function uploadAvatar(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fullPath = path.join(UPLOADS_DIR, req.file.filename);

    // Validate image integrity by probing with sharp
    try {
      await sharp(fullPath).metadata();
    } catch (err) {
      console.error('Uploaded file is not a valid image, deleting', fullPath, err);
      // attempt to remove corrupted file
      try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
      return res.status(400).json({ error: 'Uploaded image is corrupt or invalid' });
    }

    const publicUrl = `/uploads/avatars/${req.file.filename}`;
    return res.json({ publicUrl });
  } catch (err) {
    console.error('uploadAvatar error', err);
    return res.status(500).json({ error: 'Failed to process upload' });
  }
}

/**
 * Accepts a base64 data URL in `req.body.image` and saves a cropped/compressed avatar.
 * Expected body: { image: 'data:image/png;base64,...' }
 */
async function uploadCropped(req, res) {
  try {
    const { image } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const matches = image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Invalid image data' });

    const mime = matches[1];
    const base64 = matches[2];
    const ext = mime.split('/')[1] || 'png';

    const buffer = Buffer.from(base64, 'base64');

    // Use sharp to normalize: crop to square (if needed), resize, and compress
    const filename = `${req.user?.id || 'unknown'}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
    const dest = path.join(UPLOADS_DIR, filename);

    try {
      await sharp(buffer)
        .rotate()
        .resize(512, 512, { fit: 'cover' })
        .webp({ quality: 85 })
        .toFile(dest);
    } catch (err) {
      console.error('Failed to process cropped image', err);
      return res.status(400).json({ error: 'Failed to process image' });
    }

    const publicUrl = `/uploads/avatars/${filename}`;
    return res.json({ publicUrl });
  } catch (err) {
    console.error('uploadCropped error', err);
    return res.status(500).json({ error: 'Failed to save cropped image' });
  }
}

module.exports = { uploadAvatar, uploadCropped };
