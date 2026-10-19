import type { MailMessage } from '@/types/workbench';

export interface BuyerMailbox {
  email: string;
  line: string;
  password: string;
}

export interface BuyerMailResult {
  email: string;
  error?: string;
  messages: MailMessage[];
  password: string;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_PATTERN = /https?:\/\/\S+/gi;

/** 解析买家粘贴的 MMA 行，支持 邮箱----取件码、邮箱 密码、open/feed URL。 */
export function parseBuyerMailboxes(input: string): BuyerMailbox[] {
  const seen = new Set<string>();
  const rows: BuyerMailbox[] = [];
  const push = (parsed: Pick<BuyerMailbox, 'email' | 'password'> | null, line: string) => {
    if (!parsed) return;
    const key = parsed.email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ ...parsed, line });
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fromUrl = parseMailboxFromUrl(line);
    push(fromUrl || parseMailboxFromText(line), line);
  }

  for (const parsed of parseMailboxesFromTokenStream(input)) {
    push(parsed, `${parsed.email}----${parsed.password}`);
  }
  return rows;
}

function parseMailboxFromText(line: string): Pick<BuyerMailbox, 'email' | 'password'> | null {
  const parts = tokenizeMailboxText(line);
  const emailIndex = parts.findIndex(part => EMAIL_PATTERN.test(part));
  if (emailIndex < 0) return null;
  const email = parts[emailIndex].match(EMAIL_PATTERN)?.[0] || '';
  const password = readPickupPassword(parts, emailIndex + 1);
  if (!email || !password) return null;
  return { email, password };
}

function parseMailboxFromUrl(line: string): Pick<BuyerMailbox, 'email' | 'password'> | null {
  const urlText = line.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)\]，,。；;]+$/u, '');
  if (!urlText) return null;
  try {
    const url = new URL(urlText);
    const email = url.searchParams.get('mail') || url.pathname.match(/\/mail\/([^/]+)/)?.[1] || '';
    const password = url.searchParams.get('pwd') || url.pathname.match(/\/mail\/[^/]+\/([^/]+)/)?.[1] || '';
    if (!email || !password) return null;
    return { email: decodeURIComponent(email), password: decodeURIComponent(password) };
  } catch {
    return null;
  }
}

function parseMailboxesFromTokenStream(input: string): Array<Pick<BuyerMailbox, 'email' | 'password'>> {
  const tokens = tokenizeMailboxText(input.replace(URL_PATTERN, ' '));
  const rows: Array<Pick<BuyerMailbox, 'email' | 'password'>> = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const email = tokens[index].match(EMAIL_PATTERN)?.[0] || '';
    if (!email) continue;
    const password = readPickupPassword(tokens, index + 1);
    if (password) rows.push({ email, password });
  }

  return rows;
}

function tokenizeMailboxText(text: string) {
  return text
    .split(/----|\s+/)
    .map(item => item.trim().replace(/^[：:|]+|[)\]，,。；;]+$/gu, ''))
    .filter(Boolean);
}

function readPickupPassword(parts: string[], startIndex: number) {
  const first = parts[startIndex] || '';
  const second = parts[startIndex + 1] || '';
  if (/^-+$/.test(first) && isPossiblePickupPassword(second)) return `${first}${second}`;
  return isPossiblePickupPassword(first) ? first : '';
}

function isPossiblePickupPassword(value: string) {
  return Boolean(value && !value.includes('://') && !EMAIL_PATTERN.test(value) && !/^-+$/.test(value));
}

/** 根据邮箱与取件码生成公开网页和 JSON API 取件 URL。 */
export function buildBuyerLinks(mailbox: Pick<BuyerMailbox, 'email' | 'password'>, limit = 15) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
  const mail = encodeURIComponent(mailbox.email);
  const pwd = encodeURIComponent(mailbox.password);
  const origin = window.location.origin;
  return {
    apiUrl: `${origin}/console/feed.php?mail=${mail}&pwd=${pwd}&limit=${safeLimit}&sync=1`,
    viewerUrl: `${origin}/console/open.php?mail=${mail}&pwd=${pwd}&limit=${safeLimit}`
  };
}

/** 把 feed.php 的 data[] 响应映射为统一邮件结构。 */
export function normalizeFeedData(data: unknown): MailMessage[] {
  const rows = Array.isArray((data as { data?: unknown[] })?.data) ? (data as { data: unknown[] }).data : [];
  return rows.map((row, index) => {
    const item = row as Record<string, unknown>;
    return {
      bodyHtml: String(item.body || ''),
      code: String(item.code || ''),
      hiddenEmail: String(item.to || ''),
      id: String(item.id || `${index}`),
      preview: String(item.preview || ''),
      receivedAt: String(item.received_at || item.saved_at || ''),
      sender: String(item.from || ''),
      subject: String(item.subject || '')
    };
  });
}
