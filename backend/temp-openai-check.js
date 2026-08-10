const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const rawBase = String(process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');
const base = rawBase.replace(/\/+$/, '').replace(/\/v1$/i, '');
const apiMode = (process.env.OPENAI_API_MODE || 'responses').toLowerCase();
const endpointUrl = rawBase.toLowerCase().endsWith('/responses')
  ? rawBase
  : apiMode === 'responses'
  ? `${base}/v1/responses`
  : rawBase.toLowerCase().endsWith('/chat/completions')
  ? rawBase
  : `${base}/v1/chat/completions`;

console.log('rawBase', rawBase);
console.log('base', base);
console.log('apiMode', apiMode);
console.log('endpointUrl', endpointUrl);
console.log('model', process.env.OPENAI_MODEL);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OpenAI API key is missing.');
  process.exit(1);
}

const payload = {
  model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  input: 'test',
  max_output_tokens: 10,
};

axios.post(endpointUrl, payload, {
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  timeout: 15000,
})
  .then((r) => {
    console.log('status', r.status);
    console.log(JSON.stringify(r.data, null, 2));
  })
  .catch((err) => {
    console.error('ERR', err.message);
    if (err.response) {
      console.error('STATUS', err.response.status);
      console.error(JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  });
