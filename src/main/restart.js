'use strict';
// Decide quando avisar que o servidor voltou de um restart. So a A2S responder nao basta: o servidor
// pode estar subindo ou trancado, e pode ate estar no ar antes do restart comecar. Por isso:
//  1. so conta como "voltou" depois de ver o servidor sair do ar (ou trancar/reiniciar) neste monitoramento;
//  2. "trancado" (campo de senha da A2S, em servidor que normalmente e aberto) nao conta;
//  3. "iniciando" (sem a hora do jogo, em servidor que normalmente a publica) nao conta, por no maximo 1 minuto;
//  4. depois disso ele precisa responder normalmente por `confirmNeeded` consultas seguidas.
// `learned` ({ open, time }) e o que ja se viu desse servidor funcionando: sem isso, um servidor com senha
// ou sem hora nas tags nunca seria avisado.

/** 'ready' | 'locked' | 'starting' */
function readiness(info, learned, startingForMs, startingMaxMs) {
  if (info.locked && learned.open) return 'locked';
  if (!info.time && learned.time && startingForMs <= startingMaxMs) return 'starting';
  return 'ready';
}

class RestartWatcher {
  constructor({ confirmNeeded, downNeeded, startingMaxMs }) {
    Object.assign(this, { confirmNeeded, downNeeded, startingMaxMs });
    this.armed = false; // ja viu o servidor sair do ar
    this.misses = 0;
    this.okStreak = 0;
    this.startingSince = null;
    this.phase = 'checking'; // checking | waiting | offline | locked | starting | confirming | online
  }

  /** info = resposta da A2S (ou null se nao respondeu). Devolve true quando deve avisar. */
  feed(info, learned, now = Date.now()) {
    if (!info) {
      this.okStreak = 0;
      this.startingSince = null;
      // Uma consulta perdida e comum; so varias seguidas contam como "saiu do ar"
      if (++this.misses >= this.downNeeded) this.armed = true;
      if (this.armed) this.phase = 'offline';
      return false;
    }
    this.misses = 0;

    if (!info.time && learned.time) this.startingSince ??= now;
    else this.startingSince = null;
    const state = readiness(info, learned, this.startingSince == null ? 0 : now - this.startingSince, this.startingMaxMs);

    if (state !== 'ready') {
      this.armed = true;
      this.okStreak = 0;
      this.phase = state;
      return false;
    }
    if (!this.armed) {
      this.phase = 'waiting';
      return false;
    }
    this.phase = ++this.okStreak >= this.confirmNeeded ? 'online' : 'confirming';
    return this.phase === 'online';
  }
}

module.exports = { RestartWatcher };
