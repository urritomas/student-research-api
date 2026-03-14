# student-research-api

Express 5 + MySQL backend for the Student Research Platform.

## Deploy to Railway (Backend + Database + Persistent Uploads)

Follow these steps in order.

### 1) Push this backend to GitHub
Railway deploys from a GitHub repository.

### 2) Create a Railway project for the API
1. In Railway, click **New Project**.
2. Select **Deploy from GitHub Repo**.
3. Pick this repository.

Railway will run `pnpm start` automatically (already configured in `package.json`).

### 3) Create a MySQL database in Railway
1. Inside the same Railway project, click **New**.
2. Add **MySQL**.
3. Open the MySQL service and copy its connection values.

Use the **internal** MySQL connection values when API and DB are in the same Railway project.

### 4) Add a persistent volume for file uploads
Railway filesystem is ephemeral, so uploaded files must be written to a mounted volume.

1. Open the backend service in Railway.
2. Go to **Settings -> Volumes -> Add Volume**.
3. Set mount path to `/mnt/uploads`.
4. Save.

### 5) Configure backend environment variables
In backend service -> **Variables**, add:

| Variable | Required | Example |
|---|---|---|
| `NODE_ENV` | Yes | `production` |
| `DB_HOST` | Yes | from Railway MySQL |
| `DB_PORT` | Yes | `3306` |
| `DB_NAME` | Yes | from Railway MySQL |
| `DB_USER` | Yes | from Railway MySQL |
| `DB_PASSWORD` | Yes | from Railway MySQL |
| `JWT_SECRET` | Yes | min 32 random chars |
| `UPLOAD_PATH` | Yes | `/mnt/uploads` |
| `CLIENT_URL` | Recommended | `https://your-frontend.up.railway.app` |
| `CORS_ORIGINS` | Recommended | comma-separated frontend origins |
| `TRUST_PROXY` | Recommended | `1` |

Notes:
- Do not manually set `PORT`; Railway injects it automatically.
- In production, server startup will fail if required DB vars or `JWT_SECRET` are missing.

### 6) First deploy
Push to the connected branch (usually `main`). Railway will build and start the API.

### 7) Run database migrations
After first deploy, open backend service -> **Shell** and run:

```sh
pnpm run migrate
```

Run this command again every time you add new files in `migrations/`.

### 8) Verify deployment
Check backend logs for:
- `Database connected successfully`
- `running on http://localhost:<PORT>`

Test endpoints:
- `GET /health` should return status `ok`
- Upload endpoint should save files and return `/uploads/...` paths

### 9) Verify upload persistence
1. Upload a file through the API.
2. Redeploy the backend service.
3. Download the same uploaded file again.

If it still exists, volume persistence is working.

## Why uploads stay persistent in this project
- Upload middleware stores files under `UPLOAD_PATH` when provided.
- Static file serving uses the same upload base path.
- With `UPLOAD_PATH=/mnt/uploads` and a Railway volume mounted at `/mnt/uploads`, files survive restarts/redeploys.

## Quick troubleshooting

### App starts but DB queries fail
- Recheck `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- Confirm backend and MySQL are in the same Railway project (or use external DB public credentials).

### CORS blocked
- Set `CLIENT_URL` and/or `CORS_ORIGINS` correctly.
- If multiple origins are needed, use comma-separated values in `CORS_ORIGINS`.

### Uploaded files disappear after deploy
- Confirm volume exists and is mounted at `/mnt/uploads`.
- Confirm `UPLOAD_PATH=/mnt/uploads` is set in backend variables.
