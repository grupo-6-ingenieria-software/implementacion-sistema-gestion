import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/src/App";
import "../../src/renderer/src/styles.css";

createRoot(document.getElementById("root")).render(<App />);
