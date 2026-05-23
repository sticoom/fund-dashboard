import { useEffect, useState } from "react";
import "./Summary.css";

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
  summary_name: string;
  currency: string;
  exchange_rate: number;
  local_income: number;
  local_expense: number;
  total_rmb_income: number;
  total_rmb_expense: number;
  rmb_income: number;
  rmb_expense: number;
  reported_income: number;
  reported_expense: number;
  reported_balance: number;
  reported_prev: number;
  income_ok: boolean;
  expense_ok: boolean;
  balance_ok: boolean;
  all_ok: boolean;
  real_income: number;
  real_expense: number;
  transfer_income: number;
  transfer_expense: number;
  transactions: Transaction[];
}

interface VerificationData {
  date: string;
  filename: string;
  summary: {
    prev_balance: number;
    balance: number;
    total_income: number;
    total_expense: number;
    income: number;
    expense: number;
    net_flow: number;
    transfer_income: number;
    transfer_expense: number;
    reported_income: number;
    reported_expense: number;
    reported_balance: number;
    income_match: boolean;
    expense_match: boolean;
    balance_match: boolean;
  };
  active_accounts: number;
  issues_count: number;
  sheets: SheetData[];
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

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? <span className="status-ok">✓</span> : <span className="status-fail">✗</span>;
}

type AccountType = "income" | "expense" | "mixed";

function classifyAccount(sh: SheetData): AccountType {
  const hasIncome = sh.local_income > 0.01;
  const hasExpense = sh.local_expense > 0.01;
  if (hasIncome && hasExpense) return "mixed";
  if (hasIncome) return "income";
  return "expense";
}

const GROUP_LABELS: Record<AccountType, { title: string; icon: string; desc: string }> = {
  income: { title: "本日收款", icon: "↓", desc: "资金流入账户" },
  expense: { title: "本日付款", icon: "↑", desc: "资金流出账户" },
  mixed: { title: "本日收支", icon: "↕", desc: "有收有支账户" },
};

