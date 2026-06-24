const logger = require('../utils/logger');

const STATUS_ICONS = {
  success: '✅',
  failed: '❌',
  canceled: '🚫',
};

const WATCHED_BRANCHES = ['master', 'main'];
const WATCHED_STATUSES = ['success'];

class PipelineHandler {
  constructor(slackClient) {
    this.slackClient = slackClient;
  }

  async handlePipelineEvent(payload) {
    const ref = payload.object_attributes?.ref;
    const status = payload.object_attributes?.status;

    if (!WATCHED_BRANCHES.includes(ref)) {
      logger.debug('Pipeline event ignored: not a watched branch', { ref, status });
      return;
    }

    if (!WATCHED_STATUSES.includes(status)) {
      logger.debug('Pipeline event ignored: not a watched status', { ref, status });
      return;
    }

    logger.info('Handling pipeline event', {
      ref,
      status,
      projectId: payload.project?.id,
      pipelineId: payload.object_attributes?.id,
    });

    const message = this._formatMessage(payload);
    await this.slackClient.postDeployNotification(message);

    logger.info('Pipeline notification sent', { ref, status });
  }

  _formatMessage(payload) {
    const { object_attributes: pipeline, project, commit, user } = payload;

    const icon = STATUS_ICONS[pipeline.status] || '⏳';
    const projectLink = `<${project.web_url}|${project.name}>`;
    const pipelineUrl = pipeline.url || pipeline.web_url;
    const pipelineLink = pipelineUrl ? `<${pipelineUrl}|#${pipeline.id}>` : `#${pipeline.id}`;
    const duration = pipeline.duration ? this._formatDuration(pipeline.duration) : null;

    let message = `${icon} Pipeline ${pipelineLink} — ${projectLink}\n`;
    message += `Ветка: \`${pipeline.ref}\` | Статус: ${pipeline.status}`;
    if (duration) message += ` | ${duration}`;
    message += '\n';

    if (commit) {
      const commitText = commit.message?.split('\n')[0]?.trim() || commit.id.slice(0, 8);
      const authorName = commit.author?.name || user?.name || 'Unknown';
      const commitLink = commit.url ? `<${commit.url}|${commitText}>` : commitText;
      message += `Коммит: ${commitLink} (${authorName})`;
    }

    return message.trimEnd();
  }

  _formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}м ${s}с` : `${s}с`;
  }
}

module.exports = PipelineHandler;
