import { Router } from "express";

/** 将 CSV 字段进行安全转义。 */
function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

/** 将邮箱和公开链接拼接成买家可直接使用的文本行。 */
function publicLinkLine(email, access, kind) {
  if (kind === "api") return `${email}----${access.apiUrl}`;
  if (kind === "both") return `${email}----${access.viewerUrl}----${access.apiUrl}`;
  return `${email}----${access.viewerUrl}`;
}

/** 输出 MMA 文本，每行包含邮箱和稳定取件码。 */
function sendMmaExport(res, rows, publicMailService) {
  const content = rows.map(row => {
    const access = publicMailService.ensureAccess(row.id);
    return `${row.email}----${access.token}`;
  }).join("\r\n");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=hidden-addresses-mma.txt");
  res.send(`\uFEFF${content}`);
}

/** 创建隐藏邮箱查询、导出和状态路由。 */
export function createAddressRouter(repositories, publicMailService) {
  const router = Router();

  /** 按账号、状态或关键词查询隐藏邮箱。 */
  router.get("/", (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 20)));
    const result = repositories.pageAddresses({
      accountId: req.query.accountId,
      state: req.query.state,
      search: String(req.query.search || "").slice(0, 100)
    }, page, pageSize);
    res.json({ addresses: result.rows, pagination: { page, pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / pageSize)) } });
  });

  /** 下载当前筛选结果的 UTF-8 CSV。 */
  router.get("/export", (req, res) => {
    const rows = repositories.listAddresses({
      accountId: req.query.accountId,
      state: req.query.state,
      search: String(req.query.search || "").slice(0, 100)
    });
    const csv = ["邮箱,标签,状态,来源,Apple ID,创建时间", ...rows.map(row => [
      row.email, row.label, row.state, row.source, row.appleId, row.createdAt
    ].map(csvCell).join(","))].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=hidden-addresses.csv");
    res.send(`\uFEFF${csv}`);
  });

  /** 下载当前筛选结果的 MMA 文本，每行包含邮箱和公开取件码。 */
  router.get("/export-mma", (req, res) => {
    const rows = repositories.listAddresses({
      accountId: req.query.accountId,
      state: req.query.state,
      search: String(req.query.search || "").slice(0, 100)
    });
    sendMmaExport(res, rows, publicMailService);
  });

  /** 按勾选邮箱或筛选条件导出 MMA 文本。 */
  router.post("/export-mma", (req, res) => {
    const filters = req.body?.filters || {};
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids.map(String).slice(0, 1000)) : null;
    const queryFilters = ids?.size ? {} : {
      accountId: filters.accountId,
      state: filters.state,
      search: String(filters.search || "").slice(0, 100)
    };
    let rows = repositories.listAddresses(queryFilters);
    if (ids?.size) rows = rows.filter(row => ids.has(row.id));
    if (!rows.length) return res.status(400).json({ error: "没有可导出的邮箱" });
    sendMmaExport(res, rows, publicMailService);
  });

  /** 批量生成或轮换公开访问链接，并导出给买家的取码文本。 */
  router.post("/public-access/export", (req, res) => {
    const kind = ["api", "both", "viewer"].includes(req.body?.kind) ? req.body.kind : "viewer";
    const filters = req.body?.filters || {};
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids.map(String).slice(0, 1000)) : null;
    const queryFilters = ids?.size ? {} : {
      accountId: filters.accountId,
      state: filters.state,
      search: String(filters.search || "").slice(0, 100)
    };
    let rows = repositories.listAddresses(queryFilters);
    if (ids?.size) rows = rows.filter(row => ids.has(row.id));
    if (!rows.length) return res.status(400).json({ error: "没有可导出的邮箱" });
    const lines = rows.map(row => publicLinkLine(row.email, publicMailService.ensureAccess(row.id), kind));
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=public-mail-${kind}-links.txt`);
    res.send(`\uFEFF${lines.join("\r\n")}`);
  });

  /** 批量修改邮箱状态。 */
  router.patch("/batch-state", (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))].slice(0, 200) : [];
    const state = String(req.body?.state || "");
    if (!ids.length) return res.status(400).json({ error: "请至少选择一个邮箱" });
    if (!["unused", "used", "trash"].includes(state)) return res.status(400).json({ error: "邮箱状态无效" });
    res.json({ updated: repositories.updateAddressStates(ids, state) });
  });

  /** 返回隐私邮箱详情。 */
  router.get("/:id", (req, res) => {
    const address = repositories.getAddress(req.params.id);
    if (!address) return res.status(404).json({ error: "邮箱不存在" });
    res.json({ address });
  });

  /** 分页返回隐私邮箱关联邮件。 */
  router.get("/:id/messages", (req, res) => {
    if (!repositories.getAddress(req.params.id)) return res.status(404).json({ error: "邮箱不存在" });
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 20)));
    const result = repositories.pageAddressMessages(req.params.id, page, pageSize);
    res.json({ messages: result.rows, pagination: { page, pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / pageSize)) } });
  });

  /** 生成或轮换邮箱公开访问链接。 */
  router.post("/:id/public-access", (req, res) => res.status(201).json(publicMailService.createAccess(req.params.id)));

  /** 撤销邮箱公开访问链接。 */
  router.delete("/:id/public-access", (req, res) => res.json(publicMailService.revokeAccess(req.params.id)));

  /** 修改隐藏邮箱本地状态。 */
  router.patch("/:id/state", (req, res) => {
    const state = String(req.body?.state || "");
    if (!["unused", "used", "trash"].includes(state)) return res.status(400).json({ error: "邮箱状态无效" });
    if (!repositories.updateAddressState(req.params.id, state)) return res.status(404).json({ error: "邮箱不存在" });
    res.json({ ok: true });
  });
  return router;
}
