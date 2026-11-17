
"""Одна серверная функция: приём заявки с демо-сайта и пересылка в Telegram."""
import base64
import ipaddress
import json
import os
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque

TOKEN = os.environ["TG_BOT_TOKEN"]          # секрет функции, НЕ в браузере
CHAT_ID = os.environ["TG_CHAT_ID"]          # куда присылать заявки
ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")  # https://login.github.io
HOURLY_LIMIT = int(os.environ.get("HOURLY_LIMIT", "20"))

# Ограничение частоты: в памяти процесса. В serverless это «мягкий» лимит —
# инстанс может жить несколько минут и переиспользоваться, но не гарантированно.
# Для жёсткого лимита нужен Redis/БД или встроенный rate-limit платформы.
_hits: dict = defaultdict(deque)

# Если задан ALLOWED_ORIGIN, принимаем только запросы с этой страницы.
ALLOWED_HOST = ""
if ORIGIN not in ("", "*"):
    ALLOWED_HOST = ORIGIN.split("://", 1)[-1].rstrip("/")


def _client_ip(event: dict) -> str:
    headers = event.get("headers") or {}
    for key in ("X-Forwarded-For", "x-forwarded-for"):
        if key in headers:
            return headers[key].split(",")[0].strip()
    return (event.get("requestContext") or {}).get("identity", {}).get("sourceIp", "unknown")


def _too_many(ip: str) -> bool:
    # X-Forwarded-For подделывается клиентом. Если в нём не IP — кладём всех
    # в одну «корзину», иначе бот обходил бы лимит, меняя заголовок.
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        ip = "invalid"
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= HOURLY_LIMIT:
        return True
    q.append(now)
    return False


def _reply(status: int, payload: dict, origin: str) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(payload, ensure_ascii=False),
        "isBase64Encoded": False,
    }


def handler(event: dict, context) -> dict:
    method = (event.get("httpMethod") or "GET").upper()
    if method == "OPTIONS":
        return _reply(204, {}, ORIGIN)
    if method != "POST":
        return _reply(405, {"ok": False, "error": "method"}, ORIGIN)
    if _too_many(_client_ip(event)):
        return _reply(429, {"ok": False, "error": "too_many"}, ORIGIN)

    if ALLOWED_HOST:
        headers = event.get("headers") or {}
        referer = headers.get("Referer") or headers.get("referer") or ""
        if referer and ALLOWED_HOST not in referer:
            return _reply(403, {"ok": False, "error": "origin"}, ORIGIN)

    raw = event.get("body")
    raw = "{}" if raw in (None, "") else raw
    if not isinstance(raw, str):
        return _reply(400, {"ok": False, "error": "json"}, ORIGIN)
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        return _reply(400, {"ok": False, "error": "json"}, ORIGIN)
    if not isinstance(body, dict):
        return _reply(400, {"ok": False, "error": "json"}, ORIGIN)

    # honeypot: человек это поле не видит и не заполняет
    if str(body.get("company") or "").strip():
        return _reply(200, {"ok": True}, ORIGIN)   # боту отвечаем «успех», в Telegram не шлём

    phone = str(body.get("phone") or "").strip()[:32]
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 10:
        return _reply(400, {"ok": False, "error": "phone"}, ORIGIN)

    # Дату и время присылает браузер; на слово не верим — только печатаем как есть.
    when_label = str(body.get("when") or "").strip()[:80]
    if not when_label:
        when_label = (str(body.get("date") or "?") + ", " + str(body.get("time") or "?"))[:80]

    text = "\n".join([
        "🔧 Новая заявка с демо",
        "Сайт: " + str(body.get("slug") or "?")[:120],
        "Телефон: " + phone,
        "Имя: " + str(body.get("name") or "—")[:60],
        "Машина: " + str(body.get("car") or "—")[:60],
        "Услуга: " + str(body.get("service") or "—")[:80],
        "Когда: " + when_label,
        "Проблема: " + str(body.get("issue") or "—")[:400],
        "Откуда пришёл: " + str(body.get("ref") or "прямой заход")[:200],
    ])
    api = "https://api.telegram.org/bot%s/sendMessage" % TOKEN
    data = json.dumps({"chat_id": CHAT_ID, "text": text, "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(api, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            resp.read()
    except (urllib.error.URLError, TimeoutError):
        return _reply(502, {"ok": False, "error": "telegram"}, ORIGIN)
    return _reply(200, {"ok": True}, ORIGIN)
