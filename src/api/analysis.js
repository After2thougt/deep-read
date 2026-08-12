export async function analyzeArticle(text, requestId, options = {}) {
  const resp = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(requestId ? { 'X-Analysis-Request-Id': requestId } : {}) },
    body: JSON.stringify({ text, ...options }),
  });

  if (!resp.ok) {
    const errorBody = await resp.json().catch(() => ({}));
    throw { ...errorBody, status: resp.status };
  }

  return resp.json();
}

export async function clearArticleAnalysis(articleId, text, requestId, options = {}) {
  const resp = await fetch(`/api/articles/${encodeURIComponent(articleId)}/analysis`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(requestId ? { 'X-Analysis-Request-Id': requestId } : {}) },
    body: JSON.stringify({ text, ...options }),
  });

  if (!resp.ok) {
    const errorBody = await resp.json().catch(() => ({}));
    throw { ...errorBody, status: resp.status };
  }

  return resp.json();
}
