const logger = require('../utils/logger');
const { getGitlabProjects } = require('./config');

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
  constructor(slackClient, jiraClient = null, deployTracker = null, gitlabClient = null) {
    this.slackClient = slackClient;
    this.jiraClient = jiraClient;
    this.deployTracker = deployTracker;
    this.gitlabClient = gitlabClient;
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
    await this._notifyIfDeployCompleted(payload, issueKey, issueSummary, threadTs);

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

  async _notifyIfDeployCompleted(payload, issueKey, issueSummary, threadTs) {
    if (!this.deployTracker || !issueKey || payload.object_attributes?.status !== 'success') {
      return;
    }

    await this._reconcileTrackedMergeRequests(payload, issueKey, issueSummary, threadTs);

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

  async _reconcileTrackedMergeRequests(payload, issueKey, issueSummary, threadTs) {
    if (!this.gitlabClient || typeof this.gitlabClient.listMergeRequestsByIssueKey !== 'function') {
      return;
    }

    const projectId = payload.project?.id;
    const targetBranch = payload.object_attributes?.ref;
    const project = getGitlabProjects().find(item => {
      return item.id === projectId && item.targetBranch === targetBranch;
    });

    if (!project) {
      return;
    }

    try {
      const mrs = await this.gitlabClient.listMergeRequestsByIssueKey(projectId, issueKey, targetBranch);
      for (const mr of mrs) {
        this.deployTracker.rememberMergeRequest(
          issueKey,
          issueSummary || mr.title || issueKey,
          process.env.JIRA_BASE_URL || '',
          threadTs,
          this._toTrackedMergeRequest(mr, payload.project, targetBranch)
        );
      }
    } catch (error) {
      logger.warn('Failed to reconcile merge requests for pipeline', {
        issueKey,
        projectId,
        targetBranch,
        error: error.message
      });
    }
  }

  _toTrackedMergeRequest(mr, project, targetBranch) {
    return {
      projectId: project?.id,
      mrIid: mr.iid,
      mrRef: mr.references?.full || `!${mr.iid}`,
      mrUrl: mr.web_url,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch || targetBranch,
    };
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
