const logger = require('../utils/logger');

class JiraAggregator {
  constructor(jiraClient) {
    this.jiraClient = jiraClient;
    this.IN_PROGRESS_STATUSES = ['Analysing', 'In Development', 'Testing Dev Env', 'Testing Prod Env'];
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
            processingTime
          }
        };
      }

      const userActivityMap = new Map();
      let totalComments = 0;

      for (const issue of issues) {
        const issueKey = issue.key;
        
        try {
          const [comments, changelog] = await Promise.all([
            this.jiraClient.getIssueComments(issueKey),
            this.jiraClient.getIssueChangelog(issueKey)
          ]);

          totalComments += comments.length;

          this._aggregateUserActivity(userActivityMap, issue, comments, changelog);

        } catch (error) {
          logger.warn('Failed to process issue', { 
            issueKey, 
            error: error.message 
          });
        }
      }

      const usersData = this._prepareUsersData(userActivityMap);

      const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

      logger.info('Data aggregation completed', {
        usersCount: usersData.length,
        commentsCount: totalComments,
        processingTime
      });

      return {
        hasActivity: true,
        users: usersData,
        summary: {
          usersCount: usersData.length,
          commentsCount: totalComments,
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

  _aggregateUserActivity(userActivityMap, issue, comments, changelog) {
    const issueKey = issue.key;
    const issueSummary = issue.fields.summary;
    const currentStatus = issue.fields.status.name;
    const isInProgress = this.IN_PROGRESS_STATUSES.includes(currentStatus);

    const statusChanges = this._analyzeStatusChanges(changelog, issueKey, issueSummary);
    
    statusChanges.forEach(change => {
      if (!change.author || !this._isHumanUser(change.author)) return;

      const userName = change.author.displayName || `Пользователь удалён (ID: ${change.author.accountId})`;
      
      if (!userActivityMap.has(userName)) {
        userActivityMap.set(userName, {
          name: userName,
          statusChanges: [],
          comments: [],
          tasksInProgress: []
        });
      }

      const userData = userActivityMap.get(userName);
      userData.statusChanges.push(change);
    });

    comments.forEach(comment => {
      if (!comment.author || !this._isHumanUser(comment.author)) return;

      const userName = comment.author.displayName || `Пользователь удалён (ID: ${comment.author.accountId})`;
      
      if (!userActivityMap.has(userName)) {
        userActivityMap.set(userName, {
          name: userName,
          statusChanges: [],
          comments: [],
          tasksInProgress: []
        });
      }

      const userData = userActivityMap.get(userName);
      userData.comments.push({
        issueKey,
        issueSummary
      });
    });

    if (isInProgress && issue.fields.assignee && this._isHumanUser(issue.fields.assignee)) {
      const userName = issue.fields.assignee.displayName || `Пользователь удалён (ID: ${issue.fields.assignee.accountId})`;
      
      if (!userActivityMap.has(userName)) {
        userActivityMap.set(userName, {
          name: userName,
          statusChanges: [],
          comments: [],
          tasksInProgress: []
        });
      }

      const userData = userActivityMap.get(userName);
      if (!userData.tasksInProgress.find(t => t.issueKey === issueKey)) {
        userData.tasksInProgress.push({
          issueKey,
          issueSummary,
          status: currentStatus
        });
      }
    }
  }

  _analyzeStatusChanges(changelog, issueKey, issueSummary) {
    const changes = [];
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;

    const statusHistories = changelog
      .filter(history => {
        const created = new Date(history.created).getTime();
        return created >= yesterday;
      })
      .flatMap(history => {
        const statusItems = history.items.filter(item => item.field === 'status');
        return statusItems.map(item => ({
          author: history.author,
          created: new Date(history.created),
          fromStatus: item.fromString,
          toStatus: item.toString
        }));
      })
      .sort((a, b) => a.created - b.created);

    if (statusHistories.length === 0) return changes;

    let i = 0;
    while (i < statusHistories.length) {
      const change = statusHistories[i];
      const authorName = change.author?.displayName || change.author?.accountId;
      
      let finalToStatus = change.toStatus;
      let timeInPreviousStatus = 0;
      let fromStatus = change.fromStatus;
      
      if (i > 0) {
        const prevChange = statusHistories[i - 1];
        timeInPreviousStatus = (change.created - prevChange.created) / 1000;
      }

      let j = i + 1;
      while (j < statusHistories.length) {
        const nextChange = statusHistories[j];
        const nextAuthorName = nextChange.author?.displayName || nextChange.author?.accountId;
        const timeDiff = (nextChange.created - change.created) / 1000;

        if (authorName === nextAuthorName && timeDiff <= 120) {
          finalToStatus = nextChange.toStatus;
          j++;
        } else {
          break;
        }
      }

      changes.push({
        issueKey,
        issueSummary,
        author: change.author,
        fromStatus,
        toStatus: finalToStatus,
        timeInPreviousStatus: Math.round(timeInPreviousStatus),
        timestamp: change.created
      });

      i = j;
    }

    return changes;
  }

  _prepareUsersData(userActivityMap) {
    const usersData = Array.from(userActivityMap.values())
      .filter(userData => {
        return userData.statusChanges.length > 0 || 
               userData.comments.length > 0 || 
               userData.tasksInProgress.length > 0;
      })
      .map(userData => {
        const uniqueComments = new Map();
        userData.comments.forEach(c => {
          uniqueComments.set(c.issueKey, c);
        });

        return {
          name: userData.name,
          statusChanges: userData.statusChanges,
          comments: Array.from(uniqueComments.values()),
          tasksInProgress: userData.tasksInProgress
        };
      });

    usersData.sort((a, b) => a.name.localeCompare(b.name));

    return usersData;
  }

  _isHumanUser(user) {
    return user.accountType !== 'app';
  }
}

module.exports = JiraAggregator;
