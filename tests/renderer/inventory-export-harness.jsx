import React from "react";
import { createRoot } from "react-dom/client";
import { ProductListView } from "../../src/renderer/src/views/ProductListView";
import "../../src/renderer/src/styles.css";

createRoot(document.getElementById("root")).render(
  <ProductListView
    role={new URLSearchParams(location.search).get("rol") ?? "trabajador"}
    usuarioId="trusted"
    onNavigate={() => {}}
  />,
);
