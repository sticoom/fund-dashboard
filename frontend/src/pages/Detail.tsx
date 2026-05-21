import { useEffect, useState } from "react";
import "./Detail.css";

interface Transaction {
  summary: string;
  category: string;
  income: number;
  expense: number;
  balance: number;
  is_transfer: boolean;
}

interface SheetData {
  sheet_name: string;
  currency: string;
  exchange_rate: number;
  local_income: number;
  local_expense: number;
  rmb_income: number;
  rmb_expense: number;
  real_income: number;
  real_expense: number;
  transfer_income: number;
  transfer_expense: number;
  prev_balance: number;
  reported_income: number;
  reported_expense: number;
  reported_balance: number;
  all_ok: boolean;
  transactions: Transaction[];
}

interface VerificationData {
  date: string;
  rates: Record<string, number>;
  sheets: SheetData[];
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

function Detail() {
  const [data, setData] = useState<VerificationData | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hideTransfer, setHideTransfer] = useState(false);

  useEffect(() => {
    fetch("/data/verification.json")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  if (!data) return <div className="loading">请上传资金报表进行核对...</div>;

  const filtered = data.sheets.filter((sh) => {
    if (!search) return true;
    return sh.sheet_name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="detail-page">
      <div className="detail-header">
        <h2>收支详情</h2>
        <span className="date-badge">{data.date}</span>
      </div>

      <div className="detail-toolbar">
        <div className="filter-tabs">
          <button
            className={`filter-tab ${!hideTransfer ? "active" : ""}`}
            onClick={() => setHideTransfer(false)}
          >
            全部
          </button>
          <button
            className={`filter-tab ${hideTransfer ? "active" : ""}`}
            onClick={() => setHideTransfer(true)}
          >
            排除往来
          </button>
        </div>
        <input
          className="search-input"
          type="text"
          placeholder="搜索子表名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="detail-cards">
        {filtered.map((sh) => (
          <SheetCard
            key={sh.sheet_name}
            sheet={sh}
            expanded={expanded === sh.sheet_name}
            hideTransfer={hideTransfer}
            onToggle={() => setExpanded(expanded === sh.sheet_name ? null : sh.sheet_name)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="empty-msg">无匹配子表</div>
        )}
      </div>
    </div>
  );
}

function SheetCard({
  sheet: sh,
  expanded,
  hideTransfer,
  onToggle,
}: {
  sheet: SheetData;
  expanded: boolean;
  hideTransfer: boolean;
  onToggle: () => void;
}) {
  const isCNY = sh.currency === "CNY";
  const rateLabel = isCNY ? "" : ` (汇率: ${sh.exchange_rate})`;

  return (
    <div className={`detail-card ${!sh.all_ok ? "has-issue" : ""}`}>
      <div className="detail-card-header" onClick={onToggle} style={{ cursor: "pointer" }}>
        <div className="card-header-left">
          <span className="expand-icon">{expanded ? "▾" : "▸"}</span>
          <span className="card-account-name">{sh.sheet_name}</span>
          {!sh.all_ok && <span className="issue-badge">差异</span>}
          <span className="card-currency-tag">{sh.currency}{rateLabel}</span>
        </div>
        <div className="card-header-nums">
          <span className="card-num income">
            收 {fmtLocal(sh.local_income, sh.currency)}
            {!isCNY && <span className="card-rmb">={fmtFull(sh.rmb_income)}</span>}
          </span>
          <span className="card-sep">|</span>
          <span className="card-num expense">
            付 {fmtLocal(sh.local_expense, sh.currency)}
            {!isCNY && <span className="card-rmb">={fmtFull(sh.rmb_expense)}</span>}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="detail-card-body">
          <SheetSummary sheet={sh} />
          <CategoryGroups transactions={sh.transactions} currency={sh.currency} hideTransfer={hideTransfer} />
        </div>
      )}
    </div>
  );
}

function SheetSummary({ sheet: sh }: { sheet: SheetData }) {
  const isCNY = sh.currency === "CNY";
  return (
    <div className="sheet-summary">
      <div className="summary-item">
        <span className="summary-label">本币收入</span>
        <span className="summary-value">{fmtLocal(sh.local_income, sh.currency)}</span>
        {!isCNY && <span className="summary-rmb">= {fmtFull(sh.rmb_income)}</span>}
      </div>
      <div className="summary-item">
        <span className="summary-label">本币支出</span>
        <span className="summary-value">{fmtLocal(sh.local_expense, sh.currency)}</span>
        {!isCNY && <span className="summary-rmb">= {fmtFull(sh.rmb_expense)}</span>}
      </div>
      {(sh.transfer_income > 0.01 || sh.transfer_expense > 0.01) && (
        <div className="summary-item transfer-item">
          <span className="summary-label">往来</span>
          <span className="summary-value">
            {fmtLocal(sh.transfer_income, sh.currency)} / {fmtLocal(sh.transfer_expense, sh.currency)}
          </span>
        </div>
      )}
      <div className="summary-item">
        <span className="summary-label">实际</span>
        <span className="summary-value">
          {fmtLocal(sh.real_income, sh.currency)} / {fmtLocal(sh.real_expense, sh.currency)}
        </span>
      </div>
    </div>
  );
}

function CategoryGroups({
  transactions,
  currency,
  hideTransfer,
}: {
  transactions: Transaction[];
  currency: string;
  hideTransfer: boolean;
}) {
  const txns = hideTransfer ? transactions.filter((t) => !t.is_transfer) : transactions;

  const categoryMap = new Map<string, Transaction[]>();
  for (const t of txns) {
    const cat = t.category || "未分类";
    const existing = categoryMap.get(cat);
    if (existing) {
      existing.push(t);
    } else {
      categoryMap.set(cat, [t]);
    }
  }

  return (
    <div className="category-groups">
      {Array.from(categoryMap.entries()).map(([cat, txns]) => {
        const catIncome = txns.reduce((s, t) => s + t.income, 0);
        const catExpense = txns.reduce((s, t) => s + t.expense, 0);
        return (
          <div key={cat} className="category-group">
            <div className="category-header">
              <span>{cat}</span>
              <span className="category-total">
                {catIncome > 0.01 && <span className="income">+{fmtLocal(catIncome, currency)} </span>}
                {catExpense > 0.01 && <span className="expense">-{fmtLocal(catExpense, currency)}</span>}
              </span>
            </div>
            <table className="txn-table">
              <thead>
                <tr>
                  <th>摘要</th>
                  <th>收入</th>
                  <th>支出</th>
                  <th>标记</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t, i) => (
                  <tr key={i} className={t.is_transfer ? "transfer" : ""}>
                    <td>{t.summary || "-"}</td>
                    <td className="num">{t.income > 0 ? fmtLocal(t.income, currency) : "-"}</td>
                    <td className="num">{t.expense > 0 ? fmtLocal(t.expense, currency) : "-"}</td>
                    <td>
                      {t.is_transfer ? (
                        <span className="badge transfer-badge">往来</span>
                      ) : (
                        <span className="badge real-badge">实际</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export default Detail;
