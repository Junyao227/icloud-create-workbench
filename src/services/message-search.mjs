import { compile } from "html-to-text";

const htmlText = compile({ wordwrap: false, selectors: [
  { selector: "a", options: { ignoreHref: true } },
  { selector: "img", format: "skip" }
] });

/** 合并换行和不间断空格，保留可阅读的正文。 */
function compact(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** 从命中位置附近截取正文摘要。 */
function excerpt(text, keyword) {
  const position = text.toLowerCase().indexOf(keyword);
  const start = Math.max(0, position - 70);
  return `${start ? "…" : ""}${text.slice(start, start + 260)}${text.length > start + 260 ? "…" : ""}`;
}

/** 搜索本地已同步邮件；复用同一匹配逻辑供分页、复制和导出使用。 */
export function createMessageSearch(db) {
  /** 按账号扫描邮件，匹配主题或任一种正文，不依赖有限的最近邮件列表。 */
  function search({ keyword = "", accountId = "" } = {}) {
    const needle = compact(keyword).toLowerCase();
    const where = accountId ? "WHERE m.account_id = ?" : "";
    const statement = db.prepare(`SELECT m.id, m.subject, m.sender, m.body_text AS bodyText,
      m.body_html AS bodyHtml, m.received_at AS receivedAt, h.email AS hiddenEmail,
      a.apple_id AS appleId FROM inbox_messages m
      LEFT JOIN hidden_addresses h ON h.id = m.address_id
      LEFT JOIN icloud_accounts a ON a.id = m.account_id ${where}
      ORDER BY m.received_at DESC, m.id DESC`);
    const matches = [];
    for (const row of statement.iterate(...(accountId ? [accountId] : []))) {
      const plain = compact(row.bodyText);
      const html = row.bodyHtml ? compact(htmlText(row.bodyHtml)) : "";
      const subject = compact(row.subject);
      if (needle && ![subject, plain, html].some(value => value.toLowerCase().includes(needle))) continue;
      const body = needle && html.toLowerCase().includes(needle) ? html : plain || html;
      const { bodyHtml, ...message } = row;
      matches.push({ ...message, bodyText: body, preview: excerpt(body, needle) });
    }
    return matches;
  }
  return { search };
}
