// Access-rule tests. Run with: npm run test:rules
// (starts the Firestore emulator and runs this file against firebase/firestore.rules)
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "lsa-treasury-test",
  firestore: { rules: readFileSync(new URL("../firebase/firestore.rules", import.meta.url), "utf8") },
});

const dbs = {};
const db = (uid) => (dbs[uid] ||= env.authenticatedContext(uid).firestore());
let n = 0;
const newAuditId = () => `a${++n}`;

function userData(uid, actor, fields) {
  return {
    name: fields.name || uid,
    email: `${uid}@example.org`,
    role: fields.role,
    active: fields.active ?? true,
    reports: fields.reports || [],
    updatedAt: serverTimestamp(),
    updatedBy: actor,
    ...(fields.handoverTo ? { handoverTo: fields.handoverTo } : {}),
  };
}

// Write one or more records plus their audit entries in a single batch.
function auditedBatch(actor, writes, { skipAudit = false, auditTarget, reuseAuditId } = {}) {
  const d = db(actor);
  const b = writeBatch(d);
  for (const w of writes) {
    const aid = reuseAuditId || newAuditId();
    if (!skipAudit && !reuseAuditId) {
      b.set(doc(d, "audit", aid), {
        actor,
        at: serverTimestamp(),
        action: w.action || "write",
        target: auditTarget || w.path,
      });
    }
    b.set(doc(d, w.path), { ...w.data, auditId: aid });
  }
  return b;
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
  }
}

// ---------------- first set-up ----------------
await test("first sign-in becomes Treasurer (once)", async () => {
  const d = db("alice");
  const b = auditedBatch("alice", [
    { path: "users/alice", data: userData("alice", "alice", { role: "TREASURER" }), action: "bootstrap" },
  ]);
  b.set(doc(d, "system/bootstrap"), { treasurerUid: "alice", at: serverTimestamp() });
  await assertSucceeds(b.commit());
});

await test("second person cannot claim Treasurer by first set-up", async () => {
  const d = db("mallory");
  const b = auditedBatch("mallory", [
    { path: "users/mallory", data: userData("mallory", "mallory", { role: "TREASURER" }) },
  ]);
  await assertFails(b.commit());
});

await test("signed-in stranger cannot write audit, read books or create own profile", async () => {
  const d = db("mallory");
  await assertFails(setDoc(doc(d, "audit/x1"), { actor: "mallory", at: serverTimestamp(), action: "x", target: "y" }));
  await assertFails(getDoc(doc(d, "books/believers/records/b1")));
  await assertFails(
    setDoc(doc(d, "users/mallory"), { ...userData("mallory", "mallory", { role: "MEMBER" }), auditId: "zz" })
  );
});

await test("not signed in: no access at all", async () => {
  const d = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(d, "users/alice")));
  await assertFails(getDoc(doc(d, "reports/r1")));
});

// ---------------- user management ----------------
await test("Treasurer creates Vice Treasurer and officers (with audit)", async () => {
  await assertSucceeds(
    auditedBatch("alice", [
      { path: "users/carol", data: userData("carol", "alice", { role: "VICE_TREASURER" }) },
      { path: "users/dave", data: userData("dave", "alice", { role: "CHAIRPERSON", reports: ["TB", "IS"] }) },
    ]).commit()
  );
});

await test("user change without audit entry is refused", async () => {
  await assertFails(
    auditedBatch("alice", [{ path: "users/sam", data: userData("sam", "alice", { role: "MEMBER" }) }], {
      skipAudit: true,
    }).commit()
  );
});

await test("audit entry pointing at a different record is refused", async () => {
  await assertFails(
    auditedBatch("alice", [{ path: "users/sam", data: userData("sam", "alice", { role: "MEMBER" }) }], {
      auditTarget: "users/someone-else",
    }).commit()
  );
});

await test("re-using an existing audit entry is refused", async () => {
  await assertFails(
    auditedBatch("alice", [{ path: "users/sam", data: userData("sam", "alice", { role: "MEMBER" }) }], {
      reuseAuditId: "a1",
    }).commit()
  );
});

await test("unknown role or unknown report type is refused", async () => {
  await assertFails(
    auditedBatch("alice", [{ path: "users/sam", data: userData("sam", "alice", { role: "SUPER_ADMIN" }) }]).commit()
  );
  await assertFails(
    auditedBatch("alice", [
      { path: "users/sam", data: userData("sam", "alice", { role: "MEMBER", reports: ["BELIEVERS"] }) },
    ]).commit()
  );
});

