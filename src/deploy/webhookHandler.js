const logger = require('../utils/logger');
const { getGitlabProjects } = require('../gitlab/config');

const DEDUP_WINDOW_MS = 60 * 60 * 1000;

class WebhookHandler {
  constructor(gitlabClient, slackClient, jiraBaseURL) {
    this.gitlabClient = gitlabClient;
    this.slackClient = slackClient;
    this.jiraBaseURL = jiraBaseURL || process.env.JIRA_BASE_URL || '';
    this.recentIssues = new Map();
  }

  async handleDeployReady(issueKey, issueId, summary) {
    logger.info('Handling deploy-ready event', { issueKey, summary });

    if (this._isDuplicate(issueKey)) {
      logger.info('Duplicate event ignored', { issueKey });
      return;
    }
    this.recentIssues.set(issueKey, Date.now());

    const projects = getGitlabProjects();
    const results = await Promise.all(
      projects.map(project => this._processProject(issueKey, summary, project))
    );

    const message = this._formatSlackMessage(issueKey, summary, results);
    await this.slackClient.postDeployNotification(message);

    logger.info('Deploy-ready handled', {
      issueKey,
      results: results.map(r => ({ projectId: r.projectId, status: r.status }))
    });
  }

  async _processProject(issueKey, summary, project) {
    const { id: projectId, targetBranch } = project;

    try {
      const branches = await this.gitlabClient.searchBranchesByIssueKey(projectId, issueKey);

      if (branches.length === 0) {
        return { projectId, status: 'no_branch' };
      }

      if (branches.length > 1) {
        return {
          projectId,
          status: 'multiple_branches',
          branches: branches.map(b => b.name)
        };
      }

      const sourceBranch = branches[0].name;

      const existing = await this.gitlabClient.getExistingMergeRequest(
        projectId, sourceBranch, targetBranch
      );
      if (existing) {
        return {
          projectId,
          status: 'existing',
          mrUrl: existing.web_url,
          mrRef: existing.references?.full || `!${existing.iid}`
        };
      }

      const diffExists = await this.gitlabClient.hasDiff(projectId, sourceBranch, targetBranch);
      if (!diffExists) {
        return { projectId, status: 'empty_diff' };
      }

      const mr = await this.gitlabClient.createMergeRequest(
        projectId,
        sourceBranch,
        targetBranch,
        `${issueKey}: ${summary}`
      );

      return {
        projectId,
        status: 'created',
        mrUrl: mr.web_url,
        mrRef: mr.references?.full || `!${mr.iid}`
      };

    } catch (error) {
      logger.error('Failed to process project for deploy-ready', {
        projectId,
        issueKey,
        error: error.message
      });
      return { projectId, status: 'error', errorMessage: error.message };
    }
  }

  _formatSlackMessage(issueKey, summary, results) {
    const jiraUrl = `${this.jiraBaseURL}/browse/${issueKey}`;
    let message = `🚀 *Ready for Deploy* — ${issueKey}: ${summary}\n`;
    message += `Jira: <${jiraUrl}|${issueKey}>\n`;

    if (results.length > 0) {
      message += '\n';
      for (const result of results) {
        message += this._formatProjectResult(result) + '\n';
      }
    }

    return message.trimEnd();
  }

  _formatProjectResult(result) {
    const prefix = `• Project ${result.projectId}:`;

    switch (result.status) {
      case 'created':
        return `${prefix} <${result.mrUrl}|${result.mrRef}> — создан`;
      case 'existing':
        return `${prefix} <${result.mrUrl}|${result.mrRef}> — уже существует`;
      case 'no_branch':
        return `${prefix} ветка не найдена`;
      case 'multiple_branches': {
        const list = result.branches.map(b => `\`${b}\``).join(', ');
        return `${prefix} несколько веток: ${list} — нужно разобраться вручную`;
      }
      case 'empty_diff':
        return `${prefix} diff пустой — MR не создан`;
      case 'error':
        return `${prefix} ошибка — ${result.errorMessage}`;
      default:
        return `${prefix} неизвестный результат`;
    }
  }

  _isDuplicate(issueKey) {
    const now = Date.now();
    for (const [key, ts] of this.recentIssues.entries()) {
      if (now - ts > DEDUP_WINDOW_MS) {
        this.recentIssues.delete(key);
      }
    }
    const last = this.recentIssues.get(issueKey);
    return last !== undefined;
  }
}

module.exports = WebhookHandler;
