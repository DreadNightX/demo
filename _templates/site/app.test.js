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
      attrs: {},
      getAttribute(name) { return this.attrs[name] || ''; },
      setAttribute(name, value) { this.attrs[name] = value; },
      removeAttribute(name) { delete this.attrs[name]; },
      focus() {}
    }, extra || {});
    els[id] = node;
    return node;
  }

  ['year', 'entry-ok', 'entry-err', 'f-phone', 'f-phone-err', 'f-name', 'f-car', 'f-issue', 'f-company']
    .forEach((id) => el(id));
  els['entry-btn'] = el('entry-btn', { disabled: false });

  const inserted = [];
  const form = el('entry-form', {
    attrs: { 'data-endpoint': opts.endpoint || '', 'data-slug': 'motor-plus' },
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
    createElement() { return { className: '', textContent: '' }; }
  };

  const fetched = [];
  const storage = {
    store: opts.storage || {},
    getItem(k) { return this.store[k] === undefined ? null : String(this.store[k]); },
    setItem(k, v) { this.store[k] = v; }
  };

  return { document, form, callbar, els, listeners, fetched, storage, inserted };
}

function boot(env, data, fetchImpl) {
  for (const key of ['./app.js', './config.js']) delete require.cache[require.resolve(key)];
  global.window = global;
  global.document = env.document;
  global.localStorage = env.storage;
  global.DEMO_DATA = data;
  global.fetch = fetchImpl || function (url, init) {
    env.fetched.push({ url, init });
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

test('без endpoint форма скрывается, телефон остаётся', () => {
  const env = makeEnv({ endpoint: '' });
  boot(env, DATA);
  assert.strictEqual(env.form.hidden, true);
  assert.strictEqual(env.inserted.length, 1);
  assert.match(env.inserted[0].textContent, /\+7 \(495\) 123-45-67/);
});

test('валидная заявка уходит POST-ом с JSON', async () => {
  const env = makeEnv({ endpoint: 'https://fn.example/lead' });
  boot(env, DATA);
  env.els['f-phone'].value = '8 903 123-45-67';
  env.els['f-name'].value = 'Иван';
  env.listeners.submit({ preventDefault() {} });
  const call = env.fetched[0];
  assert.strictEqual(call.url, 'https://fn.example/lead');
  assert.strictEqual(call.init.method, 'POST');
  const payload = JSON.parse(call.init.body);
  assert.strictEqual(payload.phone, '8 903 123-45-67');
  assert.strictEqual(payload.name, 'Иван');
  assert.strictEqual(payload.slug, 'motor-plus');
  assert.strictEqual(payload.company, '');
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(env.els['entry-ok'].hidden, false);
});

test('короткий телефон не отправляется', () => {
  const env = makeEnv({ endpoint: 'https://fn.example/lead' });
  boot(env, DATA);
  env.els['f-phone'].value = '123';
  env.listeners.submit({ preventDefault() {} });
  assert.strictEqual(env.fetched.length, 0);
  assert.strictEqual(env.els['f-phone-err'].hidden, false);
});

test('повторная отправка в течение минуты блокируется', () => {
  const env = makeEnv({ endpoint: 'https://fn.example/lead', storage: { 'demo:last': Date.now() } });
  boot(env, DATA);
  env.els['f-phone'].value = '+79031234567';
  env.listeners.submit({ preventDefault() {} });
  assert.strictEqual(env.fetched.length, 0);
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
