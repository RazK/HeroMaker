# Railway Image URLs

Use these exact URLs in Railway's "Source Image" field:

## Backend Service
```
ghcr.io/razk/heromaker/backend:latest
```

## Frontend Service
```
ghcr.io/razk/heromaker/frontend:latest
```

## VRM Converter Service
```
ghcr.io/razk/heromaker/vrm-converter:latest
```

## Important Notes

1. **Make sure packages are PUBLIC** - Railway can't access private GHCR packages without authentication (which may require Pro plan)

2. **After making packages public**, wait a minute for changes to propagate, then redeploy in Railway

3. **Verify package is public**: Visit `https://github.com/RazK?tab=packages` and check if packages show "Public" badge

4. **Test public access**: 
   ```bash
   # Logout from Docker first
   docker logout ghcr.io
   # Then try to pull (should work if public)
   docker pull ghcr.io/razk/heromaker/backend:latest
   ```

