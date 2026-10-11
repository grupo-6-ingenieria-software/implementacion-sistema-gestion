import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConsultaVentasView } from "../../src/renderer/src/views/ConsultaVentasView";
import { SaleRegisterView } from "../../src/renderer/src/views/SaleRegisterView";
import "../../src/renderer/src/styles.css";

const vista = new URLSearchParams(location.search).get("vista");

function SalesQuery() {
  // La consulta se dirige por la ruta, igual que en AppShell.
  const [path, setPath] = useState("/app/ventas/consulta");
  return (
    <ConsultaVentasView
      currentPath={path}
      usuarioId="12345678-9"
      onNavigate={(next) => {
        if (next.startsWith("/app/ventas/consulta")) setPath(next);
      }}
    />
  );
}

createRoot(document.getElementById("root")).render(
  vista === "consulta" ? (
    <SalesQuery />
  ) : (
    <SaleRegisterView
      session={{ usuarioId: "12345678-9", trabajadorNombre: "Ana Prueba", role: "trabajador" }}
    />
  ),
);
