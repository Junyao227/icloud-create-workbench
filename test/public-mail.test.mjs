import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../src/db.mjs";
import { createRepositories } from "../src/repositories.mjs";
import { createPublicMailService } from "../src/services/public-mail-service.mjs";
import { createApp } from "../src/app.mjs";
import { hashPassword } from "../src/security.mjs";

/** 创建包含一个隐私邮箱的公开邮件测试环境。 */
function createContext() {
  const directory = mkdtempSync(join(tmpdir(), "icloud-public-mail-"));
  const db = createDatabase(join(directory, "test.db"));
  const repositories = createRepositories(db);
  const account = repositories.upsertAccount({ identityKey: "public", appleId: "public@example.com",
    dsid: "public", displayName: "公开测试", region: "global", userPartition: "68",
    maildomainHost: "p68-maildomainws.icloud.com", cookieEncrypted: "encrypted" });
  repositories.upsertAddresses(account.id, null, [{ email: "public@icloud.com", label: "public-001" }], "generated");
  const address = repositories.listAddresses({ accountId: account.id })[0];
  const config = {
    appOrigin: "http://127.0.0.1:4173", adminUsername: "admin", adminPasswordHash: hashPassword("password-12345"),
    jwtSecret: "public-mail-test-secret-value-123456789", jwtExpiresIn: "8h", cookieSecure: false,
    encryptionKey: randomBytes(32).toString("base64"),
    publicMailRateLimit: 60
  };
  const publicMailService = createPublicMailService({ config, repositories });
  const app = createApp({ config, repositories, publicMailService,
    icloudService: {}, inboxService: { getConfig: () => ({ configured: false }) },
    campaignService: { listCampaigns: () => [] } });
  /** 清理测试数据库。 */
  function cleanup() { db.close(); rmSync(directory, { recursive: true, force: true }); }
  return { app, address, repositories, publicMailService, cleanup };
}

test("公开链接在无邮件时返回 message null，并带跨域与禁用缓存头", async () => {
  const context = createContext();
  try {
    const access = context.publicMailService.createAccess(context.address.id);
    const path = new URL(access.legacyApiUrl).pathname;
    const response = await request(context.app).get(path).expect(200);
    assert.equal(response.body.email, "public@icloud.com");
    assert.equal(response.body.message, null);
    assert.equal(response.headers["access-control-allow-origin"], "*");
    assert.match(response.headers["cache-control"], /no-store/);
    const feed = new URL(access.apiUrl);
    const feedResponse = await request(context.app).get(`${feed.pathname}${feed.search}`).expect(200);
    assert.equal(feedResponse.body.status, "success");
    assert.equal(feedResponse.body.count, 0);
    assert.deepEqual(feedResponse.body.data, []);
  } finally { context.cleanup(); }
});

test("公开接口返回最新邮件的纯文本和 HTML，错误或撤销密钥统一返回 404", async () => {
  const context = createContext();
  try {
    const access = context.publicMailService.createAccess(context.address.id);
    const inserted = context.repositories.insertMessage(context.address.accountId, { uid: "public:1", recipient: context.address.email,
      subject: "验证码", sender: "sender@example.com", code: "654321", preview: "最新邮件",
      bodyText: "您的验证码是 654321", bodyHtml: "",
      receivedAt: new Date().toISOString() });
    const backfilled = context.repositories.insertMessage(context.address.accountId, { uid: "public:1", recipient: context.address.email,
      subject: "验证码", sender: "sender@example.com", code: "654321", preview: "最新邮件",
      bodyText: "您的验证码是 654321", bodyHtml: "<strong>您的验证码是 654321</strong>",
      receivedAt: new Date().toISOString() }, { updateOnly: true });
    const ignoredHistory = context.repositories.insertMessage(context.address.accountId, { uid: "public:older", recipient: context.address.email,
      subject: "旧邮件", sender: "sender@example.com", bodyText: "不应新增", bodyHtml: "<p>不应新增</p>" }, { updateOnly: true });
    assert.equal(inserted, true);
    assert.equal(backfilled, false);
    assert.equal(ignoredHistory, false);
    assert.equal(context.repositories.pageAddressMessages(context.address.id, 1, 20).total, 1);
    const path = new URL(access.legacyApiUrl).pathname;
    const response = await request(context.app).get(path).expect(200);
    assert.equal(response.body.message.code, "654321");
    assert.equal(response.body.message.bodyText, "您的验证码是 654321");
    assert.equal(response.body.message.bodyHtml, "<strong>您的验证码是 654321</strong>");
    const stored = context.repositories.getMessage(response.body.message.id);
    assert.equal(stored.bodyHtml, "<strong>您的验证码是 654321</strong>");
    const feed = new URL(access.apiUrl);
    const feedResponse = await request(context.app).get(`${feed.pathname}${feed.search}`).expect(200);
    assert.equal(feedResponse.body.status, "success");
    assert.equal(feedResponse.body.count, 1);
    assert.equal(feedResponse.body.data[0].code, "654321");
    assert.equal(feedResponse.body.data[0].body, "<strong>您的验证码是 654321</strong>");
    await request(context.app).get(path.replace(access.token, "wrong-token-value-that-is-long-enough-123456")).expect(404);
    context.publicMailService.revokeAccess(context.address.id);
    await request(context.app).get(path).expect(404);
  } finally { context.cleanup(); }
});
