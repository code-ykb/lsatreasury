const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    _dump() {
      const out = {};
      for (const [k, v] of store.entries()) out[k] = v;
      return out;
    },
  };
}

function bootstrapApp() {
  const localStorage = createLocalStorage();
  const sandbox = {
    localStorage,
    console,
    alert: () => {},
    fetch: () => Promise.resolve({ ok: true, json: async () => ({ ok: true }) }),
    document: { addEventListener: () => {} },
    window: {
      addEventListener: () => {},
      location: { href: '' },
      open: () => ({ document: { write() {}, close() {} } }),
    },
    setTimeout,
    clearTimeout,
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  const appPath = path.join(__dirname, '..', 'app.js');
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox;
}

function getJSON(storage, key) {
  const raw = storage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

module.exports = {
  bootstrapApp,
  getJSON,
};
