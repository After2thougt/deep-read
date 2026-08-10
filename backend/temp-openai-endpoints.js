const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });
const base = String(process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '').replace(/\/v1$/i, '');
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const endpoints = [
  `${base}/v1/responses`,
  `${base}/responses`,
  `${base}/v1/chat/completions`,
  `${base}/chat/completions`,
  `${base}/v1/completions`,
  `${base}/completions`,
  `${base}/v1/embeddings`,
];
async function run() {
  for (const endpointUrl of endpoints) {
    try {
      console.log('===', endpointUrl);
      const payload = endpointUrl.includes('/embeddings')
        ? { input: 'test', model }
        : { model, input: 'test', max_output_tokens: 10 };
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      const response = await axios.post(endpointUrl, payload, { headers, timeout: 15000 });
      console.log('status', response.status);
      console.log(JSON.stringify(response.data, null, 2));
    } catch (err) {
      console.error('ERR', err.message);
      if (err.response) {
        console.error('STATUS', err.response.status);
        console.error(JSON.stringify(err.response.data, null, 2));
      }
    }
  }
}
run();
