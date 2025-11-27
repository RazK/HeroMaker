import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const POSES_DIR = path.join(PROJECT_ROOT, 'poses');

// Ensure poses directory exists
if (!fs.existsSync(POSES_DIR)) {
    fs.mkdirSync(POSES_DIR, { recursive: true });
}

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // API: List poses
    if (req.url === '/api/poses' && req.method === 'GET') {
        fs.readdir(POSES_DIR, (err, files) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to read poses directory' }));
                return;
            }
            const poseFiles = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(poseFiles));
        });
        return;
    }

    // API: Get pose by name
    if (req.url.startsWith('/api/poses/') && req.method === 'GET') {
        const poseName = decodeURIComponent(req.url.replace('/api/poses/', ''));
        const filePath = path.join(POSES_DIR, `${poseName}.json`);
        
        // Security: prevent directory traversal
        if (!filePath.startsWith(POSES_DIR)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }
        
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Pose not found' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
        });
        return;
    }

    // API: Save pose
    if (req.url === '/api/poses' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { name, pose } = JSON.parse(body);
                if (!name || !pose) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Name and pose required' }));
                    return;
                }
                
                // Sanitize filename
                const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
                const filePath = path.join(POSES_DIR, `${safeName}.json`);
                
                fs.writeFile(filePath, JSON.stringify(pose, null, 2), 'utf8', (err) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Failed to save pose' }));
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, name: safeName }));
                });
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // API: Delete pose
    if (req.url.startsWith('/api/poses/') && req.method === 'DELETE') {
        const poseName = decodeURIComponent(req.url.replace('/api/poses/', ''));
        const filePath = path.join(POSES_DIR, `${poseName}.json`);
        
        // Security: prevent directory traversal
        if (!filePath.startsWith(POSES_DIR)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }
        
        fs.unlink(filePath, (err) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Pose not found' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
        return;
    }

    // Serve example model
    if (req.url === '/api/model/example' || req.url === '/api/model/example.glb') {
        const modelPath = path.join(PROJECT_ROOT, 'assets', '3D', 'examples', 'Orc', 'Meshy_Merged_Animations.glb');
        
        fs.readFile(modelPath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Model not found' }));
                return;
            }
            
            res.writeHead(200, {
                'Content-Type': 'model/gltf-binary',
                'Content-Length': data.length
            });
            res.end(data);
        });
        return;
    }

    // Serve frontend files
    const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');
    let filePath;
    
    if (req.url === '/' || req.url === '') {
        filePath = path.join(FRONTEND_DIR, 'index.html');
    } else {
        filePath = path.join(FRONTEND_DIR, req.url);
    }
    
    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    const normalizedFrontendDir = path.normalize(FRONTEND_DIR);
    if (!normalizedPath.startsWith(normalizedFrontendDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }
    
    // Default to index.html for directory requests
    if (req.url.endsWith('/') && req.url !== '/') {
        filePath = path.join(filePath, 'index.html');
    }
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error('File not found:', filePath, 'Error:', err.message);
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        
        // Set content type based on file extension
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml'
        };
        const contentType = contentTypes[ext] || 'application/octet-stream';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📦 Example model: http://localhost:${PORT}/api/model/example`);
});

