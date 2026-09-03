import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the client runs on :5173 and talks to the arena server on :3001.
// A production build is emitted to dist/ and served by arena-server.js itself.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
