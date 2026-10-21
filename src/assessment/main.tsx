import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AssessmentApp } from "./AssessmentApp";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Assessment page: #root element not found");
}

createRoot(container).render(
  <StrictMode>
    <AssessmentApp />
  </StrictMode>,
);
