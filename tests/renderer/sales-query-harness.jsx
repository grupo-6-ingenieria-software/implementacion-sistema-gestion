import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AnularVentaView } from "../../src/renderer/src/views/AnularVentaView";
import {
  ConsultaVentasView,
  getSafeSalesQueryReturnPath,
} from "../../src/renderer/src/views/ConsultaVentasView";
import "../../src/renderer/src/styles.css";

const params = new URLSearchParams(location.search);
const usuarioId = params.get("rol") === "dueno" ? "dueno-prueba" : "trabajador-prueba";
const initialPath = params.get("path") ?? "/app/ventas/consulta";

function Harness() {
  const [path, setPath] = useState(initialPath);
  window.setCu41Path = setPath;

  const onNavigate = (nextPath) => {
    window.navigations.push(nextPath);
    if (nextPath.startsWith("/app/ventas/")) setPath(nextPath);
  };

  if (path.startsWith("/app/ventas/anular")) {
    const query = path.split("?")[1] ?? "";
    return (
      <AnularVentaView
        initialVentaId={new URLSearchParams(query).get("ventaId") ?? undefined}
        returnPath={getSafeSalesQueryReturnPath(path)}
        usuarioId={usuarioId}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <ConsultaVentasView
      currentPath={path}
      usuarioId={usuarioId}
      onNavigate={onNavigate}
    />
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
