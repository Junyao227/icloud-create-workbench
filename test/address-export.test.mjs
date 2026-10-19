import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createAddressRouter } from "../src/routes/address-routes.mjs";

test("MMA 导出按筛选条件输出邮箱和取件码文本", async () => {
  let receivedFilters;
  const repositories = {
    /** 记录筛选条件并返回用于验证格式的邮箱。 */
    listAddresses(filters) {
      receivedFilters = filters;
      return [{ id: "addr-1", email: "alias@icloud.com", label: "apple-001" }];
    }
  };
  const publicMailService = {
    /** 复用已有公开取件码，验证 MMA 不再导出标签。 */
    ensureAccess(id) {
      assert.equal(id, "addr-1");
      return { token: "pickup-code-001" };
    }
  };
  const app = express();
  app.use("/api/addresses", createAddressRouter(repositories, publicMailService));

  const response = await request(app)
    .get("/api/addresses/export-mma?accountId=account-1&state=unused&search=apple")
    .expect(200)
    .expect("Content-Type", /text\/plain/)
    .expect("Content-Disposition", /hidden-addresses-mma\.txt/);

  assert.deepEqual(receivedFilters, { accountId: "account-1", state: "unused", search: "apple" });
  assert.equal(response.text.replace(/^\uFEFF/, ""), "alias@icloud.com----pickup-code-001");
});

test("MMA 导出指定邮箱时优先输出勾选项", async () => {
  let receivedFilters;
  const repositories = {
    /** 返回多个邮箱用于验证勾选 ID 优先于筛选条件。 */
    listAddresses(filters) {
      receivedFilters = filters;
      return [
        { id: "addr-1", email: "one@icloud.com" },
        { id: "addr-2", email: "two@icloud.com" }
      ];
    }
  };
  const publicMailService = {
    /** 根据邮箱 ID 返回不同取件码，方便验证导出结果。 */
    ensureAccess(id) {
      return { token: `token-${id}` };
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/addresses", createAddressRouter(repositories, publicMailService));

  const response = await request(app)
    .post("/api/addresses/export-mma")
    .send({ filters: { search: "不会参与筛选" }, ids: ["addr-2"] })
    .expect(200)
    .expect("Content-Type", /text\/plain/)
    .expect("Content-Disposition", /hidden-addresses-mma\.txt/);

  assert.deepEqual(receivedFilters, {});
  assert.equal(response.text.replace(/^\uFEFF/, ""), "two@icloud.com----token-addr-2");
});

test("公开链接导出会按筛选条件生成买家取码 URL", async () => {
  let receivedFilters;
  const repositories = {
    /** 记录筛选条件并返回用于生成公开链接的邮箱。 */
    listAddresses(filters) {
      receivedFilters = filters;
      return [{ id: "addr-1", email: "buyer@icloud.com", label: "buyer-001" }];
    }
  };
  const publicMailService = {
    /** 返回稳定 URL 以验证导出格式。 */
    ensureAccess(id) {
      assert.equal(id, "addr-1");
      return {
        apiUrl: "https://example.test/openapi/mail/buyer%40icloud.com/token/latest",
        viewerUrl: "https://example.test/mail/buyer%40icloud.com/token"
      };
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/addresses", createAddressRouter(repositories, publicMailService));

  const response = await request(app)
    .post("/api/addresses/public-access/export")
    .send({ filters: { accountId: "account-1", state: "unused", search: "buyer" }, kind: "api" })
    .expect(200)
    .expect("Content-Type", /text\/plain/)
    .expect("Content-Disposition", /public-mail-api-links\.txt/);

  assert.deepEqual(receivedFilters, { accountId: "account-1", state: "unused", search: "buyer" });
  assert.equal(
    response.text.replace(/^\uFEFF/, ""),
    "buyer@icloud.com----https://example.test/openapi/mail/buyer%40icloud.com/token/latest"
  );
});

test("公开链接导出指定邮箱时不受筛选条件影响", async () => {
  let receivedFilters;
  const repositories = {
    /** 返回多个邮箱用于验证前端勾选优先。 */
    listAddresses(filters) {
      receivedFilters = filters;
      return [
        { id: "addr-1", email: "one@icloud.com" },
        { id: "addr-2", email: "two@icloud.com" }
      ];
    }
  };
  const publicMailService = {
    /** 根据邮箱 ID 返回可区分的网页链接。 */
    ensureAccess(id) {
      return {
        apiUrl: `https://example.test/openapi/${id}`,
        viewerUrl: `https://example.test/mail/${id}`
      };
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/addresses", createAddressRouter(repositories, publicMailService));

  const response = await request(app)
    .post("/api/addresses/public-access/export")
    .send({ filters: { search: "不会参与筛选" }, ids: ["addr-2"], kind: "viewer" })
    .expect(200);

  assert.deepEqual(receivedFilters, {});
  assert.equal(response.text.replace(/^\uFEFF/, ""), "two@icloud.com----https://example.test/mail/addr-2");
});
