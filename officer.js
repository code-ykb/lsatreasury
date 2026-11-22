// officer.js: the page officers see. Only the reports ticked for them.
import * as cloud from "./cloud.js";

const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

await window.__LSA_BOOT;
const me = window.__LSA_USER;

// Published reports are our own tables. Remove anything that could run code.
function clean(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.querySelectorAll("script, iframe, object, embed, link, meta, base, form, button, input, select, textarea").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((a) => {
      const name = a.name.toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src") && /^\s*javascript:/i.test(a.value))) {
        el.removeAttribute(a.name);
      }
    });
  });
  return doc.body.firstChild.innerHTML;
}

let items = [];
try {
  const types = cloud.isManager(me.role) ? Object.keys(cloud.REPORT_TYPES) : me.reports || [];
  const lists = await Promise.all(types.map((t) => cloud.getReportIndex(t).then((l) => l.map((i) => ({ ...i, type: t })))));
  items = lists.flat().sort((a, b) => (b.at || 0) - (a.at || 0));
} catch (e) {
  $("repMsg").textContent = cloud.friendlyError(e);
}

const pick = $("repPick");
if (!items.length) {
  pick.innerHTML = `<option value="">Nothing shared yet</option>`;
  pick.disabled = true;
  if (!$("repMsg").textContent) $("repMsg").textContent = "No reports have been shared with you yet. Ask the Treasurer.";
} else {
  pick.innerHTML = items
    .map((i) => `<option value="${esc(i.id)}">${esc(i.title)} · ${esc(i.period)}</option>`)
    .join("");
}

async function show(id) {
  if (!id) return;
  $("repMsg").textContent = "Loading…";
  try {
    const r = await cloud.getReport(id);
    if (!r) throw new Error("That report is no longer available.");
    $("repTitle").textContent = r.title;
    const when = r.publishedAt && r.publishedAt.toDate ? r.publishedAt.toDate().toLocaleString() : "";
    $("repMeta").textContent = `${r.period} · published ${when}`;
    $("repView").innerHTML = clean(r.html);
    $("repCard").hidden = false;
    $("repMsg").textContent = "";
  } catch (e) {
    $("repCard").hidden = true;
    $("repMsg").textContent = cloud.friendlyError(e);
  }
}
pick.addEventListener("change", () => show(pick.value));
if (items.length) show(pick.value);
