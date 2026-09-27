/* Mini DENIS engine worker: runs Python (Pyodide) with the DENIS code off the UI thread.
 *
 * Boot happens in two stages so the app is usable quickly:
 *   core  - Python, numpy, pandas, asdf + the DENIS modules  -> open runs, spectra, sessions
 *   full  - scipy, matplotlib, sympy, satlas2 ...            -> Estimate, HFS models, exports
 *
 * Protocol (postMessage):
 *   in : {id, cmd: 'call', module, fn, kwargs}            call denis_web.<module>.<fn>(**kwargs)
 *        {id, cmd: 'write', path, data: Uint8Array}       put a file into the virtual file system
 *        {id, cmd: 'whenReady', stage: 'core' | 'full'}
 *   out: {id, ok: true, result} | {id, ok: false, error}
 *        {type: 'progress', stage, message, fraction}     boot progress (for the splash screen)
 *        {type: 'ready', stage}                           a boot stage finished
 */
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';   // keep in sync with the import
const HOME = '/home/pyodide';

const STAGES = {
  core: {
    packages: ['numpy', 'pandas', 'pyyaml', 'packaging', 'attrs', 'pyparsing', 'micropip'],
    wheels: ['asdf_standard-1.5.0-py3-none-any.whl', 'asdf_transform_schemas-0.6.0-py3-none-any.whl',
      'semantic_version-2.10.0-py2.py3-none-any.whl', 'jmespath-1.1.0-py3-none-any.whl',
      'asdf-5.3.0-py3-none-any.whl', 'periodictable-2.1.0-py3-none-any.whl'],
    warm: 'import asdf, clstools.DataFrame, gui.calibration, gui.scan_filter, gui.analysis.binning, denis_web.preanalysis, denis_web.session',
  },
  full: {
    packages: ['scipy', 'matplotlib', 'h5py', 'sympy', 'uncertainties'],
    wheels: ['asteval-1.0.8-py3-none-any.whl', 'dill-0.4.1-py3-none-any.whl', 'lmfit-1.3.4-py3-none-any.whl',
      'emcee-3.1.6-py2.py3-none-any.whl', 'numdifftools-0.9.42-py3-none-any.whl',
      'tqdm-4.67.3-py3-none-any.whl', 'satlas2-0.1.10-py3-none-any.whl', 'tabulate-0.10.0-py3-none-any.whl'],
    warm: 'import satlas2, cls_estimate, denis_web.estimate, denis_web.export',
  },
};

let py = null;
const ready = {};
const waiters = { core: [], full: [] };
const base = new URL('../', self.location.href);          // .../mini-denis/

function progress(stage, message, fraction) {
  postMessage({ type: 'progress', stage, message, fraction });
}

async function installStage(name, from, to) {
  const s = STAGES[name];
  const span = to - from;
  let done = 0;
  const total = s.packages.length + 2;
  const step = (msg) => progress(name, msg, from + span * (++done / total));
  await py.loadPackage(s.packages, {
    messageCallback: (msg) => { const m = /Loading (.+)/.exec(msg); if (m) progress(name, 'Loading ' + m[1], from + span * (done / total)); },
    errorCallback: (msg) => console.warn(msg),
  });
  done = s.packages.length;
  step(name === 'core' ? 'Installing DENIS file readers' : 'Installing satlas2 and fitting tools');
  const micropip = py.pyimport('micropip');
  await micropip.install(s.wheels.map((w) => new URL('wheels/' + w, base).href), { deps: false });
  micropip.destroy();
  step(name === 'core' ? 'Starting DENIS' : 'Warming up the hyperfine engine');
  await py.runPythonAsync(s.warm);
}

async function boot() {
  const t0 = performance.now();
  progress('core', 'Starting Python', 0.02);
  py = await loadPyodide({ indexURL: PYODIDE_URL });
  progress('core', 'Unpacking DENIS', 0.12);
  const zip = await (await fetch(new URL('denis-py.zip', base))).arrayBuffer();
  py.unpackArchive(zip, 'zip', { extractDir: HOME });
  py.runPython(`
import os, sys, warnings
os.environ["MPLBACKEND"] = "Agg"
sys.path.insert(0, "${HOME}")
warnings.filterwarnings("ignore", category=SyntaxWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning, module="satlas2")
`);
  await installStage('core', 0.15, 0.85);
  ready.core = true;
  waiters.core.splice(0).forEach((r) => r());
  postMessage({ type: 'ready', stage: 'core', seconds: (performance.now() - t0) / 1000 });

  await installStage('full', 0.85, 1.0);
  ready.full = true;
  waiters.full.splice(0).forEach((r) => r());
  postMessage({ type: 'ready', stage: 'full', seconds: (performance.now() - t0) / 1000 });
}

const booting = boot().catch((err) => {
  postMessage({ type: 'fatal', error: String(err && err.message || err) });
  throw err;
});

function whenReady(stage) {
  return ready[stage] ? Promise.resolve() : new Promise((r) => waiters[stage].push(r));
}

function toJs(value) {
  if (value && typeof value.toJs === 'function') {
    const out = value.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false });
    value.destroy();
    return out;
  }
  return value;
}

let jsonLoads = null;
function toPyValue(v) {
  if (v === null || v === undefined) return undefined;          // -> None
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return py.toPy(v);
  if (typeof v !== 'object') return v;
  if (!jsonLoads) jsonLoads = py.pyimport('json').loads;
  return jsonLoads(JSON.stringify(v));
}

async function call(module, fn, kwargs) {
  const stage = (module === 'estimate' || module === 'export' || fn === 'models' || fn === 'peak_rows') ? 'full' : 'core';
  await whenReady(stage);
  const mod = py.pyimport('denis_web.' + module);
  const f = mod[fn];
  // callKwargs wants a JS object; convert each value to Python first. Plain data goes through
  // JSON so that null becomes None at any depth (toPy would leave JsNull objects behind).
  const pyKwargs = Object.fromEntries(Object.entries(kwargs || {}).map(([k, v]) => [k, toPyValue(v)]));
  try {
    const result = f.callKwargs(pyKwargs);
    return toJs(result);
  } finally {
    for (const v of Object.values(pyKwargs)) if (v && typeof v.destroy === 'function') v.destroy();
    f.destroy();
    mod.destroy();
  }
}

self.onmessage = async (e) => {
  const { id, cmd } = e.data;
  try {
    let result;
    if (cmd === 'call') {
      result = await call(e.data.module, e.data.fn, e.data.kwargs);
    } else if (cmd === 'write') {
      await whenReady('core');
      const dir = e.data.path.split('/').slice(0, -1).join('/');
      py.FS.mkdirTree(dir);
      py.FS.writeFile(e.data.path, e.data.data);
      result = true;
    } else if (cmd === 'read') {
      await whenReady('core');
      result = py.FS.readFile(e.data.path);
    } else if (cmd === 'whenReady') {
      await whenReady(e.data.stage || 'core');
      result = true;
    } else if (cmd === 'runPython') {                        // tests only
      await whenReady(e.data.stage || 'core');
      result = toJs(await py.runPythonAsync(e.data.code));
    } else {
      throw new Error('unknown command ' + cmd);
    }
    const transfer = result instanceof Uint8Array ? [result.buffer] : [];
    postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
