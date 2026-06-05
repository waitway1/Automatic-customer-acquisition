const state = {
  models: [],
  senders: [],
  interventions: [],
  taskRunning: false,
};

const $ = (id) => document.getElementById(id);

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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

function setBusy(isBusy) {
  state.taskRunning = isBusy;
  $("dailyBtn").disabled = isBusy;
  $("sendBtn").disabled = isBusy;
  document.querySelectorAll("[data-reset]").forEach((button) => {
    button.disabled = isBusy;
  });
}

function fillSelects(models, senders) {
  const modelSelect = $("modelSelect");
  const selectedModel = modelSelect.value;
  modelSelect.innerHTML = "";
  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.key;
    option.textContent = model.label;
    modelSelect.appendChild(option);
  });
  if (selectedModel && [...modelSelect.options].some((item) => item.value === selectedModel)) {
    modelSelect.value = selectedModel;
  }

  const senderSelect = $("senderSelect");
  const selectedSender = senderSelect.value;
  senderSelect.innerHTML = "";
  senders.forEach((sender) => {
    const option = document.createElement("option");
    option.value = sender.key;
    option.textContent = sender.user ? `${sender.label} (${sender.user})` : sender.label;
    senderSelect.appendChild(option);
  });
  if (!senders.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "未配置发件邮箱";
    senderSelect.appendChild(option);
  } else if (selectedSender && [...senderSelect.options].some((item) => item.value === selectedSender)) {
    senderSelect.value = selectedSender;
  }
}

function renderModels(models) {
  const grid = $("modelGrid");
  grid.innerHTML = "";
  models.forEach((model) => {
    const card = document.createElement("article");
    card.className = "modelCard";
    card.innerHTML = `
      <div class="cardTitle">
        <h3>${model.label}</h3>
        <button class="ghost" data-reset="${model.key}">重置</button>
      </div>
      <div class="primaryMetric">
        <span>客户</span>
        <strong>${model.count || 0}</strong>
      </div>
      <div class="metricStrip">
        <div><span>已发</span><strong>${model.sent || 0}</strong></div>
        <div><span>未发</span><strong>${model.unsent || 0}</strong></div>
        <div><span>今日失效</span><strong>${model.invalid || 0}</strong></div>
      </div>
      <p class="subtle">${model.last_updated ? `更新时间 ${model.last_updated}` : ""}</p>
    `;
    card.querySelector("[data-reset]").addEventListener("click", () => resetModel(model));
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
    const statusClass = mailStatusClass(account.status);
    node.className = "mailCard";
    node.innerHTML = `
      <div class="cardTitle">
        <h3>${account.label}</h3>
        <span class="badge ${statusClass}">${account.status || "等待检查"}</span>
      </div>
      <p class="mailUser">${account.user || "未填写账号"}</p>
      <div class="mailStats">
        <div><span>新邮件</span><strong>${account.checked || 0}</strong></div>
        <div><span>意向</span><strong>${account.interested || 0}</strong></div>
      </div>
      <p class="subtle">${account.last_checked ? `最近检查 ${account.last_checked}` : "等待后台检查"}</p>
      ${account.error ? `<p class="errorText">${account.error}</p>` : ""}
    `;
    grid.appendChild(node);
  });
}

function renderIntervention(items) {
  const list = $("interventionList");
  list.innerHTML = "";
  const active = items.filter((item) => item.status !== "已处理");
  $("clearInterventionBtn").disabled = !active.length;
  if (!active.length) {
    list.innerHTML = `<div class="empty">暂无需要人工跟进的客户。</div>`;
    return;
  }
  active.forEach((item, index) => {
    const node = document.createElement("div");
    node.className = `followItem ${item.read_at ? "read" : "unread"}`;
    const itemId = item.id || String(index);
    node.innerHTML = `
      <div class="cardTitle">
        <div class="mailHeading">
          <span class="unreadDot" aria-hidden="true"></span>
          <h3>${escapeHtml(item.subject || "无主题")}</h3>
        </div>
        <button class="ghost" data-close="${escapeHtml(itemId)}">完成</button>
      </div>
      <button class="mailPreview" data-open="${escapeHtml(itemId)}" type="button">
        <span>${escapeHtml(item.from || "")}</span>
        <strong>${escapeHtml(shortText(item.snippet || item.body || ""))}</strong>
      </button>
      <p class="subtle">${escapeHtml(item.time || "")}</p>
    `;
    node.querySelector("[data-close]").addEventListener("click", async (event) => {
      event.stopPropagation();
      await api("/api/intervention/close", {
        method: "POST",
        body: JSON.stringify({ id: itemId }),
      });
      refresh();
    });
    node.querySelector("[data-open]").addEventListener("click", () => openMailModal(item));
    list.appendChild(node);
  });
}

