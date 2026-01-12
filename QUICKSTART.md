# 🚀 Быстрый старт

## Шаг 1: Установка зависимостей

```bash
npm install
```

## Шаг 2: Настройка переменных окружения

Скопируйте `.env.example` в `.env`:

```bash
cp .env.example .env
```

Заполните следующие обязательные поля в `.env`:

```bash
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_API_TOKEN=<ваш Jira API токен>
JIRA_EMAIL=your@email.com

SLACK_BOT_TOKEN=xoxb-<ваш Slack Bot токен>
SLACK_CHANNEL_ID=<ID канала Slack>
```

### Как получить Jira API Token:

1. Перейдите на https://id.atlassian.com/manage-profile/security/api-tokens
2. Нажмите **Create API token**
3. Скопируйте токен

### Как получить Slack Bot Token:

1. Создайте приложение на https://api.slack.com/apps
2. Добавьте Bot Token Scopes: `chat:write`, `chat:write.public`
3. Установите приложение в workspace
4. Скопируйте **Bot User OAuth Token**

### Как найти ID канала Slack:

1. Откройте канал в браузере
2. ID канала будет в URL: `https://app.slack.com/client/TXXXXXX/CXXXXXX`
3. CXXXXXX — это ID канала

## Шаг 3: Запуск тестов

```bash
npm test
```

Убедитесь, что все тесты проходят успешно.

## Шаг 4: Локальный запуск

```bash
npm start
```

Приложение запустится и будет ожидать времени выполнения по расписанию (по умолчанию 11:00 UTC).

## Шаг 5: Проверка работоспособности

Откройте в браузере или через curl:

```bash
curl http://localhost:3000/health
```

Должен вернуться JSON с статусом `waiting`.

## Опционально: Изменение расписания для тестирования

Для быстрого тестирования измените расписание в `.env`:

```bash
# Запуск каждую минуту (ТОЛЬКО ДЛЯ ТЕСТИРОВАНИЯ!)
CRON_SCHEDULE=* * * * *
```

После тестирования верните обратно:

```bash
# Запуск раз в день в 11:00 UTC
CRON_SCHEDULE=0 11 * * *
```

## Деплой на Railway

### Через веб-интерфейс:

1. Зайдите на https://railway.app/
2. Создайте новый проект из GitHub репозитория
3. Добавьте все переменные окружения из `.env`
4. Деплой произойдёт автоматически

### Через CLI:

```bash
# Установка Railway CLI
npm i -g @railway/cli

# Логин
railway login

# Инициализация
railway init

# Добавление переменных (каждую по отдельности)
railway variables set JIRA_BASE_URL=https://your-domain.atlassian.net
railway variables set JIRA_API_TOKEN=your_token
railway variables set JIRA_EMAIL=your@email.com
railway variables set SLACK_BOT_TOKEN=xoxb-your-token
railway variables set SLACK_CHANNEL_ID=C01234ABCDE

# Деплой
railway up
```

## Проверка после деплоя

```bash
# Проверка логов
railway logs

# Проверка health check
curl https://your-app.railway.app/health
```

## Полезные команды

```bash
# Запуск с детальным логированием
LOG_LEVEL=debug npm start

# Запуск тестов с покрытием
npm run test:coverage

# Запуск тестов в watch режиме
npm run test:watch
```

## Структура логов

Все логи выводятся в JSON формате:

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

## Troubleshooting

### Бот не запускается

- Проверьте, что все обязательные переменные окружения заполнены
- Проверьте Node.js версию: `node --version` (должна быть >= 18.0.0)

### Ошибка подключения к Jira

- Проверьте правильность `JIRA_BASE_URL` (должен начинаться с https://)
- Проверьте валидность `JIRA_API_TOKEN`
- Проверьте, что `JIRA_EMAIL` соответствует аккаунту, создавшему токен

### Ошибка публикации в Slack

- Проверьте права бота (scopes: `chat:write`, `chat:write.public`)
- Проверьте правильность `SLACK_CHANNEL_ID`
- Убедитесь, что бот добавлен в канал

### Отчёт не публикуется по расписанию

- Проверьте `CRON_SCHEDULE` и `TIMEZONE`
- Проверьте логи на наличие ошибок
- Убедитесь, что процесс запущен и не завершился с ошибкой

---

**Готово! Бот настроен и готов к работе** 🎉

