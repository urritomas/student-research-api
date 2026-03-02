const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const usersRouter = require('./modules/users/users.routes');
const userRouter = require('./modules/user/user.routes');
const authRouter = require('./modules/auth/auth.routes');
const uploadRouter = require('./modules/upload/upload.routes');
const projectsRouter = require('./modules/projects/projects.routes');
const notificationsRouter = require('./modules/notifications/notifications.routes');
const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' })); // For parsing application/json (allow base64 payloads)
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // For parsing application/x-www-form-urlencoded
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/users', usersRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/notifications', notificationsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  if (err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: err.message || 'File upload error' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = app;
