# Чеклист после деплоя (GitLab + webhook)

Выполняется **один раз** после первого деплоя кода с GitLab-интеграцией на Railway.

## 1. Создать GitLab Personal Access Token

1. Войти в [`https://git.chcadm.in/`](https://git.chcadm.in/) от имени bot-пользователя (или своего).
2. Profile → Preferences → Access Tokens → Add new token.
3. Scopes: **`api`** (включает read/write MR, branches).
4. Убедиться, что аккаунт имеет роль **Developer+** на всех проектах из [`src/gitlab/config.js`](../src/gitlab/config.js).
5. Скопировать токен — он показывается только один раз.

## 2. Выставить переменные в Railway

Проект: [`Jira-to-Slack-Bot`](https://railway.com/project/7db75e66-0b30-4ad3-bfbc-f85e3cf8349a)  
Сервис: `Jira-to-Slack-Bot`  
Environment: `production`

| Переменная          | Значение                       |
|---------------------|--------------------------------|
| `GITLAB_BASE_URL`   | `https://git.chcadm.in`        |
| `GITLAB_TOKEN`      | токен из шага 1                |
| `JIRA_WEBHOOK_SECRET` | придумать случайную строку (например `openssl rand -hex 32`) |

Установить через Railway Dashboard → Variables, или через CLI:
```bash
railway variables set GITLAB_BASE_URL=https://git.chcadm.in
railway variables set GITLAB_TOKEN=<токен>
railway variables set JIRA_WEBHOOK_SECRET=<секрет>
```

После выставления переменных Railway автоматически перезапустит сервис.

## 3. Настроить Jira Automation

1. Открыть Jira → Project Settings → Automation.
2. Создать новое правило:
   - **Trigger:** Issue transitioned
   - **Condition:** Status = `Ready for Deploy` (точное имя статуса из вашего workflow)
   - **Action:** Send web request
     - URL: `https://jira-to-slack-bot-production.up.railway.app/webhooks/jira/deploy-ready`
     - Method: `POST`
     - Headers: `X-Webhook-Secret: <JIRA_WEBHOOK_SECRET из шага 2>`
     - Body: `{"issueKey": "{{issue.key}}", "issueId": "{{issue.id}}", "summary": "{{issue.summary}}"}`
     - Content-Type: `application/json`
3. Сохранить и включить правило.

## 4. Smoke-тест

1. Открыть тестовый тикет в Jira (или создать временный).
2. Убедиться, что в GitLab для одного из проектов (51/52/81/22/32/125/136) есть ветка с ключом тикета.
3. Перевести тикет в статус `Ready for Deploy`.
4. В течение ~30 секунд в Slack-канале должно появиться сообщение вида:
   ```
   🚀 Ready for Deploy — PROJ-123: Описание задачи
   Jira: <ссылка>

   • Project 51: !123 — создан
   ```
5. Проверить логи Railway: `railway logs` — убедиться, что нет ошибок.

## 5. Проверка daily-отчёта с MR

Следующим утром (по расписанию `CRON_SCHEDULE`) в родительском сообщении отчёта должна появиться секция:
```
🔀 Открытые MR (N):
  • group/repo!123 — title (feature/KEY → master)
```

Для немедленной проверки можно временно изменить `CRON_SCHEDULE` на ближайшую минуту в Railway variables.
