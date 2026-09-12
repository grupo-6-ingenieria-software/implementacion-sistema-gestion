import React from "react";
import { createRoot } from "react-dom/client";
import { SaleRegisterView } from "../../src/renderer/src/views/SaleRegisterView";
import "../../src/renderer/src/styles.css";

createRoot(document.getElementById("root")).render(
  <SaleRegisterView
    session={{
      usuarioId: "12345678-9",
      trabajadorNombre: "Ana Prueba",
      usuarioRol:
        new URLSearchParams(location.search).get("rol") ?? "trabajador",
    }}
  />,
);
