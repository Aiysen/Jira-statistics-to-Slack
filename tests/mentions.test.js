const { formatSlackMentions } = require('../src/slack/mentions');
const {
  SLACK_MEMBERS,
  expandSlackMentionTokens,
  resolveSlackMentions,
  DEFAULT_SLACK_DEPLOY_DONE,
} = require('../src/slack/members');

describe('formatSlackMentions', () => {
  test('wraps Slack user IDs', () => {
    expect(formatSlackMentions(`${SLACK_MEMBERS.gevork},${SLACK_MEMBERS.jegor}`)).toBe(
      `<@${SLACK_MEMBERS.gevork}> <@${SLACK_MEMBERS.jegor}>`
    );
  });

  test('passes through ready-made mrkdwn mentions', () => {
    expect(formatSlackMentions(`<@${SLACK_MEMBERS.gevork}>`)).toBe(
      `<@${SLACK_MEMBERS.gevork}>`
    );
  });

  test('keeps display names unchanged when not in registry', () => {
    expect(formatSlackMentions('@Unknown Person')).toBe('@Unknown Person');
  });

  test('returns empty string for blank input', () => {
    expect(formatSlackMentions('')).toBe('');
    expect(formatSlackMentions('   ')).toBe('');
  });
});

describe('resolveSlackMentions', () => {
  test('resolves member aliases to mention mrkdwn', () => {
    expect(expandSlackMentionTokens('gevork,jegor')).toBe(
      `${SLACK_MEMBERS.gevork},${SLACK_MEMBERS.jegor}`
    );
    expect(resolveSlackMentions('', DEFAULT_SLACK_DEPLOY_DONE)).toBe(
      `<@${SLACK_MEMBERS.gevork}> <@${SLACK_MEMBERS.jegor}>`
    );
  });

  test('env override accepts member ID or alias', () => {
    expect(resolveSlackMentions('vitaly', 'gevork,jegor')).toBe(
      `<@${SLACK_MEMBERS.vitaly}>`
    );
  });
});
