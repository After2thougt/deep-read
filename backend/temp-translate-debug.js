const axios = require("axios");
const body = {
  text: "The Industrial Revolution changed the world.\n\nIt began in Britain in the 18th century.",
  target: "zh"
};
axios.post('http://127.0.0.1:3001/api/translate?provider=tencent', body, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 })
  .then(r => console.log('RESPONSE', JSON.stringify(r.data, null, 2)))
  .catch(err => {
    console.error('ERR', err.toString());
    if (err.response) {
      try { console.error('RESPONSE_BODY', JSON.stringify(err.response.data, null, 2)); } catch (e) { console.error('RESPONSE_BODY', err.response.data); }
    }
    process.exit(1);
  });
