#!/usr/bin/env python3
"""new_demo.py — собрать демо-сайт для клиента и (опционально) опубликовать на GitHub Pages.

    python new_demo.py build motor-plus        # собрать в dist/motor-plus
    python new_demo.py publish motor-plus      # собрать и закоммитить + запушить
    python new_demo.py publish motor-plus --dry-run
    python new_demo.py delete motor-plus --yes # удалить демо (--yes обязателен)
    python new_demo.py list                    # что уже собрано

Схема адресов по умолчанию — «а»: один репозиторий, папка на клиента
    https://<логин>.github.io/<репозиторий>/<slug>/
Схема «б» (отдельный репозиторий + поддомен) — флаг --per-repo.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "_templates"
TEMPLATE = TEMPLATES / "site"       # шаблон автосервиса: остаётся по умолчанию
CLIENTS = ROOT / "clients"
DIST = ROOT / "dist"
SITE_DIR = ROOT / "docs"          # публикуемая папка: GitHub Pages из ветки умеет только / или /docs
WORKFLOW = ROOT / ".github" / "workflows" / "pages.yml"
NOINDEX = '<meta name="robots" content="noindex, nofollow">'

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")

# Какой шаблон брать. Салон красоты собирается по _templates/beauty, все
# остальные ниши (автосервис, шиномонтаж, ремонт компьютеров) — по _templates/site.
# Шаблон можно задать явно полем "template" в clients/<slug>.json; если поля
# нет — он выбирается по нише (поле "niche").
NICHE_TEMPLATE = {"beauty": "beauty"}
# старые файлы клиентов (без поля niche) узнаём по префиксу слага
SLUG_TEMPLATE = {"beauty": "beauty"}
DEFAULT_TEMPLATE = "site"
TEMPLATE_TITLES = {"site": "автосервис", "beauty": "салон красоты"}

# Заглушки на случай, если в JSON нет прайса или отзывов: демо должно выглядеть целым.
DEFAULT_PRICES = [
    {"service": "ТО (масло, фильтры, осмотр)", "price": "от 3 500 ₽"},
    {"service": "Диагностика", "price": "1 000 ₽"},
    {"service": "Ходовая", "price": "от 2 500 ₽"},
    {"service": "Тормоза", "price": "от 2 000 ₽"},
    {"service": "Двигатель", "price": "от 5 000 ₽"},
    {"service": "Коробка", "price": "от 6 000 ₽"},
    {"service": "Кондиционер", "price": "от 1 500 ₽"},
    {"service": "Шиномонтаж", "price": "от 1 800 ₽"},
]
DEFAULT_REVIEWS = [
    {"text": "Смета совпала с чеком рубль в рубль. Ходовую сделали за день.",
     "author": "Игорь", "car": "Kia Rio", "source": "на Яндекс.Картах"},
    {"text": "Записали на завтра, к обеду уже позвонили с итогом.",
     "author": "Марина", "car": "Volkswagen Polo", "source": "на Яндекс.Картах"},
    {"text": "Привозил свои запчасти — поставили без вопросов и наценки.",
     "author": "Сергей", "car": "Toyota Camry", "source": "на Яндекс.Картах"},
]


# ---------------------------------------------------------------- утилиты
def fail(msg: str) -> "NoReturn":
    print("ОШИБКА: " + msg, file=sys.stderr)
    raise SystemExit(1)


def load_client(slug: str) -> dict:
    if not SLUG_RE.match(slug):
        fail("slug должен быть латиницей в нижнем регистре: a-z, 0-9, дефис (2–41 символ).")
    path = CLIENTS / (slug + ".json")
    if not path.exists():
        fail("нет файла данных: " + str(path.relative_to(ROOT)))
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        fail("в %s битый JSON: %s (строка %d, колонка %d)"
             % (path.name, exc.msg, exc.lineno, exc.colno))
    if (data.get("slug") or slug) != slug:
        fail("в JSON slug=%r, а команда просит %r — приведите к одному." % (data.get("slug"), slug))
    for key in ("name", "phone"):
        if not str(data.get(key, "")).strip():
            fail("в %s пустое обязательное поле %r." % (path.name, key))
    data.setdefault("slug", slug)
    data.setdefault("noindex", True)
    return data


def esc(value: object) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def safe_url(value: object) -> str:
    """В href пускаем только http(s) и tel — защита от javascript: из JSON."""
    url = str(value or "").strip()
    return url if re.match(r"^(https?://|tel:|mailto:)", url) else "#"


def safe_endpoint(value: object) -> str:
    """Endpoint формы: только https. Пусто -> "", форма сама скроется."""
    url = str(value or "").strip()
    return url if re.match(r"^https://", url) else ""


# ---------------------------------------------------------------- рендер
def render_prices(items: list) -> str:
    items = items or DEFAULT_PRICES
    rows = []
    for item in items:
        if isinstance(item, dict):
            service, price = item.get("service"), item.get("price")
        else:
            service, price, = item, ""
        if service and price:
            rows.append('          <div class="prow"><span>%s</span><b>%s</b></div>' % (esc(service), esc(price)))
    if not rows:
        fail("в поле prices нет ни одной пары service/price — проверьте JSON.")
    return "\n".join(rows)


def render_reviews(items: list) -> str:
    if not items:
        print("  ! отзывы не заданы: в демо стоят вымышленные. Замените на реальные с карточки.", file=sys.stderr)
        items = DEFAULT_REVIEWS
    out = []
    for i, item in enumerate(items):
        if not item.get("text"):
            continue
        cls = "review lead" if i == 0 else "review"
        meta = ", ".join(part for part in (item.get("author"), item.get("car"), item.get("source")) if part)
        out.append(
            '        <article class="%s">\n'
            '          <p>«%s»</p>\n'
            '          <footer>%s</footer>\n'
            '        </article>' % (cls, esc(item["text"]), esc(meta))
        )
    return "\n".join(out)


def render_faq(items: list) -> str:
    out = []
    for item in items:
        if item.get("q") and item.get("a"):
            out.append(
                '        <details>\n'
                '          <summary>%s</summary>\n'
                '          <p>%s</p>\n'
                '        </details>' % (esc(item["q"]), esc(item["a"]))
            )
    return "\n".join(out)  # пусто — остаются 5 общих вопросов из шаблона


def render_credit(credit: dict) -> str:
    if not credit or not credit.get("text"):
        return ""
    text = esc(credit["text"])
    if credit.get("url"):
        text = '<a href="%s" rel="nofollow noopener" target="_blank">%s</a>' % (esc(safe_url(credit["url"])), text)
    return '<span class="credit">%s</span>' % text


def render_services(items: list) -> str:
    """Выпадающий список услуг в форме. Нет данных — поле не показываем."""
    names = []
    for item in items:
        if isinstance(item, dict):
            name = str(item.get("service") or "").strip()
        else:
            name = str(item or "").strip()
        if name and name not in names:
            names.append(name)
    if not names:
        return ""
    options = "\n".join('              <option>%s</option>' % esc(n) for n in names)
    return (
        '          <div class="field">\n'
        '            <label for="f-service">Услуга</label>\n'
        '            <select id="f-service" name="service">\n'
        '              <option>Не знаю, нужна диагностика</option>\n'
        "%s\n"
        "            </select>\n"
        "          </div>" % options
    )


def render_demo_banner(data: dict) -> str:
    """Плашка сверху. Показывается, пока клиент не согласился: data["live"] = true её убирает."""
    if data.get("live"):
        return ""
    who = esc(str(data.get("name") or data.get("slug") or ""))
    lines = [
        '<div class="demo-note" role="note">',
        '  <div class="wrap">',
        '    <b>Демо</b>',
        '    <span>Так мог бы выглядеть сайт «%s». Цены, отзывы и график — пример,' % who,
        '    в поиске страница не появится.</span>',
        '  </div>',
        '</div>',
    ]
    return "\n".join(lines)


def render_demo_footer(data: dict) -> str:
    """Пометка в футере: остаётся видимой и после согласия — сайт всё ещё на GitHub Pages."""
    if data.get("live"):
        return '<span class="demo-mark">демо-версия</span>'
    return '<span class="demo-mark">демо · не для поиска</span>'


def render_json_js(data: dict) -> str:
    """data.js: JSON внутри JS. «</» экранируем, чтобы данные не закрыли <script>."""
    payload = {k: v for k, v in data.items() if k in ("name", "district", "address", "phone", "hours")}
    raw = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    return "window.DEMO_DATA = %s;\n" % raw


# Значения, с которыми шаблон лежит в репозитории. Заменяются на данные клиента.
TEMPLATE_VALUES = {
    "ГАРАЖ 12": "name",
    "Коптево": "district",
    "ул. Коптевская, 26": "address",
    "+7 (495) 120-45-67": "phone",
    "пн–сб 9:00–21:00": "hours",
    "tel:+74951204567": "tel",
}


def fill_placeholders(page: str, data: dict) -> str:
    """Подставляет данные клиента прямо в разметку вместо значений-заглушек."""
    tel = format_tel(data.get("phone"))
    # если поля нет — не оставляем чужой адрес и чужие часы работы, а честно говорим «уточняется»
    fallback = {
        "name": data.get("slug") or "автосервис",
        "district": "вашем районе",
        "address": "адрес уточняется",
        "phone": "+7 (000) 000-00-00",
        "hours": "уточняйте по телефону",
    }
    for old, key in TEMPLATE_VALUES.items():
        if key == "tel":
            page = page.replace(old, "tel:" + tel)
            continue
        value = data.get(key) or fallback[key]
        page = page.replace(old, esc(str(value)))
    return page


def format_tel(raw: str) -> str:
    """Как в config.js: 8XXXXXXXXXX и XXXXXXXXXX приводим к +7XXXXXXXXXX."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 11 and digits[0] == "8":
        digits = "7" + digits[1:]
    elif len(digits) == 10:
        digits = "7" + digits
    return "+" + digits


