const axios=require("axios");
const body={text:"Hello world.\n\nThis is a test.",target:"zh"};
axios.post('http://127.0.0.1:3001/api/translate', body, { headers:{'Content-Type':'application/json'}, timeout:30000 })
.then(r=>console.log(JSON.stringify(r.data,null,2)))
.catch(err=>{
  console.error('ERR', err.toString());
  if(err.response){ try{ console.error(JSON.stringify(err.response.data,null,2)); } catch(e){ console.error(err.response.data); } }
  process.exit(1);
});
