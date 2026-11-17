import { start } from "./index.js";

start().catch((e) => { console.error(e.message); process.exit(1); });