def resolve_template(data: dict, slug: str = "") -> str:
    """Каким шаблоном собирать этого клиента: "site" или "beauty".

    Порядок: явное поле "template", затем ниша, затем префикс слага.
    Префикс нужен для файлов, собранных до появления поля "niche": карточка,
    сохранённая раньше, не должна после публикации поменять шаблон.
    """
    explicit = str(data.get("template") or "").strip().lower()
    if explicit in TEMPLATE_TITLES:
        return explicit
    niche = str(data.get("niche") or "").strip().lower()
    if niche in NICHE_TEMPLATE:
        return NICHE_TEMPLATE[niche]
    for prefix, template in SLUG_TEMPLATE.items():
        if slug.startswith(prefix + "-"):
            return template
    return DEFAULT_TEMPLATE


def build(slug: str, out_root: Path, base_url: str = "") -> Path:
    """Собирает демо нужным шаблоном и возвращает папку сборки.

    Салон красоты собирается по _templates/beauty (данные в config.js),
    остальные ниши — по _templates/site (данные в index.html + data.js).
    """
    data = load_client(slug)
    if resolve_template(data, slug) == "beauty":
        return build_beauty(slug, out_root, data)
    return build_auto(slug, out_root, data, base_url)


def build_auto(slug: str, out_root: Path, data: dict, base_url: str = "") -> Path:
    out = out_root / slug
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(TEMPLATE, out)

    page = (out / "index.html").read_text(encoding="utf-8")

    head = []
    if data.get("noindex", True):
        head.append(NOINDEX)
    head.append('<!-- %s | собрано new_demo.py -->' % esc(slug))
    page = page.replace("<!--HEAD-->", "\n".join(head))

    page = page.replace("<!--SERVICES-->", render_services(data.get("services") or data.get("prices") or []))
    page = page.replace("<!--DEMO-->", render_demo_banner(data))
    page = page.replace("<!--DEMO-FOOT-->", render_demo_footer(data))
    page = page.replace("<!--PRICES-->", render_prices(data.get("prices") or []))
    page = page.replace("<!--REVIEWS-->", render_reviews(data.get("reviews") or []))
    page = page.replace("<!--FAQ-->", render_faq(data.get("faq") or []))
    page = page.replace("<!--CREDIT-->", render_credit(data.get("credit") or {}))
    # Значения-заглушки из шаблона меняем уже в HTML: страница верна и без JS,
    # а не «ГАРАЖ 12» до первой отрисовки. data.js остаётся — JS просто передёрнет те же данные.
    page = fill_placeholders(page, data)

    # {name}/{district} в <title> и <meta description> подставляем ещё при сборке:
    # тогда превью ссылки в мессенджерах и title вкладки верны и без JS
    page = page.replace("{name}", esc(data.get("name") or slug))
    if data.get("district"):
        page = page.replace("{district}", esc(data["district"]))
    else:
        page = page.replace(", {district}", "").replace("{district}", "вашем городе")

    page = page.replace('data-endpoint=""', 'data-endpoint="%s"' % esc(safe_endpoint(data.get("form_endpoint"))), 1)
    page = page.replace('data-slug=""', 'data-slug="%s"' % esc(slug), 1)
    # рабочие дни (1..7, пн..вс) и сетка записи — необязательные поля JSON
    days = data.get("days")
    if isinstance(days, list) and days:
        page = page.replace('data-days="1,2,3,4,5,6"', 'data-days="%s"' % esc(",".join(str(int(d)) for d in days)), 1)
    slots = data.get("slots")
    if isinstance(slots, list) and slots:
        page = page.replace(
            'data-slots="9:00,10:00,11:00,12:00,13:00,14:00,15:00,16:00,17:00,18:00"',
            'data-slots="%s"' % esc(",".join(str(s) for s in slots)), 1)

    if re.search(r"<!--(HEAD|PRICES|REVIEWS|FAQ|CREDIT|DEMO|DEMO-FOOT)-->", page):
        fail("в шаблоне остались незаполненные маркеры — проверьте _templates/site/index.html")

    data_js = render_json_js(data)
    # Версия в ссылках на скрипты. GitHub Pages отдаёт файлы с Cache-Control max-age=600,
    # поэтому после обновления демо браузер до десяти минут показывает старый JS —
    # и страница выглядит «как до правки». С ?v=<хеш> адрес меняется вместе с кодом.
    digest = hashlib.sha1(
        (out / "app.js").read_bytes() + (out / "config.js").read_bytes() + data_js.encode("utf-8")
    ).hexdigest()[:10]
    for name in ("data.js", "config.js", "app.js"):
        page = page.replace('<script src="%s"></script>' % name,
                            '<script src="%s?v=%s"></script>' % (name, digest), 1)
    page = page.replace('<link rel="stylesheet" href="fonts.css">',
                        '<link rel="stylesheet" href="fonts.css?v=%s">' % digest, 1)

    (out / "index.html").write_text(page, encoding="utf-8", newline="\n")
    (out / "data.js").write_text(data_js, encoding="utf-8", newline="\n")
    # тесты в публикуемом сайте не нужны
    for junk in ("config.test.js", "app.test.js"):
        (out / junk).unlink(missing_ok=True)
    return out


