const fs = require('fs');

const oldCode = `/**
 * POST /api/articles/images/from-url
 * Download remote image, process it, and save to temp uploads
 * Security: validates protocol, limits size, validates content-type
 */
app.post('/api/articles/images/from-url', async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  // Basic SSRF protection: only allow http/https
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are allowed.' });
  }
  // Block private IP ranges (basic SSRF mitigation)
  const hostname = parsedUrl.hostname;
  const isPrivateIp = /^(10.|192.168.|172.(1[6-9]|2[0-9]|3[0-1]).|127.|169.254.|::1$|fe80::)/i.test(hostname);
  if (isPrivateIp) {
    return res.status(400).json({ error: 'Access to private IP addresses is not allowed.' });
  }

  try {
    // Download with size limit and timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    const response = await fetch(url, {
      dispatcher: new ProxyAgent("http://127.0.0.1:7890"),
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DeepRead/1.0)',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(400).json({ error: \`Failed to download image: HTTP \${response.status}\` });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'URL does not point to an image.' });
    }

    // Check content-length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_SIZE) {
      return res.status(413).json({ error: 'Image exceeds maximum download size (10 MB).' });
    }

    // Stream download with size limit enforcement
    const chunks = [];
    let totalSize = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.length;
      if (totalSize > MAX_DOWNLOAD_SIZE) {
        return res.status(413).json({ error: 'Image exceeds maximum download size (10 MB).' });
      }
    }
    const buffer = Buffer.concat(chunks);

    // Process using common function
    const { buffer: processedBuffer, fileName } = await processImageBuffer(buffer, contentType);
    
    // Save to temp
    const tempUrl = saveImageToTemp(processedBuffer, fileName);
    
    return res.status(201).json({ path: tempUrl, url: tempUrl });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return res.status(408).json({ error: 'Image download timed out.' });
    }
    if (error.message?.includes('Invalid image data') || error.message?.includes('exceeds') || error.message?.includes('allowed')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Download image error:', error);
    return res.status(500).json({ error: 'Failed to download and process image.' });
  }
});`;

const newCode = `/**
 * POST /api/articles/images/from-url
 * Download remote image, process it, and save to temp uploads
 * Security: validates protocol, limits size, validates content-type
 * Proxy: configurable via IMAGE_DOWNLOAD_PROXY env var (e.g., http://127.0.0.1:7890)
 */
app.post('/api/articles/images/from-url', async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  // Basic SSRF protection: only allow http/https
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are allowed.' });
  }
  // Block private IP ranges (basic SSRF mitigation)
  const hostname = parsedUrl.hostname;
  const isPrivateIp = /^(10.|192.168.|172.(1[6-9]|2[0-9]|3[0-1]).|127.|169.254.|::1$|fe80::)/i.test(hostname);
  if (isPrivateIp) {
    return res.status(400).json({ error: 'Access to private IP addresses is not allowed.' });
  }

  // Build fetch options with optional proxy and proper headers
  const fetchOptions = {
    signal: AbortSignal.timeout(15000), // 15 second timeout (modern fetch)
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DeepRead/1.0)',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      'Referer': parsedUrl.origin, // Helps with hotlink protection
    },
  };

  // Optional proxy via environment variable
  const proxyUrl = process.env.IMAGE_DOWNLOAD_PROXY;
  if (proxyUrl) {
    try {
      fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
    } catch (e) {
      console.warn('[ImageDownload] Invalid proxy URL, ignoring:', proxyUrl);
    }
  }

  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errMsg = \`Failed to download image: HTTP \${response.status} \${response.statusText}\`;
      console.error('[ImageDownload] HTTP error', { url, status: response.status, statusText: response.statusText });
      return res.status(400).json({ error: errMsg });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      console.error('[ImageDownload] Invalid content-type', { url, contentType });
      return res.status(400).json({ error: 'URL does not point to an image.' });
    }
    // Strict MIME type validation against allowed types
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      console.error('[ImageDownload] Disallowed MIME type', { url, contentType, allowed: [...ALLOWED_MIME_TYPES] });
      return res.status(400).json({ error: \`Unsupported image format: \${contentType}. Only JPEG, PNG, GIF, WebP are allowed.\` });
    }

    // Check content-length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_SIZE) {
      return res.status(413).json({ error: 'Image exceeds maximum download size (10 MB).' });
    }

    // Stream download with size limit enforcement
    const chunks = [];
    let totalSize = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.length;
      if (totalSize > MAX_DOWNLOAD_SIZE) {
        return res.status(413).json({ error: 'Image exceeds maximum download size (10 MB).' });
      }
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) {
      console.error('[ImageDownload] Empty image data', { url });
      return res.status(400).json({ error: 'Downloaded image is empty.' });
    }
    console.log('[ImageDownload] Downloaded', { url, contentType, size: buffer.length, finalUrl: response.url });

    // Process using common function
    const { buffer: processedBuffer, fileName } = await processImageBuffer(buffer, contentType);
    
    // Save to temp
    const tempUrl = saveImageToTemp(processedBuffer, fileName);
    
    return res.status(201).json({ path: tempUrl, url: tempUrl });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError' || error.code === 'ETIMEDOUT') {
      console.error('[ImageDownload] Timeout', { url, error: error.message });
      return res.status(408).json({ error: 'Image download timed out.' });
    }
    if (error.message?.includes('Invalid image data') || error.message?.includes('exceeds') || error.message?.includes('allowed')) {
      return res.status(400).json({ error: error.message });
    }
    // Detailed error logging for debugging
    console.error('[ImageDownload] Failed', {
      url,
      message: error.message,
      code: error.code,
      cause: error.cause?.message,
      stack: error.stack,
    });
    return res.status(500).json({ error: 'Failed to download and process image.' });
  }
});`;

const content = fs.readFileSync('D:/Projects/deep-read/backend/server.js', 'utf8');

if (!content.includes(oldCode)) {
  console.log('OLD CODE NOT FOUND!');
  process.exit(1);
}

const newContent = content.replace(oldCode, newCode);
fs.writeFileSync('D:/Projects/deep-read/backend/server.js', newContent, 'utf8');
console.log('Replacement done!');