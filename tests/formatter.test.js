const SlackFormatter = require('../src/slack/formatter');

describe('SlackFormatter', () => {
  let formatter;
  const mockJiraURL = 'https://test.atlassian.net';

  beforeEach(() => {
    formatter = new SlackFormatter(mockJiraURL);
  });

  describe('formatReport', () => {
    test('should format report with activity', () => {
      const data = {
        hasActivity: true,
        summary: {
          tasksCount: 2,
          usersCount: 2,
          commentsCount: 5,
          statusCounts: {
            'In Progress': 1,
            'Done': 1
          },
          processingTime: '1.5'
        },
        tasks: [
          {
            key: 'PROJ-123',
            summary: 'Test task',
            status: 'In Progress',
            assignee: 'Иван Иванов',
            activeUsers: ['Иван Иванов', 'Мария Сидорова']
          }
        ],
        users: [
          {
            name: 'Иван Иванов',
            commentsCount: 3,
            tasksCount: 2,
            tasks: ['PROJ-123', 'PROJ-124']
          }
        ]
      };

      const result = formatter.formatReport(data);

      expect(result.mainMessage).toContain('📊 Отчёт активности Jira');
      expect(result.mainMessage).toContain('• Активных задач: 2');
      expect(result.mainMessage).toContain('• Активных пользователей: 2');
      expect(result.mainMessage).toContain('• Комментариев: 5');
      expect(result.mainMessage).toContain('• Время обработки: 1.5 сек');
      expect(result.mainMessage).toContain('• Done: 1');
      expect(result.mainMessage).toContain('• In Progress: 1');
      
      expect(result.tasksMessage).toContain('🎯 Активные задачи (1)');
      expect(result.tasksMessage).toContain('[PROJ-123] Test task');
      expect(result.tasksMessage).toContain('├ Статус: In Progress');
      expect(result.tasksMessage).toContain('├ Исполнитель: Иван Иванов');
      expect(result.tasksMessage).toContain('└ Активность: Иван Иванов, Мария Сидорова');
      
      expect(result.usersMessage).toContain('👥 Активность пользователей (1)');
      expect(result.usersMessage).toContain('Иван Иванов');
      expect(result.usersMessage).toContain('├ Комментариев: 3');
      expect(result.usersMessage).toContain('├ Задач: 2');
      expect(result.usersMessage).toContain('└ PROJ-123, PROJ-124');
    });

    test('should format report with no activity', () => {
      const data = {
        hasActivity: false,
        summary: {
          tasksCount: 0,
          usersCount: 0,
          commentsCount: 0,
          statusCounts: {},
          processingTime: '0.5'
        }
      };

      const result = formatter.formatReport(data);

      expect(result.mainMessage).toContain('📊 Отчёт активности Jira');
      expect(result.mainMessage).toContain('ℹ️ За последние 24 часа активности не обнаружено');
      expect(result.mainMessage).toContain('Время обработки: 0.5 сек');
      expect(result.tasksMessage).toBeUndefined();
      expect(result.usersMessage).toBeUndefined();
    });

    test('should handle task without assignee', () => {
      const data = {
        hasActivity: true,
        summary: {
          tasksCount: 1,
          usersCount: 0,
          commentsCount: 0,
          statusCounts: { 'To Do': 1 },
          processingTime: '0.3'
        },
        tasks: [
          {
            key: 'PROJ-125',
            summary: 'Unassigned task',
            status: 'To Do',
            assignee: 'Нет исполнителя',
            activeUsers: []
          }
        ],
        users: []
      };

      const result = formatter.formatReport(data);

      expect(result.tasksMessage).toContain('├ Исполнитель: Нет исполнителя');
      expect(result.tasksMessage).toContain('└ Активность: Нет');
    });

    test('should truncate long task list', () => {
      const tasks = [];
      for (let i = 0; i < 100; i++) {
        tasks.push({
          key: `PROJ-${i}`,
          summary: 'Task '.repeat(50),
          status: 'In Progress',
          assignee: 'Test User',
          activeUsers: ['User 1', 'User 2', 'User 3']
        });
      }

      const data = {
        hasActivity: true,
        summary: {
          tasksCount: 100,
          usersCount: 1,
          commentsCount: 10,
          statusCounts: { 'In Progress': 100 },
          processingTime: '2.0'
        },
        tasks,
        users: []
      };

      const result = formatter.formatReport(data);

      expect(result.tasksMessage.length).toBeLessThan(3000);
      expect(result.tasksMessage).toContain('... и ещё');
    });
  });

  describe('formatError', () => {
    test('should format error message', () => {
      const error = new Error('Connection timeout');
      const result = formatter.formatError(error, 3);

      expect(result).toContain('⚠️ Ошибка формирования отчёта Jira');
      expect(result).toContain('Не удалось получить данные из Jira API');
      expect(result).toContain('Ошибка: Connection timeout');
      expect(result).toContain('Попыток: 3/3');
      expect(result).toContain('Следующая попытка: завтра в 11:00 UTC');
    });
  });

  describe('_formatOpenMrsSection', () => {
    test('returns empty string when no MRs', () => {
      const result = formatter._formatOpenMrsSection([]);
      expect(result).toBe('');
    });

    test('returns empty string for null/undefined', () => {
      expect(formatter._formatOpenMrsSection(null)).toBe('');
      expect(formatter._formatOpenMrsSection(undefined)).toBe('');
    });

    test('formats MRs with references and branches', () => {
      const mrs = [
        {
          web_url: 'https://git.chcadm.in/group/repo/-/merge_requests/1',
          iid: 1,
          title: 'CPAYMENT-100: Add feature',
          source_branch: 'feature/CPAYMENT-100',
          target_branch: 'master',
          references: { full: 'group/repo!1' }
        }
      ];

      const result = formatter._formatOpenMrsSection(mrs);

      expect(result).toContain('🔀 *Открытые MR (1):*');
      expect(result).toContain('group/repo!1');
      expect(result).toContain('CPAYMENT-100: Add feature');
      expect(result).toContain('feature/CPAYMENT-100');
      expect(result).toContain('master');
    });

    test('uses iid fallback when references missing', () => {
      const mrs = [
        {
          web_url: 'https://git.example.com/mr/5',
          iid: 5,
          title: 'Fix bug',
          source_branch: 'bugfix/X',
          target_branch: 'main'
        }
      ];

      const result = formatter._formatOpenMrsSection(mrs);
      expect(result).toContain('!5');
    });

    test('truncates to 20 MRs with overflow message', () => {
      const mrs = Array.from({ length: 25 }, (_, i) => ({
        web_url: `https://git.example.com/mr/${i}`,
        iid: i,
        title: `MR ${i}`,
        source_branch: `feature/X-${i}`,
        target_branch: 'master',
        references: { full: `group/repo!${i}` }
      }));

      const result = formatter._formatOpenMrsSection(mrs);

      expect(result).toContain('Открытые MR (25)');
      expect(result).toContain('и ещё 5 MR');
    });

    test('formatReport passes openMrs to mainMessage', () => {
      const data = {
        hasActivity: false,
        summary: { processingTime: '0.5' }
      };
      const mrs = [
        {
          web_url: 'https://git.example.com/mr/1',
          iid: 1,
          title: 'PROJ-1: task',
          source_branch: 'feature/PROJ-1',
          target_branch: 'master',
          references: { full: 'group/repo!1' }
        }
      ];

      const result = formatter.formatReport(data, mrs);
      expect(result.mainMessage).toContain('🔀 *Открытые MR');
      expect(result.mainMessage).toContain('group/repo!1');
    });
  });
});