# ---------------------------------------------------------------- шаблон салона
# Второй шаблон — для салонов красоты. Он не подставляет данные в разметку:
# сборщик копирует папку целиком и перезаписывает config.js, из которого
# js/main.js рисует страницу. Поэтому контракт clients/<slug>.json не меняется,
# а внутри просто появляется поле "template": "beauty".
BEAUTY_TEMPLATE = TEMPLATES / "beauty"

_OSM_DAYS = ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")
_DAYS_RU = {"Mo": "пн", "Tu": "вт", "We": "ср", "Th": "чт", "Fr": "пт", "Sa": "сб", "Su": "вс"}
_HOURS_RE = re.compile(r"^\s*([A-Za-z,\-]*)\s*(\d{1,2}:\d{2})\s*[-\u2013]\s*(\d{1,2}:\d{2})\s*$")


def _days_from_token(token: str) -> set:
    days: set = set()
    for chunk in str(token or "").split(","):
        chunk = chunk.strip()
        if not chunk or chunk.upper() == "PH":
            continue
        if "-" in chunk:
            first_raw, _, last_raw = chunk.partition("-")
            first = first_raw.strip().capitalize()
            last = last_raw.strip().capitalize()
            if first in _OSM_DAYS and last in _OSM_DAYS:
                start, stop = _OSM_DAYS.index(first), _OSM_DAYS.index(last)
                if start <= stop:
                    days.update(_OSM_DAYS[start:stop + 1])
        else:
            day = chunk.capitalize()
            if day in _OSM_DAYS:
                days.add(day)
    return days


