import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const PUBLIC_SYNC_COOLDOWN_MS = 10_000;

/** 创建无需管理员会话的公开邮件读取接口。 */
export function createPublicMailRouter(config, publicMailService, inboxService) {
  const router = Router();
  const accountSyncs = new Map();
  const lastAccountSyncs = new Map();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.publicMailRateLimit,
    keyGenerator: req => `${ipKeyGenerator(req.ip)}:${req.params.token || req.query.pwd || "anonymous"}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "请求过于频繁" }
  });

  /** 为只读公开接口设置跨域和禁用缓存响应头。 */
  router.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  function wantsOnDemandSync(req) {
    return ["1", "true", "yes", "on"].includes(String(req.query.sync || "").toLowerCase());
  }

  /** 同一 iCloud 主账号的公开刷新合并成一次 IMAP 同步，避免买家批量刷新时打爆 iCloud。 */
  async function syncAccountOnce(accountId) {
    const syncFn = inboxService?.syncOrJoin || inboxService?.sync;
    if (!accountId || typeof syncFn !== "function") return { attempted: false, skipped: true };
    const now = Date.now();
    const lastSyncAt = Number(lastAccountSyncs.get(accountId) || 0);
    if (lastSyncAt && now - lastSyncAt < PUBLIC_SYNC_COOLDOWN_MS) {
      return { attempted: false, skipped: true, reason: "cooldown" };
    }
    const existing = accountSyncs.get(accountId);
    if (existing) return existing;
    const syncPromise = syncFn(accountId)
      .then(result => {
        lastAccountSyncs.set(accountId, Date.now());
        return { attempted: true, ok: true, result };
      })
      .catch(error => ({ attempted: true, ok: false, error: error.message || "sync failed" }))
      .finally(() => accountSyncs.delete(accountId));
    accountSyncs.set(accountId, syncPromise);
    return syncPromise;
  }

  function publicLatestPayload(result) {
    return { email: result.email, message: result.message };
  }

  function publicSyncPayload(sync) {
    if (!sync) return undefined;
    return {
      attempted: sync.attempted === true,
      ok: sync.ok === true,
      skipped: sync.skipped === true,
      error: sync.ok === false ? sync.error : ""
    };
  }

  /** 根据隐藏邮箱和独立密钥返回最新邮件。 */
  router.get("/mail/:email/:token/latest", limiter, async (req, res) => {
    let result = publicMailService.getLatest(req.params.email, req.params.token);
    if (!result) return res.status(404).json({ error: "邮件地址或访问密钥无效" });
    if (wantsOnDemandSync(req)) {
      await syncAccountOnce(result.accountId);
      result = publicMailService.getLatest(req.params.email, req.params.token) || result;
    }
    res.json(publicLatestPayload(result));
  });

  /** 兼容 feed.php 风格的公开 JSON 取件接口。 */
  router.get("/feed.php", limiter, async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 15)));
    const mail = String(req.query.mail || "");
    const pwd = String(req.query.pwd || "");
    let result = publicMailService.getMessages(mail, pwd, limit);
    if (!result) return res.status(404).json({ status: "error", error: "邮件地址或取件码无效", data: [] });
    const sync = wantsOnDemandSync(req) ? await syncAccountOnce(result.accountId) : null;
    if (sync?.attempted) result = publicMailService.getMessages(mail, pwd, limit) || result;
    res.json({
      status: "success",
      email: result.email,
      count: result.messages.length,
      sync: publicSyncPayload(sync),
      data: result.messages.map(message => ({
        body: message.bodyHtml || message.bodyText || message.preview || "",
        code: message.code || "",
        from: message.sender || "",
        id: message.id,
        preview: message.preview || "",
        received_at: message.receivedAt || "",
        saved_at: message.receivedAt || "",
        subject: message.subject || "",
        to: result.email
      }))
    });
  });
  return router;
}
