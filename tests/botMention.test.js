const {
  resolveBotMentionFromConfig,
  expandBotMentionToken,
  botMatchesSearch,
} = require('../src/slack/botMention');

describe('bot mention resolution', () => {
  test('wraps bot user ID like a human member ID', () => {
    expect(resolveBotMentionFromConfig('U0DUALIPAY1')).toBe('<@U0DUALIPAY1>');
  });

  test('passes through ready-made mention', () => {
    expect(resolveBotMentionFromConfig('<@U0DUALIPAY1>')).toBe('<@U0DUALIPAY1>');
  });

  test('resolves dualipay alias to member ID', () => {
    expect(expandBotMentionToken('dualipay')).toBe('U0ANU6FJAT0');
    expect(resolveBotMentionFromConfig('dualipay')).toBe('<@U0ANU6FJAT0>');
  });
});

describe('botMatchesSearch', () => {
  test('matches bot by display name substring', () => {
    const user = {
      is_bot: true,
      name: 'dualipay',
      real_name: 'DualiPay bot',
      profile: { display_name: 'DualiPay bot' },
    };
    expect(botMatchesSearch(user, 'dualipay')).toBe(true);
    expect(botMatchesSearch(user, 'dualipay bot')).toBe(true);
  });

  test('ignores non-bot users', () => {
    expect(botMatchesSearch({ is_bot: false, name: 'dualipay' }, 'dualipay')).toBe(false);
  });
});
