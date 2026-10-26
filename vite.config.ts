import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { ARTWORK_ORIGIN } from "./src/artworkPolicy.ts";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    headers: { "Content-Security-Policy": `img-src ${ARTWORK_ORIGIN}; object-src 'none'; base-uri 'none'` },
    watch: {
      // Chrome locks session files. These are runtime data, not source files.
      ignored: (filePath: string) =>
        /(^|[/\\])\.(riftlogs-spectator-profile|playwright-profile)([/\\]|$)/.test(filePath),
    },
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
