const WebhookHandler = require('../src/deploy/webhookHandler');

function makeGitlabClient(overrides = {}) {
  return {
    searchBranchesByIssueKey: jest.fn().mockResolvedValue([]),
    getExistingMergeRequest: jest.fn().mockResolvedValue(null),
    hasDiff: jest.fn().mockResolvedValue(true),
    createMergeRequest: jest.fn().mockResolvedValue({
      web_url: 'https://git.chcadm.in/group/repo/-/merge_requests/1',
      iid: 1,
      references: { full: 'group/repo!1' },
      has_conflicts: false,
      merge_status: 'can_be_merged'
    }),
    getMergeRequest: jest.fn().mockResolvedValue({
      iid: 1,
      has_conflicts: false,
      merge_status: 'can_be_merged'
    }),
    getProject: jest.fn().mockResolvedValue({
      name: 'repo',
      path_with_namespace: 'group/repo',
      web_url: 'https://git.chcadm.in/group/repo'
    }),
    createMergeRequestNote: jest.fn().mockResolvedValue({ id: 100 }),
    ...overrides
  };
}

function makeSlackClient() {
  return {
    postDeployNotification: jest.fn().mockResolvedValue({ ts: '1700000000.000100' }),
    rememberDeployThread: jest.fn(),
    getDeployThreadTs: jest.fn().mockReturnValue('1700000000.000100')
  };
}

