// 개요: 웹 앱 진입점 — 라우터를 붙이고 전체 레이아웃을 그린다.
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";

import TraceDetail from "./pages/TraceDetail.js";
import TraceList from "./pages/TraceList.js";
import "./styles.css";

function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <Link to="/" className="logo">FlowLens</Link>
        <span className="meta">실행 흐름 모니터링</span>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<TraceList />} />
          <Route path="/traces/:id" element={<TraceDetail />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
