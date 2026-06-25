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

    const issue = this._getOrCreateIssue(issueKey, summary, jiraBaseURL, threadTs);
    for (const mr of mergeRequests) {
      this._addMergeRequest(issue, mr);
    }
  }

  rememberMergeRequest(issueKey, summary, jiraBaseURL, threadTs, mergeRequest) {
    this._cleanup();
    const issue = this._getOrCreateIssue(issueKey, summary, jiraBaseURL, threadTs);
    const added = this._addMergeRequest(issue, this._normalizeMergeRequest(mergeRequest));

    return {
      added,
      issueKey: issue.issueKey,
      summary: issue.summary,
      jiraUrl: issue.jiraUrl,
      threadTs: issue.threadTs,
    };
  }

  hasIssue(issueKey) {
    this._cleanup();
    return this.issues.has(issueKey);
  }

  recordSuccessfulProdPipeline(issueKey, projectId, targetBranch, pipelineId) {
    this._cleanup();
    const issue = this.issues.get(issueKey);
    const seenKey = `${projectId}:${pipelineId}`;
    if (!issue || issue.notified || issue.seenPipelineIds.has(seenKey)) {
      return null;
    }

    issue.seenPipelineIds.add(seenKey);

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
      .map(result => this._normalizeMergeRequest(result));
  }

  _getOrCreateIssue(issueKey, summary, jiraBaseURL, threadTs) {
    const existing = this.issues.get(issueKey);
    if (existing) {
      if (summary && (!existing.summary || existing.summary === issueKey)) {
        existing.summary = summary;
      }
      if (threadTs && !existing.threadTs) {
        existing.threadTs = threadTs;
      }
      existing.jiraUrl = existing.jiraUrl || this._buildJiraUrl(jiraBaseURL, issueKey);
      return existing;
    }

    const issue = {
      issueKey,
      summary,
      jiraUrl: this._buildJiraUrl(jiraBaseURL, issueKey),
      threadTs,
      mergeRequests: [],
      seenPipelineIds: new Set(),
      notified: false,
      createdAt: Date.now(),
    };

    this.issues.set(issueKey, issue);
    return issue;
  }

  _addMergeRequest(issue, mergeRequest) {
    const exists = issue.mergeRequests.some(mr => {
      return mr.projectId === mergeRequest.projectId && mr.mrIid === mergeRequest.mrIid;
    });

    if (exists) {
      return false;
    }

    issue.mergeRequests.push(mergeRequest);
    issue.notified = false;
    return true;
  }

  _normalizeMergeRequest(mergeRequest) {
    return {
      projectId: mergeRequest.projectId,
      mrIid: mergeRequest.mrIid,
      mrRef: mergeRequest.mrRef,
      mrUrl: mergeRequest.mrUrl,
      sourceBranch: mergeRequest.sourceBranch,
      targetBranch: mergeRequest.targetBranch,
      status: mergeRequest.status === DEPLOYED_STATUS ? DEPLOYED_STATUS : 'pending',
    };
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
