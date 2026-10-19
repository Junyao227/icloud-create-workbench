import { api, formValues } from "./api.js?v=5";
import { cooldownText, escapeHtml, renderAccountMeta, renderAccounts, renderAddresses, renderCampaigns, renderJobs, renderMessages, renderPagination } from "./render.js?v=5";

const state = {
  accounts: [], campaigns: [], jobs: [], addresses: [], messages: [], selectedAccountId: "",
  selectedAddressIds: new Set(),
  jobPagination: { page: 1, pageSize: 20 },
  addressPagination: { page: 1, pageSize: 20 },
  messagePagination: { page: 1, pageSize: 20 }
};
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map(element => [element.id, element]));
const validViews = new Set(["overview", "accounts", "tasks", "addresses", "inbox", "guide"]);

/** 显示短暂操作提示。 */
function toast(message, error = false) {
  elements.toast.textContent = message; elements.toast.classList.toggle("error", error); elements.toast.classList.add("show");
  setTimeout(() => elements.toast.classList.remove("show"), 3200);
}

/** 设置按钮的忙碌状态和提示文字。 */
function setBusy(formOrButton, busy, text = "处理中...") {
  const button = formOrButton?.tagName === "FORM" ? formOrButton.querySelector("button[type=submit]") : formOrButton;
  if (!button) return; if (busy) button.dataset.originalText = button.textContent;
  button.disabled = busy; button.textContent = busy ? text : button.dataset.originalText || button.textContent;
}

