const state = {
  models: [], senders: [], interventions: [], bounces: [], mailAccounts: [],
  taskRunning: false, modalItem: null, modalOptions: {},
  interventionSnapshotReady: false, knownInterventionKeys: new Set(),
  mailSnapshotReady: false, knownMailKeys: new Set(),
};

const $ = (id) => document.getElementById(id);
const STORAGE_KEYS = {
  mail: "celeste.seenMail.v1",
  intervention: "celeste.seenIntervention.v1",
  openedMail: "celeste.openedMail.v1",
  openedIntervention: "celeste.openedIntervention.v1",
};

function loadKeys(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]").filter(Boolean)); } catch { return new Set(); }
}
function saveKeys(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set].slice(-600))); } catch {}
}

const seenMail = loadKeys(STORAGE_KEYS.mail);
const seenIntervention = loadKeys(STORAGE_KEYS.intervention);
const openedMail = loadKeys(STORAGE_KEYS.openedMail);
const openedIntervention = loadKeys(STORAGE_KEYS.openedIntervention);

const esc = (v) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const toHtml = (v) => esc(v).replace(/\n/g, "<br>");
const short = (v, n = 120) => { const t = String(v || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "..." : t; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const activeItems = (items) => (items || []).filter((i) => i.status !== "已处理");
const iKey = (i) => i.id || [i.from, i.subject, i.email, i.time].filter(Boolean).join("|");
const isIOpened = (i) => Boolean(i?.read_at) || openedIntervention.has(iKey(i));
const mKey = (a, m) => [a?.key, m?.id || m?.imap_uid, m?.subject, m?.from].filter(Boolean).join("|");
const isOpened = (a, m) => Boolean(m?.opened_at) || openedMail.has([a, m?.id || m?.imap_uid, m?.subject, m?.from].filter(Boolean).join("|"));

function markIOpened(item) {
  if (!item) return;
  item.read_at = item.read_at || new Date().toISOString();
  const k = iKey(item);
  if (k) { openedIntervention.add(k); saveKeys(STORAGE_KEYS.openedIntervention, openedIntervention); }
}

function markMailOpened(a, m) {
  if (!m) return;
  m.opened_at = m.opened_at || new Date().toISOString();
  const k = [a, m?.id || m?.imap_uid, m?.subject, m?.from].filter(Boolean).join("|");
  if (k) { openedMail.add(k); saveKeys(STORAGE_KEYS.openedMail, openedMail); }
}

function toast(title, body = "") {
  let r = $("toastRegion");
  if (!r) { r = document.createElement("div"); r.id = "toastRegion"; r.className = "toast-region"; r.setAttribute("aria-live", "polite"); document.body.appendChild(r); }
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = title + (body ? " - " + short(body, 100) : "");
  r.appendChild(t);
  [...r.querySelectorAll(".toast")].slice(-3).forEach((x) => x.remove());
  requestAnimationFrame(() => t.classList.add("visible"));
  const close = () => { t.classList.remove("visible"); setTimeout(() => t.remove(), 150); };
  const timer = setTimeout(close, 4000);
  t.addEventListener("click", () => { clearTimeout(timer); close(); }, { once: true });
}

function notifyIntervention(item) {
  toast("新的待人工跟进邮件", [item.from, item.subject].filter(Boolean).join(" "));
}

function notifyMailMessage(account, message) {
  toast("收到新邮件", [account?.label, message.from, message.subject].filter(Boolean).join(" "));
}

function syncMailNotifs(accounts) {
  const unread = [];
  (accounts || []).forEach((a) => (a.messages || []).filter((m) => !m.read_at).forEach((m) => unread.push({ a, m })));
  const active = new Set(unread.map(({ a, m }) => mKey(a, m)).filter(Boolean));
  if (!state.mailSnapshotReady) {
    state.knownMailKeys = active;
    active.forEach((k) => seenMail.add(k));
    saveKeys(STORAGE_KEYS.mail, seenMail);
    state.mailSnapshotReady = true;
    return;
  }
  unread.filter(({ a, m }) => { const k = mKey(a, m); return k && m.is_new === true && !state.knownMailKeys.has(k) && !seenMail.has(k); })
    .forEach(({ a, m }) => { seenMail.add(mKey(a, m)); notifyMailMessage(a, m); });
  active.forEach((k) => seenMail.add(k));
  saveKeys(STORAGE_KEYS.mail, seenMail);
  state.knownMailKeys = active;
}

function syncInterventionNotifs(items) {
  const active = activeItems(items);
  const keys = new Set(active.map(iKey).filter(Boolean));
  if (!state.interventionSnapshotReady) {
    state.knownInterventionKeys = keys;
    keys.forEach((k) => seenIntervention.add(k));
    saveKeys(STORAGE_KEYS.intervention, seenIntervention);
    state.interventionSnapshotReady = true;
    return;
  }
  active.filter((i) => { const k = iKey(i); return k && !state.knownInterventionKeys.has(k) && !seenIntervention.has(k); })
    .forEach((i) => { seenIntervention.add(iKey(i)); notifyIntervention(i); });
  keys.forEach((k) => seenIntervention.add(k));
  saveKeys(STORAGE_KEYS.intervention, seenIntervention);
  state.knownInterventionKeys = keys;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function setBusy(busy) {
  state.taskRunning = busy;
  $("dailyBtn").disabled = busy;
  if ($("syncSheetsBtn")) $("syncSheetsBtn").disabled = busy;
  document.querySelectorAll("[data-reset]").forEach((b) => { b.disabled = busy; });
  document.querySelectorAll("[data-sync-model]").forEach((b) => { b.disabled = busy; });
  syncSendLimit();
}

function selModel() { return state.models.find((m) => m.key === $("modelSelect").value); }

function syncSendLimit() {
  const inp = $("sendLimit"), btn = $("sendBtn"), m = selModel();
  const max = Math.max(0, Number(m?.unsent || 0));
  inp.max = String(max); inp.min = "0";
  if (max <= 0) { inp.value = "0"; btn.disabled = true; return; }
  const v = Math.min(max, Math.max(0, Math.floor(Number(inp.value || 0))));
  inp.value = String(v);
  btn.disabled = state.taskRunning || v <= 0;
}

function fillSelects(models, senders) {
  const ms = $("modelSelect"), prev = ms.value;
  ms.innerHTML = "";
  models.forEach((m) => { const o = document.createElement("option"); o.value = m.key; o.textContent = m.label; ms.appendChild(o); });
  if (prev && [...ms.options].some((o) => o.value === prev)) ms.value = prev;

  const ss = $("senderSelect"), ps = ss.value;
  ss.innerHTML = "";
  senders.forEach((s) => { const o = document.createElement("option"); o.value = s.key; o.textContent = s.user ? `${s.label} (${s.user})` : s.label; ss.appendChild(o); });
  if (!senders.length) { const o = document.createElement("option"); o.value = ""; o.textContent = "未配置发件邮箱"; ss.appendChild(o); }
  else if (ps && [...ss.options].some((o) => o.value === ps)) ss.value = ps;
  syncSendLimit();
}

function renderModels(models) {
  const g = $("modelGrid"); g.innerHTML = "";
  models.forEach((m) => {
    const c = document.createElement("article"); c.className = "model-card";
    c.innerHTML = `
      <div class="model-top">
        <h4>${esc(m.label)}</h4>
        <div class="model-actions">
          <button class="btn-xs" data-sync-model="${m.key}">更新</button>
          <button class="btn-xs" data-reset="${m.key}">重置</button>
        </div>
      </div>
      <div class="model-big">${m.count || 0}</div>
      <div class="model-row">
        <div class="model-cell"><span>已发</span><strong>${m.sent || 0}</strong></div>
        <div class="model-cell"><span>未发</span><strong>${m.unsent || 0}</strong></div>
        <div class="model-cell"><span>失效</span><strong>${m.invalid || 0}</strong></div>
      </div>
      <div class="model-time">${m.last_updated || ""}</div>`;
    c.querySelector("[data-sync-model]").addEventListener("click", () => syncModel(m));
    c.querySelector("[data-reset]").addEventListener("click", () => resetModel(m));
    g.appendChild(c);
  });
}

function statusClass(s) { return s === "正常" ? "ok" : s === "异常" ? "bad" : s === "未配置" ? "warn" : "idle"; }

function renderMailAccounts(accounts) {
  const g = $("mailGrid"); g.innerHTML = "";
  if (!accounts.length) { g.innerHTML = `<div class="empty">未配置邮箱账户。</div>`; return; }
  accounts.forEach((a) => {
    const n = document.createElement("article"); n.className = "mail-card";
    const msgs = a.messages || [], nc = Number.isFinite(a.new_count) ? a.new_count : msgs.length;
    n.innerHTML = `
      <div class="mail-top"><h4>${esc(a.label)}</h4><span class="badge ${statusClass(a.status)}">${esc(a.status || "等待检查")}</span></div>
      <div class="mail-user">${esc(a.user || "未填写账号")}</div>
      <div class="mail-metrics">
        <div class="mail-metric"><span>新邮件</span><strong>${nc}</strong></div>
        <div class="mail-metric"><span>意向</span><strong>${a.interested || 0}</strong></div>
      </div>
      ${a.error ? `<div class="empty" style="color:var(--red);">${esc(a.error)}</div>` : ""}
      ${msgs.length ? `<div class="mail-list">${msgs.map((m) => `
        <div class="mail-row ${isOpened(a.key, m) ? "read" : ""}" data-ak="${esc(a.key)}" data-mid="${esc(m.id)}">
          <div class="mail-dot"></div>
          <div class="mail-body">
            <div class="mail-from">${esc(m.from || "")}</div>
            <div class="mail-subject">${esc(short(m.subject || "无主题", 60))}</div>
            <div class="mail-snippet">${esc(short(m.snippet || m.body || "", 80))}</div>
          </div>
        </div>`).join("")}</div>` : ""}`;
    g.appendChild(n);
  });
}

function renderIntervention(items) {
  const l = $("interventionList"); l.innerHTML = "";
  const active = activeItems(items);
  $("clearInterventionBtn").disabled = !active.length;
  if (!active.length) { l.innerHTML = `<div class="empty">暂无需要人工跟进的客户。</div>`; return; }
  active.forEach((item, idx) => {
    const n = document.createElement("div"); n.className = "follow-item";
    n.innerHTML = `
      <div class="follow-head">
        <h5>${esc(item.subject || "无主题")}</h5>
        ${item.moved_to_followup ? `<span class="follow-tag">已移入跟进</span>` : ""}
      </div>
      <div class="follow-from">${esc(item.from || "")}</div>
      <div class="follow-snippet">${esc(short(item.snippet || item.body || ""))}</div>
      <div class="follow-time">${esc(item.time || "")}</div>`;
    n.addEventListener("click", () => openMailModal(item, { type: "intervention" }));
    l.appendChild(n);
  });
}

function renderBounces(items) {
  const l = $("bounceList"); if (!l) return; l.innerHTML = "";
  if (!items.length) { l.innerHTML = `<div class="empty">今天还没有记录到退信邮箱。</div>`; return; }
  items.forEach((item) => {
    const n = document.createElement("div"); n.className = "bounce-row"; n.dataset.bid = item.id || ""; n.tabIndex = 0;
    n.innerHTML = `
      <div class="bounce-icon">⚠</div>
      <div class="bounce-info">
        <strong>${esc(item.model_label || item.model || "?")} · ${esc(item.email || "")}</strong>
        <span>${esc(short(item.reason || item.subject || "", 100))}</span>
      </div>
      <span class="bounce-time">${esc(item.time || "")}</span>`;
    n.addEventListener("click", () => openMailModal(item, { type: "bounce" }));
    n.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMailModal(item, { type: "bounce" }); } });
    l.appendChild(n);
  });
}

