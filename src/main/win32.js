'use strict';
// Chamadas diretas da API do Windows (via koffi): janelas, teclado e mouse.
// HWNDs sao tratados como inteiros (intptr) para poderem ir para a interface via IPC.

const koffi = require('koffi');
const path = require('path');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// --- Estruturas do SendInput (x64: INPUT tem 40 bytes) ----------------------
const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
});
const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'int32',
  dy: 'int32',
  mouseData: 'uint32',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
});
// O INPUT original e uma union; como so usamos um membro por chamada, cada
// variante vira uma struct propria com o mesmo tamanho total
const INPUT_KEY = koffi.struct('INPUT_KEY', {
  type: 'uint32',
  ki: KEYBDINPUT,
  _pad: koffi.array('uint8', 8),
});
const INPUT_MOUSE = koffi.struct('INPUT_MOUSE', {
  type: 'uint32',
  mi: MOUSEINPUT,
});

const SendInputKey = user32.func('uint32 __stdcall SendInput(uint32 n, INPUT_KEY *inputs, int size)');
const SendInputMouse = user32.func('uint32 __stdcall SendInput(uint32 n, INPUT_MOUSE *inputs, int size)');
const INPUT_SIZE = koffi.sizeof(INPUT_KEY);

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr hwnd, intptr lParam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr lParam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr hwnd)');
const IsWindow = user32.func('bool __stdcall IsWindow(intptr hwnd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(intptr hwnd, void *buf, int max)');
const GetWindowThreadProcessId = user32.func(
  'uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)');
const GetForegroundWindow = user32.func('intptr __stdcall GetForegroundWindow()');
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)');
const SetWindowLongPtrW = user32.func('intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr value)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint32 flags)');

const dwmapi = koffi.load('dwmapi.dll');
const DwmGetWindowAttribute = dwmapi.func(
  'int32 __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ uint32 *value, uint32 size)');

const OpenProcess = kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(intptr h, uint32 flags, void *buf, _Inout_ uint32 *size)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr h)');

const version = koffi.load('version.dll');
const GetFileVersionInfoSizeW = version.func('uint32 __stdcall GetFileVersionInfoSizeW(str16 file, _Out_ uint32 *handle)');
const GetFileVersionInfoW = version.func('bool __stdcall GetFileVersionInfoW(str16 file, uint32 handle, uint32 len, void *buf)');
const VerQueryValueW = version.func('bool __stdcall VerQueryValueW(void *buf, str16 sub, _Out_ void **out, _Out_ uint32 *len)');

const INPUT_MOUSE_TYPE = 0;
const INPUT_KEYBOARD_TYPE = 1;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const GWL_EXSTYLE = -20;
const GWL_STYLE = -16;
const WS_POPUP = 0x80000000;
const WS_MINIMIZEBOX = 0x00020000;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOZORDER = 0x4;
const SWP_NOACTIVATE = 0x10;
const SWP_FRAMECHANGED = 0x20;
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_CLOAKED = 14;

const MOUSE = {
  leftDown: 0x0002,
  leftUp: 0x0004,
  rightDown: 0x0008,
  rightUp: 0x0010,
};

// Scan codes (set 1): o DZ le o teclado por scan code, nao por virtual key
const SCAN = { shift: 0x2a, w: 0x11 };

function windowText(hwnd) {
  const buf = Buffer.alloc(512 * 2);
  const len = GetWindowTextW(hwnd, buf, 512);
  return len > 0 ? buf.toString('utf16le', 0, len * 2) : '';
}

function windowPid(hwnd) {
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
}

function processName(pid) {
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!h) return '?';
  try {
    const buf = Buffer.alloc(1024 * 2);
    const size = [1024];
    if (!QueryFullProcessImageNameW(h, 0, buf, size)) return '?';
    return path.basename(buf.toString('utf16le', 0, size[0] * 2));
  } finally {
    CloseHandle(h);
  }
}

/**
 * Janela que aparece de verdade para o usuario: visivel, nao e janela de ferramenta
 * e nao esta "cloaked" (janelas internas do Windows, como as do teclado virtual)
 */
function isUserWindow(hwnd) {
  if (!IsWindowVisible(hwnd)) return false;
  if (Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) return false;
  const cloaked = [0];
  if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0]) return false;
  return true;
}

/** Janelas visiveis com titulo: [{ hwnd, title, process, pid }] */
function listWindows() {
  const result = [];
  EnumWindows((hwnd) => {
    try {
      if (isUserWindow(hwnd)) {
        const title = windowText(hwnd).trim();
        if (title) {
          const pid = windowPid(hwnd);
          result.push({ hwnd: Number(hwnd), title, process: processName(pid), pid });
        }
      }
    } catch {
      // janela sumiu no meio da enumeracao
    }
    return true;
  }, 0);
  return result;
}

/** Versao do arquivo (a.b.c.d) gravada no executavel, ou null se nao der pra ler */
function fileVersion(file) {
  try {
    const size = GetFileVersionInfoSizeW(file, [0]);
    if (!size) return null;
    const buf = Buffer.alloc(size);
    if (!GetFileVersionInfoW(file, 0, size, buf)) return null;
    const fixed = [null];
    if (!VerQueryValueW(buf, '\\', fixed, [0]) || !fixed[0]) return null;
    // VS_FIXEDFILEINFO: assinatura, versao da estrutura, versao do arquivo (alta e baixa)
    const [, , ms, ls] = koffi.decode(fixed[0], koffi.array('uint32', 4));
    return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff];
  } catch {
    return null;
  }
}

/**
 * Troca o estilo de uma janela sem moldura do Electron para "popup". O Windows nao deixa uma janela comum ficar com
 * menos de ~39 px de altura (o Electron cria as sem moldura como janelas comuns); uma popup pode ter o tamanho que for.
 * handle = o Buffer de BrowserWindow.getNativeWindowHandle().
 */
function makePopup(handle) {
  const hwnd = Number(handle.readBigUInt64LE(0));
  const style = Number(GetWindowLongPtrW(hwnd, GWL_STYLE)) >>> 0;
  SetWindowLongPtrW(hwnd, GWL_STYLE, ((style | WS_POPUP) & ~WS_MINIMIZEBOX) >>> 0);
  SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
}

function isWindow(hwnd) {
  return !!hwnd && IsWindow(hwnd);
}

function isForeground(hwnd) {
  return !!hwnd && Number(GetForegroundWindow()) === hwnd;
}

function sendKey(name, up) {
  const input = {
    type: INPUT_KEYBOARD_TYPE,
    ki: {
      wVk: 0,
      wScan: SCAN[name],
      dwFlags: KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0),
      time: 0,
      dwExtraInfo: 0,
    },
    _pad: new Array(8).fill(0),
  };
  return SendInputKey(1, [input], INPUT_SIZE);
}

const keyDown = (name) => sendKey(name, false);
const keyUp = (name) => sendKey(name, true);

function mouse(flag) {
  const input = {
    type: INPUT_MOUSE_TYPE,
    mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: MOUSE[flag], time: 0, dwExtraInfo: 0 },
  };
  return SendInputMouse(1, [input], INPUT_SIZE);
}

module.exports = {
  listWindows,
  isWindow,
  isForeground,
  keyDown,
  keyUp,
  mouse,
  windowText,
  fileVersion,
  makePopup,
  INPUT_SIZE,
};