def _days_ru(days: set) -> str:
    if not days:
        return ""
    if days == set(_OSM_DAYS):
        return "ежедневно"
    order = [day for day in _OSM_DAYS if day in days]
    parts: list = []
    index = 0
    while index < len(order):
        last = index
        while (last + 1 < len(order)
               and _OSM_DAYS.index(order[last + 1]) == _OSM_DAYS.index(order[last]) + 1):
            last += 1
        if last - index >= 2:
            parts.append(_DAYS_RU[order[index]] + "\u2013" + _DAYS_RU[order[last]])
        else:
            parts.extend(_DAYS_RU[day] for day in order[index:last + 1])
        index = last + 1
    return ", ".join(parts)


def hours_ru(raw: object) -> str:
    """'Mo-Su 10:00-21:00' -> 'ежедневно 10:00-21:00' (с длинным тире).

    OSM хранит часы машинным синтаксисом, клиенту такое показывать нельзя.
    Незнакомый формат возвращаем как есть: соврать про график хуже, чем
    показать исходную строку.
    """
    text = str(raw or "").strip()
    if not text:
        return ""
    parts: list = []
    for chunk in text.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if chunk.lower() in ("24/7", "24/7 open"):
            parts.append("круглосуточно")
            continue
        match = _HOURS_RE.match(chunk)
        if not match:
            parts.append(chunk)
            continue
        token, start, end = match.group(1), match.group(2), match.group(3)
        label = _days_ru(_days_from_token(token)) if token else "ежедневно"
        parts.append(("%s %s\u2013%s" % (label, start, end)).strip())
    return ", ".join(parts)


def _as_float(value: object) -> float:
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def _as_int(value: object) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return 0


def beauty_seo(data: dict) -> dict:
    name = str(data.get("name") or "").strip() or "Салон красоты"
    district = str(data.get("district") or "").strip()
    where = ", " + district if district else ""
    return {
        "title": "%s — салон красоты%s" % (name, where),
        "description": "%s — салон красоты%s. Запись по телефону." % (name, where),
        "locale": "ru_RU",
        "ogImage": "assets/og-image.jpg",
    }


