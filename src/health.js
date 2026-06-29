const http = require('http');
const logger = require('./utils/logger');
const dedup = require('./utils/dedup');

class HealthServer {
  constructor(webhookHandler = null, pipelineHandler = null, issueCreatedHandler = null) {
    this.port = parseInt(process.env.PORT || process.env.HEALTH_CHECK_PORT) || 3000;
    this.startTime = Date.now();
    this.server = null;
    this.webhookHandler = webhookHandler;
    this.pipelineHandler = pipelineHandler;
    this.issueCreatedHandler = issueCreatedHandler;
  }

  start() {
    this.server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        this._handleHealthCheck(req, res);
      } else if (req.method === 'POST' && req.url === '/webhooks/jira/deploy-ready') {
        this._handleDeployWebhook(req, res);
      } else if (req.method === 'POST' && req.url === '/webhooks/jira/issue-created') {
        this._handleIssueCreatedWebhook(req, res);
      } else if (req.method === 'POST' && req.url === '/webhooks/gitlab/pipeline') {
        this._handlePipelineWebhook(req, res);
      } else if (req.method === 'POST' && req.url === '/webhooks/gitlab/merge-request') {
        this._handleMergeRequestWebhook(req, res);
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

  _handlePipelineWebhook(req, res) {
    if (!this.pipelineHandler) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GitLab not configured' }));
      return;
    }

    const expectedToken = process.env.GITLAB_PIPELINE_WEBHOOK_TOKEN;
    if (expectedToken && req.headers['x-gitlab-token'] !== expectedToken) {
      logger.warn('Pipeline webhook: invalid token');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';

    req.on('error', (err) => {
      logger.error('Pipeline webhook request error', { error: err.message });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
    });

    req.on('data', (chunk) => { body += chunk; });

    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      if (payload.object_kind !== 'pipeline') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Expected pipeline event' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

      this.pipelineHandler.handlePipelineEvent(payload)
        .catch(err => logger.error('Pipeline webhook handler failed', { error: err.message }));
    });
  }

  _handleMergeRequestWebhook(req, res) {
    if (!this.webhookHandler) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GitLab not configured' }));
      return;
    }

    const expectedToken = process.env.GITLAB_MR_WEBHOOK_TOKEN || process.env.GITLAB_PIPELINE_WEBHOOK_TOKEN;
    if (expectedToken && req.headers['x-gitlab-token'] !== expectedToken) {
      logger.warn('Merge request webhook: invalid token');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';

    req.on('error', (err) => {
      logger.error('Merge request webhook request error', { error: err.message });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
    });

    req.on('data', (chunk) => { body += chunk; });

    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      if (payload.object_kind !== 'merge_request') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Expected merge_request event' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

      this.webhookHandler.handleMergeRequestEvent(payload)
        .catch(err => logger.error('Merge request webhook handler failed', { error: err.message }));
    });
  }

  _handleIssueCreatedWebhook(req, res) {
    if (!this.issueCreatedHandler) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Issue-created handler not configured' }));
      return;
    }

    const expectedSecret = process.env.JIRA_WEBHOOK_SECRET;
    if (expectedSecret && req.headers['x-webhook-secret'] !== expectedSecret) {
      logger.warn('Issue-created webhook: invalid secret');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';

    req.on('error', (err) => {
      logger.error('Issue-created webhook request error', { error: err.message });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
    });

    req.on('data', (chunk) => { body += chunk; });

    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { issueKey, summary } = payload;

      if (!issueKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing issueKey' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, issueKey }));

      this.issueCreatedHandler.handleIssueCreated(issueKey, summary || issueKey)
        .catch(err => logger.error('Issue-created webhook handler failed', {
          issueKey,
          error: err.message,
        }));
    });
  }

  _handleDeployWebhook(req, res) {
    if (!this.webhookHandler) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GitLab not configured' }));
      return;
    }

    const expectedSecret = process.env.JIRA_WEBHOOK_SECRET;
    if (expectedSecret && req.headers['x-webhook-secret'] !== expectedSecret) {
      logger.warn('Deploy webhook: invalid secret');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';

    req.on('error', (err) => {
      logger.error('Deploy webhook request error', { error: err.message });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
    });

    req.on('data', (chunk) => { body += chunk; });

    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { issueKey, issueId, summary } = payload;

      if (!issueKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing issueKey' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, issueKey }));

      this.webhookHandler.handleDeployReady(issueKey, issueId, summary || issueKey)
        .catch(err => logger.error('Deploy webhook handler failed', {
          issueKey,
          error: err.message
        }));
    });
  }
}

module.exports = HealthServer;

