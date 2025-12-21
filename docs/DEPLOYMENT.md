# HeroMaker Deployment Guide

This guide covers deploying the HeroMaker application using Docker and docker-compose.

## Overview

The HeroMaker application consists of four main components:

1. **Frontend** - React application served by Nginx (port 3000 on host, 80 in container)
2. **Backend** - FastAPI application (port 8000)
3. **VRM Converter** - Blender-based service for GLB to VRM conversion (port 8002)
4. **Database** - SQLite database (file-based, mounted as volume)

All services communicate via a Docker network and share the `assets/` directory for file storage.

## Prerequisites

- Docker Engine 20.10+ and Docker Compose 2.0+
- API keys for external services:
  - OpenAI API key (for ChatGPT image rendering)
  - Meshy API key (for 3D model generation)

## Quick Start

### 1. Environment Setup

Create a `.env` file in the project root (copy from `.env.example` if available):

```bash
# Required API Keys
OPENAI_API_KEY=your_openai_api_key_here
MESHY_API_KEY=your_meshy_api_key_here

# Database (SQLite default)
DATABASE_URL=sqlite:///./heromaker.db

# Application Settings
DEBUG=false
ASSETS_ROOT=/app/assets

# VRM Converter
VRM_CONVERTER_SERVICE_URL=http://vrm-converter:8000
VRM_CONVERTER_TIMEOUT=300

# Frontend (leave empty for same-origin)
VITE_API_BASE_URL=

# VRM Converter Version
VRM_CONVERTER_VERSION=1.0.0
```

### 2. Start All Services

```bash
# Build and start all services in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# View logs for a specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f vrm-converter
```

### 3. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **VRM Converter**: http://localhost:8002

