import { createSync } from './sync.js';
import { CLOUD_CONFIG } from './cloud-config.js';
import { loadStore, validateStore } from './store.js';

export function createCloud(api) {
  const client = globalThis.supabase?.createClient(CLOUD_CONFIG.url, CLOUD_CONFIG.publishableKey, {
    auth: { storageKey: 'cristina.auth.v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  let label = 'Solo en este dispositivo';
  let loginBusy = false;
  const sync = client && createSync({ client, apply: api.apply, canApply: api.canSwitch, status: value => { label = value; renderStatus(); } });

  function accountMessage() {
    if (!sync?.account) return '';
    if (sync.conflict) return 'Hay dos versiones del diario. Tus copias se conservan hasta que elijas cuál usar.';
    if (sync.pending) return 'Tus cambios están guardados en este dispositivo y pendientes de confirmar en la nube.';
    if (!sync.confirmed) return 'No se pudo confirmar la conexión con la nube. Tu copia local sigue disponible.';
    if (sync.hasRemoteCopy) return 'Tu diario está sincronizado. Ya puedes continuar donde lo dejaste.';
    return 'Ya estás lista para iniciar tu diario. Esta cuenta todavía no tiene registros en la nube.';
  }

  function renderStatus() {
    if (sync?.account && sync.pending && label === 'Guardado en la nube') label = 'Cambios pendientes';
    const top = document.querySelector('.local-status');
    if (top) top.textContent = label;
    const footer = document.querySelector('#data-label');
    if (footer && sync?.account) footer.textContent = label;
    const detail = document.querySelector('#cloud-status');
    if (detail) detail.textContent = label;
    const guidance = document.querySelector('#cloud-guidance');
    if (guidance) guidance.textContent = accountMessage();
    const conflict = document.querySelector('#cloud-conflict');
    if (conflict) conflict.hidden = !sync?.conflict;
  }

  function show() {
    const account = sync?.account;
    api.openSheet('Mi cuenta', `<div class="sheet-content"><p id="cloud-status" role="status">${api.escape(label)}</p>${account ? `<p class="cloud-email">${api.escape(account.email)}</p><div class="cloud-actions"><button class="secondary-button" data-action="cloud-sync">${api.icon('cloud-upload')}Sincronizar</button><button class="text-button" data-action="cloud-link">${api.icon('folder-input')}Vincular diario local</button><button class="text-button" data-action="cloud-logout">${api.icon('log-out')}Cerrar sesión</button></div><section id="cloud-conflict" ${sync.conflict ? '' : 'hidden'}><h3>Hay dos versiones del diario</h3><p class="muted-copy">Elige cuál conservar. La copia local anterior quedará disponible para descargar.</p><div class="cloud-actions"><button class="secondary-button" data-action="cloud-keep-local">Conservar este dispositivo</button><button class="secondary-button" data-action="cloud-use-remote">Usar copia de nube</button></div></section>${sync.recovery() ? '<button class="text-button" data-action="cloud-recovery">Descargar copia anterior</button>' : ''}` : `<form id="cloud-login-form"><label class="field"><span>Correo</span><input name="email" type="email" autocomplete="username" required maxlength="254"></label><label class="field"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required></label><p id="cloud-error" role="alert"></p><button class="primary-button" type="submit" ${!client ? 'disabled' : ''}>${api.icon('log-in')}Iniciar sesión</button></form><button class="text-button" data-action="cloud-resume">Abrir cuenta ya iniciada</button>`}</div>`);
    if (account) {
      document.querySelector('.cloud-email').insertAdjacentHTML('afterend', `<p id="cloud-guidance" class="account-guidance" aria-live="polite">${api.escape(accountMessage())}</p><button class="primary-button cloud-continue" data-action="cloud-diary">${api.icon('arrow-right')}Ir a mi diario</button>`);
      api.icons();
    }
  }

  async function openSession() {
    if (!client || !api.canSwitch()) { api.toast('Cierra la edición y termina el entrenamiento antes de cambiar de cuenta.'); return false; }
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) { api.toast('Inicia sesión con tu correo y contraseña.'); return false; }
    return sync.activate(data.session);
  }

  async function login(form) {
    if (loginBusy) return;
    loginBusy = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const fields = new FormData(form);
    try {
      if (api.getData().activeWorkout) throw new Error('Termina el entrenamiento antes de iniciar sesión.');
      const { data, error } = await client.auth.signInWithPassword({ email: fields.get('email').trim(), password: fields.get('password') });
      form.elements.password.value = '';
      if (error) throw new Error('No se pudo iniciar sesión. Revisa el correo, la contraseña y la conexión.');
      if (!form.isConnected) { api.toast('Cuenta iniciada. Ábrela desde Ajustes cuando termines la edición.'); return; }
      api.closeSheet(true);
      await sync.activate(data.session);
      if (api.canSwitch()) show();
    } catch (error) { if (form.isConnected) form.querySelector('#cloud-error').textContent = error.message; }
    finally { loginBusy = false; if (button.isConnected) button.disabled = false; }
  }

  async function action(name) {
    if (!name.startsWith('cloud-')) return false;
    if (name === 'cloud-account') { show(); return true; }
    if (name === 'cloud-diary') { api.closeSheet(true); api.goDiary(); return true; }
    if (!client) { api.toast('El cliente de nube no está disponible. Tu diario sigue guardado localmente.'); return true; }
    if (name === 'cloud-sync') {
      api.closeSheet(true);
      if (sync.pending) await sync.flush();
      else await openSession();
      if (api.canSwitch()) show();
    } else if (name === 'cloud-resume') {
      api.closeSheet(true); await openSession(); if (api.canSwitch()) show();
    } else if (name === 'cloud-logout') {
      if (api.getData().activeWorkout) { api.toast('Termina el entrenamiento antes de cerrar sesión.'); return true; }
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) { api.toast('No se pudo cerrar sesión. Inténtalo de nuevo.'); return true; }
      api.closeSheet(true);
      sync.detach();
      api.apply(loadStore());
      api.toast('Sesión cerrada. La copia de esa cuenta y sus cambios pendientes se conservaron.');
    } else if (name === 'cloud-link') {
      const guest = loadStore();
      if (guest.demo || guest.activeWorkout) { api.toast('No se vinculan datos de ejemplo ni entrenamientos en curso.'); return true; }
      if (api.getData().activities.length || api.getData().routines.length || api.getData().rewardAwards.length) { api.toast('Esta cuenta ya tiene datos. Usa un respaldo para una restauración revisada.'); return true; }
      api.openSheet('Vincular diario local', `<div class="sheet-content"><p>Se copiarán ${guest.activities.length} actividades y ${guest.routines.length} rutinas a ${api.escape(sync.account.email)}.</p><p class="muted-copy">La copia original de este navegador se conservará.</p></div>`, '<footer class="sheet-footer"><button class="secondary-button" data-action="close-sheet">Cancelar</button><button class="primary-button" data-action="cloud-confirm-link">Vincular a esta cuenta</button></footer>');
    } else if (name === 'cloud-confirm-link') {
      const guest = loadStore();
      if (!sync.account || guest.demo || guest.activeWorkout || api.getData().activeWorkout || api.getData().activities.length || api.getData().routines.length || api.getData().rewardAwards.length) { api.toast('No se puede reemplazar este diario.'); return true; }
      sync.adapter.setItem('', JSON.stringify(guest));
      api.closeSheet(true); api.apply(guest); await sync.flush(); if (api.canSwitch()) show();
    } else if (name === 'cloud-keep-local' || name === 'cloud-use-remote') {
      api.closeSheet(true);
      await sync.resolve(name === 'cloud-keep-local');
      if (api.canSwitch()) show();
    } else if (name === 'cloud-recovery') {
      const recovery = JSON.parse(sync.recovery());
      api.download(new Blob([JSON.stringify(validateStore(recovery.payload), null, 2)], {type:'application/json'}), 'cristina-backup-recuperacion.json');
    }
    return true;
  }

  async function start() {
    if (!client) { label = 'Nube no disponible · guardado local'; renderStatus(); return; }
    try {
      const { data } = await client.auth.getSession();
      if (data.session) await sync.activate(data.session);
    } catch { label = 'No se pudo abrir la cuenta'; renderStatus(); }
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && sync.account) { label = 'Sesión cerrada · copia local de la cuenta'; renderStatus(); }
      else if (session && sync.account && session.user.id !== sync.account.id) { label = 'Cuenta distinta · abre la cuenta desde Ajustes'; renderStatus(); }
    });
    addEventListener('online', () => void sync.flush());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sync.account) void sync.flush(); });
  }

  return { action, start, renderStatus,
    submit: event => { if (event.target.id !== 'cloud-login-form') return false; event.preventDefault(); void login(event.target); return true; },
    get storage() { return sync?.account ? sync.adapter : localStorage; },
    get account() { return sync?.account; },
    get loading() { return sync?.loading; },
    get label() { return label; },
    key: () => sync?.account ? sync.key() : null,
  };
}