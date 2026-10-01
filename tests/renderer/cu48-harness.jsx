import React from "react";
import { createRoot } from "react-dom/client";
import { ReporteProductosVendidosView } from "../../src/renderer/src/views/ReporteProductosVendidosView";
import "../../src/renderer/src/styles.css";

createRoot(document.getElementById("root")).render(
  <ReporteProductosVendidosView onNavigate={(path) => { window.lastNavigation = path; }} />,
);
