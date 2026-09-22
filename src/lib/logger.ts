/**
 * Development-only logger utility
 * Only outputs in development mode (NODE_ENV !== 'production')
 */

type LogLevel = 'log' | 'warn' | 'error' | 'debug';

function shouldLog(): boolean {
  // In browser: check if we're in development
  if (typeof window !== 'undefined') {
    // Next.js sets process.env.NODE_ENV at build time
    return process.env.NODE_ENV !== 'production';
  }
  // In Node.js: check NODE_ENV
  return process.env.NODE_ENV !== 'production';
}

export const logger = {
  log: (...args: any[]) => {
    if (shouldLog()) console.log(...args);
  },
  warn: (...args: any[]) => {
    if (shouldLog()) console.warn(...args);
  },
  error: (...args: any[]) => {
    // Always log errors
    console.error(...args);
  },
  debug: (...args: any[]) => {
    if (shouldLog()) console.debug(...args);
  },
};

// Server-side only logger (for API routes, server components)
export const serverLogger = {
  log: (...args: any[]) => {
    if (process.env.NODE_ENV !== 'production') console.log(...args);
  },
  warn: (...args: any[]) => {
    if (process.env.NODE_ENV !== 'production') console.warn(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
  },
  debug: (...args: any[]) => {
    if (process.env.NODE_ENV !== 'production') console.debug(...args);
  },
};

export default logger;
