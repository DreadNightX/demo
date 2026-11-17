const { test } = require('node:test');
const assert = require('node:assert');
const { getConfig, formatPhone, checkPhone, apply, DEFAULTS } = require('./config.js');

test('без данных (data.js не собрался) возвращает дефолты', () => {
  assert.deepStrictEqual(getConfig(null), DEFAULTS);
  assert.deepStrictEqual(getConfig(undefined), DEFAULTS);
});

test('подставляет поля клиента', () => {
  const cfg = getConfig({ name: 'СМАЙТ', district: 'Химки', phone: '89031234567' });
  assert.strictEqual(cfg.name, 'СМАЙТ');
  assert.strictEqual(cfg.district, 'Химки');
  assert.strictEqual(cfg.phone, '89031234567');
  assert.strictEqual(cfg.address, DEFAULTS.address);
});

test('пустая строка и пробелы откатываются на дефолт', () => {
  assert.strictEqual(getConfig({ name: '   ' }).name, DEFAULTS.name);
});

test('мусорный телефон откатывается на дефолт, tel: не ломается', () => {
  assert.strictEqual(getConfig({ phone: 'автосервис' }).phone, DEFAULTS.phone);
  assert.strictEqual(getConfig({ phone: '+7903123456712345' }).phone, DEFAULTS.phone);
  assert.strictEqual(formatPhone(getConfig({ phone: '8 903 123-45-67' }).phone), '+79031234567');
});

test('formatPhone приводит 8 и 10 цифр к +7', () => {
  assert.strictEqual(formatPhone('+7 (495) 120-45-67'), '+74951204567');
  assert.strictEqual(formatPhone('89031234567'), '+79031234567');
  assert.strictEqual(formatPhone('4951204567'), '+74951204567');
});

test('checkPhone требует минимум 10 цифр', () => {
  assert.strictEqual(checkPhone('+7 903 123-45-67'), true);
  assert.strictEqual(checkPhone('12345'), false);
});

/* Фейковый document: узлы с data-field, title и meta description. */
function makeDoc(nodes, title, desc) {
  const meta = desc === null ? null : { content: desc };
  return {
    title: title,
    querySelectorAll: () => nodes,
    querySelector: (sel) => (meta && sel === 'meta[name="description"]' ? meta : null)
  };
}

test('apply подставляет данные в узлы, title и tel:-ссылку', () => {
  const link = { tagName: 'A', textContent: '', href: '', getAttribute: () => 'phone' };
  const nameNode = { tagName: 'B', textContent: '', getAttribute: () => 'name' };
  const doc = makeDoc([link, nameNode], '{name} — автосервис в {district}', 'Автосервис в {district}');
  apply(doc, getConfig({ name: 'СМАЙТ', district: 'Химки', phone: '89031234567' }));
  assert.strictEqual(doc.title, 'СМАЙТ — автосервис в Химки');
  assert.strictEqual(doc.querySelector('meta[name="description"]').content, 'Автосервис в Химки');
  assert.strictEqual(link.textContent, '89031234567');
  assert.strictEqual(link.href, 'tel:+79031234567');
  assert.strictEqual(nameNode.textContent, 'СМАЙТ');
});
