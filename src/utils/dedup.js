const logger = require('./logger');

class DedupManager {
  constructor() {
    this.lastRun = null;
  }

  shouldRun() {
    const now = new Date();
    const todayUTC = now.toISOString().split('T')[0];

    if (this.lastRun && this.lastRun.date === todayUTC && this.lastRun.success) {
      logger.info('Report already generated today, skipping', {
        lastRunDate: this.lastRun.date,
        lastRunTime: this.lastRun.time
      });
      return false;
    }

    return true;
  }

  markSuccess() {
    const now = new Date();
    this.lastRun = {
      date: now.toISOString().split('T')[0],
      time: now.toISOString(),
      success: true
    };
    
    logger.info('Marked successful run', {
      date: this.lastRun.date,
      time: this.lastRun.time
    });
  }

  markFailure(error) {
    const now = new Date();
    this.lastRun = {
      date: now.toISOString().split('T')[0],
      time: now.toISOString(),
      success: false,
      error: error.message
    };
    
    logger.info('Marked failed run', {
      date: this.lastRun.date,
      time: this.lastRun.time,
      error: error.message
    });
  }

  getLastRun() {
    return this.lastRun;
  }
}

module.exports = new DedupManager();

