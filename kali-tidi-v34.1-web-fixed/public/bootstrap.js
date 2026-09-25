(() => {
  const server = ((window.KNT_CONFIG && window.KNT_CONFIG.gameServer) || "https://three-spades.onrender.com").replace(/\/$/, "");
  const candidates = [...new Set([
    location.origin + "/socket.io/socket.io.js",
    server + "/socket.io/socket.io.js"
  ])];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let finished = false;
      const timer = setTimeout(() => finish(new Error("Script load timed out")), 45000);
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else {
          resolve();
        }
      }
      script.src = src;
      script.async = false;
      script.onload = () => finish();
      script.onerror = () => finish(new Error("Script failed to load"));
      document.head.appendChild(script);
    });
  }

  function showStartupError(message) {
    const splash = document.getElementById("premiumSplash");
    if (splash) splash.remove();
    const panel = document.createElement("section");
    panel.id = "startupError";
    panel.setAttribute("role", "alert");
    panel.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:24px;background:#071b18;color:#fff;text-align:center;font:16px/1.5 system-ui,sans-serif;overflow:auto";
    const heading = document.createElement("h1");
    heading.textContent = "Unable to start Kaali Ni Tidi";
    heading.style.cssText = "font-size:24px;margin:0";
    const detail = document.createElement("p");
    detail.textContent = message;
    detail.style.cssText = "max-width:440px;margin:0";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Try again";
    retry.style.cssText = "min-height:48px;padding:12px 28px;border:0;border-radius:12px;background:#e8be69;color:#10221b;font:600 16px system-ui,sans-serif;cursor:pointer";
    // Reload the document so a partially loaded client cannot register handlers twice.
    retry.addEventListener("click", () => location.reload());
    panel.appendChild(heading);
    panel.appendChild(detail);
    panel.appendChild(retry);
    document.body.appendChild(panel);
    retry.focus();
  }

  async function start() {
    if (!window.io) {
      for (const src of candidates) {
        try {
          await loadScript(src);
          if (window.io) break;
        } catch (_) {}
      }
    }
    if (!window.io) {
      showStartupError("The game server could not be reached. Check your connection and try again. A sleeping server may take a moment to wake up.");
      return;
    }
    try {
      await loadScript("client.js");
      await loadScript("v34.js");
    } catch (_) {
      showStartupError("Part of the game could not load. Check your connection and try again.");
    }
  }
  start().catch(() => showStartupError("The game could not start. Please try again."));
  const splash = document.getElementById("premiumSplash");
  if (splash) setTimeout(() => splash.remove(), 2300);
})();
