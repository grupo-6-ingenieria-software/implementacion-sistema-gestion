import React from "react";
import { createRoot } from "react-dom/client";
import { ReporteMensualVentasView } from "../../src/renderer/src/views/ReporteMensualVentasView";
import "../../src/renderer/src/styles.css";

createRoot(document.getElementById("root")).render(
  <ReporteMensualVentasView onNavigate={(path) => { window.lastNavigation = path; }} />,
);
