# Как раскатить на GitHub Pages

Сайт уже настроен на сборку через GitHub Actions: в репозитории лежит `clients/motor-plus.json`,
а готовые страницы собирает workflow и выкладывает на Pages. Готовая папка `docs/` в git больше
не лежит — иначе после смены режима она осталась бы висеть старым содержимым.

## Шаг 1. Отправить изменения на GitHub

Из `C:\Users\sterb\Desktop\Demo`:

```powershell
git push origin main
```

Если Git спросит логин — войдёт окно браузера (Git Credential Manager), пароль от аккаунта
не нужен. Проверка: `git status` отвечает `Your branch is up to date with 'origin/main'`,
а `git log --oneline -1` совпадает с тем, что видно на github.com/DreadNightX/demo/commits/main.

## Шаг 2. Проверить настройку Pages

1. Открыть https://github.com/DreadNightX/demo/settings/pages
2. **Source** должен стоять на `GitHub Actions`.
3. Если стоит `Deploy from a branch` — переключить на `GitHub Actions`. Папку и ветку
   при этом выбирать не нужно, workflow зарегистрируется сам.

Проверка: на странице настроек плашка с адресом `https://dreadnightx.github.io/demo/`,
а во вкладке **Actions** есть workflow **Deploy demos**.

> Почему это важно: при `Deploy from a branch` GitHub берёт файлы из `docs/`, а мы эту папку
> убрали из репозитория — сайт остался бы на старой версии или отдал 404.

## Шаг 3. Запустить сборку

Пуш из шага 1 сам запускает workflow (он реагирует на изменения в `clients/**`, `_templates/**`
и `new_demo.py`). Если менять было нечего — запустить вручную:
**Actions → Deploy demos → Run workflow → main → Run workflow**.

Проверка: запуск зелёный, в логе шага «Собрать сайты» строка `собрано: motor-plus`,
в шаге deploy — `Page URL`.

## Шаг 4. Открыть

| Что | Адрес |
|---|---|
| Список демо | https://dreadnightx.github.io/demo/ |
| Демо автосервиса | https://dreadnightx.github.io/demo/motor-plus/ |

Проверка: открыть в приватном окне — форма записи на месте, в списке дат только будущие дни,
`Ctrl+U` показывает название клиента, а не «ГАРАЖ 12».

## Дальше — одна команда на клиента

```powershell
python new_demo.py publish motor-plus   # собрать, закоммитить JSON, запушить
python new_demo.py delete motor-plus --yes   # убрать демо из репозитория
python new_demo.py list                 # что есть
```

`publish` в режиме Actions кладёт в git только `clients/<slug>.json`; сайт соберёт CI.
`delete` удаляет и JSON — иначе CI собрал бы демо обратно.

## Если что-то не так

| Симптом | Причина |
|---|---|
| 404 на `/demo/` | Pages не включён или Source стоит на ветке/`docs` |
| 404 на `/demo/motor-plus/` | упал workflow — смотреть лог в Actions; или slug в JSON не совпадает с именем файла |
| Открывается старая версия | кеш браузера (`Ctrl+Shift+R`) или пуш не прошёл |
| Сайт без стилей | `F12 → Console`: обычно 404 на `fonts.css` |
| Форма не отправляет | `form_endpoint` пуст — это ожидаемо, страница пишет «это демо» |
| Workflow падает на «Тесты шаблона» | сломали `_templates/site/*.js`; проверить локально `node _templates\site\app.test.js` |

## Альтернатива: сборка из ветки

Если экшены не нужны, можно отдать Pages папку `docs/` прямо из ветки:

1. Убрать `docs/` из `.gitignore` и удалить `.github/workflows/pages.yml`.
2. `python new_demo.py publish motor-plus` — скрипт увидит, что workflow нет, и положит
   собранные файлы в `docs/<slug>/`.
3. **Settings → Pages → Source**: `Deploy from a branch`, ветка `main`, папка `/docs`.

Минус: в истории git лежат мегабайты собранного HTML и фото, диффы нечитаемые.

## Что важно помнить

- Репозиторий публичный: JSON клиентов, телефоны и адреса видны всем. Только данные с карточек.
- `noindex` стоит в каждой странице, но `robots.txt` в схеме «а» не работает — роботы читают
  его только из корня домена (`dreadnightx.github.io`), а он вам не принадлежит.
- Лимиты мягкие: 1 ГБ на сайт, ~100 ГБ трафика в месяц, 10 сборок в час. Для десятка демо — с запасом.