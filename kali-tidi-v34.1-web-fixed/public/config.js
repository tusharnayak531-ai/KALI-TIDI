// Used only by the packaged Capacitor app (the normal website uses same-origin Socket.IO).
// If your Render/backend URL changes, update this one value before running `npx cap sync`.
window.KNT_CONFIG = {
  gameServer: "https://three-spades.onrender.com"
};

window.KNT_FEATURES = { pushConfigured:false, cloudAccounts:true, ranked:true, tournaments:true, v34:true };