function matchText(v) { return String(v || "").replace(/\s+/g, " ").trim().toLowerCase(); }

function localMailMatch(msg, intv) {
  const tf = matchText(intv.from), ts = matchText(intv.subject), te = matchText(intv.email), tm = matchText(intv.model);
  const tb = matchText(intv.snippet || intv.body);
  const mf = matchText(msg.from), ms = matchText(msg.subject), mb = matchText(msg.snippet || msg.body);
  const mt = matchText(`${msg.from || ""} ${msg.body || ""} ${msg.snippet || ""}`);
  const fromOk = (tf && mf === tf) || (te && mf.includes(te));
  const emailOk = te && mt.includes(te);
  const subOk = ts && (ms === ts || ms.includes(ts) || ts.includes(ms));
  const bodyOk = tb && mb && (mb.includes(tb.slice(0, 100)) || tb.includes(mb.slice(0, 100)));
  const modelOk = tm && ms.includes(tm.replace("_", " "));
  return Boolean((fromOk || emailOk) && (subOk || bodyOk || modelOk || !ts));
}

function removeMailMsgs(records = [], fallback = null) {
  const ids = new Set(records.map((r) => `${r.account_key || ""}:${r.id || ""}`));
  state.mailAccounts.forEach((a) => {
    a.messages = (a.messages || []).filter((m) => !ids.has(`${a.key || ""}:${m.id || ""}`) && !(fallback && localMailMatch(m, fallback)));
    a.new_count = a.messages.filter((m) => !m.read_at).length;
  });
}

