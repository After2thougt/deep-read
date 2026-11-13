import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("Administrator Home renders platform statistics, distribution, and recent users", async (t) => {
  const server = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: "custom",
  });
  t.after(() => server.close());

  const { default: AdministratorHomePage } = await server.ssrLoadModule(
    "/src/pages/AdministratorHomePage.jsx",
  );
  const originalFetch = globalThis.fetch;
  const originalGlobals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);

  async function renderOverview(overview) {
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
    globalThis.fetch = async () => new Response(JSON.stringify(overview), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(createElement(AdministratorHomePage));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { dom, root };
  }

  try {
    const recentUsers = Array.from({ length: 5 }, (_, index) => ({
      username: `reader-${index + 1}`,
      createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    }));
    const { dom, root } = await renderOverview({
      stats: {
        totalUsers: 4,
        activeUsers: 3,
        disabledUsers: 1,
        administrators: 2,
      },
      recentUsers,
    });

    try {
      assert.equal(document.querySelector(".administrator-home__header h2").textContent, "Home");
      assert.equal(document.querySelector(".administrator-home__header p").textContent, "Platform overview");
      assert.deepEqual(
        [...document.querySelectorAll(".administrator-home__stat")].map((card) => [
          card.querySelector("h3").textContent,
          card.querySelector("p").textContent,
        ]),
        [
          ["Total Users", "4"],
          ["Active Users", "3"],
          ["Disabled Users", "1"],
          ["Administrators", "2"],
        ],
      );
      assert.deepEqual(
        [...document.querySelectorAll(".administrator-home__bar > span")].map((bar) => bar.style.width),
        ["75%", "25%"],
      );
      assert.match(
        document.querySelector(".administrator-home__legend").textContent,
        /Active Users\s*3\s*75%/,
      );
      assert.match(
        document.querySelector(".administrator-home__legend").textContent,
        /Disabled Users\s*1\s*25%/,
      );
      assert.deepEqual(
        [...document.querySelectorAll(".administrator-home__recent-users li > span")]
          .map((user) => user.textContent),
        recentUsers.map((user) => user.username),
      );
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
    }

    const emptyResult = await renderOverview({
      stats: {
        totalUsers: 0,
        activeUsers: 0,
        disabledUsers: 0,
        administrators: 1,
      },
      recentUsers: [],
    });
    try {
      assert.equal(document.querySelector(".administrator-home__bar-empty") !== null, true);
      assert.match(document.querySelector(".administrator-home__legend").textContent, /0\s*0%/);
      assert.equal(
        document.querySelector(".administrator-home__empty").textContent,
        "No regular users have registered yet.",
      );
      assert.equal(document.querySelectorAll(".administrator-home__recent-users li").length, 0);
    } finally {
      await act(async () => emptyResult.root.unmount());
      emptyResult.dom.window.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
