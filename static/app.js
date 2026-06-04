const state = {
  models: [],
  taskRunning: false,
};

const $ = (id) => document.getElementById(id);

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
  $("pollBtn").disabled = isBusy;
}

function renderModels(models) {
  const grid = $("modelGrid");
  grid.innerHTML = "";
  const select = $("modelSelect");
  const selected = select.value;
  select.innerHTML = "";

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.key;
    option.textContent = model.label;
    select.appendChild(option);

    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div>
        <h3>${model.label}</h3>
        <div class="cardMeta">${model.workbook || model.error || ""}</div>
      </div>
      <div class="metricRow">
        <div class="metric"><span>客户</span><strong>${model.count || 0}</strong></div>
        <div class="metric"><span>未发</span><strong>${model.unsent || 0}</strong></div>
      </div>
      <div class="metricRow">
        <div class="metric"><span>已发</span><strong>${model.sent || 0}</strong></div>
        <div class="metric"><span>失效</span><strong>${model.invalid || 0}</strong></div>
      </div>
      <div class="cardMeta">${model.last_updated ? `更新 ${model.last_updated}` : ""}</div>
    `;
    grid.appendChild(card);
  });
  if (selected && [...select.options].some((item) => item.value === selected)) {
    select.value = selected;
  }
}

function renderIntervention(items) {
  const list = $("interventionList");
  list.innerHTML = "";
  const active = items.filter((item) => item.status !== "已处理");
  if (!active.length) {
    list.innerHTML = `<div class="item"><p>暂无需要处理的客户。</p></div>`;
    return;
  }
  active.forEach((item, index) => {
    const node = document.createElement("div");
    node.className = "item";
    node.innerHTML = `
      <div class="itemTop">
        <div>
          <h3>${item.subject || "无主题"}</h3>
          <p>${item.from || ""}</p>
        </div>
        <button class="secondary" data-index="${index}">完成</button>
      </div>
      <p>${item.snippet || ""}</p>
      <p>${item.time || ""}</p>
    `;
    node.querySelector("button").addEventListener("click", async () => {
      await api("/api/intervention/close", {
        method: "POST",
        body: JSON.stringify({ index }),
      });
      refresh();
    });
    list.appendChild(node);
  });
}

function renderTask(task) {
  const label = $("taskState");
  if (!task) {
    label.textContent = "空闲";
    label.className = "";
    setBusy(false);
    return;
  }
  label.textContent = `${task.kind || "任务"}：${task.status || "running"}`;
  label.className = task.status === "failed" ? "statusFail" : task.status === "done" ? "statusDone" : "";
  setBusy(task.status === "running");
}

async function refresh() {
  const data = await api("/api/status");
  state.models = data.models || [];
  $("clock").textContent = `最后刷新 ${data.now}`;
  const total = state.models.reduce((sum, model) => sum + (model.count || 0), 0);
  const unsent = state.models.reduce((sum, model) => sum + (model.unsent || 0), 0);
  const invalid = state.models.reduce((sum, model) => sum + (model.invalid || 0), 0);
  const interventions = (data.intervention || []).filter((item) => item.status !== "已处理").length;
  $("totalCount").textContent = total;
  $("unsentCount").textContent = unsent;
  $("invalidCount").textContent = invalid;
  $("interventionCount").textContent = interventions;
  $("mailBtn").textContent = data.mail_monitor && data.mail_monitor.running ? "停止邮件监控" : "启动邮件监控";
  renderModels(state.models);
  renderIntervention(data.intervention || []);
  renderTask(data.task);
  $("logs").textContent = (data.recent_logs || []).join("\n");
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
  await api("/api/send", {
    method: "POST",
    body: JSON.stringify({ model, limit }),
  });
  refresh();
}

async function toggleMail() {
  const running = $("mailBtn").textContent.includes("停止");
  await api(running ? "/api/mail/stop" : "/api/mail/start", { method: "POST", body: "{}" });
  refresh();
}

async function pollMail() {
  await api("/api/mail/poll", { method: "POST", body: "{}" });
  refresh();
}

$("refreshBtn").addEventListener("click", refresh);
$("dailyBtn").addEventListener("click", startDaily);
$("sendBtn").addEventListener("click", sendMail);
$("mailBtn").addEventListener("click", toggleMail);
$("pollBtn").addEventListener("click", pollMail);

refresh();
setInterval(refresh, 5000);