/** 下载后端返回的文本文件。 */
async function downloadText(path, options, fallbackName) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options
  });
  const text = await response.text();
  if (response.status === 401) {
    location.href = "/login.html";
    throw new Error("登录已过期");
  }
  if (!response.ok) {
    let data = {};
    try { data = JSON.parse(text || "{}"); } catch {}
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] || fallbackName;
  const url = URL.createObjectURL(new Blob([text], { type: response.headers.get("Content-Type") || "text/plain" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

/** 切换独立工作区并同步浏览器地址。 */
function navigate(view, push = true) {
  const target = validViews.has(view) ? view : "overview";
  document.querySelectorAll("[data-view]").forEach(section => section.classList.toggle("hidden", section.dataset.view !== target));
  document.querySelectorAll("[data-route]").forEach(link => link.classList.toggle("active", link.dataset.route === target));
  document.body.classList.remove("menu-open");
  if (push && location.pathname !== `/${target}`) history.pushState({ view: target }, "", `/${target}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** 拼接邮箱分页查询参数。 */
function addressQuery() {
  const params = new URLSearchParams({ page: state.addressPagination.page, pageSize: state.addressPagination.pageSize });
  if (elements.accountFilter.value) params.set("accountId", elements.accountFilter.value);
  if (elements.stateFilter.value) params.set("state", elements.stateFilter.value);
  if (elements.addressSearch.value.trim()) params.set("search", elements.addressSearch.value.trim());
  return params;
}

/** 渲染概览统计和最近状态。 */
function renderOverview() {
  elements.overviewAccounts.textContent = state.accounts.length;
  elements.overviewAddresses.textContent = state.accounts.reduce((sum, item) => sum + Number(item.addressCount || 0), 0);
  elements.overviewUnused.textContent = state.accounts.reduce((sum, item) => sum + Number(item.unusedCount || 0), 0);
  elements.overviewJobs.textContent = state.jobPagination.total || 0;
  elements.overviewAccountList.innerHTML = state.accounts.length ? state.accounts.map(account => `<button class="compact-row" data-account-open="${escapeHtml(account.id)}"><span><strong>${escapeHtml(account.appleId)}</strong><small>${escapeHtml(account.region === "china" ? "中国区" : "全球区")}</small></span><span>${escapeHtml(cooldownText(account.cooldownUntil))}</span></button>`).join("") : `<div class="empty">暂无 CK 账号</div>`;
  elements.overviewJobList.innerHTML = renderJobs(state.jobs.slice(0, 3));
}

/** 填充任务、库存和接码的 CK 选择器。 */
function renderAccountSelectors() {
  const taskValue = elements.taskAccount.value || state.selectedAccountId;
  const filterValue = elements.accountFilter.value;
  const inboxValue = elements.inboxAccount.value;
  const options = state.accounts.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.appleId)}</option>`).join("");
  elements.taskAccount.innerHTML = options || `<option value="">请先导入 CK</option>`;
  elements.accountFilter.innerHTML = `<option value="">全部 CK</option>${options}`;
  elements.inboxAccount.innerHTML = options || `<option value="">请先导入 CK</option>`;
  if (state.accounts.some(item => item.id === taskValue)) elements.taskAccount.value = taskValue;
  if (state.accounts.some(item => item.id === filterValue)) elements.accountFilter.value = filterValue;
  if (state.accounts.some(item => item.id === inboxValue)) elements.inboxAccount.value = inboxValue;
  updateTaskAccountStatus();
}

/** 更新生产目标表单的账号库存和任务状态提示。 */
function updateTaskAccountStatus() {
  const account = state.accounts.find(item => item.id === elements.taskAccount.value);
  const button = elements.taskForm.querySelector("button[type=submit]");
  if (!account) { elements.taskAccountStatus.textContent = "请先到 CK 账号页面导入账号"; button.disabled = true; return; }
  const open = state.campaigns.find(item => item.accountId === account.id && ["running", "stopped"].includes(item.status));
  elements.taskForm.labelPrefix.value = account.labelPrefix || "changsheng";
  if (open) {
    elements.taskAccountStatus.textContent = `已有${open.status === "running" ? "运行中" : "已停止"}目标：库存 ${open.currentTotal}/${open.targetTotal}`;
    button.disabled = true;
  } else {
    elements.taskAccountStatus.textContent = `当前库存 ${account.addressCount || 0} · ${cooldownText(account.cooldownUntil)}；目标启动后会自动等待冷却`;
    button.disabled = false;
  }
}

/** 刷新当前页邮箱库存。 */
async function loadAddresses() {
  const result = await api(`/api/addresses?${addressQuery()}`);
  state.addresses = result.addresses; state.addressPagination = result.pagination; state.selectedAddressIds.clear();
  elements.addressRows.innerHTML = renderAddresses(state.addresses);
  elements.addressPagination.innerHTML = renderPagination(state.addressPagination, "addresses");
  updateSelectedCount();
}

/** 刷新生产目标和批次执行记录。 */
async function loadTaskData() {
  const params = new URLSearchParams({ page: state.jobPagination.page, pageSize: state.jobPagination.pageSize });
  const [campaignResult, jobResult] = await Promise.all([api("/api/generation-campaigns"), api(`/api/generation-jobs?${params}`)]);
  state.campaigns = campaignResult.campaigns; state.jobs = jobResult.jobs; state.jobPagination = jobResult.pagination;
  elements.campaignList.innerHTML = renderCampaigns(state.campaigns);
  elements.jobList.innerHTML = renderJobs(state.jobs); elements.jobTotal.textContent = `共 ${state.jobPagination.total || 0} 个批次`;
  elements.jobPagination.innerHTML = renderPagination(state.jobPagination, "jobs");
}

/** 从后端刷新账号和各工作区核心数据。 */
async function loadCoreData() {
  const accountResult = await api("/api/icloud-accounts"); state.accounts = accountResult.accounts;
  renderAccountSelectors();
  await Promise.all([loadTaskData(), loadAddresses()]);
  elements.accountGrid.innerHTML = renderAccounts(state.accounts); elements.emptyAccounts.classList.toggle("hidden", state.accounts.length > 0);
  renderAccountSelectors(); renderOverview();
}

/** 打开指定 CK 的账号详情。 */
async function openAccount(accountId) {
  const detail = await api(`/api/icloud-accounts/${accountId}`); state.selectedAccountId = accountId;
  elements.detailTitle.textContent = detail.account.appleId; elements.detailMeta.innerHTML = renderAccountMeta(detail.account);
  elements.detailCooldown.textContent = cooldownText(detail.account.cooldownUntil); elements.detailPanel.classList.remove("hidden");
  navigate("accounts"); elements.detailPanel.scrollIntoView({ behavior: "smooth" });
}

/** 提交并校验 CK 导入。 */
async function importCookie(event) {
  event.preventDefault(); setBusy(elements.importForm, true, "正在校验...");
  try { await api("/api/icloud-accounts/import", { method: "POST", body: JSON.stringify(formValues(elements.importForm)) }); elements.importForm.reset(); elements.importPanel.classList.add("hidden"); await loadCoreData(); toast("CK 已校验并加密保存"); }
  catch (error) { toast(error.message, true); } finally { setBusy(elements.importForm, false); }
}

/** 创建默认目标库存为 700 的持续生产任务。 */
async function createCampaign(event) {
  event.preventDefault(); const values = formValues(elements.taskForm); if (!values.accountId) return toast("请先选择 CK 账号", true);
  setBusy(elements.taskForm, true, "正在启动...");
  try { await api("/api/generation-campaigns", { method: "POST", body: JSON.stringify({ accountId: values.accountId, targetTotal: Number(values.targetTotal), batchSize: Number(values.batchSize), labelPrefix: values.labelPrefix }) }); await loadCoreData(); toast("持续生产目标已启动"); }
  catch (error) { if (error.status === 409) await loadCoreData(); toast(error.message, true); } finally { setBusy(elements.taskForm, false); updateTaskAccountStatus(); }
}

/** 停止或继续一个持续生产目标。 */
async function changeCampaign(id, action) {
  try { await api(`/api/generation-campaigns/${id}/${action}`, { method: "POST", body: "{}" }); await loadCoreData(); toast(action === "stop" ? "任务已停止" : "任务已继续"); }
  catch (error) { toast(error.message, true); }
}

/** 同步当前账号的 Apple 隐藏邮箱。 */
async function syncApple() {
  setBusy(elements.syncBtn, true, "同步中...");
  try { const result = await api(`/api/icloud-accounts/${state.selectedAccountId}/sync`, { method: "POST", body: "{}" }); await loadCoreData(); toast(`已同步 ${result.synced} 个隐藏邮箱`); }
  catch (error) { toast(error.message, true); } finally { setBusy(elements.syncBtn, false); }
}

/** 更新当前账号的 CK。 */
async function updateCookie(event) {
  event.preventDefault(); if (event.submitter?.value === "cancel") return elements.cookieDialog.close(); setBusy(event.submitter, true, "校验中...");
  try { await api(`/api/icloud-accounts/${state.selectedAccountId}/cookie`, { method: "PUT", body: JSON.stringify(formValues(elements.updateCookieForm)) }); elements.cookieDialog.close(); elements.updateCookieForm.reset(); await loadCoreData(); toast("CK 已更新"); }
  catch (error) { toast(error.message, true); } finally { setBusy(event.submitter, false); }
}

/** 删除当前账号 CK 并保留历史数据。 */
async function deleteAccount() {
  if (!confirm("确定删除这条 CK？历史邮箱和任务会保留。")) return;
  try { await api(`/api/icloud-accounts/${state.selectedAccountId}`, { method: "DELETE", body: "{}" }); state.selectedAccountId = ""; elements.detailPanel.classList.add("hidden"); await loadCoreData(); toast("CK 已删除"); }
  catch (error) { toast(error.message, true); }
}

/** 更新批量选择数量。 */
function updateSelectedCount() {
  elements.selectedCount.textContent = `已选 ${state.selectedAddressIds.size} 个`;
  elements.selectAllAddresses.checked = state.addresses.length > 0 && state.addresses.every(item => state.selectedAddressIds.has(item.id));
}

/** 批量修改选中邮箱的使用状态。 */
async function applyBatchState() {
  const ids = [...state.selectedAddressIds]; if (!ids.length) return toast("请先选择邮箱", true);
  setBusy(elements.applyBatchStateBtn, true);
  try { const result = await api("/api/addresses/batch-state", { method: "PATCH", body: JSON.stringify({ ids, state: elements.batchState.value }) }); await loadCoreData(); toast(`已更新 ${result.updated} 个邮箱`); }
  catch (error) { toast(error.message, true); } finally { setBusy(elements.applyBatchStateBtn, false); }
}

/** 生成或重置公开链接，并导出买家可用的取码 URL。 */
async function exportBuyerLinks(kind) {
  const ids = [...state.selectedAddressIds];
  const scopeText = ids.length ? `选中的 ${ids.length} 个邮箱` : "当前筛选结果";
  if (!confirm(`将为${scopeText}生成或重置公开链接，旧链接会失效，是否继续？`)) return;
  const button = kind === "api" ? elements.exportBuyerApiBtn : elements.exportBuyerViewerBtn;
  setBusy(button, true, "导出中...");
  try {
    await downloadText("/api/addresses/public-access/export", {
      method: "POST",
      body: JSON.stringify({
        filters: {
          accountId: elements.accountFilter.value,
          state: elements.stateFilter.value,
          search: elements.addressSearch.value.trim()
        },
        ids,
        kind
      })
    }, kind === "api" ? "public-mail-api-links.txt" : "public-mail-viewer-links.txt");
    await loadAddresses();
    toast(kind === "api" ? "JSON 取码链接已导出" : "网页取码链接已导出");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

/** 保存当前 CK 独立的 IMAP 配置。 */
async function saveInboxConfig(event) {
  event.preventDefault(); const accountId = elements.inboxAccount.value; if (!accountId) return toast("请选择 CK 账号", true);
  const values = formValues(elements.inboxForm); values.secure = elements.inboxForm.secure.checked; values.accountId = accountId; setBusy(elements.inboxForm, true);
  try { await api("/api/inbox/config", { method: "PUT", body: JSON.stringify(values) }); elements.inboxForm.password.value = ""; toast("当前 CK 的 IMAP 配置已保存"); }
  catch (error) { toast(error.message, true); } finally { setBusy(elements.inboxForm, false); }
}

/** 加载当前 CK 的独立 IMAP 配置和分页邮件。 */
async function loadInbox() {
  const accountId = elements.inboxAccount.value;
  if (!accountId) { elements.messageList.innerHTML = `<div class="empty">请先选择 CK 账号</div>`; return; }
  const params = new URLSearchParams({ accountId, page: state.messagePagination.page, pageSize: state.messagePagination.pageSize });
  const [config, result] = await Promise.all([api(`/api/inbox/config?accountId=${encodeURIComponent(accountId)}`), api(`/api/inbox/messages?${params}`)]);
  elements.inboxForm.reset(); elements.inboxForm.port.value = config.port || 993; elements.inboxForm.mailbox.value = config.mailbox || "INBOX"; elements.inboxForm.secure.checked = config.configured ? config.secure : true;
  if (config.configured) for (const name of ["host", "email"]) elements.inboxForm[name].value = config[name] || "";
  state.messages = result.messages; state.messagePagination = result.pagination;
  elements.messageList.innerHTML = renderMessages(state.messages); elements.messageTotal.textContent = `共 ${state.messagePagination.total || 0} 封`;
  elements.messagePagination.innerHTML = renderPagination(state.messagePagination, "messages");
}

/** 同步当前 CK 配置的 IMAP 邮件。 */
async function syncInbox() {
  const accountId = elements.inboxAccount.value; if (!accountId) return toast("请选择 CK 账号", true); setBusy(elements.syncInboxBtn, true, "同步中...");
  try { const result = await api("/api/inbox/sync", { method: "POST", body: JSON.stringify({ accountId }) }); await loadInbox(); toast(`扫描 ${result.scanned} 封，新增 ${result.added} 封`); }
  catch (error) { toast(error.message, true); } finally { setBusy(elements.syncInboxBtn, false); }
}

/** 处理导航、详情、复制、生产目标和分页按钮。 */
async function handleClick(event) {
  const route = event.target.closest("[data-route], [data-go]"); if (route) { event.preventDefault(); return navigate(route.dataset.route || route.dataset.go); }
  const detail = event.target.closest("[data-action=detail], [data-account-open]"); if (detail) return openAccount(detail.dataset.accountOpen || detail.closest("[data-account-id]").dataset.accountId);
  const copy = event.target.closest("[data-email], [data-code]"); if (copy) { await navigator.clipboard.writeText(copy.dataset.email || copy.dataset.code); return toast("已复制"); }
  const copyValue = event.target.closest("[data-copy-value]"); if (copyValue) { await navigator.clipboard.writeText(copyValue.dataset.copyValue); return toast("已复制"); }
  const stop = event.target.closest("[data-campaign-stop]"); if (stop) return changeCampaign(stop.dataset.campaignStop, "stop");
  const resume = event.target.closest("[data-campaign-resume]"); if (resume) return changeCampaign(resume.dataset.campaignResume, "resume");
  const pager = event.target.closest("[data-page-kind]"); if (pager && !pager.disabled) {
    const page = Number(pager.dataset.page); if (pager.dataset.pageKind === "addresses") { state.addressPagination.page = page; await loadAddresses(); }
    if (pager.dataset.pageKind === "jobs") { state.jobPagination.page = page; await loadTaskData(); renderOverview(); }
    if (pager.dataset.pageKind === "messages") { state.messagePagination.page = page; await loadInbox(); }
  }
}

/** 保存单个邮箱状态或更新批量选择。 */
async function handleAddressChange(event) {
  if (event.target.matches("[data-address-select]")) { event.target.checked ? state.selectedAddressIds.add(event.target.value) : state.selectedAddressIds.delete(event.target.value); return updateSelectedCount(); }
  if (!event.target.matches("[data-state]")) return;
  const id = event.target.closest("[data-address-id]").dataset.addressId;
  try { await api(`/api/addresses/${id}/state`, { method: "PATCH", body: JSON.stringify({ state: event.target.value }) }); await loadCoreData(); }
  catch (error) { toast(error.message, true); }
}

/** 注册页面交互并加载首屏数据。 */
async function main() {
  const me = await api("/api/auth/me"); elements.adminName.textContent = me.username; document.addEventListener("click", handleClick);
  elements.showImportBtn.onclick = () => elements.importPanel.classList.remove("hidden"); elements.hideImportBtn.onclick = () => elements.importPanel.classList.add("hidden"); elements.closeDetailBtn.onclick = () => elements.detailPanel.classList.add("hidden");
  elements.refreshBtn.onclick = loadCoreData; elements.refreshJobsBtn.onclick = loadCoreData; elements.importForm.addEventListener("submit", importCookie); elements.taskForm.addEventListener("submit", createCampaign); elements.taskAccount.onchange = updateTaskAccountStatus;
  elements.accountGenerateBtn.onclick = () => { elements.taskAccount.value = state.selectedAccountId; navigate("tasks"); updateTaskAccountStatus(); }; elements.syncBtn.onclick = syncApple; elements.updateCookieBtn.onclick = () => elements.cookieDialog.showModal(); elements.updateCookieForm.addEventListener("submit", updateCookie); elements.deleteAccountBtn.onclick = deleteAccount;
  elements.addressRows.addEventListener("change", handleAddressChange); elements.selectAllAddresses.onchange = () => { for (const item of state.addresses) elements.selectAllAddresses.checked ? state.selectedAddressIds.add(item.id) : state.selectedAddressIds.delete(item.id); elements.addressRows.querySelectorAll("[data-address-select]").forEach(box => { box.checked = elements.selectAllAddresses.checked; }); updateSelectedCount(); }; elements.applyBatchStateBtn.onclick = applyBatchState;
  let searchTimer; elements.accountFilter.onchange = () => { state.addressPagination.page = 1; loadAddresses(); }; elements.stateFilter.onchange = () => { state.addressPagination.page = 1; loadAddresses(); }; elements.addressSearch.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.addressPagination.page = 1; loadAddresses(); }, 300); };
  elements.exportBtn.onclick = () => { location.href = `/api/addresses/export?accountId=${encodeURIComponent(elements.accountFilter.value)}&state=${encodeURIComponent(elements.stateFilter.value)}`; };
  elements.exportBuyerViewerBtn.onclick = () => exportBuyerLinks("viewer");
  elements.exportBuyerApiBtn.onclick = () => exportBuyerLinks("api");
  elements.inboxForm.addEventListener("submit", saveInboxConfig); elements.syncInboxBtn.onclick = syncInbox; elements.inboxAccount.onchange = () => { state.messagePagination.page = 1; loadInbox(); };
  elements.menuBtn.onclick = () => document.body.classList.toggle("menu-open"); elements.logoutBtn.onclick = async () => { await api("/api/auth/logout", { method: "POST", body: "{}" }); location.href = "/login.html"; }; window.onpopstate = () => navigate(location.pathname.slice(1), false);
  await loadCoreData(); await loadInbox(); navigate(location.pathname.slice(1), false);
  setInterval(() => { if (["/overview", "/tasks"].includes(location.pathname)) loadCoreData().catch(() => {}); }, 30_000);
}

main().catch(error => toast(error.message, true));