function closeLocalInterventions(records = [], fallback = null) {
  const ids = new Set(records.map((r) => r.id).filter(Boolean));
  state.interventions.forEach((i) => { if (ids.has(i.id) || (fallback && localMailMatch(fallback, i))) { i.status = "已处理"; i.handled_at = new Date().toISOString(); } });
}

function markMailForIntv(intv) {
  state.mailAccounts.forEach((a) => (a.messages || []).forEach((m) => { if (localMailMatch(m, intv)) markMailOpened(a.key || "", m); }));
}

async function markIOpenedLocal(item) {
  if (!item) return;
  markIOpened(item);
  markMailForIntv(item);
  renderIntervention(state.interventions);
  renderMailAccounts(state.mailAccounts);
  if (!item.id) return;
  try {
    const r = await api("/api/intervention/read", { method: "POST", body: JSON.stringify({ id: item.id }) });
    (r.read_mail_messages || []).forEach((rec) => {
      const a = state.mailAccounts.find((x) => x.key === rec.account_key);
      const m = (a?.messages || []).find((x) => x.id === rec.id);
      if (m) markMailOpened(a.key || "", m);
    });
    renderMailAccounts(state.mailAccounts);
  } catch {}
}

async function openMailModal(item, opts = {}) {
  const modal = $("mailModal"); state.modalItem = item; state.modalOptions = opts;
  if (opts.type === "mailbox") { markMailOpened(opts.accountKey || "", item); renderMailAccounts(state.mailAccounts); }
  if (opts.type === "intervention") markIOpenedLocal(item);
  if (opts.type === "bounce") {
    $("modalSubject").textContent = `${item.model_label || item.model || "?"} 退信`;
    $("modalFrom").textContent = `${item.email || ""}${item.time ? " · " + item.time : ""}`;
    $("modalBody").innerHTML = toHtml([`退信车型：${item.model_label || item.model || "?"}`, `退信邮箱：${item.email || ""}`, item.subject ? `退信主题：${item.subject}` : "", item.from ? `来源：${item.from}` : "", "", item.reason || "未提取到退信原因"].filter(Boolean).join("\n"));
  } else {
    $("modalSubject").textContent = item.subject || "无主题";
    $("modalFrom").textContent = `${item.from || ""}${item.time ? " · " + item.time : ""}`;
    $("modalBody").innerHTML = toHtml(item.body || item.snippet || "");
  }
  $("markReadBtn").hidden = !["mailbox", "intervention"].includes(opts.type);
  const mb = $("moveFollowupBtn"); mb.hidden = opts.type !== "intervention"; mb.disabled = Boolean(item.moved_to_followup); mb.textContent = item.moved_to_followup ? "已移入跟进" : "移入跟进";
  const ib = $("moveInvalidBtn"); ib.hidden = opts.type !== "bounce"; ib.disabled = Boolean(item.moved_to_invalid); ib.textContent = item.moved_to_invalid ? "已移入失效" : "移入失效";
  const rb = $("removeBounceBtn"); rb.hidden = opts.type !== "bounce"; rb.disabled = false; rb.textContent = "移出退信";
  if (typeof modal.showModal === "function" && !modal.open) modal.showModal(); else modal.hidden = false;
}

