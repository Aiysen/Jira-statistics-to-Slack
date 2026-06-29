const { formatSlackMentions, SLACK_USER_ID_REGEX } = require('./mentions');

const SLACK_BOTS = {
  dualipay: 'U0ANU6FJAT0',
};

const DEFAULT_JIRA_REVIEW_BOT = 'dualipay';

function expandBotMentionToken(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed.includes('<@')) {
    return trimmed;
  }

  const bare = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (SLACK_USER_ID_REGEX.test(bare)) {
    return bare;
  }

  const fromRegistry = SLACK_BOTS[bare.toLowerCase()];
  if (fromRegistry) {
    return fromRegistry;
  }

  return bare;
}

function resolveBotMentionFromConfig(envValue) {
  const expanded = expandBotMentionToken(envValue);
  if (!expanded) {
    return '';
  }
  return formatSlackMentions(expanded);
}

function isSlackUserId(value) {
  const bare = String(value || '').trim().replace(/^@/, '');
  return SLACK_USER_ID_REGEX.test(bare);
}

function botMatchesSearch(user, search) {
  if (!user || !user.is_bot) {
    return false;
  }
  const needle = String(search || '').toLowerCase();
  const fields = [user.name, user.real_name, user.profile && user.profile.display_name];
  return fields.some(f => f && String(f).toLowerCase().includes(needle));
}

module.exports = {
  SLACK_BOTS,
  expandBotMentionToken,
  resolveBotMentionFromConfig,
  isSlackUserId,
  botMatchesSearch,
  DEFAULT_JIRA_REVIEW_BOT,
};
