import { apiFetch } from "./http";

const USERS_API = "/api/admin/users";

export function fetchAdminOverview() {
  return apiFetch("/api/admin/overview");
}

export function fetchAdminUsers() {
  return apiFetch(USERS_API);
}

export function createAdminUser({ username, password }) {
  return apiFetch(USERS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export function updateAdminUserStatus(userId, isActive) {
  return apiFetch(`${USERS_API}/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
}

export async function deleteAdminUser(userId) {
  let response;
  try {
    response = await fetch(`${USERS_API}/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    throw new Error("Unable to connect to DeepRead to delete this account.");
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    // Keep the status-based message when the server does not return JSON.
  }

  if (!response.ok) {
    const error = new Error(
      body.error || `Account deletion failed (${response.status}).`,
    );
    error.accountDeleted = body.accountDeleted === true;
    throw error;
  }

  return body;
}

export function updateGuestAccess(isActive) {
  return apiFetch("/api/admin/guest", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
}

export async function exportAdminUserData(userId) {
  let response;
  try {
    response = await fetch(`${USERS_API}/${encodeURIComponent(userId)}/export`, {
      credentials: "include",
    });
  } catch {
    throw new Error("Unable to connect to DeepRead to export this account.");
  }

  if (!response.ok) {
    let message = `Export failed (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.error === "string" && body.error) message = body.error;
    } catch {
      // Keep the status-based message when the server does not return JSON.
    }
    throw new Error(message);
  }

  const file = await response.blob();
  if (!file.size) throw new Error("The server returned an empty account export.");

  const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]
    || `deepread-account-${userId}-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
