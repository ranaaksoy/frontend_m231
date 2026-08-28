import { createRouter } from "./router/index.js";

const app = createRouter();

const PORT = 8081;
const HOST = "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`listening on ${HOST}:${PORT}`);
});
