// boot.js: runs first on every signed-in page.
// Checks the person is signed in and allowed, loads the books from the database,
// then starts the screen's own code (app.js).

import * as cloud from "./cloud.js";

const SESSION_KEY = "lsa_session";
const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
const NO_APP_JS = ["settings.html", "officer.html"]; // these pages have their own module

document.documentElement.classList.add("lsa-loading");

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

let resolveBoot;
window.__LSA_BOOT = new Promise((r) => (resolveBoot = r));

const go = (url) => {
  location.replace(url);
  return new Promise(() => {}); // stop here while the browser navigates
};

function overlay(html) {
  let el = document.getElementById("lsaOverlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "lsaOverlay";
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  return el;
}
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const showError = (title, detail) =>
  overlay(
    `<div class="lsa-box"><h3>${esc(title)}</h3><p>${esc(detail)}</p>
     <p><button class="btn-primary" id="lsaRetry">Try again</button>
     <button class="btn-secondary" id="lsaOut">Sign out</button></p></div>`
  );

function wireButtons() {
  document.getElementById("lsaRetry")?.addEventListener("click", () => location.reload());
  document.getElementById("lsaOut")?.addEventListener("click", async () => {
    await cloud.logOut();
    localStorage.removeItem(SESSION_KEY);
    location.replace("index.html");
  });
}

// Sign-out button on every page: sign out of the database first.
document.addEventListener(
  "click",
  async (e) => {
    const b = e.target.closest && e.target.closest("#logoutBtn");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      await cloud.flushNow();
    } catch (err) {}
    await cloud.logOut();
    localStorage.removeItem(SESSION_KEY);
    location.replace("index.html");
  },
  true
);

(async function main() {
  overlay(`<div class="lsa-box"><p>Loading…</p></div>`);

  const user = await cloud.authReady;
  if (!user) return go("index.html");

  let profile;
  try {
    profile = await cloud.loadProfile(user.uid);
  } catch (e) {
    showError("Cannot reach the database", cloud.friendlyError(e));
    return wireButtons();
  }
  if (!profile || !profile.active) {
    await cloud.logOut();
    localStorage.removeItem(SESSION_KEY);
    return go("index.html?reason=noaccess");
  }

  const manager = cloud.isManager(profile.role);
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      user: profile.name,
      role: profile.role,
      email: profile.email,
      uid: user.uid,
      believerId: "",
      loggedInAt: new Date().toISOString(),
    })
  );

  // Officers only ever see the reports page meant for them.
  if (!manager && page !== "officer.html") return go("officer.html");

  const who = document.getElementById("whoami");
  if (who) who.textContent = `${profile.name} (${cloud.ROLE_LABELS[profile.role] || profile.role})`;
  window.__LSA_USER = { uid: user.uid, ...profile };

  if (manager) {
    try {
      await cloud.reconcileThenHydrate(user.uid);
    } catch (e) {
      console.error(e);
      showError("The books could not be loaded", cloud.friendlyError(e));
      return wireButtons();
    }
    cloud.startSync(user.uid);
  }

  // Sync status
  const pill = document.createElement("div");
  pill.id = "lsaSync";
  document.body.appendChild(pill);
  const labels = { saved: "Saved", saving: "Saving…", failed: "Not saved. Retrying…" };
  cloud.onSyncStatus((s) => {
    pill.textContent = labels[s] || s;
    pill.dataset.state = s;
    pill.hidden = s === "saved" && !manager;
  });
  window.addEventListener("beforeunload", (e) => {
    if (cloud.hasUnsaved()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Phone left open for a while: show the newest books when it is used again.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000 && !cloud.hasUnsaved()) location.reload();
  });

  // Wait for the page to finish loading, then start the screen's code.
  if (document.readyState === "loading")
    await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  if (manager && !NO_APP_JS.includes(page)) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "app.js";
      s.onload = res;
      s.onerror = () => rej(new Error("app.js failed to load"));
      document.body.appendChild(s);
    });
  }
  document.getElementById("lsaOverlay")?.remove();
  document.documentElement.classList.remove("lsa-loading");
  resolveBoot();
})().catch((e) => {
  console.error(e);
  showError("Something went wrong", cloud.friendlyError(e));
  wireButtons();
});
