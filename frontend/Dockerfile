# Frontend Dockerfile for HeroMaker - Multi-stage build

# Stage 1: Build the React application
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
# Pass VITE_API_BASE_URL as build arg so it's available during build
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Stage 2: Serve with Nginx (production) or Vite dev server (development)
FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies (needed for dev mode)
COPY package*.json ./
RUN npm ci

# Copy source code (will be overridden by volume mount in dev mode)
COPY . .

# Copy built files from builder stage (for production)
COPY --from=builder /app/dist /app/dist

# Install nginx for production mode
RUN apk add --no-cache nginx gettext

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy startup script
COPY start-nginx.sh /start-nginx.sh
RUN chmod +x /start-nginx.sh

# Expose ports (80 for nginx, 5173 for Vite dev server)
EXPOSE 80 5173

# Health check (use PORT env var or default to 80)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-80}/health || exit 1

# Start nginx (production) or Vite dev server (development) based on DEBUG env var
# Vite will use VITE_DEV_PORT env var (set to 80 in docker-compose for port 3000 mapping)
CMD sh -c "if [ \"$DEBUG\" = \"true\" ]; then npm run dev -- --host 0.0.0.0; else /start-nginx.sh; fi"