describe('WebhookHandler._processProject', () => {
  const issueKey = 'CPAYMENT-1000';
  const summary = 'Test task';
  const project = { id: 51, targetBranch: 'master' };

  test('no_branch: returns status when no branches found', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([])
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    const result = await handler._processProject(issueKey, summary, project);

    expect(result.status).toBe('no_branch');
    expect(result.projectId).toBe(51);
    expect(result.projectName).toBe('group/repo');
    expect(result.projectUrl).toBe('https://git.chcadm.in/group/repo');
  });

  test('multiple branches: requires manual decision without creating MR', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([
        { name: 'feature/CPAYMENT-1000' },
        { name: 'bugfix/CPAYMENT-1000' }
      ])
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    const result = await handler._processProject(issueKey, summary, project);

    expect(result.status).toBe('multiple_branches');
    expect(result.branches).toEqual(['feature/CPAYMENT-1000', 'bugfix/CPAYMENT-1000']);
    expect(result.mrs).toBeUndefined();
    expect(gitlab.createMergeRequest).not.toHaveBeenCalled();
  });

  test('existing: returns link when MR already open', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([
        { name: 'feature/CPAYMENT-1000' }
      ]),
      getExistingMergeRequest: jest.fn().mockResolvedValue({
        web_url: 'https://git.chcadm.in/group/repo/-/merge_requests/5',
        iid: 5,
        references: { full: 'group/repo!5' },
        has_conflicts: false,
        merge_status: 'can_be_merged'
      })
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    const result = await handler._processProject(issueKey, summary, project);

    expect(result.status).toBe('existing');
    expect(result.mrRef).toBe('group/repo!5');
    expect(result.hasConflict).toBe(false);
    expect(gitlab.createMergeRequest).not.toHaveBeenCalled();
    expect(gitlab.createMergeRequestNote).not.toHaveBeenCalled();
  });

  test('empty_diff: does not create MR when diff is empty', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([
        { name: 'feature/CPAYMENT-1000' }
      ]),
      hasDiff: jest.fn().mockResolvedValue(false)
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    const result = await handler._processProject(issueKey, summary, project);

    expect(result.status).toBe('empty_diff');
    expect(gitlab.createMergeRequest).not.toHaveBeenCalled();
  });

  test('created: creates MR and returns url when all conditions met', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([
        { name: 'feature/CPAYMENT-1000' }
      ])
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    const result = await handler._processProject(issueKey, summary, project);

    expect(result.status).toBe('created');
    expect(result.mrRef).toBe('group/repo!1');
    expect(result.hasConflict).toBe(false);
    expect(gitlab.createMergeRequest).toHaveBeenCalledWith(
      51,
      'feature/CPAYMENT-1000',
      'master',
      'CPAYMENT-1000: Test task'
    );
    expect(gitlab.createMergeRequestNote).not.toHaveBeenCalled();
  });

  test('created with conflict: posts note and sets hasConflict=true', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([
        { name: 'feature/CPAYMENT-1000' }
      ]),
      createMergeRequest: jest.fn().mockResolvedValue({
        web_url: 'https://git.chcadm.in/group/repo/-/merge_requests/1',
        iid: 1,
        references: { full: 'group/repo!1' },
        has_conflicts: true,
        merge_status: 'cannot_be_merged'
      })
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    const result = await handler._processProject(issueKey, summary, project);

    expect(result.status).toBe('created');
    expect(result.hasConflict).toBe(true);
    expect(result.targetBranch).toBe('master');
    expect(gitlab.createMergeRequestNote).toHaveBeenCalledTimes(1);
    const noteBody = gitlab.createMergeRequestNote.mock.calls[0][2];
    expect(noteBody).toContain('[jira-deploy-bot:conflict]');
    expect(noteBody).toContain('master');
    expect(noteBody).toContain('@jbogomolov');
  });

  test('existing with conflict: posts note and sets hasConflict=true', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([
        { name: 'feature/CPAYMENT-1000' }
      ]),
      getExistingMergeRequest: jest.fn().mockResolvedValue({
        web_url: 'https://git.chcadm.in/group/repo/-/merge_requests/5',
        iid: 5,
        references: { full: 'group/repo!5' },
        has_conflicts: true,
        merge_status: 'cannot_be_merged'
      })
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    const result = await handler._processProject(issueKey, summary, project);

    expect(result.status).toBe('existing');
    expect(result.hasConflict).toBe(true);
    expect(gitlab.createMergeRequestNote).toHaveBeenCalledTimes(1);
    const noteBody = gitlab.createMergeRequestNote.mock.calls[0][2];
    expect(noteBody).toContain('@jbogomolov');
  });

  test('conflict note dedup: does not post second note for same MR', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([
        { name: 'feature/CPAYMENT-1000' }
      ]),
      getExistingMergeRequest: jest.fn().mockResolvedValue({
        web_url: 'https://git.chcadm.in/group/repo/-/merge_requests/5',
        iid: 5,
        references: { full: 'group/repo!5' },
        has_conflicts: true,
        merge_status: 'cannot_be_merged'
      })
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    await handler._processProject(issueKey, summary, project);
    await handler._processProject(issueKey, summary, project);

    expect(gitlab.createMergeRequestNote).toHaveBeenCalledTimes(1);
  });

  test('merge_status checking: re-fetches MR before deciding on conflict', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([
        { name: 'feature/CPAYMENT-1000' }
      ]),
      createMergeRequest: jest.fn().mockResolvedValue({
        web_url: 'https://git.chcadm.in/group/repo/-/merge_requests/1',
        iid: 1,
        references: { full: 'group/repo!1' },
        has_conflicts: false,
        merge_status: 'checking'
      }),
      getMergeRequest: jest.fn().mockResolvedValue({
        iid: 1,
        has_conflicts: true,
        merge_status: 'cannot_be_merged'
      })
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    const result = await handler._processProject(issueKey, summary, project);

    expect(result.hasConflict).toBe(true);
    expect(gitlab.getMergeRequest).toHaveBeenCalledWith(51, 1);
    expect(gitlab.createMergeRequestNote).toHaveBeenCalledTimes(1);
  }, 10000);

  test('error: returns error status on API failure', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockRejectedValue(new Error('Network error'))
    });
    const handler = new WebhookHandler(gitlab, makeSlackClient());

    const result = await handler._processProject(issueKey, summary, project);

    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('Network error');
  });
});