function closeMailModal() {
  const m = $("mailModal");
  if (typeof m.close === "function" && m.open) m.close(); else m.hidden = true;
  state.modalItem = null; state.modalOptions = {};
  $("markReadBtn").hidden = true; $("moveFollowupBtn").hidden = true; $("moveFollowupBtn").disabled = false;
  $("moveInvalidBtn").hidden = true; $("moveInvalidBtn").disabled = false; $("removeBounceBtn").hidden = true; $("removeBounceBtn").disabled = false;
}

async function markCurrentRead() {
  const item = state.modalItem, opts = state.modalOptions || {};
  if (!item) return;
  if (opts.type === "mailbox") {
    const r = await api("/api/mail/remove", { method: "POST", body: JSON.stringify({ id: item.id, account_key: opts.accountKey || "" }) });
    if (r.removed && r.imap_seen === false) alert(`移除成功，但邮箱已读同步失败：${r.imap_error || ""}`);
    removeMailMsgs([{ account_key: opts.accountKey || "", id: item.id }]); closeLocalInterventions(r.closed_interventions || [], item);
    closeMailModal(); renderMailAccounts(state.mailAccounts); renderIntervention(state.interventions); refresh(); return;
  }
  if (opts.type === "intervention") {
    const r = await api("/api/intervention/close", { method: "POST", body: JSON.stringify({ id: item.id }) });
    const c = state.interventions.find((x) => x.id === item.id); if (c) { c.status = "已处理"; c.handled_at = new Date().toISOString(); }
    removeMailMsgs(r.removed_mail_messages || [], item); closeMailModal(); renderIntervention(state.interventions); renderMailAccounts(state.mailAccounts); refresh();
  }
}

