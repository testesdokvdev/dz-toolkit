'use strict';
// Captura o som de UM programa (o DayZ), sem pegar o resto do PC: "process loopback" do WASAPI, a mesma captura
// por processo que o Chrome usa para "compartilhar o audio da janela". Chamada direto pelo koffi, sem programa
// auxiliar. Pede Windows 10 (2004) ou mais novo; se o Windows recusar, start() devolve { ok: false } e quem chamou
// decide o que fazer. As amostras saem em mono, Float32, 48 kHz, em blocos de ~100 ms.

const koffi = require('koffi');

const mmdevapi = koffi.load('mmdevapi.dll');
const kernel32 = koffi.load('kernel32.dll');
const ole32 = koffi.load('ole32.dll');

const SAMPLE_RATE = 48000;
const FLUSH_MS = 100; // blocos enviados para a interface
const POLL_MS = 20; // com que frequencia olhar se chegou audio

const guid = (text) => {
  const h = text.replace(/[{}-]/g, '');
  const b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0);
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4);
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  Buffer.from(h.slice(16), 'hex').copy(b, 8);
  return b;
};
const IID_IUNKNOWN = guid('00000000-0000-0000-C000-000000000046');
const IID_IAGILEOBJECT = guid('94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90');
const IID_COMPLETION_HANDLER = guid('41D949AB-9862-444A-80F6-C261334DA5EB');
const IID_IAUDIOCLIENT = guid('1CB9AD4C-DBFA-4c32-B178-C2F568A703B2');
const IID_IAUDIOCAPTURECLIENT = guid('C8ADBD64-E71E-48a0-A4DE-185C395CD317');

const E_NOINTERFACE = -2147467262;
const VT_BLOB = 65;
const ACTIVATION_TYPE_PROCESS_LOOPBACK = 1;
const LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0; // o processo e os que ele abrir
const BUFFERFLAGS_SILENT = 0x2;
// compartilhado, loopback, com evento, convertendo para o formato pedido
const STREAM_FLAGS = (0x80000000 | 0x08000000 | 0x00020000 | 0x00040000) >>> 0;

const ActivationParams = koffi.struct('AppAudioParams', { type: 'int32', pid: 'uint32', mode: 'int32' });
const PropVariant = koffi.struct('AppAudioPropVariant', {
  vt: 'uint16', r1: 'uint16', r2: 'uint16', r3: 'uint16', size: 'uint32', pad: 'uint32', blob: koffi.pointer(ActivationParams),
});
const ActivateAudioInterfaceAsync = mmdevapi.func(
  'int32 __stdcall ActivateAudioInterfaceAsync(str16 path, void *riid, AppAudioPropVariant *params, void *handler, _Out_ void **op)');
const CoInitializeEx = ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)');
const CreateEventW = kernel32.func('void *__stdcall CreateEventW(void *attrs, int manual, int initial, void *name)');
const CloseHandle = kernel32.func('int __stdcall CloseHandle(void *h)');

// Objeto COM que o Windows chama quando a ativacao termina (numa thread dele; o koffi leva a chamada ate o JS)
const QueryInterfaceFn = koffi.proto('int32 __stdcall AppAudioQI(void *self, void *riid, _Out_ void **ppv)');
const RefFn = koffi.proto('uint32 __stdcall AppAudioRef(void *self)');
const CompletedFn = koffi.proto('int32 __stdcall AppAudioDone(void *self, void *op)');
const HandlerVtbl = koffi.struct('AppAudioVtbl', {
  queryInterface: koffi.pointer(QueryInterfaceFn),
  addRef: koffi.pointer(RefFn),
  release: koffi.pointer(RefFn),
  activateCompleted: koffi.pointer(CompletedFn),
});
const HandlerObject = koffi.struct('AppAudioHandler', { vtbl: koffi.pointer(HandlerVtbl) });

