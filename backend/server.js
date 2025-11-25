import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
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

    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📦 Example model: http://localhost:${PORT}/api/model/example`);
});

