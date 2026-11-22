// cloud.js: everything that talks to Firebase. No page layout lives here.
//
//  - sign in, sign out, first-time Treasurer set-up, password reset emails
//  - people: create, change, switch off, hand over the Treasurer role
//  - the books: every record is its own database entry with its own audit line
//  - published reports for officers
//
// The existing screens keep reading and writing the browser copy of the books
// (localStorage). This file loads that copy from the database when a page opens
// and sends every change back, one audited record at a time.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  deleteUser,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  writeBatch,
  runTransaction,
  serverTimestamp,
  query,
  orderBy,
  limit,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ------------------------------------------------------------------ */
/* Roles and report types                                               */
/* ------------------------------------------------------------------ */
export const ROLE_LABELS = {
  TREASURER: "Treasurer",
  VICE_TREASURER: "Vice Treasurer",
  CHAIRPERSON: "Chairperson",
  VICE_CHAIRPERSON: "Vice Chairperson",
  SECRETARY: "Secretary",
  VICE_SECRETARY: "Vice Secretary",
  MEMBER: "Member",
};
export const MANAGER_ROLES = ["TREASURER", "VICE_TREASURER"];
export const REPORT_TYPES = {
  TB: "Trial Balance",
  CF: "Cash Flow",
  IS: "Income Statement",
  BS: "Balance Sheet",
  FUND: "Fund Accounts",
};
export const isManager = (role) => MANAGER_ROLES.includes(role);

/* ------------------------------------------------------------------ */
/* Firebase set-up                                                      */
/* ------------------------------------------------------------------ */
const EMU = typeof window !== "undefined" ? window.__LSA_EMULATOR : null; // tests only

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
if (EMU) {
  connectAuthEmulator(auth, EMU.authUrl, { disableWarnings: true });
  connectFirestoreEmulator(db, EMU.fsHost, EMU.fsPort);
}

let _secondary = null;
function secondaryAuth() {
  // A second app instance lets the Treasurer create a login for someone else
  // without being signed out of their own session.
  if (!_secondary) {
    const sec = initializeApp(firebaseConfig, "secondary");
    _secondary = getAuth(sec);
    if (EMU) connectAuthEmulator(_secondary, EMU.authUrl, { disableWarnings: true });
  }
  return _secondary;
}

export const authReady = new Promise((resolve) => {
  const off = onAuthStateChanged(auth, (u) => {
    off();
    resolve(u);
  });
});

export const friendlyError = (e) => {
  const code = (e && e.code) || "";
  const map = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "Wrong email or password.",
    "auth/invalid-email": "That email address is not valid.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes, or use Forgot password.",
    "auth/network-request-failed": "No connection. Check your internet and try again.",
    "auth/email-already-in-use": "A login already exists for that email.",
    "auth/weak-password": "Choose a longer password (at least 8 characters).",
    "permission-denied": "You do not have permission to do that.",
    unavailable: "No connection to the database. Check your internet and try again.",
  };
  return map[code] || (e && e.message) || "Something went wrong.";
};

/* ------------------------------------------------------------------ */
/* Audit lines                                                          */
/* ------------------------------------------------------------------ */
// Every change to the books, to people or to reports is written together with
// its own audit line. The database refuses the change without it.
function addAudit(batch, uid, { action, target, summary, before, after }) {
  const ref = doc(collection(db, "audit"));
  const data = {
    actor: uid,
    at: serverTimestamp(),
    action,
    target,
    summary: String(summary || "").slice(0, 300),
  };
  if (before) data.before = String(before).slice(0, 3000);
  if (after) data.after = String(after).slice(0, 3000);
  batch.set(ref, data);
  return ref.id;
}

export async function logAudit(action, target, summary) {
  const uid = auth.currentUser.uid;
  const batch = writeBatch(db);
  addAudit(batch, uid, { action, target, summary });
  await batch.commit();
}

