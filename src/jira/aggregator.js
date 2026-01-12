const logger = require('../utils/logger');

class JiraAggregator {
  constructor(jiraClient) {
    this.jiraClient = jiraClient;
  }

  async aggregateData() {
    const startTime = Date.now();
    logger.info('Starting data aggregation');

    try {
      const issues = await this.jiraClient.searchIssues();
      
      if (issues.length === 0) {
        logger.info('No active issues found');
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
        return {
          hasActivity: false,
          processingTime,
          summary: {
            tasksCount: 0,
            usersCount: 0,
            commentsCount: 0,
            statusCounts: {},
            processingTime
          }
        };
      }

      const tasksData = [];
      const userActivityMap = new Map();
      let totalComments = 0;
      const statusCounts = {};

      for (const issue of issues) {
        const issueKey = issue.key;
        
        try {
          const [comments, changelog] = await Promise.all([
            this.jiraClient.getIssueComments(issueKey),
            this.jiraClient.getIssueChangelog(issueKey)
          ]);

          const taskData = this._processIssue(issue, comments, changelog);
          tasksData.push(taskData);

          totalComments += comments.length;

          const status = taskData.status;
          statusCounts[status] = (statusCounts[status] || 0) + 1;

          this._aggregateUserActivity(userActivityMap, issueKey, comments, changelog);

        } catch (error) {
          logger.warn('Failed to process issue', { 
            issueKey, 
            error: error.message 
          });
        }
      }

      tasksData.sort((a, b) => a.key.localeCompare(b.key));

      const usersData = this._prepareUsersData(userActivityMap);

      const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

      logger.info('Data aggregation completed', {
        tasksCount: tasksData.length,
        usersCount: usersData.length,
        commentsCount: totalComments,
        processingTime
      });

      return {
        hasActivity: true,
        tasks: tasksData,
        users: usersData,
        summary: {
          tasksCount: tasksData.length,
          usersCount: usersData.length,
          commentsCount: totalComments,
          statusCounts,
          processingTime
        }
      };

    } catch (error) {
      const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.error('Data aggregation failed', { 
        error: error.message,
        processingTime
      });
      throw error;
    }
  }

  _processIssue(issue, comments, changelog) {
    const assignee = issue.fields.assignee 
      ? issue.fields.assignee.displayName 
      : 'Нет исполнителя';

    const activeUsers = new Set();

    comments.forEach(comment => {
      if (comment.author && this._isHumanUser(comment.author)) {
        activeUsers.add(comment.author.displayName || comment.author.accountId);
      }
    });

    changelog.forEach(history => {
      if (history.author && this._isHumanUser(history.author)) {
        activeUsers.add(history.author.displayName || history.author.accountId);
      }
    });

    return {
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      assignee,
      updated: issue.fields.updated,
      activeUsers: Array.from(activeUsers).sort()
    };
  }

  _aggregateUserActivity(userActivityMap, issueKey, comments, changelog) {
    const processUser = (user) => {
      if (!user || !this._isHumanUser(user)) {
        return null;
      }

      const userName = user.displayName || `Пользователь удалён (ID: ${user.accountId})`;
      
      if (!userActivityMap.has(userName)) {
        userActivityMap.set(userName, {
          name: userName,
          commentsCount: 0,
          tasks: new Set()
        });
      }

      return userName;
    };

    comments.forEach(comment => {
      const userName = processUser(comment.author);
      if (userName) {
        const userData = userActivityMap.get(userName);
        userData.commentsCount++;
        userData.tasks.add(issueKey);
      }
    });

    changelog.forEach(history => {
      const userName = processUser(history.author);
      if (userName) {
        const userData = userActivityMap.get(userName);
        userData.tasks.add(issueKey);
      }
    });
  }

  _prepareUsersData(userActivityMap) {
    const usersData = Array.from(userActivityMap.values()).map(userData => ({
      name: userData.name,
      commentsCount: userData.commentsCount,
      tasksCount: userData.tasks.size,
      tasks: Array.from(userData.tasks).sort()
    }));

    usersData.sort((a, b) => a.name.localeCompare(b.name));

    return usersData;
  }

  _isHumanUser(user) {
    return user.accountType !== 'app';
  }
}

module.exports = JiraAggregator;