describe('WebhookHandler dedup', () => {
  test('ignores duplicate event within window', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([])
    });
    const slack = makeSlackClient();
    const handler = new WebhookHandler(gitlab, slack);

    await handler.handleDeployReady('CPAYMENT-100', null, 'Task');
    await handler.handleDeployReady('CPAYMENT-100', null, 'Task');

    expect(slack.postDeployNotification).toHaveBeenCalledTimes(1);
    expect(slack.rememberDeployThread).toHaveBeenCalledTimes(1);
  });

  test('allows different issue keys', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([])
    });
    const slack = makeSlackClient();
    const handler = new WebhookHandler(gitlab, slack);

    await handler.handleDeployReady('CPAYMENT-100', null, 'Task A');
    await handler.handleDeployReady('CPAYMENT-101', null, 'Task B');

    expect(slack.postDeployNotification).toHaveBeenCalledTimes(2);
  });

  test('stores Slack thread timestamp for deploy-ready issue', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([])
    });
    const slack = makeSlackClient();
    const handler = new WebhookHandler(gitlab, slack);

    await handler.handleDeployReady('CPAYMENT-100', null, 'Task');

    expect(slack.rememberDeployThread).toHaveBeenCalledWith('CPAYMENT-100', '1700000000.000100');
  });

  test('registers created MRs in deploy tracker', async () => {
    const gitlab = makeGitlabClient({
      searchBranchesByIssueKey: jest.fn().mockResolvedValue([
        { name: 'feature/CPAYMENT-100' }
      ])
    });
    const slack = makeSlackClient();
    const deployTracker = {
      rememberIssue: jest.fn()
    };
    const handler = new WebhookHandler(gitlab, slack, null, deployTracker);

    await handler.handleDeployReady('CPAYMENT-100', null, 'Task');

    expect(deployTracker.rememberIssue).toHaveBeenCalledWith(
      'CPAYMENT-100',
      'Task',
      expect.any(String),
      '1700000000.000100',
      expect.arrayContaining([
        expect.objectContaining({ status: 'created', sourceBranch: 'feature/CPAYMENT-100' })
      ])
    );
  });
});

describe('WebhookHandler.handleMergeRequestEvent', () => {
  function makeMergeRequestPayload(overrides = {}) {
    return {
      object_kind: 'merge_request',
      project: {
        id: 22,
        name: 'repo',
        path_with_namespace: 'group/repo',
        web_url: 'https://git.chcadm.in/group/repo'
      },
      object_attributes: {
        iid: 7,
        title: 'CPAYMENT-1417: sentry replay',
        source_branch: 'CPAYMENT-1417/sentry-replay',
        target_branch: 'main',
        state: 'opened',
        url: 'https://git.chcadm.in/group/repo/-/merge_requests/7',
        references: { full: 'group/repo!7' },
        ...overrides.object_attributes
      },
      ...overrides
    };
  }

  test('registers manual MR and posts note into deploy thread', async () => {
    const slack = makeSlackClient();
    const deployTracker = {
      rememberMergeRequest: jest.fn().mockReturnValue({
        added: true,
        jiraUrl: 'https://jira.chcadm.in/browse/CPAYMENT-1417',
        threadTs: '1700000000.000100'
      })
    };
    const handler = new WebhookHandler(makeGitlabClient(), slack, 'https://jira.chcadm.in', deployTracker);

    await handler.handleMergeRequestEvent(makeMergeRequestPayload());

    expect(deployTracker.rememberMergeRequest).toHaveBeenCalledWith(
      'CPAYMENT-1417',
      'CPAYMENT-1417: sentry replay',
      'https://jira.chcadm.in',
      '1700000000.000100',
      expect.objectContaining({
        projectId: 22,
        mrIid: 7,
        sourceBranch: 'CPAYMENT-1417/sentry-replay',
        targetBranch: 'main'
      })
    );
    expect(slack.postDeployNotification).toHaveBeenCalledWith(
      expect.stringContaining('Ручной MR добавлен в отслеживание деплоя'),
      { threadTs: '1700000000.000100' }
    );
  });

  test('ignores MR without Jira key', async () => {
    const slack = makeSlackClient();
    const deployTracker = {
      rememberMergeRequest: jest.fn()
    };
    const handler = new WebhookHandler(makeGitlabClient(), slack, 'https://jira.chcadm.in', deployTracker);

    await handler.handleMergeRequestEvent(makeMergeRequestPayload({
      object_attributes: {
        title: 'No Jira key',
        source_branch: 'feature/sentry-replay'
      }
    }));

    expect(deployTracker.rememberMergeRequest).not.toHaveBeenCalled();
    expect(slack.postDeployNotification).not.toHaveBeenCalled();
  });
});

