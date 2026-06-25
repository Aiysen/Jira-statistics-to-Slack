const logger = require('../utils/logger');
const { resolveSlackMentions, DEFAULT_SLACK_DEPLOY_CONFLICT } = require('../slack/members');
const { getGitlabProjects } = require('../gitlab/config');

const DEDUP_WINDOW_MS = 60 * 60 * 1000;
const MR_CONFLICT_NOTE_MARKER = '[jira-deploy-bot:conflict]';
const JIRA_KEY_REGEX = /([A-Z][A-Z0-9]+-\d+)/;
// После создания MR GitLab может ещё вычислять merge_status; ждём и делаем один повторный запрос
const MERGE_STATUS_CHECK_DELAY_MS = 2000;

class WebhookHandler {
  constructor(gitlabClient, slackClient, jiraBaseURL, deployTracker = null, jiraClient = null) {
    this.gitlabClient = gitlabClient;
    this.slackClient = slackClient;
    this.jiraBaseURL = jiraBaseURL || process.env.JIRA_BASE_URL || '';
    this.deployTracker = deployTracker;
    this.jiraClient = jiraClient;
    this.recentIssues = new Map();
    // in-memory дедупликация conflict-note: Set из "projectId:mrIid"
    this.notifiedConflicts = new Set();
  }

  async handleDeployReady(issueKey, issueId, summary) {
    logger.info('Handling deploy-ready event', { issueKey, summary });

    if (this._isDuplicate(issueKey)) {
      logger.info('Duplicate event ignored', { issueKey });
      return;
    }
    this.recentIssues.set(issueKey, Date.now());

    const projects = getGitlabProjects();
    const results = await Promise.all(
      projects.map(project => this._processProject(issueKey, summary, project))
    );

    const branchHint = await this._fetchBranchHint(issueKey, results);
    const message = this._formatSlackMessage(issueKey, summary, results, branchHint);
    const slackResult = await this.slackClient.postDeployNotification(message);
    this.slackClient.rememberDeployThread(issueKey, slackResult?.ts);
    this.deployTracker?.rememberIssue(issueKey, summary, this.jiraBaseURL, slackResult?.ts, results);

    logger.info('Deploy-ready handled', {
      issueKey,
      results: results.map(r => ({ projectId: r.projectId, status: r.status, hasConflict: r.hasConflict }))
    });
  }

  async handleMergeRequestEvent(payload) {
    if (!this.deployTracker) {
      logger.debug('Merge request event ignored: deploy tracker is not configured');
      return;
    }

    const mr = payload.object_attributes || {};
    if (mr.state === 'closed') {
      logger.debug('Merge request event ignored: MR is closed', { mrIid: mr.iid });
      return;
    }

    const issueKey = this._extractIssueKey([mr.title, mr.source_branch].filter(Boolean).join(' '));
    if (!issueKey) {
      logger.debug('Merge request event ignored: Jira key not found', { mrIid: mr.iid });
      return;
    }

    const project = this._findConfiguredProject(payload.project?.id, mr.target_branch);
    if (!project) {
      logger.debug('Merge request event ignored: project or target branch is not configured', {
        projectId: payload.project?.id,
        targetBranch: mr.target_branch
      });
      return;
    }

    const projectInfo = await this._getProjectInfo({
      id: project.id,
      name: payload.project?.name,
      path_with_namespace: payload.project?.path_with_namespace,
      web_url: payload.project?.web_url
    });
    const threadTs = this.slackClient.getDeployThreadTs?.(issueKey) || null;
    const result = this.deployTracker.rememberMergeRequest(
      issueKey,
      mr.title || issueKey,
      this.jiraBaseURL,
      threadTs,
      this._toTrackedMergeRequest(project.id, mr, projectInfo)
    );

    if (result.added && threadTs) {
      await this.slackClient.postDeployNotification(
        this._formatManualMergeRequestMessage(issueKey, result.jiraUrl, mr, {
          projectId: project.id,
          ...projectInfo
        }),
        { threadTs }
      );
    }

    logger.info('Merge request registered for deploy tracking', {
      issueKey,
      projectId: project.id,
      mrIid: mr.iid,
      added: result.added,
      threaded: Boolean(threadTs)
    });
  }

  async _processProject(issueKey, summary, project) {
    const { id: projectId } = project;
    const projectInfo = await this._getProjectInfo(project);

    try {
      const branches = await this.gitlabClient.searchBranchesByIssueKey(projectId, issueKey);

      if (branches.length === 0) {
        return { projectId, ...projectInfo, status: 'no_branch' };
      }

      if (branches.length > 1) {
        return {
          projectId,
          ...projectInfo,
          status: 'multiple_branches',
          branches: branches.map(b => b.name)
        };
      }

      return await this._processBranch(issueKey, summary, project, branches[0].name, projectInfo);

    } catch (error) {
      logger.error('Failed to process project for deploy-ready', {
        projectId,
        issueKey,
        error: error.message
      });
      return { projectId, ...projectInfo, status: 'error', errorMessage: error.message };
    }
  }

