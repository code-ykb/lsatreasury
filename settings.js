// settings.js: people, access, Treasurer handover, published reports, backup, audit log.
import * as cloud from "./cloud.js";

const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const say = (text, bad) => {
  const el = $("stMsg");
  el.textContent = text || "";
  el.className = bad ? "msg-bad" : text ? "msg-ok" : "";
  if (text) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
};

await window.__LSA_BOOT;
const me = window.__LSA_USER;
const iAmTreasurer = me.role === "TREASURER";
let users = [];
let auditShown = 25;

/* ---------- form set-up ---------- */
function fillRoleOptions() {
  const roles = Object.keys(cloud.ROLE_LABELS).filter((r) => iAmTreasurer || r !== "TREASURER");
  $("pRole").innerHTML = roles.map((r) => `<option value="${r}">${esc(cloud.ROLE_LABELS[r])}</option>`).join("");
  $("pRole").value = "MEMBER";
}
function fillReportChecks(selected = []) {
  $("pReports").innerHTML = Object.entries(cloud.REPORT_TYPES)
    .map(
      ([k, label]) =>
        `<label class="check"><input type="checkbox" value="${k}" ${selected.includes(k) ? "checked" : ""}/> ${esc(label)}</label>`
    )
    .join("");
}
function syncReportsRow() {
  const mgr = cloud.isManager($("pRole").value);
  $("pReportsRow").hidden = mgr;
}
$("pRole").addEventListener("change", syncReportsRow);

function resetForm() {
  $("pUid").value = "";
  $("pName").value = "";
  $("pEmail").value = "";
  $("pEmail").disabled = false;
  fillRoleOptions();
  fillReportChecks([]);
  syncReportsRow();
  $("personTitle").textContent = "Add a person";
  $("btnPerson").textContent = "Add person";
  $("btnPersonCancel").hidden = true;
  $("pHint").hidden = false;
}
$("btnPersonCancel").addEventListener("click", resetForm);

/* ---------- people list ---------- */
const reportsText = (u) =>
  cloud.isManager(u.role) ? "All" : (u.reports || []).map((r) => cloud.REPORT_TYPES[r] || r).join(", ") || "None";

function renderUsers() {
  const body = document.querySelector("#usersTable tbody");
  body.innerHTML = users
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => {
      const mine = u.uid === me.uid;
      // The Vice Treasurer cannot touch the Treasurer; nobody changes their own access.
      const locked = mine || (!iAmTreasurer && u.role === "TREASURER");
      return `<tr>
        <td>${esc(u.name)}<div class="micro">${esc(u.email)}</div></td>
        <td data-label="Role">${esc(cloud.ROLE_LABELS[u.role] || u.role)}</td>
        <td data-label="Reports">${esc(reportsText(u))}</td>
        <td data-label="Status">${u.active ? "Active" : "Switched off"}</td>
        <td class="actions">
          <button class="rowbtn" data-act="edit" data-uid="${u.uid}" ${locked ? "disabled" : ""}>Edit</button>
          <button class="rowbtn" data-act="toggle" data-uid="${u.uid}" ${locked ? "disabled" : ""}>${u.active ? "Switch off" : "Switch on"}</button>
          <button class="rowbtn" data-act="reset" data-uid="${u.uid}">Password link</button>
        </td></tr>`;
    })
    .join("");

  // Handover choices: active people other than me
  const cands = users.filter((u) => u.active && u.uid !== me.uid);
  $("hoPerson").innerHTML = cands.length
    ? cands.map((u) => `<option value="${u.uid}">${esc(u.name)} (${esc(cloud.ROLE_LABELS[u.role])})</option>`).join("")
    : `<option value="">Add another person first</option>`;
}

async function loadUsers() {
  users = await cloud.listUsers();
  renderUsers();
}

$("usersTable").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b || b.disabled) return;
  const u = users.find((x) => x.uid === b.dataset.uid);
  if (!u) return;
  try {
    if (b.dataset.act === "edit") {
      $("pUid").value = u.uid;
      $("pName").value = u.name;
      $("pEmail").value = u.email;
      $("pEmail").disabled = true; // the email is the person's login
      fillRoleOptions();
      if (![...$("pRole").options].some((o) => o.value === u.role)) {
        $("pRole").insertAdjacentHTML("beforeend", `<option value="${u.role}">${esc(cloud.ROLE_LABELS[u.role])}</option>`);
      }
      $("pRole").value = u.role;
      fillReportChecks(u.reports || []);
      syncReportsRow();
      $("personTitle").textContent = "Change " + u.name;
      $("btnPerson").textContent = "Save changes";
      $("btnPersonCancel").hidden = false;
      $("pHint").hidden = true;
      $("personCard").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (b.dataset.act === "toggle") {
      await cloud.saveUser({ ...u, active: !u.active });
      say(`${u.name} ${u.active ? "switched off. They can no longer sign in." : "switched on."}`);
      await loadUsers();
    } else if (b.dataset.act === "reset") {
      await cloud.resetPassword(u.email);
      say(`A link to choose a new password was emailed to ${u.email}.`);
    }
  } catch (err) {
    say(cloud.friendlyError(err), true);
  }
});

