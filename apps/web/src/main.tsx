import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function SeedPlaceholder() {
  return (
    <main>
      <h1>Streaming Chat POC</h1>
      <p>Product implementation begins during EXP-002.</p>
    </main>
  );
}

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <SeedPlaceholder />
  </StrictMode>
);
