# HeroMaker

AI-powered character creation pipeline that transforms 2D images into 3D VRM avatars.

![HeroMaker Pipeline](docs/assets/pipeline-overview.gif)

> Transform drawings into animated 3D characters in minutes

## Quick Start with Docker

**Prerequisites:**
- Docker and Docker Compose installed
- OpenAI API key
- Meshy API key

**Steps:**

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd HeroMaker
   ```

2. Set up environment:
   ```bash
   cp .env.example .env
   # Edit .env and add your API keys
   ```

3. Start services:
   ```bash
   docker-compose up -d
   ```

4. Verify it's running:
   ```bash
   curl http://localhost:8000/
   # Should return: {"message":"HeroMaker API is running"}
   ```

That's it! The API is now available at `http://localhost:8000`.

## Features

### 🎨 Upload & Process
![File Upload](docs/assets/upload-screenshot.png)
- Drag-and-drop image upload
- Automatic pipeline execution
- Real-time progress tracking

### 📊 Pipeline Progress
![Pipeline Progress](docs/assets/pipeline-progress.gif)
- Live step-by-step progress updates
- Estimated completion times
- Visual progress indicators for each step

### 🖼️ Image Preview
![Image Preview](docs/assets/image-preview-screenshot.png)
- View processed and rendered images
- Zoom and pan functionality
- Download intermediate files

### 🎭 3D Model Viewer
![3D Model Preview](docs/assets/3d-preview.gif)
- Interactive 3D model preview
- Rotate, zoom, and inspect models
- Skeleton visualization

### 📦 Creation Gallery
![Gallery View](docs/assets/gallery-screenshot.png)
- Browse all your creations
- Quick access to completed avatars
- Download VRM files

### ⚡ Fast Pipeline
![Pipeline Demo](docs/assets/full-pipeline-demo.gif)
- Complete pipeline in ~6 minutes
- Automatic step execution
- Error handling and retry options

## Documentation

- **[Deployment Guide](docs/DEPLOYMENT.md)** - Complete Docker setup and deployment instructions
- **[API Reference](docs/shared/API_REFERENCE.md)** - All API endpoints
- **[Architecture](docs/shared/ARCHITECTURE.md)** - System design and overview
- **[Full Documentation](docs/README.md)** - Complete documentation index

## How It Works

HeroMaker orchestrates a multi-step AI pipeline to transform 2D drawings into fully rigged 3D VRM avatars:

1. **Image Processing** - Preprocess uploaded image
2. **ChatGPT Render** - Enhance image using OpenAI's image editing API
3. **Meshy 3D** - Generate 3D model from image
4. **Meshy Rig** - Add rigging to 3D model
5. **VRM Conversion** - Convert GLB to VRM format
6. **Complete** - Finalize and store creation

## Tech Stack

### Frontend
- **React 18** + **TypeScript** - Modern UI framework
- **Three.js** + **@react-three/fiber** - 3D model rendering
- **Vite** - Fast build tool and dev server

### Backend
- **FastAPI** - High-performance Python API
- **SQLite/PostgreSQL** - Database (SQLite for dev, PostgreSQL for prod)
- **Docker** - Containerized services

### Services
- **Backend API** - FastAPI service (port 8000)
- **Frontend** - React app served by Nginx (port 3000)
- **VRM Converter** - Blender-based service for GLB→VRM conversion (port 8001)

## Development

See [docs/backend/IMPLEMENTATION.md](docs/backend/IMPLEMENTATION.md) for development setup and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Docker setup.

## License

[Add your license here]

