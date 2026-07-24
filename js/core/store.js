const clone = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export function createStore(initialState = {}) {
  const freeze = (value) => Object.freeze(clone(value));
  const initial = freeze(initialState);
  let state = freeze(initialState);
  const listeners = new Set();

  const notify = (previous, meta) => {
    listeners.forEach((listener) => listener(state, previous, meta));
  };

  const subscribe = (listener, { immediate = false } = {}) => {
    if (typeof listener !== 'function') throw new TypeError('O listener deve ser uma função.');
    listeners.add(listener);
    if (immediate) listener(state, state, { type: 'initial' });
    return () => listeners.delete(listener);
  };

  const store = {
    getState: () => state,
    setState(update, meta = {}) {
      const previous = state;
      const next = typeof update === 'function' ? update(previous) : update;
      if (!next || typeof next !== 'object') throw new TypeError('A actualização do store deve ser um objecto.');
      state = Object.freeze({ ...previous, ...next });
      if (state !== previous) notify(previous, meta);
      return state;
    },
    replaceState(nextState, meta = {}) {
      if (!nextState || typeof nextState !== 'object') throw new TypeError('O novo estado deve ser um objecto.');
      const previous = state;
      state = freeze(nextState);
      notify(previous, meta);
      return state;
    },
    reset(meta = {}) {
      const previous = state;
      state = freeze(initial);
      notify(previous, meta);
      return state;
    },
    subscribe,
    select(selector, listener, options = {}) {
      if (typeof selector !== 'function' || typeof listener !== 'function') {
        throw new TypeError('Selector e listener devem ser funções.');
      }
      let selected = selector(state);
      if (options.immediate) listener(selected, selected, { type: 'initial' });
      return subscribe((nextState, _previous, meta) => {
        const nextSelected = selector(nextState);
        if (!Object.is(nextSelected, selected)) {
          const previousSelected = selected;
          selected = nextSelected;
          listener(nextSelected, previousSelected, meta);
        }
      });
    }
  };
  return Object.freeze(store);
}
