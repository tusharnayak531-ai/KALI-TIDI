/* Kaali Ni Tidi v34 — Premium Web Edition enhancements.
   Loaded after client.js so it can safely reuse the existing socket/state helpers. */
(() => {
  const PREF_KEY = 'knt_v34_prefs';
  const defaults = { swipePlay: true, autoDataSaver: true, showCoach: true };
  let prefs = defaults;
  try { prefs = { ...defaults, ...(JSON.parse(localStorage.getItem(PREF_KEY) || 'null') || {}) }; } catch {}

  const savePrefs = () => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
  };

  function setViewportHeight() {
    document.documentElement.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`);
  }
  setViewportHeight();
  window.addEventListener('resize', setViewportHeight, { passive: true });
  window.visualViewport?.addEventListener('resize', setViewportHeight, { passive: true });

  function ensureShell() {
    if (!document.getElementById('v34OfflineBar')) {
      const bar = document.createElement('div');
      bar.id = 'v34OfflineBar';
      bar.className = 'v34-offline-bar hidden';
      bar.setAttribute('role', 'status');
      bar.innerHTML = '<b>Offline</b><span>Your seat is protected while the game reconnects.</span>';
      document.body.appendChild(bar);
    }

    if (!document.getElementById('v34NetChip')) {
      const host = document.querySelector('.top-actions');
      const chip = document.createElement('button');
      chip.id = 'v34NetChip';
      chip.type = 'button';
      chip.className = 'v34-net-chip';
      chip.title = 'Connection diagnostics';
      chip.innerHTML = '<i></i><span>Checking…</span>';
      chip.addEventListener('click', showDiagnostics);
      host?.prepend(chip);
    }

    if (!document.getElementById('v34QuickTools')) {
      const tools = document.createElement('div');
      tools.id = 'v34QuickTools';
      tools.className = 'v34-quick-tools';
      tools.innerHTML = '<button id="v34RotateBtn" type="button" title="Landscape/fullscreen">↻</button><button id="v34InstallBtn" type="button" title="Install game">＋</button>';
      document.body.appendChild(tools);
      document.getElementById('v34RotateBtn')?.addEventListener('click', enterTableMode);
      document.getElementById('v34InstallBtn')?.addEventListener('click', installOrHelp);
    }

    enhanceSettings();
  }

  function connectionInfo() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      online: navigator.onLine,
      type: c?.effectiveType || c?.type || 'unknown',
      rtt: Number(c?.rtt || 0),
      downlink: Number(c?.downlink || 0),
      saveData: Boolean(c?.saveData)
    };
  }

  function currentPing() {
    const raw = document.getElementById('pingStatus')?.textContent || '';
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  function updateNetworkUI() {
    const info = connectionInfo();
    const ping = currentPing();
    const chip = document.getElementById('v34NetChip');
    const bar = document.getElementById('v34OfflineBar');
    const socketOk = typeof socket !== 'undefined' ? Boolean(socket.connected) : info.online;
    const online = info.online && socketOk;
    bar?.classList.toggle('hidden', online);
    if (chip) {
      const quality = !online ? 'offline' : ping == null ? 'checking' : ping < 110 ? 'good' : ping < 240 ? 'okay' : 'bad';
      chip.className = `v34-net-chip ${quality}`;
      chip.querySelector('span').textContent = !online ? 'Reconnecting' : ping == null ? info.type.toUpperCase() : `${ping} ms`;
    }
    autoTuneNetwork(info, ping);
  }

  function autoTuneNetwork(info, ping) {
    if (!prefs.autoDataSaver || typeof performanceMode === 'undefined') return;
    const constrained = info.saveData || ['slow-2g', '2g'].includes(info.type) || (ping != null && ping > 420);
    const recovered = !info.saveData && ['4g', 'unknown', 'wifi', 'ethernet'].includes(info.type) && (ping == null || ping < 220);
    if (constrained && !performanceMode) {
      performanceMode = true;
      try { localStorage.setItem('knt_performance_v22', 'on'); } catch {}
      applyPerformanceMode?.();
    } else if (recovered && performanceMode && localStorage.getItem('knt_v34_auto_forced') === '1') {
      performanceMode = false;
      try { localStorage.setItem('knt_performance_v22', 'off'); localStorage.removeItem('knt_v34_auto_forced'); } catch {}
      applyPerformanceMode?.();
    }
    if (constrained) try { localStorage.setItem('knt_v34_auto_forced', '1'); } catch {}
  }

  function showDiagnostics() {
    const info = connectionInfo();
    const ping = currentPing();
    const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    const html = `
      <div class="v34-diagnostics">
        <div><span>Status</span><b>${navigator.onLine ? 'Online' : 'Offline'}</b></div>
        <div><span>Game socket</span><b>${typeof socket !== 'undefined' && socket.connected ? 'Connected' : 'Reconnecting'}</b></div>
        <div><span>Latency</span><b>${ping == null ? '—' : `${ping} ms`}</b></div>
        <div><span>Network</span><b>${String(info.type).toUpperCase()}</b></div>
        <div><span>Downlink</span><b>${info.downlink ? `${info.downlink} Mbps` : '—'}</b></div>
        <div><span>Browser data saver</span><b>${info.saveData ? 'On' : 'Off'}</b></div>
        <div><span>PWA</span><b>${installed ? 'Installed' : 'Browser mode'}</b></div>
        <div><span>Client</span><b>v3.4.0</b></div>
      </div>
      <p class="muted">Automatic data saver is ${prefs.autoDataSaver ? 'enabled' : 'disabled'}. It reduces visual/network overhead on weak connections.</p>`;
    if (typeof v16Modal === 'function') v16Modal('Connection diagnostics', html);
  }

  function enhanceSettings() {
    const grid = document.querySelector('.match-settings-grid');
    if (!grid || document.getElementById('v34SwipeToggle')) return;
    const auto = document.createElement('label');
    auto.className = 'toggle-line';
    auto.innerHTML = `<input id="v34AutoDataToggle" type="checkbox" ${prefs.autoDataSaver ? 'checked' : ''}/> Auto data saver`;
    const swipe = document.createElement('label');
    swipe.className = 'toggle-line';
    swipe.innerHTML = `<input id="v34SwipeToggle" type="checkbox" ${prefs.swipePlay ? 'checked' : ''}/> Swipe up to play`;
    const coach = document.createElement('label');
    coach.className = 'toggle-line';
    coach.innerHTML = `<input id="v34CoachToggle" type="checkbox" ${prefs.showCoach ? 'checked' : ''}/> Smart turn coach`;
    grid.append(auto, swipe, coach);

    auto.querySelector('input').addEventListener('change', e => { prefs.autoDataSaver = e.target.checked; savePrefs(); updateNetworkUI(); });
    swipe.querySelector('input').addEventListener('change', e => { prefs.swipePlay = e.target.checked; savePrefs(); });
    coach.querySelector('input').addEventListener('change', e => {
      prefs.showCoach = e.target.checked; savePrefs();
      if (!prefs.showCoach) document.getElementById('v34Coach')?.remove();
      else renderSmartCoach();
    });
  }

  async function enterTableMode() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      try { await screen.orientation?.lock?.('landscape'); } catch {}
    } catch {
      try { toast?.('Rotate your phone to landscape for the best table view.'); } catch {}
    }
  }

  function installOrHelp() {
    const nativeInstall = document.getElementById('installPwaBtn');
    if (nativeInstall && !nativeInstall.classList.contains('hidden')) {
      nativeInstall.click();
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const text = ios
      ? '<p>On iPhone/iPad: open the Share menu in Safari, then choose <b>Add to Home Screen</b>.</p>'
      : '<p>Use your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>';
    if (typeof v16Modal === 'function') v16Modal('Install Kaali Ni Tidi', text);
  }

  // Gesture: a deliberate upward swipe on a legal card triggers the same verified click path.
  let swipeStart = null;
  document.addEventListener('pointerdown', e => {
    const card = e.target.closest?.('#hand .card.playable');
    if (!card || !prefs.swipePlay || e.pointerType === 'mouse') return;
    swipeStart = { card, x: e.clientX, y: e.clientY, t: performance.now() };
  }, { passive: true });
  document.addEventListener('pointerup', e => {
    if (!swipeStart) return;
    const s = swipeStart; swipeStart = null;
    if (!prefs.swipePlay || !document.body.contains(s.card)) return;
    const dy = e.clientY - s.y, dx = Math.abs(e.clientX - s.x), dt = performance.now() - s.t;
    if (dy < -58 && dx < 85 && dt < 900) {
      e.preventDefault?.();
      s.card.classList.add('v34-swipe-launch');
      setTimeout(() => s.card.click(), 60);
    }
  }, { passive: false });

  function renderSmartCoach() {
    let box = document.getElementById('v34Coach');
    if (!prefs.showCoach || typeof state === 'undefined' || !state || state.spectator || !['bidding', 'contract', 'playing'].includes(state.phase)) {
      box?.remove();
      return;
    }
    let title = '', detail = '';
    if (state.phase === 'bidding' && state.bid?.turnIndex === state.viewerIndex) {
      const pointCards = (state.hand || []).filter(c => ['A','K','Q','J','10','5'].includes(String(c.rank)) || (c.suit === 'S' && String(c.rank) === '3')).length;
      title = 'Bid coach';
      detail = `You hold ${pointCards} scoring card${pointCards === 1 ? '' : 's'}. Bid within the legal range and leave room for uncertainty.`;
    } else if (state.phase === 'contract' && state.bid?.bidderIndex === state.viewerIndex) {
      const counts = { S:0,H:0,D:0,C:0 };
      (state.hand || []).forEach(c => { if (counts[c.suit] != null) counts[c.suit]++; });
      const best = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];
      title = 'Hukum coach';
      detail = best ? `${best[0] === 'S' ? '♠ Spades' : best[0] === 'H' ? '♥ Hearts' : best[0] === 'D' ? '♦ Diamonds' : '♣ Clubs'} is your longest suit (${best[1]} cards). Consider it, but value and partner calls matter too.` : 'Choose Hukum and your exact partner card(s).';
    } else if (state.phase === 'playing' && state.turnIndex === state.viewerIndex) {
      const legal = (state.legalCardIds || []).length || document.querySelectorAll('#hand .card.playable').length;
      title = 'Your turn';
      detail = state.leadSuit ? `Follow ${suitSymbol?.[state.leadSuit] || state.leadSuit} when possible. ${legal} legal card${legal === 1 ? '' : 's'} available.` : `${legal || 'Several'} legal cards. You are leading this trick.`;
    } else {
      box?.remove();
      return;
    }
    if (!box) {
      box = document.createElement('aside');
      box.id = 'v34Coach';
      box.className = 'v34-smart-coach';
      document.body.appendChild(box);
    }
    box.innerHTML = `<span>✦ V34 SMART COACH</span><b>${title}</b><small>${detail}</small><button type="button" aria-label="Hide coach">×</button>`;
    box.querySelector('button').onclick = () => { prefs.showCoach = false; savePrefs(); box.remove(); };
  }

  function enhancePwaUpdates() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'KNT_UPDATE_READY') {
        const overlay = document.getElementById('updateOverlay');
        const text = document.getElementById('updateText');
        if (text) text.textContent = 'Kaali Ni Tidi v3.4 assets are ready. Reload to update.';
        overlay?.classList.remove('hidden');
      }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (sessionStorage.getItem('knt_v34_reloaded') === '1') return;
      sessionStorage.setItem('knt_v34_reloaded', '1');
      location.reload();
    });
  }

  window.addEventListener('online', updateNetworkUI);
  window.addEventListener('offline', updateNetworkUI);
  navigator.connection?.addEventListener?.('change', updateNetworkUI);
  const pingObserver = new MutationObserver(updateNetworkUI);
  const ping = document.getElementById('pingStatus');
  if (ping) pingObserver.observe(ping, { childList: true, characterData: true, subtree: true });

  if (typeof socket !== 'undefined') {
    socket.on('connect', updateNetworkUI);
    socket.on('disconnect', updateNetworkUI);
    socket.on('state', () => setTimeout(renderSmartCoach, 0));
  }

  ensureShell();
  enhancePwaUpdates();
  updateNetworkUI();
  setTimeout(renderSmartCoach, 600);
})();