async function moveIntvToFollowup() {
  const item = state.modalItem, opts = state.modalOptions || {};
  if (!item || opts.type !== "intervention") return;
  const btn = $("moveFollowupBtn"); btn.disabled = true;
  try {
    const r = await api("/api/intervention/followup", { method: "POST", body: JSON.stringify({ id: item.id }) });
    const c = state.interventions.find((x) => x.id === item.id);
    if (c) { c.moved_to_followup = Boolean(r.moved || r.already_moved); c.model = r.model || c.model; c.email = r.email || c.email; }
    item.moved_to_followup = true; btn.textContent = "已移入跟进"; renderIntervention(state.interventions); refresh();
  } catch (e) { btn.disabled = false; alert(e.message || "移入跟进失败"); }
}

async function moveBounceToInvalid() {
  const item = state.modalItem; if (!item || state.modalOptions?.type !== "bounce") return;
  $("moveInvalidBtn").disabled = true; $("removeBounceBtn").disabled = true;
  try {
    await api("/api/bounce/invalid", { method: "POST", body: JSON.stringify({ id: item.id }) });
    state.bounces = state.bounces.filter((x) => x.id !== item.id); renderBounces(state.bounces); closeMailModal(); await refresh();
  } catch (e) { $("moveInvalidBtn").disabled = false; $("removeBounceBtn").disabled = false; alert(e.message || "移入失效失败"); }
}

async function removeBounce() {
  const item = state.modalItem; if (!item || state.modalOptions?.type !== "bounce") return;
  $("removeBounceBtn").disabled = true; $("moveInvalidBtn").disabled = true;
  try {
    await api("/api/bounce/remove", { method: "POST", body: JSON.stringify({ id: item.id }) });
    state.bounces = state.bounces.filter((x) => x.id !== item.id); renderBounces(state.bounces); closeMailModal(); await refresh();
  } catch (e) { $("removeBounceBtn").disabled = false; $("moveInvalidBtn").disabled = false; alert(e.message || "移出退信失败"); }
}

function renderTask(task) {
  const l = $("taskState");
  if (!task) { l.textContent = "空闲"; l.className = "badge idle"; setBusy(false); return; }
  const m = { running: "运行中", done: "完成", failed: "失败" };
  l.textContent = m[task.status] || task.status;
  l.className = `badge ${task.status === "running" ? "running" : task.status === "done" ? "ok" : task.status === "failed" ? "bad" : "idle"}`;
  setBusy(task.status === "running");
}

