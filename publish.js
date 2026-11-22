// publish.js: adds "Publish to officers" to the Reports page.
import * as cloud from "./cloud.js";

await window.__LSA_BOOT;

const SECTIONS = [
  ["tbSection", "TB"],
  ["cfSection", "CF"],
  ["isSection", "IS"],
  ["bsSection", "BS"],
  ["fundSection", "FUND"],
];

const btn = document.getElementById("rPublish");
const msg = document.getElementById("rPublishMsg");
const say = (t, bad) => {
  msg.textContent = t || "";
  msg.className = "micro " + (bad ? "msg-bad" : "msg-ok");
};

btn.addEventListener("click", async () => {
  const hit = SECTIONS.map(([id, type]) => [document.getElementById(id), type]).find(
    ([el]) => el && el.style.display !== "none"
  );
  if (!hit) return say("Open a report first.", true);
  const [section, type] = hit;
  const body = section.querySelector("table");
  if (!body) return say("Run the report first, then publish it.", true);

  // Copy only the report itself: headings, notes and tables, never the controls.
  const clone = section.cloneNode(true);
  clone.querySelectorAll("select, label, .grid2, button, script").forEach((n) => n.remove());
  const from = document.getElementById("rFrom")?.value || "";
  const to = document.getElementById("rTo")?.value || "";
  const period = from || to ? `${from || "start"} to ${to || "today"}` : "all dates";
  const title = cloud.REPORT_TYPES[type];

  btn.disabled = true;
  try {
    await cloud.publishReport({ type, title, period, html: clone.innerHTML });
    say(`${title} (${period}) is now shared with the officers ticked for it.`);
  } catch (e) {
    say(cloud.friendlyError(e), true);
  } finally {
    btn.disabled = false;
  }
});
