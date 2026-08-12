export async function apiFetch(url, options = {}) {
  const resp = await fetch(url, options);

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const message = body.error || body.details || `Request failed (${resp.status})`;
    throw new Error(message);
  }

  if (resp.status === 204) {
    return null;
  }

  return resp.json();
}
