import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MESHY_API_KEY = process.env.MESHY_API_KEY;
const MESHY_BASE_URL = 'https://api.meshy.ai';

if (!MESHY_API_KEY) {
  console.error('Error: MESHY_API_KEY not found in .env file');
  process.exit(1);
}

/**
 * Make a curl request to Meshy API
 */
async function curlRequest(method, endpoint, data = null) {
  const url = `${MESHY_BASE_URL}${endpoint}`;
  let cmd = `curl -X ${method} "${url}" -H "Authorization: Bearer ${MESHY_API_KEY}"`;
  
  if (data) {
    // For large JSON payloads, use a temp file
    const tempFile = path.join(os.tmpdir(), `meshy-${Date.now()}.json`);
    await fs.writeFile(tempFile, JSON.stringify(data));
    
    try {
      cmd += ` -H "Content-Type: application/json" -d @${tempFile}`;
      const { stdout, stderr } = await execAsync(cmd);
      await fs.unlink(tempFile).catch(() => {});
      
      if (stderr && !stderr.includes('Warning')) {
        console.error('curl stderr:', stderr);
      }
      return JSON.parse(stdout || '{}');
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {});
      console.error(`curl error for ${method} ${endpoint}:`, error.message);
      if (error.stdout) {
        try {
          return JSON.parse(error.stdout);
        } catch {
          return { error: error.stdout || error.message };
        }
      }
      throw error;
    }
  }
  
  // Simple GET request
  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr && !stderr.includes('Warning')) {
      console.error('curl stderr:', stderr);
    }
    return JSON.parse(stdout || '{}');
  } catch (error) {
    console.error(`curl error for ${method} ${endpoint}:`, error.message);
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        return { error: error.stdout || error.message };
      }
    }
    throw error;
  }
}

/**
 * Health check - verify API connection
 */
export async function healthCheck() {
  try {
    const result = await curlRequest('GET', '/openapi/v1/balance');
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Check credit balance
 */
export async function getBalance() {
  const result = await curlRequest('GET', '/openapi/v1/balance');
  return result;
}

/**
 * Create an image-to-3D task
 * @param {string} imagePath - Path to image file
 * @param {object} options - Optional parameters (ai_model, should_texture, etc.)
 */
export async function createImageTo3DTask(imagePath, options = {}) {
  // Convert image to base64 data URI
  const imageBuffer = await fs.readFile(imagePath);
  const imageBase64 = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase().slice(1);
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  const imageDataURI = `data:${mimeType};base64,${imageBase64}`;
  
  const requestBody = {
    image_url: imageDataURI,
    ai_model: options.ai_model || 'meshy-4',
    should_texture: options.should_texture !== false, // default true
    should_remesh: options.should_remesh !== false, // default true
    ...options
  };
  
  const result = await curlRequest('POST', '/openapi/v1/image-to-3d', requestBody);
  return result;
}

/**
 * Get task status
 * @param {string} taskId - Task ID
 */
export async function getTaskStatus(taskId) {
  const result = await curlRequest('GET', `/openapi/v1/image-to-3d/${taskId}`);
  return result;
}