### 4. Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (WARNING: deletes database and assets)
docker-compose down -v
```

## Service Details

### Backend Service

- **Container**: `heromaker-backend`
- **Port**: 8000 (mapped to host)
- **Health Check**: `GET /`
- **Volumes**:
  - `./assets` → `/app/assets` (user uploads and generated files)
  - `./backend/heromaker.db` → `/app/heromaker.db` (database file)

### Frontend Service

- **Container**: `heromaker-frontend`
- **Port**: 3000 (mapped to host, container runs on port 80)
- **Health Check**: `GET /health`
- **Dependencies**: Waits for backend to be ready
- **Nginx Configuration**: Proxies `/api/*` requests to backend

### VRM Converter Service

- **Container**: `vrm-converter-service`
- **Port**: 8002 (mapped to host)
- **Health Check**: `GET /health`
- **Resource Limits**: 2 CPUs, 4GB RAM
- **Volumes**:
  - `./assets` → `/app/assets` (access to GLB files, writes VRM files)

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for ChatGPT | `sk-...` |
| `MESHY_API_KEY` | Meshy API key for 3D generation | `meshy_...` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./heromaker.db` | Database connection string |
| `DEBUG` | `false` | Enable debug mode |
| `ASSETS_ROOT` | `/app/assets` | Assets directory path |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | OpenAI image model |
| `VRM_CONVERTER_SERVICE_URL` | `http://vrm-converter:8000` | VRM converter service URL |
| `VRM_CONVERTER_TIMEOUT` | `300` | VRM conversion timeout (seconds) |
| `VITE_API_BASE_URL` | (empty) | Frontend API base URL |

## Volume Management

### Assets Directory

The `./assets` directory is bind-mounted to all services that need file access:
- Backend reads/writes user uploads and generated files
- VRM converter reads GLB files and writes VRM files

**Important**: The `assets/` directory structure:
```
assets/
├── temp/
│   └── {user_id}/
│       └── {creation_id}/
└── permanent/
    └── {user_id}/
        └── {creation_id}/
```

### Database File

The SQLite database file (`./backend/heromaker.db`) is bind-mounted to persist data across container restarts.

**Backup**: To backup the database, simply copy `./backend/heromaker.db`:
```bash
cp ./backend/heromaker.db ./backend/heromaker.db.backup
```

## Development Workflow

### Hot Reload Development Mode

For development with automatic reloading (no rebuild needed):

```bash
# Start in development mode with hot-reload
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Or in detached mode
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

**Development mode features:**
- **Backend**: Auto-reloads on code changes (uvicorn --reload)
- **Frontend**: Vite dev server with HMR (Hot Module Replacement)
- **No rebuilds needed**: Changes appear instantly after saving

**Access:**
- Frontend: http://localhost:3001 (Vite dev server - port 3001 to avoid conflicts)
- Backend: http://localhost:8000
- Changes to code are automatically detected and reloaded

### Production Mode (Default)

For production builds:

```bash
# Standard production mode
docker-compose up -d
```

### Rebuild After Code Changes (Production Mode)

If using production mode and need to rebuild:

```bash
# Rebuild specific service
docker-compose build backend
docker-compose up -d backend

# Rebuild all services
docker-compose up -d --build
```

### View Service Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f vrm-converter

# Last 100 lines
docker-compose logs --tail=100 backend
```

### Execute Commands in Containers

```bash
# Backend shell
docker-compose exec backend /bin/bash

# Run Python script in backend
docker-compose exec backend python -m app.scripts.migrate

# Frontend shell
docker-compose exec frontend /bin/sh
```

## Production Deployment

### Remote Server Deployment

1. **Copy project files** to the server
2. **Create `.env` file** with production values
3. **Ensure ports are available**: 80, 8000, 8002
4. **Start services**: `docker-compose up -d`

### Using a Reverse Proxy (Recommended)

For production, use a reverse proxy (Nginx, Traefik, etc.) in front of the frontend service:

```nginx
# Example Nginx reverse proxy configuration
server {
    listen 443 ssl;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Database Migration

If you need to run database migrations:

```bash
# Enter backend container
docker-compose exec backend /bin/bash

# Run Alembic migrations
alembic upgrade head
```

## Troubleshooting

### Services Won't Start

1. **Check logs**: `docker-compose logs`
2. **Verify environment variables**: Ensure `.env` file exists and has required keys
3. **Check port conflicts**: Ensure ports 3000, 8000, 8002 are not in use
4. **Verify Docker resources**: VRM converter needs 2GB+ RAM

### Backend Can't Connect to VRM Converter

- Verify `VRM_CONVERTER_SERVICE_URL=http://vrm-converter:8000` in `.env`
- Check that both services are on the same Docker network
- Verify VRM converter health: `curl http://localhost:8002/health`

### Frontend Can't Reach Backend

- Verify nginx configuration in `frontend/nginx.conf`
- Check backend is running: `curl http://localhost:8000/`
- Verify CORS settings in backend allow frontend origin
- Access frontend at http://localhost:3000 (not port 80)

### Database Issues

- Ensure `./backend/heromaker.db` file exists or is created on first run
- Check file permissions: database file must be writable
- Verify `DATABASE_URL` in `.env` matches the mounted path

### Assets Not Persisting

- Verify `./assets` directory exists and is writable
- Check volume mounts in `docker-compose.yml`
- Ensure services have write permissions to `/app/assets`

### VRM Converter Timeout

- Increase `VRM_CONVERTER_TIMEOUT` in `.env` (default: 300 seconds)
- Check VRM converter logs for errors
- Verify Blender is working: `docker-compose exec vrm-converter blender --version`

## Health Checks

All services include health checks. Check service health:

```bash
# Backend
curl http://localhost:8000/

# Frontend
curl http://localhost:3000/health

# VRM Converter
curl http://localhost:8002/health
```

## Resource Requirements

### Minimum Requirements

- **CPU**: 2 cores
- **RAM**: 4GB (VRM converter needs 2GB+)
- **Disk**: 10GB+ (for assets and database)

### Recommended Requirements

- **CPU**: 4 cores
- **RAM**: 8GB
- **Disk**: 50GB+ (for assets storage)

## Security Considerations

1. **API Keys**: Never commit `.env` file to version control
2. **CORS**: Configure CORS in backend for production (currently allows all origins)
3. **Firewall**: Restrict access to ports 3000, 8000, and 8002 (frontend, backend, and VRM converter)
4. **HTTPS**: Use reverse proxy with SSL/TLS for production
5. **Database**: Consider PostgreSQL for production instead of SQLite

## Updating Services

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose up -d --build

# Or rebuild specific service
docker-compose build backend
docker-compose up -d backend
```

## Cleanup

```bash
# Stop and remove containers
docker-compose down

# Remove containers, networks, and volumes
docker-compose down -v

# Remove images
docker-compose down --rmi all
```

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Nginx Documentation](https://nginx.org/en/docs/)

