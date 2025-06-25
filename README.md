# 🪵 React Advanced Logger

A simple yet powerful logger for React applications with full Redux Toolkit integration, environment-aware logging,
batching, error capturing, and more.

---

## ✨ Features

- ✅ Global logger (not tied to hooks or components)
- 🧠 Redux middleware (auto-logs actions, state, diffs, async actions)
- 🔄 Environment-based logging (`development`, `staging`, etc.)
- 📦 Batching with optional `sendToServer` support
- 🧩 Action filtering by tag, level, or name
- 🕵️ Error capturing (global + promise)
- 📈 Built-in timer and grouped logs
- 🧪 Extensible and Typescript-friendly

---

## 🚀 Installation

```bash
npm install react-advanced-logger
```

---

## 🔧 Basic Setup

```ts
import logger from 'react-advanced-logger';

logger.config({
    currentEnv: 'development',
    envs: ['development', 'staging'],
    minLevel: 'debug',
    prefix: '🪵',
});
```

---

## ✅ Usage

```ts
logger.info('App loaded');
logger.debug('User data', {id: 123});
logger.timer('Render').end();
```

You can also group logs:

```ts
logger.group('Loading user');
logger.info('Fetching...');
logger.groupEnd();
```

---

## 🛑 Silent Mode

```ts
logger.silent(true); // disable all logs
```

---

## 🧠 Redux Integration (Redux Toolkit)

```ts
import {configureStore} from '@reduxjs/toolkit';
import logger from 'react-advanced-logger';

const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(
            logger.createReduxLoggerMiddleware({
                level: 'info',
                tag: 'Redux',
                diffOnly: true,
                asyncSuffixes: ['pending', 'fulfilled', 'rejected'],
                excludeActions: ['ui/setLoading'],
            })
        ),
});
```

---

## 📋 Configuration Options

```ts
logger.config({
    currentEnv: 'staging',        // Overrides NODE_ENV
    envs: ['development'],        // Allowed envs to log in
    minLevel: 'info',             // Minimum log level
    prefix: '🪵',                 // Console prefix
    allowedTags: ['Redux'],       // Only show logs with specific tags
    batch: true,                  // Enable batch logging
    batchSize: 5,                 // Batch size
    sendToServer: (logs) => fetch('/log', {method: 'POST', body: JSON.stringify(logs)}),
});
```

---

## 🔎 API Reference

### `logger.debug()`, `info()`, `warn()`, `error()`

```ts
logger.debug('Loading user', {id: 123}, {tag: 'User'});
```

### `logger.timer(label)`

```ts
const t = logger.timer('Render');
// later...
t.end();
```

### `logger.captureErrors()`

Enable automatic capture of global errors and unhandled promise rejections:

```ts
logger.captureErrors();
```

---

## 🧪 Unit Testing Friendly

- Disable logs completely in tests via:

```ts
logger.silent(true);
```

---

## 📄 License

MIT © Jingx

