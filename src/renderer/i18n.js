'use strict';
// Textos da interface no idioma escolhido. Eles chegam do processo principal (src/locales/*.json).
// No HTML: data-i18n (texto), data-i18n-html (texto com <kbd>/<strong>/<em> dos nossos proprios
// arquivos de idioma), data-i18n-title, data-i18n-placeholder e data-i18n-aria.

const i18n = { language: 'pt-BR', languages: [], strings: {} };

function t(key, params = {}) {
  const text = i18n.strings[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

function applyTranslations(root = document) {
  document.documentElement.lang = i18n.language;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}

function setI18nPayload(payload) {
  Object.assign(i18n, payload);
}
