export declare class ApiClient {
    private static instance;
    private accessToken;
    private baseUrl;
    static getInstance(): ApiClient;
    setAccessToken(token: string | null): void;
    getAccessToken(): string | null;
    request<T>(endpoint: string, options?: RequestInit): Promise<T>;
    get<T>(endpoint: string): Promise<T>;
    post<T>(endpoint: string, body?: any): Promise<T>;
    put<T>(endpoint: string, body?: any): Promise<T>;
    delete<T>(endpoint: string): Promise<T>;
}
export declare const apiClient: ApiClient;
//# sourceMappingURL=apiClient.d.ts.map