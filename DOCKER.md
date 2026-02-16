# Docker Setup

This project includes Docker configuration for easy development and deployment.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose (included with Docker Desktop)

## Quick Start

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and update the values as needed.

2. **Start the application:**
   ```bash
   pnpm docker:up
   # or
   docker-compose up -d
   ```

3. **View logs:**
   ```bash
   pnpm docker:logs
   # or
   docker-compose logs -f api
   ```

4. **Stop the application:**
   ```bash
   pnpm docker:down
   # or
   docker-compose down
   ```

## Available Services

### API Service
- **Container:** `student-research-api`
- **Port:** 3000 (configurable via `PORT` in `.env`)
- **URL:** http://localhost:3000

### Database Service
- **Container:** `student-research-db`
- **Type:** MySQL 8.0
- **Port:** 3306 (configurable via `DB_PORT` in `.env`)
- **Data:** Persisted in Docker volume `mysql_data`

## Development Workflow

The docker-compose setup mounts your local code into the container, so changes you make will automatically restart the server (using nodemon).

### Useful Commands

```bash
# Build/rebuild containers
pnpm docker:build

# Start services in background
pnpm docker:up

# View API logs
pnpm docker:logs

# Stop all services
pnpm docker:down

# Stop and remove volumes (⚠️ removes database data)
docker-compose down -v

# Access the API container shell
docker exec -it student-research-api sh

# Access the database
docker exec -it student-research-db mysql -u root -p student_research
```

## Production Build

To build for production:

```bash
# Build the Docker image
docker build -t student-research-api:latest .

# Run without docker-compose
docker run -p 3000:3000 --env-file .env student-research-api:latest
```

## Troubleshooting

### Database connection issues
- Ensure the database service is healthy: `docker-compose ps`
- Check database logs: `docker-compose logs db`

### Port conflicts
- Change the `PORT` or `DB_PORT` in `.env` if default ports are in use

### Reset database
```bash
docker-compose down -v
docker-compose up -d
```
