# 📊 Jira Statistics to Slack Bot

Автоматический бот для ежедневной публикации отчётов об активности Jira в Slack.

## 🎯 Описание

Бот автоматически собирает статистику активности из Jira за последние 24 часа и публикует структурированный отчёт в указанный Slack-канал. Запуск происходит автоматически по расписанию (по умолчанию в 11:00 UTC).

### Что включает отчёт:

- 📈 **Сводка**: количество активных задач, пользователей, комментариев
- 🎯 **Активные задачи**: список задач с их статусами и исполнителями
- 👥 **Активность пользователей**: количество комментариев и задач по каждому пользователю
- ⏱️ **Время обработки**: время, затраченное на сбор и формирование отчёта

## 🚀 Требования

- **Node.js** 18.0.0 или выше
- **Jira Cloud** с REST API v3
- **Slack Workspace** с установленным ботом
- **Railway** (для деплоя) или любой хостинг для Node.js

## 📦 Установка

### 1. Клонирование репозитория

```bash
git clone <repository-url>
cd jira-statistics-to-slack
```

### 2. Установка зависимостей

```bash
npm install
```

### 3. Настройка окружения

Скопируйте файл `.env.example` в `.env`:

```bash
cp .env.example .env
```

Заполните необходимые переменные окружения в файле `.env`:

```bash
# Jira Configuration
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_API_TOKEN=your_jira_api_token
JIRA_EMAIL=your_email@company.com

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_CHANNEL_ID=C01234ABCDE

# Schedule
TIMEZONE=UTC
CRON_SCHEDULE=0 11 * * *
```

### 4. Получение API токенов

#### Jira API Token

1. Перейдите на https://id.atlassian.com/manage-profile/security/api-tokens
2. Нажмите **Create API token**
3. Скопируйте токен в переменную `JIRA_API_TOKEN`
4. Укажите email вашего Atlassian аккаунта в `JIRA_EMAIL`

#### Slack Bot Token

1. Создайте приложение на https://api.slack.com/apps
2. Перейдите в **OAuth & Permissions**
3. Добавьте Bot Token Scopes:
   - `chat:write`
   - `chat:write.public`
4. Установите приложение в workspace
5. Скопируйте **Bot User OAuth Token** в `SLACK_BOT_TOKEN`
6. Найдите ID канала (откройте канал в браузере, ID будет в URL)

## 🏃 Запуск

### Локальный запуск

```bash
npm start
```

Приложение запустится и будет ожидать времени выполнения по расписанию.

### Режим разработки

```bash
npm run dev
```

### Тестирование

Запуск всех тестов:

```bash
npm test
```

Запуск с отслеживанием изменений:

```bash
npm run test:watch
```

Проверка покрытия кода тестами:

```bash
npm run test:coverage
```

## 🔧 Конфигурация

### Обязательные переменные

| Переменная | Описание | Пример |
|------------|----------|--------|
| `JIRA_BASE_URL` | URL вашего Jira Cloud | `https://company.atlassian.net` |
| `JIRA_API_TOKEN` | API токен Jira | `ATATTxxxxx` |
| `JIRA_EMAIL` | Email вашего Atlassian аккаунта | `user@company.com` |
| `SLACK_BOT_TOKEN` | Bot Token из Slack App | `xoxb-xxxxx` |
| `SLACK_CHANNEL_ID` | ID канала для публикации | `C01234ABCDE` |

### Опциональные переменные

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `JIRA_PROJECTS` | Фильтр проектов (через запятую) | Все проекты |
| `TIMEZONE` | Временная зона для cron | `UTC` |
| `CRON_SCHEDULE` | Cron расписание | `0 11 * * *` |
| `API_TIMEOUT` | Таймаут API запросов (мс) | `30000` |
| `RETRY_ATTEMPTS` | Количество попыток retry | `3` |
| `RETRY_DELAY` | Задержка между попытками (мс) | `5000` |
| `HEALTH_CHECK_PORT` | Порт для health check | `3000` |
| `LOG_LEVEL` | Уровень логирования | `info` |

### GitLab интеграция (опционально)

Включается автоматически при наличии обеих переменных `GITLAB_BASE_URL` + `GITLAB_TOKEN`.