  async _processBranch(issueKey, summary, project, sourceBranch, projectInfo = {}) {
    const { id: projectId, targetBranch } = project;

    try {
      const diffExists = await this.gitlabClient.hasDiff(projectId, sourceBranch, targetBranch);
      if (!diffExists) {
        return { projectId, ...projectInfo, status: 'empty_diff' };
      }

      const existing = await this.gitlabClient.getExistingMergeRequest(
        projectId, sourceBranch, targetBranch
      );
      if (existing) {
        const hasConflict = await this._checkAndHandleConflict(
          projectId, existing, targetBranch, sourceBranch
        );
        return {
          projectId,
          ...projectInfo,
          status: 'existing',
          mrUrl: existing.web_url,
          mrIid: existing.iid,
          mrRef: existing.references?.full || `!${existing.iid}`,
          sourceBranch,
          hasConflict,
          targetBranch
        };
      }

      const mr = await this.gitlabClient.createMergeRequest(
        projectId,
        sourceBranch,
        targetBranch,
        `${issueKey}: ${summary}`
      );

      const hasConflict = await this._checkAndHandleConflict(
        projectId, mr, targetBranch, sourceBranch
      );
      return {
        projectId,
        ...projectInfo,
        status: 'created',
        mrUrl: mr.web_url,
        mrIid: mr.iid,
        mrRef: mr.references?.full || `!${mr.iid}`,
        sourceBranch,
        hasConflict,
        targetBranch
      };

    } catch (error) {
      logger.error('Failed to process project for deploy-ready', {
        projectId,
        issueKey,
        sourceBranch,
        error: error.message
      });
      return { projectId, ...projectInfo, status: 'error', errorMessage: error.message };
    }
  }

  _findConfiguredProject(projectId, targetBranch) {
    return getGitlabProjects().find(project => {
      return project.id === projectId && project.targetBranch === targetBranch;
    });
  }

  _extractIssueKey(text) {
    const match = text.match(JIRA_KEY_REGEX);
    return match ? match[1] : null;
  }

  _toTrackedMergeRequest(projectId, mr, projectInfo = {}) {
    return {
      projectId,
      ...projectInfo,
      mrIid: mr.iid,
      mrRef: mr.references?.full || `!${mr.iid}`,
      mrUrl: mr.url || mr.web_url,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
    };
  }

  async _getProjectInfo(project) {
    const projectName = project.name || project.pathWithNamespace || project.path_with_namespace;
    const projectUrl = project.webUrl || project.web_url;
    if (projectName || projectUrl || typeof this.gitlabClient.getProject !== 'function') {
      return { projectName, projectUrl };
    }

    try {
      const data = await this.gitlabClient.getProject(project.id);
      return {
        projectName: data.path_with_namespace || data.name_with_namespace || data.name,
        projectUrl: data.web_url
      };
    } catch (error) {
      logger.warn('Failed to fetch GitLab project info', {
        projectId: project.id,
        error: error.message
      });
      return {};
    }
  }

  async _checkAndHandleConflict(projectId, mr, targetBranch, sourceBranch) {
    try {
      const branch = sourceBranch || mr.source_branch;
      if (branch && !(await this.gitlabClient.hasDiff(projectId, branch, targetBranch))) {
        return false;
      }

      const hasConflict = await this._getMrHasConflict(projectId, mr);
      if (hasConflict) {
        await this._postConflictNote(projectId, mr.iid, targetBranch);
      }
      return hasConflict;
    } catch (error) {
      logger.warn('Failed to check or handle MR conflict', {
        projectId,
        mrIid: mr.iid,
        error: error.message
      });
      return false;
    }
  }

  async _getMrHasConflict(projectId, mr) {
    let data = mr;
    if (data.merge_status === 'checking') {
      await new Promise(resolve => setTimeout(resolve, MERGE_STATUS_CHECK_DELAY_MS));
      data = await this.gitlabClient.getMergeRequest(projectId, mr.iid);
    }
    return data.has_conflicts === true;
  }

  async _postConflictNote(projectId, mrIid, targetBranch) {
    const key = `${projectId}:${mrIid}`;
    if (this.notifiedConflicts.has(key)) {
      logger.debug('Conflict note already posted, skipping', { projectId, mrIid });
      return;
    }

    const gitlabMention = process.env.GITLAB_MENTION_ON_MR_CONFLICT || 'jbogomolov';
    const body = [
      `${MR_CONFLICT_NOTE_MARKER} ⚠️ При автосоздании MR (Ready for Deploy) обнаружен конфликт слияния с веткой \`${targetBranch}\`.`,
      'Необходимо разрешить конфликт вручную.',
      '',
      `@${gitlabMention}`
    ].join('\n');

    await this.gitlabClient.createMergeRequestNote(projectId, mrIid, body);
    this.notifiedConflicts.add(key);
    logger.info('Conflict note posted to MR', { projectId, mrIid });
  }

