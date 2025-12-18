# HeroMaker Frontend

Phase 0 frontend for the HeroMaker pipeline UI. This is a simple React application that enables users to upload drawings, start the pipeline, monitor progress, preview renders, and download completed files.

## Features

- **File Upload**: Drag-and-drop or click to upload image files
- **Pipeline Execution**: Automatically starts pipeline after upload
- **Progress Monitoring**: Real-time progress updates for overall pipeline and individual steps
- **Preview**: View images and 3D models (GLB) as they're generated
- **Download**: Download completed VRM avatar and rendered images

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

The frontend will be available at `http://localhost:3000` and will proxy API requests to `http://localhost:8000` (backend).

## Environment Variables

Create a `.env` file in the frontend directory (optional):

```
VITE_API_BASE_URL=http://localhost:8000
```

If not set, defaults to `http://localhost:8000`.

## Build

To build for production:

```bash
npm run build
```

The built files will be in the `dist` directory.

## Project Structure

```
frontend/
├── src/
│   ├── api/
│   │   └── client.ts          # API client with all endpoints
│   ├── components/
│   │   ├── FileUpload.tsx     # File upload component
│   │   ├── PipelineProgress.tsx # Main progress view
│   │   ├── StepCard.tsx        # Individual step display
│   │   ├── ImagePreview.tsx   # Image preview with zoom
│   │   ├── ModelPreview.tsx   # 3D GLB model viewer
│   │   └── DownloadButton.tsx # Download button component
│   ├── hooks/
│   │   └── useCreationPolling.ts # Polling hook for updates
│   ├── styles/
│   │   └── main.css          # Global styles and CSS variables
│   ├── App.tsx               # Main app component
│   └── main.tsx             # Entry point
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Pipeline Steps

The pipeline consists of 6 steps:

1. **Image Processing** (~1s) - Process uploaded image
2. **AI Rendering** (~60s) - Transform drawing to 3D render using OpenAI
3. **3D Model Generation** (~180s) - Generate 3D model from rendered image (Meshy API)
4. **Rigging** (~30s) - Rig the 3D model (Meshy API)
5. **VRM Conversion** (~3s) - Convert rigged GLB to VRM format
6. **Finalization** (~1s) - Move files to permanent storage

## API Integration

The frontend communicates with the backend API:

- `POST /api/creations/upload` - Upload image and create creation
- `POST /api/creations/{id}/run` - Start pipeline execution
- `GET /api/creations/{id}` - Get creation status (polled every 2-3 seconds)
- `GET /api/files/{path}` - Serve files for preview/download

## Technologies

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Three.js** - 3D model rendering
- **@react-three/fiber** - React renderer for Three.js
- **@react-three/drei** - Useful helpers for react-three/fiber

## Development Notes

- The frontend polls the API every 2-3 seconds while a creation is processing
- Progress is calculated from `estimated_completion_time` for processing steps
- Files are served from `/api/files/temp/{user_id}/{creation_id}/{filename}` during processing
- After completion, files are moved to permanent storage
- The debug user ID (`debug-user-uuid`) is hardcoded for Phase 0