**Что добавляет:**
- Секция «Открытые MR» в родительском сообщении ежедневного отчёта.
- Автоматическое создание MR при переходе тикета Jira в «Ready for Deploy» (через webhook).

| Переменная | Описание | Пример |
|------------|----------|--------|
| `GITLAB_BASE_URL` | URL GitLab инстанса | `https://git.chcadm.in` |
| `GITLAB_TOKEN` | Personal Access Token (scope `api`, Developer+) | `glpat-xxxxx` |
| `JIRA_WEBHOOK_SECRET` | Секрет для проверки входящего webhook от Jira Automation | любая случайная строка |
| `JIRA_READY_FOR_DEPLOY_STATUS` | Имя статуса Jira, по которому создаётся MR | `Ready for Deploy` |

**Список репозиториев** (project id → prod-ветка) хранится только в коде: [`src/gitlab/config.js`](src/gitlab/config.js).  
При добавлении репозитория — см. [`docs/gitlab-repositories.md`](docs/gitlab-repositories.md).

**После деплоя** — следуйте [`docs/post-deploy-checklist.md`](docs/post-deploy-checklist.md).

### Примеры конфигурации

#### Фильтрация по проектам

Если нужно собирать статистику только по определённым проектам:

```bash
JIRA_PROJECTS=PROJ1,PROJ2,PROJ3
```

#### Изменение расписания

Запуск каждый день в 9:00 UTC:

```bash
CRON_SCHEDULE=0 9 * * *
```

Запуск каждые 6 часов:

```bash
CRON_SCHEDULE=0 */6 * * *
```

## 🏥 Health Check

Приложение предоставляет HTTP endpoint для проверки состояния:

```bash
curl http://localhost:3000/health
```

Возможные ответы:

### ✅ Healthy (успешная работа)

```json
{
  "status": "healthy",
  "lastRun": "2026-01-12T11:00:05Z",
  "lastRunSuccess": true,
  "nextRun": "2026-01-13T11:00:00Z",
  "uptime": 86400
}
```

### ⚠️ Degraded (последний запуск неудачен)

```json
{
  "status": "degraded",
  "lastRun": "2026-01-12T11:00:05Z",
  "lastRunSuccess": false,
  "error": "Jira API timeout after 3 attempts",
  "nextRun": "2026-01-13T11:00:00Z",
  "uptime": 3600
}
```

### ⏳ Waiting (ещё не запускался)

```json
{
  "status": "waiting",
  "lastRun": null,
  "nextRun": "2026-01-13T11:00:00Z",
  "uptime": 300
}
```

## 🚂 Деплой на Railway

### 1. Подготовка

