const { test } = require('node:test');
const assert = require('node:assert');

/* Мини-DOM: ровно те методы, которые использует app.js.
   Гоняем app.js в Node, чтобы ловить ошибки без браузера. */
function makeEnv(opts) {
  opts = opts || {};
  const listeners = {};
  const nodes = [];
  const els = {};

  function el(id, extra) {
    const node = Object.assign({
      id: id,
      hidden: false,
      textContent: '',
      value: '',
      checked: true,
      attrs: {},
      getAttribute(name) { return this.attrs[name] === undefined ? '' : this.attrs[name]; },
      setAttribute(name, value) { this.attrs[name] = value; },
      removeAttribute(name) { delete this.attrs[name]; },
      focus() {}
    }, extra || {});
    els[id] = node;
    return node;
  }

  /* <select>: options + value, как в браузере — value по умолчанию берётся из первой опции */
  function select(id, extra) {
    const node = el(id, Object.assign({
      options: [],
      addEventListener(type, cb) { listeners['sel:' + id + ':' + type] = cb; },
      _value: '',
      set innerHTML(_) { this.options.length = 0; this._value = ''; },
      appendChild(opt) {
        this.options.push(opt);
        if (!this._value) this._value = opt.value;
      },
      get value() { return this._value; },
      set value(v) { this._value = v; }
    }, extra || {}));
    return node;
  }

  ['year', 'entry-ok', 'entry-err', 'f-phone', 'f-phone-err', 'f-name', 'f-car', 'f-issue', 'f-company']
    .forEach((id) => el(id));
  els['entry-ok'].hidden = true;
  els['entry-err'].hidden = true;
  els['entry-btn'] = el('entry-btn', { disabled: false });
  select('f-date');
  select('f-time');
  select('f-service');
  els['f-service'].value = 'Диагностика';
  els['f-consent'] = el('f-consent', { checked: opts.consent !== false });

  const inserted = [];
  const form = el('entry-form', {
    attrs: {
      'data-endpoint': opts.endpoint || '',
      'data-slug': 'motor-plus',
      'data-days': opts.days || '1,2,3,4,5,6',
      'data-slots': opts.slots || '9:00,10:00,11:00,12:00,13:00,14:00,15:00,16:00,17:00,18:00'
    },
    addEventListener(type, cb) { listeners[type] = cb; },
    reset() {},
    parentNode: { insertBefore(node) { inserted.push(node); } },
    nextSibling: null
  });

  const callbar = { href: '' };

  const document = {
    title: '{name} — автосервис в {district}',
    querySelectorAll() { return nodes; },
    querySelector(sel) {
      if (sel === '.callbar') return callbar;
      if (sel === 'meta[name="description"]') return { content: 'Автосервис в {district}' };
      return null;
    },
    getElementById(id) { return els[id] || null; },
    createElement(tag) { return { tagName: String(tag).toUpperCase(), className: '', textContent: '', value: '' }; }
  };

  return { document, form, callbar, els, listeners, storage: makeStorage(opts.storage), inserted };
}

function makeStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    store,
    getItem(k) { return store[k] === undefined ? null : String(store[k]); },
    setItem(k, v) { store[k] = v; }
  };
}

function boot(env, data, fetchImpl) {
  for (const key of ['./app.js', './config.js']) delete require.cache[require.resolve(key)];
  global.window = global;
  global.document = env.document;
  global.localStorage = env.storage;
  global.DEMO_DATA = data;
  global.fetch = fetchImpl || function (url, init) {
    (env.fetched = env.fetched || []).push({ url, init });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  };
  global.DemoConfig = require('./config.js');
  require('./app.js');
}

const DATA = { name: 'СМАЙТ', district: 'Химки', phone: '+7 (495) 123-45-67', hours: 'пн–сб 9:00–20:00', address: 'ул. Ленина, 1' };

test('подставляет данные клиента в разметку', () => {
  const env = makeEnv({});
  const node = { tagName: 'B', textContent: '', getAttribute: () => 'name' };
  env.document.querySelectorAll = () => [node];
  boot(env, DATA);
  assert.strictEqual(node.textContent, 'СМАЙТ');
  assert.strictEqual(env.document.title, 'СМАЙТ — автосервис в Химки');
});

test('без endpoint форма остаётся на месте', () => {
  const env = makeEnv({ endpoint: '' });
  boot(env, DATA);
  assert.ok(!env.form.hidden, 'форму нельзя скрывать: демо должно показывать запись');
  assert.strictEqual(env.inserted.length, 0);
  assert.ok(env.els['f-date'].options.length > 0, 'даты всё равно строятся');
});