describe('WebhookHandler._formatProjectResult', () => {
  const handler = new WebhookHandler(makeGitlabClient(), makeSlackClient());

  test('created without conflict', () => {
    const result = handler._formatProjectResult({
      projectId: 51,
      status: 'created',
      mrUrl: 'https://git.chcadm.in/group/repo/-/merge_requests/1',
      mrRef: 'group/repo!1',
      hasConflict: false
    });
    expect(result).toContain('создан');
    expect(result).toContain('group/repo!1');
    expect(result).not.toContain('конфликт');
  });

  test('created with conflict: shows conflict warning and mention', () => {
    const result = handler._formatProjectResult({
      projectId: 51,
      status: 'created',
      mrUrl: 'https://git.chcadm.in/group/repo/-/merge_requests/1',
      mrRef: 'group/repo!1',
      hasConflict: true,
      targetBranch: 'master'
    });
    expect(result).toContain('создан');
    expect(result).toContain('конфликт');
    expect(result).toContain('master');
    expect(result).toContain('@Jegor Bogomolov');
  });

  test('existing with conflict: shows conflict warning and mention', () => {
    const result = handler._formatProjectResult({
      projectId: 51,
      status: 'existing',
      mrUrl: 'https://git.chcadm.in/group/repo/-/merge_requests/5',
      mrRef: 'group/repo!5',
      hasConflict: true,
      targetBranch: 'main'
    });
    expect(result).toContain('уже существует');
    expect(result).toContain('конфликт');
    expect(result).toContain('main');
    expect(result).toContain('@Jegor Bogomolov');
  });

  test('no_branch', () => {
    const result = handler._formatProjectResult({ projectId: 51, status: 'no_branch' });
    expect(result).toContain('ветка не найдена');
    expect(result).toContain('51');
  });

  test('multiple_mrs', () => {
    const result = handler._formatProjectResult({
      projectId: 22,
      projectName: 'group/repo',
      projectUrl: 'https://git.chcadm.in/group/repo',
      status: 'multiple_mrs',
      branches: ['feature/X-1', 'bugfix/X-1'],
      mrs: [
        {
          projectId: 22,
          projectName: 'group/repo',
          projectUrl: 'https://git.chcadm.in/group/repo',
          status: 'created',
          mrUrl: 'https://git.chcadm.in/group/repo/-/merge_requests/1',
          mrRef: 'group/repo!1',
          hasConflict: false
        },
        {
          projectId: 22,
          projectName: 'group/repo',
          projectUrl: 'https://git.chcadm.in/group/repo',
          status: 'created',
          mrUrl: 'https://git.chcadm.in/group/repo/-/merge_requests/2',
          mrRef: 'group/repo!2',
          hasConflict: false
        }
      ]
    });
    expect(result).toContain('несколько веток обработано');
    expect(result).toContain('<https://git.chcadm.in/group/repo|group/repo> (Project 22)');
    expect(result).toContain('group/repo!1');
    expect(result).toContain('group/repo!2');
  });

  test('multiple_branches: includes repository link in manual action message', () => {
    const result = handler._formatProjectResult({
      projectId: 22,
      projectName: 'group/repo',
      projectUrl: 'https://git.chcadm.in/group/repo',
      status: 'multiple_branches',
      branches: ['CPAYMENT-1417/sentry-replay', 'CPAYMENT-1417/sentry-replay-test']
    });

    expect(result).toBe(
      '• <https://git.chcadm.in/group/repo|group/repo> (Project 22): ' +
      'несколько веток: `CPAYMENT-1417/sentry-replay`, `CPAYMENT-1417/sentry-replay-test` — ' +
      'нужно разобраться вручную'
    );
  });

  test('empty_diff', () => {
    const result = handler._formatProjectResult({ projectId: 51, status: 'empty_diff' });
    expect(result).toContain('diff пустой');
  });
});
