# Data Structure

## Structure: `/data` directory

Single `/data` directory for all persistent data:

```
/data/
├── files/           # User uploads and generated files
│   └── {user_id}/
│       └── {creation_id}/
│           ├── original.jpg
│           ├── rendered.png
│           ├── model.glb
│           └── ...
└── db/              # Database
    └── heromaker.db
```

## Benefits

- ✅ Single volume mount point (`/data`)
- ✅ Clean organization: files and database separated
- ✅ Easy to backup (everything in one place)
- ✅ Works with Railway's single volume limitation

## Configuration

1. **Mount volume at**: `/data` (in Railway)

2. **Environment variables**:
   ```
   FILES_ROOT=/data/files
   DATABASE_URL=sqlite:////data/db/heromaker.db
   ```

3. **All services** (backend, vrm-converter) mount the same volume at `/data`

## Current Code Structure

The code already uses: `FILES_ROOT / user_id / creation_id`

So with `FILES_ROOT=/data/files`, files go to:
- `/data/files/{user_id}/{creation_id}/filename.jpg`