await test("Vice Treasurer creates a Member", async () => {
  await assertSucceeds(
    auditedBatch("carol", [{ path: "users/eve", data: userData("eve", "carol", { role: "MEMBER", reports: ["BS"] }) }]).commit()
  );
});

await test("Vice Treasurer cannot appoint a Treasurer or change the Treasurer", async () => {
  await assertFails(
    auditedBatch("carol", [{ path: "users/frank", data: userData("frank", "carol", { role: "TREASURER" }) }]).commit()
  );
  await assertFails(
    auditedBatch("carol", [
      { path: "users/alice", data: userData("alice", "carol", { role: "TREASURER", active: false }) },
    ]).commit()
  );
});

await test("nobody can change their own role (no self-promotion)", async () => {
  await assertFails(
    auditedBatch("dave", [{ path: "users/dave", data: userData("dave", "dave", { role: "TREASURER" }) }]).commit()
  );
  await assertFails(
    auditedBatch("carol", [{ path: "users/carol", data: userData("carol", "carol", { role: "TREASURER" }) }]).commit()
  );
});

await test("users can never be hard-deleted", async () => {
  await assertFails(deleteDoc(doc(db("alice"), "users/eve")));
});

await test("officer reads own profile but not other users", async () => {
  await assertSucceeds(getDoc(doc(db("dave"), "users/dave")));
  await assertFails(getDoc(doc(db("dave"), "users/eve")));
});

// ---------------- the books ----------------
const believer = (actor) => ({
  cif: "CIF0001",
  name: "Test Believer",
  updatedAt: serverTimestamp(),
  updatedBy: actor,
});

await test("Treasurer and Vice Treasurer write and read the books (with audit)", async () => {
  await assertSucceeds(auditedBatch("alice", [{ path: "books/believers/records/b1", data: believer("alice") }]).commit());
  await assertSucceeds(auditedBatch("carol", [{ path: "books/transactions/records/t1", data: believer("carol") }]).commit());
  await assertSucceeds(getDoc(doc(db("carol"), "books/believers/records/b1")));
});

await test("book write without audit entry is refused", async () => {
  await assertFails(
    auditedBatch("alice", [{ path: "books/believers/records/b2", data: believer("alice") }], { skipAudit: true }).commit()
  );
});

await test("book records cannot be hard-deleted", async () => {
  await assertFails(deleteDoc(doc(db("alice"), "books/believers/records/b1")));
});

await test("unknown book collection is refused", async () => {
  await assertFails(auditedBatch("alice", [{ path: "books/secret/records/x", data: believer("alice") }]).commit());
});

await test("officers cannot read or write the books (no Believer data)", async () => {
  await assertFails(getDoc(doc(db("dave"), "books/believers/records/b1")));
  await assertFails(getDoc(doc(db("dave"), "books/transactions/records/t1")));
  await assertFails(auditedBatch("dave", [{ path: "books/believers/records/b3", data: believer("dave") }]).commit());
});

// ---------------- reports ----------------
const report = (actor, type) => ({
  type,
  title: type,
  period: "2026-10",
  data: { rows: [] },
  publishedAt: serverTimestamp(),
  publishedBy: actor,
});

await test("Treasurer publishes reports", async () => {
  await assertSucceeds(
    auditedBatch("alice", [
      { path: "reports/r-tb", data: report("alice", "TB") },
      { path: "reports/r-bs", data: report("alice", "BS") },
    ]).commit()
  );
});

await test("officer sees only the reports ticked for them", async () => {
  await assertSucceeds(getDoc(doc(db("dave"), "reports/r-tb"))); // dave: TB, IS
  await assertFails(getDoc(doc(db("dave"), "reports/r-bs")));
  await assertSucceeds(getDoc(doc(db("eve"), "reports/r-bs"))); // eve: BS
  await assertFails(getDoc(doc(db("eve"), "reports/r-tb")));
});

await test("officers cannot publish reports", async () => {
  await assertFails(auditedBatch("dave", [{ path: "reports/r-x", data: report("dave", "TB") }]).commit());
});