// Metodos das interfaces COM: posicao na tabela de funcoes (as tres primeiras sao as do IUnknown)
const callable = (obj, index, proto) => koffi.decode(koffi.decode(koffi.decode(obj, 'void *'), index * 8, 'void *'), proto);
const SIG = {
  release: koffi.proto('uint32 __stdcall AppAudioRelease(void *self)'),
  getActivateResult: koffi.proto('int32 __stdcall GetActivateResult(void *self, _Out_ int32 *hr, _Out_ void **unk)'),
  initialize: koffi.proto('int32 __stdcall Initialize(void *self, int32 mode, uint32 flags, int64 duration, int64 period, void *format, void *session)'),
  setEventHandle: koffi.proto('int32 __stdcall SetEventHandle(void *self, void *h)'),
  getService: koffi.proto('int32 __stdcall GetService(void *self, void *riid, _Out_ void **ppv)'),
  start: koffi.proto('int32 __stdcall Start(void *self)'),
  stop: koffi.proto('int32 __stdcall Stop(void *self)'),
  nextPacketSize: koffi.proto('int32 __stdcall GetNextPacketSize(void *self, _Out_ uint32 *frames)'),
  getBuffer: koffi.proto('int32 __stdcall GetBuffer(void *self, _Out_ void **data, _Out_ uint32 *frames, _Out_ uint32 *flags, _Out_ uint64 *device, _Out_ uint64 *qpc)'),
  releaseBuffer: koffi.proto('int32 __stdcall ReleaseBuffer(void *self, uint32 frames)'),
};
const IAUDIOCLIENT = { initialize: 3, start: 10, stop: 11, setEventHandle: 13, getService: 14 };
const IAUDIOCAPTURECLIENT = { getBuffer: 3, releaseBuffer: 4, getNextPacketSize: 5 };
const IUNKNOWN_RELEASE = 2;
const OPERATION_GET_RESULT = 3;

const hex = (n) => `0x${(n >>> 0).toString(16)}`;
class AppAudioError extends Error {}

// Uma ativacao por vez: o objeto abaixo e unico e entrega o resultado a quem esta esperando
let waiting = null;
let handler = null;

function completionHandler() {
  if (handler) return handler;
  const isOneOf = (ptr, ...iids) => {
    const bytes = Buffer.from(koffi.decode(ptr, koffi.array('uint8', 16)));
    return iids.some((iid) => bytes.equals(iid));
  };
  const vtbl = koffi.alloc(HandlerVtbl, 1);
  koffi.encode(vtbl, HandlerVtbl, {
    // O Windows exige que o objeto responda tambem como "agil" (pode ser chamado de qualquer thread)
    queryInterface: koffi.register((self, riid, ppv) => {
      if (isOneOf(riid, IID_IUNKNOWN, IID_IAGILEOBJECT, IID_COMPLETION_HANDLER)) {
        koffi.encode(ppv, 'void *', self);
        return 0;
      }
      koffi.encode(ppv, 'void *', null);
      return E_NOINTERFACE;
    }, koffi.pointer(QueryInterfaceFn)),
    addRef: koffi.register(() => 1, koffi.pointer(RefFn)),
    release: koffi.register(() => 1, koffi.pointer(RefFn)),
    activateCompleted: koffi.register((_self, op) => {
      const job = waiting;
      waiting = null;
      if (!job) return 0;
      try {
        const activateResult = [0];
        const client = [null];
        const hr = callable(op, OPERATION_GET_RESULT, SIG.getActivateResult)(op, activateResult, client);
        if (hr < 0 || activateResult[0] < 0) job.reject(new AppAudioError(`ativacao recusada (${hex(hr < 0 ? hr : activateResult[0])})`));
        else job.resolve(client[0]);
      } catch (err) {
        job.reject(err);
      }
      return 0;
    }, koffi.pointer(CompletedFn)),
  });
  handler = koffi.alloc(HandlerObject, 1);
  koffi.encode(handler, HandlerObject, { vtbl: vtbl });
  return handler;
}

/** IAudioClient que escuta so o processo `pid` (e os que ele abrir) */
function activate(pid) {
  return new Promise((resolve, reject) => {
    waiting = { resolve, reject };
    const params = {
      vt: VT_BLOB, r1: 0, r2: 0, r3: 0, size: 12, pad: 0,
      blob: { type: ACTIVATION_TYPE_PROCESS_LOOPBACK, pid, mode: LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE },
    };
    const hr = ActivateAudioInterfaceAsync('VAD\\Process_Loopback', IID_IAUDIOCLIENT, params, completionHandler(), [null]);
    if (hr < 0) {
      waiting = null;
      reject(new AppAudioError(`ActivateAudioInterfaceAsync (${hex(hr)})`));
    }
  });
}

