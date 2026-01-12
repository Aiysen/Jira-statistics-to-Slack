const http = require('http');
const logger = require('./utils/logger');
const dedup = require('./utils/dedup');

class HealthServer {
  constructor() {
    this.port = parseInt(process.env.PORT || process.env.HEALTH_CHECK_PORT) || 3000;
    this.startTime = Date.now();
    this.server = null;
  }

  start() {
    this.server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        this._handleHealthCheck(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.server.listen(this.port, () => {
      logger.info('Health check server started', { port: this.port });
    });

    this.server.on('error', (error) => {
      logger.error('Health check server error', { error: error.message });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      logger.info('Health check server stopped');
    }
  }

  _handleHealthCheck(req, res) {
    const lastRun = dedup.getLastRun();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const nextRun = this._calculateNextRun();

    let status;
    let response;

    if (!lastRun) {
      status = 'waiting';
      response = {
        status,
        lastRun: null,
        nextRun: nextRun.toISOString(),
        uptime
      };
    } else if (lastRun.success) {
      status = 'healthy';
      response = {
        status,
        lastRun: lastRun.time,
        lastRunSuccess: true,
        nextRun: nextRun.toISOString(),
        uptime
      };
    } else {
      status = 'degraded';
      response = {
        status,
        lastRun: lastRun.time,
        lastRunSuccess: false,
        error: lastRun.error,
        nextRun: nextRun.toISOString(),
        uptime
      };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));

    logger.debug('Health check request', { status });
  }

  _calculateNextRun() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(11, 0, 0, 0);

    if (now.getUTCHours() >= 11) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    return next;
  }
}

module.exports = HealthServer;

