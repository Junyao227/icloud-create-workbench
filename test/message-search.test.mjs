import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createDatabase } from "../src/db.mjs";
import { createRepositories } from "../src/repositories.mjs";
import { createMessageSearch } from "../src/services/message-search.mjs";
import { createApp } from "../src/app.mjs";

/** 创建内存数据库和真实登录保护的搜索接口。 */
function context(t) {
  const db = createDatabase(":memory:");
  t.after(() => db.close());
  const repositories = createRepositories(db);
  const accounts = ["one", "two"].map(key => repositories.upsertAccount({
    identityKey: key, appleId: `${key}@example.com`, dsid: key, cookieEncrypted: "encrypted",
    displayName: key, region: "global", userPartition: "68", maildomainHost: "p68-maildomainws.icloud.com"
  }));
  for (const account of accounts) {
    repositories.upsertAddresses(account.id, null, [{ email: `${account.id}@icloud.com`, label: "test" }], "synced");
  }
  const messageSearch = createMessageSearch(db);
  const config = { appOrigin: "http://127.0.0.1:4173", adminUsername: "admin", adminPassword: "correct-password",
    jwtSecret: "test-jwt-secret-that-is-long-enough-123456789", jwtExpiresIn: "8h", cookieSecure: false, publicMailRateLimit: 60 };
  const app = createApp({ config, repositories, messageSearch, icloudService: {}, inboxService: {}, campaignService: {}, publicMailService: {} });
  let uid = 0;
  /** 插入独立测试邮件，默认关联第一个账号的隐藏邮箱。 */
  function insert(fields = {}, index = 0) {
    const account = accounts[index];
    repositories.insertMessage(account.id, { uid: `test:${++uid}`, recipient: `${account.id}@icloud.com`,
      subject: "普通主题", bodyText: "普通正文", receivedAt: "2026-10-09T08:00:00Z", ...fields });
  }
  /** 使用正常管理员登录建立会话。 */
  async function login() {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").set("Origin", config.appOrigin)
      .send({ username: "admin", password: "correct-password" }).expect(200);
    return agent;
  }
  return { db, accounts, messageSearch, app, insert, login };
}

test("跨账号搜索主题、纯文本和 HTML，规范化大小写、换行及实体", t => {
  const c = context(t);
  c.insert({ subject: "Your free month of ChatGPT Plus" });
  c.insert({ bodyText: "前文 Your free\nmonth of ChatGpt Plus 后文" }, 1);
  c.insert({ bodyText: "无关纯文本", bodyHtml: '<style>secret-style</style><p>Your&nbsp;free <b>month</b> of ChatGPT Plus</p>' }, 1);
  c.insert({ bodyHtml: '<a href="https://example.com/Your-free-month">点击</a><script>secret-script</script>' });
  const matches = c.messageSearch.search({ keyword: "your free month of chatgpt plus" });
  assert.equal(matches.length, 3);
  assert.equal(c.messageSearch.search({ keyword: "your free month of chatgpt plus", accountId: c.accounts[0].id }).length, 1);
  assert.equal(c.messageSearch.search({ keyword: "secret-style" }).length, 0);
  assert.equal(c.messageSearch.search({ keyword: "secret-script" }).length, 0);
  assert.equal(c.messageSearch.search({ keyword: "https://example.com" }).length, 0);
  assert.equal(c.messageSearch.search({ keyword: "不存在" }).length, 0);
  assert.ok(matches.some(row => row.preview.includes("Your free month")));
});

test("关键词按字面匹配，不把 SQL 通配符或引号解释为查询", t => {
  const c = context(t);
  c.insert({ bodyText: "100%_literal ' OR 1=1 --" });
  c.insert();
  assert.equal(c.messageSearch.search({ keyword: "%_" }).length, 1);
  assert.equal(c.messageSearch.search({ keyword: "' OR 1=1 --" }).length, 1);
  assert.equal(c.messageSearch.search({ accountId: "' OR 1=1 --" }).length, 0);
});

test("搜索、复制和导出均要求管理员登录", async t => {
  const c = context(t);
  for (const path of ["search", "search/emails", "search/export"]) {
    await request(c.app).get(`/api/messages/${path}`).expect(401);
  }
});

test("分页不遗漏匹配，复制跨页去重，导出包含全文并防止 CSV 公式", async t => {
  const c = context(t);
  for (let index = 0; index < 23; index++) c.insert({ subject: '=HYPERLINK("x")', bodyText: `needle 第${index}封正文` });
  c.insert({ bodyText: "needle 另一个账号" }, 1);
  c.insert({ recipient: "", bodyText: "needle 未关联邮箱" });
  c.insert({ bodyText: "无关邮件" });
  const agent = await c.login();
  await request(c.app).get("/messages").expect(302).expect("Location", "/login");
  await agent.get("/messages").expect(200).expect("Content-Type", /html/);
  const first = await agent.get('/api/messages/search?keyword=needle&page=1&pageSize=20').expect(200);
  const second = await agent.get('/api/messages/search?keyword=needle&page=2&pageSize=20').expect(200);
  assert.equal(first.body.pagination.total, 25);
  assert.equal(first.body.mailboxCount, 2);
  assert.equal(first.body.messages.length, 20);
  assert.equal(second.body.messages.length, 5);
  assert.equal(new Set([...first.body.messages, ...second.body.messages].map(row => row.id)).size, 25);
  assert.equal('bodyText' in first.body.messages[0], false);
  const emails = await agent.get('/api/messages/search/emails?keyword=needle').expect(200);
  assert.equal(emails.body.emails.length, 2);
  const exported = await agent.get('/api/messages/search/export?keyword=needle').expect(200).expect('Content-Type', /text\/csv/);
  assert.equal(exported.text.split('\r\n').length, 26);
  assert.match(exported.text, /第22封正文/);
  assert.match(exported.text, /"'=HYPERLINK\(""x""\)"/);
  assert.doesNotMatch(exported.text, /无关邮件/);
  const scoped = await agent.get('/api/messages/search/emails').query({ keyword: 'needle', accountId: c.accounts[1].id }).expect(200);
  assert.equal(scoped.body.emails.length, 1);
  await agent.get(`/api/messages/${first.body.messages[0].id}`).expect(200);
});

test("非法参数返回明确错误，无结果可正常显示及导出", async t => {
  const c = context(t);
  const agent = await c.login();
  for (const query of [{ page: 'NaN' }, { page: '1.5' }, { pageSize: '0' }, { pageSize: '101' }, { keyword: 'x'.repeat(301) }, { keyword: ['a', 'b'] }]) {
    await agent.get('/api/messages/search').query(query).expect(400);
  }
  const empty = await agent.get('/api/messages/search?keyword=not-found').expect(200);
  assert.equal(empty.body.pagination.total, 0);
  assert.equal(empty.body.pagination.totalPages, 1);
  await agent.get('/api/messages/search/emails?keyword=not-found').expect(200, { emails: [] });
  const csv = await agent.get('/api/messages/search/export?keyword=not-found').expect(200);
  assert.equal(csv.text.split('\r\n').length, 1);
});
