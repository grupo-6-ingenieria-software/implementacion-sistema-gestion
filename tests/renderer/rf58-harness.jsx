import React from "react";
import { createRoot } from "react-dom/client";
import { AuditLogView } from "../../src/renderer/src/views/AuditLogView";
import "../../src/renderer/src/styles.css";

createRoot(document.getElementById("root")).render(
  <AuditLogView usuarioId="12345678-9" onNavigate={(path) => { window.lastNavigation = path; }} />,
);
