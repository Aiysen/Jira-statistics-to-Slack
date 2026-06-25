const axios = require('axios');
const logger = require('../utils/logger');
const { retry } = require('../utils/retry');
const { getGitlabProjects } = require('./config');

class GitLabClient {
  constructor() {
    this.baseURL = process.env.GITLAB_BASE_URL;
    this.token = process.env.GITLAB_TOKEN;
    this.timeout = parseInt(process.env.API_TIMEOUT) || 30000;

    if (!this.baseURL || !this.token) {
      throw new Error('Missing required GitLab configuration: GITLAB_BASE_URL, GITLAB_TOKEN');
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
  }

  static isConfigured() {
    return !!(process.env.GITLAB_BASE_URL && process.env.GITLAB_TOKEN);
  }

  async getProject(projectId) {
    return retry(
      async () => {
        const response = await this.client.get(`/api/v4/projects/${projectId}`);
        return response.data;
      },
      { context: { projectId, action: 'get_project' } }
    );
  }

  async listOpenMergeRequests() {
    const projects = getGitlabProjects();
    const allMrs = [];

    for (const project of projects) {
      try {
        const mrs = await retry(
          async () => {
            const response = await this.client.get(`/api/v4/projects/${project.id}/merge_requests`, {
              params: { state: 'opened', per_page: 100 }
            });
            return response.data;
          },
          { context: { projectId: project.id, action: 'list_open_mrs' } }
        );
        allMrs.push(...mrs.map(mr => ({ ...mr, _projectId: project.id })));
      } catch (error) {
        logger.warn('Failed to list MRs for project', {
          projectId: project.id,
          error: error.message
        });
      }
    }

    logger.info('Listed open merge requests', { count: allMrs.length });
    return allMrs;
  }

  async searchBranchesByIssueKey(projectId, issueKey) {
    return retry(
      async () => {
        const response = await this.client.get(`/api/v4/projects/${projectId}/repository/branches`, {
          params: { search: issueKey, per_page: 100 }
        });
        return response.data;
      },
      { context: { projectId, issueKey, action: 'search_branches' } }
    );
  }

  async getExistingMergeRequest(projectId, sourceBranch, targetBranch) {
    const mrs = await retry(
      async () => {
        const response = await this.client.get(`/api/v4/projects/${projectId}/merge_requests`, {
          params: {
            state: 'opened',
            source_branch: sourceBranch,
            target_branch: targetBranch,
            per_page: 10
          }
        });
        return response.data;
      },
      { context: { projectId, sourceBranch, targetBranch, action: 'get_existing_mr' } }
    );
    return mrs.length > 0 ? mrs[0] : null;
  }

  async listMergeRequestsByIssueKey(projectId, issueKey, targetBranch) {
    const mrs = await retry(
      async () => {
        const response = await this.client.get(`/api/v4/projects/${projectId}/merge_requests`, {
          params: {
            state: 'all',
            target_branch: targetBranch,
            order_by: 'updated_at',
            sort: 'desc',
            per_page: 100
          }
        });
        return response.data;
      },
      { context: { projectId, issueKey, targetBranch, action: 'list_mrs_by_issue' } }
    );

    return mrs.filter(mr => {
      if (mr.state === 'closed') {
        return false;
      }

      return [mr.title, mr.source_branch].some(value => {
        return typeof value === 'string' && value.includes(issueKey);
      });
    });
  }

  async hasDiff(projectId, sourceBranch, targetBranch) {
    const compare = await retry(
      async () => {
        const response = await this.client.get(`/api/v4/projects/${projectId}/repository/compare`, {
          params: { from: targetBranch, to: sourceBranch, straight: true }
        });
        return response.data;
      },
      { context: { projectId, sourceBranch, targetBranch, action: 'compare' } }
    );
    return Array.isArray(compare.diffs) && compare.diffs.length > 0;
  }

  async createMergeRequest(projectId, sourceBranch, targetBranch, title) {
    return retry(
      async () => {
        const response = await this.client.post(`/api/v4/projects/${projectId}/merge_requests`, {
          source_branch: sourceBranch,
          target_branch: targetBranch,
          title
        });
        return response.data;
      },
      { context: { projectId, sourceBranch, targetBranch, action: 'create_mr' } }
    );
  }

  async getMergeRequest(projectId, mrIid) {
    return retry(
      async () => {
        const response = await this.client.get(`/api/v4/projects/${projectId}/merge_requests/${mrIid}`);
        return response.data;
      },
      { context: { projectId, mrIid, action: 'get_mr' } }
    );
  }

  async createMergeRequestNote(projectId, mrIid, body) {
    return retry(
      async () => {
        const response = await this.client.post(
          `/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`,
          { body }
        );
        return response.data;
      },
      { context: { projectId, mrIid, action: 'create_mr_note' } }
    );
  }
}

module.exports = GitLabClient;
