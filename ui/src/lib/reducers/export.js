export default {
  addPodExport: (state, action) => {
    let { id, name } = action.payload;
    // XXX at pod creation, remote pod in db gets null in exports/imports.
    // Thus this might be null. So create here to avoid errors.
    let pod = state.pods[id];
    if (!pod.exports) {
      pod.exports = {};
    }
    pod.exports[name] = false;
  },
  setPodExport: (state, action) => {
    let { id, exports, reexports } = action.payload;
    let pod = state.pods[id];
    pod.exports = exports;
    pod.reexports = reexports;
  },
  clearIO: (state, action) => {
    let { id, name } = action.payload;
    delete state.pods[id].io[name];
  },
  deletePodExport: (state, action) => {
    let { id, name } = action.payload;
    delete state.pods[id].exports[name];
  },
  clearPodExport: (state, action) => {
    let { id } = action.payload;
    state.pods[id].exports = null;
  },
  togglePodExport: (state, action) => {
    let { id, name } = action.payload;
    let pod = state.pods[id];
    pod.exports[name] = !pod.exports[name];
  },
  toggleDeckExport: (state, action) => {
    let { id } = action.payload;
    let pod = state.pods[id];
    // this is only for deck
    // state.pods[id].exports = {};
    if (!pod.exports) {
      pod.exports = {};
    }
    if (!state.pods[id].exports["self"]) {
      pod.exports["self"] = true;
    } else {
      pod.exports["self"] = false;
    }
  },
  addPodImport: (state, action) => {
    let { id, name } = action.payload;
    let pod = state.pods[id];
    if (!pod.imports) {
      pod.imports = {};
    }
    pod.imports[name] = false;
  },
  deletePodImport: (state, action) => {
    let { id, name } = action.payload;
    delete state.pods[id].imports[name];
  },
  togglePodImport: (state, action) => {
    let { id, name } = action.payload;
    let pod = state.pods[id];
    pod.imports[name] = !pod.imports[name];
  },
  addPodMidport: (state, action) => {
    let { id, name } = action.payload;
    let pod = state.pods[id];
    if (!pod.midports) {
      pod.midports = {};
    }
    pod.midports[name] = false;
  },
  deletePodMidport: (state, action) => {
    let { id, name } = action.payload;
    if (state.pods[id].midports) {
      delete state.pods[id].midports[name];
    }
  },
  togglePodMidport: (state, action) => {
    let { id, name } = action.payload;
    let pod = state.pods[id];
    pod.midports[name] = !pod.midports[name];
  },
};
