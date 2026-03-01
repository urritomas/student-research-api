# Use Node.js LTS version
FROM node:20-alpine

# Install wget for the healthcheck probe
RUN apk add --no-cache wget

# Enable Corepack and lock pnpm to the version in packageManager
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Set working directory
WORKDIR /app

# Copy package files first (better layer cache)
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including devDependencies for nodemon in dev)
# Allow installation when lockfile is out-of-date (useful until pnpm-lock.yaml is regenerated)
RUN pnpm install --no-frozen-lockfile

# Copy application code
COPY . .

# Ensure uploads directory exists with correct permissions
RUN mkdir -p /app/uploads/avatars && chown -R node:node /app/uploads

# Expose the port the app runs on
EXPOSE 4000

# Default CMD — overridden by docker-compose entrypoint in dev
CMD ["node", "src/server.js"]
