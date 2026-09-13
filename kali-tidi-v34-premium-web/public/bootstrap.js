(() => {
  const server = (window.KNT_CONFIG && window.KNT_CONFIG.gameServer) || "https://three-spades.onrender.com";
  const packaged = location.protocol === "file:" || location.protocol === "capacitor:" || location.hostname === "localhost";
  const candidates = packaged
    ? [`${server}/socket.io/socket.io.js`]
    : [`${location.origin}/socket.io/socket.io.js`, `${server}/socket.io/socket.io.js`];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error(`Failed to load ${src}`)); };
      document.head.appendChild(s);
    });
  }

  async function start() {
    if (!window.io) {
      for (const src of candidates) {
        try { await loadScript(src); if (window.io) break; } catch (_) {}
      }
    }
    if (!window.io) {
      const toast = document.getElementById("toast");
      if (toast) {
        toast.textContent = "Could not connect to the game server. Check your internet connection.";
        toast.classList.remove("hidden");
      }
      return;
    }
    await loadScript("client.js");
    await loadScript("v34.js");
  }
  start();
  const splash = document.getElementById("premiumSplash");
  if (splash) setTimeout(() => splash.remove(), 2300);
})();
