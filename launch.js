(() => {
  const screen = document.querySelector('#launch-screen');
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let prompt = null;
  let ready = false;
  const deadline = setTimeout(() => {
    if (ready) return;
    document.querySelector('#launch-status').textContent = 'La carga está tardando. Comprueba tu conexión e inténtalo de nuevo.';
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
      ? [['share', 'Abre este enlace en Safari y toca Compartir.'], ['square-plus', 'Elige Añadir a pantalla de inicio.'], ['check', 'Confirma el nombre Cri y toca Añadir.']]
      : /Android/i.test(navigator.userAgent)
        ? [['ellipsis-vertical', 'Abre el menú de tu navegador.'], ['square-plus', 'Elige Instalar app o Añadir a pantalla de inicio.'], ['check', 'Confirma el nombre Cri.']]
        : [['smartphone', 'Abre este enlace en Safari desde tu iPhone.'], ['share', 'Toca Compartir y Añadir a pantalla de inicio.'], ['check', 'Confirma el nombre Cri y toca Añadir.']];
    return `<section class="install-guide" aria-label="Añadir Cri al inicio"><h3>Cri en tu pantalla de inicio</h3><ol>${steps.map(([symbol, text]) => `<li>${icon(symbol)}<span>${text}</span></li>`).join('')}</ol>${prompt ? `<button class="secondary-button" data-action="install-app">${icon('download')}Instalar Cri</button>` : ''}</section>`;
  }

  globalThis.criLaunch = {
    guide,
    installed,
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
      document.querySelector('.app-shell').inert = false;
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