def render_beauty_config(slug: str, data: dict) -> str:
    """config.js для шаблона салона: только реальные данные лида.

    Цены, мастера, отзывы и «о салоне» не выдумываются: без данных шаблон сам
    прячет эти секции. Выдуманный прайс в демо — это обещание клиенту, которого
    он не давал.
    """
    name = str(data.get("name") or slug).strip()
    phone = str(data.get("phone") or "").strip()
    address = str(data.get("address") or "").strip()
    district = str(data.get("district") or "").strip()
    hours = hours_ru(data.get("hours"))
    live = bool(data.get("live"))

    # В OSM город часто записан и в отдельном теге, и внутри адреса
    # («Москва, ул. Свободы»). Без этой проверки в демо получается
    # «Москва, ул. Свободы, 61, Москва».
    district_extra = ""
    if district and district.lower() not in address.lower():
        district_extra = district

    contacts: dict = {"phone": phone}
    email = str(data.get("email") or "").strip()
    if email and "@" in email:
        contacts["email"] = email
    if address:
        contacts["address"] = address
    if district:
        contacts["district"] = district
    if hours:
        contacts["workingHours"] = hours
    if address:
        # Ссылка на поиск по адресу, а не на точку организации: координат
        # в карточке может не быть, а придумывать чужую метку нельзя.
        text = address + (", " + district_extra if district_extra else "")
        contacts["mapUrl"] = "https://yandex.ru/maps/?text=" + quote(text)

    hero: dict = {"title": name, "cta": "Записаться", "image": "assets/hero.jpg"}
    if district_extra and address:
        hero["eyebrow"] = district_extra + " · " + address
    elif address:
        hero["eyebrow"] = address
    facts: list = []
    rating = _as_float(data.get("rating"))
    if rating > 0:
        facts.append({"value": ("%.1f" % rating).replace(".", ","), "label": "рейтинг"})
    reviews = _as_int(data.get("reviews_count"))
    if reviews > 0:
        # 25202 без разрядов читается как опечатка; неразрывный пробел
        # в шаблоне выглядит как обычный.
        facts.append({"value": "{:,}".format(reviews).replace(",", " "), "label": "отзывов"})
    if facts:
        hero["facts"] = facts

    social: dict = {}
    telegram = str(data.get("telegram") or "").strip()
    if telegram.startswith(("http://", "https://")):
        social["telegram"] = telegram
    elif telegram.startswith("@"):
        social["telegram"] = telegram

    config = {
        "name": name,
        "logo": {"text": name},
        "hero": hero,
        "form": {"demo": True, "endpoint": "", "method": "POST"},
        "contacts": contacts,
        "social": social,
        "seo": beauty_seo(data),
        "footer": {
            "legal": "" if live else
            "Демо-макет: страница не для поиска, фотографии — пример оформления"
        },
    }
    head = (
        "/* config.js — данные клиента. Файл собран new_demo.py из clients/%s.json\n"
        "   и при следующей сборке будет перезаписан. Правьте JSON, а не этот файл. */\n"
    ) % slug
    return head + "window.SITE_CONFIG = " + json.dumps(
        config, ensure_ascii=False, indent=2
    ).replace("</", "<\\/") + ";\n"


BEAUTY_NOTE_CSS = """
  /* плашка «демо»: добавлена сборщиком, в самом шаблоне её нет */
  .demo-note{position:fixed;left:14px;bottom:14px;z-index:120;display:inline-flex;
    gap:8px;align-items:center;max-width:calc(100vw - 28px);padding:8px 14px;
    border-radius:999px;background:rgba(26,22,19,.86);color:#F6F2EC;
    font:12px/1.35 Inter,Arial,sans-serif;letter-spacing:.01em;
    box-shadow:0 8px 28px rgba(0,0,0,.32);pointer-events:none;
    -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
  .demo-note b{font-weight:600;font-size:10px;letter-spacing:.14em;
    text-transform:uppercase;color:#D8B98A}
  @media(max-width:900px){.demo-note{bottom:78px}}
"""


