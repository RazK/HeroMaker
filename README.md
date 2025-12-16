# HeroMaker

AI-powered character creation pipeline that transforms 2D images into 3D VRM avatars.

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

## Documentation

- **[Docker Setup Guide](docs/backend/DOCKER_SETUP.md)** - Complete Docker setup instructions
- **[API Reference](docs/shared/API_REFERENCE.md)** - All API endpoints
- **[Architecture](docs/shared/ARCHITECTURE.md)** - System design and overview
- **[Full Documentation](docs/README.md)** - Complete documentation index

## What is HeroMaker?

HeroMaker is a backend service that orchestrates a multi-step pipeline to create 3D VRM avatars from 2D images:

1. **Image Processing** - Preprocess uploaded image
2. **ChatGPT Render** - Enhance image using OpenAI's image editing API
3. **Meshy 3D** - Generate 3D model from image
4. **Meshy Rig** - Add rigging to 3D model
5. **VRM Conversion** - Convert GLB to VRM format
6. **Complete** - Finalize and store creation

## Services

- **Backend API** - FastAPI service running on port 8000
- **Blender Service** - Handles VRM conversion (internal service)

## Development

See [docs/backend/IMPLEMENTATION.md](docs/backend/IMPLEMENTATION.md) for development setup and [docs/backend/DOCKER_SETUP.md](docs/backend/DOCKER_SETUP.md) for Docker setup.

## License

[Add your license here]

