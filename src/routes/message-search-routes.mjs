import { Router } from "express";

/** 校验搜索条件，避免静默截断关键词或接受非法分页。 */
function readFilters(query) {
  const keyword = query.keyword ?? "";
  const accountId = query.accountId ?? "";
  if (typeof keyword !== "string" || keyword.length > 300 || typeof accountId !== "string" || accountId.length > 100) {
    throw Object.assign(new Error("关键词最多 300 个字符，账号参数必须有效"), { status: 400 });
  }
  return { keyword: keyword.trim(), accountId };
}

/** 读取有界的正整数分页参数。 */
function positiveInteger(value, fallback, maximum) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw Object.assign(new Error("分页参数无效"), { status: 400 });
  }
  return number;
}

/** 转义 CSV 内容，并防止表格软件把邮件内容当作公式执行。 */
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** 创建仅供管理员使用的跨账号邮件搜索、邮箱复制和全文导出接口。 */
export function createMessageSearchRouter(messageSearch) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  /** 分页返回命中摘要，不把全部正文加载到列表。 */
  router.get("/search", (req, res) => {
    const filters = readFilters(req.query);
    const page = positiveInteger(req.query.page, 1, 1_000_000);
    const pageSize = positiveInteger(req.query.pageSize, 20, 100);
    const results = messageSearch.search(filters);
    const emails = new Set(results.map(row => row.hiddenEmail).filter(Boolean));
    const messages = results.slice((page - 1) * pageSize, page * pageSize).map(({ bodyText, ...row }) => row);
    res.json({ messages, mailboxCount: emails.size,
      pagination: { page, pageSize, total: results.length, totalPages: Math.max(1, Math.ceil(results.length / pageSize)) } });
  });

  /** 复制全部匹配邮件关联的隐藏邮箱，去重并排除未关联邮件。 */
  router.get("/search/emails", (req, res) => {
    const results = messageSearch.search(readFilters(req.query));
    res.json({ emails: [...new Set(results.map(row => row.hiddenEmail).filter(Boolean))] });
  });

  /** 导出全部匹配邮件及可阅读正文，使用带 BOM 的 CSV 兼容中文表格软件。 */
  router.get("/search/export", (req, res) => {
    const results = messageSearch.search(readFilters(req.query));
    const rows = [["隐藏邮箱", "所属账号", "主题", "发件人", "收件时间", "正文"],
      ...results.map(row => [row.hiddenEmail, row.appleId, row.subject, row.sender, row.receivedAt, row.bodyText])];
    res.attachment("mail-search.csv").type("text/csv").send(`\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`);
  });
  return router;
}
