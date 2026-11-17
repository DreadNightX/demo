/* app.js — оживляет шаблон: телефон, год, запись (дата/время) и отправка формы. */
(function () {
  'use strict';

  var cfg = DemoConfig.apply(document, DemoConfig.getConfig(window.DEMO_DATA));

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  var callbar = document.querySelector('.callbar');
  if (callbar) callbar.href = 'tel:' + DemoConfig.formatPhone(cfg.phone);

  var DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var DEFAULT_SLOTS = ['9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isoDay(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* «пн, 18 ноя» — так дату читают, не сверяясь с календарём */
  function humanDay(d, offset) {
    var label = DAY_NAMES[d.getDay()] + ', ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
    if (offset === 0) return label + ' (сегодня)';
    if (offset === 1) return label + ' (завтра)';
    return label;
  }

  function minutes(hhmm) {
    var parts = String(hhmm).split(':');
    return Number(parts[0]) * 60 + Number(parts[1] || 0);
  }

  /* Рабочие дни: числа 1..7 (пн..вс). Пусто/мусор — считаем, что работают всегда. */
  function openDays(form) {
    var raw = (form.getAttribute('data-days') || '').split(',');
    var days = [];
    for (var i = 0; i < raw.length; i++) {
      var n = Number(raw[i]);
      if (n >= 1 && n <= 7) days.push(n);
    }
    return days.length ? days : [1, 2, 3, 4, 5, 6, 7];
  }

  function slotsOf(form) {
    var raw = (form.getAttribute('data-slots') || '').split(',');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i].trim();
      if (/^\d{1,2}:\d{2}$/.test(s)) out.push(s);
    }
    return out.length ? out : DEFAULT_SLOTS.slice();
  }

  function fillSelect(select, items) {
    select.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var opt = document.createElement('option');
      opt.value = items[i].value;
      opt.textContent = items[i].text;
      select.appendChild(opt);
    }
    if (items.length) select.value = items[0].value;
  }

  var form = document.getElementById('entry-form');
  if (!form) return;

  var endpoint = (form.getAttribute('data-endpoint') || '').trim();
  var btn = document.getElementById('entry-btn');
  var ok = document.getElementById('entry-ok');
  var errBox = document.getElementById('entry-err');
  var dateSel = document.getElementById('f-date');
  var timeSel = document.getElementById('f-time');
  var serviceSel = document.getElementById('f-service');
  var consent = document.getElementById('f-consent');

  /* Дни и часы строим на месте: дата, зашитая при сборке, через неделю была бы в прошлом. */
  var chosen = [];
  if (dateSel) {
    var days = openDays(form);
    var now = new Date();
    for (var i = 0; i < 14; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12, 0, 0, 0);
      var iso = d.getDay() === 0 ? 7 : d.getDay();
      if (days.indexOf(iso) === -1) continue;
      chosen.push({ value: isoDay(d), text: humanDay(d, i), date: d, offset: i });
    }
    fillSelect(dateSel, chosen.length ? chosen : [{ value: isoDay(now), text: humanDay(now, 0) }]);
  }

  function refreshSlots() {
    if (!timeSel) return;
    var all = slotsOf(form);
    var picked = chosen.filter(function (c) { return c.value === dateSel.value; })[0];
    var list = all;
    if (picked && picked.offset === 0) {
      /* сегодня прошедшие часы не предлагаем: запись «на 10:00», когда сейчас 15:00, — брак */
      var nowMin = new Date().getHours() * 60 + new Date().getMinutes() + 60;
      list = all.filter(function (s) { return minutes(s) > nowMin; });
      if (!list.length) list = all.slice(0, 1);
    }
    fillSelect(timeSel, list.map(function (s) { return { value: s, text: s }; }));
  }

  if (dateSel && timeSel) {
    dateSel.addEventListener('change', refreshSlots);
    refreshSlots();
  }

  function showError(text) {
    errBox.textContent = text;
    errBox.hidden = false;
  }

  /* Серверной функции нет — форму всё равно показываем: это демо, и человек
     должен видеть, как запись выглядит. Но честно говорим, что заявка не ушла. */
  var offline = !endpoint;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var phone = document.getElementById('f-phone');
    var phoneErr = document.getElementById('f-phone-err');

    if (!DemoConfig.checkPhone(phone.value)) {
      phone.setAttribute('aria-invalid', 'true');
      phoneErr.hidden = false;
      phoneErr.textContent = 'Нужен телефон — минимум 10 цифр, иначе мы не сможем перезвонить.';
      phone.focus();
      return;
    }
    phone.removeAttribute('aria-invalid');
    phoneErr.hidden = true;
    errBox.hidden = true;

    if (consent && !consent.checked) {
      showError('Поставьте галочку про обработку данных — без неё не сможем перезвонить.');
      consent.focus();
      return;
    }

    if (offline) {
      showError('Это демо: форма не подключена к приёму заявок, ничего не отправлено. Позвоните: ' + cfg.phone);
      return;
    }

    var last = Number(window.localStorage.getItem('demo:last') || 0);
    if (Date.now() - last < 60000) {
      showError('Заявка уже отправлена. Перезвоним в течение 15 минут.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Отправляем…';

    var when = '';
    if (dateSel && timeSel) {
      var label = '';
      for (var k = 0; k < dateSel.options.length; k++) {
        if (dateSel.options[k].value === dateSel.value) label = dateSel.options[k].textContent;
      }
      when = label + ', ' + timeSel.value;
    }

    var payload = {
      slug: form.getAttribute('data-slug') || location.pathname,
      phone: phone.value.trim(),
      name: (document.getElementById('f-name') || {}).value || '',
      car: (document.getElementById('f-car') || {}).value || '',
      issue: (document.getElementById('f-issue') || {}).value || '',
      service: serviceSel ? serviceSel.value : '',
      date: dateSel ? dateSel.value : '',
      time: timeSel ? timeSel.value : '',
      when: when,
      company: (document.getElementById('f-company') || {}).value || '',
      ref: document.referrer || ''
    };

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json().catch(function () { return {}; });
      })
      .then(function () {
        window.localStorage.setItem('demo:last', String(Date.now()));
        ok.hidden = false;
        if (when) ok.textContent = 'Записали на ' + when + '. Перезвоним в течение 15 минут.';
        btn.textContent = 'Записал';
        form.reset();
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Записаться';
        showError('Не получилось отправить. Позвоните: ' + cfg.phone);
      });
  });
})();
