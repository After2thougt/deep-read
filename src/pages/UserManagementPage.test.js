import assert from "node:assert/strict";
import { act, createElement } from "react";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("User Management shows every account in role/date order with continuous numbering", async (t) => {
  const server = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: "custom",
  });
  t.after(() => server.close());

  const { default: UserManagementPage } = await server.ssrLoadModule(
    "/src/pages/UserManagementPage.jsx",
  );
  const originalFetch = globalThis.fetch;
  const originalGlobals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const guest = {
    id: "guest",
    username: "Guest",
    role: "guest",
    is_active: 1,
    created_at: null,
    account_count: 1,
    active_sessions: 2,
    database: "Guest Database",
    database_stats: { articles: 3, tags: 2, vocabulary: 7 },
    login_configured: true,
  };
  let accounts = [
    {
      id: 1,
      username: "admin",
      role: "user",
      is_active: 1,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    guest,
    {
      id: 2,
      username: "Administrator",
      role: "administrator",
      is_active: 1,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: 4,
      username: "reader-inactive",
      role: "user",
      is_active: 0,
      created_at: "2026-02-01T00:00:00.000Z",
    },
    {
      id: 3,
      username: "reader-new",
      role: "user",
      is_active: 1,
      created_at: "2026-02-01T00:00:00.000Z",
    },
  ];
  const requests = [];
  let nextCreatedId = 5;
  let nextCreatedDay = 1;

  function response(body, status = 200) {
    return { ok: status < 400, status, json: async () => body };
  }

  function visibleRows() {
    return [...document.querySelectorAll("tbody tr")];
  }

  function assertNumbering(expectedUsernames) {
    const rows = visibleRows();
    assert.deepEqual(rows.map((row) => row.querySelector('[data-label="No."]').textContent.trim()),
      expectedUsernames.map((_, index) => String(index + 1)));
    assert.deepEqual(rows.map((row) => row.querySelector('[data-label="Username"]').textContent.trim()),
      expectedUsernames);
  }

  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  try {
    const dom = new JSDOM("<!doctype html><div id=\"root\"></div>", {
      pretendToBeVisual: true,
      url: "http://localhost/",
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: dom.window.navigator,
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url, options });
      if (url === "/api/admin/users" && !options.method) {
        return response(accounts.map((account) => ({ ...account })));
      }
      if (url === "/api/admin/users" && options.method === "POST") {
        const body = JSON.parse(options.body);
        const created = {
          id: nextCreatedId++,
          username: body.username,
          role: "user",
          is_active: 1,
          created_at: `2026-04-0${nextCreatedDay++}T00:00:00.000Z`,
        };
        accounts = [...accounts, created];
        return response(created, 201);
      }
      if (url === "/api/admin/users/4" && options.method === "PATCH") {
        const body = JSON.parse(options.body);
        accounts = accounts.map((account) => account.id === 4
          ? { ...account, is_active: Number(body.isActive) }
          : account);
        return response(accounts.find((account) => account.id === 4));
      }
      if (url === "/api/admin/guest" && options.method === "PATCH") {
        const body = JSON.parse(options.body);
        accounts = accounts.map((account) => account.role === "guest"
          ? { ...account, is_active: Number(body.isActive) }
          : account);
        return response(accounts.find((account) => account.role === "guest"));
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    };

    const { createRoot } = await import("react-dom/client");
    let root = createRoot(document.getElementById("root"));
    try {
      await act(async () => {
        root.render(createElement(UserManagementPage));
        await flush();
      });

      const initialOrder = [
        "Administrator",
        "Guest",
        "admin",
        "reader-new",
        "reader-inactive",
      ];
      assertNumbering(initialOrder);
      assert.equal(visibleRows().length, 5);
      assert.equal(
        visibleRows().filter((row) =>
          row.querySelector('[data-label="Account Type"]').textContent.trim() === "Guest").length,
        1,
      );
      assert.equal(
        visibleRows()[4].querySelector('[data-label="Status"]').textContent.trim(),
        "Inactive",
      );
      assert.equal(
        visibleRows()[1].querySelector('[data-label="Database"]').textContent.trim(),
        "Guest Database",
      );
      assert.equal(
        visibleRows()[4].querySelector('[data-label="Account Type"]').textContent.trim(),
        "User",
      );

      await act(async () => {
        visibleRows()[4].querySelector("button").dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true }),
        );
      });
      assert.equal(
        visibleRows()[4].querySelector('[data-label="Status"]').textContent.trim(),
        "Active",
      );

      const usernameInput = document.querySelector('.user-create-form input[autocomplete="off"]');
      const passwordInput = document.querySelector('.user-create-form input[type="password"]');
      const setInputValue = (input, value) => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      };
      async function createUser(username) {
        await act(async () => {
          setInputValue(usernameInput, username);
          setInputValue(passwordInput, "long-enough-password");
        });
        await act(async () => {
          document.querySelector(".user-create-form").dispatchEvent(
            new dom.window.Event("submit", { bubbles: true, cancelable: true }),
          );
          await flush();
          await flush();
        });
      }

      await createUser("test");

      const afterCreateOrder = ["Administrator", "Guest", "admin", "reader-new", "reader-inactive", "test"];
      assertNumbering(afterCreateOrder);
      assert.equal(visibleRows().length, 6);
      assert.equal(visibleRows()[2].querySelector('[data-label="No."]').textContent.trim(), "3");

      await createUser("test-newer");
      const afterSecondCreateOrder = [
        "Administrator",
        "Guest",
        "admin",
        "reader-new",
        "reader-inactive",
        "test",
        "test-newer",
      ];
      assertNumbering(afterSecondCreateOrder);
      assert.equal(visibleRows().length, 7);
      assert.equal(visibleRows()[5].querySelector('[data-label="No."]').textContent.trim(), "6");
      assert.equal(visibleRows()[6].querySelector('[data-label="No."]').textContent.trim(), "7");

      await act(async () => root.unmount());
      root = createRoot(document.getElementById("root"));
      await act(async () => {
        root.render(createElement(UserManagementPage));
        await flush();
      });
      assertNumbering(afterSecondCreateOrder);
      assert.equal(visibleRows().length, 7);

      const guestRow = visibleRows()[1];
      await act(async () => {
        guestRow.querySelector("button").dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true }),
        );
      });
      assert.equal(
        visibleRows()[1].querySelector('[data-label="Status"]').textContent.trim(),
        "Disabled",
      );
      assert.equal(visibleRows().length, 7);

      await act(async () => {
        visibleRows()[1].querySelector("button").dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true }),
        );
      });
      assert.equal(
        visibleRows()[1].querySelector('[data-label="Status"]').textContent.trim(),
        "Enabled",
      );
      assert.equal(visibleRows().length, 7);
      assert.equal(
        requests.filter((request) => request.url === "/api/admin/users" && !request.options.method).length,
        4,
      );

      accounts = [
        {
          id: 10,
          username: "invalid-date",
          role: "user",
          is_active: 1,
          created_at: "not-a-date",
        },
        {
          id: 9,
          username: "missing-date",
          role: "user",
          is_active: 1,
          created_at: "",
        },
        { ...guest },
        {
          id: 2,
          username: "Administrator",
          role: "administrator",
          is_active: 1,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: 8,
          username: "valid-date",
          role: "user",
          is_active: 1,
          created_at: "2020-01-01T00:00:00.000Z",
        },
      ];
      const invalidDateOrder = [
        "Administrator",
        "Guest",
        "missing-date",
        "invalid-date",
        "valid-date",
      ];
      await act(async () => root.unmount());
      root = createRoot(document.getElementById("root"));
      await act(async () => {
        root.render(createElement(UserManagementPage));
        await flush();
      });
      assertNumbering(invalidDateOrder);

      await act(async () => root.unmount());
      root = createRoot(document.getElementById("root"));
      await act(async () => {
        root.render(createElement(UserManagementPage));
        await flush();
      });
      assertNumbering(invalidDateOrder);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
