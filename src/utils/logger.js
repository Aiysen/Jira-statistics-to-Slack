const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

class Logger {
  constructor() {
    this.level = process.env.LOG_LEVEL || 'info';
  }

  _shouldLog(level) {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
  }

  _log(level, message, context = {}) {
    if (!this._shouldLog(level)) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(Object.keys(context).length > 0 && { context })
    };

    const sanitized = this._sanitize(logEntry);
    console.log(JSON.stringify(sanitized));
  }

  _sanitize(obj) {
    const sensitiveKeys = ['token', 'password', 'api_key', 'apikey', 'secret', 'authorization'];
    
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this._sanitize(item));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this._sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  error(message, context) {
    this._log('error', message, context);
  }

  warn(message, context) {
    this._log('warn', message, context);
  }

  info(message, context) {
    this._log('info', message, context);
  }

  debug(message, context) {
    this._log('debug', message, context);
  }
}

module.exports = new Logger();

