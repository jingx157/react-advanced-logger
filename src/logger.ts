// src/logger.ts

import type {Middleware} from '@reduxjs/toolkit';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'timer';

interface LoggerOptions {
    level: LogLevel;
    message?: any;
    meta?: any;
    tag?: string;
    captureStack?: boolean;
}

interface Config {
    enabled: boolean;
    envs: string[];
    minLevel: LogLevel;
    prefix?: string;
    allowedTags?: string[];
    batch?: boolean;
    batchSize?: number;
    sendToServer?: (logs: LogEntry[]) => void;
    currentEnv?: string;
}

interface LogEntry {
    level: LogLevel;
    message: string;
    meta?: any;
    tag?: string;
    timestamp: string;
    stack?: string;
}

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'timer'];
const STYLES = {
    debug: 'color: gray',
    info: 'color: green',
    warn: 'color: orange',
    error: 'color: red',
    timer: 'color: blue'
};

let config: Config = {
    enabled: true,
    envs: ['development'],
    minLevel: 'debug',
    prefix: '🪵',
    allowedTags: [],
};

let silentMode = false;
const historyBuffer: LogEntry[] = [];
const batchBuffer: LogEntry[] = [];

function shouldLog(level: LogLevel, tag?: string): boolean {
    if (!config.enabled || silentMode) return false;
    const env = config.currentEnv || 'development';
    if (!config.envs.includes(env)) return false;
    if (LEVELS.indexOf(level) < LEVELS.indexOf(config.minLevel)) return false;
    if (config.allowedTags?.length && tag && !config.allowedTags.includes(tag)) return false;
    return true;
}

function log({level, message, meta, tag, captureStack}: LoggerOptions) {
    if (!shouldLog(level, tag)) return;

    const isString = typeof message === 'string';
    const text = isString
        ? message
        : message === null || message === undefined
            ? '(no message)'
            : '(object message)';
    const fullMeta = isString ? meta : {...(meta || {}), message};

    const entry: LogEntry = {
        level,
        message: text,
        meta: fullMeta,
        tag,
        timestamp: new Date().toISOString(),
        stack: captureStack ? new Error().stack : undefined
    };

    historyBuffer.push(entry);
    if (historyBuffer.length > 100) historyBuffer.shift();

    const prefix = config.prefix ? `${config.prefix} ` : '';
    const tagText = tag ? `[${tag}]` : '';
    const output = [`%c${prefix}[${level.toUpperCase()}] ${tagText}`, STYLES[level]];
    if (fullMeta) output.push(text, fullMeta); else output.push(text);
    console[level === 'timer' ? 'info' : level](...output);

    if (config.batch && config.sendToServer) {
        batchBuffer.push(entry);
        if (batchBuffer.length >= (config.batchSize || 10)) {
            config.sendToServer([...batchBuffer]);
            batchBuffer.length = 0;
        }
    } else if (config.sendToServer) {
        config.sendToServer([entry]);
    }
}

function getStateDiff(prevState: any, nextState: any): any {
    const diff: Record<string, { from: any; to: any }> = {};
    const keys = new Set([...Object.keys(prevState), ...Object.keys(nextState)]);
    keys.forEach(key => {
        if (prevState[key] !== nextState[key]) {
            diff[key] = {from: prevState[key], to: nextState[key]};
        }
    });
    return diff;
}

const logger = {
    config: (newConfig: Partial<Config>) => {
        config = {...config, ...newConfig};
    },
    silent: (mode: boolean) => silentMode = mode,
    getHistory: () => [...historyBuffer],
    clearHistory: () => historyBuffer.length = 0,
    captureErrors: () => {
        window.onerror = (msg, src, line, col, err) => {
            logger.error('Global Error', err || msg);
        };
        window.onunhandledrejection = (e) => {
            logger.error('Unhandled Promise', e.reason);
        };
    },
    group: (label: string) => console.group(label),
    groupEnd: () => console.groupEnd(),
    timer: (label: string) => {
        const start = performance.now();
        return {
            end: () => {
                const duration = performance.now() - start;
                log({level: 'timer', message: `${label} took ${Math.round(duration)}ms`});
            }
        };
    },
    debug: (msg?: any, meta?: any, opts?: Partial<LoggerOptions>) => log({
        level: 'debug',
        message: msg,
        meta, ...opts
    }),
    info: (msg?: any, meta?: any, opts?: Partial<LoggerOptions>) => log({
        level: 'info',
        message: msg,
        meta, ...opts
    }),
    warn: (msg?: any, meta?: any, opts?: Partial<LoggerOptions>) => log({
        level: 'warn',
        message: msg,
        meta, ...opts
    }),
    error: (msg?: any, meta?: any, opts?: Partial<LoggerOptions>) => log({
        level: 'error',
        message: msg,
        meta, ...opts
    }),

    createReduxLoggerMiddleware: (options?: {
        enabled?: boolean;
        level?: 'debug' | 'info';
        excludeActions?: string[];
        includeActions?: string[];
        tag?: string;
        diffOnly?: boolean;
        asyncSuffixes?: string[];
    }): Middleware => {
        const {
            enabled = true,
            level = 'debug',
            excludeActions = [],
            includeActions,
            tag = 'Redux',
            diffOnly = false,
            asyncSuffixes = ['pending', 'fulfilled', 'rejected']
        } = options || {};

        const middleware: Middleware = store => next => action => {
            if (!enabled) return next(action);

            const actionType = action.type;

            if (includeActions && !includeActions.includes(actionType)) {
                return next(action);
            }

            if (excludeActions.includes(actionType)) {
                return next(action);
            }

            const prevState = store.getState();
            const result = next(action);
            const nextState = store.getState();

            const stateChange = diffOnly ? getStateDiff(prevState, nextState) : {prevState, nextState};

            const suffix = actionType.split('/').pop();
            const isAsync = asyncSuffixes.includes(suffix);
            const tagWithAsync = isAsync ? `${tag}:${suffix}` : tag;

            logger[level](`Action: ${actionType}`, {
                payload: action.payload,
                ...stateChange
            }, {tag: tagWithAsync});

            return result;
        };

        return middleware;
    }
};

export default logger;
