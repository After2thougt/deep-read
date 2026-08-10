export async function translateArticle(text, target = 'zh') {
  const resp = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, target }),
  });

  if (!resp.ok) {
    const errorBody = await resp.json().catch(() => ({}));
    throw errorBody;
  }

  return resp.json();
}