/** Captura o som do processo; onSamples(Float32Array mono) a cada pacote. Devolve a funcao que encerra. */
async function captureProcess(pid, onSamples) {
  CoInitializeEx(null, 0); // no Electron o COM ja esta pronto (devolve "ja inicializado"); fora dele e preciso
  const client = await activate(pid);

  const format = Buffer.alloc(18); // WAVEFORMATEX: PCM 16 bits, estereo, 48 kHz
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(2, 2);
  format.writeUInt32LE(SAMPLE_RATE, 4);
  format.writeUInt32LE(SAMPLE_RATE * 4, 8);
  format.writeUInt16LE(4, 12);
  format.writeUInt16LE(16, 14);

  const fail = (what, hr) => {
    callable(client, IUNKNOWN_RELEASE, SIG.release)(client);
    throw new AppAudioError(`${what} (${hex(hr)})`);
  };
  let hr = callable(client, IAUDIOCLIENT.initialize, SIG.initialize)(client, 0, STREAM_FLAGS, 0n, 0n, format, null);
  if (hr < 0) fail('Initialize', hr);
  const event = CreateEventW(null, 0, 0, null);
  hr = callable(client, IAUDIOCLIENT.setEventHandle, SIG.setEventHandle)(client, event);
  if (hr < 0) fail('SetEventHandle', hr);
  const service = [null];
  hr = callable(client, IAUDIOCLIENT.getService, SIG.getService)(client, IID_IAUDIOCAPTURECLIENT, service);
  if (hr < 0) fail('GetService', hr);
  const capture = service[0];
  hr = callable(client, IAUDIOCLIENT.start, SIG.start)(client);
  if (hr < 0) fail('Start', hr);

  const nextPacketSize = callable(capture, IAUDIOCAPTURECLIENT.getNextPacketSize, SIG.nextPacketSize);
  const getBuffer = callable(capture, IAUDIOCAPTURECLIENT.getBuffer, SIG.getBuffer);
  const releaseBuffer = callable(capture, IAUDIOCAPTURECLIENT.releaseBuffer, SIG.releaseBuffer);
  const timer = setInterval(() => {
    const frames = [0];
    while (nextPacketSize(capture, frames) >= 0 && frames[0] > 0) {
      const data = [null];
      const count = [0];
      const flags = [0];
      if (getBuffer(capture, data, count, flags, [0n], [0n]) < 0) break;
      const mono = new Float32Array(count[0]);
      if (!(flags[0] & BUFFERFLAGS_SILENT) && count[0]) {
        const pcm = koffi.decode(data[0], koffi.array('int16', count[0] * 2));
        for (let i = 0; i < count[0]; i++) mono[i] = (pcm[i * 2] + pcm[i * 2 + 1]) / 65536;
      }
      releaseBuffer(capture, count[0]);
      onSamples(mono);
    }
  }, POLL_MS);

  return () => {
    clearInterval(timer);
    callable(client, IAUDIOCLIENT.stop, SIG.stop)(client);
    callable(capture, IUNKNOWN_RELEASE, SIG.release)(capture);
    callable(client, IUNKNOWN_RELEASE, SIG.release)(client);
    CloseHandle(event);
  };
}

/** Escuta o som de um programa e entrega em blocos de ~100 ms: onChunk(Float32Array, sampleRate) */
class AppAudio {
  constructor(onChunk) {
    this.onChunk = onChunk;
    this.endCapture = null;
    this.flushTimer = null;
    this.pending = [];
    this.run = 0;
  }

  /** { ok: true, pid } ou { ok: false, error } (Windows sem suporte, programa sem audio acessivel, etc.) */
  async start(pid) {
    this.stop();
    const run = ++this.run;
    try {
      const end = await captureProcess(pid, (samples) => this.pending.push(samples));
      if (this.run !== run) { // pediram para parar (ou trocar de programa) enquanto ativava
        end();
        return { ok: false, error: 'cancelled' };
      }
      this.endCapture = end;
      this.flushTimer = setInterval(() => this._flush(), FLUSH_MS);
      return { ok: true, pid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  _flush() {
    if (!this.pending.length) return;
    const total = this.pending.reduce((n, s) => n + s.length, 0);
    const block = new Float32Array(total);
    let at = 0;
    for (const s of this.pending) {
      block.set(s, at);
      at += s.length;
    }
    this.pending = [];
    this.onChunk(block, SAMPLE_RATE);
  }

  stop() {
    this.run++;
    clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.pending = [];
    if (this.endCapture) {
      try { this.endCapture(); } catch { /* o programa ja fechou */ }
      this.endCapture = null;
    }
  }
}

module.exports = { AppAudio };
