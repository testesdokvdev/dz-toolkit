'use strict';
// Abre o app em modo desenvolvimento. Remove ELECTRON_RUN_AS_NODE, que o VS Code
// (tambem feito em Electron) repassa aos terminais e faria o Electron rodar como Node.
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Sem argumentos abre o app; com argumentos roda o script indicado (ex.: scripts/make-icon.js)
const args = process.argv.length > 2 ? process.argv.slice(2) : ['.'];
const child = spawn(electron, args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