async function refresh() {
  const d = await api("/api/status");
  state.models = d.models || []; state.senders = d.senders || []; state.interventions = d.intervention || [];
  state.bounces = d.bounces || []; state.mailAccounts = d.mail_accounts || [];
  $("clock").textContent = `最后刷新 ${d.now}`;
  const total = state.models.reduce((s, m) => s + (m.count || 0), 0);
  const unsent = state.models.reduce((s, m) => s + (m.unsent || 0), 0);
  const sent = state.models.reduce((s, m) => s + (m.sent || 0), 0);
  syncMailNotifs(state.mailAccounts); syncInterventionNotifs(state.interventions);
  $("totalCount").textContent = total; $("unsentCount").textContent = unsent; $("sentCount").textContent = sent;
  $("interventionCount").textContent = activeItems(state.interventions).length;
  fillSelects(state.models, state.senders); renderModels(state.models); renderMailAccounts(state.mailAccounts);
  renderIntervention(state.interventions); renderBounces(state.bounces); renderTask(d.task);
  return d;
}

async function waitForIdle(max = 30) { for (let i = 0; i < max; i++) { await wait(800); const d = await refresh(); if (!d.task || d.task.status !== "running") return d; } return refresh(); }

async function startDaily() { await api("/api/daily-collect", { method: "POST", body: JSON.stringify({ limit: 10 }) }); refresh(); }
async function syncAllSheets() { await api("/api/sync-sheets", { method: "POST", body: "{}" }); await refresh(); await waitForIdle(); }
async function syncModel(m) { await api("/api/sync-model", { method: "POST", body: JSON.stringify({ model: m.key }) }); await refresh(); await waitForIdle(); }

async function sendMail() {
  const model = $("modelSelect").value; syncSendLimit(); const limit = Number($("sendLimit").value || 0); const sender = $("senderSelect").value;
  if (!sender) { alert("请先配置并选择发件邮箱。"); return; }
  if (limit <= 0) { alert("该车型没有未发客户。"); return; }
  await api("/api/send", { method: "POST", body: JSON.stringify({ model, limit, sender }) }); refresh();
}

async function resetModel(m) { if (!confirm(`确定重置 ${m.label} 的已发/未发状态吗？`)) return; await api("/api/reset-model", { method: "POST", body: JSON.stringify({ model: m.key }) }); refresh(); }
async function clearInterventions() { const n = activeItems(state.interventions).length; if (!n) return; if (!confirm(`确定清除 ${n} 封待人工跟进邮件吗？`)) return; await api("/api/intervention/clear", { method: "POST", body: "{}" }); refresh(); }

$("refreshBtn").addEventListener("click", refresh);
$("dailyBtn").addEventListener("click", startDaily);
$("syncSheetsBtn").addEventListener("click", syncAllSheets);
$("sendBtn").addEventListener("click", sendMail);
$("modelSelect").addEventListener("change", syncSendLimit);
$("sendLimit").addEventListener("input", syncSendLimit);
$("clearInterventionBtn").addEventListener("click", clearInterventions);
$("mailGrid").addEventListener("click", (e) => {
  const el = e.target.closest("[data-mid]"); if (!el || !$("mailGrid").contains(el)) return;
  const ak = el.dataset.ak || ""; const a = state.mailAccounts.find((x) => x.key === ak); const m = (a?.messages || []).find((x) => x.id === el.dataset.mid);
  if (m) openMailModal(m, { type: "mailbox", accountKey: ak });
});
$("markReadBtn").addEventListener("click", markCurrentRead);
$("moveFollowupBtn").addEventListener("click", moveIntvToFollowup);
$("moveInvalidBtn").addEventListener("click", moveBounceToInvalid);
$("removeBounceBtn").addEventListener("click", removeBounce);
$("closeModalBtn").addEventListener("click", closeMailModal);
$("mailModal").addEventListener("click", (e) => { if (e.target === $("mailModal")) closeMailModal(); });
if ($("mailModal").addEventListener) $("mailModal").addEventListener("cancel", (e) => { e.preventDefault(); closeMailModal(); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMailModal(); });

refresh();
setInterval(refresh, 5000);