function Summary() {
  const [data, setData] = useState<VerificationData | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(["income", "mixed", "expense"]));

  useEffect(() => {
    fetch(`/data/verification.json?t=${Date.now()}`)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  if (!data) return <div className="loading">请上传资金报表进行核对...</div>;

  const { summary: s, sheets } = data;
  const hasTransfer = s.transfer_income > 0.01 || s.transfer_expense > 0.01;

  // Group by type
  const groups: Record<AccountType, SheetData[]> = { income: [], expense: [], mixed: [] };
  for (const sh of sheets) {
    groups[classifyAccount(sh)].push(sh);
  }

  return (
    <div className="summary-page">
      <div className="summary-header">
        <h2>核对总表</h2>
        <span className="date-badge">{data.date}</span>
      </div>

      {/* Banner */}
      <div className="info-banner">
        <span className="banner-icon">i</span>
        <span>
          净收款/净付款已排除内部往来转账；验证核对基于含往来的完整收支。
        </span>
      </div>

      {/* Top KPI Bar - Real values (excluding transfers) */}
      <div className="kpi-row">
        <div className="kpi-chip">
          <span className="kpi-chip-label">期初余额</span>
          <span className="kpi-chip-value">{fmtWan(s.prev_balance)}</span>
        </div>
        <div className="kpi-chip income-chip">
          <span className="kpi-chip-label">本日净收款</span>
          <span className="kpi-chip-value">{fmtWan(s.income)}</span>
        </div>
        <div className="kpi-chip expense-chip">
          <span className="kpi-chip-label">本日净付款</span>
          <span className="kpi-chip-value">{fmtWan(s.expense)}</span>
        </div>
        {hasTransfer && (
          <div className="kpi-chip transfer-chip">
            <span className="kpi-chip-label">内部往来</span>
            <span className="kpi-chip-value" style={{ fontSize: "13px" }}>
              收 {fmtWan(s.transfer_income)} / 付 {fmtWan(s.transfer_expense)}
            </span>
          </div>
        )}
        <div className="kpi-chip">
          <span className="kpi-chip-label">期末余额</span>
          <span className="kpi-chip-value">{fmtWan(s.balance)}</span>
        </div>
      </div>

      {/* Verification Strip - uses TOTAL values (including transfers) */}
      <div className="verify-strip">
        <div className="verify-item">
          <StatusIcon ok={s.balance_match} />
          <span>余额: {fmtFull(s.prev_balance)} + {fmtFull(s.total_income ?? s.reported_income)} - {fmtFull(s.total_expense ?? s.reported_expense)} = {fmtFull(s.balance)}</span>
        </div>
        <div className="verify-item">
          <StatusIcon ok={s.income_match} />
          <span>收入核对</span>
        </div>
        <div className="verify-item">
          <StatusIcon ok={s.expense_match} />
          <span>支出核对</span>
        </div>
        {data.issues_count > 0 && (
          <div className="verify-item issue">
            <span>{data.issues_count} 个差异</span>
          </div>
        )}
      </div>

      {/* Grouped Sections */}
      {(["income", "mixed", "expense"] as AccountType[]).map((type) => {
        const group = groups[type];
        if (group.length === 0) return null;
        const label = GROUP_LABELS[type];
        const groupRmbIncome = group.reduce((sum, s) => sum + s.rmb_income, 0);
        const groupRmbExpense = group.reduce((sum, s) => sum + s.rmb_expense, 0);

        const isCollapsed = collapsedGroups.has(type);
        return (
          <div key={type} className={`account-group group-${type}`}>
            <div className="group-header" onClick={() => {
              setCollapsedGroups(prev => {
                const next = new Set(prev);
                if (next.has(type)) next.delete(type);
                else next.add(type);
                return next;
              });
            }}>
              <div className="group-title">
                <span className="group-icon">{label.icon}</span>
                <span>{label.title}</span>
                <span className="group-count">{group.length} 个账户</span>
                <span className="collapse-arrow">{isCollapsed ? "▸" : "▾"}</span>
              </div>
              <div className="group-totals">
                {groupRmbIncome > 0.01 && <span className="income">+{fmtWan(groupRmbIncome)}</span>}
                {groupRmbExpense > 0.01 && <span className="expense">-{fmtWan(groupRmbExpense)}</span>}
              </div>
            </div>

            {!isCollapsed && (
              <div>
                {group.map((sh) => (
                <AccountCard
                  key={sh.sheet_name}
                  sheet={sh}
                  expanded={expanded === sh.sheet_name}
                  onToggle={() => setExpanded(expanded === sh.sheet_name ? null : sh.sheet_name)}
                />
              ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AccountCard({ sheet: sh, expanded, onToggle }: { sheet: SheetData; expanded: boolean; onToggle: () => void }) {
  const isCNY = sh.currency === "CNY";
  const type = classifyAccount(sh);
  const typeLabel = type === "income" ? "收款" : type === "expense" ? "付款" : "收支";

  return (
    <div className={`account-card ${!sh.all_ok ? "has-issue" : ""} ${expanded ? "expanded" : ""}`}>
      <div className="account-card-header" onClick={onToggle}>
        <div className="card-left">
          <span className="expand-arrow">{expanded ? "▾" : "▸"}</span>
          <span className="type-dot" data-type={type}>{typeLabel}</span>
          <span className="card-name">{sh.sheet_name}</span>
          {!sh.all_ok && <span className="issue-tag">差异</span>}
        </div>
        <div className="card-right">
          <span className="card-cur">{sh.currency}{isCNY ? "" : ` ×${sh.exchange_rate}`}</span>
          {sh.real_income > 0.01 && <span className="card-amt income">{fmtLocal(sh.real_income, sh.currency)} → {fmtFull(sh.rmb_income)}</span>}
          {sh.real_expense > 0.01 && <span className="card-amt expense">{fmtLocal(sh.real_expense, sh.currency)} → {fmtFull(sh.rmb_expense)}</span>}
        </div>
      </div>

      {expanded && (
        <div className="account-card-body">
          <div className="body-summary">
            <div className="body-summary-item">
              <span className="label">期初</span>
              <span className="val">{fmtFull(sh.reported_prev)}</span>
            </div>
            <div className="body-summary-item">
              <span className="label">总收款</span>
              <span className="val">{fmtLocal(sh.local_income, sh.currency)}{!isCNY && ` → ${fmtFull(sh.total_rmb_income)}`}</span>
            </div>
            <div className="body-summary-item">
              <span className="label">总付款</span>
              <span className="val">{fmtLocal(sh.local_expense, sh.currency)}{!isCNY && ` → ${fmtFull(sh.total_rmb_expense)}`}</span>
            </div>
            {(sh.transfer_income > 0.01 || sh.transfer_expense > 0.01) && (
              <div className="body-summary-item">
                <span className="label">往来</span>
                <span className="val" style={{ color: "var(--text-secondary)" }}>
                  {fmtLocal(sh.transfer_income, sh.currency)} / {fmtLocal(sh.transfer_expense, sh.currency)}
                </span>
              </div>
            )}
            <div className="body-summary-item">
              <span className="label">期末</span>
              <span className="val">{fmtFull(sh.reported_balance)}</span>
            </div>
            <div className="body-summary-item">
              <span className="label">核对</span>
              <span className="val">
                <StatusIcon ok={sh.all_ok} />
              </span>
            </div>
          </div>

          <table className="txn-table">
            <thead>
              <tr>
                <th>摘要</th>
                <th>分类</th>
                <th>收入({sh.currency})</th>
                <th>支出({sh.currency})</th>
                <th>标记</th>
              </tr>
            </thead>
            <tbody>
              {sh.transactions.map((t, i) => (
                <tr key={i} className={t.is_transfer ? "transfer" : ""}>
                  <td className="txn-summary">{t.summary || "-"}</td>
                  <td>{t.category || "-"}</td>
                  <td className="num">{t.income > 0 ? fmtLocal(t.income, sh.currency) : "-"}</td>
                  <td className="num">{t.expense > 0 ? fmtLocal(t.expense, sh.currency) : "-"}</td>
                  <td>
                    {t.is_transfer
                      ? <span className="badge transfer-badge">往来</span>
                      : <span className="badge real-badge">实际</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Summary;
