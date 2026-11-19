/* =============================================================================
   ÉLÉGANCE — универсальный шаблон сайта салона красоты
   -----------------------------------------------------------------------------
   Модуль читает window.SITE_CONFIG и строит всю страницу.
   Никаких фреймворков, сборщиков и сетевых запросов при загрузке.
   Пользовательские данные выводятся только через textContent / setAttribute:
   HTML-инъекция из конфигурации невозможна.

   Точки расширения (необязательны):
     window.SITE_HOOKS = {
       onSubmit(payload) -> Promise<{ok, message}>,
       onReady(api) {},
       onSubmitSuccess(payload) {}
     }
   ========================================================================== */
(function () {
    'use strict';

    /* --------------------------------------------------------------------- */
    /*  0. УТИЛИТЫ                                                           */
    /* --------------------------------------------------------------------- */

    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var $$ = function (sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    };

    /** Создаёт элемент. Дети добавляются только через appendChild. */
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text !== undefined && text !== null && text !== '') { node.textContent = String(text); }
        return node;
    }

    /**
     * Секция-список. Принимает и массив (`services: [...]`), и объект
     * (`services: {eyebrow, title, items: [...]}`) — сборщику достаточно
     * отдать простой массив, шаблон сам приведёт его к нужному виду.
     */
    function sectionList(raw) {
        if (Array.isArray(raw)) { return { meta: {}, items: raw }; }
        var meta = obj(raw);
        return { meta: meta, items: asArray(meta.items) };
    }

    /** Безопасно пишет текст в узел (никогда не innerHTML). */
    function setText(node, value) {
        if (!node) { return; }
        var str = value === undefined || value === null ? '' : String(value).trim();
        if (!str) { return; }
        node.textContent = str;
    }

    function isFilled(value) {
        if (value === undefined || value === null) { return false; }
        if (typeof value === 'string') { return value.trim().length > 0; }
        if (Array.isArray(value)) { return value.length > 0; }
        if (typeof value === 'number') { return isFinite(value); }
        if (typeof value === 'object') { return Object.keys(value).length > 0; }
        return true;
    }

    function asArray(value) {
        if (Array.isArray(value)) { return value.filter(isFilled); }
        if (isFilled(value)) { return [value]; }
        return [];
    }

    function str(value) {
        if (typeof value === 'string') { return value.trim(); }
        if (typeof value === 'number') { return isFinite(value) ? String(value) : ''; }
        return isFilled(value) ? String(value).trim() : '';
    }

    function obj(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    /** Скрывает элемент и убирает его из дерева доступности. */
    function hide(node) {
        if (!node) { return; }
        node.hidden = true;
        node.setAttribute('hidden', '');
    }

    function show(node) {
        if (!node) { return; }
        node.hidden = false;
        node.removeAttribute('hidden');
    }

    /**
     * Приводит путь к изображению к безопасному относительному виду.
     * Отбрасывает javascript:, data: и абсолютные пути от корня.
     */
    function imageUrl(value, fallback) {
        var src = str(value);
        if (!src) { return fallback || ''; }
        if (/^(javascript|vbscript|data):/i.test(src)) { return fallback || ''; }
        if (src.charAt(0) === '/') { src = src.replace(/^\/+/, ''); }
        return src;
    }

    /** Безопасный href: только http(s), mailto, tel, относительные ссылки и якоря. */
    function safeHref(value) {
        var url = str(value);
        if (!url) { return ''; }
        var cleaned = url.replace(/[\u0000-\u001F\u007F\s]+/g, '');
        if (/^(javascript|vbscript|data|file):/i.test(cleaned)) { return ''; }
        if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned) || cleaned.charAt(0) === '#' || cleaned.charAt(0) === '/') {
            return /^https?:/i.test(cleaned) || /^(mailto|tel):/i.test(cleaned) || cleaned.charAt(0) === '#' ? cleaned : '';
        }
        return cleaned;
    }

    /** "+7 (999) 123-45-67" -> "tel:+79991234567" */
    function telHref(phone) {
        var digits = str(phone).replace(/[^\d+]/g, '');
        if (!digits) { return ''; }
        if (digits.charAt(0) !== '+') {
            if (digits.length === 11 && digits.charAt(0) === '8') { digits = '+7' + digits.slice(1); }
            else if (digits.length === 10) { digits = '+7' + digits; }
            else { digits = '+' + digits; }
        }
        return 'tel:' + digits;
    }

    function mailHref(email) {
        var value = str(email);
        if (!value || value.indexOf('@') === -1) { return ''; }
        return 'mailto:' + value.replace(/\s+/g, '');
    }

    /** Ник в соцсети -> полный URL. */
    function socialHref(network, raw) {
        var value = str(raw);
        if (!value) { return ''; }
        if (/^https?:\/\//i.test(value)) { return value; }
        if (/^(javascript|data|vbscript):/i.test(value)) { return ''; }
        var handle = value.replace(/^@/, '').replace(/^\/+|\/+$/g, '');
        if (!/^[\w.\-]{2,64}$/.test(handle)) { return ''; }
        switch (network) {
            case 'telegram': return 'https://t.me/' + handle;
            case 'instagram': return 'https://instagram.com/' + handle;
            case 'whatsapp': return 'https://wa.me/' + handle.replace(/[^\d]/g, '');
            case 'vk': return 'https://vk.com/' + handle;
            case 'youtube': return 'https://youtube.com/@' + handle;
            default: return '';
        }
    }

    function icon(name, size) {
        var paths = {
            leaf: 'M20 4C13 4 5 8 5 16c0 2 1 4 3 4 8 0 12-8 12-16Z M8 20c1-6 5-10 9-12',
            award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z M8.5 14 7 22l5-3 5 3-1.5-8',
            clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3.5 2',
            sparkle: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3Z M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
            scissors: 'M7 4l10 15M17 4L7 19M7 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M17 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
            heart: 'M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9Z',
            drop: 'M12 3s6 6.3 6 10a6 6 0 0 1-12 0c0-3.7 6-10 6-10Z',
            star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5Z',
            phone: 'M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z',
            mail: 'M3.5 6.5h17v11h-17v-11Z M4 7l8 6 8-6',
            pin: 'M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'
        };
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', size || 24);
        svg.setAttribute('height', size || 24);
        svg.setAttribute('fill', 'none');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', paths[name] || paths.sparkle);
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.1');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        return svg;
    }

    var SOCIAL_META = [
        { key: 'telegram', label: 'Telegram', path: 'M21 4.5 3.4 11.2c-.9.3-.9 1 .1 1.3l4.4 1.4 1.7 5.2c.2.6.6.7 1.1.3l2.4-2.3 4.6 3.4c.7.5 1.2.2 1.4-.7L21.6 5.4c.2-.9-.3-1.2-1-.9Z' },
        { key: 'whatsapp', label: 'WhatsApp', path: 'M20 11.9A8 8 0 0 1 7.6 19L4 20l1.1-3.5A8 8 0 1 1 20 12Z M9 9.2c.2-.4.4-.4.7-.4h.4c.2 0 .4 0 .6.5l.7 1.6c.1.2 0 .4-.1.6l-.5.6c.6 1.2 1.5 2 2.7 2.5l.6-.6c.2-.2.4-.2.6-.1l1.6.7c.2.1.4.3.3.6-.2 1-1 1.6-2 1.6-2.6 0-5.6-3-5.6-5.6 0-.9.4-1.7 1-2.3Z' },
        { key: 'instagram', label: 'Instagram', path: 'M8 3.5h8A4.5 4.5 0 0 1 20.5 8v8a4.5 4.5 0 0 1-4.5 4.5H8A4.5 4.5 0 0 1 3.5 16V8A4.5 4.5 0 0 1 8 3.5Z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M17.2 7.1h.01' },
        { key: 'vk', label: 'VK', path: 'M4 7h3c0 4 2.2 6.5 4.2 7V7h2.8v4c1.8-.3 3.2-2 3.6-4H21c-.5 2.8-2.2 5-3.9 6 1.8 1 3.6 3 4.4 5.5h-3.3c-.6-1.8-2-3.3-4.2-3.6V19h-.7C7.8 19 4.4 15 4 7Z' },
        { key: 'youtube', label: 'YouTube', path: 'M3.5 9.5A3 3 0 0 1 6.4 6.6h11.2a3 3 0 0 1 2.9 2.9v5a3 3 0 0 1-2.9 2.9H6.4a3 3 0 0 1-2.9-2.9v-5Z M10.5 9.5l4.5 2.5-4.5 2.5v-5Z' }
    ];

    function socialIcon(key, label) {
        var meta = SOCIAL_META.filter(function (m) { return m.key === key; })[0];
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', meta ? meta.path : SOCIAL_META[0].path);
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        svg.setAttribute('aria-label', label || (meta ? meta.label : ''));
        return svg;
    }

    /* --------------------------------------------------------------------- */
    /*  0b. ЗАГОЛОВКИ СЕКЦИЙ                                                 */
    /* --------------------------------------------------------------------- */

    var DEFAULT_TITLES = {
        about: 'О салоне',
        services: 'Услуги и цены',
        advantages: 'Почему выбирают нас',
        masters: 'Мастера',
        gallery: 'Галерея',
        reviews: 'Отзывы',
        booking: 'Запись на визит',
        contacts: 'Контакты'
    };

    var DEFAULT_EYEBROWS = {
        about: 'О салоне',
        services: 'Услуги',
        advantages: 'Преимущества',
        masters: 'Команда',
        gallery: 'Галерея',
        reviews: 'Отзывы',
        booking: 'Запись',
        contacts: 'Контакты'
    };

    /** Заголовок секции: значение из конфига, иначе осмысленный дефолт. */
    function setTitle(sectionKey, value) {
        var node = $('[data-bind="' + sectionKey + '-title"]');
        if (!node) { return; }
        var text = str(value) || DEFAULT_TITLES[sectionKey] || '';
        if (text) { setText(node, text); show(node); } else { hide(node); }
    }

    /** Надзаголовок секции; вместе с ним скрывается вся строка. */
    function setEyebrow(sectionKey, value) {
        var node = $('[data-bind="' + sectionKey + '-eyebrow"]');
        if (!node) { return; }
        var text = str(value) || DEFAULT_EYEBROWS[sectionKey] || '';
        var wrap = node.parentNode;
        if (text) {
            setText(node, text);
            show(node);
            if (wrap && wrap.classList && wrap.classList.contains('eyebrow')) { show(wrap); }
        } else {
            hide(node);
            if (wrap && wrap.classList && wrap.classList.contains('eyebrow')) { hide(wrap); }
        }
    }

    /** Пояснительная строка рядом с заголовком. */
    function setNote(selector, value) {
        var node = typeof selector === 'string' ? $(selector) : selector;
        if (!node) { return; }
        if (str(value)) { setText(node, value); show(node); } else { hide(node); }
    }

    /* --------------------------------------------------------------------- */
    /*  1. КОНФИГУРАЦИЯ И ДЕФОЛТЫ                                            */
    /* --------------------------------------------------------------------- */

    var CFG = obj(window.SITE_CONFIG);
    var HOOKS = obj(window.SITE_HOOKS);

    var DEMO_IMAGES = {
        hero: 'assets/hero.jpg',
        about: 'assets/salon.jpg',
        aboutDetail: 'assets/salon-detail.jpg',
        service: 'assets/service-1.jpg',
        master: 'assets/master-1.jpg',
        gallery: 'assets/gallery-1.jpg',
        booking: 'assets/booking.jpg',
        og: 'assets/og-image.jpg'
    };

    var state = {
        galleryItems: [],
        lightboxIndex: 0,
        reviewIndex: 0,
        reviewCount: 0
    };

    function track(event, data) {
        try {
            if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('site:' + event, { detail: data || {} }));
            }
        } catch (e) { /* окружение без CustomEvent — не критично */ }
    }

    /** Заполняет все узлы [data-bind="key"] значением по точечному пути. */
    function bindStatic() {
        $$('[data-bind]').forEach(function (node) {
            var path = node.getAttribute('data-bind');
            // Ключи с дефисом (hero-title, about-eyebrow...) заполняют рендереры
            // секций: у них есть осмысленные значения по умолчанию.
            if (!path || path.indexOf('-') !== -1) { return; }
            var parts = path.split('.');
            var value = CFG;
            for (var i = 0; i < parts.length; i++) {
                if (value === undefined || value === null) { value = ''; break; }
                value = value[parts[i]];
            }
            if (isFilled(value) && typeof value !== 'object') {
                setText(node, value);
                show(node);
            } else {
                hide(node);
            }
        });
    }

    /** Название салона в заголовке и подписи. */
    function renderIdentity() {
        var name = str(CFG.name) || 'Салон красоты';
        var slogan = str(CFG.slogan);
        var logo = obj(CFG.logo);

        var brandText = str(logo.text) || name;
        $$('[data-bind="name"]').forEach(function (node) {
            if (node.classList.contains('brand__text')) { setText(node, brandText); }
            else { setText(node, name); }
            show(node);
        });

        var mark = $('.brand__mark');
        if (mark) {
            if (str(logo.mark)) {
                mark.setAttribute('data-mark', str(logo.mark));
                mark.classList.add('is-labeled');
            } else {
                mark.classList.remove('is-labeled');
            }
        }

        var headerPhone = $('#header-phone');
        if (headerPhone) {
            var phone = str(obj(CFG.contacts).phone);
            var href = telHref(phone);
            if (phone && href) {
                headerPhone.textContent = phone;
                headerPhone.setAttribute('href', href);
                show(headerPhone);
            } else {
                hide(headerPhone);
            }
        }
    }

    /* --------------------------------------------------------------------- */
    /*  2. НАВИГАЦИЯ                                                         */
    /* --------------------------------------------------------------------- */

    var SECTION_LABELS = {
        about: 'О салоне', services: 'Услуги', advantages: 'Преимущества',
        masters: 'Мастера', gallery: 'Галерея', reviews: 'Отзывы',
        booking: 'Запись', contacts: 'Контакты'
    };

    function sectionExists(id) {
        return !!document.getElementById(id);
    }

    /** Строит навигацию по конфигу, отбрасывая ссылки на скрытые секции. */
    function renderNav() {
        var list = $('#nav-list');
        var mobileList = $('#mobile-nav-list');
        var navConfig = asArray(CFG.nav);
        var items = [];

        if (navConfig.length) {
            navConfig.forEach(function (raw) {
                var item = obj(raw);
                var target = str(item.target).replace(/^#/, '');
                if (!target || !sectionExists(target)) { return; }
                items.push({ label: str(item.label) || SECTION_LABELS[target] || target, target: target });
            });
        } else {
            Object.keys(SECTION_LABELS).forEach(function (id) {
                if (sectionExists(id) && !document.getElementById(id).hidden) {
                    items.push({ label: SECTION_LABELS[id], target: id });
                }
            });
        }

        if (!items.length) {
            hide(list);
            hide(mobileList);
            return;
        }

        [list, mobileList].forEach(function (targetList) {
            if (!targetList) { return; }
            while (targetList.firstChild) { targetList.removeChild(targetList.firstChild); }
            items.forEach(function (item, index) {
                var li = el('li', targetList === mobileList ? 'mobile-menu__item' : 'nav__item');
                var a = el('a', targetList === mobileList ? 'mobile-menu__link' : 'nav__link');
                a.setAttribute('href', '#' + item.target);
                a.setAttribute('data-nav-target', item.target);
                li.appendChild(a);

                if (targetList === mobileList) {
                    var num = el('span', 'mobile-menu__num', ('0' + (index + 1)).slice(-2));
                    li.insertBefore(num, a);
                }
                a.appendChild(el('span', 'nav__label', item.label));
                targetList.appendChild(li);
            });
        });
    }

    /* --------------------------------------------------------------------- */
    /*  3. HERO                                                              */
    /* --------------------------------------------------------------------- */

    function renderHero() {
        var hero = obj(CFG.hero);
        var name = str(CFG.name);

        var titleMain = $('#hero-title .hero__title-line');
        var titleAccent = $('#hero-title .hero__title-line--accent');
        var mainText = str(hero.title) || name || 'Салон красоты';
        if (titleMain) { setText(titleMain, mainText); show(titleMain); }
        if (titleAccent) {
            if (str(hero.accent)) { setText(titleAccent, hero.accent); show(titleAccent); }
            else { hide(titleAccent); }
        }

        var lead = $('.hero__lead');
        var leadText = str(hero.lead) || str(CFG.description);
        if (leadText) { setText(lead, leadText); } else { hide(lead); }

        var eyebrow = $('.hero__eyebrow');
        var eyebrowText = str(hero.eyebrow);
        if (!eyebrowText) {
            var parts = [str(obj(CFG.contacts).district), str(obj(CFG.contacts).address)];
            eyebrowText = parts.filter(Boolean).join(' · ');
        }
        if (eyebrowText) {
            setText($('[data-bind="hero-eyebrow"]'), eyebrowText);
            show($('[data-bind="hero-eyebrow"]'));
        } else {
            hide(eyebrow);
        }

        var ctaLabel = $('#hero-cta-label');
        if (ctaLabel && str(hero.cta)) { setText(ctaLabel, hero.cta); }

        var img = $('#hero-image');
        if (img) {
            img.setAttribute('src', imageUrl(hero.image, DEMO_IMAGES.hero));
            img.setAttribute('alt', name ? name + ' — ' + (str(CFG.slogan) || 'салон красоты') : 'Салон красоты');
        }

        var caption = $('#hero-caption');
        if (str(hero.caption)) { setText(caption, hero.caption); show(caption); } else { hide(caption); }

        var vertical = $('#hero-vertical');
        if (str(hero.vertical)) { setText(vertical, hero.vertical); } else { hide(vertical); }

        var facts = asArray(hero.facts);
        var factsList = $('#hero-facts');
        if (factsList) {
            while (factsList.firstChild) { factsList.removeChild(factsList.firstChild); }
            if (!facts.length) {
                hide(factsList);
            } else {
                facts.forEach(function (raw) {
                    var fact = obj(raw);
                    if (!str(fact.value)) { return; }
                    var item = el('div', 'hero__fact');
                    item.appendChild(el('dt', 'hero__fact-value', fact.value));
                    item.appendChild(el('dd', 'hero__fact-label', fact.label));
                    factsList.appendChild(item);
                });
                if (!factsList.children.length) { hide(factsList); }
            }
        }
    }

    /* --------------------------------------------------------------------- */
    /*  4. БЕГУЩАЯ СТРОКА                                                    */
    /* --------------------------------------------------------------------- */

    function renderTicker() {
        var track = $('#ticker-track');
        var words = asArray(CFG.ticker).map(str).filter(Boolean);
        var ticker = track ? track.parentNode : null;

        if (!track) { return; }
        if (words.length < 2) {
            if (ticker) { hide(ticker); }
            return;
        }

        // Две копии последовательности: анимация сдвига на -50% бесшовна.
        for (var copy = 0; copy < 2; copy++) {
            var group = el('div', 'ticker__group');
            group.setAttribute('aria-hidden', copy === 1 ? 'true' : 'false');
            words.forEach(function (word, index) {
                group.appendChild(el('span', 'ticker__word', word));
                group.appendChild(el('span', 'ticker__dot', '·'));
                if (index === words.length - 1) { group.lastChild.setAttribute('aria-hidden', 'true'); }
            });
            track.appendChild(group);
        }
    }

    /** Убирает из меню ссылки на секции, которые скрылись из-за пустых данных. */
    function pruneNav() {
        $$('[data-nav-target]').forEach(function (link) {
            var section = document.getElementById(link.getAttribute('data-nav-target'));
            var item = link.parentNode;
            if (!section || (section.hidden && section.getAttribute('aria-hidden') !== 'false')) {
                if (item && item.parentNode) { item.parentNode.removeChild(item); }
            }
        });
        $$('.nav__list, .mobile-menu__list').forEach(function (list) {
            if (!list.children.length) { hide(list); }
        });

        // Ссылки внутри страницы, ведущие в скрытую секцию, тоже убираем:
        // иначе кнопка «Услуги и цены» остаётся, а раздела нет.
        $$('a[href^="#"]').forEach(function (link) {
            if (link.hasAttribute('data-nav-target')) { return; }
            var id = link.getAttribute('href').slice(1);
            if (!id) { return; }
            var target = document.getElementById(id);
            if (!target || target.tagName !== 'SECTION' || !target.hidden) { return; }
            var actions = link.closest ? link.closest('.hero__actions, .service__links, .section-head') : null;
            if (actions && actions.children.length === 1) { hide(actions); }
            hide(link);
        });
    }

    /* --------------------------------------------------------------------- */
    /*  5. О САЛОНЕ                                                          */
    /* --------------------------------------------------------------------- */

    function renderAbout() {
        var about = obj(CFG.about);
        var section = $('#about');
        var paragraphs = asArray(about.paragraphs).map(str).filter(Boolean);
        var hasText = paragraphs.length > 0;

        if (!hasText && !str(about.title)) {
            hide(section);
            return;
        }

        setEyebrow('about', about.eyebrow);
        setTitle('about', about.title);

        var img = $('#about-image');
        if (img) {
            img.setAttribute('src', imageUrl(about.image, DEMO_IMAGES.about));
            img.setAttribute('alt', 'Интерьер салона ' + (str(CFG.name) || ''));
        }
        var detail = $('#about-detail');
        if (detail) {
            var detailSrc = imageUrl(about.detailImage, '');
            if (detailSrc) {
                detail.setAttribute('src', detailSrc);
                detail.setAttribute('alt', 'Детали интерьера ' + (str(CFG.name) || 'салона'));
                show(detail.parentNode);
            } else {
                hide(detail.parentNode);
            }
        }

        var textWrap = $('#about-text');
        if (textWrap) {
            while (textWrap.firstChild) { textWrap.removeChild(textWrap.firstChild); }
            paragraphs.forEach(function (paragraph) {
                textWrap.appendChild(el('p', 'about__paragraph', paragraph));
            });
            if (!paragraphs.length) { hide(textWrap); }
        }

        var badge = $('#about-badge');
        if (str(about.badge)) { setText(badge, about.badge); } else if (badge) { hide(badge.parentNode); }

        var signature = obj(about.signature);
        var sigWrap = $('#about-signature');
        if (sigWrap) {
            while (sigWrap.firstChild) { sigWrap.removeChild(sigWrap.firstChild); }
            if (str(signature.name)) {
                sigWrap.appendChild(el('span', 'about__signature-name', signature.name));
                if (str(signature.role)) {
                    sigWrap.appendChild(el('span', 'about__signature-role', signature.role));
                }
                show(sigWrap);
            } else {
                hide(sigWrap);
            }
        }

        var statsWrap = $('#about-stats');
        var stats = asArray(about.stats);
        if (statsWrap) {
            while (statsWrap.firstChild) { statsWrap.removeChild(statsWrap.firstChild); }
            stats.forEach(function (raw) {
                var stat = obj(raw);
                if (!str(stat.value)) { return; }
                var cell = el('div', 'stats__item');
                cell.appendChild(el('dt', 'stats__value', stat.value));
                cell.appendChild(el('dd', 'stats__label', stat.label));
                statsWrap.appendChild(cell);
            });
            if (!statsWrap.children.length) { hide(statsWrap); }
        }
    }

    /* --------------------------------------------------------------------- */
    /*  6. УСЛУГИ                                                            */
    /* --------------------------------------------------------------------- */

    function renderServices() {
        var list0 = sectionList(CFG.services);
        var services = list0.meta;
        var section = $('#services');
        var items = list0.items.map(obj).filter(function (item) {
            return str(item.name);
        });

        if (!items.length) {
            hide(section);
            return;
        }

        setEyebrow('services', services.eyebrow);
        setTitle('services', services.title);
        setNote('#services .section-head__note', services.note);

        var list = $('#services-list');
        var media = $('#services-media');
        if (!list) { return; }

        while (list.firstChild) { list.removeChild(list.firstChild); }

        var withImages = items.filter(function (item) { return str(item.image); });

        items.forEach(function (item, index) {
            var li = el('li', 'service');
            li.setAttribute('data-service-index', String(index));

            var btn = el('button', 'service__trigger');
            btn.setAttribute('type', 'button');
            btn.setAttribute('aria-expanded', 'false');

            var head = el('span', 'service__head');
            var indexLabel = el('span', 'service__index', ('0' + (index + 1)).slice(-2));
            var titleWrap = el('span', 'service__title-wrap');
            titleWrap.appendChild(el('span', 'service__title', item.name));
            if (str(item.duration)) {
                titleWrap.appendChild(el('span', 'service__duration', item.duration));
            }
            var price = el('span', 'service__price', item.price || 'по запросу');

            head.appendChild(indexLabel);
            head.appendChild(titleWrap);
            head.appendChild(price);
            btn.appendChild(head);

            var panel = el('div', 'service__panel');
            var panelInner = el('div', 'service__panel-inner');
            if (str(item.description)) {
                panelInner.appendChild(el('p', 'service__description', item.description));
            }
            var actions = el('span', 'service__actions');
            var book = el('a', 'service__book');
            book.setAttribute('href', '#booking');
            book.setAttribute('data-scroll-to', 'booking');
            book.setAttribute('data-service-name', str(item.name));
            book.appendChild(el('span', '', 'Записаться'));
            var arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            arrow.setAttribute('width', '16');
            arrow.setAttribute('height', '16');
            arrow.setAttribute('viewBox', '0 0 24 24');
            arrow.setAttribute('fill', 'none');
            arrow.setAttribute('aria-hidden', 'true');
            var ap = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            ap.setAttribute('d', 'M4 12h15M13 6l6 6-6 6');
            ap.setAttribute('stroke', 'currentColor');
            ap.setAttribute('stroke-width', '1.3');
            ap.setAttribute('stroke-linecap', 'round');
            ap.setAttribute('stroke-linejoin', 'round');
            arrow.appendChild(ap);
            book.appendChild(arrow);
            actions.appendChild(book);
            panelInner.appendChild(actions);
            panel.appendChild(panelInner);

            li.appendChild(btn);
            li.appendChild(panel);
            list.appendChild(li);
        });

        // Подпись и кадр справа: показывают первый пункт с изображением.
        if (media) {
            var first = withImages[0];
            if (!first) {
                hide(media);
            } else {
                show(media);
                var frame = $('#services-frame');
                if (frame) {
                    var frameImg = document.createElement('img');
                    frameImg.setAttribute('id', 'services-image');
                    frameImg.setAttribute('src', imageUrl(first.image, DEMO_IMAGES.service));
                    frameImg.setAttribute('alt', str(first.name) || 'Услуга салона');
                    frameImg.setAttribute('loading', 'lazy');
                    frameImg.setAttribute('decoding', 'async');
                    while (frame.firstChild) { frame.removeChild(frame.firstChild); }
                    frame.appendChild(frameImg);
                }
                setText($('#services-caption-name'), first.name);
                setText($('#services-caption-price'), first.price || '');
                var priceNodeInit = $('#services-caption-price');
                if (priceNodeInit && !str(first.price)) { hide(priceNodeInit); }
            }
        }

        var setActive = function (index) {
            var item = items[index];
            if (!item) { return; }
            var frameImg = $('#services-image');
            if (frameImg && str(item.image)) {
                frameImg.setAttribute('alt', str(item.name) || 'Услуга салона');
                frameImg.setAttribute('src', imageUrl(item.image, DEMO_IMAGES.service));
                frameImg.classList.remove('is-fading');
                // перезапуск css-анимации смены кадра
                void frameImg.offsetWidth;
                frameImg.classList.add('is-fading');
            }
            setText($('#services-caption-name'), item.name);
            var priceNode = $('#services-caption-price');
            if (priceNode) { priceNode.textContent = str(item.price); }
        };

        $$('.service__trigger', list).forEach(function (btn, index) {
            btn.addEventListener('click', function () {
                var li = btn.parentNode;
                var isOpen = li.classList.contains('is-open');
                $$('.service', list).forEach(function (node) {
                    node.classList.remove('is-open');
                    var trigger = $('.service__trigger', node);
                    if (trigger) { trigger.setAttribute('aria-expanded', 'false'); }
                });
                if (!isOpen) {
                    li.classList.add('is-open');
                    btn.setAttribute('aria-expanded', 'true');
                    setActive(index);
                }
            });
            btn.addEventListener('mouseenter', function () { setActive(index); });
            btn.addEventListener('focus', function () { setActive(index); });
        });

        // Первый пункт раскрыт: секция не выглядит пустой.
        var firstTrigger = $('.service__trigger', list);
        if (firstTrigger) {
            firstTrigger.parentNode.classList.add('is-open');
            firstTrigger.setAttribute('aria-expanded', 'true');
        }
    }

    /* --------------------------------------------------------------------- */
    /*  7. ПРЕИМУЩЕСТВА                                                      */
    /* --------------------------------------------------------------------- */

    function renderAdvantages() {
        var list0 = sectionList(CFG.advantages);
        var advantages = list0.meta;
        var section = $('#advantages');
        var items = list0.items.map(obj).filter(function (item) { return str(item.title); });
        var list = $('#advantages-list');

        if (!items.length || !list) {
            hide(section);
            return;
        }

        setEyebrow('advantages', advantages.eyebrow);
        setTitle('advantages', advantages.title);

        while (list.firstChild) { list.removeChild(list.firstChild); }

        items.forEach(function (item, index) {
            var li = el('li', 'advantage reveal');
            var num = el('span', 'advantage__num', ('0' + (index + 1)).slice(-2));
            var iconWrap = el('span', 'advantage__icon');
            iconWrap.appendChild(icon(str(item.icon) || 'sparkle', 26));

            var title = el('h3', 'advantage__title', item.title);
            li.appendChild(num);
            li.appendChild(iconWrap);
            li.appendChild(title);
            if (str(item.text)) {
                li.appendChild(el('p', 'advantage__text', item.text));
            }
            list.appendChild(li);
        });
    }

    /* --------------------------------------------------------------------- */
    /*  8. МАСТЕРА                                                           */
    /* --------------------------------------------------------------------- */

    function renderMasters() {
        var list0 = sectionList(CFG.masters);
        var masters = list0.meta;
        var section = $('#masters');
        var items = list0.items.map(obj).filter(function (item) { return str(item.name); });
        var list = $('#masters-list');

        if (!items.length || !list) {
            hide(section);
            var navLink = $('[data-nav-target="masters"]');
            if (navLink) { hide(navLink.parentNode); }
            return;
        }

        setEyebrow('masters', masters.eyebrow);
        setTitle('masters', masters.title);
        setNote('#masters .section-head__note', masters.note);

        while (list.firstChild) { list.removeChild(list.firstChild); }

        items.forEach(function (item, index) {
            var li = el('li', 'master reveal');
            li.setAttribute('data-master-index', String(index));

            var figure = el('figure', 'master__figure');
            var img = document.createElement('img');
            img.setAttribute('src', imageUrl(item.image, DEMO_IMAGES.master));
            img.setAttribute('alt', item.name + (str(item.specialization) ? ' — ' + str(item.specialization) : ''));
            img.setAttribute('loading', 'lazy');
            img.setAttribute('decoding', 'async');
            img.setAttribute('width', '853');
            img.setAttribute('height', '1067');
            figure.appendChild(img);

            var overlay = el('figcaption', 'master__overlay');
            overlay.appendChild(el('span', 'master__overlay-name', item.name));
            if (str(item.experience)) {
                overlay.appendChild(el('span', 'master__overlay-exp', 'Опыт ' + str(item.experience)));
            }
            figure.appendChild(overlay);
            li.appendChild(figure);

            var body = el('div', 'master__body');
            body.appendChild(el('h3', 'master__name', item.name));
            if (str(item.specialization)) {
                body.appendChild(el('p', 'master__spec', item.specialization));
            }
            if (str(item.experience)) {
                body.appendChild(el('p', 'master__exp', 'Опыт работы — ' + str(item.experience)));
            }
            li.appendChild(body);

            list.appendChild(li);
        });
    }

    /* --------------------------------------------------------------------- */
    /*  9. ГАЛЕРЕЯ И ЛАЙТБОКС                                                */
    /* --------------------------------------------------------------------- */

    function normalizeGallery() {
        var raw = sectionList(CFG.gallery).items;
        var result = [];

        raw.forEach(function (entry) {
            if (typeof entry === 'string') {
                var src = imageUrl(entry, '');
                if (src) { result.push({ src: src, caption: '' }); }
                return;
            }
            var item = obj(entry);
            var itemSrc = imageUrl(item.src, '');
            if (itemSrc) { result.push({ src: itemSrc, caption: str(item.caption) }); }
        });

        return result;
    }

    function openLightbox(index) {
        var items = state.galleryItems;
        if (!items.length) { return; }
        var i = ((index % items.length) + items.length) % items.length;
        state.lightboxIndex = i;

        var item = items[i];
        var wrap = $('#lightbox');
        var img = $('#lightbox-image');
        var caption = $('#lightbox-caption');
        var counter = $('#lightbox-counter');

        if (img) {
            img.setAttribute('src', item.src);
            img.setAttribute('alt', item.caption || ('Фотография ' + (i + 1)));
        }
        if (caption) {
            if (item.caption) { setText(caption, item.caption); show(caption); }
            else { hide(caption); }
        }
        if (counter) {
            counter.textContent = ('0' + (i + 1)).slice(-2) + ' / ' + ('0' + items.length).slice(-2);
        }
        if (wrap) {
            show(wrap);
            document.body.classList.add('is-locked');
            var closeBtn = $('#lightbox-close');
            if (closeBtn) { closeBtn.focus(); }
        }
    }

    function closeLightbox() {
        var wrap = $('#lightbox');
        var img = $('#lightbox-image');
        if (!wrap) { return; }
        hide(wrap);
        document.body.classList.remove('is-locked');
        if (img) { img.removeAttribute('src'); }
    }

    function stepLightbox(delta) {
        openLightbox(state.lightboxIndex + delta);
    }

    function renderGallery() {
        var gallery = sectionList(CFG.gallery).meta;
        var section = $('#gallery');
        var grid = $('#gallery-grid');
        var items = normalizeGallery();

        if (!grid) { return; }

        setEyebrow('gallery', gallery.eyebrow);
        setTitle('gallery', gallery.title);
        setNote('#gallery .section-head__note', gallery.note);

        // Нет фотографий — показываем локальные заглушки, а не пустой блок.
        if (!items.length) {
            items = ['gallery-1', 'gallery-2', 'gallery-3', 'gallery-4', 'gallery-5', 'gallery-6'].map(function (name) {
                return { src: 'assets/' + name + '.jpg', caption: '' };
            });
        }

        state.galleryItems = items;
        while (grid.firstChild) { grid.removeChild(grid.firstChild); }

        items.forEach(function (item, index) {
            var btn = el('button', 'gallery__item gallery__item--' + ((index % 6) + 1));
            btn.setAttribute('type', 'button');
            btn.setAttribute('data-gallery-index', String(index));
            btn.setAttribute('aria-label', item.caption ? 'Открыть: ' + item.caption : 'Открыть фотографию ' + (index + 1));

            var img = document.createElement('img');
            img.setAttribute('src', item.src);
            img.setAttribute('alt', item.caption || '');
            img.setAttribute('loading', 'lazy');
            img.setAttribute('decoding', 'async');
            btn.appendChild(img);

            var veil = el('span', 'gallery__veil');
            if (item.caption) { veil.appendChild(el('span', 'gallery__caption', item.caption)); }
            btn.appendChild(veil);

            btn.addEventListener('click', function () { openLightbox(index); });
            grid.appendChild(btn);
        });

        var controls = $('#gallery-controls');
        if (controls) { hide(controls); }
    }

    function initLightbox() {
        var closeBtn = $('#lightbox-close');
        var prevBtn = $('#lightbox-prev');
        var nextBtn = $('#lightbox-next');
        var wrap = $('#lightbox');

        if (closeBtn) { closeBtn.addEventListener('click', closeLightbox); }
        if (prevBtn) { prevBtn.addEventListener('click', function () { stepLightbox(-1); }); }
        if (nextBtn) { nextBtn.addEventListener('click', function () { stepLightbox(1); }); }
        if (wrap) {
            wrap.addEventListener('click', function (event) {
                if (event.target === wrap) { closeLightbox(); }
            });
        }
        document.addEventListener('keydown', function (event) {
            if (!wrap || wrap.hidden) { return; }
            if (event.key === 'Escape') { closeLightbox(); }
            else if (event.key === 'ArrowLeft') { stepLightbox(-1); }
            else if (event.key === 'ArrowRight') { stepLightbox(1); }
        });
    }

    /* --------------------------------------------------------------------- */
    /*  10. ОТЗЫВЫ (КАРУСЕЛЬ)                                                */
    /* --------------------------------------------------------------------- */

    function renderReviews() {
        var list0 = sectionList(CFG.reviews);
        var reviews = list0.meta;
        var section = $('#reviews');
        var track = $('#reviews-track');
        var items = list0.items.map(obj).filter(function (item) { return str(item.text); });

        if (!track) { return; }
        if (!items.length) {
            hide(section);
            var navLink = $('[data-nav-target="reviews"]');
            if (navLink) { hide(navLink.parentNode); }
            return;
        }

        setEyebrow('reviews', reviews.eyebrow);
        setTitle('reviews', reviews.title);

        state.reviewCount = items.length;
        while (track.firstChild) { track.removeChild(track.firstChild); }

        items.forEach(function (item, index) {
            var slide = el('article', 'review');
            slide.setAttribute('data-review-index', String(index));

            var mark = el('span', 'review__mark', '“');
            mark.setAttribute('aria-hidden', 'true');
            slide.appendChild(mark);

            var quote = el('blockquote', 'review__quote');
            quote.appendChild(el('p', 'review__text', item.text));
            slide.appendChild(quote);

            var foot = el('footer', 'review__footer');
            var starWrap = el('span', 'review__stars');
            starWrap.setAttribute('aria-label', 'Оценка 5 из 5');
            for (var s = 0; s < 5; s++) {
                var star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                star.setAttribute('viewBox', '0 0 24 24');
                star.setAttribute('width', '13');
                star.setAttribute('height', '13');
                star.setAttribute('fill', 'currentColor');
                star.setAttribute('aria-hidden', 'true');
                var starPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                starPath.setAttribute('d', 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5Z');
                star.appendChild(starPath);
                starWrap.appendChild(star);
            }
            foot.appendChild(starWrap);

            var author = el('div', 'review__author');
            author.appendChild(el('span', 'review__name', item.author || 'Гость салона'));
            if (str(item.role)) { author.appendChild(el('span', 'review__role', item.role)); }
            foot.appendChild(author);

            if (str(item.service)) {
                foot.appendChild(el('span', 'review__service', item.service));
            }

            slide.appendChild(foot);
            track.appendChild(slide);
        });

        var controls = $('#reviews-controls');
        if (items.length < 2) {
            if (controls) { hide(controls); }
        }

        setReview(0);
    }

    function setReview(index) {
        var track = $('#reviews-track');
        var total = state.reviewCount;
        if (!track || !total) { return; }

        var i = ((index % total) + total) % total;
        state.reviewIndex = i;
        track.style.transform = 'translate3d(' + (-100 * i) + '%, 0, 0)';

        $$('.review', track).forEach(function (slide, n) {
            var active = n === i;
            slide.classList.toggle('is-active', active);
            slide.setAttribute('aria-hidden', active ? 'false' : 'true');
        });

        var counter = $('#reviews-counter');
        if (counter) {
            counter.textContent = ('0' + (i + 1)).slice(-2) + ' / ' + ('0' + total).slice(-2);
        }

        var progress = $('#reviews-progress');
        if (progress) {
            var width = total > 1 ? ((i + 1) / total) * 100 : 100;
            progress.style.width = width + '%';
        }

        track.setAttribute('aria-live', 'polite');
    }

    function initReviews() {
        var prev = $('#reviews-prev');
        var next = $('#reviews-next');
        if (prev) { prev.addEventListener('click', function () { setReview(state.reviewIndex - 1); }); }
        if (next) { next.addEventListener('click', function () { setReview(state.reviewIndex + 1); }); }

        var stage = $('#reviews-stage');
        if (stage && window.matchMedia && window.matchMedia('(hover: hover)').matches) {
            var startX = 0;
            var dragging = false;
            stage.addEventListener('pointerdown', function (e) { dragging = true; startX = e.clientX; });
            stage.addEventListener('pointerup', function (e) {
                if (!dragging) { return; }
                dragging = false;
                var delta = e.clientX - startX;
                if (Math.abs(delta) > 60) { setReview(state.reviewIndex + (delta < 0 ? 1 : -1)); }
            });
            stage.addEventListener('pointerleave', function () { dragging = false; });
        }
    }

    /* --------------------------------------------------------------------- */
    /*  11. ФОРМА ЗАПИСИ                                                     */
    /* --------------------------------------------------------------------- */

    var formState = { submitting: false };

    function setFieldError(name, message) {
        var field = $('[data-error-for="' + name + '"]');
        var input = document.getElementById('field-' + name);
        if (field) { field.textContent = message || ''; }
        if (input) {
            if (message) { input.setAttribute('aria-invalid', 'true'); input.classList.add('is-invalid'); }
            else { input.removeAttribute('aria-invalid'); input.classList.remove('is-invalid'); }
        }
    }

    function clearFormErrors() {
        ['name', 'phone', 'service', 'date'].forEach(function (name) { setFieldError(name, ''); });
    }

    function fillServiceSelect() {
        var select = $('#field-service');
        var services = sectionList(CFG.services).items.map(obj).filter(function (item) { return str(item.name); });
        if (!select) { return; }

        while (select.options.length > 1) { select.remove(1); }
        services.forEach(function (item) {
            var option = document.createElement('option');
            option.value = str(item.name);
            option.textContent = str(item.price) ? str(item.name) + ' — ' + str(item.price) : str(item.name);
            select.appendChild(option);
        });

        if (!services.length) {
            var fieldWrap = select.closest ? select.closest('.field') : null;
            if (fieldWrap) { hide(fieldWrap); }
            if (select.parentNode && select.parentNode.classList) { hide(select.parentNode); }
            hide(select);
        }
    }

    function todayISO() {
        var now = new Date();
        var month = ('0' + (now.getMonth() + 1)).slice(-2);
        var day = ('0' + now.getDate()).slice(-2);
        return now.getFullYear() + '-' + month + '-' + day;
    }

    function setDateBounds() {
        var input = $('#field-date');
        if (!input) { return; }
        input.setAttribute('min', todayISO());
    }

    function collectFormData(form) {
        var data = {};
        Array.prototype.forEach.call(form.elements, function (field) {
            if (!field.name || field.disabled) { return; }
            data[field.name] = typeof field.value === 'string' ? field.value.trim() : field.value;
        });
        return data;
    }

    function validateForm(form) {
        var data = collectFormData(form);
        var errors = 0;

        if (!data.name || data.name.length < 2) {
            setFieldError('name', 'Укажите имя — минимум 2 символа');
            errors++;
        }
        var digits = (data.phone || '').replace(/[^\d]/g, '');
        if (digits.length < 10) {
            setFieldError('phone', 'Введите телефон в формате +7 (999) 123-45-67');
            errors++;
        }
        var serviceField = $('#field-service');
        if (serviceField && !serviceField.hidden && !data.service) {
            setFieldError('service', 'Выберите услугу');
            errors++;
        }
        if (!data.date) {
            setFieldError('date', 'Выберите желаемую дату');
            errors++;
        } else if (data.date < todayISO()) {
            setFieldError('date', 'Дата не может быть в прошлом');
            errors++;
        }

        return errors === 0 ? data : null;
    }

    function showFormStatus(message, type) {
        var status = $('#form-status');
        if (!status) { return; }
        status.textContent = message || '';
        status.classList.remove('is-error', 'is-success');
        if (message) { status.classList.add(type === 'error' ? 'is-error' : 'is-success'); }
    }

    function setSubmitting(value) {
        formState.submitting = value;
        var btn = $('#form-submit');
        var form = $('#booking-form');
        if (btn) {
            btn.classList.toggle('is-loading', value);
            btn.disabled = value;
        }
        if (form) {
            Array.prototype.forEach.call(form.elements, function (field) {
                if (field !== btn) { field.disabled = value; }
            });
        }
    }

    /** Отправка: хук -> endpoint -> демо-режим. */
    function submitBooking(payload) {
        if (typeof HOOKS.onSubmit === 'function') {
            return Promise.resolve(HOOKS.onSubmit(payload)).then(function (result) {
                var res = obj(result);
                return { ok: res.ok !== false, message: str(res.message) };
            });
        }

        var formCfg = obj(CFG.form);
        var endpoint = str(formCfg.endpoint);

        if (endpoint && formCfg.demo !== true) {
            return fetch(endpoint, {
                method: str(formCfg.method) || 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function (response) {
                return response.ok
                    ? { ok: true, message: str(formCfg.successMessage) }
                    : { ok: false, message: 'Не удалось отправить заявку. Позвоните нам — мы на связи.' };
            }).catch(function () {
                return { ok: false, message: 'Сеть недоступна. Позвоните нам — мы на связи.' };
            });
        }

        // Демонстрационный режим: имитируем задержку сервера.
        return new Promise(function (resolve) {
            window.setTimeout(function () { resolve({ ok: true, message: '' }); }, 700);
        });
    }

    function showFormSuccess(payload) {
        var form = $('#booking-form');
        var success = $('#form-success');
        var booking = obj(CFG.booking);

        if (form) { hide(form); }
        if (!success) { return; }

        setText($('#form-success-title'), str(booking.successTitle) || 'Заявка отправлена');
        setText($('#form-success-text'), str(booking.successText) || 'Спасибо! Мы свяжемся с вами в ближайшее время.');

        var text = $('#form-success-text');
        if (text && !str(booking.successText) && str(payload.name)) {
            text.textContent = 'Спасибо, ' + str(payload.name) + '! Мы свяжемся с вами в ближайшее время.';
        }

        show(success);
        if (typeof HOOKS.onSubmitSuccess === 'function') {
            try { HOOKS.onSubmitSuccess(payload); } catch (e) { /* хук не должен ломать форму */ }
        }
        track('submit', payload);
    }

    function initForm() {
        var form = $('#booking-form');
        var reset = $('#form-reset');
        var dateInput = $('#field-date');

        setDateBounds();
        fillServiceSelect();

        if (dateInput) {
            dateInput.addEventListener('focus', setDateBounds, { once: true });
        }

        if (form) {
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                if (formState.submitting) { return; }

                clearFormErrors();
                showFormStatus('');

                var payload = validateForm(form);
                if (!payload) {
                    var firstInvalid = $('.is-invalid', form);
                    if (firstInvalid && firstInvalid.focus) { firstInvalid.focus(); }
                    showFormStatus('Проверьте выделенные поля', 'error');
                    return;
                }

                setSubmitting(true);
                submitBooking(payload).then(function (result) {
                    setSubmitting(false);
                    var res = obj(result);
                    if (res.ok === false) {
                        showFormStatus(str(res.message) || 'Не удалось отправить заявку', 'error');
                        return;
                    }
                    if (str(res.message)) { showFormStatus(str(res.message), 'success'); }
                    showFormSuccess(payload);
                }).catch(function () {
                    setSubmitting(false);
                    showFormStatus('Что-то пошло не так. Позвоните нам — мы на связи.', 'error');
                });
            });

            // Живое снятие ошибки при вводе.
            Array.prototype.forEach.call(form.elements, function (field) {
                if (!field.name) { return; }
                field.addEventListener('input', function () { setFieldError(field.name, ''); });
                field.addEventListener('change', function () { setFieldError(field.name, ''); });
            });
        }

        if (reset) {
            reset.addEventListener('click', function () {
                var success = $('#form-success');
                if (success) { hide(success); }
                if (form) {
                    form.reset();
                    clearFormErrors();
                    showFormStatus('');
                    show(form);
                    var first = $('#field-name');
                    if (first) { first.focus(); }
                }
            });
        }
    }

    /* --------------------------------------------------------------------- */
    /*  12. КОНТАКТЫ                                                         */
    /* --------------------------------------------------------------------- */

    function renderContacts() {
        var contacts = obj(CFG.contacts);
        var list = $('#contacts-list');
        var section = $('#contacts');
        var rows = [];

        setEyebrow('contacts', contacts.eyebrow);
        setTitle('contacts', contacts.title);

        function addRow(label, value, href, iconName) {
            if (!str(value)) { return; }
            rows.push({ label: label, value: str(value), href: href || '', icon: iconName });
        }

        addRow('Телефон', contacts.phone, telHref(contacts.phone), 'phone');
        addRow('Доп. телефон', contacts.phoneAlt, telHref(contacts.phoneAlt), 'phone');
        addRow('E-mail', contacts.email, mailHref(contacts.email), 'mail');
        addRow('Адрес', contacts.address, '', 'pin');
        addRow('Часы работы', contacts.workingHours, '', 'clock');

        if (list) {
            while (list.firstChild) { list.removeChild(list.firstChild); }
            rows.forEach(function (row) {
                var wrap = el('div', 'contact');
                wrap.appendChild(el('dt', 'contact__label', row.label));

                var dd = el('dd', 'contact__value');
                if (row.href) {
                    var link = el('a', 'contact__link', row.value);
                    link.setAttribute('href', row.href);
                    if (row.href.indexOf('tel:') === 0) { link.setAttribute('data-phone', '1'); }
                    dd.appendChild(link);
                } else {
                    dd.appendChild(document.createTextNode(row.value));
                }
                wrap.appendChild(dd);
                list.appendChild(wrap);
            });
            if (!rows.length) { hide(list); }
        }

        // Соцсети — только те, что заполнены.
        var socialWrap = $('#contacts-socials');
        var socials = collectSocials();
        if (socialWrap) {
            while (socialWrap.firstChild) { socialWrap.removeChild(socialWrap.firstChild); }
            socials.forEach(function (item) {
                var link = el('a', 'social-link');
                link.setAttribute('href', item.href);
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
                link.setAttribute('aria-label', item.label);
                link.appendChild(socialIcon(item.key, item.label));
                socialWrap.appendChild(link);
            });
            if (!socials.length) { hide(socialWrap); }
        }

        // Блок карты: показываем, только если есть адрес.
        var mapWrap = $('#contacts-map-wrap');
        if (mapWrap) {
            if (!str(contacts.address)) {
                hide(mapWrap);
            } else {
                setText($('#contacts-map-label'), str(contacts.district) || 'Адрес');
                setText($('#contacts-map-address'), contacts.address);
                var mapUrl = safeHref(contacts.mapUrl);
                if (mapUrl) {
                    mapWrap.classList.add('is-link');
                    mapWrap.setAttribute('role', 'link');
                    mapWrap.setAttribute('tabindex', '0');
                    mapWrap.addEventListener('click', function () { window.open(mapUrl, '_blank', 'noopener'); });
                    mapWrap.addEventListener('keydown', function (event) {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            window.open(mapUrl, '_blank', 'noopener');
                        }
                    });
                }
            }
        }

        // Телефон в блоке записи и в мобильной панели.
        var phone = str(contacts.phone);
        var phoneHref = telHref(phone);

        var bookingPhone = $('#booking-phone');
        if (bookingPhone) {
            if (phone && phoneHref) {
                var link = el('a', '', phone);
                link.setAttribute('href', phoneHref);
                while (bookingPhone.firstChild) { bookingPhone.removeChild(bookingPhone.firstChild); }
                bookingPhone.appendChild(link);
                show(bookingPhone);
            } else {
                hide(bookingPhone);
            }
        }

        var mobileCall = $('#mobile-cta-call');
        if (mobileCall) {
            if (phone && phoneHref) {
                mobileCall.setAttribute('href', phoneHref);
                show(mobileCall);
            } else {
                mobileCall.removeAttribute('href');
                mobileCall.setAttribute('aria-hidden', 'true');
                hide(mobileCall);
            }
        }

        // Пустые секции не должны оставлять дырок.
        if (!rows.length && !socials.length && !str(obj(CFG.contacts).address)) {
            hide(section);
        }
    }

    function collectSocials() {
        var social = obj(CFG.social);
        var result = [];
        ['telegram', 'whatsapp', 'instagram', 'vk', 'youtube'].forEach(function (key) {
            var href = socialHref(key, social[key]);
            if (!href) { return; }
            var meta = SOCIAL_META.filter(function (m) { return m.key === key; })[0];
            result.push({ key: key, href: href, label: meta ? meta.label : key });
        });
        return result;
    }

    /* --------------------------------------------------------------------- */
    /*  13. БЛОК ЗАПИСИ                                                      */
    /* --------------------------------------------------------------------- */

    function renderBooking() {
        var booking = obj(CFG.booking);
        var section = $('#booking');
        var contacts = obj(CFG.contacts);
        var formCfg = obj(CFG.form);
        var labels = obj(formCfg.labels);

        setEyebrow('booking', booking.eyebrow);
        setTitle('booking', booking.title);

        var text = $('#booking .booking__text');
        if (text) {
            if (str(booking.text)) { setText(text, booking.text); show(text); } else { hide(text); }
        }

        var note = $('#booking .booking__media-note');
        if (note) {
            var noteText = str(booking.note);
            if (noteText) { setText(note, noteText); show(note); } else { hide(note); }
        }

        var img = $('#booking-image');
        if (img) {
            var src = imageUrl(booking.image, DEMO_IMAGES.booking);
            if (src) {
                img.setAttribute('src', src);
                img.setAttribute('alt', str(booking.note) || ('Атмосфера салона ' + (str(CFG.name) || '')));
                show(img.parentNode);
            } else {
                hide(img.parentNode);
            }
        }

        // Подписи и плейсхолдеры полей можно переопределить из конфига.
        var overrides = [
            ['name', '#field-name', '.field__label'],
            ['phone', '#field-phone', '.field__label'],
            ['service', '#field-service', '.field__label'],
            ['date', '#field-date', '.field__label']
        ];
        overrides.forEach(function (pair) {
            var key = pair[0];
            var label = str(labels[key]);
            if (!label) { return; }
            var field = $(pair[1]);
            if (!field) { return; }
            var wrap = field.closest ? field.closest('.field') : null;
            var labelNode = wrap ? $('.field__label', wrap) : null;
            if (labelNode) { labelNode.textContent = label; }
        });

        var submitLabel = $('#form-submit .form__submit-label');
        if (submitLabel && str(labels.submit)) { submitLabel.textContent = str(labels.submit); }

        // Экран успеха заполняем сразу, чтобы в разметке не оставалось пустых узлов.
        setText($('#form-success-title'), str(booking.successTitle) || 'Заявка отправлена');
        setText($('#form-success-text'), str(booking.successText) || 'Спасибо! Мы свяжемся с вами в ближайшее время.');

        if (!str(booking.title) && !str(booking.text) && !$('#field-name')) {
            hide(section);
        }

        // Если салон не принимает заявки — прячем форму, оставляем телефон.
        if (formCfg.enabled === false) {
            var form = $('#booking-form');
            if (form) { hide(form); }
            var successBlock = $('#form-success');
            if (successBlock) { hide(successBlock); }
            if (!str(contacts.phone)) { hide(section); }
        }
    }

    /* --------------------------------------------------------------------- */
    /*  14. ПОДВАЛ                                                           */
    /* --------------------------------------------------------------------- */

    function renderFooter() {
        var footer = obj(CFG.footer);
        var columnsWrap = $('#footer-columns');
        var contacts = obj(CFG.contacts);

        if (columnsWrap) {
            while (columnsWrap.firstChild) { columnsWrap.removeChild(columnsWrap.firstChild); }

            var configured = asArray(footer.columns).map(obj).filter(function (col) {
                return str(col.title) && asArray(col.links).length;
            });

            var columns = configured;

            if (!columns.length) {
                // Колонки по умолчанию: навигация, контакты, соцсети.
                var navItems = asArray(CFG.nav).map(obj).filter(function (item) { return str(item.label) && str(item.target); });
                var col1 = {
                    title: 'Навигация',
                    links: navItems.map(function (item) {
                        return { label: str(item.label), href: '#' + String(item.target).replace(/^#/, '') };
                    })
                };

                var contactLinks = [];
                if (str(contacts.phone)) { contactLinks.push({ label: str(contacts.phone), href: telHref(contacts.phone) }); }
                if (str(contacts.email)) { contactLinks.push({ label: str(contacts.email), href: mailHref(contacts.email) }); }
                if (str(contacts.address)) { contactLinks.push({ label: str(contacts.address), href: '' }); }
                if (str(contacts.workingHours)) { contactLinks.push({ label: str(contacts.workingHours), href: '' }); }

                var socials = collectSocials();
                var col3 = {
                    title: 'Мы на связи',
                    links: socials.map(function (item) { return { label: item.label, href: item.href, external: true }; })
                };

                columns = [];
                if (col1.links.length) { columns.push(col1); }
                if (contactLinks.length) { columns.push({ title: 'Контакты', links: contactLinks }); }
                if (col3.links.length) { columns.push(col3); }
            }

            columns.forEach(function (column) {
                var col = el('div', 'footer__column');
                col.appendChild(el('h2', 'footer__column-title', column.title));
                var ul = el('ul', 'footer__links');
                asArray(column.links).map(obj).forEach(function (link) {
                    if (!str(link.label)) { return; }
                    var li = el('li');
                    var href = str(link.href);
                    if (href) {
                        var a = el('a', 'footer__link', link.label);
                        a.setAttribute('href', safeHref(href) || '#');
                        if (link.external || /^https?:/i.test(href)) {
                            a.setAttribute('target', '_blank');
                            a.setAttribute('rel', 'noopener noreferrer');
                        }
                        li.appendChild(a);
                    } else {
                        li.appendChild(el('span', 'footer__link footer__link--plain', link.label));
                    }
                    ul.appendChild(li);
                });
                col.appendChild(ul);
                columnsWrap.appendChild(col);
            });

            if (!columnsWrap.children.length) { hide(columnsWrap); }
        }

        var legal = $('#footer-legal');
        if (legal) {
            var parts = [str(footer.legal), str(footer.copyright)];
            var text = parts.filter(Boolean).join(' ');
            if (!text) {
                text = '© ' + (str(CFG.name) || 'Салон красоты');
            }
            legal.textContent = text;
        }

        var year = $('#footer-year');
        if (year) { year.textContent = String(new Date().getFullYear()); }
    }

    /* --------------------------------------------------------------------- */
    /*  15. МОБИЛЬНОЕ МЕНЮ И ПАНЕЛЬ                                          */
    /* --------------------------------------------------------------------- */

    function renderMobileMenuFooter() {
        var wrap = $('#mobile-menu-footer');
        var contacts = obj(CFG.contacts);
        if (!wrap) { return; }

        while (wrap.firstChild) { wrap.removeChild(wrap.firstChild); }

        if (str(contacts.phone)) {
            var phone = el('a', 'mobile-menu__phone', contacts.phone);
            phone.setAttribute('href', telHref(contacts.phone));
            wrap.appendChild(phone);
        }
        if (str(contacts.workingHours)) {
            wrap.appendChild(el('p', 'mobile-menu__hours', contacts.workingHours));
        }
        if (str(contacts.address)) {
            wrap.appendChild(el('p', 'mobile-menu__address', contacts.address));
        }

        var socials = collectSocials();
        if (socials.length) {
            var row = el('div', 'mobile-menu__socials');
            socials.forEach(function (item) {
                var link = el('a', 'social-link');
                link.setAttribute('href', item.href);
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
                link.setAttribute('aria-label', item.label);
                link.appendChild(socialIcon(item.key, item.label));
                row.appendChild(link);
            });
            wrap.appendChild(row);
        }

        if (!wrap.children.length) { hide(wrap); }
    }

    function initMenu() {
        var toggle = $('#menu-toggle');
        var menu = $('#mobile-menu');
        var header = $('#site-header');
        if (!toggle || !menu) { return; }

        var isOpen = false;

        function open() {
            isOpen = true;
            show(menu);
            toggle.setAttribute('aria-expanded', 'true');
            toggle.setAttribute('aria-label', 'Закрыть меню');
            document.body.classList.add('is-menu-open');
            if (header) { header.classList.add('is-menu-open'); }
        }

        function close(restoreFocus) {
            isOpen = false;
            hide(menu);
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Открыть меню');
            document.body.classList.remove('is-menu-open');
            if (header) { header.classList.remove('is-menu-open'); }
            if (restoreFocus) { toggle.focus(); }
        }

        toggle.addEventListener('click', function () { isOpen ? close(true) : open(); });

        menu.addEventListener('click', function (event) {
            var link = event.target.closest ? event.target.closest('a') : null;
            if (link) { close(false); }
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && isOpen) { close(true); }
        });

        window.addEventListener('resize', function () {
            if (isOpen && window.innerWidth > 980) { close(false); }
        });
    }

    /* --------------------------------------------------------------------- */
    /*  16. ПРОКРУТКА, АКТИВНАЯ СЕКЦИЯ, REVEAL                               */
    /* --------------------------------------------------------------------- */

    function initScroll() {
        var header = $('#site-header');
        var mobileCta = $('#mobile-cta');
        var lastY = window.pageYOffset;
        var ticking = false;

        function onScroll() {
            var y = window.pageYOffset;

            if (header) {
                header.classList.toggle('is-scrolled', y > 24);
                // Прячем шапку при прокрутке вниз, показываем при движении вверх.
                if (y > 320) {
                    header.classList.toggle('is-hidden', y > lastY + 6 && !document.body.classList.contains('is-menu-open'));
                } else {
                    header.classList.remove('is-hidden');
                }
            }

            if (mobileCta) {
                var threshold = window.innerHeight * 0.6;
                var booking = document.getElementById('booking');
                var nearBooking = false;
                if (booking) {
                    var rect = booking.getBoundingClientRect();
                    nearBooking = rect.top < window.innerHeight * 0.9 && rect.bottom > 0;
                }
                mobileCta.classList.toggle('is-visible', y > threshold && !nearBooking);
            }

            lastY = y;
            ticking = false;
        }

        window.addEventListener('scroll', function () {
            if (!ticking) { window.requestAnimationFrame(onScroll); ticking = true; }
        }, { passive: true });
        onScroll();

        // Плавный переход с учётом высоты шапки.
        document.addEventListener('click', function (event) {
            var trigger = event.target.closest ? event.target.closest('[data-scroll-to], .nav__link, .footer__link[href^="#"]') : null;
            if (!trigger) { return; }
            var href = trigger.getAttribute('href') || '';
            if (href.charAt(0) !== '#' || href.length < 2) { return; }
            var target = document.getElementById(href.slice(1));
            if (!target) { return; }
            event.preventDefault();

            var offset = header ? header.offsetHeight : 0;
            var top = target.getBoundingClientRect().top + window.pageYOffset - offset + 1;
            window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

            if (history.replaceState) { history.replaceState(null, '', href); }

            // Предвыбор услуги в форме записи.
            var serviceName = trigger.getAttribute('data-service-name');
            if (serviceName) {
                var select = $('#field-service');
                if (select) {
                    for (var i = 0; i < select.options.length; i++) {
                        if (select.options[i].value === serviceName) { select.selectedIndex = i; break; }
                    }
                }
            }
        });
    }

    function initScrollSpy() {
        var links = $$('.nav__link');
        if (!links.length || typeof IntersectionObserver !== 'function') { return; }

        var map = {};
        links.forEach(function (link) {
            var id = link.getAttribute('data-nav-target');
            var section = id ? document.getElementById(id) : null;
            if (section) { map[id] = link; }
        });

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                var link = map[entry.target.id];
                if (!link) { return; }
                var li = link.parentNode;
                if (entry.isIntersecting) {
                    links.forEach(function (other) { other.parentNode.classList.remove('is-active'); });
                    li.classList.add('is-active');
                }
            });
        }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

        Object.keys(map).forEach(function (id) {
            var section = document.getElementById(id);
            if (section) { observer.observe(section); }
        });
    }

    function initReveal() {
        var nodes = $$('.reveal');
        if (!nodes.length) { return; }

        if (typeof IntersectionObserver !== 'function') {
            nodes.forEach(function (node) { node.classList.add('is-visible'); });
            return;
        }

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) { return; }
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

        nodes.forEach(function (node) { observer.observe(node); });
    }

    /* --------------------------------------------------------------------- */
    /*  17. SEO И МИКРОРАЗМЕТКА                                              */
    /* --------------------------------------------------------------------- */

    function setMeta(selector, value) {
        var node = $(selector);
        if (!node) { return; }
        if (str(value)) { node.setAttribute('content', str(value)); }
        else { node.removeAttribute('content'); }
    }

    function renderSeo() {
        var seo = obj(CFG.seo);
        var contacts = obj(CFG.contacts);
        var name = str(CFG.name) || 'Салон красоты';
        var description = str(seo.description) || str(CFG.description);

        var title = str(seo.title);
        if (!title) {
            title = name + (str(CFG.slogan) ? ' — ' + str(CFG.slogan) : (description ? ' — ' + description : ''));
        }
        document.title = title;

        setMeta('#meta-description', description);
        setMeta('#meta-author', name);
        setMeta('#og-title', title);
        setMeta('#og-description', description);
        setMeta('#og-site-name', name);
        setMeta('#tw-title', title);
        setMeta('#tw-description', description);

        var ogImage = imageUrl(seo.ogImage, DEMO_IMAGES.og);
        if (ogImage) {
            setMeta('#og-image', ogImage);
            setMeta('#tw-image', ogImage);
        }

        var locale = str(seo.locale);
        if (locale) {
            var ogLocale = document.querySelector('meta[property="og:locale"]');
            if (!ogLocale) {
                ogLocale = document.createElement('meta');
                ogLocale.setAttribute('property', 'og:locale');
                document.head.appendChild(ogLocale);
            }
            ogLocale.setAttribute('content', locale);
        }

        var keywords = str(seo.keywords);
        var keywordsNode = document.querySelector('meta[name="keywords"]');
        if (keywords) {
            if (!keywordsNode) {
                keywordsNode = document.createElement('meta');
                keywordsNode.setAttribute('name', 'keywords');
                document.head.appendChild(keywordsNode);
            }
            keywordsNode.setAttribute('content', keywords);
        } else if (keywordsNode) {
            keywordsNode.parentNode.removeChild(keywordsNode);
        }

        var canonicalUrl = safeHref(seo.url);
        if (canonicalUrl) {
            var canonical = document.querySelector('link[rel="canonical"]');
            if (!canonical) {
                canonical = document.createElement('link');
                canonical.setAttribute('rel', 'canonical');
                document.head.appendChild(canonical);
            }
            canonical.setAttribute('href', canonicalUrl);
        }

        renderStructuredData(name, description, contacts, seo);
    }

    function renderStructuredData(name, description, contacts, seo) {
        var old = document.getElementById('structured-data');
        if (old) { old.parentNode.removeChild(old); }

        var data = {
            '@context': 'https://schema.org',
            '@type': 'BeautySalon',
            name: name,
            description: description || undefined
        };

        if (str(CFG.slogan)) { data.slogan = str(CFG.slogan); }
        if (str(contacts.phone)) { data.telephone = str(contacts.phone); }
        if (str(contacts.email)) { data.email = str(contacts.email); }

        if (str(contacts.address)) {
            data.address = {
                '@type': 'PostalAddress',
                streetAddress: str(contacts.address),
                addressLocality: str(contacts.district) || 'Москва',
                addressCountry: 'RU'
            };
        }

        if (str(contacts.workingHours)) { data.openingHours = str(contacts.workingHours); }

        var url = safeHref(seo.url);
        if (url) { data.url = url; }

        var image = imageUrl(safeHref(seo.ogImage) || obj(CFG.hero).image, DEMO_IMAGES.og);
        if (image) { data.image = image; }

        var socials = collectSocials();
        if (socials.length) { data.sameAs = socials.map(function (item) { return item.href; }); }

        var services = sectionList(CFG.services).items.map(obj).filter(function (item) { return str(item.name); });
        if (services.length) {
            data.hasOfferCatalog = {
                '@type': 'OfferCatalog',
                name: 'Услуги',
                itemListElement: services.map(function (item) {
                    var offer = { '@type': 'Offer', itemOffered: { '@type': 'Service', name: str(item.name) } };
                    var price = str(item.price).replace(/[^\d]/g, '');
                    if (price) {
                        offer.price = price;
                        offer.priceCurrency = 'RUB';
                    }
                    return offer;
                })
            };
        }

        var script = document.createElement('script');
        script.setAttribute('type', 'application/ld+json');
        script.setAttribute('id', 'structured-data');
        // JSON.stringify экранирует кавычки; textContent не исполняется как разметка.
        script.textContent = JSON.stringify(data, function (key, value) {
            return value === undefined ? undefined : value;
        });
        document.head.appendChild(script);
    }

    /* --------------------------------------------------------------------- */
    /*  18. ПРОЧИЕ ССЫЛКИ                                                   */
    /* --------------------------------------------------------------------- */

    function initLinks() {
        // Все формы записи должны вести в блок booking.
        $$('[data-scroll-to="booking"]').forEach(function (link) {
            link.setAttribute('href', '#booking');
        });

        // Ссылки на телефон: href собирается из конфига.
        var phone = str(obj(CFG.contacts).phone);
        var phoneHref = telHref(phone);
        $$('a[data-phone]').forEach(function (link) {
            if (phoneHref) { link.setAttribute('href', phoneHref); setText(link, phone); }
            else { hide(link); }
        });
    }

    /* --------------------------------------------------------------------- */
    /*  19. ЛОГОТИП-ИЗОБРАЖЕНИЕ                                              */
    /* --------------------------------------------------------------------- */

    function renderLogoImage() {
        var logo = obj(CFG.logo);
        var src = imageUrl(logo.image, '');
        if (!src) { return; }
        var brand = $('.brand');
        if (!brand) { return; }
        var text = $('.brand__text', brand);
        if (!text) { return; }
        var img = document.createElement('img');
        img.setAttribute('src', src);
        img.setAttribute('alt', str(CFG.name));
        img.setAttribute('class', 'brand__image');
        img.setAttribute('height', '34');
        img.setAttribute('decoding', 'async');
        brand.replaceChild(img, text);

        var footerMark = $('.footer__wordmark');
        if (footerMark) {
            var footerImg = document.createElement('img');
            footerImg.setAttribute('src', src);
            footerImg.setAttribute('alt', str(CFG.name));
            footerImg.setAttribute('class', 'footer__logo');
            footerMark.parentNode.replaceChild(footerImg, footerMark);
        }
    }

    /* --------------------------------------------------------------------- */
    /*  20. ЗАПУСК                                                           */
    /* --------------------------------------------------------------------- */

    function render() {
        bindStatic();
        renderIdentity();
        renderHero();
        renderTicker();
        renderNav();
        renderAbout();
        renderServices();
        renderAdvantages();
        renderMasters();
        renderGallery();
        renderReviews();
        renderBooking();
        renderContacts();
        renderFooter();
        renderMobileMenuFooter();
        renderLogoImage();
        renderSeo();
        initLinks();
        // Секции могли скрыться из-за отсутствия данных — чистим меню.
        pruneNav();
    }

    function init() {
        render();
        initForm();
        initMenu();
        initScroll();
        initScrollSpy();
        initReveal();
        initLightbox();
        initReviews();

        var api = {
            config: CFG,
            refresh: function (nextConfig) {
                if (nextConfig && typeof nextConfig === 'object') {
                    CFG = nextConfig;
                    window.SITE_CONFIG = nextConfig;
                    state.reviewIndex = 0;
                    state.galleryItems = [];
                    render();
                }
            },
            openGallery: openLightbox,
            closeGallery: closeLightbox,
            setReview: setReview
        };

        window.SiteTemplate = api;

        if (typeof HOOKS.onReady === 'function') {
            try { HOOKS.onReady(api); } catch (e) { /* хук не должен ломать страницу */ }
        }
        document.documentElement.classList.add('is-ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();