'use strict';
// Consulta Steam A2S_INFO (UDP) para saber se um servidor de DZ esta de pe.

const dgram = require('dgram');

const REQUEST = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
  Buffer.from('Source Engine Query\0', 'latin1'),
]);

/**
 * Portas de consulta testadas quando o usuario nao informa uma. Um mesmo IP
 * costuma hospedar varios servidores (cada um com sua porta de consulta), por
 * isso a resposta certa e escolhida pela porta do jogo, nao pela primeira que chegar.
 */
function candidatePorts(gamePort, queryPort) {
  if (queryPort) return [queryPort];
  const ports = [gamePort, gamePort + 1, gamePort + 2];
  for (let p = 27015; p <= 27025; p++) ports.push(p);
  return [...new Set(ports.filter((p) => p > 0 && p < 65536))];
}

function readString(buf, pos) {
  const end = buf.indexOf(0, pos);
  if (end < 0) throw new RangeError('string sem fim');
  return [buf.toString('utf8', pos, end), end + 1];
}

/**
 * As "keywords" do DZ trazem, entre outras tags, a hora do jogo no servidor (HH:MM, sempre a ultima)
 * e a fila de login (lqsN). A hora e repassada como o servidor informa, sem calcular nada em cima dela.
 */
function parseKeywords(text) {
  const tokens = String(text || '').split(',');
  const number = (re) => {
    const match = tokens.map((t) => re.exec(t)).find(Boolean);
    return match ? Number(match[1]) : null;
  };
  const clock = tokens.map((t) => /^(\d{1,2}):(\d{2})$/.exec(t)).find(Boolean);
  const out = { time: null, queue: number(/^lqs(\d+)$/) };
  if (!clock) return out;

  const minutes = Number(clock[1]) * 60 + Number(clock[2]);
  if (minutes >= 24 * 60) return out;
  out.time = `${clock[1].padStart(2, '0')}:${clock[2]}`;
  return out;
}

/** { name, map, players, maxPlayers, gamePort, version, locked, time, queue } ou null se a resposta nao der pra ler */
function parseInfo(buf) {
  try {
    if (buf[4] !== 0x49) return null;
    let pos = 6; // cabecalho (4) + tipo (1) + versao do protocolo (1)
    let name, map, version;
    [name, pos] = readString(buf, pos);
    [map, pos] = readString(buf, pos);
    [, pos] = readString(buf, pos); // pasta
    [, pos] = readString(buf, pos); // jogo
    pos += 2; // app id
    const players = buf[pos];
    const maxPlayers = buf[pos + 1];
    const locked = buf[pos + 5] === 1; // visibilidade: 1 = com senha (e como o servidor aparece trancado)
    pos += 7; // jogadores, max, bots, tipo, sistema, senha, VAC
    [version, pos] = readString(buf, pos);

    // Extra Data Flag: cada bit indica um campo opcional, na ordem abaixo
    let gamePort = null;
    let keywords = '';
    try {
      const flag = pos < buf.length ? buf[pos++] : 0;
      if (flag & 0x80) { gamePort = buf.readUInt16LE(pos); pos += 2; }
      if (flag & 0x10) pos += 8; // SteamID do servidor
      if (flag & 0x40) { pos += 2; [, pos] = readString(buf, pos); } // porta e nome do SourceTV
      if (flag & 0x20) [keywords] = readString(buf, pos);
    } catch {
      // campos extras truncados: o basico ja foi lido
    }
    return { name, map, players, maxPlayers, gamePort, version, locked, ...parseKeywords(keywords) };
  } catch {
    return null;
  }
}

/**
 * Envia A2S_INFO para todas as portas ao mesmo tempo.
 *
 * Com gamePort, so aceita o servidor que informar essa porta do jogo; respostas
 * sem a porta ficam de reserva caso nenhuma bata. Resolve { port, info, ping } (ping em ms) ou null.
 */
function queryServer(ip, ports, { gamePort = null, timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const sockets = [];
    let done = false;
    let fallback = null;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const s of sockets) {
        try { s.close(); } catch { /* ja fechado */ }
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish(fallback), timeoutMs);

    for (const port of ports) {
      const s = dgram.createSocket('udp4');
      let sentAt = Date.now();
      const send = (data) => {
        sentAt = Date.now();
        s.send(data, port, ip, () => {});
      };
      sockets.push(s);
      s.on('error', () => { /* ICMP "porta fechada": essa porta nao serve */ });
      s.on('message', (msg) => {
        if (msg.length >= 9 && msg[4] === 0x41) {
          // challenge: repete o pedido com o numero recebido
          send(Buffer.concat([REQUEST, msg.subarray(5, 9)]));
          return;
        }
        if (msg.length <= 5 || msg[4] !== 0x49) return;
        const info = parseInfo(msg);
        if (!gamePort || info?.gamePort === gamePort) {
          finish({ port, info, ping: Date.now() - sentAt });
        } else if (info?.gamePort == null && !fallback) {
          fallback = { port, info, ping: Date.now() - sentAt };
        }
        // porta do jogo diferente: e outro servidor no mesmo IP, ignora
      });
      send(REQUEST);
    }
  });
}

module.exports = { queryServer, candidatePorts, parseInfo, parseKeywords };
