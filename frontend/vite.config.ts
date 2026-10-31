import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(new Date().toISOString()),
  },
  build: {
    rollupOptions: {
      output: {
        // 将稳定的第三方依赖从业务入口拆出，降低首屏 chunk 并提高浏览器缓存命中率。
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          const normalizedId = id.replace(/\\/g, "/");
          if (normalizedId.includes("/@mui/icons-material/")) return "mui-icons";
          if (
            normalizedId.includes("/@mui/") ||
            normalizedId.includes("/@emotion/")
          ) {
            return "mui";
          }
          if (
            normalizedId.includes("/@tanstack/react-query/") ||
            normalizedId.includes("/zustand/")
          ) {
            return "state";
          }
          if (
            normalizedId.includes("/react/") ||
            normalizedId.includes("/react-dom/") ||
            normalizedId.includes("/scheduler/")
          ) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts", 
  },
});
