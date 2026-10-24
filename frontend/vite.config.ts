// Settings for Vite, the tool that runs the dev server (npm run dev) and builds the app
// for release (npm run build).

import { defineConfig } from "vite";
// This plugin teaches Vite how to handle React's JSX syntax and enables fast refresh,
// which updates the page as you save a file without a full reload.
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Any request the browser makes to a path starting with /api is forwarded to the
    // Python backend on port 8000. That way the frontend code never contains the backend's
    // address, and the browser sees one origin, which avoids cross-origin (CORS) errors.
    // The backend has to be running on port 8000 for import, interpret, and solve to work.
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