export async function listAudit(n = 50) {
  const snap = await getDocs(query(collection(db, "audit"), orderBy("at", "desc"), limit(n)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ------------------------------------------------------------------ */
/* Sign in, first-time set-up, password reset                           */
/* ------------------------------------------------------------------ */
// null means "no active access": no profile yet, or switched off. The database
// refuses to show a switched-off person their own profile, so that counts too.
export async function loadProfile(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    if (e && e.code === "permission-denied") return null;
    throw e;
  }
}

export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);

export async function logOut() {
  try {
    await signOut(auth);
  } catch (e) {}
  clearLocal(); // nothing of the books stays on a device after sign-out
}

export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

// The first person to set up the system becomes Treasurer. This works once only:
// the database refuses it as soon as the set-up record exists.
export async function createTreasurer({ name, email, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  try {
    const batch = writeBatch(db);
    const aid = addAudit(batch, uid, {
      action: "first set-up",
      target: "users/" + uid,
      summary: `${name} became Treasurer`,
    });
    batch.set(doc(db, "users", uid), {
      name,
      email,
      role: "TREASURER",
      active: true,
      reports: [],
      auditId: aid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
    batch.set(doc(db, "system", "bootstrap"), { treasurerUid: uid, at: serverTimestamp() });
    await batch.commit();
  } catch (e) {
    // Someone else set the system up first: remove the login we just made.
    try {
      await deleteUser(cred.user);
    } catch (e2) {}
    const err = new Error(
      "Set-up could not be completed. Either this system is already set up (ask the Treasurer to create your account), or the database rules have not been published yet (see docs/SETUP.md, step 3)."
    );
    err.code = "already-set-up";
    throw err;
  }
  return uid;
}

/* ------------------------------------------------------------------ */
/* People                                                               */
/* ------------------------------------------------------------------ */
export async function listUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

const randomPassword = () => {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24) + "A1!";
};

// Creates a new person (login + profile) or changes an existing one.
// New people receive an email from Firebase to choose their own password.
export async function saveUser({ uid, name, email, role, active = true, reports = [] }) {
  const me = auth.currentUser.uid;
  let targetUid = uid;
  let created = false;
  let emailSent = null;

  if (!targetUid) {
    const sec = secondaryAuth();
    const pwKey = "lsa_pending_pw_" + email.toLowerCase();
    let temp = sessionStorage.getItem(pwKey) || randomPassword();
    sessionStorage.setItem(pwKey, temp);
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(sec, email, temp);
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        // An earlier attempt made the login but not the profile: pick it up again.
        try {
          cred = await signInWithEmailAndPassword(sec, email, temp);
        } catch (e2) {
          throw new Error(
            "A login already exists for that email, outside this system's records. Ask that person to use Forgot password, then contact the developer."
          );
        }
      } else throw e;
    }
    targetUid = cred.user.uid;
    await signOut(sec);
    created = true;
  }

  const batch = writeBatch(db);
  const aid = addAudit(batch, me, {
    action: created ? "create person" : "change person",
    target: "users/" + targetUid,
    summary: `${name} · ${ROLE_LABELS[role] || role}${active ? "" : " · switched off"}`,
  });
  batch.set(doc(db, "users", targetUid), {
    name,
    email,
    role,
    active,
    reports: isManager(role) ? [] : reports,
    auditId: aid,
    updatedAt: serverTimestamp(),
    updatedBy: me,
  });
  await batch.commit();
  sessionStorage.removeItem("lsa_pending_pw_" + email.toLowerCase());

  if (created) {
    try {
      await sendPasswordResetEmail(auth, email);
      emailSent = true;
    } catch (e) {
      emailSent = false;
    }
  }
  return { uid: targetUid, created, emailSent };
}

// The Treasurer steps down and appoints a successor in one step.
export async function handoverTreasurer(newUid) {
  const me = auth.currentUser.uid;
  const [mine, theirs] = await Promise.all([loadProfile(me), loadProfile(newUid)]);
  if (!mine || mine.role !== "TREASURER") throw new Error("Only the Treasurer can do this.");
  if (!theirs || !theirs.active) throw new Error("Choose an active person.");
  const batch = writeBatch(db);
  const a1 = addAudit(batch, me, {
    action: "appoint Treasurer",
    target: "users/" + newUid,
    summary: `${theirs.name} appointed Treasurer`,
  });
  batch.set(doc(db, "users", newUid), {
    name: theirs.name,
    email: theirs.email,
    role: "TREASURER",
    active: true,
    reports: [],
    auditId: a1,
    updatedAt: serverTimestamp(),
    updatedBy: me,
  });
  const a2 = addAudit(batch, me, {
    action: "step down as Treasurer",
    target: "users/" + me,
    summary: `${mine.name} became Vice Treasurer`,
  });
  batch.set(doc(db, "users", me), {
    name: mine.name,
    email: mine.email,
    role: "VICE_TREASURER",
    active: true,
    reports: [],
    handoverTo: newUid,
    auditId: a2,
    updatedAt: serverTimestamp(),
    updatedBy: me,
  });
  await batch.commit();
}

/* ------------------------------------------------------------------ */
/* Published reports                                                    */
/* ------------------------------------------------------------------ */
export async function getReportIndex(type) {
  const snap = await getDoc(doc(db, "reportIndex", type));
  return snap.exists() ? snap.data().items || [] : [];
}

export async function getReport(id) {
  const snap = await getDoc(doc(db, "reports", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

export async function publishReport({ type, title, period, html }) {
  if (!REPORT_TYPES[type]) throw new Error("Unknown report type.");
  if (html.length > 900000) throw new Error("This report is too large to publish.");
  const me = auth.currentUser.uid;
  const items = await getReportIndex(type);
  const repRef = doc(collection(db, "reports"));
  const batch = writeBatch(db);
  const a1 = addAudit(batch, me, {
    action: "publish report",
    target: "reports/" + repRef.id,
    summary: `${title} · ${period}`,
  });
  batch.set(repRef, {
    type,
    title,
    period,
    html,
    publishedAt: serverTimestamp(),
    publishedBy: me,
    auditId: a1,
  });
  const a2 = addAudit(batch, me, {
    action: "update report index",
    target: "reportIndex/" + type,
    summary: `${title} · ${period}`,
  });
  const next = [{ id: repRef.id, title, period, at: Date.now() }, ...items].slice(0, 500);
  batch.set(doc(db, "reportIndex", type), {
    type,
    items: next,
    auditId: a2,
    updatedAt: serverTimestamp(),
    updatedBy: me,
  });
  await batch.commit();
  return repRef.id;
}

// Withdraw: officers stop seeing it; the published copy stays on record.
export async function withdrawReport(type, id) {
  const me = auth.currentUser.uid;
  const items = await getReportIndex(type);
  const item = items.find((x) => x.id === id);
  const batch = writeBatch(db);
  const a = addAudit(batch, me, {
    action: "withdraw report",
    target: "reportIndex/" + type,
    summary: item ? `${item.title} · ${item.period}` : id,
  });
  batch.set(doc(db, "reportIndex", type), {
    type,
    items: items.filter((x) => x.id !== id),
    auditId: a,
    updatedAt: serverTimestamp(),
    updatedBy: me,
  });
  await batch.commit();
}

export async function listPublished() {
  const out = [];
  for (const type of Object.keys(REPORT_TYPES)) {
    const items = await getReportIndex(type);
    items.forEach((it) => out.push({ ...it, type }));
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

/* ------------------------------------------------------------------ */
/* The books: browser copy <-> database                                 */
/* ------------------------------------------------------------------ */
// localStorage key -> database collection
const COLL = {
  lsa_journal: "journal",
  lsa_cashflow: "cashflow",
  lsa_contrib_ledger: "contribLedger",
  lsa_coa: "coa",
  lsa_funds: "funds",
  lsa_believers: "believers",
  lsa_transactions: "transactions",
  lsa_posting_rules: "postingRules",
  lsa_ob: "openingBalances",
  lsa_adj: "adjustments",
};
// Records with a real identity use it. All others are identified by their content.
const ID_FIELD = { coa: "code", funds: "code", believers: "id", transactions: "id", postingRules: "id" };

const DIRTY_KEY = "lsa_dirty";
const baseKey = (coll) => "lsa_base_" + coll;

async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
const safeId = (v) => encodeURIComponent(String(v)).slice(0, 300);
const loadBase = (coll) => {
  try {
    return JSON.parse(localStorage.getItem(baseKey(coll)) || "{}");
  } catch (e) {
    return {};
  }
};
const saveBase = (coll, base) => localStorage.setItem(baseKey(coll), JSON.stringify(base));

async function keyRows(coll, rows) {
  const idField = ID_FIELD[coll];
  const used = new Set();
  const counts = new Map();
  const out = [];
  for (const row of rows) {
    const json = JSON.stringify(row);
    const h = await sha(json);
    let key = null;
    if (idField && row && row[idField] != null && String(row[idField]) !== "") {
      const k = "i" + safeId(row[idField]);
      if (!used.has(k)) key = k;
    }
    if (!key) {
      const n = counts.get(h) || 0;
      counts.set(h, n + 1);
      key = `h${h}-${n}`;
    }
    used.add(key);
    out.push({ key, json, h, row });
  }
  return out;
}

const summarise = (row) =>
  [row && (row.date || row.createdAt), row && (row.fund || row.code), row && (row.desc || row.name || row.description), row && row.amount]
    .filter((x) => x !== undefined && x !== null && x !== "")
    .join(" · ")
    .slice(0, 200);

// Send the difference between the browser copy and what this browser last knew.
async function flushColl(coll, rows, uid) {
  const base = loadBase(coll);
  const items = await keyRows(coll, rows);
  const keep = new Set(items.map((i) => i.key));
  const ops = [];
  let n = 0;
  const seqBase = Date.now() * 1000;
  for (const it of items) {
    const b = base[it.key];
    if (!b) ops.push({ op: "create", ...it, seq: seqBase + n++ });
    else if (b.h !== it.h) ops.push({ op: "update", ...it, seq: b.s });
  }
  for (const [key, b] of Object.entries(base)) {
    if (!keep.has(key)) ops.push({ op: "delete", key, h: b.h, seq: b.s });
  }
  // A batch may trigger at most 20 permission look-ups, one per record.
  for (let i = 0; i < ops.length; i += 12) {
    const chunk = ops.slice(i, i + 12);
    const batch = writeBatch(db);
    for (const o of chunk) {
      const ref = doc(db, "books", coll, "records", o.key);
      const target = `books/${coll}/records/${o.key}`;
      const aid = addAudit(batch, uid, {
        action: `${o.op} ${coll}`,
        target,
        summary: o.op === "delete" ? `removed ${o.key}` : summarise(o.row),
        after: o.op === "delete" ? "" : o.json,
      });
      const meta = { auditId: aid, updatedAt: serverTimestamp(), updatedBy: uid };
      if (o.op === "delete") batch.set(ref, { deleted: true, ...meta }, { merge: true });
      else batch.set(ref, { key: o.key, json: o.json, h: o.h, seq: o.seq, deleted: false, ...meta });
    }
    await batch.commit();
    for (const o of chunk) {
      if (o.op === "delete") delete base[o.key];
      else base[o.key] = { h: o.h, s: o.seq };
    }
    saveBase(coll, base);
  }
}

// Replace the browser copy with the database copy.
export async function hydrateAll() {
  await Promise.all(
    Object.entries(COLL).map(async ([lsKey, coll]) => {
      const snap = await getDocs(collection(db, "books", coll, "records"));
      const docs = snap.docs.map((d) => d.data()).filter((d) => !d.deleted);
      docs.sort((a, b) => a.seq - b.seq || String(a.key).localeCompare(String(b.key)));
      const base = {};
      docs.forEach((d) => (base[d.key] = { h: d.h, s: d.seq }));
      localStorage.setItem(lsKey, JSON.stringify(docs.map((d) => JSON.parse(d.json))));
      saveBase(coll, base);
    })
  );
}

/* ---- keeping the database up to date as the screens save ---- */
const status = { state: "saved", listeners: new Set() };
const setStatus = (state) => {
  status.state = state;
  status.listeners.forEach((fn) => fn(state));
};
export const onSyncStatus = (fn) => {
  status.listeners.add(fn);
  fn(status.state);
};
export const syncState = () => status.state;

let syncUid = null;
let timer = null;
let retryMs = 5000;
const pending = new Map(); // collection -> latest rows
let chain = Promise.resolve();

const readLocal = (lsKey) => {
  try {
    const v = JSON.parse(localStorage.getItem(lsKey) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
};

async function flushAll() {
  const entries = Array.from(pending.entries());
  pending.clear();
  setStatus("saving");
  try {
    for (const [coll, rows] of entries) await flushColl(coll, rows, syncUid);
    await noteOwnSave();
    if (pending.size === 0) {
      localStorage.removeItem(DIRTY_KEY);
      setStatus("saved");
    } else schedule(100);
    retryMs = 5000;
  } catch (e) {
    console.error("sync failed", e);
    entries.forEach(([coll, rows]) => {
      if (!pending.has(coll)) pending.set(coll, rows);
    });
    setStatus("failed");
    schedule(retryMs);
    retryMs = Math.min(retryMs * 2, 60000);
  }
}
function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    chain = chain.then(flushAll);
  }, ms);
}

export function startSync(uid) {
  syncUid = uid;
  window.__lsaSync = (lsKey, rows) => {
    const coll = COLL[lsKey];
    if (!coll || !syncUid) return;
    pending.set(coll, rows);
    localStorage.setItem(DIRTY_KEY, JSON.stringify({ uid: syncUid, at: Date.now() }));
    setStatus("saving");
    schedule(400);
  };
}

export async function flushNow() {
  clearTimeout(timer);
  chain = chain.then(flushAll);
  await chain;
}

const META = () => doc(db, "system", "meta");
const VERSION_KEY = "lsa_cloud_v";
const OWNER_KEY = "lsa_cloud_uid";

// Remove the browser copy of the books and everything that goes with it.
export function clearLocal() {
  const keys = [...Object.keys(COLL), ...Object.values(COLL).map(baseKey), VERSION_KEY, OWNER_KEY, DIRTY_KEY, "lsa_session"];
  keys.forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  });
}

async function readVersion() {
  const snap = await getDoc(META());
  return snap.exists() ? Number(snap.data().v) || 0 : 0;
}

// Count one more change. Returns the number before and after.
async function bumpVersion() {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(META());
    const prev = snap.exists() ? Number(snap.data().v) || 0 : 0;
    tx.set(META(), { v: prev + 1, updatedAt: serverTimestamp(), updatedBy: syncUid || auth.currentUser.uid });
    return { prev, next: prev + 1 };
  });
}

// After our own save: if nobody else saved in between, our browser copy is still
// current. If someone did, mark it out of date so the next page reloads it.
async function noteOwnSave() {
  const { prev, next } = await bumpVersion();
  const lv = localStorage.getItem(VERSION_KEY);
  if (lv !== null && String(prev) === lv) localStorage.setItem(VERSION_KEY, String(next));
  else localStorage.removeItem(VERSION_KEY);
}

// Open a page: send this device's unsent changes (only its own), then refresh the
// browser copy, unless nothing changed anywhere since it was last refreshed.
export async function reconcileThenHydrate(uid) {
  const owner = localStorage.getItem(OWNER_KEY);
  if (owner && owner !== uid) clearLocal(); // someone else used this device before
  let dirty = null;
  try {
    dirty = JSON.parse(localStorage.getItem(DIRTY_KEY) || "null");
  } catch (e) {}
  let force = false;
  if (dirty && dirty.uid === uid) {
    for (const [lsKey, coll] of Object.entries(COLL)) {
      await flushColl(coll, readLocal(lsKey), uid);
    }
    await bumpVersion();
    force = true;
  }
  localStorage.removeItem(DIRTY_KEY);
  const cloudV = await readVersion();
  const haveLocal = Object.values(COLL).every((c) => localStorage.getItem(baseKey(c)) !== null);
  const localV = localStorage.getItem(VERSION_KEY);
  if (force || !haveLocal || localV === null || localV !== String(cloudV)) await hydrateAll();
  localStorage.setItem(VERSION_KEY, String(cloudV));
  localStorage.setItem(OWNER_KEY, uid);
}

export const hasUnsaved = () => pending.size > 0 || status.state === "saving" || status.state === "failed";

/* ------------------------------------------------------------------ */
/* Backup                                                               */
/* ------------------------------------------------------------------ */
export function backupSheets() {
  const sheets = {};
  for (const [lsKey, coll] of Object.entries(COLL)) {
    sheets[coll] = readLocal(lsKey).map((r) => {
      const flat = {};
      Object.entries(r || {}).forEach(([k, v]) => {
        flat[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      return flat;
    });
  }
  return sheets;
}
