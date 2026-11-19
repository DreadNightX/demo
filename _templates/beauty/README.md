# Beauty Studio — универсальный премиальный шаблон

Готовый статический шаблон сайта салона красоты (Quiet Luxury + Editorial): чистые HTML, CSS и JavaScript без сборщиков, фреймворков и серверных зависимостей. Работает на GitHub Pages в подпапке репозитория и открывается двойным щелчком по `index.html` с диска.

## Структура

```text
beauty-template/
├── index.html          разметка (без клиентских данных)
├── config.js           ВСЕ данные клиента — единственный файл для сборщика
├── style.css           стили шаблона
├── js/
│   └── main.js         рендеринг из window.SITE_CONFIG
└── assets/
    ├── hero.jpg        главный экран (4:5)
    ├── salon.jpg       «О салоне» (4:5)
    ├── salon-detail.jpg врезка в блоке «О салоне» (3:2)
    ├── service-1..6.jpg услуги (4:5)
    ├── master-1..4.jpg мастера (4:5)
    ├── gallery-1..8.jpg галерея
    ├── booking.jpg     блок записи (3:4)
    ├── og-image.jpg    превью для соцсетей (1200×630)
    ├── favicon.svg
    └── fonts/          Prata, Inter, Cormorant Garamond (self-hosted woff2)
```

## Как подключить данные

1. Сборщик копирует папку `beauty-template/` в каталог публикации.
2. Перезаписывает `config.js`, присваивая объект в `window.SITE_CONFIG`.
3. При необходимости перезаписывает файлы в `assets/` (имена фиксированы).
4. Публикует каталог на GitHub Pages.

HTML, CSS и JS менять не нужно.

```html
<script src="config.js"></script>
<script src="js/main.js"></script>
```

Требования к `config.js`:

- присваивание в `window.SITE_CONFIG` (никакого `fetch`, JSON-файлов и inline-скриптов с данными);
- все пути — относительные (`assets/hero.jpg`), без ведущего слеша и без домена;
- любое поле необязательно: пустая строка, пустой массив или отсутствие ключа означает «данных нет».

## Поведение при отсутствии данных

| Нет данных | Что происходит |
| --- | --- |
| `contacts.phone` | телефон скрывается в шапке, контактах, блоке записи и мобильной панели |
| `contacts.address` | блок адреса и карта скрываются, адрес пропадает из меню и подвала |
| `social.*` | соответствующие иконки не рендерятся; пустой блок соцсетей скрывается |
| `masters.items` | секция «Мастера» и пункт меню скрываются |
| `services.items` | секция «Услуги» скрывается, поле «Услуга» в форме убирается |
| `gallery.items` | подставляются локальные `assets/gallery-1..6.jpg` |
| `reviews.items` | секция «Отзывы» скрывается |
| `hero.image`, `about.image`, `booking.image` | подставляются локальные изображения по умолчанию |
| `seo.title` / `seo.description` | собираются из `name`, `slogan`, `description` |
| `name` | заголовок и логотип получают нейтральный текст «Салон красоты» |

Никаких `undefined`, `null`, пустых кнопок и «битых» картинок: все значения проходят через проверку и выводятся только через `textContent`.

## Схема config.js

```javascript
window.SITE_CONFIG = {
  name, legalName, slogan, description,
  logo: { text, image, mark },
  nav: [{ label, target }],
  ticker: ["Маникюр", "..."],
  hero: { eyebrow, title, accent, lead, cta, image, caption, vertical,
          facts: [{ value, label }] },
  about: { eyebrow, title, paragraphs: [], image, detailImage, badge,
           signature: { name, role }, stats: [{ value, label }] },
  services: { eyebrow, title, note,
              items: [{ name, description, price, duration, image }] },
  advantages: { eyebrow, title, items: [{ icon, title, text }] },
  masters: { eyebrow, title, note,
             items: [{ name, specialization, experience, image }] },
  gallery: { eyebrow, title, note,
             items: ["assets/gallery-1.jpg", { src, caption }] },
  reviews: { eyebrow, title, items: [{ text, author, role, service }] },
  booking: { eyebrow, title, text, image, note, successTitle, successText },
  form: { demo: true, endpoint: "", method: "POST", successMessage: "" },
  contacts: { phone, phoneAlt, email, address, district, workingHours, mapUrl },
  social: { telegram, whatsapp, instagram, vk, youtube },
  seo: { title, description, keywords, ogImage, url, locale },
  footer: { legal, copyright, columns: [{ title, links: [{ label, href, external }] }] }
};
```

Иконки преимуществ (`advantages.items[].icon`): `leaf`, `award`, `clock`, `sparkle`, `scissors`, `heart`, `drop`, `star`.

Соцсети принимают полный URL или ник: `telegram: "@elegance"` → `https://t.me/elegance`.

## Форма записи

По умолчанию работает демонстрационный режим (`form.demo: true`): валидация полей, имитация задержки и экран успешной отправки. Данные никуда не уходят.

Три способа подключить реальную отправку без изменения дизайна:

1. `form.endpoint` — URL, куда уйдёт `POST` с JSON (нужно также поставить `demo: false`).
2. `window.SITE_HOOKS.onSubmit(payload)` — своя функция, может вернуть `Promise<{ ok, message }>`.
3. Событие `site:submit` на `window` — для аналитики и интеграций.

```html
<script>
  window.SITE_HOOKS = {
    onSubmit: function (payload) {
      return fetch('https://api.example.ru/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return { ok: r.ok }; });
    }
  };
</script>
<script src="config.js"></script>
<script src="js/main.js"></script>
```

## Замена изображений

Достаточно перезаписать файлы в `assets/` с теми же именами. Рекомендации:

- `hero.jpg`, `salon.jpg`, `service-*.jpg`, `master-*.jpg` — 4:5, от 900 px по короткой стороне;
- `gallery-1..8.jpg` — 4:5 / 3:2 / 1:1, мозаика сама обрежет по `object-fit: cover`;
- `og-image.jpg` — строго 1200×630;
- вес одного файла — до 250 КБ (progressive JPEG, quality 80–84).

## SEO

Из конфига подставляются `<title>`, `meta description`, Open Graph, Twitter Card, canonical (если задан `seo.url`), `keywords` и JSON-LD `BeautySalon` (адрес, телефон, часы работы, каталог услуг, соцсети). Разметка семантическая: `header`, `nav`, `main`, `section` с `aria-labelledby`, `article`, `blockquote`, `footer`.

## Доступность и производительность

- контраст текста не ниже 4.5:1 для основного текста;
- полная навигация с клавиатуры, видимый фокус, `skip-link`;
- лайтбокс закрывается `Esc`, листается стрелками, ловит фокус;
- `prefers-reduced-motion` отключает анимации;
- шрифты и изображения локальные, изображения — `loading="lazy"` (кроме hero);
- нет внешних запросов: сайт работает офлайн и на GitHub Pages без настроек.

## Публикация на GitHub Pages

1. Запушьте каталог шаблона в репозиторий.
2. Settings → Pages → Source: `Deploy from a branch`, ветка `main`, папка `/ (root)` (или `/docs`, если шаблон лежит там).
3. Сайт откроется по адресу `https://<user>.github.io/<repo>/`.

Все пути относительные, поэтому подпапка репозитория не ломает ни стили, ни изображения, ни шрифты.

## Локальная проверка

Откройте `index.html` в браузере — этого достаточно (никакого `fetch` и `file://`-ограничений). Для проверки через localhost:

```bash
python -m http.server 8000
```