1. Зарегистрируйтесь на [Railway](https://railway.app/)
2. Установите [Railway CLI](https://docs.railway.app/develop/cli) (опционально)

### 2. Деплой через Web UI

1. Перейдите на [Railway Dashboard](https://railway.app/dashboard)
2. Нажмите **New Project** → **Deploy from GitHub repo**
3. Выберите ваш репозиторий
4. Railway автоматически определит Node.js проект

### 3. Настройка переменных окружения

В настройках проекта Railway добавьте все необходимые переменные из раздела **Конфигурация**.

### 4. Деплой через CLI

```bash
# Установка Railway CLI
npm i -g @railway/cli

# Логин
railway login

# Инициализация проекта
railway init

# Добавление переменных
railway variables set JIRA_BASE_URL=https://your-domain.atlassian.net
railway variables set JIRA_API_TOKEN=your_token
# ... добавьте остальные переменные

# Деплой
railway up
```

### 5. Проверка работы

После деплоя проверьте health check:

```bash
curl https://your-app.railway.app/health
```

Проверьте логи:

```bash
railway logs
```

## 📝 Структура проекта

```
project/
├── src/
│   ├── index.js              # Точка входа, cron setup
│   ├── report.js             # Основная логика формирования отчёта
│   ├── health.js             # Health check endpoint
│   ├── jira/
│   │   ├── client.js         # Jira API client
│   │   └── aggregator.js     # Агрегация данных
│   ├── slack/
│   │   ├── client.js         # Slack API client
│   │   └── formatter.js      # Форматирование отчёта
│   └── utils/
│       ├── logger.js         # Structured logging
│       ├── retry.js          # Retry механизм
│       └── dedup.js          # Защита от дубликатов
├── tests/
│   ├── fixtures/             # Mock данные
│   ├── aggregator.test.js
│   ├── formatter.test.js
│   ├── logger.test.js
│   ├── dedup.test.js
│   └── retry.test.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 🎨 Примеры отчётов

### Отчёт с активностью

```
📊 Отчёт активности Jira
Период: последние 24 часа (до 12.01.2026 14:50)

📈 Сводка:
• Активных задач: 15
• Активных пользователей: 8
• Комментариев: 42
• Время обработки: 2.3 сек

📌 Задачи по статусам:
• Done: 5
• In Progress: 7
• In Review: 3

Подробности в треде 👇
```

В треде публикуются подробные списки задач и пользователей.

### Отчёт без активности

```
📊 Отчёт активности Jira
Период: последние 24 часа (до 12.01.2026 14:50)

ℹ️ За последние 24 часа активности не обнаружено

Время обработки: 0.5 сек
```

### Отчёт об ошибке

```
⚠️ Ошибка формирования отчёта Jira

Не удалось получить данные из Jira API
Время: 12.01.2026 14:50
Ошибка: Connection timeout
Попыток: 3/3

Следующая попытка: завтра в 11:00 UTC
```

## 🔒 Безопасность

- ✅ Все чувствительные данные хранятся в переменных окружения
- ✅ Токены и ключи НЕ логируются (автоматическая санитизация)
- ✅ Используется базовая аутентификация для Jira API
- ✅ OAuth токен для Slack API

**⚠️ Важно**: Никогда не коммитьте файл `.env` в репозиторий!

## 🐛 Обработка ошибок

### Jira API недоступен

- Выполняется 3 попытки с интервалом 5 секунд
- При неудаче отправляется сообщение об ошибке в Slack
- Следующая попытка — по расписанию на следующий день

### Slack API недоступен

- Выполняется 3 попытки с интервалом 1 минута
- Ошибки логируются в stdout в формате JSON
- Отчёт не считается успешным

### Частичные ошибки

- Если часть запросов к Jira завершилась с ошибкой, отчёт формируется по доступным данным
- Проблемные записи пропускаются с логированием предупреждения

## 📊 Логирование

Все логи выводятся в stdout в структурированном JSON формате:

```json
{
  "timestamp": "2026-01-12T11:00:05.123Z",
  "level": "info",
  "message": "Report generated successfully",
  "context": {
    "tasksCount": 15,
    "usersCount": 8
  }
}
```

Уровни логирования:
- `error` — критические ошибки
- `warn` — предупреждения
- `info` — основные события (по умолчанию)
- `debug` — детальная информация

Для включения debug логов:

```bash
LOG_LEVEL=debug npm start
```

## 🛡️ Защита от дубликатов

Бот автоматически предотвращает повторную публикацию отчёта в течение одного дня (по UTC). Даже если сервис перезапустится несколько раз, отчёт будет опубликован только один раз в сутки.

## ❓ FAQ

### Как протестировать отчёт без ожидания cron?

Временно измените `CRON_SCHEDULE` на ближайшее время или вызовите функцию напрямую в коде для разработки.

### Бот не публикует отчёты

1. Проверьте health check: `curl http://localhost:3000/health`
2. Проверьте логи на наличие ошибок
3. Убедитесь, что все переменные окружения настроены корректно
4. Проверьте права бота в Slack (scope `chat:write`)

### Как изменить формат отчёта?

Отредактируйте файл `src/slack/formatter.js`. Не забудьте обновить соответствующие тесты в `tests/formatter.test.js`.

### Можно ли запускать бота несколько раз в день?

Да, измените `CRON_SCHEDULE`. Например, для запуска каждые 12 часов:

```bash
CRON_SCHEDULE=0 */12 * * *
```

### Как фильтровать только определённые проекты?

Используйте переменную `JIRA_PROJECTS`:

```bash
JIRA_PROJECTS=BACKEND,FRONTEND,MOBILE
```

## 📄 Лицензия

MIT

## 🤝 Поддержка

При возникновении проблем:

1. Проверьте логи приложения
2. Убедитесь, что все зависимости установлены
3. Проверьте правильность конфигурации
4. Проверьте health check endpoint

---

**Разработано для автоматизации отчётности Jira → Slack** 🚀

