const axios = require('axios');
const logger = require('../utils/logger');
const { retry } = require('../utils/retry');

class JiraClient {
  constructor() {
    this.baseURL = process.env.JIRA_BASE_URL;
    this.email = process.env.JIRA_EMAIL;
    this.apiToken = process.env.JIRA_API_TOKEN;
    this.timeout = parseInt(process.env.API_TIMEOUT) || 30000;
    this.projects = process.env.JIRA_PROJECTS ? process.env.JIRA_PROJECTS.split(',') : null;

    if (!this.baseURL || !this.email || !this.apiToken) {
      throw new Error('Missing required Jira configuration');
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      auth: {
        username: this.email,
        password: this.apiToken
      }
    });
  }

  async searchIssues() {
    let jql = 'updated >= -24h';
    
    if (this.projects && this.projects.length > 0) {
      const projectsFilter = `project in (${this.projects.join(',')})`;
      jql = `${projectsFilter} AND ${jql}`;
    }

    const params = {
      jql,
      fields: ['key', 'summary', 'status', 'assignee', 'updated'],
      expand: ['changelog'],
      maxResults: 100
    };

    logger.debug('Searching Jira issues', { jql });

    return retry(
      async () => {
        const response = await this.client.get('/rest/api/3/search', { params });
        logger.info('Jira issues fetched', { count: response.data.issues.length });
        return response.data.issues;
      },
      { context: { endpoint: '/rest/api/3/search' } }
    );
  }

  async getIssueComments(issueKey) {
    logger.debug('Fetching comments', { issueKey });

    return retry(
      async () => {
        const response = await this.client.get(`/rest/api/3/issue/${issueKey}/comment`);
        const comments = response.data.comments || [];
        
        const yesterday = Date.now() - 24 * 60 * 60 * 1000;
        const recentComments = comments.filter(comment => {
          const created = new Date(comment.created).getTime();
          return created >= yesterday;
        });

        logger.debug('Comments filtered', { 
          issueKey, 
          total: comments.length, 
          recent: recentComments.length 
        });

        return recentComments;
      },
      { context: { endpoint: `/rest/api/3/issue/${issueKey}/comment` } }
    );
  }

  async getIssueChangelog(issueKey) {
    logger.debug('Fetching changelog', { issueKey });

    return retry(
      async () => {
        const response = await this.client.get(`/rest/api/3/issue/${issueKey}`, {
          params: { expand: 'changelog' }
        });

        const changelog = response.data.changelog || { histories: [] };
        const yesterday = Date.now() - 24 * 60 * 60 * 1000;
        
        const recentHistory = changelog.histories.filter(history => {
          const created = new Date(history.created).getTime();
          return created >= yesterday;
        });

        logger.debug('Changelog filtered', { 
          issueKey, 
          total: changelog.histories.length, 
          recent: recentHistory.length 
        });

        return recentHistory;
      },
      { context: { endpoint: `/rest/api/3/issue/${issueKey}` } }
    );
  }
}

module.exports = JiraClient;

