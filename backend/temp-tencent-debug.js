const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const secretId = process.env.TENCENT_SECRET_ID;
const secretKey = process.env.TENCENT_SECRET_KEY;
const region = process.env.TENCENT_REGION || 'ap-guangzhou';
const service = 'mps';
const host = 'mps.tencentcloudapi.com';
const action = 'TextTranslation';
const version = '2019-06-12';
const timestamp = Math.floor(Date.now() / 1000);
const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, '');
const body = JSON.stringify({ SourceText: 'The Industrial Revolution changed the world.', Source: 'auto', Target: 'zh' });

const hashSha256 = (msg) => crypto.createHash('sha256').update(msg, 'utf8').digest('hex');
const hmacSha256 = (key, msg) => crypto.createHmac('sha256', key).update(msg, 'utf8').digest();

const canonicalRequest = ['POST', '/', '', `content-type:application/json\nhost:${host}\n`, 'content-type;host', hashSha256(body)].join('\n');
const credentialScope = `${date}/${service}/tc3_request`;
const stringToSign = ['TC3-HMAC-SHA256', timestamp.toString(), credentialScope, hashSha256(canonicalRequest)].join('\n');
const secretDate = hmacSha256(`TC3${secretKey}`, date);
const secretService = hmacSha256(secretDate, service);
const secretSigning = hmacSha256(secretService, 'tc3_request');
const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;

(async () => {
  try {
    const resp = await axios.post(`https://${host}/`, body, {
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Host: host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': timestamp.toString(),
        'X-TC-Region': region,
      },
      timeout: 20000,
    });
    console.log('STATUS', resp.status);
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (err) {
    if (err.response) {
      console.error('STATUS', err.response.status);
      console.error(JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('ERROR', err.toString());
    }
  }
})();
