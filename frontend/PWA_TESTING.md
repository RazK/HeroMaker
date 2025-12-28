# Testing PWA Functionality

## Quick Start (Fastest Way to Test)

The quickest way to test the PWA:

**Option 1: Using Docker (Port 3000)**
```bash
docker-compose up frontend
# App will be at http://localhost:3000
```

**Option 2: Build and Preview Locally**
```bash
cd frontend
npm run build        # Build the app (generates PWA assets)
npm run preview      # Serve the built app (check terminal for port - typically 4173)
```

Then:
1. Open the app URL (check terminal for the actual port) in Chrome/Edge
2. Open DevTools (F12) → **Application** tab
3. Check **Manifest** section - should show "HeroMaker" with icons
4. Check **Service Workers** section - should show an active service worker
5. Look for the install button in the address bar (or use Application > Manifest > "Add to homescreen")

## Full Testing Steps

### 1. Build the Frontend

First, build the frontend to generate PWA assets (manifest, service worker, icons):

```bash
cd frontend
npm run build
```

This will:
- Generate optimized icons from `logo.png` in the `dist` directory
- Create a `manifest.webmanifest` file
- Generate a service worker file (`sw.js` or similar)
- Include all PWA assets in the build output

### 2. Test Locally with Preview

After building, test the production build:

```bash
npm run preview
```

The app will be available at the port shown in the terminal (typically `http://localhost:4173` for preview, or `http://localhost:3000` if using docker-compose).

### 3. Test PWA Features in Browser

#### Desktop Browser Testing (Chrome/Edge):

1. **Open DevTools** (F12)
2. **Check Application Tab**:
   - **Manifest**: Verify the manifest shows correct app name, icons, and settings
   - **Service Workers**: Check that a service worker is registered and running
   - **Application > Storage**: Verify cached assets

3. **Test Installation**:
   - Look for the install button in the address bar (install icon)
   - Or go to DevTools > Application > Manifest > "Add to homescreen"
   - The app should install as a standalone application

4. **Verify Icons**:
   - Check that the favicon appears in the browser tab
   - Check the manifest icons are generated correctly

#### Mobile Testing (iOS Safari):

1. **Local Network Testing**:
   ```bash
   # Find your local IP address
   ipconfig getifaddr en0  # macOS
   # or
   ifconfig | grep "inet "
   ```

2. **Serve over Local Network**:
   ```bash
   npm run preview -- --host 0.0.0.0
   ```

3. **On Mobile Device**:
   - Navigate to `http://YOUR_LOCAL_IP:PORT` on your mobile device (use the port from the terminal output)
   - In Safari: Share button > "Add to Home Screen"
   - The app will appear as a standalone app with the logo icon

#### Mobile Testing (Android Chrome):

1. **Same as iOS** - use local IP or localhost tunneling
2. **Chrome will show install prompt** automatically after a few visits
3. Or use the menu > "Install app" or "Add to Home Screen"

### 4. Test with Docker (Production-like)

For production-like testing:

```bash
# Build the Docker image
cd frontend
docker build -t heromaker-frontend .

# Run the container
docker run -p 3000:80 heromaker-frontend
```

Visit `http://localhost:3000` to test the PWA in a production-like environment.

### 5. Verify PWA Assets

Check that these files are generated in `dist/`:

```
dist/
  ├── manifest.webmanifest
  ├── sw.js (or similar service worker)
  ├── logo.png (or generated icon files)
  └── ...other assets
```

### 6. Common Issues & Solutions

**Service Worker not registering**:
- Ensure you're testing on `localhost` or HTTPS
- Check browser console for errors
- Clear browser cache and hard refresh (Ctrl+Shift+R / Cmd+Shift+R)

**Icons not showing**:
- Verify `logo.png` exists in `public/` directory
- Check that icons are generated in `dist/` after build
- Check browser console for 404 errors on icon files

**Install prompt not appearing**:
- Service workers require HTTPS in production (works on localhost for testing)
- Make sure you've visited the site a few times
- Check that manifest is valid (DevTools > Application > Manifest)

### 7. Testing Checklist

- [ ] Favicon appears in browser tab
- [ ] Manifest file is generated and accessible
- [ ] Service worker is registered and active
- [ ] App can be installed on desktop (Chrome/Edge)
- [ ] App can be installed on mobile (iOS/Android)
- [ ] Installed app shows correct icon
- [ ] Installed app opens in standalone mode (no browser UI)
- [ ] Offline functionality works (if implemented)

## Testing on Actual Devices

### Option 1: Local Network (Same WiFi)

1. Build and serve on your computer:
   ```bash
   cd frontend
   npm run build
   npm run preview -- --host 0.0.0.0
   ```

2. Find your computer's IP:
   ```bash
   ipconfig getifaddr en0  # macOS
   ```

3. On mobile device, visit: `http://YOUR_IP:PORT` (use the port shown in the terminal)

### Option 2: Use ngrok or similar tunneling

For HTTPS (required for production PWA testing):

```bash
# Install ngrok: https://ngrok.com/
ngrok http 3000  # or whatever port your app is running on

# Use the HTTPS URL provided by ngrok on your mobile device
```

### Option 3: Deploy to Railway/Production

Deploy to your production environment where HTTPS is enabled - this is the best way to test PWA features as they work best over HTTPS.