async function openMailModal(item) {
  $("modalSubject").textContent = item.subject || "无主题";
  $("modalFrom").textContent = `${item.from || ""}${item.time ? ` · ${item.time}` : ""}`;
  $("modalBody").innerHTML = textToHtml(item.body || item.snippet || "");
  $("mailModal").hidden = false;
  if (!item.read_at && item.id) {
    await api("/api/intervention/read", {
      method: "POST",
      body: JSON.stringify({ id: item.id }),
    });
    const current = state.interventions.find((entry) => entry.id === item.id);
    if (current) current.read_at = new Date().toISOString();
    renderIntervention(state.interventions);
  }
}

function closeMailModal() {
  $("mailModal").hidden = true;
}

function renderTask(task) {
  const label = $("taskState");
  if (!task) {
    label.textContent = "空闲";
    label.className = "task idle";
    setBusy(false);
    return;
  }
  const map = { running: "运行中", done: "完成", failed: "失败" };
  label.textContent = `${task.kind || "任务"}：${map[task.status] || task.status}`;
  label.className = `task ${task.status || "idle"}`;
  setBusy(task.status === "running");
}

async function refresh() {
  const data = await api("/api/status");
  state.models = data.models || [];
  state.senders = data.senders || [];
  state.interventions = data.intervention || [];
  $("clock").textContent = `最后刷新 ${data.now}`;
  const total = state.models.reduce((sum, model) => sum + (model.count || 0), 0);
  const unsent = state.models.reduce((sum, model) => sum + (model.unsent || 0), 0);
  const sent = state.models.reduce((sum, model) => sum + (model.sent || 0), 0);
  const interventions = state.interventions.filter((item) => item.status !== "已处理").length;
  $("totalCount").textContent = total;
  $("unsentCount").textContent = unsent;
  $("sentCount").textContent = sent;
  $("interventionCount").textContent = interventions;
  fillSelects(state.models, state.senders);
  renderModels(state.models);
  renderMailAccounts(data.mail_accounts || []);
  renderIntervention(state.interventions);
  renderTask(data.task);
}

async function startDaily() {
  await api("/api/daily-collect", {
    method: "POST",
    body: JSON.stringify({ limit: 10 }),
  });
  refresh();
}

async function sendMail() {
  const model = $("modelSelect").value;
  const limit = Number($("sendLimit").value || 1);
  const sender = $("senderSelect").value;
  if (!sender) {
    alert("请先配置并选择发件邮箱。");
    return;
  }
  await api("/api/send", {
    method: "POST",
    body: JSON.stringify({ model, limit, sender }),
  });
  refresh();
}

async function resetModel(model) {
  const ok = confirm(`确定重置 ${model.label} 的已发/未发状态吗？系统会先备份 Excel，再清空发送日期。`);
  if (!ok) return;
  await api("/api/reset-model", {
    method: "POST",
    body: JSON.stringify({ model: model.key }),
  });
  refresh();
}

async function clearInterventions() {
  const active = state.interventions.filter((item) => item.status !== "已处理").length;
  if (!active) return;
  const ok = confirm(`确定清除 ${active} 封待人工跟进邮件吗？`);
  if (!ok) return;
  await api("/api/intervention/clear", { method: "POST", body: "{}" });
  refresh();
}

$("refreshBtn").addEventListener("click", refresh);
$("dailyBtn").addEventListener("click", startDaily);
$("sendBtn").addEventListener("click", sendMail);
$("clearInterventionBtn").addEventListener("click", clearInterventions);
$("closeModalBtn").addEventListener("click", closeMailModal);
$("mailModal").addEventListener("click", (event) => {
  if (event.target === $("mailModal")) closeMailModal();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMailModal();
});

refresh();
setInterval(refresh, 5000);
