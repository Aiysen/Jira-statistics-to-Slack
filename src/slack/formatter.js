class SlackFormatter {
  constructor(jiraBaseURL) {
    this.jiraBaseURL = jiraBaseURL;
    this.maxMessageLength = 3000;
  }

  formatReport(data) {
    const now = new Date();
    const dateStr = this._formatDate(now);

    if (!data.hasActivity) {
      return {
        mainMessage: this._formatNoActivity(dateStr, data.summary.processingTime)
      };
    }

    const mainMessage = this._formatMainMessage(dateStr, data.summary);
    const usersMessage = this._formatUsersMessage(data.users);

    return {
      mainMessage,
      usersMessage
    };
  }

  _formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  }

  _formatNoActivity(dateStr, processingTime) {
    return `📊 Отчёт активности Jira
Период: последние 24 часа (до ${dateStr})

ℹ️ За последние 24 часа активности не обнаружено

Время обработки: ${processingTime} сек`;
  }

  _formatMainMessage(dateStr, summary) {
    return `📊 Отчёт активности Jira
Период: последние 24 часа (до ${dateStr})

👥 Активных исполнителей: ${summary.usersCount}
💬 Комментариев: ${summary.commentsCount}
⏱️ Время обработки: ${summary.processingTime} сек

Подробности по каждому исполнителю в треде 👇`;
  }

  _formatUsersMessage(users) {
    if (users.length === 0) {
      return '👥 Активность исполнителей\n\nНет активности за последние 24 часа';
    }

    let message = `👥 Активность исполнителей (${users.length})\n\n`;
    let includedUsers = 0;

    for (const user of users) {
      const userBlock = this._formatUser(user);
      
      if (message.length + userBlock.length > this.maxMessageLength - 100) {
        const remaining = users.length - includedUsers;
        message += `\n... и ещё ${remaining} исполнителей`;
        break;
      }
      
      message += userBlock;
      includedUsers++;
    }

    return message;
  }

  _formatUser(user) {
    let block = `*${user.name}*\n`;

    if (user.statusChanges.length > 0) {
      block += `\n📋 *Изменения статусов:*\n`;
      user.statusChanges.forEach(change => {
        const url = `${this.jiraBaseURL}/browse/${change.issueKey}`;
        const timeStr = this._formatTimeInStatus(change.timeInPreviousStatus);
        block += `  • <${url}|${change.issueKey}> — \`${change.fromStatus}\` → \`${change.toStatus}\` ${timeStr}\n`;
      });
    }

    if (user.comments.length > 0) {
      block += `\n💬 *Комментарии:* ${user.comments.length} шт.\n`;
      user.comments.forEach(comment => {
        const url = `${this.jiraBaseURL}/browse/${comment.issueKey}`;
        block += `  • <${url}|${comment.issueKey}>\n`;
      });
    }

    if (user.tasksInProgress.length > 0) {
      block += `\n⚙️ *Задачи в работе:*\n`;
      user.tasksInProgress.forEach(task => {
        const url = `${this.jiraBaseURL}/browse/${task.issueKey}`;
        block += `  • <${url}|${task.issueKey}> — \`${task.status}\`\n`;
      });
    }

    block += '\n';

    return block;
  }

  _formatTimeInStatus(seconds) {
    if (seconds === 0) return '';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      const remainingHours = hours % 24;
      if (remainingHours > 0) {
        return `(${days}д ${remainingHours}ч в предыдущем статусе)`;
      }
      return `(${days}д в предыдущем статусе)`;
    }
    
    if (hours > 0) {
      if (minutes > 0) {
        return `(${hours}ч ${minutes}м в предыдущем статусе)`;
      }
      return `(${hours}ч в предыдущем статусе)`;
    }
    
    if (minutes > 0) {
      return `(${minutes}м в предыдущем статусе)`;
    }
    
    return `(${seconds}с в предыдущем статусе)`;
  }

  formatError(error, attempts) {
    const now = new Date();
    const dateStr = this._formatDate(now);

    return `⚠️ Ошибка формирования отчёта Jira

Не удалось получить данные из Jira API
Время: ${dateStr}
Ошибка: ${error.message}
Попыток: ${attempts}/${attempts}

Следующая попытка: завтра в 08:00 UTC`;
  }
}

module.exports = SlackFormatter;