// ---------------- report index ----------------
await test("Treasurer writes the report index; officer reads only ticked types", async () => {
  const idx = (actor, type) => ({
    type,
    items: [{ id: "r-" + type.toLowerCase(), title: type, period: "2026-10", at: 1 }],
    updatedAt: serverTimestamp(),
    updatedBy: actor,
  });
  const put = (actor, type) => auditedBatch(actor, [{ path: "reportIndex/" + type, data: idx(actor, type) }]).commit();
  await assertSucceeds(put("alice", "TB"));
  await assertSucceeds(put("alice", "BS"));
  await assertSucceeds(getDoc(doc(db("eve"), "reportIndex/BS"))); // eve: BS
  await assertFails(getDoc(doc(db("eve"), "reportIndex/TB")));
});

await test("officers cannot write the report index; index needs an audit entry", async () => {
  const bad = { type: "TB", items: [], updatedAt: serverTimestamp(), updatedBy: "eve" };
  await assertFails(auditedBatch("eve", [{ path: "reportIndex/TB", data: bad }]).commit());
  await assertFails(
    auditedBatch("alice", [{ path: "reportIndex/IS", data: { ...bad, type: "IS", updatedBy: "alice" } }], { skipAudit: true }).commit()
  );
  await assertFails(
    auditedBatch("alice", [{ path: "reportIndex/NOPE", data: { ...bad, type: "NOPE", updatedBy: "alice" } }]).commit()
  );
});

// ---------------- change counter ----------------
await test("managers can read and bump the change counter; officers cannot", async () => {
  const bump = (actor, v) => setDoc(doc(db(actor), "system/meta"), { v, updatedAt: serverTimestamp(), updatedBy: actor });
  await assertSucceeds(bump("alice", 1));
  await assertSucceeds(bump("carol", 2));
  await assertSucceeds(getDoc(doc(db("carol"), "system/meta")));
  await assertFails(bump("eve", 3));
  await assertFails(getDoc(doc(db("eve"), "system/meta")));
  await assertFails(setDoc(doc(db("alice"), "system/meta"), { v: "x", updatedAt: serverTimestamp(), updatedBy: "alice" }));
});

// ---------------- audit log ----------------
await test("audit log cannot be changed or deleted, even by the Treasurer", async () => {
  await assertFails(updateDoc(doc(db("alice"), "audit/a1"), { summary: "edited" }));
  await assertFails(deleteDoc(doc(db("alice"), "audit/a1")));
});

await test("only Treasurer / Vice Treasurer can read the audit log", async () => {
  await assertSucceeds(getDoc(doc(db("alice"), "audit/a1")));
  await assertFails(getDoc(doc(db("dave"), "audit/a1")));
});

// ---------------- switching users off ----------------
await test("switched-off user loses access immediately", async () => {
  await assertSucceeds(
    auditedBatch("alice", [
      { path: "users/dave", data: userData("dave", "alice", { role: "CHAIRPERSON", reports: ["TB", "IS"], active: false }) },
    ]).commit()
  );
  await assertFails(getDoc(doc(db("dave"), "reports/r-tb")));
});

// ---------------- Treasurer handover ----------------
await test("Treasurer cannot step down without appointing a successor", async () => {
  await assertFails(
    auditedBatch("alice", [{ path: "users/alice", data: userData("alice", "alice", { role: "VICE_TREASURER" }) }]).commit()
  );
});

await test("Treasurer hands over to the Vice Treasurer in one step", async () => {
  await assertSucceeds(
    auditedBatch("alice", [
      { path: "users/carol", data: userData("carol", "alice", { role: "TREASURER" }) },
      {
        path: "users/alice",
        data: userData("alice", "alice", { role: "VICE_TREASURER", handoverTo: "carol" }),
        action: "handover",
      },
    ]).commit()
  );
  // Former Treasurer (now Vice) can no longer change the new Treasurer
  await assertFails(
    auditedBatch("alice", [{ path: "users/carol", data: userData("carol", "alice", { role: "MEMBER" }) }]).commit()
  );
  // New Treasurer has full control
  await assertSucceeds(
    auditedBatch("carol", [{ path: "users/alice", data: userData("alice", "carol", { role: "VICE_TREASURER" }) }]).commit()
  );
});

await env.cleanup();

for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} rule tests passed`);
assert.equal(failed.length, 0);
