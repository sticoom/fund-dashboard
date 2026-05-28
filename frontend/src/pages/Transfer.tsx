import { useEffect, useState } from "react";
import "./Transfer.css";

interface TransferTransaction {
  summary: string;
  category: string;
  income: number;
  expense: number;
  balance: number;
  is_transfer: boolean;
}

interface TransferSheet {
  sheet_name: string;
  currency: string;
  exchange_rate: number;
  transfer_income: number;
  transfer_expense: number;
  net: number;
  transactions: TransferTransaction[];
}

interface TransferSummary {
  total_income: number;
  total_expense: number;
  diff: number;
  balanced: boolean;
  sheets: TransferSheet[];
}

interface VerificationData {
  date: string;
  transfer_summary?: TransferSummary;
}

function fmtWan(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 10000) return `${sign}¥${(abs / 10000).toFixed(2)}万`;
  return `${sign}¥${abs.toFixed(2)}`;
}

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

function Transfer() {
  const [data, setData] = useState<VerificationData | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/verification.json")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  if (!data) return <div className="loading">请上传资金报表进行核对...</div>;

  const ts = data.transfer_summary;
  if (!ts) return <div className="loading">暂无往来数据...</div>;

  const incomeSheets = ts.sheets
    .filter((s) => s.transfer_income > 0.01)
    .sort((a, b) => b.net - a.net);
  const expenseSheets = ts.sheets
    .filter((s) => s.transfer_expense > 0.01)
    .sort((a, b) => a.net - b.net);

  return (
    <div className="transfer-page">
      <div className="transfer-header">
        <h2>往来核对</h2>
        <span className="date-badge">{data.date}</span>
      </div>

      {/* Level 1: Overview Card */}
      <div className={`transfer-overview ${ts.balanced ? "balanced" : "unbalanced"}`}>
        <div className="overview-row">
          <div className="overview-stat">
            <span className="stat-label">往来收入总额</span>
            <span className="stat-value income">{fmtFull(ts.total_income)}</span>
          </div>
          <div className="overview-divider" />
          <div className="overview-stat">
            <span className="stat-label">往来支出总额</span>
            <span className="stat-value expense">{fmtFull(ts.total_expense)}</span>
          </div>
          <div className="overview-divider" />
          <div className="overview-stat">
            <span className="stat-label">差额</span>
            <span className={`stat-value ${ts.balanced ? "" : "warn"}`}>
              {fmtFull(ts.diff)}
            </span>
          </div>
        </div>
        <div className="balance-status">
          {ts.balanced ? (
            <span className="balance-ok">
              <span className="balance-icon">✓</span> 收支平衡
            </span>
          ) : (
            <span className="balance-warn">
              <span className="balance-icon">⚠</span> 不平衡（差额 {fmtFull(Math.abs(ts.diff))}）
            </span>
          )}
          <span className="balance-hint">小额汇损属正常</span>
        </div>
      </div>

      {/* Level 2: Income Group */}
      {incomeSheets.length > 0 && (
        <div className="transfer-group">
          <div className="transfer-group-header income-group">
            <span className="group-icon-wrap income-icon">↓</span>
            <span className="group-title-text">往来收入</span>
            <span className="group-count">{incomeSheets.length} 个账户</span>
            <span className="group-subtotal">小计：{fmtFull(incomeSheets.reduce((s, sh) => s + sh.transfer_income, 0))}</span>
          </div>
          {incomeSheets.map((sh) => (
            <TransferAccountCard
              key={sh.sheet_name}
              sheet={sh}
              expanded={expanded === sh.sheet_name}
              onToggle={() => setExpanded(expanded === sh.sheet_name ? null : sh.sheet_name)}
            />
          ))}
        </div>
      )}

      {/* Level 2: Expense Group */}
      {expenseSheets.length > 0 && (
        <div className="transfer-group">
          <div className="transfer-group-header expense-group">
            <span className="group-icon-wrap expense-icon">↑</span>
            <span className="group-title-text">往来支出</span>
            <span className="group-count">{expenseSheets.length} 个账户</span>
            <span className="group-subtotal">小计：{fmtFull(expenseSheets.reduce((s, sh) => s + sh.transfer_expense, 0))}</span>
          </div>
          {expenseSheets.map((sh) => (
            <TransferAccountCard
              key={sh.sheet_name}
              sheet={sh}
              expanded={expanded === sh.sheet_name}
              onToggle={() => setExpanded(expanded === sh.sheet_name ? null : sh.sheet_name)}
            />
          ))}
        </div>
      )}

      {ts.sheets.length === 0 && (
        <div className="no-transfer">本日无往来交易</div>
      )}
    </div>
  );
}

function TransferAccountCard({
  sheet: sh,
  expanded,
  onToggle,
}: {
  sheet: TransferSheet;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isForeign = sh.currency !== "CNY";
  const isUnbalanced = Math.abs(sh.net) > 1.0;

  return (
    <div className={`transfer-card ${expanded ? "expanded" : ""} ${isUnbalanced ? "has-imbalance" : ""}`}>
      <div className="transfer-card-header" onClick={onToggle}>
        <div className="card-left">
          <span className="expand-arrow">{expanded ? "▾" : "▸"}</span>
          <span className="card-name">{sh.sheet_name}</span>
          {isForeign && <span className="fx-tag">含汇损</span>}
          {isUnbalanced && <span className="imbalance-tag">差额</span>}
        </div>
        <div className="card-right">
          <span className="card-cur">
            {sh.currency}
            {isForeign ? ` ×${sh.exchange_rate}` : ""}
          </span>
          {sh.transfer_income > 0.01 && (
            <span className="card-amt income">
              {fmtLocal(sh.transfer_income, sh.currency)}
              {isForeign && (
                <span className="rmb-convert"> → {fmtFull(sh.transfer_income * sh.exchange_rate)}</span>
              )}
            </span>
          )}
          {sh.transfer_expense > 0.01 && (
            <span className="card-amt expense">
              {fmtLocal(sh.transfer_expense, sh.currency)}
              {isForeign && (
                <span className="rmb-convert"> → {fmtFull(sh.transfer_expense * sh.exchange_rate)}</span>
              )}
            </span>
          )}
          <span className={`card-net ${sh.net >= 0 ? "income" : "expense"}`}>
            净: {fmtWan(sh.net)}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="transfer-card-body">
          <table className="txn-table">
            <thead>
              <tr>
                <th>摘要</th>
                <th>分类</th>
                <th>收入({sh.currency})</th>
                <th>支出({sh.currency})</th>
              </tr>
            </thead>
            <tbody>
              {sh.transactions.map((t, i) => (
                <tr key={i}>
                  <td className="txn-summary">{t.summary || "-"}</td>
                  <td>{t.category || "-"}</td>
                  <td className="num">{t.income > 0 ? fmtLocal(t.income, sh.currency) : "-"}</td>
                  <td className="num">{t.expense > 0 ? fmtLocal(t.expense, sh.currency) : "-"}</td>
                </tr>
              ))}
              {sh.transactions.length === 0 && (
                <tr>
                  <td colSpan={4} className="no-txn">无往来交易明细</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Transfer;
