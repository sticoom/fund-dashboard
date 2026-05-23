#!/usr/bin/env python3
"""Fund dashboard API server.

Upload encrypted Excel -> run verification -> serve JSON result.
No database, no historical data, no archiving.

Development:  python server.py          (API on :8000, Vite proxy)
Production:   python server.py --prod   (serve frontend/dist + API on :8000)
"""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

BACKEND_DIR = Path(__file__).parent
PROJECT_DIR = BACKEND_DIR.parent
# Docker: /app/frontend_dist; Local: backend/../frontend/dist
FRONTEND_DIST = Path("/app/frontend_dist") if (Path("/app/frontend_dist")).exists() else PROJECT_DIR / "frontend" / "dist"
DATA_DIR = PROJECT_DIR / "frontend" / "public" / "data"
DIST_DATA_DIR = FRONTEND_DIST / "data"
PORT = int(os.environ.get("PORT", 8000))

app = FastAPI(title="资金核对看板 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/upload")
async def upload_excel(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No filename provided")
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only .xlsx / .xls files accepted")

    suffix = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=BACKEND_DIR) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        from verify import verify
        result = verify(tmp_path, original_filename=file.filename)

        # Write JSON to both public/data (dev) and dist/data (prod)
        for d in [DATA_DIR, DIST_DATA_DIR]:
            d.mkdir(parents=True, exist_ok=True)
            with open(d / "verification.json", "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

        summary = result["summary"]
        return {
            "ok": True,
            "message": f"核对完成：{result['date']}",
            "date": result["date"],
            "summary": {
                "balance": summary["balance"],
                "income": summary["income"],
                "expense": summary["expense"],
                "net_flow": summary["net_flow"],
                "income_match": summary["income_match"],
                "expense_match": summary["expense_match"],
                "balance_match": summary["balance_match"],
                "issues_count": result["issues_count"],
            },
        }
    except Exception as e:
        raise HTTPException(500, f"核对失败：{e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.get("/api/status")
async def status():
    return {"ok": True, "message": "资金核对看板 API 运行中"}


def _mount_prod():
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    if not FRONTEND_DIST.exists():
        return

    # Mount static assets (js, css, images, data, etc.)
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    # SPA fallback: any non-API, non-file route → index.html
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Serve real files if they exist (data/, favicon, etc.)
        file_path = FRONTEND_DIST / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))
        # Everything else → index.html (SPA routing)
        return FileResponse(str(FRONTEND_DIST / "index.html"))


if __name__ == "__main__":
    import uvicorn
    prod_mode = "--prod" in sys.argv
    if prod_mode:
        _mount_prod()
        print(f"Production mode: {FRONTEND_DIST} + API on :{PORT}")
    else:
        print(f"Dev mode: API on :{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
