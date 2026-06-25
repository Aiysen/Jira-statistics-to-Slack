const DEPLOY_TRACKER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEPLOYED_STATUS = 'deployed';

class DeployTracker {
  constructor() {
    this.issues = new Map();
  }

  rememberIssue(issueKey, summary, jiraBaseURL, threadTs, results) {
    this._cleanup();
    const mergeRequests = this._extractMergeRequests(results);

    if (mergeRequests.length === 0) {
      return;
    }

    this.issues.set(issueKey, {
      issueKey,
      summary,
      jiraUrl: this._buildJiraUrl(jiraBaseURL, issueKey),
      threadTs,
      mergeRequests,
      seenPipelineIds: new Set(),
      notified: false,
      createdAt: Date.now(),
    });
  }

  recordSuccessfulProdPipeline(issueKey, projectId, targetBranch, pipelineId) {
    this._cleanup();
    const issue = this.issues.get(issueKey);
    if (!issue || issue.notified || issue.seenPipelineIds.has(pipelineId)) {
      return null;
    }

    issue.seenPipelineIds.add(pipelineId);

    const pending = issue.mergeRequests.find(mr => {
      return mr.projectId === projectId &&
        mr.targetBranch === targetBranch &&
        mr.status !== DEPLOYED_STATUS;
    });

    if (!pending) {
      return null;
    }

    pending.status = DEPLOYED_STATUS;
    pending.pipelineId = pipelineId;

    if (issue.mergeRequests.every(mr => mr.status === DEPLOYED_STATUS)) {
      issue.notified = true;
      return {
        issueKey: issue.issueKey,
        summary: issue.summary,
        jiraUrl: issue.jiraUrl,
        threadTs: issue.threadTs,
      };
    }

    return null;
  }

  _extractMergeRequests(results) {
    return results
      .flatMap(result => result.status === 'multiple_mrs' ? result.mrs : [result])
      .filter(result => ['created', 'existing'].includes(result.status))
      .map(result => ({
        projectId: result.projectId,
        mrIid: result.mrIid,
        mrRef: result.mrRef,
        mrUrl: result.mrUrl,
        sourceBranch: result.sourceBranch,
        targetBranch: result.targetBranch,
        status: 'pending',
      }));
  }

  _buildJiraUrl(jiraBaseURL, issueKey) {
    const baseURL = jiraBaseURL || process.env.JIRA_BASE_URL || '';
    return `${baseURL}/browse/${issueKey}`;
  }

  _cleanup() {
    const now = Date.now();
    for (const [issueKey, issue] of this.issues.entries()) {
      if (now - issue.createdAt > DEPLOY_TRACKER_TTL_MS) {
        this.issues.delete(issueKey);
      }
    }
  }
}

module.exports = DeployTracker;
