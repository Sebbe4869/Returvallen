/* Returvallen återvinning — site.js
   Innehåller: mobilmeny, samtyckeshantering med Google Consent Mode v2,
   konverteringsspårning (telefon, e-post, formulär) och formulärhantering.

   KONFIGURATION — sätt dessa två värden vid driftsättning:
     FORM_ENDPOINT  URL dit formulären postas (t.ex. en Formspree-adress eller
                    egen e-postskickande endpoint). Lämnas den tom faller
                    formuläret tillbaka på ett förifyllt e-postmeddelande.
     GTM_ID         Google Tag Manager-container. Sätts även i HTML-huvudet.
*/
(function () {
  'use strict';

  var FORM_ENDPOINT = '/skicka.php';      // PHP-skriptet på webbhotellet skickar e-post till Robert
  var CONSENT_KEY = 'rv_consent_v1';

  /* ---------------------------------------------------------------
     1. Samtycke och Google Consent Mode v2
     Standardläget (nekat) och ett sparat val sätts redan i <head>, före
     GTM. Här hanteras bara rutan och nya val.
  ---------------------------------------------------------------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  function readConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }
  function writeConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) { /* privat läge */ }
  }
  function applyConsent(value) {
    var granted = value === 'all';
    gtag('consent', 'update', {
      ad_storage: granted ? 'granted' : 'denied',
      ad_user_data: granted ? 'granted' : 'denied',
      ad_personalization: granted ? 'granted' : 'denied',
      analytics_storage: granted ? 'granted' : 'denied'
    });
    window.dataLayer.push({ event: 'consent_resolved', consent_choice: value });
  }

  function initConsent() {
    var box = document.querySelector('.consent');
    var saved = readConsent();
    if (saved) { window.dataLayer.push({ event: 'consent_resolved', consent_choice: saved }); return; }
    if (!box) return;
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-consent]');
      if (!btn) return;
      var choice = btn.getAttribute('data-consent');
      writeConsent(choice);
      applyConsent(choice);
      document.documentElement.classList.remove('visa-samtycke');
      box.classList.remove('show');
      var main = document.getElementById('innehall');
      if (main) { main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }); }
    });
  }

  /* ---------------------------------------------------------------
     Vågens läge just nu (svensk tid, helgdagar räknas in)
     Öppettiderna är fasta: mån–fre 07:00–16:00. På helgdagar skriver
     sidan "troligen stängt" och ber besökaren ringa.
  ---------------------------------------------------------------- */
  var OPPNAR = 7 * 60, STANGER = 16 * 60;
  var DAGAR = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];

  function paskdag(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
        f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
        h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
        l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
        man = Math.floor((h + l - 7 * m + 114) / 31), dag = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(y, man - 1, dag);
  }
  function helgdag(y, mo, d) {
    var fasta = { '1-1': 'nyårsdagen', '1-6': 'trettondedag jul', '5-1': 'första maj',
      '6-6': 'nationaldagen', '12-24': 'julafton', '12-25': 'juldagen', '12-26': 'annandag jul',
      '12-31': 'nyårsafton' };
    if (fasta[mo + '-' + d]) return fasta[mo + '-' + d];
    var t = Date.UTC(y, mo - 1, d), p = paskdag(y), dag = 864e5;
    if (t === p - 2 * dag) return 'långfredagen';
    if (t === p + dag) return 'annandag påsk';
    if (t === p + 39 * dag) return 'Kristi himmelsfärdsdag';
    if (mo === 6 && d >= 19 && d <= 25 && new Date(t).getUTCDay() === 5) return 'midsommarafton';
    return null;
  }
  function stockholmNu() {
    var delar = {};
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: 'numeric',
      day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false })
      .formatToParts(new Date()).forEach(function (p) { delar[p.type] = parseInt(p.value, 10); });
    var y = delar.year, mo = delar.month, d = delar.day;
    return { y: y, mo: mo, d: d, min: (delar.hour % 24) * 60 + delar.minute,
             vd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
  }
  function arbetsdag(y, mo, d) {
    var vd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    return vd !== 0 && vd !== 6 && !helgdag(y, mo, d);
  }
  function nastaOppning(n) {
    for (var i = 1; i <= 10; i++) {
      var t = new Date(Date.UTC(n.y, n.mo - 1, n.d) + i * 864e5);
      var y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1, d = t.getUTCDate();
      if (arbetsdag(y, mo, d)) return i === 1 ? 'i morgon' : DAGAR[t.getUTCDay()];
    }
    return 'nästa vardag';
  }
  function tid(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + ' tim' + (m ? ' ' + m + ' min' : '') : m + ' min';
  }
  function initStatus() {
    var box = document.querySelector('[data-status]');
    if (!box || !window.Intl) return;
    var rad = box.querySelector('[data-status-rad]'), not = box.querySelector('[data-status-not]');
    function uppdatera() {
      var n = stockholmNu(), hd = helgdag(n.y, n.mo, n.d), lage, html, text;
      if (hd && n.vd !== 0 && n.vd !== 6) {
        lage = 'stangt';
        html = '<strong>Helgdag i dag.</strong> Vi har troligen stängt för ' + hd + '.';
        text = 'Ring 011-10 20 80 innan du kör hit. Vågen öppnar igen ' + nastaOppning(n) + ' 07:00.';
      } else if (n.vd === 0 || n.vd === 6) {
        lage = 'stangt';
        html = '<strong>Stängt i helgen.</strong> Vågen öppnar ' + nastaOppning(n) + ' 07:00.';
        text = 'Skicka en förfrågan längre ned så hör vi av oss när vi öppnar.';
      } else if (n.min < OPPNAR) {
        lage = 'stangt';
        html = '<strong>Öppnar 07:00 i dag.</strong> Om ' + tid(OPPNAR - n.min) + '.';
        text = 'Ta med legitimation om du ska sälja metall.';
      } else if (n.min < STANGER) {
        lage = 'oppet';
        html = '<strong>Öppet nu.</strong> Vågen stänger 16:00, om ' + tid(STANGER - n.min) + '.';
        text = 'Ta med legitimation om du ska sälja metall.';
      } else {
        lage = 'stangt';
        html = '<strong>Stängt för i dag.</strong> Vågen öppnar ' + nastaOppning(n) + ' 07:00.';
        text = 'Skicka en förfrågan längre ned så hör vi av oss när vi öppnar.';
      }
      box.setAttribute('data-lage', lage);
      if (rad.innerHTML !== html) rad.innerHTML = html;
      if (not) not.textContent = text;
    }
    uppdatera();
    setInterval(uppdatera, 60000);
  }

  /* ---------------------------------------------------------------
     Vågsedeln följer stegen: den rad som hör till steget i bild markeras.
  ---------------------------------------------------------------- */
  function initRemsa() {
    var steg = document.querySelectorAll('.steg__ett[data-steg]');
    var rader = document.querySelectorAll('.remsa li[data-steg]');
    if (!steg.length || !rader.length || !('IntersectionObserver' in window)) return;
    function markera(nr) {
      rader.forEach(function (li) { li.classList.toggle('is-nu', li.getAttribute('data-steg') === nr); });
    }
    var io = new IntersectionObserver(function (poster) {
      poster.forEach(function (p) { if (p.isIntersecting) markera(p.target.getAttribute('data-steg')); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steg.forEach(function (s) { io.observe(s); });
  }

  /* ---------------------------------------------------------------
     Innehåll som glider in. Syns alltid utan JavaScript, och efter
     2,5 sekunder även om något här skulle fallera (se <head>).
  ---------------------------------------------------------------- */
  /* ---------------------------------------------------------------
     Snabbkontakt på mobil: visas när besökaren scrollat förbi första
     skärmen, så att Ring-knappen alltid finns nära tummen.
  ---------------------------------------------------------------- */
  function initSnabb() {
    var bar = document.querySelector('.snabbkontakt');
    if (!bar) return;
    var html = document.documentElement, pa = false;
    function kolla() {
      var visa = window.scrollY > window.innerHeight * 0.75;
      if (visa !== pa) { html.classList.toggle('visa-snabb', visa); pa = visa; }
    }
    window.addEventListener('scroll', kolla, { passive: true });
    kolla();
  }

  /* ---------------------------------------------------------------
     Kalkylatorn: riktvärde för skrotet, visat som en vågsedel.
  ---------------------------------------------------------------- */
  function initKalkylator() {
    var form = document.querySelector('[data-kalk]');
    var kvitto = document.querySelector('[data-kvitto]');
    if (!form || !kvitto) return;
    var kr = function (n) { return Math.round(n).toLocaleString('sv-SE'); };
    var kg = function (n) { return n.toLocaleString('sv-SE', { maximumFractionDigits: 2 }); };
    function satt(nyckel, text) { var el = kvitto.querySelector('[data-k="' + nyckel + '"]'); if (el) el.textContent = text; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var opt = form.metall.options[form.metall.selectedIndex];
      var vikt = parseFloat(String(form.vikt.value).replace(',', '.'));
      if (!(vikt > 0)) { form.vikt.focus(); form.vikt.setAttribute('aria-invalid', 'true'); return; }
      form.vikt.removeAttribute('aria-invalid');
      var min = parseFloat(opt.dataset.min), max = parseFloat(opt.dataset.max);
      satt('datum', new Date().toLocaleDateString('sv-SE'));
      satt('metall', opt.textContent);
      satt('vikt', kg(vikt) + ' kg');
      satt('pris', (min === max ? kg(min) : kg(min) + '–' + kg(max)) + ' kr/kg');
      satt('summa', (min === max ? kr(min * vikt) : kr(min * vikt) + '–' + kr(max * vikt)) + ' kr');
      kvitto.hidden = false;
      track('kalkylator', { metall: opt.value, vikt: vikt });
    });
  }

  function initReveal() {
    var el = document.querySelectorAll('[data-reveal]');
    window.rvReveal = true;
    if (!('IntersectionObserver' in window)) { document.documentElement.classList.add('utan-reveal'); return; }
    var io = new IntersectionObserver(function (poster) {
      poster.forEach(function (p) {
        if (p.isIntersecting) { p.target.classList.add('is-in'); io.unobserve(p.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    el.forEach(function (e) { io.observe(e); });
  }

  /* ---------------------------------------------------------------
     2. Mobilmeny
  ---------------------------------------------------------------- */
  function initSubmenu() {
    var knapp = document.querySelector('.has-sub > .navbtn');
    if (!knapp) return;
    var grupp = knapp.parentElement;
    function satt(open) {
      grupp.classList.toggle('open', open);
      knapp.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    knapp.addEventListener('click', function (e) {
      e.stopPropagation();
      satt(!grupp.classList.contains('open'));
    });
    document.addEventListener('click', function (e) {
      if (!grupp.contains(e.target)) satt(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && grupp.classList.contains('open')) { satt(false); knapp.focus(); }
    });
  }

  /* ---------------------------------------------------------------
     Pausa animationer (WCAG 2.2.2). Växlar animerade illustrationer
     till sina stillbilder och minns valet.
  ---------------------------------------------------------------- */
  var RORELSE_KEY = 'rv_rorelse_v1';
  function initRorelse() {
    var knapp = document.querySelector('[data-rorelse]');
    var bilder = Array.prototype.slice.call(document.querySelectorAll('img[data-stilla]'));
    if (!knapp) return;
    if (!bilder.length) { knapp.hidden = true; return; }
    bilder.forEach(function (im) { im.dataset.rorlig = im.getAttribute('src'); });
    function satt(pausad, spara) {
      bilder.forEach(function (im) {
        im.setAttribute('src', pausad ? im.dataset.stilla : im.dataset.rorlig);
      });
      knapp.setAttribute('aria-pressed', pausad ? 'true' : 'false');
      knapp.textContent = pausad ? 'Starta animationer' : 'Pausa animationer';
      if (spara) { try { localStorage.setItem(RORELSE_KEY, pausad ? 'pausad' : 'rorlig'); } catch (e) {} }
    }
    var sparat = null;
    try { sparat = localStorage.getItem(RORELSE_KEY); } catch (e) {}
    if (sparat === 'pausad') satt(true, false);
    knapp.addEventListener('click', function () {
      satt(knapp.getAttribute('aria-pressed') !== 'true', true);
    });
  }

  function initMenu() {
    var burger = document.querySelector('.burger');
    var nav = document.querySelector('nav.main');
    if (!burger || !nav) return;
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        burger.focus();
      }
    });
  }

  /* ---------------------------------------------------------------
     3. Konverteringsspårning
     Varje händelse hamnar i dataLayer och kan tas emot som konvertering
     i GA4 och importeras till Google Ads.
  ---------------------------------------------------------------- */
  function track(name, params) {
    var payload = { event: name };
    for (var k in params) { if (Object.prototype.hasOwnProperty.call(params, k)) payload[k] = params[k]; }
    window.dataLayer.push(payload);
  }

  function initClickTracking() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('tel:') === 0) {
        track('telefonklick', { kontaktvag: 'telefon', sida: location.pathname, placering: a.dataset.plats || 'okand' });
      } else if (href.indexOf('mailto:') === 0) {
        track('mejlklick', { kontaktvag: 'e-post', sida: location.pathname, placering: a.dataset.plats || 'okand' });
      } else if (a.hasAttribute('data-kundportal')) {
        track('kundportal_klick', { sida: location.pathname });
      }
    });
  }

  /* ---------------------------------------------------------------
     4. Formulär
  ---------------------------------------------------------------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setError(field, message) {
    field.classList.toggle('err', !!message);
    var msg = field.querySelector('.msg');
    if (msg) msg.textContent = message || '';
    var input = field.querySelector('input,select,textarea');
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function validate(form) {
    var ok = true;
    var first = null;
    form.querySelectorAll('.field').forEach(function (field) {
      var input = field.querySelector('input,select,textarea');
      if (!input || !input.required) { setError(field, ''); return; }
      var v = (input.value || '').trim();
      var problem = '';
      if (!v) {
        problem = 'Fyll i det här fältet.';
      } else if (input.type === 'email' && !EMAIL_RE.test(v)) {
        problem = 'Kontrollera e-postadressen.';
      } else if (input.type === 'tel' && v.replace(/[^0-9]/g, '').length < 7) {
        problem = 'Ange ett telefonnummer vi kan nå dig på.';
      }
      setError(field, problem);
      if (problem) { ok = false; if (!first) first = input; }
    });
    var consentBox = form.querySelector('input[name="samtycke"]');
    if (consentBox && !consentBox.checked) {
      ok = false;
      if (!first) first = consentBox;
      var row = consentBox.closest('.checkrow');
      if (row) row.style.color = '#A32D1C';
    }
    if (first) first.focus();
    return ok;
  }

  function showStatus(form, type, text) {
    var box = form.querySelector('.formstatus');
    if (!box) return;
    box.className = 'formstatus show ' + type;
    box.textContent = text;
    box.setAttribute('role', 'status');
  }

  function mailtoFallback(form, data) {
    var subject = form.dataset.subject || 'Förfrågan från returvallen.se';
    var lines = [];
    Object.keys(data).forEach(function (k) {
      if (k === 'samtycke' || k === 'foretagsnamn_hp') return;
      lines.push(k.replace(/_/g, ' ') + ': ' + data[k]);
    });
    var href = 'mailto:robert@returvallen.se'
      + '?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(lines.join('\n'));
    window.location.href = href;
  }

  function initForms() {
    document.querySelectorAll('form.rv').forEach(function (form) {
      form.setAttribute('novalidate', 'novalidate');
      form.addEventListener('submit', function (e) {
        e.preventDefault();

        // Enkel robotfälla: dolt fält som människor lämnar tomt.
        if ((form.querySelector('input[name="foretagsnamn_hp"]') || {}).value) return;

        if (!validate(form)) {
          showStatus(form, 'bad', 'Något saknas. Se de markerade fälten ovan.');
          return;
        }

        var data = {};
        new FormData(form).forEach(function (v, k) { data[k] = v; });
        var formNamn = form.dataset.formnamn || 'formular';

        var btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Skickar…'; }

        function done(success, meddelande) {
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
          if (!success && meddelande) { showStatus(form, 'bad', meddelande); return; }
          if (success) {
            track('formular_skickat', { formular: formNamn, sida: location.pathname });
            form.reset();
            showStatus(form, 'ok', 'Tack! Din förfrågan är skickad. Vi hör av oss under kontorstid.');
          } else {
            showStatus(form, 'bad', 'Det gick inte att skicka just nu. Ring 011-10 20 80 så hjälper vi dig direkt.');
          }
        }

        if (!FORM_ENDPOINT) {
          track('formular_skickat', { formular: formNamn, sida: location.pathname, metod: 'mailto' });
          mailtoFallback(form, data);
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
          showStatus(form, 'ok', 'Ditt e-postprogram öppnas med förfrågan ifylld. Skicka meddelandet så tar vi hand om det.');
          return;
        }

        var fd = new FormData(form);
        fd.append('sida', location.pathname);
        fetch(FORM_ENDPOINT, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: fd
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (svar) { done(r.ok && svar.ok !== false, svar.meddelande); });
        }).catch(function () { done(false); });
      });
    });
  }

  /* ---------------------------------------------------------------
     Start
  ---------------------------------------------------------------- */
  function boot() {
    initConsent();
    initReveal();
    initStatus();
    initRemsa();
    initSnabb();
    initKalkylator();
    initMenu();
    initSubmenu();
    initRorelse();
    initClickTracking();
    initForms();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
