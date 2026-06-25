const logger = require('../utils/logger');
const { getGitlabProjects } = require('../gitlab/config');

const DEDUP_WINDOW_MS = 60 * 60 * 1000;
const MR_CONFLICT_NOTE_MARKER = '[jira-deploy-bot:conflict]';
// После создания MR GitLab может ещё вычислять merge_status; ждём и делаем один повторный запрос
const MERGE_STATUS_CHECK_DELAY_MS = 2000;

class WebhookHandler {
  constructor(gitlabClient, slackClient, jiraBaseURL, deployTracker = null) {
    this.gitlabClient = gitlabClient;
    this.slackClient = slackClient;
    this.jiraBaseURL = jiraBaseURL || process.env.JIRA_BASE_URL || '';
    this.deployTracker = deployTracker;
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

    const message = this._formatSlackMessage(issueKey, summary, results);
    const slackResult = await this.slackClient.postDeployNotification(message);
    this.slackClient.rememberDeployThread(issueKey, slackResult?.ts);
    this.deployTracker?.rememberIssue(issueKey, summary, this.jiraBaseURL, slackResult?.ts, results);

    logger.info('Deploy-ready handled', {
      issueKey,
      results: results.map(r => ({ projectId: r.projectId, status: r.status, hasConflict: r.hasConflict }))
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
        const mrs = await Promise.all(
          branches.map(branch => this._processBranch(issueKey, summary, project, branch.name, projectInfo))
        );

        return {
          projectId,
          ...projectInfo,
          status: 'multiple_mrs',
          branches: branches.map(b => b.name),
          mrs
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
      const existing = await this.gitlabClient.getExistingMergeRequest(
        projectId, sourceBranch, targetBranch
      );
      if (existing) {
        const hasConflict = await this._checkAndHandleConflict(projectId, existing, targetBranch);
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

      const diffExists = await this.gitlabClient.hasDiff(projectId, sourceBranch, targetBranch);
      if (!diffExists) {
        return { projectId, ...projectInfo, status: 'empty_diff' };
      }

      const mr = await this.gitlabClient.createMergeRequest(
        projectId,
        sourceBranch,
        targetBranch,
        `${issueKey}: ${summary}`
      );

      const hasConflict = await this._checkAndHandleConflict(projectId, mr, targetBranch);
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

  async _checkAndHandleConflict(projectId, mr, targetBranch) {
    try {
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

  _formatSlackMessage(issueKey, summary, results) {
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
    const mention = process.env.SLACK_MENTION_DEPLOY_CONFLICT || '@Jegor Bogomolov';
    return ` — ⚠️ *конфликт с \`${result.targetBranch}\`*, нужно разрешить ${mention}`;
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