def build_beauty(slug: str, out_root: Path, data: dict) -> Path:
    """Сборка демо салона красоты по _templates/beauty."""
    if not BEAUTY_TEMPLATE.exists():
        fail("нет шаблона салона: %s" % BEAUTY_TEMPLATE)
    out = out_root / slug
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(BEAUTY_TEMPLATE, out)

    page = (out / "index.html").read_text(encoding="utf-8")

    head: list = []
    if data.get("noindex", True):
        head.append(NOINDEX)
    head.append("<!-- %s | собрано new_demo.py -->" % esc(slug))
    head.append("<style>%s</style>" % BEAUTY_NOTE_CSS)
    page = page.replace(
        '<meta name="format-detection" content="telephone=no">',
        '<meta name="format-detection" content="telephone=no">\n  ' + "\n  ".join(head),
        1,
    )

    if not data.get("live"):
        page = page.replace(
            "<body>",
            '<body>\n  <div class="demo-note" role="note"><b>Демо</b>'
            "<span>так мог бы выглядеть ваш сайт · в поиске не появится</span></div>",
            1,
        )

    # title и description дублируем в статику: до отрисовки JS и в превью
    # мессенджеров страница должна называться именем клиента, а не «Салон красоты».
    seo = beauty_seo(data)
    page = page.replace("<title>Салон красоты</title>", "<title>%s</title>" % esc(seo["title"]), 1)
    page = page.replace(
        '<meta name="description" id="meta-description" content="">',
        '<meta name="description" id="meta-description" content="%s">' % esc(seo["description"]),
        1,
    )
    page = page.replace(
        '<meta property="og:title" id="og-title" content="">',
        '<meta property="og:title" id="og-title" content="%s">' % esc(seo["title"]),
        1,
    )

    config_js = render_beauty_config(slug, data)
    (out / "config.js").write_text(config_js, encoding="utf-8", newline="\n")

    # ?v=<хеш> на config.js, main.js и style.css: GitHub Pages кэширует файлы
    # на 10 минут, без этого обновлённое демо открывается старым.
    digest = hashlib.sha1(
        config_js.encode("utf-8")
        + (out / "js" / "main.js").read_bytes()
        + (out / "style.css").read_bytes()
    ).hexdigest()[:10]
    page = page.replace('<script src="config.js"></script>',
                        '<script src="config.js?v=%s"></script>' % digest, 1)
    page = page.replace('<script src="js/main.js"></script>',
                        '<script src="js/main.js?v=%s"></script>' % digest, 1)
    page = page.replace('<link rel="stylesheet" href="style.css">',
                        '<link rel="stylesheet" href="style.css?v=%s">' % digest, 1)

    (out / "index.html").write_text(page, encoding="utf-8", newline="\n")
    # README шаблона в публикуемом сайте не нужен
    (out / "README.md").unlink(missing_ok=True)
    return out


