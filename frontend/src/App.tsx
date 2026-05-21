import { useRef, useState } from "react";
import Summary from "./pages/Summary";
import Detail from "./pages/Detail";
import "./App.css";

type Tab = "summary" | "detail";

function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setUploadMsg(`导入失败：${data.detail || "未知错误"}`);
      } else {
        setUploadMsg(`核对完成：${data.date}，发现 ${data.summary?.issues_count ?? 0} 个差异`);
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      setUploadMsg(`上传失败：${err}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">资金核对看板</h1>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-link ${tab === "summary" ? "active" : ""}`}
            onClick={() => setTab("summary")}
          >
            核对总表
          </button>
          <button
            className={`nav-link ${tab === "detail" ? "active" : ""}`}
            onClick={() => setTab("detail")}
          >
            详情
          </button>
        </nav>
        <div className="header-right">
          <button
            className="upload-btn"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? "核对中..." : "上传核对"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={handleUpload}
          />
          {uploadMsg && (
            <span className={`upload-msg ${uploadMsg.includes("核对完成") ? "success" : "error"}`}>
              {uploadMsg}
            </span>
          )}
        </div>
      </header>
      <main className="app-main">
        {tab === "summary" ? <Summary key={refreshKey} /> : <Detail key={refreshKey} />}
      </main>
    </div>
  );
}

export default App;
