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
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "_templates" / "site"
CLIENTS = ROOT / "clients"
DIST = ROOT / "dist"
SITE_DIR = ROOT / "docs"          # публикуемая папка: GitHub Pages из ветки умеет только / или /docs
WORKFLOW = ROOT / ".github" / "workflows" / "pages.yml"
NOINDEX = '<meta name="robots" content="noindex, nofollow">'

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")

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


def render_json_js(data: dict) -> str:
    """data.js: JSON внутри JS. «</» экранируем, чтобы данные не закрыли <script>."""
    payload = {k: v for k, v in data.items() if k in ("name", "district", "address", "phone", "hours")}
    raw = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    return "window.DEMO_DATA = %s;\n" % raw


def build(slug: str, out_root: Path, base_url: str = "") -> Path:
    data = load_client(slug)
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

    page = page.replace("<!--PRICES-->", render_prices(data.get("prices") or []))
    page = page.replace("<!--REVIEWS-->", render_reviews(data.get("reviews") or []))
    page = page.replace("<!--FAQ-->", render_faq(data.get("faq") or []))
    page = page.replace("<!--CREDIT-->", render_credit(data.get("credit") or {}))
    page = page.replace('data-endpoint=""', 'data-endpoint="%s"' % esc(safe_endpoint(data.get("form_endpoint"))))
    page = page.replace('id="entry-form" novalidate', 'id="entry-form" novalidate data-slug="%s"' % esc(slug))

    if re.search(r"<!--(HEAD|PRICES|REVIEWS|FAQ|CREDIT)-->", page):
        fail("в шаблоне остались незаполненные маркеры — проверьте _templates/site/index.html")

    (out / "index.html").write_text(page, encoding="utf-8", newline="\n")
    (out / "data.js").write_text(render_json_js(data), encoding="utf-8", newline="\n")
    # тесты в публикуемом сайте не нужны
    for junk in ("config.test.js", "app.test.js"):
        (out / junk).unlink(missing_ok=True)
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
    if removed:
        git("add", "-A", "--", "docs", check=False)
        if git("diff", "--cached", "--name-only").stdout.strip():
            git("commit", "-m", "demo: удалить %s" % slug, check=False)
            git("push", "origin", "HEAD", check=False)
            print("демо %s удалено из репозитория. История коммитов его ещё помнит: "
                  "если данные чувствительные — чистите историю (см. README)." % slug)
        else:
            print("локальные файлы удалены; в git нечего коммитить")
        build_index(dry_run=False)
    if not removed:
        print("нечего удалять: docs/%s и dist/%s не найдены" % (slug, slug))
    if per_repo:
        print("Отдельный репозиторий удаляется вручную: gh repo delete %s/demo-%s --yes" % (git_owner(), slug))


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="Сборка и публикация демо-сайтов на GitHub Pages")
    parser.add_argument("command", choices=["build", "publish", "delete", "list", "index", "build-all"])
    parser.add_argument("slug", nargs="?")
    parser.add_argument("--per-repo", action="store_true", help="схема «б»: отдельный репозиторий на клиента")
    parser.add_argument("--dry-run", action="store_true", help="собрать, но не публиковать")
    parser.add_argument("--yes", action="store_true", help="подтвердить удаление")
    args = parser.parse_args(argv)

    if args.command == "list":
        for path in sorted(CLIENTS.glob("*.json")):
            built = "собран" if (SITE_DIR / path.stem).exists() else "не собран"
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
        for path in sorted(CLIENTS.glob("*.json")):
            try:
                build(path.stem, DIST)
                print("  собрано: %s" % path.stem)
            except SystemExit as exc:
                if exc.code:
                    fail("клиент %s не собрался" % path.stem)
        build_index(DIST, dry_run=True)
        print("готово: %s" % DIST.relative_to(ROOT))
        return 0
    if not args.slug:
        parser.error("нужен slug клиента, например: build motor-plus")

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
