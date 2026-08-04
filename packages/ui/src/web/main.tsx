// 개요: 웹 앱 진입점 — 라우터를 붙이고 전체 레이아웃을 그린다.
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";

import EntitiesPage from "./pages/EntitiesPage.js";
import GraphPage from "./pages/GraphPage.js";
import TraceDetail from "./pages/TraceDetail.js";
import TraceList from "./pages/TraceList.js";
import "./styles.css";

const navStyle = ({ isActive }: { isActive: boolean }) => ({
  color: isActive ? "var(--accent)" : "var(--text-muted)",
  fontWeight: 600,
});

function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <Link to="/" className="logo">FlowLens</Link>
        <NavLink to="/" style={navStyle} end>트레이스</NavLink>
        <NavLink to="/graph" style={navStyle}>관계도</NavLink>
        <NavLink to="/entities" style={navStyle}>엔티티</NavLink>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<TraceList />} />
          <Route path="/traces/:id" element={<TraceDetail />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/entities" element={<EntitiesPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
