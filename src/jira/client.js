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
    logger.debug('Searching Jira issues using Agile API');

    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const allIssues = [];

    try {
      const boards = await retry(
        async () => {
          const response = await this.client.get('/rest/agile/1.0/board', {
            params: { maxResults: 50 }
          });
          return response.data.values || [];
        },
        { context: { endpoint: '/rest/agile/1.0/board' } }
      );

      logger.info(`Found ${boards.length} boards`);

      for (const board of boards) {
        if (this.projects && this.projects.length > 0) {
          const boardProjects = board.location?.projectKey || board.location?.name;
          if (boardProjects && !this.projects.includes(boardProjects)) {
            continue;
          }
        }

        try {
          let startAt = 0;
          const maxResults = 50;
          let hasMore = true;

          while (hasMore) {
            const issues = await retry(
              async () => {
                const response = await this.client.get(`/rest/agile/1.0/board/${board.id}/issue`, {
                  params: { 
                    startAt, 
                    maxResults,
                    fields: 'key,summary,status,assignee,updated'
                  }
                });
                return response.data;
              },
              { context: { endpoint: `/rest/agile/1.0/board/${board.id}/issue` } }
            );

            const recentIssues = (issues.issues || []).filter(issue => {
              const updated = new Date(issue.fields.updated).getTime();
              return updated >= yesterday;
            });

            allIssues.push(...recentIssues);

            hasMore = !issues.isLast && issues.issues.length === maxResults;
            startAt += maxResults;

            if (allIssues.length >= 100) {
              hasMore = false;
            }
          }
        } catch (error) {
          logger.warn(`Failed to fetch issues from board ${board.id}`, { 
            boardId: board.id, 
            error: error.message 
          });
        }
      }

      const uniqueIssues = Array.from(
        new Map(allIssues.map(issue => [issue.key, issue])).values()
      );

      logger.info('Jira issues fetched', { count: uniqueIssues.length });
      return uniqueIssues;

    } catch (error) {
      logger.error('Failed to search issues via Agile API', { error: error.message });
      throw error;
    }
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

