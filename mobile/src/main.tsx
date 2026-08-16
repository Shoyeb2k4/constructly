import * as React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { MobileApp } from "./app";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

createRoot(container).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
);
