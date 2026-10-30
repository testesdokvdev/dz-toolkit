'use strict';
// "Novidades": depois de atualizar, o app mostra uma vez o que mudou na versao. O texto vem de
// src/changelog.json (gerado por scripts/changelog.js a partir de build/release-notes*.md),
// so em portugues e ingles; os demais idiomas mostram o ingles.

const FALLBACK = 'en';

class WhatsNew {
  constructor(settings, i18n, version) {
    this.settings = settings;
    this.i18n = i18n;
    this.version = version;
    try {
      this.changelog = require('../changelog.json');
    } catch {
      this.changelog = null;
    }
    // Instalacao nova: nao ha o que "ter mudado" ainda, entao ja conta como visto
    if (!settings.existed) this.markSeen();
  }

  /** { version, notes, auto } ou null se nao ha novidades escritas para esta versao */
  get() {
    const { changelog } = this;
    if (!changelog || changelog.version !== this.version) return null;
    const notes = changelog.notes[this.i18n.language] || changelog.notes[FALLBACK];
    if (!notes?.length) return null;
    return { version: this.version, notes, auto: this.settings.data.app.seenVersion !== this.version };
  }

  markSeen() {
    this.settings.data.app.seenVersion = this.version;
    this.settings.save();
  }
}

module.exports = { WhatsNew };
