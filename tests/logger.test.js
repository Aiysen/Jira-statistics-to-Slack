const logger = require('../src/utils/logger');

describe('Logger', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    process.env.LOG_LEVEL = 'debug';
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    delete process.env.LOG_LEVEL;
  });

  test('should log info message', () => {
    logger.info('Test message', { key: 'value' });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    
    expect(loggedData.level).toBe('info');
    expect(loggedData.message).toBe('Test message');
    expect(loggedData.context.key).toBe('value');
    expect(loggedData.timestamp).toBeDefined();
  });

  test('should log error message', () => {
    logger.error('Error occurred', { error: 'details' });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    
    expect(loggedData.level).toBe('error');
    expect(loggedData.message).toBe('Error occurred');
  });

  test('should sanitize sensitive data', () => {
    logger.info('Test', { 
      token: 'secret123',
      api_key: 'key456',
      password: 'pass789',
      normalData: 'visible'
    });

    const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    
    expect(loggedData.context.token).toBe('***REDACTED***');
    expect(loggedData.context.api_key).toBe('***REDACTED***');
    expect(loggedData.context.password).toBe('***REDACTED***');
    expect(loggedData.context.normalData).toBe('visible');
  });

  test('should respect log level', () => {
    process.env.LOG_LEVEL = 'warn';

    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');
    logger.error('Error message');

    expect(consoleLogSpy).toHaveBeenCalledTimes(2);
  });

  test('should handle nested objects', () => {
    logger.info('Test', {
      nested: {
        token: 'secret',
        data: 'visible'
      }
    });

    const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    
    expect(loggedData.context.nested.token).toBe('***REDACTED***');
    expect(loggedData.context.nested.data).toBe('visible');
  });
});

