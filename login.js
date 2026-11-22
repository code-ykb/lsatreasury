// login.js: the sign-in page.
import * as cloud from "./cloud.js";

const SESSION_KEY = "lsa_session";
const $ = (id) => document.getElementById(id);
const say = (text) => ($("loginMsg").textContent = text || "");
const home = (role) => (cloud.isManager(role) ? "dashboard.html" : "officer.html");

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

const busy = (btn, on, label) => {
  btn.disabled = on;
  btn.textContent = on ? "PLEASE WAIT…" : label;
};

async function enter(user) {
  const profile = await cloud.loadProfile(user.uid);
  if (!profile || !profile.active) {
    await cloud.logOut();
    localStorage.removeItem(SESSION_KEY);
    say("This account has no access: it was switched off, or you have not been added yet. Contact the Treasurer.");
    return false;
  }
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
  location.replace(home(profile.role));
  return true;
}

// Already signed in on this device: go straight in.
(async () => {
  const params = new URLSearchParams(location.search);
  if (params.get("reason") === "noaccess") say("This account has no access: it was switched off, or you have not been added yet. Contact the Treasurer.");
  try {
    const user = await cloud.authReady;
    if (user && params.get("reason") !== "noaccess") await enter(user);
  } catch (e) {}
})();

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  say("");
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) return say("Enter your email and password.");
  busy($("btnLogin"), true, "LOGIN");
  try {
    const cred = await cloud.signIn(email, password);
    if (!(await enter(cred.user))) busy($("btnLogin"), false, "LOGIN");
  } catch (err) {
    say(cloud.friendlyError(err));
    busy($("btnLogin"), false, "LOGIN");
  }
});

$("lnkForgot").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  if (!email) return say("Type your email in the Email box first, then press Forgot password.");
  try {
    await cloud.resetPassword(email);
  } catch (err) {
    if (err.code === "auth/invalid-email" || err.code === "auth/network-request-failed")
      return say(cloud.friendlyError(err));
  }
  // The same message whether or not the address is known.
  say("If that email has an account, a link to choose a new password has been sent. Check your inbox and spam.");
});

const showSetup = (on) => {
  $("setupForm").hidden = !on;
  $("loginForm").hidden = on;
  $("loginTitle").textContent = on ? "First-time set-up" : "Sign in";
  say("");
};
$("lnkSetup").addEventListener("click", (e) => {
  e.preventDefault();
  showSetup(true);
});
$("lnkBack").addEventListener("click", (e) => {
  e.preventDefault();
  showSetup(false);
});

$("setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  say("");
  const name = $("sName").value.trim();
  const email = $("sEmail").value.trim();
  const p1 = $("sPass").value;
  const p2 = $("sPass2").value;
  if (!name || !email) return say("Enter your name and email.");
  if (p1.length < 8) return say("The password must be at least 8 characters.");
  if (p1 !== p2) return say("The two passwords do not match.");
  busy($("btnSetup"), true, "CREATE TREASURER ACCOUNT");
  try {
    await cloud.createTreasurer({ name, email, password: p1 });
    const user = await cloud.authReady.then(() => cloud.auth.currentUser);
    if (!(await enter(user))) busy($("btnSetup"), false, "CREATE TREASURER ACCOUNT");
  } catch (err) {
    say(err.code === "already-set-up" ? err.message : cloud.friendlyError(err));
    busy($("btnSetup"), false, "CREATE TREASURER ACCOUNT");
  }
});
