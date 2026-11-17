const { test } = require('node:test');
const assert = require('node:assert');
const { getConfig, formatPhone, checkPhone, apply } = require('./config.js');

const DEFAULTS = {
  name: 'ГАРАЖ 12',
  district: 'Коптево',
  address: 'ул. Коптевская, 26',
  phone: '+7 (495) 120-45-67',
  hours: 'пн–сб 9:00–21:00',
};

test('без параметров возвращает дефолты', () => {
  assert.deepStrictEqual(getConfig(new URLSearchParams('')), DEFAULTS);
});

test('подставляет переданные значения поверх дефолтов', () => {
  const cfg = getConfig(new URLSearchParams('name=СМАЙТ&district=Химки&phone=89031234567'));
  assert.strictEqual(cfg.name, 'СМАЙТ');
  assert.strictEqual(cfg.district, 'Химки');
  assert.strictEqual(cfg.phone, '89031234567');
  assert.strictEqual(cfg.address, DEFAULTS.address);
  assert.strictEqual(cfg.hours, DEFAULTS.hours);
});

test('пустой параметр откатывается на дефолт', () => {
  const cfg = getConfig(new URLSearchParams('name='));
  assert.strictEqual(cfg.name, 'ГАРАЖ 12');
});

test('неизвестные параметры игнорируются', () => {
  const cfg = getConfig(new URLSearchParams('foo=bar&name=СМАЙТ'));
  assert.strictEqual(cfg.name, 'СМАЙТ');
  assert.deepStrictEqual(Object.keys(cfg).sort(), Object.keys(DEFAULTS).sort());
});

test('formatPhone оставляет только цифры и ведущий плюс', () => {
  assert.strictEqual(formatPhone('+7 (495) 120-45-67'), '+74951204567');
  assert.strictEqual(formatPhone('89031234567'), '+79031234567');
  assert.strictEqual(formatPhone('8 903 123-45-67 (вайбер)'), '+79031234567');
});

test('checkPhone: валидный телефон — не менее 10 цифр', () => {
  assert.strictEqual(checkPhone('+7 903 123-45-67'), true);
  assert.strictEqual(checkPhone('89031234567'), true);
  assert.strictEqual(checkPhone('8 (495) 120-45-67'), true);
});

/* Фейковый document: достаточно для apply() — узлы с data-field,
   title и meta[name="description"]. */
function makeDoc(nodes, title, desc) {
  var meta = desc === null ? null : { content: desc };
  return {
    title: title,
    querySelectorAll: function () { return nodes; },
    querySelector: function (sel) {
      return (meta && sel === 'meta[name="description"]') ? meta : null;
    }
  };
}

test('apply подставляет {name} и {district} в title и meta description', () => {
  const doc = makeDoc([], '{name} — автосервис в {district}', 'Автосервис в {district}: диагностика.');
  apply(doc, new URLSearchParams('name=СМАЙТ&district=Химки'));
  assert.strictEqual(doc.title, 'СМАЙТ — автосервис в Химки');
  assert.strictEqual(doc.querySelector('meta[name="description"]').content, 'Автосервис в Химки: диагностика.');
});

test('apply без meta description не падает', () => {
  const doc = makeDoc([], '{name} — автосервис в {district}', null);
  apply(doc, new URLSearchParams('name=СМАЙТ'));
  assert.strictEqual(doc.title, 'СМАЙТ — автосервис в Коптево');
});

test('мусорный телефон откатывается на дефолт, а не даёт tel:+', () => {
  const cfg = getConfig(new URLSearchParams('phone=автосервис'));
  assert.strictEqual(cfg.phone, DEFAULTS.phone);
});

test('слишком длинный телефон откатывается на дефолт', () => {
  const cfg = getConfig(new URLSearchParams('phone=+7903123456712345'));
  assert.strictEqual(cfg.phone, DEFAULTS.phone);
});
