const logger = require('../utils/logger');

const JIRA_KEY_REGEX = /^([A-Z][A-Z0-9]+-\d+)$/;
const DEDUP_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_NOTIFY_PROJECTS = ['CPAYMENT'];

class IssueCreatedHandler {
  constructor(slackClient, jiraBaseURL) {
    this.slackClient = slackClient;
    this.jiraBaseURL = (jiraBaseURL || process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
    this.recentIssues = new Map();
    this.notifyProjects = this._parseProjectFilter(process.env.JIRA_ISSUE_NOTIFY_PROJECTS);
  }

  _parseProjectFilter(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return DEFAULT_NOTIFY_PROJECTS;
    }
    const trimmed = String(raw).trim();
    if (trimmed === '*' || trimmed.toLowerCase() === 'all') {
      return null;
    }
    return trimmed.split(/[\s,]+/).filter(Boolean).map(p => p.toUpperCase());
  }

  _issueProject(issueKey) {
    const match = String(issueKey).match(/^([A-Z][A-Z0-9]+)-\d+$/i);
    return match ? match[1].toUpperCase() : null;
  }

  _shouldNotify(issueKey) {
    const normalizedKey = String(issueKey).toUpperCase();
    if (!JIRA_KEY_REGEX.test(normalizedKey)) {
      return false;
    }
    if (!this.notifyProjects) {
      return true;
    }
    const project = this._issueProject(normalizedKey);
    return project && this.notifyProjects.includes(project);
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

  _buildJiraUrl(issueKey) {
    if (!this.jiraBaseURL) {
      return issueKey;
    }
    return `${this.jiraBaseURL}/browse/${issueKey}`;
  }

  async handleIssueCreated(issueKey, summary) {
    logger.info('Handling issue-created event', { issueKey, summary });

    if (!this._shouldNotify(issueKey)) {
      logger.debug('Issue-created ignored: project filter', { issueKey });
      return;
    }

    if (this._isDuplicate(issueKey)) {
      logger.info('Duplicate issue-created ignored', { issueKey });
      return;
    }

    this.recentIssues.set(issueKey, Date.now());

    const jiraUrl = this._buildJiraUrl(issueKey);
    const rootMessage = `📋 *Новая задача в Jira* — ${issueKey}: ${summary}\nJira: ${jiraUrl}`;

    const botMention = await this.slackClient.resolveJiraReviewBotMention();
    const reviewCommand = `jira review ${issueKey}`;
    const threadLines = [];
    if (botMention) {
      threadLines.push(botMention);
    }
    threadLines.push(reviewCommand);
    const threadMessage = threadLines.join('\n');

    await this.slackClient.postIssueCreatedThread(rootMessage, threadMessage);

    logger.info('Issue-created handled', { issueKey, mentionedBot: Boolean(botMention) });
  }
}

module.exports = IssueCreatedHandler;
