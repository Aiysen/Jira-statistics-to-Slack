# Уведомление о новой задаче Jira и пинг review-бота

## Как упомянуть другого бота в Slack

У ботов в workspace тот же формат, что у людей: **user ID вида `U…`**. В сообщении это `<@U0123456789>` — тогда Slack показывает `@DualiPay bot` и шлёт целевому приложению событие `app_mention` (если бот в канале и подписан на mentions).

Текст `@DualiPay bot` без ID **не** срабатывает как mention — наш бот не может «угадать» ID по отображаемому имени без API.

### Как узнать user ID DualiPay bot

1. **Профиль в Slack** — открыть профиль бота → «⋯» → часто есть «Copy member ID» / ID (зависит от клиента).
2. **Переменная окружения** — задать `SLACK_JIRA_REVIEW_BOT=U…` (рекомендуется для production).
3. **Автопоиск** — `SLACK_JIRA_REVIEW_BOT=DualiPay bot` (или `dualipay`): при первом событии бот вызовет `users.list` и найдёт `is_bot: true` по имени. Нужен scope **`users:read`** у jira-to-slack приложения.

DualiPay bot должен быть **добавлен в тот же канал**, что и `SLACK_CHANNEL_ID`.

## Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `SLACK_JIRA_REVIEW_BOT` | ID (`U…`), готовый `<@U…>`, алиас из `SLACK_BOTS` или подстрока имени бота |
| `JIRA_ISSUE_NOTIFY_PROJECTS` | По умолчанию `CPAYMENT`; `*` — все проекты |
| `JIRA_WEBHOOK_SECRET` | Тот же секрет, что для deploy-ready |

Алиас `dualipay` задан в `src/slack/botMention.js` (`U0ANU6FJAT0`). Переменная `SLACK_JIRA_REVIEW_BOT` не обязательна — по умолчанию используется `dualipay`.

## Jira Automation

1. **Project settings → Automation** (или глобально для CPAYMENT).
2. Правило **Issue created** (или Created → Issue).
3. **Send web request**:
   - URL: `https://<ваш-railway-host>/webhooks/jira/issue-created`
   - Method: `POST`
   - Header: `X-Webhook-Secret: <JIRA_WEBHOOK_SECRET>`
   - Body (JSON): `{"issueKey": "{{issue.key}}", "summary": "{{issue.summary}}"}`
   - Content-Type: `application/json`

## Поведение в Slack

1. Корневое сообщение: новая задача + ссылка на Jira.
2. Ответ в треде:
   ```
   <@U_DUALIPAY>
   jira review CPAYMENT-1234
   ```

## Smoke-тест

```bash
curl -X POST "http://localhost:3000/webhooks/jira/issue-created" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{"issueKey":"CPAYMENT-9999","summary":"Test issue"}'
```
