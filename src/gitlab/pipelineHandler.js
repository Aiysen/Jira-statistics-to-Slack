const logger = require('../utils/logger');

const STATUS_ICONS = {
  success: '✅',
  failed: '❌',
  canceled: '🚫',
  manual: '▶️',
};

const WATCHED_BRANCHES = ['master', 'main'];
const WATCHED_STATUSES = ['success', 'manual'];
const JIRA_KEY_REGEX = /([A-Z][A-Z0-9]+-\d+)/;
const DEPLOY_DONE_MENTIONS = process.env.SLACK_DEPLOY_DONE_MENTIONS || '@Gevork @Jegor Bogomolov';

class PipelineHandler {
  constructor(slackClient, jiraClient = null, deployTracker = null) {
    this.slackClient = slackClient;
    this.jiraClient = jiraClient;
    this.deployTracker = deployTracker;
  }

  async handlePipelineEvent(payload) {
    const ref = payload.object_attributes?.ref;
    const status = payload.object_attributes?.status;

    if (!WATCHED_BRANCHES.includes(ref)) {
      logger.debug('Pipeline event ignored: not a watched branch', { ref, status });
      return;
    }

    if (!WATCHED_STATUSES.includes(status)) {
      logger.debug('Pipeline event ignored: not a watched status', { ref, status });
      return;
    }

    logger.info('Handling pipeline event', {
      ref,
      status,
      projectId: payload.project?.id,
      pipelineId: payload.object_attributes?.id,
    });

    const commitTitle = payload.commit?.message?.split('\n')[0]?.trim() || '';
    const issueKey = this._extractIssueKey(commitTitle);
    const issueSummary = issueKey ? await this._fetchIssueSummary(issueKey) : null;

    const message = this._formatMessage(payload, issueKey, issueSummary);
    const threadTs = issueKey ? this.slackClient.getDeployThreadTs(issueKey) : null;
    await this.slackClient.postDeployNotification(message, { threadTs });
    await this._notifyIfDeployCompleted(payload, issueKey);

    logger.info('Pipeline notification sent', { ref, status, issueKey, threaded: Boolean(threadTs) });
  }

  _extractIssueKey(text) {
    const match = text.match(JIRA_KEY_REGEX);
    return match ? match[1] : null;
  }

  async _fetchIssueSummary(issueKey) {
    if (!this.jiraClient) return null;
    try {
      return await this.jiraClient.getIssueSummary(issueKey);
    } catch (error) {
      logger.warn('Failed to fetch Jira issue summary', { issueKey, error: error.message });
      return null;
    }
  }

  _formatMessage(payload, issueKey, issueSummary) {
    const { object_attributes: pipeline, project, commit, user } = payload;

    const icon = STATUS_ICONS[pipeline.status] || '⏳';
    const projectLink = `<${project.web_url}|${project.name}>`;
    const pipelineUrl = pipeline.url || pipeline.web_url;
    const pipelineLink = pipelineUrl ? `<${pipelineUrl}|#${pipeline.id}>` : `#${pipeline.id}`;
    const duration = pipeline.duration ? this._formatDuration(pipeline.duration) : null;

    let message = `${icon} Pipeline ${pipelineLink} — ${projectLink}\n`;
    message += `Ветка: \`${pipeline.ref}\` | Статус: ${pipeline.status}`;
    if (duration) message += ` | ${duration}`;
    message += '\n';

    if (pipeline.status === 'manual') {
      message += `*Требуется ручной деплой в prod* — нажмите Play в pipeline\n`;
    }

    if (issueKey) {
      const jiraBaseURL = process.env.JIRA_BASE_URL || '';
      const jiraUrl = `${jiraBaseURL}/browse/${issueKey}`;
      const jiraLabel = issueSummary ? `${issueKey}: ${issueSummary}` : issueKey;
      const authorName = commit?.author?.name || user?.name || 'Unknown';
      message += `Задача: <${jiraUrl}|${jiraLabel}> (${authorName})`;
    } else if (commit) {
      const commitTitle = commit.message?.split('\n')[0]?.trim() || commit.id.slice(0, 8);
      const authorName = commit.author?.name || user?.name || 'Unknown';
      const commitLink = commit.url ? `<${commit.url}|${commitTitle}>` : commitTitle;
      message += `Коммит: ${commitLink} (${authorName})`;
    }

    return message.trimEnd();
  }

  async _notifyIfDeployCompleted(payload, issueKey) {
    if (!this.deployTracker || !issueKey || payload.object_attributes?.status !== 'success') {
      return;
    }

    const completion = this.deployTracker.recordSuccessfulProdPipeline(
      issueKey,
      payload.project?.id,
      payload.object_attributes?.ref,
      payload.object_attributes?.id
    );

    if (!completion) {
      return;
    }

    const message = this._formatDeployDoneMessage(completion);
    await this.slackClient.postDeployNotification(message, { threadTs: completion.threadTs });
    logger.info('Deploy completion notification sent', { issueKey, threadTs: completion.threadTs });
  }

  _formatDeployDoneMessage(completion) {
    const jiraLabel = completion.summary
      ? `${completion.issueKey}: ${completion.summary}`
      : completion.issueKey;

    return [
      `✅ ${DEPLOY_DONE_MENTIONS}`,
      `Деплой задачи завершен.`,
      `Задача: <${completion.jiraUrl}|${jiraLabel}>`
    ].join('\n');
  }

  _formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}м ${s}с` : `${s}с`;
  }
}

module.exports = PipelineHandler;
