const logger = require('./logger');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(fn, options = {}) {
  const {
    attempts = parseInt(process.env.RETRY_ATTEMPTS) || 3,
    delay = parseInt(process.env.RETRY_DELAY) || 5000,
    context = {}
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      logger.warn(`Retry attempt ${attempt}/${attempts} failed`, {
        ...context,
        attempt,
        error: error.message
      });

      if (attempt < attempts) {
        await sleep(delay);
      }
    }
  }

  logger.error(`All ${attempts} retry attempts failed`, {
    ...context,
    error: lastError.message
  });

  throw lastError;
}

module.exports = { retry, sleep };

