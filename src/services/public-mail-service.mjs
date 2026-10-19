import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../security.mjs";

/** 计算公开访问密钥的不可逆哈希。 */
function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** 创建隐私邮箱公开邮件访问服务。 */
export function createPublicMailService({ config, repositories }) {
  /** 根据邮箱和取件码拼出公开网页与 JSON 取件地址。 */
  function buildLinks(email, token, limit = 15) {
    const encodedEmail = encodeURIComponent(email);
    const encodedToken = encodeURIComponent(token);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    return {
      apiUrl: `${config.appOrigin}/console/feed.php?mail=${encodedEmail}&pwd=${encodedToken}&limit=${safeLimit}&sync=1`,
      legacyApiUrl: `${config.appOrigin}/openapi/mail/${encodedEmail}/${encodedToken}/latest`,
      viewerUrl: `${config.appOrigin}/console/open.php?mail=${encodedEmail}&pwd=${encodedToken}&limit=${safeLimit}`
    };
  }

  /** 为邮箱生成或轮换一次性展示的公开访问密钥。 */
  function createAccess(addressId) {
    const address = repositories.getAddress(addressId);
    if (!address) throw Object.assign(new Error("邮箱不存在"), { status: 404 });
    const token = randomBytes(32).toString("base64url");
    repositories.savePublicAccess(addressId, hashToken(token), encryptSecret(token, config.encryptionKey));
    return {
      token,
      ...buildLinks(address.email, token)
    };
  }

  /** 确保邮箱拥有公开访问密钥；已有密钥时复用，避免 MMA 导出反复让旧取件码失效。 */
  function ensureAccess(addressId) {
    const address = repositories.getAddress(addressId);
    if (!address) throw Object.assign(new Error("邮箱不存在"), { status: 404 });
    const access = repositories.getPublicAccess(addressId);
    if (!access?.tokenEncrypted) return createAccess(addressId);
    const token = decryptSecret(access.tokenEncrypted, config.encryptionKey);
    return { token, ...buildLinks(address.email, token) };
  }

  /** 撤销指定邮箱的公开访问。 */
  function revokeAccess(addressId) {
    if (!repositories.getAddress(addressId)) throw Object.assign(new Error("邮箱不存在"), { status: 404 });
    repositories.revokePublicAccess(addressId);
    return { ok: true };
  }

  /** 使用邮箱和公开密钥读取最新邮件。 */
  function getLatest(email, token) {
    if (!email || !token || String(token).length < 32) return null;
    return repositories.getLatestPublicMail(email, hashToken(token));
  }

  /** 使用公开取件码读取指定邮箱的邮件列表。 */
  function getMessages(email, token, limit = 15) {
    if (!email || !token || String(token).length < 32) return null;
    return repositories.getPublicMailMessages(email, hashToken(token), limit);
  }

  return { buildLinks, createAccess, ensureAccess, revokeAccess, getLatest, getMessages };
}
