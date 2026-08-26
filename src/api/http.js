export async function apiFetch(url, options = {}) {
  console.log("[apiFetch] request:", { url, method: options?.method || 'GET', hasBody: !!options?.body });
  const resp = await fetch(url, options);

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const message = body.error || body.details || `Request failed (${resp.status})`;
    throw new Error(message);
  }

  if (resp.status === 204) {
    return null;
  }

  const data = await resp.json();
  console.log("[apiFetch] response:", { url, status: resp.status, dataKeys: data ? Object.keys(data) : null, dataId: data?.id });
  return data;
}
