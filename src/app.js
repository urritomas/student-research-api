const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { corsOrigins, uploadBase, trustProxy, isProduction } = require('../config/env');
const usersRouter = require('./modules/users/users.routes');
const userRouter = require('./modules/user/user.routes');
const authRouter = require('./modules/auth/auth.routes');
const uploadRouter = require('./modules/upload/upload.routes');
const projectsRouter = require('./modules/projects/projects.routes');
const notificationsRouter = require('./modules/notifications/notifications.routes');
const paperVersionsRouter = require('./modules/paper_versions/paper_versions.routes');
const defensesRouter = require('./modules/defenses/defenses.routes');
const coordinatorRouter = require('./modules/coordinator/coordinator.routes');
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', trustProxy);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser and same-origin requests with no Origin header.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' })); // For parsing application/json (allow base64 payloads)
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // For parsing application/x-www-form-urlencoded
app.use('/uploads', express.static(uploadBase, {
  maxAge: isProduction ? '1d' : 0,
}));

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/users', usersRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/projects/:id/paper-versions', paperVersionsRouter);
app.use('/api/defenses', defensesRouter);
app.use('/api/coordinator', coordinatorRouter);

app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS origin denied' });
  }

  if (isProduction) {
    console.error('[error]', err.message);
  } else {
    console.error(err);
  }

  if (err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: err.message || 'File upload error' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = app;
