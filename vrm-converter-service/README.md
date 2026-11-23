# GLB to VRM Converter Service

A containerized FastAPI service that converts GLB files to VRM format using Blender 4.2.

## Overview

This service provides an HTTP API for converting GLB (glTF Binary) files to VRM (Virtual Reality Model) format. It uses Blender with the VRM addon to perform the conversion, including sophisticated bone mapping for Mixamo rigs.

## Features

- Converts GLB files to VRM format
- Optional thumbnail/preview image support
- Handles Mixamo bone mapping automatically
- Forces T-pose and bakes rest pose
- Containerized for easy deployment
- Health check endpoint for monitoring

## Files

- `app.py` - FastAPI application with `/convert` endpoint
- `conversion_script.py` - Blender Python script for GLB-to-VRM conversion
- `Dockerfile` - Docker image definition
- `requirements.txt` - Python dependencies
- `railway.toml` - Railway deployment configuration
- `VERSION` - Current version number

## Building the Service

### Build from Dockerfile

Build manually:

```bash
cd vrm-converter-service
docker build --build-arg VERSION=$(cat VERSION) -t vrm-converter-service:$(cat VERSION) -t vrm-converter-service:latest -f Dockerfile .
```

### Versioning

- Version is stored in `VERSION` file
- Images are tagged with version: `vrm-converter-service:1.0.0`
- To rebuild with a new version, update `VERSION` file and rebuild

### Deploying

Railway builds this Dockerfile itself: a merge to `main` deploys it to
staging, a promotion to production (`docs/deployment/cicd.md`).

## Running the Service

### Standalone

```bash
docker run -d -p 8000:8000 --name vrm-converter vrm-converter-service
```

### With Docker Compose

See the main project's `docker-compose.yml` for orchestration.

## API Endpoints

### POST /convert

Convert a GLB file to VRM format.

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Body: `file` (GLB file)

**Response:**
- Content-Type: application/octet-stream
- Body: VRM file binary

**Example:**
```bash
curl -X POST "http://localhost:8000/convert" \
     -F "file=@/path/to/model.glb" \
     --output result.vrm
```

### GET /health

Check service health status.

**Response:**
```json
{
  "status": "online",
  "blender": "ready",
  "script": "ready"
}
```

### GET /

Service information endpoint.

## Integration

The service is integrated into the HeroMaker pipeline via `backend/app/services/vrm_conversion.py`, which calls this HTTP service instead of using a local Blender installation.

## Directory Structure

The service is located at the root level of the HeroMaker project:

```
HeroMaker/
├── backend/                    # Main backend application
├── vrm-converter-service/      # This service (containerized microservice)
├── docker-compose.yml          # Docker Compose configuration
└── ...
```

This structure reflects that `vrm-converter-service` is a separate microservice that communicates with the backend via HTTP, rather than being a Python module within the backend.

## Configuration

- `BLENDER_PATH`: Path to Blender executable (default: `/usr/bin/blender`)
- Service runs on port 8000 by default

## Error Handling

The service returns appropriate HTTP status codes:
- `400`: Invalid file format (not .glb)
- `500`: Conversion failure (with error details)

## Technical Details

- Uses Blender 4.2 with VRM Addon v2.20.0
- Conversion script includes Mixamo bone mapping
- Temporary files are cleaned up automatically after conversion
- Conversion timeout: 5 minutes

