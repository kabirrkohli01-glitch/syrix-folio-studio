// The renderer's only bridge to the main process. Each method maps to one
// IPC handler; results arrive as { ok, data } or { ok, error } and are
// unwrapped here so callers either get data or a thrown Error with a
// readable message.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function call(name, ...args) {
  return ipcRenderer.invoke(`folio:${name}`, ...args).then((r) => {
    if (r && r.ok) return r.data;
    const err = new Error(r?.error?.message || 'Something went wrong.');
    err.kind = r?.error?.kind || null;
    err.detail = r?.error?.detail || null;
    throw err;
  });
}

function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  app: {
    info: () => call('app:info'),
    openDataFolder: () => call('app:openDataFolder'),
    openExternal: (url) => call('app:openExternal', url),
    onFlush: (cb) => subscribe('folio:flush', cb),
    flushed: () => ipcRenderer.send('folio:flushed'),
    pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  },
  settings: {
    get: () => call('settings:get'),
    update: (patch) => call('settings:update', patch),
    reset: (section) => call('settings:reset', section),
  },
  providers: {
    keys: () => call('providers:keys'),
    setKey: (name, value) => call('providers:setKey', name, value),
    reload: () => call('providers:reload'),
    catalogue: () => call('providers:catalogue'),
    test: (target) => call('providers:test', target),
    rates: () => call('providers:rates'),
    chain: (role) => call('providers:chain', role),
  },
  docs: {
    list: (opts) => call('docs:list', opts),
    get: (id) => call('docs:get', id),
    create: (opts) => call('docs:create', opts),
    save: (id, patch, opts) => call('docs:save', id, patch, opts),
    trash: (id) => call('docs:trash', id),
    restore: (id) => call('docs:restore', id),
    destroy: (id) => call('docs:destroy', id),
    duplicate: (id) => call('docs:duplicate', id),
    history: (id) => call('docs:history', id),
    snapshot: (id, reason) => call('docs:snapshot', id, reason),
    getSnapshot: (id, at) => call('docs:getSnapshot', id, at),
    restoreSnapshot: (id, at) => call('docs:restoreSnapshot', id, at),
  },
  files: {
    importDialog: (opts) => call('files:importDialog', opts),
    importPaths: (paths, opts) => call('files:importPaths', paths, opts),
    samplesDialog: () => call('files:samplesDialog'),
    samplesFromPaths: (paths) => call('files:samplesFromPaths', paths),
    saveBytes: (opts) => call('files:saveBytes', opts),
    saveText: (opts) => call('files:saveText', opts),
    printPdf: (opts) => call('files:printPdf', opts),
    showInFolder: (p) => call('files:showInFolder', p),
  },
  humanizer: {
    run: (runId, req) => call('humanizer:run', runId, req),
    cancel: (runId) => call('humanizer:cancel', runId),
    onEvent: (cb) => subscribe('folio:humanizer', cb),
  },
  sessions: {
    list: () => call('sessions:list'),
    get: (id) => call('sessions:get', id),
    update: (id, patch) => call('sessions:update', id, patch),
    remove: (id) => call('sessions:remove', id),
  },
  profiles: {
    list: () => call('profiles:list'),
    get: (id) => call('profiles:get', id),
    create: (opts) => call('profiles:create', opts),
    update: (id, patch) => call('profiles:update', id, patch),
    remove: (id) => call('profiles:remove', id),
    addSamples: (id, samples) => call('profiles:addSamples', id, samples),
    removeSample: (id, sampleId) => call('profiles:removeSample', id, sampleId),
    pinExemplar: (id, text, pinned) => call('profiles:pinExemplar', id, text, pinned),
    summarise: (id) => call('profiles:summarise', id),
  },
  assistant: {
    actions: () => call('assistant:actions'),
    send: (runId, req) => call('assistant:send', runId, req),
    cancel: (runId) => call('assistant:cancel', runId),
    onEvent: (cb) => subscribe('folio:assistant', cb),
  },
  threads: {
    get: (docId) => call('threads:get', docId),
    save: (docId, messages) => call('threads:save', docId, messages),
    clear: (docId) => call('threads:clear', docId),
  },
  news: {
    cached: () => call('news:cached'),
    refresh: () => call('news:refresh'),
    sources: () => call('news:sources'),
  },
  lab: {
    state: () => call('lab:state'),
    addSamples: (samples) => call('lab:addSamples', samples),
    removeSample: (id) => call('lab:removeSample', id),
    buildCorpus: (opts) => call('lab:buildCorpus', opts),
    runEvaluation: (opts) => call('lab:runEvaluation', opts),
    cancel: () => call('lab:cancel'),
    getRun: (id) => call('lab:getRun', id),
    removeRun: (id) => call('lab:removeRun', id),
    exportRun: (id) => call('lab:exportRun', id),
    onEvent: (cb) => subscribe('folio:lab', cb),
  },
};

contextBridge.exposeInMainWorld('folio', api);
