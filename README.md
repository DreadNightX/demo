# Демо-сайты для холодных обращений

Генератор статических демо-сайтов для автосервисов и мастерских + публикация на GitHub Pages.

**Схема адресов — «а»: один репозиторий, папка на клиента.**
`https://<логин>.github.io/demo/motor-plus/` — без своего домена, без DNS, без поддоменов.

## Что где лежит

```
clients/motor-plus.json      данные клиента (единственное, что вы правите руками)
_templates/site/             шаблон: index.html + config.js + app.js + шрифты + фото
new_demo.py                  сборка, публикация, удаление
.github/workflows/pages.yml  сборка на стороне GitHub (рекомендуемый режим)
functions/lead/handler.py    серверная функция приёма заявок (Yandex Cloud Functions)
docs/                        собранные сайты для режима «из ветки»
dist/                        локальные сборки (в .gitignore)
```

Шаблон — обычный HTML с маркерами `<!--PRICES-->`, `<!--REVIEWS-->`, `<!--FAQ-->`, `<!--CREDIT-->`.
Название, телефон, адрес и часы уезжают в `data.js`, который читает `config.js`, —
поэтому в разметку их вписывать не нужно.

## Быстрый старт

```powershell
python new_demo.py build motor-plus         # собрать в dist/motor-plus и посмотреть локально
python new_demo.py publish motor-plus       # закоммитить и запушить
python new_demo.py list                     # что есть
python new_demo.py delete motor-plus --yes  # удалить демо
python new_demo.py build-all                # собрать всё (то же запускает CI)
```

Локальный просмотр: `start dist\motor-plus\index.html` (Windows), `open dist/motor-plus/index.html` (macOS).

## Данные клиента

`clients/<slug>.json`, slug — латиница в нижнем регистре и дефис, 2–41 символ: `motor-plus`.

| Поле | Обязательное | Что это |
|---|---|---|
| `slug` | да | совпадает с именем файла |
| `name` | да | «МОТОР ПЛЮС» |
| `phone` | да | любой формат, скрипт приведёт к `tel:+7...` |
| `district` | нет | район/город для заголовка |
| `address`, `hours` | нет | адрес и часы |
| `prices` | нет | `[{"service": "...", "price": "от 2 500 ₽"}]`; нет — подставятся нейтральные |
| `reviews` | нет | `[{"text","author","car","source"}]`; нет — подставятся вымышленные |
| `faq` | нет | `[{"q","a"}]`; добавляются к пяти общим вопросам |
| `credit` | нет | атрибуция фото: `{"text","url"}` |
| `noindex` | нет | по умолчанию `true` |
| `form_endpoint` | нет | URL функции приёма заявок; пусто — форма скрывается, остаётся телефон |
| `domain` | для схемы «б» | ваш домен без поддомена: `example.ru` |

Проверка после правки — `python new_demo.py build motor-plus`. Скрипт падает с понятным
текстом, если JSON битый, slug не тот или обязательное поле пустое.

## Режимы публикации

**Режим 1 — GitHub Actions (рекомендуется).** В git лежит только `clients/*.json`.
Настройка один раз: **Settings → Pages → Source: GitHub Actions**. Дальше
`python new_demo.py publish motor-plus` коммитит один JSON, сайт собирает workflow.

**Режим 2 — из ветки.** Сгенерированные файлы лежат в `docs/`, Pages отдаёт папку `/docs`.
Удалите `.github/workflows/pages.yml` и в **Settings → Pages** выберите
*Deploy from a branch → main → /docs*. Ограничение: soft-лимит 10 сборок в час
(на режим с Actions не действует).

## Свой домен (схема «б»)

```powershell
python new_demo.py publish motor-plus --per-repo
```

Создаёт репозиторий `demo-motor-plus`, включает Pages и печатает DNS-запись.
Требует `winget install --id GitHub.cli` и перезапуска терминала.

1. **Сначала** домен в настройках Pages репозитория, **потом** DNS-запись у регистратора.
   Наоборот — дырка: поддомен успеет занять кто угодно.
2. DNS: `CNAME  motor-plus  →  <логин>.github.io` (без имени репозитория!).
3. Верификация домена в настройках аккаунта: TXT `_github-pages-challenge-<логин>.example.ru`.
4. **Settings → Pages → Enforce HTTPS** — после выпуска сертификата.
5. Не делайте wildcard `*.example.ru` — GitHub прямо не рекомендует.

Сроки: DNS 5–30 минут (до 24 часов), сертификат Let's Encrypt — от минут до суток.

```powershell
Resolve-DnsName motor-plus.example.ru -Type CNAME
Resolve-DnsName _github-pages-challenge-<логин>.example.ru -Type TXT
curl.exe -I https://motor-plus.example.ru
```

## Форма заявок

Токен бота нельзя держать в JS — его увидит любой, кто откроет исходники страницы.
Цепочка: страница → ваша serverless-функция → Telegram.

`functions/lead/handler.py` — обработчик для Yandex Cloud Functions (Python 3.12, точка входа `handler.handler`).

| Переменная | Значение |
|---|---|
| `TG_BOT_TOKEN` | токен бота от @BotFather |
| `TG_CHAT_ID` | ваш chat_id (написать боту, затем `api.telegram.org/bot<токен>/getUpdates`) |
| `ALLOWED_ORIGIN` | `https://<логин>.github.io` |
| `HOURLY_LIMIT` | необязательно, по умолчанию 20 |

Секреты задаются в консоли облака как переменные окружения функции — в репозиторий они не попадают.
Защита от спама: honeypot (поле `company`), проверка телефона, лимит по IP, проверка `Referer`,
плюс пауза 60 секунд на клиенте. Лимит в памяти процесса «мягкий»: для жёсткого нужен Redis
или встроенный rate-limit платформы.

Подключение: `"form_endpoint": "https://functions.yandexcloud.net/<id>"` в JSON клиента.

## Приватность

На бесплатном тарифе репозиторий с Pages публичный: JSON клиента, адрес, телефон и история
коммитов видны всем. Кладите только то, что и так есть на карточке в Яндекс.Картах.
Удалённое демо остаётся в истории git — если данные чувствительные, чистите историю
(`git filter-repo`) или заводите под демо отдельный репозиторий.

## Тесты

```powershell
cd _templates\site
node config.test.js
node app.test.js
```

(`node --test <файл>` в некоторых песочницах падает с `spawn EPERM` — запускайте файл напрямую.)
