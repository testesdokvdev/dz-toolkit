'use strict';
// Relogio na tela: mostra a hora do jogo exatamente como o servidor informa (o app consulta o servidor de poucos em
// poucos segundos enquanto o relogio esta ligado) e, ao lado, sol ou lua conforme essa hora. Nada e calculado para frente.

const $ = (id) => document.getElementById(id);

/** Diz a janela o tamanho do cartao (so quando muda) para ela ficar exatamente desse tamanho */
let sent = '';
function fit() {
  const inner = $('inner').getBoundingClientRect();
  if (!inner.width) return;
  const style = getComputedStyle($('clock'));
  const px = (name) => Number.parseFloat(style[name]) || 0;
  const width = Math.ceil(inner.width + px('paddingLeft') + px('paddingRight') + px('borderLeftWidth') + px('borderRightWidth'));
  const height = Math.ceil(inner.height + px('paddingTop') + px('paddingBottom') + px('borderTopWidth') + px('borderBottomWidth'));
  const size = `${width}x${height}`;
  if (size === sent) return;
  sent = size;
  window.overlay.resize(width, height);
}

window.overlay.onData(({ time }) => {
  $('time').textContent = time;
  const night = DayCycle.isNight(time);
  $('sky').innerHTML = night === null ? '' : icon(night ? 'moon' : 'sun');
  $('sky').className = `sky ${night ? 'night' : 'day'}`;
  $('clock').classList.remove('hidden');
  fit();
});
