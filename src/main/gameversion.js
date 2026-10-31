'use strict';
// Versao do DZ instalado no PC (lida do DayZ_x64.exe na biblioteca do Steam), para comparar com a do servidor.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const win32 = require('./win32');

const GAME_EXE = path.join('steamapps', 'common', 'DayZ', 'DayZ_x64.exe');
const DEFAULT_STEAM_DIRS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
];

/** Pasta do Steam registrada no Windows, ou null */
function registrySteamDir() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, out) => {
      const match = !err && /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
      resolve(match ? path.normalize(match[1].trim()) : null);
    });
  });
}

/** Pastas de biblioteca do Steam (a do proprio Steam mais as extras do libraryfolders.vdf) */
function libraryDirs(steamDir) {
  const dirs = [steamDir];
  try {
    const vdf = fs.readFileSync(path.join(steamDir, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) dirs.push(m[1].replace(/\\\\/g, '\\'));
  } catch {
    // sem o arquivo: so a pasta do Steam
  }
  return dirs;
}

/** Caminho do DayZ_x64.exe, ou null se o jogo nao esta numa biblioteca do Steam */
async function findGameExe() {
  const steamDirs = [await registrySteamDir(), ...DEFAULT_STEAM_DIRS].filter(Boolean);
  for (const steamDir of steamDirs) {
    for (const lib of libraryDirs(steamDir)) {
      const exe = path.join(lib, GAME_EXE);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

/**
 * "1.30.164.200" (versao do arquivo) -> "1.30.164200", o formato que o servidor informa na A2S:
 * o numero da build e a ultima parte do arquivo, completada com zeros.
 */
function formatFileVersion([major, minor, build, revision]) {
  return `${major}.${minor}.${build * 1000 + revision}`;
}

/** [major, minor, build] de um texto como "1.30.164200", ou null */
function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return match ? match.slice(1, 4).map(Number) : null;
}

/** 'same' | 'client-old' | 'server-old' | null (versao ilegivel) */
function compareVersions(client, server) {
  const c = parseVersion(client);
  const s = parseVersion(server);
  if (!c || !s) return null;
  for (let i = 0; i < 3; i++) {
    if (c[i] !== s[i]) return c[i] < s[i] ? 'client-old' : 'server-old';
  }
  return 'same';
}

let exePath;

/** Versao do DZ do usuario ("1.30.164200") ou null. O caminho e achado uma vez; a versao e relida sempre (o jogo atualiza). */
async function clientVersion() {
  if (exePath === undefined || (exePath && !fs.existsSync(exePath))) exePath = await findGameExe();
  const parts = exePath && win32.fileVersion(exePath);
  return parts ? formatFileVersion(parts) : null;
}

/** Esquece o caminho guardado: a proxima leitura procura o jogo de novo (ex.: foi instalado depois) */
function forget() {
  exePath = undefined;
}

module.exports = { clientVersion, compareVersions, formatFileVersion, parseVersion, forget };
