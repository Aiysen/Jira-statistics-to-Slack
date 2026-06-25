const DeployTracker = require('../src/deploy/deployTracker');

describe('DeployTracker', () => {
  test('returns completion only after all tracked MRs have successful prod pipelines', () => {
    const tracker = new DeployTracker();

    tracker.rememberIssue('CPAYMENT-100', 'Deploy task', 'https://jira.chcadm.in', '1700000000.000100', [
      {
        projectId: 51,
        status: 'multiple_mrs',
        mrs: [
          {
            projectId: 51,
            status: 'created',
            mrIid: 1,
            mrRef: 'group/repo!1',
            mrUrl: 'https://git.chcadm.in/group/repo/-/merge_requests/1',
            sourceBranch: 'feature/CPAYMENT-100-a',
            targetBranch: 'master',
          },
          {
            projectId: 51,
            status: 'created',
            mrIid: 2,
            mrRef: 'group/repo!2',
            mrUrl: 'https://git.chcadm.in/group/repo/-/merge_requests/2',
            sourceBranch: 'feature/CPAYMENT-100-b',
            targetBranch: 'master',
          },
        ],
      },
    ]);

    const first = tracker.recordSuccessfulProdPipeline('CPAYMENT-100', 51, 'master', 1001);
    const duplicate = tracker.recordSuccessfulProdPipeline('CPAYMENT-100', 51, 'master', 1001);
    const second = tracker.recordSuccessfulProdPipeline('CPAYMENT-100', 51, 'master', 1002);

    expect(first).toBeNull();
    expect(duplicate).toBeNull();
    expect(second).toEqual({
      issueKey: 'CPAYMENT-100',
      summary: 'Deploy task',
      jiraUrl: 'https://jira.chcadm.in/browse/CPAYMENT-100',
      threadTs: '1700000000.000100',
    });
  });

  test('adds manually registered MR only once', () => {
    const tracker = new DeployTracker();

    const first = tracker.rememberMergeRequest(
      'CPAYMENT-1417',
      'CPAYMENT-1417 sentry replay',
      'https://jira.chcadm.in',
      '1700000000.000100',
      {
        projectId: 22,
        mrIid: 7,
        mrRef: 'group/repo!7',
        mrUrl: 'https://git.chcadm.in/group/repo/-/merge_requests/7',
        sourceBranch: 'CPAYMENT-1417/sentry-replay',
        targetBranch: 'main',
      }
    );
    const second = tracker.rememberMergeRequest(
      'CPAYMENT-1417',
      'CPAYMENT-1417 sentry replay',
      'https://jira.chcadm.in',
      '1700000000.000100',
      {
        projectId: 22,
        mrIid: 7,
        mrRef: 'group/repo!7',
        mrUrl: 'https://git.chcadm.in/group/repo/-/merge_requests/7',
        sourceBranch: 'CPAYMENT-1417/sentry-replay',
        targetBranch: 'main',
      }
    );

    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
  });
});
