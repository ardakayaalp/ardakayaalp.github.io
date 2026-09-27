/* Client side of the Python engine (js/worker.js). */
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let nextId = 0;
const pending = new Map();
const listeners = { progress: [], ready: [], fatal: [] };
const state = { core: false, full: false };

worker.onmessage = (e) => {
  const d = e.data;
  if (d.type) {
    if (d.type === 'ready') state[d.stage] = true;
    (listeners[d.type] || []).forEach((fn) => fn(d));
    return;
  }
  const p = pending.get(d.id);
  if (!p) return;
  pending.delete(d.id);
  if (d.ok) p.resolve(d.result);
  else p.reject(new Error(d.error));
};
worker.onerror = (e) => (listeners.fatal || []).forEach((fn) => fn({ error: e.message || 'The engine failed to start.' }));

function send(msg, transfer) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...msg }, transfer || []);
  });
}

export const engine = {
  on(type, fn) { listeners[type].push(fn); },
  isReady(stage = 'core') { return state[stage]; },
  whenReady(stage = 'core') { return send({ cmd: 'whenReady', stage }); },
  /** Call denis_web.<module>.<fn>(**kwargs). */
  call(module, fn, kwargs = {}) { return send({ cmd: 'call', module, fn, kwargs }); },
  /** Put bytes into the engine's virtual file system (the buffer is transferred). */
  write(path, bytes) { return send({ cmd: 'write', path, data: bytes }, [bytes.buffer]); },
  read(path) { return send({ cmd: 'read', path }); },
};
