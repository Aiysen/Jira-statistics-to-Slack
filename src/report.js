const JiraClient = require('./jira/client');
const JiraAggregator = require('./jira/aggregator');
const SlackClient = require('./slack/client');
const SlackFormatter = require('./slack/formatter');
const logger = require('./utils/logger');
const dedup = require('./utils/dedup');

class ReportGenerator {
  constructor() {
    this.jiraClient = new JiraClient();
    this.jiraAggregator = new JiraAggregator(this.jiraClient);
    this.slackClient = new SlackClient();
    this.slackFormatter = new SlackFormatter(this.jiraClient.baseURL);
  }

  async generate() {
    logger.info('=== Starting report generation ===');

    if (!dedup.shouldRun()) {
      logger.info('=== Report generation skipped (already run today) ===');
      return { skipped: true };
    }

    try {
      const data = await this.jiraAggregator.aggregateData();
      
      const formattedReport = this.slackFormatter.formatReport(data);
      
      await this.slackClient.postReport(formattedReport);
      
      dedup.markSuccess();
      
      logger.info('=== Report generation completed successfully ===', {
        hasActivity: data.hasActivity,
        tasksCount: data.summary?.tasksCount || 0,
        usersCount: data.summary?.usersCount || 0
      });

      return { 
        success: true, 
        data: data.summary 
      };

    } catch (error) {
      logger.error('=== Report generation failed ===', {
        error: error.message,
        stack: error.stack
      });

      dedup.markFailure(error);

      try {
        const errorMessage = this.slackFormatter.formatError(error, 3);
        await this.slackClient.postError(errorMessage);
        logger.info('Error message posted to Slack');
      } catch (slackError) {
        logger.error('Failed to post error message to Slack', {
          error: slackError.message
        });
      }

      throw error;
    }
  }
}

module.exports = ReportGenerator;

