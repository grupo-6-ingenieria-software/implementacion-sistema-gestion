import React from "react";
import { createRoot } from "react-dom/client";
import { AnularVentaView } from "../../src/renderer/src/views/AnularVentaView";
import { DailySalesView } from "../../src/renderer/src/views/DailySalesView";
import "../../src/renderer/src/styles.css";

const params = new URLSearchParams(location.search);

const usuarioId =
  params.get("rol") === "dueno" ? "dueno-prueba" : "trabajador-prueba";
const onNavigate = (path) => window.navigations.push(path);

createRoot(document.getElementById("root")).render(
  params.get("view") === "daily" ? (
    <DailySalesView usuarioId={usuarioId} onNavigate={onNavigate} />
  ) : (
    <AnularVentaView
      usuarioId={usuarioId}
      initialVentaId={params.get("ventaId") ?? undefined}
      onNavigate={onNavigate}
    />
  ),
);
