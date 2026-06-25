const PipelineHandler = require('../src/gitlab/pipelineHandler');

function makePayload(overrides = {}) {
  return {
    object_kind: 'pipeline',
    object_attributes: {
      id: 123,
      ref: 'master',
      status: 'success',
      url: 'https://git.chcadm.in/group/repo/-/pipelines/123',
      duration: 65,
      ...overrides.object_attributes
    },
    project: {
      id: 51,
      name: 'repo',
      web_url: 'https://git.chcadm.in/group/repo',
      ...overrides.project
    },
    commit: {
      id: 'abcdef123456',
      message: 'CPAYMENT-100 Deploy task\n\nDetails',
      url: 'https://git.chcadm.in/group/repo/-/commit/abcdef123456',
      author: { name: 'Developer' },
      ...overrides.commit
    },
    user: {
      name: 'Developer',
      ...overrides.user
    }
  };
}

function makeSlackClient(threadTs = null) {
  return {
    getDeployThreadTs: jest.fn().mockReturnValue(threadTs),
    postDeployNotification: jest.fn().mockResolvedValue({ ts: '1700000000.000200' })
  };
}

describe('PipelineHandler.handlePipelineEvent', () => {
  test('posts pipeline notification into deploy-ready thread when issue thread exists', async () => {
    const slack = makeSlackClient('1700000000.000100');
    const jira = {
      getIssueSummary: jest.fn().mockResolvedValue('Deploy task')
    };
    const handler = new PipelineHandler(slack, jira);

    await handler.handlePipelineEvent(makePayload());

    expect(slack.getDeployThreadTs).toHaveBeenCalledWith('CPAYMENT-100');
    expect(slack.postDeployNotification).toHaveBeenCalledWith(
      expect.stringContaining('Pipeline'),
      { threadTs: '1700000000.000100' }
    );
  });

  test('posts pipeline notification without thread when issue thread is unknown', async () => {
    const slack = makeSlackClient();
    const handler = new PipelineHandler(slack);

    await handler.handlePipelineEvent(makePayload());

    expect(slack.postDeployNotification).toHaveBeenCalledWith(
      expect.stringContaining('Pipeline'),
      { threadTs: null }
    );
  });

  test('ignores unwatched branches before looking up thread', async () => {
    const slack = makeSlackClient('1700000000.000100');
    const handler = new PipelineHandler(slack);

    await handler.handlePipelineEvent(makePayload({
      object_attributes: { ref: 'feature/CPAYMENT-100' }
    }));

    expect(slack.getDeployThreadTs).not.toHaveBeenCalled();
    expect(slack.postDeployNotification).not.toHaveBeenCalled();
  });

  test('posts deploy completion message when tracker says issue is fully deployed', async () => {
    const slack = makeSlackClient('1700000000.000100');
    const tracker = {
      recordSuccessfulProdPipeline: jest.fn().mockReturnValue({
        issueKey: 'CPAYMENT-100',
        summary: 'Deploy task',
        jiraUrl: 'https://jira.chcadm.in/browse/CPAYMENT-100',
        threadTs: '1700000000.000100'
      })
    };
    const handler = new PipelineHandler(slack, null, tracker);

    await handler.handlePipelineEvent(makePayload());

    expect(tracker.recordSuccessfulProdPipeline).toHaveBeenCalledWith(
      'CPAYMENT-100',
      51,
      'master',
      123
    );
    expect(slack.postDeployNotification).toHaveBeenCalledTimes(2);
    expect(slack.postDeployNotification).toHaveBeenLastCalledWith(
      expect.stringContaining('Деплой задачи завершен'),
      { threadTs: '1700000000.000100' }
    );
    expect(slack.postDeployNotification.mock.calls[1][0]).toContain('@Gevork @Jegor Bogomolov');
    expect(slack.postDeployNotification.mock.calls[1][0]).toContain(
      '<https://jira.chcadm.in/browse/CPAYMENT-100|CPAYMENT-100: Deploy task>'
    );
  });

  test('does not complete deploy on manual pipeline status', async () => {
    const slack = makeSlackClient('1700000000.000100');
    const tracker = {
      recordSuccessfulProdPipeline: jest.fn()
    };
    const handler = new PipelineHandler(slack, null, tracker);

    await handler.handlePipelineEvent(makePayload({
      object_attributes: { status: 'manual' }
    }));

    expect(tracker.recordSuccessfulProdPipeline).not.toHaveBeenCalled();
    expect(slack.postDeployNotification).toHaveBeenCalledTimes(1);
  });

  test('reconciles manual MRs from GitLab before recording successful prod pipeline', async () => {
    const slack = makeSlackClient('1700000000.000100');
    const tracker = {
      rememberMergeRequest: jest.fn(),
      recordSuccessfulProdPipeline: jest.fn().mockReturnValue(null)
    };
    const gitlab = {
      listMergeRequestsByIssueKey: jest.fn().mockResolvedValue([
        {
          iid: 7,
          title: 'CPAYMENT-100 Deploy task',
          source_branch: 'CPAYMENT-100/manual-mr',
          target_branch: 'master',
          web_url: 'https://git.chcadm.in/group/repo/-/merge_requests/7',
          references: { full: 'group/repo!7' }
        }
      ])
    };
    const handler = new PipelineHandler(slack, null, tracker, gitlab);

    await handler.handlePipelineEvent(makePayload());

    expect(gitlab.listMergeRequestsByIssueKey).toHaveBeenCalledWith(51, 'CPAYMENT-100', 'master');
    expect(tracker.rememberMergeRequest).toHaveBeenCalledWith(
      'CPAYMENT-100',
      'CPAYMENT-100 Deploy task',
      expect.any(String),
      '1700000000.000100',
      expect.objectContaining({
        projectId: 51,
        mrIid: 7,
        sourceBranch: 'CPAYMENT-100/manual-mr',
        targetBranch: 'master'
      })
    );
    expect(tracker.recordSuccessfulProdPipeline).toHaveBeenCalledWith(
      'CPAYMENT-100',
      51,
      'master',
      123
    );
  });
});
