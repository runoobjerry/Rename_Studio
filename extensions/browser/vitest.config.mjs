import { fileURLToPath } from "node:url";

export default {
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: { environment: "node", globals: true, include: ["tests/**/*.test.js"] },
};
