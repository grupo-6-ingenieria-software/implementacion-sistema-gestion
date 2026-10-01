import React from "react";
import { createRoot } from "react-dom/client";
import { ReporteRentabilidadView } from "../../src/renderer/src/views/ReporteRentabilidadView";
import "../../src/renderer/src/styles.css";

createRoot(document.getElementById("root")).render(
  <ReporteRentabilidadView onNavigate={(path) => { window.lastNavigation = path; }} />,
);
