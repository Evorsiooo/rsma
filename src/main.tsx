import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./kit/tokens.css";
import "./kit/base.css";
import "./kit/components.css";
import "./kit/parts.css";
import "./kit/motion.css";
import "./kit/rsma-ui.js";
import "./kit/parts.js";
import "./app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
