// The selection button stand-in: a page button whose click messages the worker, which then calls sidePanel.open.
(() => {
  if (globalThis.__s9) return;
  globalThis.__s9 = true;
  const add = (id, label, delay) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    b.style.cssText = `position:fixed;top:${8 + 40 * document.querySelectorAll('[id^=s9-]').length}px;right:8px;z-index:2147483647`;
    b.addEventListener('click', (e) => {
      const send = () => chrome.runtime.sendMessage({ cmd: 'open', id, trusted: e.isTrusted, active: navigator.userActivation?.isActive });
      if (delay) setTimeout(send, delay);
      else send();
    });
    document.documentElement.append(b);
  };
  add('s9-now', 'open now', 0);
  add('s9-late', 'open after 1.5 s', 1500);
})();
