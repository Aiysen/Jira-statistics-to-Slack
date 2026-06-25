const { formatSlackMentions } = require('./mentions');

const SLACK_MEMBERS = {
  gevork: 'U05F9UFNHAS',
  jegor: 'U05FGEVH7L3',
  vitaly: 'U09JGNDH954',
};

const DEFAULT_SLACK_DEPLOY_DONE = 'gevork,jegor';
const DEFAULT_SLACK_DEPLOY_CONFLICT = 'jegor';

function expandSlackMentionTokens(raw) {
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.includes('<@')) {
    return trimmed;
  }

  return trimmed
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(token => {
      const bare = token.startsWith('@') ? token.slice(1) : token;
      const alias = SLACK_MEMBERS[bare.toLowerCase()];
      if (alias) {
        return alias;
      }
      return bare;
    })
    .join(',');
}

function resolveSlackMentions(envValue, defaultRaw) {
  const expanded = expandSlackMentionTokens(envValue?.trim() || defaultRaw);
  return formatSlackMentions(expanded);
}

module.exports = {
  SLACK_MEMBERS,
  DEFAULT_SLACK_DEPLOY_DONE,
  DEFAULT_SLACK_DEPLOY_CONFLICT,
  expandSlackMentionTokens,
  resolveSlackMentions,
};
