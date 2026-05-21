import { useEffect, useState } from "react";
import "./Accounts.css";

interface Transaction {
  id: number;
  date: string;
  account_name: string;
  currency: string;
  account_type: string;
  summary: string;
  category: string;
  income: number;
  expense: number;
  balance: number;
  is_transfer: number;
  counterparty_account: string | null;
}

interface TransactionsData {
  transactions: Transaction[];
  categories: string[];
  accounts: string[];
  dates: string[];
  dailySummaries: Record<
    string,
    {
      real_income: number;
      real_expense: number;
      transfer_in: number;
      transfer_out: number;
    }
  >;
}

interface AccountGroup {
  account_name: string;
  currency: string;
  account_type: string;
  balance_rmb: number;
  daily_income: number;
  daily_expense: number;
  net_change: number;
  transactions: Transaction[];
}

function fmtWan(value: number): string {
  if (Math.abs(value) >= 10000) {
    return `¥${(value / 10000).toFixed(1)}万`;
  }
  return `¥${value.toFixed(2)}`;
}

function fmtAmount(value: number): string {
  if (value <= 0) return "-";
  if (value >= 10000) {
    return `¥${(value / 10000).toFixed(1)}万`;
  }
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type TypeFilter = "全部" | "实际收支" | "往来";

function Accounts() {
  const [data, setData] = useState<TransactionsData | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("全部");

  useEffect(() => {
    fetch("/data/transactions.json")
      .then((r) => r.json())
      .then((raw: TransactionsData) => {
        setData(raw);
        if (raw.dates.length > 0) {
          const lastDate = raw.dates[raw.dates.length - 1];
          setStartDate(lastDate);
          setEndDate(lastDate);
        }
      })
      .catch(console.error);
  }, []);

  if (!data) return <div className="loading">加载中...</div>;

  const currencies = [
    "all",
    ...new Set(data.transactions.map((t) => t.currency)),
  ];

  // Apply all filters
  const filtered = data.transactions.filter((t) => {
    if (startDate && t.date < startDate) return false;
    if (endDate && t.date > endDate) return false;
    if (categoryFilter && t.category !== categoryFilter) return false;
    if (typeFilter === "实际收支" && t.is_transfer !== 0) return false;
    if (typeFilter === "往来" && t.is_transfer !== 1) return false;
    if (currencyFilter !== "all" && t.currency !== currencyFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchesAccount = t.account_name.toLowerCase().includes(q);
      const matchesCounterparty =
        t.counterparty_account !== null &&
        t.counterparty_account.toLowerCase().includes(q);
      if (!matchesAccount && !matchesCounterparty) return false;
    }
    return true;
  });

  // Group by account_name
  const groupMap = new Map<string, Transaction[]>();
  for (const t of filtered) {
    const existing = groupMap.get(t.account_name);
    if (existing) {
      existing.push(t);
    } else {
      groupMap.set(t.account_name, [t]);
    }
  }

  const accountGroups: AccountGroup[] = [];
  for (const [accountName, txns] of groupMap) {
    const first = txns[0];
    const daily_income = txns.reduce((sum, t) => sum + t.income, 0);
    const daily_expense = txns.reduce((sum, t) => sum + t.expense, 0);
    accountGroups.push({
      account_name: accountName,
      currency: first.currency,
      account_type: first.account_type,
      balance_rmb: daily_income - daily_expense,
      daily_income,
      daily_expense,
      net_change: daily_income - daily_expense,
      transactions: txns,
    });
  }

  // Sort accounts by balance descending
  accountGroups.sort((a, b) => Math.abs(b.net_change) - Math.abs(a.net_change));

  return (
    <div className="accounts-page">
      <div className="accounts-header">
        <h2>账户明细</h2>
        <span className="date-badge">
          {startDate && endDate ? `${startDate} ~ ${endDate}` : ""}
        </span>
      </div>

      {/* Filter row: date range + category + type */}
      <div className="accounts-filters">
        <input
          className="date-input"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <span className="filter-separator">~</span>
        <input
          className="date-input"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <select
          className="filter-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">全部分类</option>
          {data.categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <div className="filter-tabs">
          {(["全部", "实际收支", "往来"] as TypeFilter[]).map((tf) => (
            <button
              key={tf}
              className={`filter-tab ${typeFilter === tf ? "active" : ""}`}
              onClick={() => setTypeFilter(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Currency tabs + search */}
      <div className="accounts-toolbar">
        <div className="filter-tabs">
          {currencies.map((c) => (
            <button
              key={c}
              className={`filter-tab ${currencyFilter === c ? "active" : ""}`}
              onClick={() => setCurrencyFilter(c)}
            >
              {c === "all" ? "全部" : c}
            </button>
          ))}
        </div>
        <input
          className="search-input"
          type="text"
          placeholder="搜索账户/对方账户..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="accounts-table-wrap">
        <table className="accounts-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>账户名</th>
              <th>币种</th>
              <th>余额(RMB)</th>
              <th>收入</th>
              <th>支出</th>
              <th>净变动</th>
            </tr>
          </thead>
          <tbody>
            {accountGroups.map((group) => (
              <AccountRow
                key={group.account_name}
                group={group}
                expanded={expanded === group.account_name}
                onToggle={() =>
                  setExpanded(
                    expanded === group.account_name
                      ? null
                      : group.account_name
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountRow({
  group,
  expanded,
  onToggle,
}: {
  group: AccountGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const netPositive = group.net_change >= 0;
  const hasTxns = group.transactions.length > 0;

  return (
    <>
      <tr
        className="account-row"
        onClick={onToggle}
        style={{ cursor: hasTxns ? "pointer" : "default" }}
      >
        <td>
          <span className="type-badge">{group.account_type}</span>
        </td>
        <td className="account-name">
          {hasTxns && (
            <span className="expand-icon">{expanded ? "▾" : "▸"}</span>
          )}
          {group.account_name}
        </td>
        <td>{group.currency}</td>
        <td className="num">{fmtWan(group.balance_rmb)}</td>
        <td className="num income">
          {group.daily_income > 0 ? fmtWan(group.daily_income) : "-"}
        </td>
        <td className="num expense">
          {group.daily_expense > 0 ? fmtWan(group.daily_expense) : "-"}
        </td>
        <td
          className="num"
          style={{ color: netPositive ? "var(--green)" : "var(--red)" }}
        >
          {group.net_change !== 0
            ? (netPositive ? "+" : "") + fmtWan(group.net_change)
            : "-"}
        </td>
      </tr>
      {expanded && hasTxns && (
        <tr className="txn-row">
          <td colSpan={7}>
            <div className="txn-detail">
              <table className="txn-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>摘要</th>
                    <th>分类</th>
                    <th>收入</th>
                    <th>支出</th>
                    <th>标记</th>
                    <th>对方账户</th>
                  </tr>
                </thead>
                <tbody>
                  {group.transactions.map((t) => (
                    <tr
                      key={t.id}
                      className={t.is_transfer ? "transfer" : ""}
                    >
                      <td>{t.date}</td>
                      <td>
                        {t.summary || "-"}
                        {t.counterparty_account && (
                          <span className="counterparty">
                            {t.counterparty_account}
                          </span>
                        )}
                      </td>
                      <td>{t.category || "-"}</td>
                      <td className="num">
                        {t.income > 0 ? fmtAmount(t.income) : "-"}
                      </td>
                      <td className="num">
                        {t.expense > 0 ? fmtAmount(t.expense) : "-"}
                      </td>
                      <td>
                        {t.is_transfer ? (
                          <span className="badge transfer-badge">往来</span>
                        ) : (
                          <span className="badge real-badge">实际</span>
                        )}
                      </td>
                      <td>{t.counterparty_account || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default Accounts;
