const cron = require('node-cron');
const ReportGenerator = require('./report');
const HealthServer = require('./health');
const GitLabClient = require('./gitlab/client');
const SlackClient = require('./slack/client');
const WebhookHandler = require('./deploy/webhookHandler');
const PipelineHandler = require('./gitlab/pipelineHandler');
const logger = require('./utils/logger');

function validateConfig() {
  const required = [
    'JIRA_BASE_URL',
    'JIRA_API_TOKEN',
    'JIRA_EMAIL',
    'SLACK_BOT_TOKEN',
    'SLACK_CHANNEL_ID'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function runReport() {
  const generator = new ReportGenerator();
  
  try {
    const result = await generator.generate();
    
    if (result.skipped) {
      logger.info('Report skipped - already generated today');
    } else {
      logger.info('Report generated successfully', result.data);
    }
  } catch (error) {
    logger.error('Report generation failed', { 
      error: error.message,
      stack: error.stack 
    });
  }
}

function main() {
  try {
    validateConfig();
    logger.info('Configuration validated successfully');

    let webhookHandler = null;
    let pipelineHandler = null;
    if (GitLabClient.isConfigured()) {
      const gitlabClient = new GitLabClient();
      const slackClient = new SlackClient();
      webhookHandler = new WebhookHandler(gitlabClient, slackClient);
      pipelineHandler = new PipelineHandler(slackClient);
      logger.info('GitLab integration enabled', {
        projects: require('./gitlab/config').getGitlabProjects().map(p => p.id)
      });
    } else {
      logger.info('GitLab integration disabled (GITLAB_BASE_URL or GITLAB_TOKEN not set)');
    }

    const healthServer = new HealthServer(webhookHandler, pipelineHandler);
    healthServer.start();

    const cronSchedule = process.env.CRON_SCHEDULE || '0 11 * * *';
    const timezone = process.env.TIMEZONE || 'UTC';

    logger.info('Setting up cron job', { schedule: cronSchedule, timezone });

    const task = cron.schedule(cronSchedule, runReport, {
      scheduled: true,
      timezone: timezone
    });

    logger.info('Jira to Slack bot started successfully', {
      schedule: cronSchedule,
      timezone: timezone,
      healthPort: healthServer.port
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      task.stop();
      healthServer.stop();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      task.stop();
      healthServer.stop();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start bot', { 
      error: error.message,
      stack: error.stack 
    });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runReport, main };