  _formatSlackMessage(issueKey, summary, results, branchHint = null) {
    const jiraUrl = `${this.jiraBaseURL}/browse/${issueKey}`;
    let message = `🚀 *Ready for Deploy* — ${issueKey}: ${summary}\n`;
    message += `Jira: <${jiraUrl}|${issueKey}>\n`;

    const relevant = results.filter(r => r.status !== 'no_branch');
    if (relevant.length > 0) {
      message += '\n';
      for (const result of relevant) {
        message += this._formatProjectResult(result) + '\n';
      }
    }

    if (branchHint) {
      message += `\nИз комментария *${branchHint.author}* рекомендовал загружать в ветку \`${branchHint.branch}\`\n`;
    }

    return message.trimEnd();
  }

  _formatProjectResult(result) {
    const prefix = `• ${this._formatProjectLabel(result)}:`;
    const conflictSuffix = this._formatConflictSuffix(result);

    switch (result.status) {
      case 'created':
        return `${prefix} <${result.mrUrl}|${result.mrRef}> — создан${conflictSuffix}`;
      case 'existing':
        return `${prefix} <${result.mrUrl}|${result.mrRef}> — уже существует${conflictSuffix}`;
      case 'no_branch':
        return `${prefix} ветка не найдена`;
      case 'multiple_branches': {
        const list = result.branches.map(b => `\`${b}\``).join(', ');
        return `${prefix} несколько веток: ${list} — нужно разобраться вручную`;
      }
      case 'multiple_mrs': {
        const details = result.mrs.map(mr => this._formatProjectResult(mr)).join('\n');
        return `${prefix} несколько веток обработано:\n${details}`;
      }
      case 'empty_diff':
        return `${prefix} diff пустой — MR не создан`;
      case 'error':
        return `${prefix} ошибка — ${result.errorMessage}`;
      default:
        return `${prefix} неизвестный результат`;
    }
  }

  _formatManualMergeRequestMessage(issueKey, jiraUrl, mr, projectInfo) {
    const projectLabel = this._formatProjectLabel({
      projectId: projectInfo.projectId || '',
      ...projectInfo
    });
    const mrRef = mr.references?.full || `!${mr.iid}`;
    const mrUrl = mr.url || mr.web_url;
    const mrLink = mrUrl ? `<${mrUrl}|${mrRef}>` : mrRef;

    return [
      `🔀 Ручной MR добавлен в отслеживание деплоя — ${mrLink}`,
      `Задача: <${jiraUrl}|${issueKey}>`,
      `Репозиторий: ${projectLabel}`
    ].join('\n');
  }

  _formatProjectLabel(result) {
    const projectId = `Project ${result.projectId}`;

    if (result.projectName && result.projectUrl) {
      return `<${result.projectUrl}|${result.projectName}> (${projectId})`;
    }

    if (result.projectUrl) {
      return `<${result.projectUrl}|${projectId}>`;
    }

    if (result.projectName) {
      return `${result.projectName} (${projectId})`;
    }

    return projectId;
  }

  _formatConflictSuffix(result) {
    if (!result.hasConflict) return '';
    const mention = resolveSlackMentions(
      process.env.SLACK_MENTION_DEPLOY_CONFLICT,
      DEFAULT_SLACK_DEPLOY_CONFLICT
    );
    return ` — ⚠️ *конфликт с \`${result.targetBranch}\`*, нужно разрешить ${mention}`;
  }

  async _fetchBranchHint(issueKey, results) {
    if (!this.jiraClient) return null;

    const multipleResult = results.find(r => r.status === 'multiple_branches');
    if (!multipleResult) return null;

    try {
      const comments = await this.jiraClient.getIssueAllComments(issueKey);
      return this._findBranchHintInComments(comments, multipleResult.branches);
    } catch (error) {
      logger.warn('Failed to fetch Jira comments for branch hint', { issueKey, error: error.message });
      return null;
    }
  }

  _findBranchHintInComments(comments, branches) {
    const sortedBranches = [...branches].sort((a, b) => b.length - a.length);
    for (let i = comments.length - 1; i >= 0; i--) {
      const comment = comments[i];
      const text = this._extractAdfText(comment.body);
      for (const branch of sortedBranches) {
        if (text.includes(branch)) {
          return {
            author: comment.author?.displayName || 'Unknown',
            branch
          };
        }
      }
    }
    return null;
  }

  _extractAdfText(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.type === 'text') return node.text || '';
    if (Array.isArray(node.content)) {
      return node.content.map(c => this._extractAdfText(c)).join(' ');
    }
    if (node.content) return this._extractAdfText(node.content);
    return '';
  }

  _isDuplicate(issueKey) {
    const now = Date.now();
    for (const [key, ts] of this.recentIssues.entries()) {
      if (now - ts > DEDUP_WINDOW_MS) {
        this.recentIssues.delete(key);
      }
    }
    const last = this.recentIssues.get(issueKey);
    return last !== undefined;
  }
}

module.exports = WebhookHandler;
