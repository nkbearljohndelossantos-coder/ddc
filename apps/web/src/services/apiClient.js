export class ApiClient {
    static instance;
    accessToken = null;
    baseUrl = '/api/v1';
    static getInstance() {
        if (!ApiClient.instance) {
            ApiClient.instance = new ApiClient();
        }
        return ApiClient.instance;
    }
    setAccessToken(token) {
        this.accessToken = token;
    }
    getAccessToken() {
        return this.accessToken;
    }
    async request(endpoint, options = {}) {
        const headers = new Headers(options.headers || {});
        headers.set('X-Request-ID', `req-ui-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
        if (this.accessToken && !headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${this.accessToken}`);
        }
        if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
            headers.set('Content-Type', 'application/json');
        }
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers,
        });
        if (!response.ok) {
            let errorMessage = `HTTP error ${response.status}`;
            try {
                const errorJson = await response.json();
                if (errorJson.message || errorJson.error) {
                    errorMessage = errorJson.message || errorJson.error;
                }
            }
            catch {
                // use default status text
            }
            throw new Error(errorMessage);
        }
        return response.json();
    }
    async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    }
    async post(endpoint, body) {
        return this.request(endpoint, {
            method: 'POST',
            body: body ? JSON.stringify(body) : undefined,
        });
    }
    async put(endpoint, body) {
        return this.request(endpoint, {
            method: 'PUT',
            body: body ? JSON.stringify(body) : undefined,
        });
    }
    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
}
export const apiClient = ApiClient.getInstance();
//# sourceMappingURL=apiClient.js.map