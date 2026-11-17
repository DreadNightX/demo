/* config.js — подстановка данных клиента в шаблон.
   Данные приходят из data.js (window.DEMO_DATA), который генерирует new_demo.py.
   Если data.js нет — работают дефолты, страница не ломается. */
(function (global) {
  'use strict';

  /* Дефолты нужны, только если data.js не подключён (открыли шаблон напрямую).
     Для собранного сайта это неважно: данные всегда приходят из data.js.
     Намеренно нейтральные — чтобы имя вымышленного сервиса не уехало клиенту. */
  var DEFAULTS = {
    name: 'Название сервиса',
    district: 'вашем районе',
    address: 'адрес уточняется',
    phone: '+7 (000) 000-00-00',
    hours: 'часы работы уточняются'
  };

  var FIELDS = ['name', 'district', 'address', 'phone', 'hours'];

  function formatPhone(raw) {
    var digits = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '8') digits = '7' + digits.slice(1);
    if (digits.length === 10) digits = '7' + digits;
    return '+' + digits;
  }

  /* Мусорный телефон ломает tel:-ссылки, поэтому откатываемся на дефолт.
     Валидный результат: «+7» + 10 цифр = 12 символов. */
  function getConfig(data) {
    var src = data || {};
    var cfg = {};
    FIELDS.forEach(function (key) {
      var value = typeof src[key] === 'string' ? src[key].trim() : '';
      cfg[key] = value || DEFAULTS[key];
    });
    if (formatPhone(cfg.phone).length !== 12) cfg.phone = DEFAULTS.phone;
    if (cfg.district === DEFAULTS.district) cfg.district = 'вашем районе';
    return cfg;
  }

  function checkPhone(raw) {
    return String(raw || '').replace(/\D/g, '').length >= 10;
  }

  /* Раскладывает конфиг по узлам с data-field; tel: всегда из чистого номера. */
  function apply(document, cfg) {
    var tel = formatPhone(cfg.phone);
    var nodes = document.querySelectorAll('[data-field]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-field');
      if (!(key in cfg)) continue;
      el.textContent = cfg[key];
      if (key === 'phone' && el.tagName === 'A') el.href = 'tel:' + tel;
    }
    if (document.title.indexOf('{name}') !== -1 || document.title.indexOf('{district}') !== -1) {
      document.title = document.title
        .replace('{name}', cfg.name)
        .replace('{district}', cfg.district);
    }
    var meta = document.querySelector('meta[name="description"]');
    if (meta && meta.content.indexOf('{district}') !== -1) {
      meta.content = meta.content.replace('{district}', cfg.district);
    }
    return cfg;
  }

  var api = { DEFAULTS: DEFAULTS, FIELDS: FIELDS, formatPhone: formatPhone, getConfig: getConfig, checkPhone: checkPhone, apply: apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DemoConfig = api;
})(typeof window !== 'undefined' ? window : globalThis);
