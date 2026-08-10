const http = require('http');
const data = JSON.stringify({ text: 'This is a grammar analysis test.' });
const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/analyze',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  },
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log(body);
  });
});

req.on('error', (err) => {
  console.error('ERR', err.message);
  process.exit(1);
});

req.write(data);
req.end();
