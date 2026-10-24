// This is the entry point: the first file the browser runs for this app.
// Its only job is to put the React app onto the page.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Importing a CSS file here is how the page gets its styles. Vite bundles it for us.
import "./styles.css";

// index.html has an empty <div id="root">. React takes over that div and draws everything
// inside it. The "!" after getElementById tells TypeScript "this element exists", because
// TypeScript cannot see index.html and would otherwise warn that it might be null.
createRoot(document.getElementById("root")!).render(
  // StrictMode adds extra checks while developing, such as running some code twice to
  // catch mistakes. It does nothing in the production build.
  <StrictMode>
    <App />
  </StrictMode>,
);
