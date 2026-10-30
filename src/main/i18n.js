'use strict';
// Idiomas do app. Os textos ficam em src/locales/<codigo>.json (chave plana -> texto, com {parametros}).
// Falta de chave no idioma escolhido cai para o ingles; falta no ingles mostra a propria chave.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'locales');
// Ordem do menu: o idioma de origem do app primeiro, depois os mais falados no mundo
const CODES = ['pt-BR', 'en', 'es', 'fr', 'zh-CN', 'hi'];
const FALLBACK = 'en';

const strings = Object.fromEntries(CODES.map((code) => [
  code, JSON.parse(fs.readFileSync(path.join(DIR, `${code}.json`), 'utf8')),
]));
const languages = CODES.map((code) => ({ code, name: strings[code]['meta.name'] }));

/** Idioma do Windows (ex.: "pt-BR", "es-419", "zh-TW") -> um dos idiomas do app */
function detect(locale) {
  const tag = String(locale || '').toLowerCase();
  const match = CODES.find((code) => code.toLowerCase() === tag)
    || CODES.find((code) => code.split('-')[0].toLowerCase() === tag.split('-')[0]);
  return match || FALLBACK;
}

function translate(language, key, params = {}) {
  const text = strings[language]?.[key] ?? strings[FALLBACK][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

class I18n {
  constructor(settings, systemLocale) {
    this.settings = settings;
    const saved = settings.data.app.language;
    // Sem escolha salva: usa o idioma do sistema (e so grava quando a pessoa escolher no menu)
    this.language = CODES.includes(saved) ? saved : detect(systemLocale);
  }

  t(key, params) {
    return translate(this.language, key, params);
  }

  /** Tudo que a interface precisa para se desenhar neste idioma */
  payload() {
    return { language: this.language, languages, strings: { ...strings[FALLBACK], ...strings[this.language] } };
  }

  set(code) {
    if (!CODES.includes(code)) throw new Error(`Idioma nao suportado: ${code}`);
    this.language = code;
    this.settings.data.app.language = code;
    this.settings.save();
    return this.payload();
  }
}

module.exports = { I18n, detect, CODES };
