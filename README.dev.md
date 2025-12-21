# Development Mode

For development with hot-reload (no rebuilds needed):

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

**Features:**
- **Backend**: Auto-reloads on Python code changes (uvicorn --reload)
- **Frontend**: Vite dev server with HMR - changes appear instantly
- **No rebuilds needed**: Just save files and see changes immediately
- **No browser refresh needed**: Frontend hot-reloads automatically

**Access:**
- Frontend: http://localhost:3001 (Vite dev server)
- Backend: http://localhost:8000
- VRM Converter: http://localhost:8002

**Stop development mode:**
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down
```

**Switch back to production:**
```bash
docker-compose down
docker-compose up -d
```

**Note:** Development mode uses port 3001 for frontend to avoid conflicts. Production uses port 3000.