# ---------------------------------------------------------------- публикация
def git(*args: str, cwd: Path = ROOT, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(["git", *args], cwd=str(cwd), text=True, capture_output=True)
    if check and result.returncode != 0:
        fail("git %s\n%s\n%s" % (" ".join(args), result.stdout.strip(), result.stderr.strip()))
    return result


def publish_branch(slug: str, dry_run: bool = False) -> None:
    """Схема «а»: собрать, закоммитить и запушить. Дальше GitHub Pages собирает сам.

    Два режима, определяются по наличию .github/workflows/pages.yml:
      • Actions  — в git лежит только clients/<slug>.json, сайт собирает workflow;
      • branch   — в git лежит готовая папка docs/<slug>/.
    """
    via_actions = WORKFLOW.exists()
    built = build(slug, DIST)
    if via_actions:
        target = None
        print("режим GitHub Actions: собираю локально для проверки, в git поедет только clients/%s.json" % slug)
    else:
        target = SITE_DIR / slug
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(built, target)
        (SITE_DIR / ".nojekyll").write_text("", encoding="utf-8")

    if dry_run:
        print("dry-run: собрано в %s, публикация пропущена" % built)
        return

    if via_actions:
        git("add", "--", "clients/%s.json" % slug)
    else:
        git("add", "-A", "--", "docs")
    if not git("diff", "--cached", "--name-only").stdout.strip():
        print("нечего коммитить — сайт не изменился")
    else:
        git("commit", "-m", "demo: %s" % slug)
        git("push", "origin", "HEAD")
    if not via_actions:
        build_index()
    print("готово. Через 1–2 минуты: %s" % site_url(slug))


def site_url(slug: str) -> str:
    url = git("remote", "get-url", "origin").stdout.strip()
    m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", url)
    if not m:
        return "https://<логин>.github.io/<репозиторий>/%s/" % slug
    user, repo = m.group(1), m.group(2)
    if repo.lower() == user.lower() + ".github.io":
        return "https://%s.github.io/%s/" % (user, slug)
    return "https://%s.github.io/%s/%s/" % (user, repo, slug)


def publish_repo(slug: str, dry_run: bool = False) -> None:
    """Схема «б»: отдельный репозиторий + поддомен. Требует gh CLI и свой домен."""
    if not shutil.which("gh"):
        fail("нужен GitHub CLI: winget install --id GitHub.cli (Windows) или brew install gh (macOS)")
    data = load_client(slug)
    domain_root = str(data.get("domain") or "").strip()
    if not domain_root:
        fail("схема «б» требует поля domain в clients/%s.json, например \"domain\": \"example.ru\"" % slug)
    built = build(slug, DIST)
    repo = "demo-" + slug
    domain = "%s.%s" % (slug, domain_root)

    (built / "CNAME").write_text(domain + "\n", encoding="utf-8")
    (built / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")

    if dry_run:
        print("dry-run: собрано в %s, репозиторий не создаётся" % built)
        return

    if not (built / ".git").exists():
        subprocess.run(["git", "init", "-b", "main"], cwd=str(built), check=True,
                       stdout=subprocess.DEVNULL)
    subprocess.run(["git", "-C", str(built), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(built), "commit", "-m", "demo: %s" % slug],
                   check=False, stdout=subprocess.DEVNULL)

    subprocess.run(["gh", "repo", "create", repo, "--public", "--source", str(built),
                    "--remote", "origin", "--push"], check=True)
    subprocess.run(["gh", "api", "-X", "POST", "repos/{owner}/%s/pages" % repo,
                    "-f", "build_type=legacy",
                    "-f", "source[branch]=main", "-f", "source[path]=/",
                    "-f", "cname=" + domain], check=True)
    print("Репозиторий создан. Добавьте DNS-запись:")
    print("  CNAME  %s  ->  %s.github.io" % (slug, git_owner()))
    print("Дальше: Settings -> Pages -> Enforce HTTPS, и верификация домена в настройках аккаунта.")


def git_owner() -> str:
    url = git("remote", "get-url", "origin").stdout.strip()
    m = re.search(r"github\.com[:/]([^/]+)/", url)
    return m.group(1) if m else "<логин>"


LANDING = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Демо-сайты</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:,">
<style>
  :root{color-scheme:dark}
  body{margin:0;padding:48px 24px;background:#15161A;color:#ECEDEB;
       font:16px/1.5 "Segoe UI",Arial,sans-serif}
  .wrap{max-width:680px;margin:0 auto}
  h1{font-size:26px;margin:0 0 6px}
  p.lead{color:#B7BAC0;margin:0 0 28px}
  ul{list-style:none;padding:0;margin:0}
  li{border-top:1px solid #2E3138;padding:14px 0;display:flex;
     justify-content:space-between;gap:16px;align-items:baseline}
  li:last-child{border-bottom:1px solid #2E3138}
  a{color:#FF6A2B;text-decoration:none}
  a:hover{text-decoration:underline}
  code{color:#82868F;font-size:13px}
  footer{margin-top:28px;color:#82868F;font-size:13px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Демо-сайты</h1>
  <p class="lead">Черновики для показа клиентам. Не для поиска: noindex на каждой странице.</p>
  <ul>
%s
  </ul>
  <footer>Собрано new_demo.py. Удалить демо: python new_demo.py delete &lt;slug&gt; --yes</footer>
</div>
</body>
</html>
"""


def build_index(target: Path = SITE_DIR, dry_run: bool = False) -> None:
    """Пишет index.html со списком собранных демо в target."""
    items = []
    for path in sorted(CLIENTS.glob("*.json")):
        slug = path.stem
        if not (target / slug / "index.html").exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            continue
        name = data.get("name") or slug
        where = ", ".join(filter(None, (data.get("district"), data.get("address"))))
        items.append('    <li><span><a href="%s/">%s</a><br><code>%s</code></span></li>'
                     % (esc(slug), esc(name), esc(where or slug)))
    if not items:
        items = ['    <li><span><code>пока пусто</code></span></li>']
    target.mkdir(parents=True, exist_ok=True)
    (target / "index.html").write_text(LANDING % "\n".join(items), encoding="utf-8", newline="\n")
    print("%s обновлён: %d демо" % ((target / "index.html").relative_to(ROOT), len(items)))
    if dry_run or target != SITE_DIR:
        return
    # в режиме GitHub Actions docs/ не публикуется — коммитить нечего
    if not WORKFLOW.exists():
        git("add", "-A", "--", "docs/index.html")
        if git("diff", "--cached", "--name-only").stdout.strip():
            git("commit", "-m", "demo: обновить список демо")
            git("push", "origin", "HEAD")


def delete(slug: str, confirm: bool, per_repo: bool) -> None:
    if not confirm:
        fail("удаление необратимо: добавьте --yes, если уверены")
    removed = False
    for base in (SITE_DIR / slug, DIST / slug):
        if base.exists():
            shutil.rmtree(base)
            removed = True
            print("удалено: %s" % base.relative_to(ROOT))
    # в режиме Actions сайта в git нет — удалять надо сам JSON, иначе CI соберёт его снова
    source = CLIENTS / (slug + ".json")
    if source.exists():
        source.unlink()
        removed = True
        print("удалено: %s" % source.relative_to(ROOT))
    if removed:
        git("add", "-A", "--", "docs", "clients", check=False)
        if git("diff", "--cached", "--name-only").stdout.strip():
            git("commit", "-m", "demo: удалить %s" % slug, check=False)
            git("push", "origin", "HEAD", check=False)
            print("демо %s удалено из репозитория. История коммитов его ещё помнит: "
                  "если данные чувствительные — чистите историю (см. README)." % slug)
        else:
            print("локальные файлы удалены; в git нечего коммитить")
        if not WORKFLOW.exists():
            build_index(dry_run=False)
    if not removed:
        print("нечего удалять: clients/%s.json, docs/%s и dist/%s не найдены" % (slug, slug, slug))
    if per_repo:
        print("Отдельный репозиторий удаляется вручную: gh repo delete %s/demo-%s --yes" % (git_owner(), slug))


def new_client(slug: str) -> None:
    """Создать заготовку clients/<slug>.json, чтобы не копировать вручную."""
    if not SLUG_RE.match(slug):
        fail("slug должен быть латиницей в нижнем регистре: a-z, 0-9, дефис (2-41 символ).")
    path = CLIENTS / (slug + ".json")
    if path.exists():
        fail("файл уже есть: %s" % path.relative_to(ROOT))
    CLIENTS.mkdir(parents=True, exist_ok=True)
    skeleton = {
        "slug": slug,
        "name": "",
        # "beauty" — сайт салона красоты, "" — сайт мастерской
        "template": "",
        "district": "",
        "address": "",
        "phone": "",
        "hours": "",
        "noindex": True,
        "form_endpoint": "",
        "days": [1, 2, 3, 4, 5, 6],
        "slots": ["9:00", "10:00", "11:00", "12:00", "13:00",
                  "14:00", "15:00", "16:00", "17:00", "18:00"],
        # пустые списки: сборка подставит нейтральные цены и вымышленные отзывы,
        # а вы замените их на реальные с карточки клиента
        "prices": [],
        "reviews": [],
    }
    path.write_text(json.dumps(skeleton, ensure_ascii=False, indent=2) + chr(10),
                      encoding="utf-8", newline=chr(10))
    print("создан: %s" % path.relative_to(ROOT))
    print("заполните name, phone, district, address, hours и prices — и запустите:")
    print("  python new_demo.py publish %s" % slug)
    print('для салона красоты добавьте "template": "beauty" и запустите build заново')


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="Сборка и публикация демо-сайтов на GitHub Pages")
    parser.add_argument("command", choices=["new", "build", "publish", "delete", "list", "index", "build-all"])
    parser.add_argument("slug", nargs="?")
    parser.add_argument("--per-repo", action="store_true", help="схема «б»: отдельный репозиторий на клиента")
    parser.add_argument("--dry-run", action="store_true", help="собрать, но не публиковать")
    parser.add_argument("--yes", action="store_true", help="подтвердить удаление")
    args = parser.parse_args(argv)

    if args.command == "list":
        for path in sorted(CLIENTS.glob("*.json")):
            built = "собран" if (DIST / path.stem).exists() else "не собран"
            print("%-24s %s" % (path.stem, built))
        return 0
    if args.command == "index":
        build_index(SITE_DIR, args.dry_run)
        return 0
    if args.command == "build-all":
        # для GitHub Actions: собрать всё в dist/ и уложить туда же index.html
        if DIST.exists():
            shutil.rmtree(DIST)
        DIST.mkdir(parents=True, exist_ok=True)
        broken = []
        for path in sorted(CLIENTS.glob("*.json")):
            try:
                build(path.stem, DIST)
                print("  собрано: %s" % path.stem)
            except SystemExit as exc:
                if exc.code:
                    # один битый клиент не должен скрывать ошибки в остальных
                    broken.append(path.stem)
                    print("  ПРОПУЩЕНО: %s (см. ошибку выше)" % path.stem)
        build_index(DIST, dry_run=True)
        if broken:
            fail("не собрались: %s. Остальные собраны, но деплой не пойдёт, "
                 "пока ошибка не исправлена." % ", ".join(broken))
        print("готово: %s" % DIST.relative_to(ROOT))
        return 0
    if not args.slug:
        parser.error("нужен slug клиента, например: build motor-plus")

    if args.command == "new":
        new_client(args.slug)
        return 0

    if args.command == "build":
        out = build(args.slug, DIST)
        print("собрано: %s" % out.relative_to(ROOT))
        print("открыть локально: start %s" % (out / "index.html").relative_to(ROOT))
    elif args.command == "publish":
        if args.per_repo:
            publish_repo(args.slug, args.dry_run)
        else:
            publish_branch(args.slug, args.dry_run)
    elif args.command == "delete":
        delete(args.slug, args.yes, args.per_repo)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
