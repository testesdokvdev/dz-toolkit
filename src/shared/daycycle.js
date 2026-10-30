'use strict';
// Janela da noite no jogo, em horas do jogo, para o icone de sol/lua. O servidor nao informa o por do sol nem o
// amanhecer, entao vale um padrao fixo: anoitece as 18:00 e amanhece as 06:00.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DayCycle = factory();
}(this, () => {
  const DUSK = 18 * 60;
  const DAWN = 6 * 60;

  /** "HH:MM" -> minutos desde a meia-noite; null se o texto nao e uma hora valida */
  function minutesOf(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : null;
  }

  /** A hora do jogo ("HH:MM") esta na noite? null se `time` nao e uma hora. */
  function isNight(time) {
    const now = minutesOf(time);
    return now === null ? null : now >= DUSK || now < DAWN;
  }

  return { isNight };
}));
