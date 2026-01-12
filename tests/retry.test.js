const { retry } = require('../src/utils/retry');

describe('Retry mechanism', () => {
  beforeEach(() => {
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should succeed on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    
    const promise = retry(fn, { attempts: 3, delay: 100 });
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('should retry on failure', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue('success');

    const promise = retry(fn, { attempts: 3, delay: 100 });
    
    setTimeout(() => jest.advanceTimersByTime(100), 0);
    setTimeout(() => jest.advanceTimersByTime(100), 10);
    
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('should throw after all attempts fail', async () => {
    const error = new Error('Persistent failure');
    const fn = jest.fn().mockRejectedValue(error);

    const promise = retry(fn, { attempts: 3, delay: 100 });
    
    setTimeout(() => jest.advanceTimersByTime(100), 0);
    setTimeout(() => jest.advanceTimersByTime(100), 10);

    await expect(promise).rejects.toThrow('Persistent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

