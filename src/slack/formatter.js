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
    const tasksMessage = this._formatTasksMessage(data.tasks);
    const usersMessage = this._formatUsersMessage(data.users);

    return {
      mainMessage,
      tasksMessage,
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
    const statusList = Object.entries(summary.statusCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `• ${status}: ${count}`)
      .join('\n');

    return `📊 Отчёт активности Jira
Период: последние 24 часа (до ${dateStr})

📈 Сводка:
• Активных задач: ${summary.tasksCount}
• Активных пользователей: ${summary.usersCount}
• Комментариев: ${summary.commentsCount}
• Время обработки: ${summary.processingTime} сек

📌 Задачи по статусам:
${statusList}

Подробности в треде 👇`;
  }

  _formatTasksMessage(tasks) {
    const header = `🎯 Активные задачи (${tasks.length})\n\n`;
    
    let message = header;
    let truncated = false;
    let includedTasks = 0;

    for (const task of tasks) {
      const taskBlock = this._formatTask(task);
      
      if (message.length + taskBlock.length > this.maxMessageLength - 100) {
        truncated = true;
        break;
      }
      
      message += taskBlock;
      includedTasks++;
    }

    if (truncated) {
      const remaining = tasks.length - includedTasks;
      message += `\n... и ещё ${remaining} задач`;
    }

    return message;
  }

  _formatTask(task) {
    const url = `${this.jiraBaseURL}/browse/${task.key}`;
    const activeUsers = task.activeUsers.length > 0 
      ? task.activeUsers.join(', ') 
      : 'Нет';

    return `<${url}|[${task.key}] ${task.summary}>
├ Статус: ${task.status}
├ Исполнитель: ${task.assignee}
└ Активность: ${activeUsers}

`;
  }

  _formatUsersMessage(users) {
    const header = `👥 Активность пользователей (${users.length})\n\n`;
    
    let message = header;
    let truncated = false;
    let includedUsers = 0;

    for (const user of users) {
      const userBlock = this._formatUser(user);
      
      if (message.length + userBlock.length > this.maxMessageLength - 100) {
        truncated = true;
        break;
      }
      
      message += userBlock;
      includedUsers++;
    }

    if (truncated) {
      const remaining = users.length - includedUsers;
      message += `\n... и ещё ${remaining} пользователей`;
    }

    return message;
  }

  _formatUser(user) {
    const tasksList = user.tasks.join(', ');

    return `${user.name}
├ Комментариев: ${user.commentsCount}
├ Задач: ${user.tasksCount}
└ ${tasksList}

`;
  }

  formatError(error, attempts) {
    const now = new Date();
    const dateStr = this._formatDate(now);

    return `⚠️ Ошибка формирования отчёта Jira

Не удалось получить данные из Jira API
Время: ${dateStr}
Ошибка: ${error.message}
Попыток: ${attempts}/${attempts}

Следующая попытка: завтра в 11:00 UTC`;
  }
}

module.exports = SlackFormatter;

