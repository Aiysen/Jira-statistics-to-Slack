const { WebClient } = require('@slack/web-api');
const logger = require('../utils/logger');
const { retry } = require('../utils/retry');

class SlackClient {
  constructor() {
    this.token = process.env.SLACK_BOT_TOKEN;
    this.channelId = process.env.SLACK_CHANNEL_ID;

    if (!this.token || !this.channelId) {
      throw new Error('Missing required Slack configuration');
    }

    this.client = new WebClient(this.token);
  }

  async postReport(formattedReport) {
    logger.info('Posting report to Slack');

    return retry(
      async () => {
        const mainResult = await this.client.chat.postMessage({
          channel: this.channelId,
          text: formattedReport.mainMessage,
          unfurl_links: false,
          unfurl_media: false
        });

        logger.info('Main message posted', { ts: mainResult.ts });

        if (formattedReport.tasksMessage) {
          await this._postThreadMessage(mainResult.ts, formattedReport.tasksMessage);
          logger.info('Tasks message posted in thread');
        }

        if (formattedReport.usersMessage) {
          await this._postThreadMessage(mainResult.ts, formattedReport.usersMessage);
          logger.info('Users message posted in thread');
        }

        return mainResult;
      },
      { context: { action: 'post_report' } }
    );
  }

  async postError(errorMessage) {
    logger.info('Posting error message to Slack');

    return retry(
      async () => {
        const result = await this.client.chat.postMessage({
          channel: this.channelId,
          text: errorMessage,
          unfurl_links: false,
          unfurl_media: false
        });

        logger.info('Error message posted', { ts: result.ts });
        return result;
      },
      { 
        context: { action: 'post_error' },
        attempts: 3,
        delay: 60000
      }
    );
  }

  async postDeployNotification(message) {
    logger.info('Posting deploy notification to Slack');

    return retry(
      async () => {
        const result = await this.client.chat.postMessage({
          channel: this.channelId,
          text: message,
          unfurl_links: false,
          unfurl_media: false
        });

        logger.info('Deploy notification posted', { ts: result.ts });
        return result;
      },
      { context: { action: 'post_deploy_notification' } }
    );
  }

  async _postThreadMessage(threadTs, text) {
    return await this.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: threadTs,
      text: text,
      unfurl_links: false,
      unfurl_media: false
    });
  }
}

module.exports = SlackClient;

