import React from "react";
import { createRoot } from "react-dom/client";
import { DashboardView } from "../../src/renderer/src/views/DashboardView";
import "../../src/renderer/src/styles.css";

createRoot(document.getElementById("root")).render(
  <DashboardView role="dueno" usuarioId="12345678-9" onNavigate={() => {}} />,
);
