import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const backend = require("./backend/server.js");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

backend.app.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}`);
});