$("personForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  say("");
  const uid = $("pUid").value || undefined;
  const name = $("pName").value.trim();
  const email = $("pEmail").value.trim();
  const role = $("pRole").value;
  const reports = [...$("pReports").querySelectorAll("input:checked")].map((i) => i.value);
  if (!name || !email) return say("Enter a name and an email.", true);
  const existing = uid ? users.find((u) => u.uid === uid) : null;
  if (!uid && users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
    return say("Someone with that email is already on the list.", true);
  $("btnPerson").disabled = true;
  try {
    const r = await cloud.saveUser({ uid, name, email, role, active: existing ? existing.active : true, reports });
    if (r.created) {
      say(
        r.emailSent
          ? `${name} added. An email has been sent to ${email} to choose a password.`
          : `${name} added, but the password email could not be sent. Use "Password link" on their row.`,
        !r.emailSent
      );
    } else say(`Changes to ${name} saved.`);
    resetForm();
    await loadUsers();
  } catch (err) {
    say(cloud.friendlyError(err), true);
  } finally {
    $("btnPerson").disabled = false;
  }
});

/* ---------- handover (Treasurer only) ---------- */
$("handoverCard").hidden = !iAmTreasurer;
$("btnHandover").addEventListener("click", () => {
  if (!$("hoPerson").value) return say("Add another person first.", true);
  $("btnHandover").hidden = true;
  $("btnHandoverYes").hidden = false;
  say("Press 'Yes, hand over now' to confirm. You will become Vice Treasurer.");
});
$("btnHandoverYes").addEventListener("click", async () => {
  $("btnHandoverYes").disabled = true;
  try {
    await cloud.handoverTreasurer($("hoPerson").value);
    say("Done. The new Treasurer is in place. Signing you back in…");
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    say(cloud.friendlyError(err), true);
    $("btnHandoverYes").disabled = false;
    $("btnHandoverYes").hidden = true;
    $("btnHandover").hidden = false;
  }
});

/* ---------- published reports ---------- */
async function loadPublished() {
  const items = await cloud.listPublished();
  const body = document.querySelector("#publishedTable tbody");
  body.innerHTML = items.length
    ? items
        .map(
          (it) => `<tr><td>${esc(it.title)}</td><td data-label="Period">${esc(it.period)}</td>
          <td data-label="Published">${esc(new Date(it.at).toLocaleDateString())}</td>
          <td><button class="rowbtn danger" data-type="${it.type}" data-id="${esc(it.id)}">Withdraw</button></td></tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="micro">Nothing published yet.</td></tr>`;
}
$("publishedTable").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-id]");
  if (!b) return;
  if (b.dataset.sure !== "1") {
    b.dataset.sure = "1";
    b.textContent = "Press again to confirm";
    return;
  }
  try {
    await cloud.withdrawReport(b.dataset.type, b.dataset.id);
    await loadPublished();
    say("Report withdrawn.");
  } catch (err) {
    say(cloud.friendlyError(err), true);
  }
});

/* ---------- backup ---------- */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error("Could not load the Excel library. Check your connection."));
    document.head.appendChild(s);
  });
}
$("btnBackup").addEventListener("click", async () => {
  $("btnBackup").disabled = true;
  try {
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = window.XLSX.utils.book_new();
    const sheets = cloud.backupSheets();
    let rows = 0;
    Object.entries(sheets).forEach(([name, data]) => {
      rows += data.length;
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(data.length ? data : [{}]), name.slice(0, 31));
    });
    const stamp = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `LSA-Treasury-backup-${stamp}.xlsx`);
    await cloud.logAudit("backup", "backup/excel", `Excel backup downloaded (${rows} rows)`);
    say(`Backup downloaded (${rows} rows). Keep it somewhere safe.`);
  } catch (err) {
    say(cloud.friendlyError(err), true);
  } finally {
    $("btnBackup").disabled = false;
  }
});

/* ---------- audit log ---------- */
async function loadAudit() {
  const rows = await cloud.listAudit(auditShown);
  const names = Object.fromEntries(users.map((u) => [u.uid, u.name]));
  const body = document.querySelector("#auditTable tbody");
  body.innerHTML = rows
    .map((r) => {
      const t = r.at && r.at.toDate ? r.at.toDate().toLocaleString() : "";
      return `<tr><td>${esc(t)}</td><td>${esc(names[r.actor] || r.actor)}</td><td>${esc(r.action)}</td><td>${esc(r.summary || r.target)}</td></tr>`;
    })
    .join("");
  $("btnAuditMore").hidden = rows.length < auditShown;
}
$("btnAuditMore").addEventListener("click", async () => {
  auditShown += 50;
  await loadAudit();
});

$("btnMyReset").addEventListener("click", async () => {
  try {
    await cloud.resetPassword(me.email);
    say(`A link to change your password was emailed to ${me.email}.`);
  } catch (err) {
    say(cloud.friendlyError(err), true);
  }
});

/* ---------- start ---------- */
resetForm();
try {
  await loadUsers();
  await Promise.all([loadPublished(), loadAudit()]);
} catch (err) {
  say(cloud.friendlyError(err), true);
}
