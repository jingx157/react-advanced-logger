# Axios-Enhanced-Client

A powerful, feature-rich HTTP client built on top of [Axios](https://github.com/axios/axios) with built-in support for
token refresh, retries, circuit breaker, request debouncing & throttling, offline queueing, request cancellation, batch
requests, and more.

---

## Features

- **Automatic token injection** and refresh on 401 responses
- **Retry** failed requests with exponential backoff (configurable retries)
- **Circuit breaker** to stop requests after multiple failures and auto-recover
- **Request debouncing** to collapse rapid duplicate GET requests
- **Request throttling** to limit the rate of outgoing requests
- **Offline queue** to hold requests when offline and replay them when back online
- **Cancelable requests** with grouped cancellation support
- **Batch multiple requests** in parallel
- **Upload with progress** support
- **Download blobs/files** support
- **Global response data transformation**
- **Request mocking** for testing purposes
- **Configurable logging** for debugging requests and responses
- **Automatic pagination helper**

---

## Installation

```bash
npm install axios-enhanced-client
# or
yarn add axios-enhanced-client
```

---

## Usage

```ts
import {HttpClient} from 'axios-enhanced-client';

const api = new HttpClient({
    baseURL: 'https://api.example.com',
    tokenProvider: () => localStorage.getItem('token'),
    refreshToken: async () => {
        const response = await fetch('/auth/refresh', {method: 'POST'});
        const data = await response.json();
        return data.token;
    },
    enableLogging: true,
    retries: 3,
    rateLimitDelay: 300,
    circuitBreakerThreshold: 5,
    circuitBreakerCooldown: 60000,
    responseTransformer: data => {
        // Optionally transform all response data here
        return data;
    },
    mockMode: false
});
```

### Making Requests

```ts
// Simple GET request
api.get('/users')
    .then(res => console.log(res.data))
    .catch(console.error);

// GET with query parameters
api.getWithParams('/search', {q: 'axios'})
    .then(res => console.log(res.data));

// POST request
api.post('/posts', {title: 'Hello', body: 'World'})
    .then(res => console.log(res.data));

// PATCH request
api.patch('/posts/123', {title: 'Updated Title'});

// DELETE request
api.delete('/posts/123');

// Upload with progress callback
const fileInput = document.querySelector('input[type="file"]')!;
api.upload('/upload', fileInput.files[0], progress => {
    console.log(`Upload Progress: ${progress}%`);
});

// Download file/blob
api.download('/file.pdf').then(res => {
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'file.pdf';
    a.click();
});
```

### Advanced Features

#### Debounce GET Requests

```ts
api.debounceGet('/search', {params: {q: 'term'}}).then(console.log);
```

#### Throttle Requests

```ts
api.throttleRequest(() => api.post('/submit', {data: 123})).then(console.log);
```

#### Batch Requests

```ts
const req1 = api.get('/users/1');
const req2 = api.get('/users/2');
api.batchRequests([req1, req2]).then(responses => {
    responses.forEach(res => console.log(res.data));
});
```

#### Cancel Requests

```ts
const {cancel, request} = api.cancelableRequest('/long-process');
request.then(res => console.log(res.data));
cancel(); // cancel the ongoing request
```

#### Cancel All Requests (e.g., on logout)

```ts
api.cancelAllRequests();
```

#### Automatic Pagination

Fetch all pages assuming API uses `page` and `limit` query params and returns `X-Total-Pages` header:

```ts
const allUsers = await api.fetchAllPages('/users', {active: true});
console.log(allUsers);
```

---

## Configuration Options

| Option                    | Type                    | Default | Description                                       |
|---------------------------|-------------------------|---------|---------------------------------------------------|
| `baseURL`                 | `string`                | —       | Base URL for all requests                         |
| `tokenProvider`           | `() => string \| null`  | —       | Function to get the auth token                    |
| `refreshToken`            | `() => Promise<string>` | —       | Async function to refresh auth token on 401       |
| `enableLogging`           | `boolean`               | `false` | Enable console logs for requests and responses    |
| `retries`                 | `number`                | `3`     | Number of automatic retries for failed requests   |
| `timeout`                 | `number`                | `10000` | Request timeout in milliseconds                   |
| `mockMode`                | `boolean`               | `false` | Enable mock responses (returns fixed message)     |
| `rateLimitDelay`          | `number`                | `300`   | Minimum delay in ms between requests (throttling) |
| `responseTransformer`     | `(data: any) => any`    | —       | Global response data transformer function         |
| `circuitBreakerThreshold` | `number`                | `5`     | Failures before circuit breaker opens             |
| `circuitBreakerCooldown`  | `number`                | `60000` | Cooldown period in ms before circuit closes       |

---

## License

MIT © Jingx

---

## Contributing

Feel free to open issues or pull requests. All contributions welcome!

---

## Thanks

Built with ❤️ on top of [Axios](https://github.com/axios/axios)
