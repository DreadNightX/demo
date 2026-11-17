/* app.js — оживляет шаблон: телефон, год, отправка формы. */
(function () {
  'use strict';

  var cfg = DemoConfig.apply(document, DemoConfig.getConfig(window.DEMO_DATA));

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  var callbar = document.querySelector('.callbar');
  if (callbar) callbar.href = 'tel:' + DemoConfig.formatPhone(cfg.phone);

  var form = document.getElementById('entry-form');
  if (!form) return;

  var endpoint = (form.getAttribute('data-endpoint') || '').trim();
  var btn = document.getElementById('entry-btn');
  var ok = document.getElementById('entry-ok');
  var errBox = document.getElementById('entry-err');

  function showError(text) {
    errBox.textContent = text;
    errBox.hidden = false;
  }

  /* Нет серверной функции — форму не показываем, но телефон оставляем. */
  if (!endpoint) {
    form.hidden = true;
    var note = document.createElement('p');
    note.className = 'fine';
    note.textContent = 'Запись — по телефону: ' + cfg.phone;
    form.parentNode.insertBefore(note, form.nextSibling);
    return;
  }

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

    var last = Number(window.localStorage.getItem('demo:last') || 0);
    if (Date.now() - last < 60000) {
      showError('Заявка уже отправлена. Перезвоним в течение 15 минут.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Отправляем…';

    var payload = {
      slug: form.getAttribute('data-slug') || location.pathname,
      phone: phone.value.trim(),
      name: (document.getElementById('f-name') || {}).value || '',
      car: (document.getElementById('f-car') || {}).value || '',
      issue: (document.getElementById('f-issue') || {}).value || '',
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
