/**
 * API Client - Handles all API calls with mock mode for development
 */
class APIClient {
    constructor(baseURL = 'http://localhost:8000', mockMode = true) {
        this.baseURL = baseURL;
        this.mockMode = mockMode;
    }
    
    /**
     * Generic fetch wrapper
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        
        if (this.mockMode) {
            return this.mockRequest(endpoint, options);
        }
        
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }
    
    /**
     * Mock API responses for development
     */
    async mockRequest(endpoint, options) {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Mock responses based on endpoint
        if (endpoint === '/api/auth/me') {
            return {
                id: 'debug-user-uuid',
                email: 'debug@heromaker.local',
                username: 'Debug User'
            };
        }
        
        if (endpoint === '/api/characters') {
            return [
                {
                    id: 'char-1',
                    character_name: 'Test Hero',
                    creation_id: 'creation-1',
                    created_at: new Date().toISOString(),
                    thumbnail_url: '/api/files/permanent/debug/creation-1/rendered.png'
                }
            ];
        }
        
        if (endpoint.startsWith('/api/creations') && options.method === 'POST') {
            return {
                id: 'creation-' + Date.now(),
                status: 'processing',
                current_task: 'image_capture',
                character_name: null,
                tasks: []
            };
        }
        
        if (endpoint.startsWith('/api/creations/') && !endpoint.includes('/progress')) {
            const creationId = endpoint.split('/')[3];
            return {
                id: creationId,
                status: 'processing',
                current_task: 'image_capture',
                character_name: 'My Hero',
                tasks: []
            };
        }
        
        if (endpoint.includes('/progress')) {
            return {
                overall_progress: 0.1,
                current_task_progress: 0.5,
                completed_tasks: 0,
                processing_task: 'image_capture',
                pending_tasks: 11
            };
        }
        
        if (endpoint.startsWith('/api/characters/')) {
            const characterId = endpoint.split('/')[3];
            return {
                id: characterId,
                character_name: 'Test Hero',
                creation_id: 'creation-1',
                vrm_url: '/api/files/permanent/debug/creation-1/creation-1.vrm',
                task_history: []
            };
        }
        
        return { success: true };
    }
    
    // API Methods
    
    async getCurrentUser() {
        return this.request('/api/auth/me');
    }
    
    async getCharacters(limit = 20, offset = 0) {
        return this.request(`/api/characters?limit=${limit}&offset=${offset}`);
    }
    
    async getCharacter(characterId) {
        return this.request(`/api/characters/${characterId}`);
    }
    
    async createCreation() {
        return this.request('/api/creations', { method: 'POST', body: JSON.stringify({}) });
    }
    
    async getCreation(creationId) {
        return this.request(`/api/creations/${creationId}`);
    }
    
    async updateCreation(creationId, data) {
        return this.request(`/api/creations/${creationId}`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }
    
    async getCreationProgress(creationId) {
        return this.request(`/api/creations/${creationId}/progress`);
    }
    
    async executeTask(creationId, taskName, file = null) {
        if (file) {
            // File upload
            const formData = new FormData();
            formData.append('file', file);
            return this.request(`/api/creations/${creationId}/tasks/${taskName}`, {
                method: 'POST',
                body: formData,
                headers: {} // Let browser set Content-Type for FormData
            });
        } else {
            return this.request(`/api/creations/${creationId}/tasks/${taskName}`, {
                method: 'POST'
            });
        }
    }
    
    async retryTask(creationId, taskName) {
        return this.request(`/api/creations/${creationId}/tasks/${taskName}/retry`, {
            method: 'POST'
        });
    }
    
    getFileURL(filePath) {
        return `${this.baseURL}/api/files/${filePath}`;
    }
}

// Export singleton instance
export const api = new APIClient('http://localhost:8000', true); // Mock mode enabled by default
