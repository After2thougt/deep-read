export async function analyzeArticle(text) {
  const resp = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!resp.ok) {
    const errorBody = await resp.json().catch(() => ({}));
    throw errorBody;
  }

  return resp.json();
}
