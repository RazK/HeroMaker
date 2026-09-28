# Frontend Dockerfile for HeroMaker - Multi-stage build
#
# Build context is the REPOSITORY ROOT (see frontend/railway.toml and
# docker-compose.yml), because the image also carries the game: Hero Moves is
# built from games/hero-moves and served at /play/, where a hero's Play button
# opens it with that hero loaded.

# Stage 1: Build the game
FROM node:20-alpine AS game

WORKDIR /game
COPY games/hero-moves/package*.json ./
RUN npm ci
COPY games/hero-moves/ ./
# Same pruning as the GitHub Pages publish (.github/workflows/pages.yml): the
# pose-tracker weights and the developer harness pages are not part of the game.
RUN npm run build \
    && rm -rf dist/model dist/dancers.html dist/moveslab.html dist/posecheck.html dist/posegate.html

# Stage 2: Build the React application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY frontend/ .

# Build the application
# Pass VITE_API_BASE_URL as build arg so it's available during build
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Stage 3: Serve with Nginx
FROM nginx:alpine

# Copy custom nginx configuration
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder stage, and the game beside them
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=game /game/dist /usr/share/nginx/html/play

# Copy startup script
COPY frontend/start-nginx.sh /start-nginx.sh
RUN chmod +x /start-nginx.sh

# Expose port (Railway sets PORT env var, defaults to 80)
EXPOSE 80

# Health check (use PORT env var or default to 80)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-80}/health || exit 1

# Start nginx with PORT support
CMD ["/start-nginx.sh"]
