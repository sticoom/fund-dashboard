import { useEffect, useState } from "react";
import "./FxLoss.css";

/* ── Interfaces ── */

interface FxPair {
  from_sheet: string;
  to_sheet: string;
  from_amount: number;
  from_currency: string;
  from_rate: number;
  from_rmb: number;
  to_amount: number;
  to_currency: string;
  to_rate: number;
  to_rmb: number;
  loss: number;
  summary: string;
}

interface FxLossData {
  date: string;
  fx_loss?: {
    total_loss: number;
    has_loss: boolean;
    pairs: FxPair[];
  };
}

/* ── Formatters ── */

function fmtFull(v: number): string {
  return `¥${v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtLocal(v: number, currency: string): string {
  const symbols: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", CAD: "C$", JPY: "¥",
    HKD: "HK$", AUD: "A$", MXN: "MX$", SGD: "S$", CNY: "¥",
  };
  const sym = symbols[currency] || currency;
  return `${sym}${v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ── Component ── */

function FxLoss() {
  const [data, setData] = useState<FxLossData | null>(null);

  useEffect(() => {
    fetch("/data/verification.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d);
      })
      .catch(console.error);
  }, []);

  if (!data) return <div className="loading">请上传资金报表...</div>;

  const fl = data.fx_loss;
  const lossPairs = fl?.pairs.filter((p) => Math.abs(p.loss) > 0.5) ?? [];

  return (
    <div className="fxloss-page">
      <div className="fxloss-header">
        <h2>汇损明细</h2>
        <span className="date-badge">{data.date}</span>
      </div>

      <div className="fxloss-detail-card">
        {lossPairs.length === 0 ? (
          <div className="fxloss-no-data">本日无跨币种汇损</div>
        ) : (
          lossPairs.map((p, i) => {
            const isCrossCurrency = p.from_currency !== p.to_currency;
            const actualRate = isCrossCurrency && p.from_amount > 0
              ? p.to_rmb / p.from_amount
              : null;
            const rateDiff = actualRate !== null ? actualRate - p.from_rate : null;
            const lossPerUnit = p.from_amount > 0 ? p.loss / p.from_amount : 0;

            return (
              <div key={i} className="fxloss-pair-card">
                <div className="fxloss-pair-header">
                  <span className="fxloss-pair-route">
                    {p.from_sheet} → {p.to_sheet}
                  </span>
                  <span className={`fxloss-pair-loss ${p.loss < 0 ? "loss" : "gain"}`}>
                    {p.loss < 0 ? "汇损" : "汇益"}：{p.loss < 0 ? "−" : "+"}{fmtFull(Math.abs(p.loss))}
                  </span>
                </div>

                <div className="fxloss-pair-calc">
                  <div className="fxloss-calc-step">支出方按系统汇率折算</div>
                  <div className="fxloss-calc-row">
                    <span className="fxloss-calc-label">{p.from_sheet}</span>
                    <span className="fxloss-calc-expr">
                      {fmtLocal(p.from_amount, p.from_currency)} × {p.from_rate} = <strong>{fmtFull(p.from_rmb)}</strong>
                    </span>
                  </div>

                  <div className="fxloss-calc-step">收入方实际到账</div>
                  <div className="fxloss-calc-row">
                    <span className="fxloss-calc-label">{p.to_sheet}</span>
                    <span className="fxloss-calc-expr">
                      {fmtLocal(p.to_amount, p.to_currency)} × {p.to_rate} = <strong>{fmtFull(p.to_rmb)}</strong>
                    </span>
                  </div>

                  <div className="fxloss-calc-step">差额 = 到账 − 折算</div>
                  <div className="fxloss-calc-row result">
                    <span className="fxloss-calc-label">汇损</span>
                    <span className="fxloss-calc-expr">
                      {fmtFull(p.to_rmb)} − {fmtFull(p.from_rmb)} ={" "}
                      <span className={p.loss < 0 ? "loss" : "gain"}>
                        {p.loss < 0 ? "−" : "+"}{fmtFull(Math.abs(p.loss))}
                      </span>
                    </span>
                  </div>
                </div>

                {isCrossCurrency && actualRate !== null && (
                  <div className="fxloss-rate-compare">
                    <div className="fxloss-rate-title">汇率对比</div>
                    <div className="fxloss-rate-grid">
                      <div className="fxloss-rate-item">
                        <span className="fxloss-rate-key">系统汇率</span>
                        <span className="fxloss-rate-val">{p.from_rate.toFixed(4)}</span>
                      </div>
                      <div className="fxloss-rate-item">
                        <span className="fxloss-rate-key">实际汇率</span>
                        <span className="fxloss-rate-val">{actualRate.toFixed(4)}</span>
                        <span className="fxloss-rate-note">
                          （{fmtFull(p.to_rmb)} ÷ {fmtLocal(p.from_amount, p.from_currency).replace(/[^\d.]/g, "")}）
                        </span>
                      </div>
                      <div className="fxloss-rate-item">
                        <span className="fxloss-rate-key">汇率差</span>
                        <span className={`fxloss-rate-val ${rateDiff !== null && rateDiff < 0 ? "loss" : "gain"}`}>
                          {rateDiff !== null ? (rateDiff > 0 ? "+" : "") + rateDiff.toFixed(4) : "-"}
                        </span>
                      </div>
                      <div className="fxloss-rate-item">
                        <span className="fxloss-rate-key">每{p.from_currency}损益</span>
                        <span className={`fxloss-rate-val ${lossPerUnit < 0 ? "loss" : "gain"}`}>
                          {lossPerUnit < 0 ? "−" : "+"}¥{Math.abs(lossPerUnit).toFixed(4)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default FxLoss;
