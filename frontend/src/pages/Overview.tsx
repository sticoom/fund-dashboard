import { useEffect, useState } from "react";
import KPICard from "../components/KPICard";
import "../components/KPICard.css";
import "./Overview.css";

interface KpiData {
  totalBalance: number;
  totalBalanceDisplay: string;
  balanceChange: number;
  balanceChangeDisplay: string;
  balanceChangePct: number;
  dailyNet: number;
  dailyNetDisplay: string;
  realIncome: number;
  realIncomeDisplay: string;
  realExpense: number;
  realExpenseDisplay: string;
  transferIn: number;
  transferOut: number;
}

interface LatestData {
  date: string;
  kpi: KpiData;
}

interface AccountSnapshot {
  account_name: string;
  balance_rmb: number;
  balanceDisplay: string;
  daily_income: number;
  daily_expense: number;
  real_income: number;
  real_expense: number;
  realIncomeDisplay: string;
  realExpenseDisplay: string;
  netChange: number;
  netChangeDisplay: string;
}

interface AccountsData {
  date: string;
  accounts: AccountSnapshot[];
}

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
}

interface TransactionsData {
  transactions: Transaction[];
  accounts: string[];
  dates: string[];
}

function fmtWan(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 10000) {
    return `${sign}¥${(abs / 10000).toFixed(1)}万`;
  }
  return `${sign}¥${abs.toFixed(1)}`;
}

function Overview() {
  const [latestData, setLatestData] = useState<LatestData | null>(null);
  const [accountsData, setAccountsData] = useState<AccountsData | null>(null);
  const [transactionsData, setTransactionsData] =
    useState<TransactionsData | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/data/latest.json")
      .then((r) => r.json())
      .then(setLatestData)
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetch("/data/accounts.json")
      .then((r) => r.json())
      .then(setAccountsData)
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetch("/data/transactions.json")
      .then((r) => r.json())
      .then(setTransactionsData)
      .catch(console.error);
  }, []);

  if (!latestData || !accountsData) return <div className="loading">加载中...</div>;

  const { kpi, date: latestDate } = latestData;
  const netPositive = kpi.dailyNet >= 0;

  // Filter accounts by search
  const filteredAccounts = accountsData.accounts.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.account_name.toLowerCase().includes(q);
  });

  // Build transaction map for the latest date
  const txnByAccount = new Map<string, Transaction[]>();
  if (transactionsData) {
    for (const t of transactionsData.transactions) {
      if (t.date === latestDate) {
        const existing = txnByAccount.get(t.account_name);
        if (existing) {
          existing.push(t);
        } else {
          txnByAccount.set(t.account_name, [t]);
        }
      }
    }
  }

  return (
    <div className="overview">
      <div className="overview-header">
        <h2>总览看板</h2>
        <span className="date-badge">{latestDate}</span>
      </div>

      <div className="kpi-grid">
        <KPICard
          title="总余额"
          value={kpi.totalBalanceDisplay}
          change={kpi.balanceChangeDisplay}
          changePct={kpi.balanceChangePct}
          positive={kpi.balanceChange >= 0}
        />
        <KPICard
          title="日净变动"
          value={kpi.dailyNetDisplay}
          positive={netPositive}
        />
        <KPICard
          title="日实际收入"
          value={kpi.realIncomeDisplay}
          positive
        />
        <KPICard
          title="日实际支出"
          value={kpi.realExpenseDisplay}
          positive={kpi.realExpense <= 0}
        />
      </div>

      {/* Transfer info */}
      <div className="transfer-card">
        <div className="transfer-info">
          <div className="transfer-row">
            <span>往来收入</span>
            <span className="transfer-value gray">
              {fmtWan(kpi.transferIn)}
            </span>
          </div>
          <div className="transfer-row">
            <span>往来支出</span>
            <span className="transfer-value gray">
              {fmtWan(kpi.transferOut)}
            </span>
          </div>
          <div className="transfer-divider" />
          <div className="transfer-row">
            <span>往来净额</span>
            <span className="transfer-value">
              {fmtWan(kpi.transferIn - kpi.transferOut)}
            </span>
          </div>
          <p className="transfer-note">
            内部往来（账户间调拨、结汇）已从实际收支中排除
          </p>
        </div>
      </div>

      {/* Account details section */}
      <div className="accounts-section">
        <div className="accounts-section-header">
          <h3>账户明细</h3>
          <input
            className="search-input"
            type="text"
            placeholder="搜索账户..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="accounts-table-wrap">
          <table className="accounts-table">
            <thead>
              <tr>
                <th>账户名</th>
                <th>本日余额(RMB)</th>
                <th>本日收款</th>
                <th>本日付款</th>
                <th>实际收入</th>
                <th>实际支出</th>
                <th>净变动</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((acct) => {
                const txns = txnByAccount.get(acct.account_name) || [];
                const isExpanded = expanded === acct.account_name;
                const netPositive = acct.netChange >= 0;

                return (
                  <AccountRow
                    key={acct.account_name}
                    account={acct}
                    transactions={txns}
                    expanded={isExpanded}
                    netPositive={netPositive}
                    onToggle={() =>
                      setExpanded(isExpanded ? null : acct.account_name)
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AccountRow({
  account,
  transactions,
  expanded,
  netPositive,
  onToggle,
}: {
  account: AccountSnapshot;
  transactions: Transaction[];
  expanded: boolean;
  netPositive: boolean;
  onToggle: () => void;
}) {
  const hasTxns = transactions.length > 0;

  return (
    <>
      <tr
        className="account-row"
        onClick={onToggle}
        style={{ cursor: hasTxns ? "pointer" : "default" }}
      >
        <td className="account-name">
          {hasTxns && (
            <span className="expand-icon">{expanded ? "▾" : "▸"}</span>
          )}
          {account.account_name}
        </td>
        <td className="num">{account.balanceDisplay}</td>
        <td className="num">
          {account.daily_income > 0.01 ? fmtWan(account.daily_income) : "-"}
        </td>
        <td className="num">
          {account.daily_expense > 0.01 ? fmtWan(account.daily_expense) : "-"}
        </td>
        <td className="num income">
          {account.real_income > 0.01 ? fmtWan(account.real_income) : "-"}
        </td>
        <td className="num expense">
          {account.real_expense > 0.01 ? fmtWan(account.real_expense) : "-"}
        </td>
        <td
          className="num"
          style={{ color: netPositive ? "var(--green)" : "var(--red)" }}
        >
          {Math.abs(account.netChange) > 0.01
            ? (netPositive ? "+" : "") + account.netChangeDisplay
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
                    <th>摘要</th>
                    <th>分类</th>
                    <th>收入</th>
                    <th>支出</th>
                    <th>标记</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr
                      key={t.id}
                      className={t.is_transfer ? "transfer" : ""}
                    >
                      <td>{t.summary || "-"}</td>
                      <td>{t.category || "-"}</td>
                      <td className="num">
                        {t.income > 0 ? fmtWan(t.income) : "-"}
                      </td>
                      <td className="num">
                        {t.expense > 0 ? fmtWan(t.expense) : "-"}
                      </td>
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
          </td>
        </tr>
      )}
    </>
  );
}

export default Overview;
