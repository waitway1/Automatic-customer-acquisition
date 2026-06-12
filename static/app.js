const state = {
  models: [],
  senders: [],
  interventions: [],
  bounces: [],
  mailAccounts: [],
  taskRunning: false,
  modalItem: null,
  modalOptions: {},
  interventionSnapshotReady: false,
  knownInterventionKeys: new Set(),
  mailSnapshotReady: false,
  knownMailKeys: new Set(),
};

const $ = (id) => document.getElementById(id);
const MAIL_NOTIFY_STORAGE_KEY = "celeste.seenMailNotificationKeys.v1";
const INTERVENTION_NOTIFY_STORAGE_KEY = "celeste.seenInterventionNotificationKeys.v1";
const OPENED_MAIL_STORAGE_KEY = "celeste.openedMailKeys.v1";
const OPENED_INTERVENTION_STORAGE_KEY = "celeste.openedInterventionKeys.v1";
const MAX_STORED_NOTIFICATION_KEYS = 800;

function loadStoredKeySet(storageKey) {
  try {
    const values = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return new Set(Array.isArray(values) ? values.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveStoredKeySet(storageKey, keys) {
  try {
    const values = [...keys].filter(Boolean).slice(-MAX_STORED_NOTIFICATION_KEYS);
    localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {}
}

const seenMailNotificationKeys = loadStoredKeySet(MAIL_NOTIFY_STORAGE_KEY);
const seenInterventionNotificationKeys = loadStoredKeySet(INTERVENTION_NOTIFY_STORAGE_KEY);
const openedMailKeys = loadStoredKeySet(OPENED_MAIL_STORAGE_KEY);
const openedInterventionKeys = loadStoredKeySet(OPENED_INTERVENTION_STORAGE_KEY);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function shortText(value, length = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function activeInterventionItems(items) {
  return (items || []).filter((item) => item.status !== "已处理");
}

function interventionKey(item) {
  return item.id || [item.from, item.subject, item.email, item.time].filter(Boolean).join("|");
}

function isInterventionOpened(item) {
  return Boolean(item?.read_at) || openedInterventionKeys.has(interventionKey(item));
}

function markInterventionOpenedLocallyState(item) {
  if (!item) return;
  item.read_at = item.read_at || new Date().toISOString();
  const key = interventionKey(item);
  if (key) {
    openedInterventionKeys.add(key);
    saveStoredKeySet(OPENED_INTERVENTION_STORAGE_KEY, openedInterventionKeys);
  }
}

function mailMessageKey(account, message) {
  return [account?.key, message?.id || message?.imap_uid, message?.subject, message?.from].filter(Boolean).join("|");
}

function messageOpenedKey(accountKey, message) {
  return [accountKey, message?.id || message?.imap_uid, message?.subject, message?.from].filter(Boolean).join("|");
}

function isMailOpened(accountKey, message) {
  return Boolean(message?.opened_at) || openedMailKeys.has(messageOpenedKey(accountKey, message));
}

function markMailOpenedLocally(accountKey, message) {
  if (!message) return;
  message.opened_at = message.opened_at || new Date().toISOString();
  const key = messageOpenedKey(accountKey, message);
  if (key) {
    openedMailKeys.add(key);
    saveStoredKeySet(OPENED_MAIL_STORAGE_KEY, openedMailKeys);
  }
}

function showAutoDismissNotification(title, options = {}) {
  let region = $("toastRegion");
  if (!region) {
    region = document.createElement("div");
    region.id = "toastRegion";
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  const body = shortText(options.body || "", 180);
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong> ${body ? escapeHtml(body) : ""}`;
  region.appendChild(toast);
  const visibleToasts = [...region.querySelectorAll(".toast")];
  visibleToasts.slice(0, Math.max(0, visibleToasts.length - 3)).forEach((item) => item.remove());
  requestAnimationFrame(() => toast.classList.add("visible"));
  const close = () => {
    toast.classList.remove("visible");
    window.setTimeout(() => toast.remove(), 220);
  };
  const timer = window.setTimeout(close, options.timeoutMs || 4500);
  toast.addEventListener("click", () => { window.clearTimeout(timer); close(); }, { once: true });
  return toast;
}

function notifyIntervention(item) {
  const key = interventionKey(item);
  const detail = [item.from, item.subject, item.snippet || item.body].filter(Boolean).join(" ");
  showAutoDismissNotification("新的待人工跟进邮件", { body: shortText(detail, 180), tag: key ? `intervention-${key}` : "intervention-mail" });
}

function notifyMailMessage(account, message) {
  const key = mailMessageKey(account, message);
  const detail = [account?.label, message.from, message.subject, message.snippet || message.body].filter(Boolean).join(" ");
  showAutoDismissNotification("收到新邮件", { body: shortText(detail, 180), tag: key ? `mail-${key}` : "mail-message" });
}

function syncMailNotifications(accounts) {
  const unreadMessages = [];
  (accounts || []).forEach((account) => {
    (account.messages || []).filter((message) => !message.read_at).forEach((message) => unreadMessages.push({ account, message }));
  });
  const activeKeys = new Set(unreadMessages.map(({ account, message }) => mailMessageKey(account, message)).filter(Boolean));
  if (!state.mailSnapshotReady) {
    state.knownMailKeys = activeKeys;
    activeKeys.forEach((key) => seenMailNotificationKeys.add(key));
    saveStoredKeySet(MAIL_NOTIFY_STORAGE_KEY, seenMailNotificationKeys);
    state.mailSnapshotReady = true;
    return;
  }
  unreadMessages
    .filter(({ account, message }) => {
      const key = mailMessageKey(account, message);
      return key && message.is_new === true && !state.knownMailKeys.has(key) && !seenMailNotificationKeys.has(key);
    })
    .forEach(({ account, message }) => {
      seenMailNotificationKeys.add(mailMessageKey(account, message));
      notifyMailMessage(account, message);
    });
  activeKeys.forEach((key) => seenMailNotificationKeys.add(key));
  saveStoredKeySet(MAIL_NOTIFY_STORAGE_KEY, seenMailNotificationKeys);
  state.knownMailKeys = activeKeys;
}

function syncInterventionNotifications(items) {
  const activeItems = activeInterventionItems(items);
  const activeKeys = new Set(activeItems.map(interventionKey).filter(Boolean));
  if (!state.interventionSnapshotReady) {
    state.knownInterventionKeys = activeKeys;
    activeKeys.forEach((key) => seenInterventionNotificationKeys.add(key));
    saveStoredKeySet(INTERVENTION_NOTIFY_STORAGE_KEY, seenInterventionNotificationKeys);
    state.interventionSnapshotReady = true;
    return;
  }
  activeItems
    .filter((item) => {
      const key = interventionKey(item);
      return key && !state.knownInterventionKeys.has(key) && !seenInterventionNotificationKeys.has(key);
    })
    .forEach((item) => {
      seenInterventionNotificationKeys.add(interventionKey(item));
      notifyIntervention(item);
    });
  activeKeys.forEach((key) => seenInterventionNotificationKeys.add(key));
  saveStoredKeySet(INTERVENTION_NOTIFY_STORAGE_KEY, seenInterventionNotificationKeys);
  state.knownInterventionKeys = activeKeys;
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function setBusy(isBusy) {
  state.taskRunning = isBusy;
  $("dailyBtn").disabled = isBusy;
  const syncBtn = $("syncSheetsBtn");
  if (syncBtn) syncBtn.disabled = isBusy;
  document.querySelectorAll("[data-reset]").forEach((b) => { b.disabled = isBusy; });
  document.querySelectorAll("[data-sync-model]").forEach((b) => { b.disabled = isBusy; });
  syncSendLimit();
}

function selectedModel() {
  return state.models.find((m) => m.key === $("modelSelect").value);
}

function syncSendLimit() {
  const input = $("sendLimit");
  const sendButton = $("sendBtn");
  const model = selectedModel();
  const max = Math.max(0, Number(model?.unsent || 0));
  input.max = String(max);
  input.min = "0";
  if (max <= 0) {
    input.value = "0";
    sendButton.disabled = true;
    return;
  }
  const nextValue = Math.min(max, Math.max(0, Math.floor(Number(input.value || 0))));
  input.value = String(nextValue);
  sendButton.disabled = state.taskRunning || nextValue <= 0;
}

function fillSelects(models, senders) {
  const modelSelect = $("modelSelect");
  const prev = modelSelect.value;
  modelSelect.innerHTML = "";
  models.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.key;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  });
  if (prev && [...modelSelect.options].some((o) => o.value === prev)) modelSelect.value = prev;

  const senderSelect = $("senderSelect");
  const prevSender = senderSelect.value;
  senderSelect.innerHTML = "";
  senders.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = s.user ? `${s.label} (${s.user})` : s.label;
    senderSelect.appendChild(opt);
  });
  if (!senders.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "未配置发件邮箱";
    senderSelect.appendChild(opt);
  } else if (prevSender && [...senderSelect.options].some((o) => o.value === prevSender)) {
    senderSelect.value = prevSender;
  }
  syncSendLimit();
}

function renderModels(models) {
  const grid = $("modelGrid");
  grid.innerHTML = "";
  models.forEach((m) => {
    const card = document.createElement("article");
    card.className = "model-card";
    card.innerHTML = `
      <div class="model-card-header">
        <h4>${escapeHtml(m.label)}</h4>
        <div class="model-card-actions">
          <button class="btn-tiny" data-sync-model="${m.key}">更新</button>
          <button class="btn-tiny" data-reset="${m.key}">重置</button>
        </div>
      </div>
      <div class="big-number">${m.count || 0}</div>
      <div class="small-stats">
        <div class="small-stat"><span>已发</span><strong>${m.sent || 0}</strong></div>
        <div class="small-stat"><span>未发</span><strong>${m.unsent || 0}</strong></div>
        <div class="small-stat"><span>失效</span><strong>${m.invalid || 0}</strong></div>
      </div>
      <div class="update-time">${m.last_updated || ""}</div>
    `;
    card.querySelector("[data-sync-model]").addEventListener("click", () => syncModel(m));
    card.querySelector("[data-reset]").addEventListener("click", () => resetModel(m));
    grid.appendChild(card);
  });
}

function mailStatusClass(status) {
  if (status === "正常") return "ok";
  if (status === "异常") return "bad";
  if (status === "未配置") return "warn";
  return "idle";
}

function renderMailAccounts(accounts) {
  const grid = $("mailGrid");
  grid.innerHTML = "";
  if (!accounts.length) {
    grid.innerHTML = `<div class="empty">未配置邮箱账户。</div>`;
    return;
  }
  accounts.forEach((account) => {
    const node = document.createElement("article");
    node.className = "mail-card";
    const messages = account.messages || [];
    const newCount = Number.isFinite(account.new_count) ? account.new_count : messages.length;
    node.innerHTML = `
      <div class="mail-card-header">
        <h4>${escapeHtml(account.label)}</h4>
        <span class="badge ${mailStatusClass(account.status)}">${escapeHtml(account.status || "等待检查")}</span>
      </div>
      <div class="mail-user">${escapeHtml(account.user || "未填写账号")}</div>
      <div class="mail-stats">
        <div class="mail-stat"><span>新邮件</span><strong>${newCount}</strong></div>
        <div class="mail-stat"><span>意向</span><strong>${account.interested || 0}</strong></div>
      </div>
      ${account.error ? `<div class="empty" style="color:var(--red);">${escapeHtml(account.error)}</div>` : ""}
      ${messages.length ? `<div class="mail-list">${messages.map((message) => `
        <div class="mail-item ${isMailOpened(account.key, message) ? "read" : ""}" data-account-key="${escapeHtml(account.key)}" data-mail-id="${escapeHtml(message.id)}">
          <div class="mail-dot"></div>
          <div class="mail-item-content">
            <div class="mail-item-from">${escapeHtml(message.from || "")}</div>
            <div class="mail-item-subject">${escapeHtml(shortText(message.subject || "无主题", 80))}</div>
            <div class="mail-item-snippet">${escapeHtml(shortText(message.snippet || message.body || "", 100))}</div>
          </div>
        </div>
      `).join("")}</div>` : ""}
    `;
    grid.appendChild(node);
  });
}

function renderIntervention(items) {
  const list = $("interventionList");
  list.innerHTML = "";
  const active = activeInterventionItems(items);
  $("clearInterventionBtn").disabled = !active.length;
  if (!active.length) {
    list.innerHTML = `<div class="empty">暂无需要人工跟进的客户。</div>`;
    return;
  }
  active.forEach((item, index) => {
    const node = document.createElement("div");
    node.className = "follow-item";
    const itemId = item.id || String(index);
    node.innerHTML = `
      <div class="follow-item-header">
        <h5>${escapeHtml(item.subject || "无主题")}</h5>
        ${item.moved_to_followup ? `<span class="follow-badge">已移入跟进</span>` : ""}
      </div>
      <div class="follow-item-from">${escapeHtml(item.from || "")}</div>
      <div class="follow-item-snippet">${escapeHtml(shortText(item.snippet || item.body || ""))}</div>
      <div class="follow-item-time">${escapeHtml(item.time || "")}</div>
    `;
    node.addEventListener("click", () => openMailModal(item, { type: "intervention" }));
    list.appendChild(node);
  });
}

function renderBounces(items) {
  const list = $("bounceList");
  if (!list) return;
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = `<div class="empty">今天还没有记录到退信邮箱。</div>`;
    return;
  }
  items.forEach((item) => {
    const node = document.createElement("div");
    node.className = "bounce-item";
    node.dataset.bounceId = item.id || "";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.innerHTML = `
      <div class="bounce-icon">⚠</div>
      <div class="bounce-info">
        <strong>${escapeHtml(item.model_label || item.model || "未知车型")} · ${escapeHtml(item.email || "")}</strong>
        <span>${escapeHtml(shortText(item.reason || item.subject || "未提取到退信原因", 120))}</span>
      </div>
      <span style="font-size:11px;color:var(--muted);white-space:nowrap;">${escapeHtml(item.time || "")}</span>
    `;
    node.addEventListener("click", () => openMailModal(item, { type: "bounce" }));
    node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMailModal(item, { type: "bounce" }); } });
    list.appendChild(node);
  });
}

function mailMatchText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function localMailMatchesIntervention(message, intervention) {
  const targetFrom = mailMatchText(intervention.from);
  const targetSubject = mailMatchText(intervention.subject);
  const targetEmail = mailMatchText(intervention.email);
  const targetModel = mailMatchText(intervention.model);
  const targetBody = mailMatchText(intervention.snippet || intervention.body);
  const messageFrom = mailMatchText(message.from);
  const messageSubject = mailMatchText(message.subject);
  const messageBody = mailMatchText(message.snippet || message.body);
  const messageText = mailMatchText(`${message.from || ""} ${message.body || ""} ${message.snippet || ""}`);
  const fromMatches = (targetFrom && messageFrom === targetFrom) || (targetEmail && messageFrom.includes(targetEmail));
  const emailMatches = targetEmail && messageText.includes(targetEmail);
  const subjectMatches = targetSubject && (messageSubject === targetSubject || messageSubject.includes(targetSubject) || targetSubject.includes(messageSubject));
  const bodyMatches = targetBody && messageBody && (messageBody.includes(targetBody.slice(0, 120)) || targetBody.includes(messageBody.slice(0, 120)));
  const modelMatches = targetModel && messageSubject.includes(targetModel.replace("_", " "));
  return Boolean((fromMatches || emailMatches) && (subjectMatches || bodyMatches || modelMatches || !targetSubject));
}

function removeLocalMailboxMessages(records = [], fallbackIntervention = null) {
  const recordIds = new Set(records.map((r) => `${r.account_key || ""}:${r.id || ""}`));
  state.mailAccounts.forEach((account) => {
    account.messages = (account.messages || []).filter((m) => {
      return !recordIds.has(`${account.key || ""}:${m.id || ""}`) && !(fallbackIntervention && localMailMatchesIntervention(m, fallbackIntervention));
    });
    account.new_count = account.messages.filter((m) => !m.read_at).length;
  });
}

function closeLocalInterventions(records = [], fallbackMessage = null) {
  const closedIds = new Set(records.map((r) => r.id).filter(Boolean));
  state.interventions.forEach((i) => {
    if (closedIds.has(i.id) || (fallbackMessage && localMailMatchesIntervention(fallbackMessage, i))) {
      i.status = "已处理";
      i.handled_at = new Date().toISOString();
    }
  });
}

function markMatchingMailboxOpenedForIntervention(intervention) {
  state.mailAccounts.forEach((account) => {
    (account.messages || []).forEach((message) => {
      if (localMailMatchesIntervention(message, intervention)) markMailOpenedLocally(account.key || "", message);
    });
  });
}

async function markInterventionOpenedLocally(item) {
  if (!item) return;
  markInterventionOpenedLocallyState(item);
  markMatchingMailboxOpenedForIntervention(item);
  renderIntervention(state.interventions);
  renderMailAccounts(state.mailAccounts);
  if (!item.id) return;
  try {
    const result = await api("/api/intervention/read", { method: "POST", body: JSON.stringify({ id: item.id }) });
    (result.read_mail_messages || []).forEach((record) => {
      const account = state.mailAccounts.find((a) => a.key === record.account_key);
      const message = (account?.messages || []).find((m) => m.id === record.id);
      if (message) markMailOpenedLocally(account.key || "", message);
    });
    renderMailAccounts(state.mailAccounts);
  } catch {}
}

async function openMailModal(item, options = {}) {
  const modal = $("mailModal");
  state.modalItem = item;
  state.modalOptions = options;
  if (options.type === "mailbox") { markMailOpenedLocally(options.accountKey || "", item); renderMailAccounts(state.mailAccounts); }
  if (options.type === "intervention") markInterventionOpenedLocally(item);
  if (options.type === "bounce") {
    $("modalSubject").textContent = `${item.model_label || item.model || "未知车型"} 退信`;
    $("modalFrom").textContent = `${item.email || ""}${item.time ? ` · ${item.time}` : ""}`;
    $("modalBody").innerHTML = textToHtml([`退信车型：${item.model_label || item.model || "未知车型"}`, `退信邮箱：${item.email || ""}`, item.subject ? `退信主题：${item.subject}` : "", item.from ? `来源：${item.from}` : "", "", item.reason || "未提取到退信原因"].filter((l) => l !== "").join("\n"));
  } else {
    $("modalSubject").textContent = item.subject || "无主题";
    $("modalFrom").textContent = `${item.from || ""}${item.time ? ` · ${item.time}` : ""}`;
    $("modalBody").innerHTML = textToHtml(item.body || item.snippet || "");
  }
  $("markReadBtn").hidden = !["mailbox", "intervention"].includes(options.type);
  const moveButton = $("moveFollowupBtn");
  moveButton.hidden = options.type !== "intervention";
  moveButton.disabled = Boolean(item.moved_to_followup);
  moveButton.textContent = item.moved_to_followup ? "已移入跟进" : "移入跟进";
  const invalidButton = $("moveInvalidBtn");
  invalidButton.hidden = options.type !== "bounce";
  invalidButton.disabled = Boolean(item.moved_to_invalid);
  invalidButton.textContent = item.moved_to_invalid ? "已移入失效" : "移入失效";
  const removeBounceButton = $("removeBounceBtn");
  removeBounceButton.hidden = options.type !== "bounce";
  removeBounceButton.disabled = false;
  removeBounceButton.textContent = "移出退信";
  if (typeof modal.showModal === "function" && !modal.open) modal.showModal();
  else modal.hidden = false;
}

function closeMailModal() {
  const modal = $("mailModal");
  if (typeof modal.close === "function" && modal.open) modal.close();
  else modal.hidden = true;
  state.modalItem = null;
  state.modalOptions = {};
  $("markReadBtn").hidden = true;
  $("moveFollowupBtn").hidden = true;
  $("moveFollowupBtn").disabled = false;
  $("moveInvalidBtn").hidden = true;
  $("moveInvalidBtn").disabled = false;
  $("removeBounceBtn").hidden = true;
  $("removeBounceBtn").disabled = false;
}

async function markCurrentMailRead() {
  const item = state.modalItem;
  const options = state.modalOptions || {};
  if (!item) return;
  if (options.type === "mailbox") {
    const result = await api("/api/mail/remove", { method: "POST", body: JSON.stringify({ id: item.id, account_key: options.accountKey || "" }) });
    if (result.removed && result.imap_seen === false) alert(`网站已移除，但邮箱已读同步失败：${result.imap_error || "IMAP 未返回成功"}`);
    removeLocalMailboxMessages([{ account_key: options.accountKey || "", id: item.id }]);
    closeLocalInterventions(result.closed_interventions || [], item);
    closeMailModal();
    renderMailAccounts(state.mailAccounts);
    renderIntervention(state.interventions);
    refresh();
    return;
  }
  if (options.type === "intervention") {
    const result = await api("/api/intervention/close", { method: "POST", body: JSON.stringify({ id: item.id }) });
    const current = state.interventions.find((e) => e.id === item.id);
    if (current) { current.status = "已处理"; current.handled_at = new Date().toISOString(); }
    removeLocalMailboxMessages(result.removed_mail_messages || [], item);
    closeMailModal();
    renderIntervention(state.interventions);
    renderMailAccounts(state.mailAccounts);
    refresh();
  }
}

async function moveCurrentInterventionToFollowup() {
  const item = state.modalItem;
  const options = state.modalOptions || {};
  if (!item || options.type !== "intervention") return;
  const button = $("moveFollowupBtn");
  button.disabled = true;
  try {
    const result = await api("/api/intervention/followup", { method: "POST", body: JSON.stringify({ id: item.id }) });
    const current = state.interventions.find((e) => e.id === item.id);
    if (current) { current.moved_to_followup = Boolean(result.moved || result.already_moved); current.model = result.model || current.model; current.email = result.email || current.email; }
    item.moved_to_followup = true;
    button.textContent = "已移入跟进";
    renderIntervention(state.interventions);
    refresh();
  } catch (error) { button.disabled = false; alert(error.message || "移入跟进失败"); }
}

async function moveCurrentBounceToInvalid() {
  const item = state.modalItem;
  if (!item || state.modalOptions?.type !== "bounce") return;
  $("moveInvalidBtn").disabled = true;
  $("removeBounceBtn").disabled = true;
  try {
    await api("/api/bounce/invalid", { method: "POST", body: JSON.stringify({ id: item.id }) });
    state.bounces = state.bounces.filter((e) => e.id !== item.id);
    renderBounces(state.bounces);
    closeMailModal();
    await refresh();
  } catch (error) { $("moveInvalidBtn").disabled = false; $("removeBounceBtn").disabled = false; alert(error.message || "移入失效失败"); }
}

async function removeCurrentBounceRecord() {
  const item = state.modalItem;
  if (!item || state.modalOptions?.type !== "bounce") return;
  $("removeBounceBtn").disabled = true;
  $("moveInvalidBtn").disabled = true;
  try {
    await api("/api/bounce/remove", { method: "POST", body: JSON.stringify({ id: item.id }) });
    state.bounces = state.bounces.filter((e) => e.id !== item.id);
    renderBounces(state.bounces);
    closeMailModal();
    await refresh();
  } catch (error) { $("removeBounceBtn").disabled = false; $("moveInvalidBtn").disabled = false; alert(error.message || "移出退信失败"); }
}

function renderTask(task) {
  const label = $("taskState");
  if (!task) {
    label.textContent = "空闲";
    label.className = "badge idle";
    setBusy(false);
    return;
  }
  const map = { running: "运行中", done: "完成", failed: "失败" };
  label.textContent = `${map[task.status] || task.status}`;
  label.className = `badge ${task.status === "running" ? "running" : task.status === "done" ? "ok" : task.status === "failed" ? "bad" : "idle"}`;
  setBusy(task.status === "running");
}

async function refresh() {
  const data = await api("/api/status");
  state.models = data.models || [];
  state.senders = data.senders || [];
  state.interventions = data.intervention || [];
  state.bounces = data.bounces || [];
  state.mailAccounts = data.mail_accounts || [];
  $("clock").textContent = `最后刷新 ${data.now}`;
  const total = state.models.reduce((s, m) => s + (m.count || 0), 0);
  const unsent = state.models.reduce((s, m) => s + (m.unsent || 0), 0);
  const sent = state.models.reduce((s, m) => s + (m.sent || 0), 0);
  syncMailNotifications(state.mailAccounts);
  syncInterventionNotifications(state.interventions);
  $("totalCount").textContent = total;
  $("unsentCount").textContent = unsent;
  $("sentCount").textContent = sent;
  $("interventionCount").textContent = activeInterventionItems(state.interventions).length;
  fillSelects(state.models, state.senders);
  renderModels(state.models);
  renderMailAccounts(state.mailAccounts);
  renderIntervention(state.interventions);
  renderBounces(state.bounces);
  renderTask(data.task);
  return data;
}

async function waitForTaskIdle(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) { await delay(800); const data = await refresh(); if (!data.task || data.task.status !== "running") return data; }
  return refresh();
}

async function startDaily() { await api("/api/daily-collect", { method: "POST", body: JSON.stringify({ limit: 10 }) }); refresh(); }
async function syncAllSheets() { await api("/api/sync-sheets", { method: "POST", body: "{}" }); await refresh(); await waitForTaskIdle(); }
async function syncModel(model) { await api("/api/sync-model", { method: "POST", body: JSON.stringify({ model: model.key }) }); await refresh(); await waitForTaskIdle(); }

async function sendMail() {
  const model = $("modelSelect").value;
  syncSendLimit();
  const limit = Number($("sendLimit").value || 0);
  const sender = $("senderSelect").value;
  if (!sender) { alert("请先配置并选择发件邮箱。"); return; }
  if (limit <= 0) { alert("该车型没有未发客户。"); return; }
  await api("/api/send", { method: "POST", body: JSON.stringify({ model, limit, sender }) });
  refresh();
}

async function resetModel(model) {
  if (!confirm(`确定重置 ${model.label} 的已发/未发状态吗？`)) return;
  await api("/api/reset-model", { method: "POST", body: JSON.stringify({ model: model.key }) });
  refresh();
}

async function clearInterventions() {
  const active = activeInterventionItems(state.interventions).length;
  if (!active) return;
  if (!confirm(`确定清除 ${active} 封待人工跟进邮件吗？`)) return;
  await api("/api/intervention/clear", { method: "POST", body: "{}" });
  refresh();
}

$("refreshBtn").addEventListener("click", refresh);
$("dailyBtn").addEventListener("click", startDaily);
$("syncSheetsBtn").addEventListener("click", syncAllSheets);
$("sendBtn").addEventListener("click", sendMail);
$("modelSelect").addEventListener("change", syncSendLimit);
$("sendLimit").addEventListener("input", syncSendLimit);
$("clearInterventionBtn").addEventListener("click", clearInterventions);
$("mailGrid").addEventListener("click", (event) => {
  const item = event.target.closest("[data-mail-id]");
  if (!item || !$("mailGrid").contains(item)) return;
  const accountKey = item.dataset.accountKey || "";
  const account = state.mailAccounts.find((a) => a.key === accountKey);
  const message = (account?.messages || []).find((m) => m.id === item.dataset.mailId);
  if (message) openMailModal(message, { type: "mailbox", accountKey });
});
$("markReadBtn").addEventListener("click", markCurrentMailRead);
$("moveFollowupBtn").addEventListener("click", moveCurrentInterventionToFollowup);
$("moveInvalidBtn").addEventListener("click", moveCurrentBounceToInvalid);
$("removeBounceBtn").addEventListener("click", removeCurrentBounceRecord);
$("closeModalBtn").addEventListener("click", closeMailModal);
$("mailModal").addEventListener("click", (event) => { if (event.target === $("mailModal")) closeMailModal(); });
if ($("mailModal").addEventListener) $("mailModal").addEventListener("cancel", (e) => { e.preventDefault(); closeMailModal(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMailModal(); });

refresh();
setInterval(refresh, 5000);