test('без endpoint отправка честно предупреждает и никуда не идёт', () => {
  const env = makeEnv({ endpoint: '' });
  boot(env, DATA);
  env.els['f-phone'].value = '+79031234567';
  env.listeners.submit({ preventDefault() {} });
  assert.strictEqual((env.fetched || []).length, 0);
  assert.strictEqual(env.els['entry-err'].hidden, false);
  assert.match(env.els['entry-err'].textContent, /Это демо/);
  assert.match(env.els['entry-err'].textContent, /\+7 \(495\) 123-45-67/);
  assert.strictEqual(env.els['entry-btn'].disabled, false);
});

test('даты — только рабочие дни и все в будущем', () => {
  const env = makeEnv({ days: '1,2,3,4,5' });   // пн–пт
  boot(env, DATA);
  const opts = env.els['f-date'].options;
  assert.ok(opts.length >= 9 && opts.length <= 10, 'две недели минус выходные: ' + opts.length);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const o of opts) {
    const d = new Date(o.value + 'T12:00:00');
    assert.ok(d >= today, 'дата в прошлом: ' + o.value);
    assert.ok([1, 2, 3, 4, 5].includes(d.getDay()), 'выходной в списке: ' + o.value);
  }
  assert.match(opts[0].textContent, /сегодня|завтра/);
});

test('сегодня прошедшие часы не предлагаются', () => {
  const env = makeEnv({ slots: '9:00,10:00,11:00' });
  boot(env, DATA);
  const now = new Date();
  const todayOpt = env.els['f-date'].options[0];
  if (now.getHours() < 9) return;          // рано утром все слоты ещё впереди
  env.els['f-date'].value = todayOpt.value;
  env.listeners.change && env.listeners.change();
  const offered = env.els['f-time'].options.map((o) => o.value);
  assert.ok(offered.length >= 1);
  assert.ok(offered[0] !== '9:00' || now.getHours() >= 10, 'прошедший час предложен: ' + offered.join(','));
});

test('валидная заявка уходит POST-ом с JSON и временем', async () => {
  const env = makeEnv({ endpoint: 'https://fn.example/lead' });
  boot(env, DATA);
  env.els['f-phone'].value = '8 903 123-45-67';
  env.els['f-name'].value = 'Иван';
  env.els['f-time'].value = '11:00';
  env.listeners.submit({ preventDefault() {} });
  const call = env.fetched[0];
  assert.strictEqual(call.url, 'https://fn.example/lead');
  assert.strictEqual(call.init.method, 'POST');
  const payload = JSON.parse(call.init.body);
  assert.strictEqual(payload.phone, '8 903 123-45-67');
  assert.strictEqual(payload.name, 'Иван');
  assert.strictEqual(payload.slug, 'motor-plus');
  assert.strictEqual(payload.company, '');
  assert.strictEqual(payload.service, 'Диагностика');
  assert.strictEqual(payload.time, '11:00');
  assert.match(payload.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(payload.when, /, 11:00$/);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(env.els['entry-ok'].hidden, false);
  assert.match(env.els['entry-ok'].textContent, /Записали на/);
});

test('короткий телефон не отправляется', () => {
  const env = makeEnv({ endpoint: 'https://fn.example/lead' });
  boot(env, DATA);
  env.els['f-phone'].value = '123';
  env.listeners.submit({ preventDefault() {} });
  assert.strictEqual((env.fetched || []).length, 0);
  assert.strictEqual(env.els['f-phone-err'].hidden, false);
});

test('без согласия на обработку данных не отправляем', () => {
  const env = makeEnv({ endpoint: 'https://fn.example/lead', consent: false });
  boot(env, DATA);
  env.els['f-phone'].value = '+79031234567';
  env.listeners.submit({ preventDefault() {} });
  assert.strictEqual((env.fetched || []).length, 0);
  assert.match(env.els['entry-err'].textContent, /галочку/);
});

test('повторная отправка в течение минуты блокируется', () => {
  const env = makeEnv({ endpoint: 'https://fn.example/lead', storage: { 'demo:last': Date.now() } });
  boot(env, DATA);
  env.els['f-phone'].value = '+79031234567';
  env.listeners.submit({ preventDefault() {} });
  assert.strictEqual((env.fetched || []).length, 0);
  assert.strictEqual(env.els['entry-err'].hidden, false);
});

test('ошибка сети возвращает кнопку и показывает телефон', async () => {
  const env = makeEnv({ endpoint: 'https://fn.example/lead' });
  boot(env, DATA, () => Promise.reject(new Error('offline')));
  env.els['f-phone'].value = '+79031234567';
  env.listeners.submit({ preventDefault() {} });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(env.els['entry-btn'].disabled, false);
  assert.match(env.els['entry-err'].textContent, /Позвоните/);
});
