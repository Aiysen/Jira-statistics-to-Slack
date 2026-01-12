const dedup = require('../src/utils/dedup');

describe('DedupManager', () => {
  beforeEach(() => {
    dedup.lastRun = null;
  });

  test('should allow first run', () => {
    expect(dedup.shouldRun()).toBe(true);
  });

  test('should prevent duplicate run on same day', () => {
    dedup.markSuccess();
    expect(dedup.shouldRun()).toBe(false);
  });

  test('should allow run after failure', () => {
    dedup.markFailure(new Error('Test error'));
    expect(dedup.shouldRun()).toBe(true);
  });

  test('should store last run data', () => {
    dedup.markSuccess();
    const lastRun = dedup.getLastRun();

    expect(lastRun).toBeDefined();
    expect(lastRun.success).toBe(true);
    expect(lastRun.date).toBeDefined();
    expect(lastRun.time).toBeDefined();
  });

  test('should store error on failure', () => {
    const error = new Error('Test error');
    dedup.markFailure(error);
    const lastRun = dedup.getLastRun();

    expect(lastRun).toBeDefined();
    expect(lastRun.success).toBe(false);
    expect(lastRun.error).toBe('Test error');
  });

  test('should allow run on next day', () => {
    dedup.lastRun = {
      date: '2026-01-10',
      time: '2026-01-10T11:00:00.000Z',
      success: true
    };

    expect(dedup.shouldRun()).toBe(true);
  });
});

