import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LOGIN_PATH,
  getNavigationItems,
  getRoleRedirect,
  USER_MANAGEMENT_PATH,
} from "./access.js";

const READING_PATHS = ["/", "/articles", "/vocabulary", "/highlight"];

test("Administrator defaults to Home after login", () => {
  assert.equal(DEFAULT_LOGIN_PATH, "/");
});

test("Administrator navigation contains Home and User Management only", () => {
  assert.deepEqual(getNavigationItems("administrator"), [
    { path: "/", label: "Home", icon: "home" },
    { path: USER_MANAGEMENT_PATH, label: "User Management", icon: "users" },
  ]);
});

test("Administrator can remain on Home", () => {
  assert.equal(getRoleRedirect("administrator", "/"), null);
});

test("Administrator is redirected from Articles to Home", () => {
  assert.equal(getRoleRedirect("administrator", "/articles"), "/");
  assert.equal(getRoleRedirect("administrator", "/articles/new"), "/");
});

test("Administrator is redirected from Vocabulary to Home", () => {
  assert.equal(getRoleRedirect("administrator", "/vocabulary"), "/");
});

test("Administrator is redirected from Highlight to Home", () => {
  assert.equal(getRoleRedirect("administrator", "/highlight"), "/");
  assert.equal(getRoleRedirect("administrator", "/highlight/article-1"), "/");
});

test("Administrator can remain on User Management", () => {
  assert.equal(getRoleRedirect("administrator", USER_MANAGEMENT_PATH), null);
});

test("regular users keep the four reading navigation entries and routes", () => {
  assert.deepEqual(getNavigationItems("user").map(({ path }) => path), READING_PATHS);
  for (const pathname of READING_PATHS) {
    assert.equal(getRoleRedirect("user", pathname), null);
  }
});

test("regular users cannot access User Management", () => {
  assert.equal(getRoleRedirect("user", USER_MANAGEMENT_PATH), "/");
});

test("Guest keeps the four reading navigation entries and default route", () => {
  assert.equal(DEFAULT_LOGIN_PATH, "/");
  assert.deepEqual(getNavigationItems("guest").map(({ path }) => path), READING_PATHS);
  for (const pathname of READING_PATHS) {
    assert.equal(getRoleRedirect("guest", pathname), null);
  }
});

test("Guest cannot access User Management", () => {
  assert.equal(getRoleRedirect("guest", USER_MANAGEMENT_PATH), "/");
});

test("username admin does not grant Administrator navigation or route access", () => {
  const account = { username: "admin", role: "user" };
  assert.deepEqual(getNavigationItems(account.role).map(({ path }) => path), READING_PATHS);
  assert.equal(getRoleRedirect(account.role, USER_MANAGEMENT_PATH), "/");
});
