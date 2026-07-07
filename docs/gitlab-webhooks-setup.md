# Управление GitLab webhooks

Инструкция для AI-агента и разработчика: как создать или обновить webhooks в GitLab-проектах бота.

## Контекст

- GitLab инстанс: `https://git.chcadm.in`
- Railway сервис: `https://jira-to-slack-bot-production.up.railway.app`
- Railway проект: `7db75e66-0b30-4ad3-bfbc-f85e3cf8349a`
- Список проектов: [`src/gitlab/config.js`](../src/gitlab/config.js)

Актуальные проекты на момент написания (ID → prod-ветка):

| ID  | Путь                                | Prod-ветка |
|-----|-------------------------------------|------------|
| 51  | payment/backend                     | master     |
| 52  | payment/frontend                    | master     |
| 81  | payment/adapters/matching           | master     |
| 22  | payment/user-page-front             | main       |
| 32  | payment/user-page-back              | main       |
| 125 | payment/ledger/ledger-service       | main       |
| 136 | payment/adapters/matching-antifraud | main       |

## Нужные webhooks на каждый проект

| URL                                                                                              | Event                  | Secret token в GitLab        |
|--------------------------------------------------------------------------------------------------|------------------------|------------------------------|
| `https://jira-to-slack-bot-production.up.railway.app/webhooks/gitlab/pipeline`                  | Pipeline events        | см. ниже                     |
| `https://jira-to-slack-bot-production.up.railway.app/webhooks/gitlab/merge-request`             | Merge request events   | см. ниже                     |

### Secret token — совпадение с Railway

В Railway задана переменная **`GITLAB_PIPELINE_WEBHOOK_TOKEN`**. Бот сравнивает её с заголовком `X-Gitlab-Token`, который GitLab отправляет из поля **Secret token** webhook.

**В каждом GitLab webhook (pipeline и merge-request) в поле Secret token нужно вставить то же значение, что в Railway `GITLAB_PIPELINE_WEBHOOK_TOKEN`.** Иначе GitLab получит **401 Unauthorized**, события не обработаются, уведомления в Slack не придут.

- Pipeline webhook: только `GITLAB_PIPELINE_WEBHOOK_TOKEN`.
- Merge request webhook: `GITLAB_MR_WEBHOOK_TOKEN`, если задан в Railway; иначе снова **`GITLAB_PIPELINE_WEBHOOK_TOKEN`**.

Проверка в GitLab: Settings → Webhooks → Recent events — ответ **200** и `{"ok":true}`. **401** почти всегда значит, что Secret token в GitLab не совпадает с Railway (или пустой).

> Если **ни одна** из переменных webhook-token не задана в Railway, бот принимает запросы без проверки. На production обычно токен задан — Secret в GitLab обязателен.  
> Посмотреть переменные: `railway variables | grep WEBHOOK_TOKEN`

## Действия агента

### Шаг 1 — получить GITLAB_TOKEN и webhook secret

```powershell
$vars = railway variables --json | ConvertFrom-Json
$glToken = $vars.GITLAB_TOKEN
$webhookToken = $vars.GITLAB_PIPELINE_WEBHOOK_TOKEN
if (-not $webhookToken) {
  Write-Warning "GITLAB_PIPELINE_WEBHOOK_TOKEN не задан — Secret token в GitLab можно не указывать"
}
```

### Шаг 2 — проверить текущие webhooks

```powershell
$base = "https://git.chcadm.in/api/v4/projects"
$headers = @{"PRIVATE-TOKEN" = $glToken}

foreach ($id in @(51, 52, 81, 22, 32, 125, 136)) {
  $hooks = Invoke-RestMethod -Uri "$base/$id/hooks" -Headers $headers
  $ourHooks = $hooks | Where-Object { $_.url -like "*railway.app*" }
  Write-Host "Project ${id}:"
  foreach ($h in $ourHooks) {
    $events = @()
    if ($h.pipeline_events)        { $events += "pipeline" }
    if ($h.merge_requests_events)  { $events += "merge_request" }
    Write-Host "  [$($events -join ', ')] $($h.url)"
  }
}
```

### Шаг 3 — создать недостающие webhooks

Сначала выполните Шаг 1 (`$glToken`, `$webhookToken`, `$vars`).

```powershell
$base    = "https://git.chcadm.in/api/v4/projects"
$botUrl  = "https://jira-to-slack-bot-production.up.railway.app"
$headers = @{"PRIVATE-TOKEN" = $glToken; "Content-Type" = "application/json"}

# MR webhook (token = GITLAB_MR_WEBHOOK_TOKEN или GITLAB_PIPELINE_WEBHOOK_TOKEN)
$mrWebhookToken = $vars.GITLAB_MR_WEBHOOK_TOKEN
if (-not $mrWebhookToken) { $mrWebhookToken = $webhookToken }

foreach ($id in @(51, 52, 81, 22, 32, 125, 136)) {
  $body = @{
    url = "$botUrl/webhooks/gitlab/merge-request"
    merge_requests_events = $true
    push_events = $false
  }
  if ($mrWebhookToken) { $body.token = $mrWebhookToken }
  $resp = Invoke-RestMethod -Method Post -Uri "$base/$id/hooks" -Headers $headers -Body ($body | ConvertTo-Json)
  Write-Host "MR webhook project ${id} -> id=$($resp.id) OK"
}

# Pipeline webhook
foreach ($id in @(51, 52, 81, 22, 32, 125, 136)) {
  $body = @{
    url = "$botUrl/webhooks/gitlab/pipeline"
    pipeline_events = $true
    push_events = $false
  }
  if ($webhookToken) { $body.token = $webhookToken }
  $resp = Invoke-RestMethod -Method Post -Uri "$base/$id/hooks" -Headers $headers -Body ($body | ConvertTo-Json)
  Write-Host "Pipeline webhook project ${id} -> id=$($resp.id) OK"
}
```

> Перед созданием стоит проверить Шагом 2, какие webhooks уже есть, чтобы не дублировать.

---

## Добавление нового репозитория

1. Добавить проект в [`src/gitlab/config.js`](../src/gitlab/config.js):
   ```javascript
   { id: <project_id>, targetBranch: 'master' }, // или 'main'
   ```

2. Обновить таблицу проектов в этом файле и в [`docs/gitlab-repositories.md`](./gitlab-repositories.md).

3. Создать оба webhook для нового проекта (Шаг 3 выше, но только для нового ID).

4. Убедиться, что `GITLAB_TOKEN` имеет роль Developer+ на новом проекте:
   ```powershell
   Invoke-RestMethod -Uri "https://git.chcadm.in/api/v4/projects/<id>" -Headers @{"PRIVATE-TOKEN" = $glToken}
   ```
   Должен вернуться объект проекта, а не 403.

---

## Добавление нового типа webhook

Если в боте появится новый endpoint (например `/webhooks/gitlab/tag-push`):

1. Найти поддерживаемые события в [документации GitLab Hooks API](https://docs.gitlab.com/ee/api/projects.html#add-hook-to-project) — поле `tag_push_events`, `issues_events` и т.д.

2. Создать webhook аналогично Шагу 3, передав нужное поле в `$body`.

3. Добавить новую строку в таблицу «Нужные webhooks» выше.
