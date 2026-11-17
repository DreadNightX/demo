/* Конфигурация шаблона: подстановка данных мастерской.
   Данные приходят из URL-параметров (?name=&district=&address=&phone=&hours=),
   отсутствующие и пустые заменяются дефолтами. */
(function (global) {
  'use strict';

  var DEFAULTS = {
    name: 'ГАРАЖ 12',
    district: 'Коптево',
    address: 'ул. Коптевская, 26',
    phone: '+7 (495) 120-45-67',
    hours: 'пн–сб 9:00–21:00'
  };

  var FIELDS = ['name', 'district', 'address', 'phone', 'hours'];

  function formatPhone(raw) {
    var digits = String(raw).replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '8') digits = '7' + digits.slice(1);
    if (digits.length === 10) digits = '7' + digits;
    return '+' + digits;
  }

  function getConfig(params) {
    var cfg = {};
    FIELDS.forEach(function (key) {
      var value = (params.get(key) || '').trim();
      cfg[key] = value || DEFAULTS[key];
    });
    /* Мусорный или нестандартный телефон ломает tel:-ссылки (tel:+) —
       откатываемся на дефолт. Валидная нормализация — «+7» + 10 цифр. */
    if (formatPhone(cfg.phone).length !== 12) cfg.phone = DEFAULTS.phone;
    return cfg;
  }

  /* Телефон в форме валиден, если в строке не меньше 10 цифр. */
  function checkPhone(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    return digits.length >= 10;
  }

  /* Раскладывает конфиг по узлам с data-field.
     tel: ссылка всегда из «чистого» телефона. */
  function apply(document, params) {
    var cfg = getConfig(params);
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
    if (meta && (meta.content.indexOf('{name}') !== -1 || meta.content.indexOf('{district}') !== -1)) {
      meta.content = meta.content
        .replace('{name}', cfg.name)
        .replace('{district}', cfg.district);
    }
    return cfg;
  }

  var api = { DEFAULTS: DEFAULTS, formatPhone: formatPhone, getConfig: getConfig, checkPhone: checkPhone, apply: apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.AvsConfig = api;
})(typeof window !== 'undefined' ? window : globalThis);
