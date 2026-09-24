import { emptyStore, validateStore } from './store.js';

export function createSync({ client, storage = localStorage, apply, status = () => {}, canApply = () => true }) {
  let account = null;
  let conflict = false;
  let loading = false;
  let generation = 0;
  let timer;
  let flight = null;
  const key = identity => `cristina.diary.account.v1.${identity || account?.id}`;
  const read = identity => {
    const raw = storage.getItem(key(identity));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    saved.payload = validateStore(saved.payload);
    if (!Number.isSafeInteger(saved.revision) || saved.revision < 0 || typeof saved.dirty !== 'boolean' || typeof saved.mutationId !== 'string') throw new Error('La copia local de esta cuenta necesita recuperarse.');
    return saved;
  };
  const write = saved => storage.setItem(key(), JSON.stringify(saved));
  const fromRemote = row => ({ payload: validateStore(row.payload), revision: row.revision, dirty: false, mutationId: row.mutation_id });
  const announce = () => status(conflict ? 'Conflicto entre dispositivos' : read()?.dirty ? 'Cambios pendientes' : read()?.revision ? 'Guardado en la nube' : 'Cuenta lista');
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void flush(), 650); };
  async function request(query) {
    const response = await (query.abortSignal ? query.abortSignal(AbortSignal.timeout(20000)) : query);
    if (response.error) throw response.error;
    return response.data;
  }
  const remote = identity => request(client.from('cris_diaries').select('payload,revision,mutation_id').eq('user_id', identity).maybeSingle());

  async function activate(session) {
    if (!session?.user || !canApply()) return false;
    const operation = ++generation;
    loading = true;
    status('Conectando cuenta');
    try {
      let row;
      let offline = false;
      try { row = await remote(session.user.id); }
      catch (error) { if (!read(session.user.id)) throw error; offline = true; }
      if (operation !== generation || !canApply()) { status('Cierra la edición para conectar'); return false; }
      let local = read(session.user.id);
      let nextConflict = false;
      if (!offline) {
        if (local?.dirty) {
          if (row?.mutation_id === local.mutationId) local = fromRemote(row);
          else nextConflict = (row?.revision || 0) !== local.revision;
        } else if (row) local = fromRemote(row);
        else if (local?.revision) nextConflict = true;
      }
      local ||= { payload: validateStore(emptyStore()), revision: 0, dirty: false, mutationId: crypto.randomUUID() };
      storage.setItem(key(session.user.id), JSON.stringify(local));
      account = { id: session.user.id, email: session.user.email || '' };
      conflict = nextConflict;
      apply(structuredClone(local.payload));
      if (offline) status('Sin conexión · copia local'); else announce();
      if (local.dirty && !conflict && !offline) schedule();
      return true;
    } catch { status('No se pudo conectar. Tu diario local sigue intacto.'); return false; }
    finally { if (operation === generation) loading = false; }
  }

  async function send() {
    if (!account || conflict || loading) return false;
    const identity = account.id;
    const operation = generation;
    try {
      const { data, error } = await client.auth.getSession();
      if (error || data.session?.user.id !== identity) { status('Inicia sesión para sincronizar'); return false; }
      const snapshot = read();
      if (!snapshot?.dirty) { announce(); return true; }
      status('Sincronizando');
      const rows = await request(client.rpc('cris_save_diary', { p_payload: snapshot.payload, p_expected_revision: snapshot.revision, p_mutation_id: snapshot.mutationId }));
      if (operation !== generation || account?.id !== identity) return false;
      const row = rows?.[0];
      if (!row || !Number.isSafeInteger(row.revision) || row.revision <= snapshot.revision) throw new Error('Invalid acknowledgement');
      const latest = read();
      if (latest.revision !== snapshot.revision) { conflict = true; announce(); return false; }
      latest.revision = row.revision;
      latest.dirty = latest.mutationId !== snapshot.mutationId;
      write(latest);
      announce();
      if (latest.dirty) schedule();
      return true;
    } catch (error) {
      if (operation !== generation) return false;
      if (error.code === '40001') { conflict = true; announce(); }
      else status('Cambios pendientes · reintentar conexión');
      return false;
    }
  }

  function flush() {
    if (flight) return flight;
    clearTimeout(timer);
    flight = (globalThis.navigator?.locks ? navigator.locks.request(`cris-sync-${account?.id}`, send) : send()).finally(() => { flight = null; });
    return flight;
  }

  async function resolve(preferLocal) {
    if (!account || !canApply()) return false;
    const identity = account.id;
    const operation = generation;
    try {
      const row = await remote(identity);
      if (operation !== generation || !canApply()) return false;
      const local = read();
      if (!preferLocal && !row) throw new Error('No cloud copy');
      storage.setItem(`${key()}.recovery`, JSON.stringify(local));
      const chosen = preferLocal ? { ...local, revision: row?.revision || 0, dirty: true, mutationId: crypto.randomUUID() } : fromRemote(row);
      write(chosen);
      conflict = false;
      apply(structuredClone(chosen.payload));
      announce();
      if (preferLocal) await flush();
      return true;
    } catch { status('No se pudo resolver. Las copias siguen intactas.'); return false; }
  }

  function detach() {
    generation += 1;
    clearTimeout(timer);
    account = null;
    loading = false;
    conflict = false;
    status('Solo en este dispositivo');
  }

  return {
    activate, flush, resolve, detach, key,
    get account() { return account; },
    get conflict() { return conflict; },
    get loading() { return loading; },
    get pending() { return account ? read()?.dirty : false; },
    recovery: () => account ? storage.getItem(`${key()}.recovery`) : null,
    adapter: {
      getItem: () => account ? JSON.stringify(read()?.payload) : null,
      setItem: (_, value) => {
        if (!account || loading) throw new Error('Espera a que termine la conexión de cuenta.');
        const payload = validateStore(JSON.parse(value));
        if (payload.demo) throw new Error('Los datos de ejemplo no se suben a la nube.');
        const previous = read();
        write({ payload, revision: previous?.revision || 0, dirty: true, mutationId: crypto.randomUUID() });
        announce();
        if (!conflict) schedule();
      },
    },
  };
}