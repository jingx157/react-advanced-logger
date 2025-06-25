import axios, {AxiosInstance, AxiosRequestConfig, AxiosResponse, CancelTokenSource} from "axios";
import axiosRetry from "axios-retry";

const errorMessages: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized. Please log in again.',
    403: 'Forbidden',
    404: 'Not found',
    500: 'Server error. Try again later.'
};

export interface HttpClientConfig {
    baseURL?: string;
    tokenProvider?: () => string | null;
    refreshToken?: () => Promise<string>;
    enableLogging?: boolean;
    retries?: number;
    timeout?: number;
    mockMode?: boolean;
    rateLimitDelay?: number;
    responseTransformer?: (data: any) => any;
    circuitBreakerThreshold?: number;
    circuitBreakerCooldown?: number;
}

export class HttpClient {
    private instance: AxiosInstance;
    private isRefreshing = false;
    private refreshSubscribers: ((token: string) => void)[] = [];
    private rateLimitDelay: number;
    private failureCount = 0;
    private circuitOpen = false;
    private circuitOpenedAt = 0;
    private cancelTokenSources = new Set<CancelTokenSource>();
    private queue: (() => void)[] = [];
    private isProcessingQueue = false;
    private debounceMap = new Map<string, { timeoutId: any; promise: Promise<any> }>();
    private lastRequestTime = 0;
    private offlineQueue: (() => void)[] = [];

    constructor(private config: HttpClientConfig) {
        this.rateLimitDelay = config.rateLimitDelay ?? 300;

        this.instance = axios.create({
            baseURL: config.baseURL,
            timeout: config.timeout ?? 10000
        });

        axiosRetry(this.instance, {
            retries: config.retries ?? 3,
            retryDelay: axiosRetry.exponentialDelay
        });

        this.setupInterceptors();

        if (typeof window !== 'undefined') {
            window.addEventListener('online', this.retryOfflineQueue.bind(this));
        }
    }

    private retryOfflineQueue() {
        if (this.config.enableLogging) console.log('[OfflineQueue] Network restored, retrying queued requests');
        const queued = [...this.offlineQueue];
        this.offlineQueue = [];
        queued.forEach(fn => fn());
    }

    private isCircuitOpen() {
        if (!this.circuitOpen) return false;
        if (Date.now() - this.circuitOpenedAt > (this.config.circuitBreakerCooldown ?? 60000)) {
            this.circuitOpen = false;
            this.failureCount = 0;
            return false;
        }
        return true;
    }

    private openCircuit() {
        this.circuitOpen = true;
        this.circuitOpenedAt = Date.now();
        if (this.config.enableLogging) console.warn('[CircuitBreaker] Circuit opened due to failures');
    }

    private setupInterceptors() {
        this.instance.interceptors.request.use(request => {
            if (this.isCircuitOpen()) return Promise.reject({message: 'Circuit breaker open - request blocked'});
            (request as any).metadata = {startTime: new Date()};

            if (this.config.mockMode) {
                request.adapter = async () => ({
                    data: {message: 'Mocked response'},
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: request
                });
            }

            const token = this.config.tokenProvider?.();
            if (token) request.headers['Authorization'] = `Bearer ${token}`;

            if (request.headers['X-Debug-Tag']) console.log(`[Tag] ${request.headers['X-Debug-Tag']}`);

            if (this.config.enableLogging) console.log(`[Request] ${request.method?.toUpperCase()} ${request.url}`, request);

            return request;
        });

        this.instance.interceptors.response.use(
            response => {
                this.failureCount = 0;
                const startTime = (response.config as any).metadata?.startTime;
                if (startTime) {
                    const duration = Date.now() - startTime.getTime();
                    if (duration > 8000) console.warn(`[Long Request] ${response.config.url} took ${duration} ms`);
                }
                if (this.config.enableLogging) console.log('[Response]', response);
                if (this.config.responseTransformer) response.data = this.config.responseTransformer(response.data);
                return response;
            },
            async error => {
                this.failureCount++;
                if (this.failureCount >= (this.config.circuitBreakerThreshold ?? 5)) this.openCircuit();

                const originalRequest = error.config;

                // Offline queue
                if (typeof window !== 'undefined' && !navigator.onLine) {
                    if (this.config.enableLogging) console.log('[OfflineQueue] Network offline, queueing request:', originalRequest.url);
                    return new Promise((resolve, reject) => {
                        this.offlineQueue.push(() => {
                            this.instance(originalRequest).then(resolve).catch(reject);
                        });
                    });
                }

                // Handle 401 token refresh
                if (error.response?.status === 401 && this.config.refreshToken && !this.isRefreshing) {
                    this.isRefreshing = true;
                    try {
                        const newToken = await this.config.refreshToken();
                        this.isRefreshing = false;
                        this.onTokenRefreshed(newToken);
                        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
                        return this.instance(originalRequest);
                    } catch (refreshError) {
                        return Promise.reject(refreshError);
                    }
                } else if (error.response?.status === 401 && this.isRefreshing) {
                    return new Promise(resolve => {
                        this.subscribeTokenRefresh(token => {
                            originalRequest.headers['Authorization'] = `Bearer ${token}`;
                            resolve(this.instance(originalRequest));
                        });
                    });
                }

                const status = error.response?.status;
                const message = errorMessages[status] || error.message;
                const normalizedError = {message, status, data: error.response?.data};

                if (this.config.enableLogging) console.error('[Error]', normalizedError);

                return Promise.reject(normalizedError);
            }
        );
    }

