const JiraAggregator = require('../src/jira/aggregator');
const issues = require('./fixtures/jira-issues.json');
const commentsData = require('./fixtures/jira-comments.json');
const changelogData = require('./fixtures/jira-changelog.json');

describe('JiraAggregator', () => {
  let aggregator;
  let mockJiraClient;

  beforeEach(() => {
    mockJiraClient = {
      searchIssues: jest.fn(),
      getIssueComments: jest.fn(),
      getIssueChangelog: jest.fn()
    };

    aggregator = new JiraAggregator(mockJiraClient);
  });

  describe('aggregateData', () => {
    test('should aggregate data successfully', async () => {
      mockJiraClient.searchIssues.mockResolvedValue(issues);
      
      mockJiraClient.getIssueComments.mockImplementation((key) => {
        return Promise.resolve(commentsData[key] || []);
      });

      mockJiraClient.getIssueChangelog.mockImplementation((key) => {
        return Promise.resolve(changelogData[key] || []);
      });

      const result = await aggregator.aggregateData();

      expect(result.hasActivity).toBe(true);
      expect(result.summary.tasksCount).toBe(3);
      expect(result.summary.usersCount).toBe(3);
      expect(result.summary.commentsCount).toBe(3);
      expect(result.summary.statusCounts).toEqual({
        'In Progress': 2,
        'Done': 1
      });

      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].key).toBe('PROJ-123');
      expect(result.tasks[1].key).toBe('PROJ-124');
      expect(result.tasks[2].key).toBe('PROJ-125');

      expect(result.users).toHaveLength(3);
      
      const ivan = result.users.find(u => u.name === 'Иван Иванов');
      expect(ivan).toBeDefined();
      expect(ivan.commentsCount).toBe(1);
      expect(ivan.tasksCount).toBe(2);
      expect(ivan.tasks).toContain('PROJ-123');
      expect(ivan.tasks).toContain('PROJ-124');
    });

    test('should return empty result when no issues', async () => {
      mockJiraClient.searchIssues.mockResolvedValue([]);

      const result = await aggregator.aggregateData();

      expect(result.hasActivity).toBe(false);
      expect(result.summary.tasksCount).toBe(0);
      expect(result.summary.usersCount).toBe(0);
      expect(result.summary.commentsCount).toBe(0);
    });

    test('should handle task without assignee', async () => {
      const issueWithoutAssignee = [{
        key: 'PROJ-999',
        fields: {
          summary: 'Test',
          status: { name: 'To Do' },
          assignee: null,
          updated: '2026-01-11T10:00:00.000Z'
        }
      }];

      mockJiraClient.searchIssues.mockResolvedValue(issueWithoutAssignee);
      mockJiraClient.getIssueComments.mockResolvedValue([]);
      mockJiraClient.getIssueChangelog.mockResolvedValue([]);

      const result = await aggregator.aggregateData();

      expect(result.tasks[0].assignee).toBe('Нет исполнителя');
    });

    test('should filter out bots from user activity', async () => {
      const issueWithBot = [{
        key: 'PROJ-888',
        fields: {
          summary: 'Test',
          status: { name: 'To Do' },
          assignee: {
            displayName: 'Human User',
            accountId: '123',
            accountType: 'atlassian'
          },
          updated: '2026-01-11T10:00:00.000Z'
        }
      }];

      const commentsWithBot = [
        {
          id: '1',
          author: {
            displayName: 'Bot User',
            accountId: '999',
            accountType: 'app'
          },
          body: 'Bot comment',
          created: '2026-01-11T09:00:00.000Z'
        },
        {
          id: '2',
          author: {
            displayName: 'Human User',
            accountId: '123',
            accountType: 'atlassian'
          },
          body: 'Human comment',
          created: '2026-01-11T09:30:00.000Z'
        }
      ];

      mockJiraClient.searchIssues.mockResolvedValue(issueWithBot);
      mockJiraClient.getIssueComments.mockResolvedValue(commentsWithBot);
      mockJiraClient.getIssueChangelog.mockResolvedValue([]);

      const result = await aggregator.aggregateData();

      expect(result.summary.usersCount).toBe(1);
      expect(result.users[0].name).toBe('Human User');
      expect(result.users[0].commentsCount).toBe(1);
    });

    test('should handle deleted users', async () => {
      const issueWithDeletedUser = [{
        key: 'PROJ-777',
        fields: {
          summary: 'Test',
          status: { name: 'To Do' },
          assignee: null,
          updated: '2026-01-11T10:00:00.000Z'
        }
      }];

      const commentsWithDeletedUser = [
        {
          id: '1',
          author: {
            displayName: null,
            accountId: 'deleted-user-123',
            accountType: 'atlassian'
          },
          body: 'Comment',
          created: '2026-01-11T09:00:00.000Z'
        }
      ];

      mockJiraClient.searchIssues.mockResolvedValue(issueWithDeletedUser);
      mockJiraClient.getIssueComments.mockResolvedValue(commentsWithDeletedUser);
      mockJiraClient.getIssueChangelog.mockResolvedValue([]);

      const result = await aggregator.aggregateData();

      expect(result.users[0].name).toContain('Пользователь удалён (ID: deleted-user-123)');
    });

    test('should continue on partial errors', async () => {
      mockJiraClient.searchIssues.mockResolvedValue(issues);
      
      mockJiraClient.getIssueComments.mockImplementation((key) => {
        if (key === 'PROJ-123') {
          return Promise.reject(new Error('Timeout'));
        }
        return Promise.resolve(commentsData[key] || []);
      });

      mockJiraClient.getIssueChangelog.mockImplementation((key) => {
        return Promise.resolve(changelogData[key] || []);
      });

      const result = await aggregator.aggregateData();

      expect(result.hasActivity).toBe(true);
      expect(result.tasks.length).toBeGreaterThan(0);
    });
  });
});

