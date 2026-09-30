import { t, localizeDocument } from './i18n.js';
localizeDocument();
(() => {
  const screen = document.querySelector('#launch-screen');
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installOnly = () => !installed() && (ios() || /Android/i.test(navigator.userAgent));
  const entry = document.createElement('section');
  entry.id = 'entry-screen';
  entry.hidden = true;
  entry.tabIndex = -1;
  document.body.append(entry);
  const offlineReady = 'serviceWorker' in navigator
    ? navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'}).then(() => navigator.serviceWorker.ready).catch(() => null)
    : Promise.resolve(null);
  function gate(content, kind) {
    entry.innerHTML = t`<div class="entry-content">${content}</div>`;
    entry.dataset.kind = kind;
    entry.hidden = false;
    document.querySelector('.app-shell').inert = true;
    document.body.classList.add('entry-locked');
  }
  function release() {
    if (installOnly()) return;
    entry.hidden = true;
    entry.replaceChildren();
    document.querySelector('.app-shell').inert = false;
    document.body.classList.remove('entry-locked');
  }
  let prompt = null;
  let ready = false;
  const deadline = setTimeout(() => {
    if (ready) return;
    document.querySelector('#launch-status').textContent = t('La carga está tardando. Comprueba tu conexión e inténtalo de nuevo.');
    document.querySelector('#launch-retry').hidden = false;
  }, 30000);
  document.querySelector('#launch-retry').addEventListener('click', () => location.reload());
  addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; });
  addEventListener('appinstalled', () => {
    prompt = null;
    document.querySelectorAll('.install-guide').forEach(element => { element.hidden = true; });
  });

  function guide(icon) {
    if (installed()) return '';
    const steps = ios()
      ? [['share', t('Abre este enlace en Safari y toca Compartir.')], ['square-plus', t('Elige Añadir a pantalla de inicio.')], ['check', t('Confirma el nombre cristina\x27s fitness y toca Añadir.')]]
      : /Android/i.test(navigator.userAgent)
        ? [['ellipsis-vertical', t('Abre el menú de tu navegador.')], ['square-plus', t('Elige Instalar app o Añadir a pantalla de inicio.')], ['check', t('Confirma el nombre cristina\x27s fitness.')]]
        : [['smartphone', t('Abre este enlace en Safari desde tu iPhone.')], ['share', t('Toca Compartir y Añadir a pantalla de inicio.')], ['check', t('Confirma el nombre cristina\x27s fitness y toca Añadir.')]];
    return t`<section class="install-guide" aria-label="Añadir cristina\x27s fitness al inicio"><h3>cristina\x27s fitness en tu pantalla de inicio</h3><ol>${steps.map(([symbol, text]) => t`<li>${icon(symbol)}<span>${text}</span></li>`).join('')}</ol>${prompt ? t`<button class="secondary-button" data-action="install-app">${icon('download')}Instalar cristina\x27s fitness</button>` : ''}</section>`;
  }

  globalThis.criLaunch = {
    guide,
    installed,
    offlineReady,
    installOnly,
    gate,
    release,
    get locked() { return !entry.hidden; },
    tutorial(icon) {
      gate(t`<header class="entry-brand"><img src="icon-192.png" width="88" height="88" alt="cristina\x27s fitness"><h1>cristina\x27s fitness</h1></header>${guide(icon)}`, 'install');
    },
    async install() {
      if (!prompt) return false;
      const current = prompt;
      prompt = null;
      try { await current.prompt(); await current.userChoice; } catch {}
      return true;
    },
    async finish() {
      ready = true;
      clearTimeout(deadline);
      screen.setAttribute('aria-busy', 'false');
      if (document.visibilityState === 'visible' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const animation = screen.animate([{opacity:1},{opacity:0}], {duration:180,easing:'ease-out'});
        await Promise.race([animation.finished.catch(() => {}), new Promise(resolve => setTimeout(resolve, 400))]);
        animation.cancel();
      }
      screen.hidden = true;
      document.querySelector('.app-shell').inert = !entry.hidden;
      document.body.classList.remove('launching');
    },
    shouldAskLogin() {
      try {
        if (sessionStorage.getItem('cristina.login-prompt.v1')) return false;
        sessionStorage.setItem('cristina.login-prompt.v1', 'shown');
      } catch {}
      return true;
    },
  };
})();