    private onTokenRefreshed(token: string) {
        this.refreshSubscribers.forEach(cb => cb(token));
        this.refreshSubscribers = [];
    }

    private subscribeTokenRefresh(cb: (token: string) => void) {
        this.refreshSubscribers.push(cb);
    }

    // Rate limiting queue processor
    private processQueue() {
        if (this.queue.length === 0) {
            this.isProcessingQueue = false;
            return;
        }
        this.isProcessingQueue = true;
        const fn = this.queue.shift()!;
        fn();
        setTimeout(() => this.processQueue(), this.rateLimitDelay);
    }

    // Rate limit wrapper
    public enqueueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(() => {
                requestFn().then(resolve).catch(reject);
            });
            if (!this.isProcessingQueue) this.processQueue();
        });
    }

    // Debounce GET requests
    public debounceGet<T = any>(url: string, config?: AxiosRequestConfig, wait = 300): Promise<AxiosResponse<T>> {
        const key = url + JSON.stringify(config?.params || {});
        const existing = this.debounceMap.get(key);
        if (existing) {
            clearTimeout(existing.timeoutId);
            return existing.promise;
        }
        let timeoutId: any;
        const promise = new Promise<AxiosResponse<T>>((resolve, reject) => {
            timeoutId = setTimeout(() => {
                this.instance.get<T>(url, config).then(resolve).catch(reject);
                this.debounceMap.delete(key);
            }, wait);
        });
        this.debounceMap.set(key, {timeoutId, promise});
        return promise;
    }

    // Throttle requests (simple)
    public throttleRequest<T = any>(requestFn: () => Promise<T>, limitMs = 1000): Promise<T> {
        const now = Date.now();
        const diff = now - this.lastRequestTime;
        if (diff >= limitMs) {
            this.lastRequestTime = now;
            return requestFn();
        }
        return new Promise(resolve => {
            setTimeout(() => {
                this.lastRequestTime = Date.now();
                resolve(requestFn());
            }, limitMs - diff);
        });
    }

    // Auto-pagination helper (assumes X-Total-Pages header)
    public async fetchAllPages<T = any>(
        url: string,
        params: Record<string, any> = {},
        pageKey = 'page',
        limitKey = 'limit',
        limit = 50
    ): Promise<T[]> {
        let page = 1;
        let results: T[] = [];
        let totalPages = 1;
        do {
            const res = await this.get<T[]>(url, {params: {...params, [pageKey]: page, [limitKey]: limit}});
            results = results.concat(res.data);
            totalPages = parseInt(res.headers['x-total-pages'] || '1', 10);
            page++;
        } while (page <= totalPages);
        return results;
    }

    // Standard HTTP methods

    public get<T = any>(url: string, config?: AxiosRequestConfig) {
        return this.instance.get<T>(url, config);
    }

    public getWithParams<T = any>(url: string, params: Record<string, any>, config?: AxiosRequestConfig) {
        return this.instance.get<T>(url, {...config, params});
    }

    public post<T = any>(url: string, data?: any, config?: AxiosRequestConfig) {
        return this.instance.post<T>(url, data, config);
    }

    public put<T = any>(url: string, data?: any, config?: AxiosRequestConfig) {
        return this.instance.put<T>(url, data, config);
    }

    public patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig) {
        return this.instance.patch<T>(url, data, config);
    }

    public delete<T = any>(url: string, config?: AxiosRequestConfig) {
        return this.instance.delete<T>(url, config);
    }

    public upload<T = any>(url: string, file: File, onProgress?: (percent: number) => void) {
        const formData = new FormData();
        formData.append('file', file);
        return this.instance.post<T>(url, formData, {
            headers: {'Content-Type': 'multipart/form-data'},
            onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / (e.total || 1)))
        });
    }

    public download<T = Blob>(url: string, config?: AxiosRequestConfig) {
        return this.instance.get<T>(url, {...config, responseType: 'blob'});
    }

    public setHeader(key: string, value: string) {
        this.instance.defaults.headers.common[key] = value;
    }

    public cancelableRequest<T = any>(url: string, config?: AxiosRequestConfig) {
        const source = axios.CancelToken.source();
        this.cancelTokenSources.add(source);
        const request = this.instance.get<T>(url, {...config, cancelToken: source.token});
        return {
            cancel: () => {
                source.cancel('Request canceled');
                this.cancelTokenSources.delete(source);
            },
            request
        };
    }

    public cancelAllRequests() {
        this.cancelTokenSources.forEach(source => source.cancel('Canceled by user'));
        this.cancelTokenSources.clear();
    }

    public batchRequests<T = any>(requests: Promise<AxiosResponse<T>>[]) {
        return axios.all(requests);
    }
}
