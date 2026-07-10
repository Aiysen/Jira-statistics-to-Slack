const GITLAB_PROJECTS = [
  { id: 51, targetBranch: 'master' },
  { id: 52, targetBranch: 'master' },
  { id: 81, targetBranch: 'master' },
  { id: 22, targetBranch: 'main' },
  { id: 32, targetBranch: 'main' },
  { id: 107, targetBranch: 'main' },
  { id: 124, targetBranch: 'main' },
  { id: 125, targetBranch: 'main' },
  { id: 136, targetBranch: 'main' },
];

function getGitlabProjects() {
  return GITLAB_PROJECTS;
}

module.exports = { getGitlabProjects, GITLAB_PROJECTS };
