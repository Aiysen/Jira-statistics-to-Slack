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
| 136 | payment/adapters/matching-antifraud | main       |

## Нужные webhooks на каждый проект

| URL                                                                                              | Event                  | Secret token                 |
|--------------------------------------------------------------------------------------------------|------------------------|------------------------------|
| `https://jira-to-slack-bot-production.up.railway.app/webhooks/gitlab/pipeline`                  | Pipeline events        | `GITLAB_PIPELINE_WEBHOOK_TOKEN` (если задан) |
| `https://jira-to-slack-bot-production.up.railway.app/webhooks/gitlab/merge-request`             | Merge request events   | `GITLAB_MR_WEBHOOK_TOKEN` или `GITLAB_PIPELINE_WEBHOOK_TOKEN` |

> Если ни одна из переменных не задана в Railway — бот принимает запросы без проверки токена.  
> Чтобы проверить: `railway variables | grep WEBHOOK_TOKEN`

## Действия агента

### Шаг 1 — получить GITLAB_TOKEN

```powershell
$glToken = (railway variables --json | ConvertFrom-Json).GITLAB_TOKEN
```

### Шаг 2 — проверить текущие webhooks

```powershell
$base = "https://git.chcadm.in/api/v4/projects"
$headers = @{"PRIVATE-TOKEN" = $glToken}

foreach ($id in @(51, 52, 81, 22, 32, 136)) {
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

```powershell
$base    = "https://git.chcadm.in/api/v4/projects"
$botUrl  = "https://jira-to-slack-bot-production.up.railway.app"
$headers = @{"PRIVATE-TOKEN" = $glToken; "Content-Type" = "application/json"}

# MR webhook
foreach ($id in @(51, 52, 81, 22, 32, 136)) {
  $body = @{ url = "$botUrl/webhooks/gitlab/merge-request"; merge_requests_events = $true; push_events = $false } | ConvertTo-Json
  $resp = Invoke-RestMethod -Method Post -Uri "$base/$id/hooks" -Headers $headers -Body $body
  Write-Host "MR webhook project ${id} -> id=$($resp.id) OK"
}

# Pipeline webhook
foreach ($id in @(51, 52, 81, 22, 32, 136)) {
  $body = @{ url = "$botUrl/webhooks/gitlab/pipeline"; pipeline_events = $true; push_events = $false } | ConvertTo-Json
  $resp = Invoke-RestMethod -Method Post -Uri "$base/$id/hooks" -Headers $headers -Body $body
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
