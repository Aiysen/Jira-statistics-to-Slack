const SLACK_USER_ID_REGEX = /^[UW][A-Z0-9]+$/i;

function formatSlackMentions(raw) {
  if (!raw || !String(raw).trim()) {
    return '';
  }

  const trimmed = String(raw).trim();
  if (trimmed.includes('<@')) {
    return trimmed;
  }

  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  const allSlackIds = tokens.length > 0 && tokens.every(token => {
    const id = token.startsWith('@') ? token.slice(1) : token;
    return SLACK_USER_ID_REGEX.test(id);
  });

  if (!allSlackIds) {
    return trimmed;
  }

  return tokens
    .map(token => {
      const id = token.startsWith('@') ? token.slice(1) : token;
      return `<@${id.toUpperCase()}>`;
    })
    .join(' ');
}

module.exports = { formatSlackMentions };
