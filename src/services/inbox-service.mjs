import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decryptSecret, encryptSecret } from "../security.mjs";

const FALLBACK_JUNK_MAILBOX_NAMES = ["Junk", "Junk E-mail", "Junk Email", "Spam", "垃圾邮件"];

/** 从邮件文本中提取常见验证码。 */
export function extractCode(text) {
  const content = String(text || "");
  const patterns = [
    /(?:验证码|校验码|动态码|verification code|security code|OTP)[^0-9A-Z]{0,16}([0-9]{4,8})/i,
    /\b([0-9]{6})\b/,
    /\b([A-Z0-9]{6,8})\b/i
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return "";
}

/** 规范化邮件内联资源 Content-ID，便于匹配 cid: 引用。 */
function normalizeCid(value) {
  const raw = String(value || "").trim().replace(/^<|>$/g, "");
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** 将 HTML 中的 cid: 内联图片替换为浏览器可直接显示的 data URL。 */
export function inlineAttachmentCidImages(html, attachments) {
  const sourceHtml = String(html || "");
  if (!sourceHtml || !Array.isArray(attachments) || !attachments.length) return sourceHtml;
  const cidToDataUrl = new Map();
  for (const attachment of attachments) {
    const cid = normalizeCid(attachment?.contentId);
    const contentType = String(attachment?.contentType || "");
    if (!cid || !contentType.startsWith("image/") || !Buffer.isBuffer(attachment?.content)) continue;
    cidToDataUrl.set(cid, `data:${contentType};base64,${attachment.content.toString("base64")}`);
  }
  if (!cidToDataUrl.size) return sourceHtml;
  return sourceHtml.replace(/cid:([^"')\s>]+)/gi, (full, cidValue) => {
    const dataUrl = cidToDataUrl.get(normalizeCid(cidValue));
    return dataUrl || full;
  });
}

/** 创建全局 IMAP 收件服务。 */
export function createInboxService({ config, repositories }) {
  const activeSyncs = new Map();

  /** 计算下一次后台同步时间。 */
  function nextSyncAt() {
    return new Date(Date.now() + config.inboxSyncIntervalSeconds * 1000).toISOString();
  }

  /** 去重并保序；iCloud 垃圾箱常见名会由 list() 的 \Junk 标记自动识别。 */
  function uniqueMailboxes(mailboxes) {
    const seen = new Set();
    const rows = [];
    for (const mailbox of mailboxes) {
      const value = String(mailbox || "").trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      rows.push(value);
    }
    return rows;
  }

  /** 找出需要同步的文件夹：配置文件夹 + IMAP 标记的 Junk；无法列目录时用常见垃圾箱名称兜底。 */
  async function resolveSyncMailboxes(client, primaryMailbox) {
    const primary = String(primaryMailbox || "INBOX").trim() || "INBOX";
    try {
      const listed = await client.list();
      const junk = listed.find(item => item.specialUse === "\\Junk")?.path
        || listed.find(item => FALLBACK_JUNK_MAILBOX_NAMES.some(name => String(item.name || item.path || "").toLowerCase() === name.toLowerCase()))?.path;
      return uniqueMailboxes([primary, junk]);
    } catch {
      return uniqueMailboxes([primary, ...FALLBACK_JUNK_MAILBOX_NAMES]);
    }
  }

  /** 返回不包含密码的 IMAP 配置。 */
  function getConfig(accountId) {
    const stored = repositories.getInboxConfigInternal(accountId);
    if (!stored) return { configured: false };
    return {
      configured: Boolean(stored.host && stored.email && stored.password_encrypted),
      host: stored.host,
      port: stored.port,
      secure: Boolean(stored.secure),
      email: stored.email,
      mailbox: stored.mailbox,
      hasPassword: Boolean(stored.password_encrypted),
      lastSyncAt: stored.last_sync_at || "",
      nextSyncAt: stored.next_sync_at || "",
      lastError: stored.last_error || ""
    };
  }

  /** 校验并保存 IMAP 配置，密码为空时保留旧密码。 */
  function saveConfig(accountId, input) {
    const account = repositories.getAccountInternal(accountId);
    if (!account || account.status === "deleted") throw Object.assign(new Error("CK 账号不存在"), { status: 404 });
    const existing = repositories.getInboxConfigInternal(accountId);
    const host = String(input.host || "").trim();
    const email = String(input.email || "").trim();
    const port = Number(input.port || 993);
    if (!host || !email || !Number.isInteger(port)) throw Object.assign(new Error("IMAP 主机、端口和邮箱不能为空"), { status: 400 });
    const passwordEncrypted = input.password
      ? encryptSecret(String(input.password), config.encryptionKey)
      : existing?.password_encrypted;
    if (!passwordEncrypted) throw Object.assign(new Error("首次配置必须填写 IMAP 密码或授权码"), { status: 400 });
    const mailbox = String(input.mailbox || "INBOX").trim() || "INBOX";
    const connectionChanged = !existing || existing.host !== host || existing.port !== port
      || existing.email !== email || existing.mailbox !== mailbox || Boolean(existing.secure) !== (input.secure !== false);
    repositories.saveInboxConfig(accountId, {
      host,
      port,
      secure: input.secure !== false,
      email,
      passwordEncrypted,
      mailbox
    });
    if (connectionChanged) repositories.resetInboxSyncState(accountId);
    return getConfig(accountId);
  }

  /** 在邮件原文中匹配已知隐藏邮箱地址。 */
  function matchHiddenAddress(accountId, text) {
    const lower = String(text || "").toLowerCase();
    return repositories.listAddresses({ accountId }).find(item => lower.includes(item.email.toLowerCase()))?.email || "";
  }

  /** 解析并保存 IMAP 拉取到的一封邮件。 */
  async function saveMessage(accountId, mailbox, message, updateOnly = false) {
    const parsed = await simpleParser(message.source);
    const bodyText = String(parsed.text || "").slice(0, 100_000);
    const resolvedHtml = inlineAttachmentCidImages(parsed.html, parsed.attachments);
    const bodyHtml = typeof resolvedHtml === "string" ? resolvedHtml.slice(0, 300_000) : "";
    const htmlText = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const searchable = `${parsed.headers?.get("delivered-to") || ""}\n${parsed.to?.text || ""}\n${bodyText}\n${htmlText}`;
    return repositories.insertMessage(accountId, {
      uid: `${accountId}:${mailbox}:${message.uid}`,
      subject: parsed.subject || "",
      sender: parsed.from?.text || "",
      recipient: matchHiddenAddress(accountId, searchable),
      code: extractCode(`${parsed.subject || ""}\n${bodyText}\n${htmlText}`),
      preview: (bodyText || htmlText).replace(/\s+/g, " ").slice(0, 240),
      bodyText,
      bodyHtml,
      receivedAt: (parsed.date || message.internalDate || new Date()).toISOString()
    }, { updateOnly });
  }

  /** 连接 IMAP 并按 UID 增量同步邮件。 */
  async function runSync(accountId) {
    const stored = repositories.getInboxConfigInternal(accountId);
    if (!stored?.password_encrypted) throw Object.assign(new Error("尚未配置 IMAP 收件邮箱"), { status: 400 });
    const client = new ImapFlow({
      host: stored.host,
      port: stored.port,
      secure: Boolean(stored.secure),
      auth: { user: stored.email, pass: decryptSecret(stored.password_encrypted, config.encryptionKey) },
      logger: false
    });
    let added = 0;
    let scanned = 0;
    let latestPrimaryState = {
      lastUid: Number(stored.last_uid || 0),
      uidValidity: String(stored.uid_validity || ""),
      lastSyncAt: stored.last_sync_at || "",
      lastError: ""
    };
    try {
      await client.connect();
      const primaryMailbox = stored.mailbox || "INBOX";
      const mailboxes = await resolveSyncMailboxes(client, primaryMailbox);
      const errors = [];
      const criticalErrors = [];
      for (const mailbox of mailboxes) {
        const isPrimaryMailbox = mailbox.toLowerCase() === String(primaryMailbox).toLowerCase();
        let state = repositories.getInboxMailboxState(accountId, mailbox);
        let lastUid = Number(state.lastUid || 0);
        let uidValidity = String(state.uidValidity || "");
        const needsHtmlBackfill = !Boolean(state.htmlBackfillDone);
        let lock;
        try {
          lock = await client.getMailboxLock(mailbox);
          const total = Number(client.mailbox?.exists || 0);
          const currentValidity = String(client.mailbox?.uidValidity || "");
          if (uidValidity && currentValidity && uidValidity !== currentValidity) lastUid = 0;
          uidValidity = currentValidity;
          const lastSyncAt = new Date().toISOString();
          const saveState = errorMessage => {
            state = {
              ...state,
              lastUid,
              uidValidity,
              lastSyncAt,
              lastError: errorMessage || "",
              htmlBackfillDone: needsHtmlBackfill ? 1 : state.htmlBackfillDone
            };
            repositories.saveInboxMailboxState(accountId, mailbox, state);
            if (isPrimaryMailbox) latestPrimaryState = state;
          };

          if (!total) {
            saveState("");
            continue;
          }
          const uidNext = Number(client.mailbox?.uidNext || 0);
          if (!needsHtmlBackfill && lastUid > 0 && uidNext > 0 && lastUid >= uidNext - 1) {
            saveState("");
            continue;
          }
          const query = { uid: true, source: true, envelope: true, internalDate: true };
          const range = needsHtmlBackfill
            ? `${Math.max(1, total - 499)}:*`
            : lastUid > 0 ? `${lastUid + 1}:*` : `${Math.max(1, total - 99)}:*`;
          const options = !needsHtmlBackfill && lastUid > 0 ? { uid: true } : undefined;
          for await (const message of client.fetch(range, query, options)) {
            scanned++;
            lastUid = Math.max(lastUid, Number(message.uid || 0));
            const inserted = await saveMessage(accountId, mailbox, message, needsHtmlBackfill);
            if (inserted) added++;
          }
          saveState("");
        } catch (error) {
          errors.push(`${mailbox}: ${error.message}`);
          if (isPrimaryMailbox) criticalErrors.push(`${mailbox}: ${error.message}`);
          repositories.saveInboxMailboxState(accountId, mailbox, {
            ...state,
            lastUid,
            uidValidity,
            lastSyncAt: state.lastSyncAt || new Date().toISOString(),
            lastError: error.message,
            htmlBackfillDone: state.htmlBackfillDone
          });
        } finally {
          lock?.release();
        }
      }
      if (!errors.length) repositories.completeInboxHtmlBackfill(accountId);
      repositories.updateInboxSyncState(accountId, {
        lastUid: latestPrimaryState.lastUid || 0,
        uidValidity: latestPrimaryState.uidValidity || "",
        lastSyncAt: new Date().toISOString(),
        nextSyncAt: nextSyncAt(),
        lastError: criticalErrors.join("；")
      });
      if (criticalErrors.length) throw new Error(criticalErrors.join("；"));
      return { added, scanned, mailboxes };
    } catch (error) {
      repositories.updateInboxSyncState(accountId, {
        lastUid: latestPrimaryState.lastUid || 0,
        uidValidity: latestPrimaryState.uidValidity || "",
        lastSyncAt: stored.last_sync_at,
        nextSyncAt: nextSyncAt(),
        lastError: error.message
      });
      throw error;
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async function sync(accountId) {
    if (activeSyncs.has(accountId)) throw Object.assign(new Error("该 CK 的邮箱正在同步"), { status: 409 });
    const promise = runSync(accountId).finally(() => activeSyncs.delete(accountId));
    activeSyncs.set(accountId, promise);
    return promise;
  }

  async function syncOrJoin(accountId) {
    const existing = activeSyncs.get(accountId);
    if (existing) return existing;
    const promise = runSync(accountId).finally(() => activeSyncs.delete(accountId));
    activeSyncs.set(accountId, promise);
    return promise;
  }

  return { getConfig, saveConfig, sync, syncOrJoin };
}
