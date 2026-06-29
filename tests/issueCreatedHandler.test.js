const IssueCreatedHandler = require('../src/jira/issueCreatedHandler');

describe('IssueCreatedHandler', () => {
  const slackClient = {
    resolveJiraReviewBotMention: jest.fn(),
    postIssueCreatedThread: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.JIRA_ISSUE_NOTIFY_PROJECTS;
    slackClient.resolveJiraReviewBotMention.mockResolvedValue('<@UBOT123>');
    slackClient.postIssueCreatedThread.mockResolvedValue({ ts: '111.222' });
  });

  test('posts thread with bot mention and review command for CPAYMENT', async () => {
    const handler = new IssueCreatedHandler(slackClient, 'https://jira.example.com');

    await handler.handleIssueCreated('CPAYMENT-42', 'New payment flow');

    expect(slackClient.postIssueCreatedThread).toHaveBeenCalledWith(
      expect.stringContaining('CPAYMENT-42'),
      '<@UBOT123>\njira review CPAYMENT-42'
    );
  });

  test('ignores issues outside project filter', async () => {
    process.env.JIRA_ISSUE_NOTIFY_PROJECTS = 'CPAYMENT';
    const handler = new IssueCreatedHandler(slackClient, 'https://jira.example.com');

    await handler.handleIssueCreated('OTHER-1', 'Skip me');

    expect(slackClient.postIssueCreatedThread).not.toHaveBeenCalled();
  });

  test('still posts review line when bot mention is not configured', async () => {
    slackClient.resolveJiraReviewBotMention.mockResolvedValue('');
    const handler = new IssueCreatedHandler(slackClient, 'https://jira.example.com');

    await handler.handleIssueCreated('CPAYMENT-1', 'Summary');

    expect(slackClient.postIssueCreatedThread).toHaveBeenCalledWith(
      expect.any(String),
      'jira review CPAYMENT-1'
    );
  });

  test('cleans expired issue keys while checking duplicates', async () => {
    const handler = new IssueCreatedHandler(slackClient, 'https://jira.example.com');
    const now = Date.now();

    handler.recentIssues.set('CPAYMENT-1', now - (2 * 60 * 60 * 1000));
    handler.recentIssues.set('CPAYMENT-2', now);

    await handler.handleIssueCreated('CPAYMENT-3', 'Summary');

    expect(handler.recentIssues.has('CPAYMENT-1')).toBe(false);
    expect(handler.recentIssues.has('CPAYMENT-2')).toBe(true);
    expect(handler.recentIssues.has('CPAYMENT-3')).toBe(true);
  });
});
