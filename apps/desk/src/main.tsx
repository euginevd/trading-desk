import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource-variable/newsreader/opsz.css";
import App from "./App";
import { closeOnClickAway } from "./dismiss";
import "./styles.css";

closeOnClickAway(document); // design-system 9a: a click outside a box closes it

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
