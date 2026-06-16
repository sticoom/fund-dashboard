import { useEffect, useState, Fragment } from "react";
import "./Summary.css";

/* ── Interfaces ── */

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
  real_income_rmb: number;
  real_expense_rmb: number;
  transfer_income: number;
  transfer_expense: number;
  transfer_income_rmb: number;
  transfer_expense_rmb: number;
  transactions: Transaction[];
}

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

interface UnmatchedEntry {
  direction: "income" | "expense";
  sheet: string;
  currency: string;
  rate: number;
  amount: number;
  rmb: number;
  summary: string;
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
    real_income: number;
    real_expense: number;
    real_net: number;
    transfer_income: number;
    transfer_expense: number;
    income_match: boolean;
    expense_match: boolean;
    balance_match: boolean;
  };
  active_accounts: number;
  issues_count: number;
  transfer_summary?: {
    total_income_rmb: number;
    total_expense_rmb: number;
    diff_rmb: number;
    balanced: boolean;
    sheets: {
      sheet_name: string;
      currency: string;
      exchange_rate: number;
      transfer_income: number;
      transfer_expense: number;
      transfer_income_rmb: number;
      transfer_expense_rmb: number;
      net: number;
      net_rmb: number;
      transactions: Transaction[];
    }[];
    categorized?: {
      balanced_pairs: FxPair[];
      fx_loss_pairs: FxPair[];
      unmatched: UnmatchedEntry[];
      unmatched_net_rmb: number;
      explained: boolean;
    };
  };
  fx_loss?: {
    total_loss: number;
    has_loss: boolean;
    pairs: FxPair[];
    unmatched: UnmatchedEntry[];
  };
  sheets: SheetData[];
}

/* ── Formatters ── */

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

/* ── Helpers ── */

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? <span className="status-ok">✓</span> : <span className="status-fail">✗</span>;
}

function uniqueByName<T extends { sheet_name: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const arr = map.get(item.sheet_name) || [];
    arr.push(item);
    map.set(item.sheet_name, arr);
  }
  return map;
}

/* ── Main Component ── */

function Summary() {
  const [data, setData] = useState<VerificationData | null>(null);

  // Level 2: banner expand
  const [banner1Open, setBanner1Open] = useState(false);
  const [banner2Open, setBanner2Open] = useState(false);

  // Level 3: three category sections (all collapsed by default)
  const [cat1Open, setCat1Open] = useState(false); // 已配平
  const [cat2Open, setCat2Open] = useState(false); // 已识别业务损耗
  const [cat3Open, setCat3Open] = useState(false); // 真正未匹配

  // Level 4: row expand
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [expandedPair, setExpandedPair] = useState<number | null>(null);

  useEffect(() => {
    fetch("/data/verification.json")
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((d) => {
        if (!d || !d.summary) return;
        setData(d);
      })
      .catch(console.error);
  }, []);

  if (!data) return <div className="loading">请上传资金报表进行核对...</div>;

  const { summary: s, sheets, transfer_summary: ts, fx_loss: fl } = data;

  // ── Banner 1 data: real (non-transfer) ──
  const totalRealIncome = s.real_income ?? 0;
  const totalRealExpense = s.real_expense ?? 0;
  const totalRealNet = s.real_net ?? 0;

  const realSheets = sheets.filter(
    (sh) => Math.abs(sh.real_income_rmb) > 0.01 || Math.abs(sh.real_expense_rmb) > 0.01
  );
  const realGrouped = Array.from(uniqueByName(realSheets));
  const totalIncomeRmb = realSheets.reduce((sum, sh) => sum + sh.real_income_rmb, 0);
  const totalExpenseRmb = realSheets.reduce((sum, sh) => sum + sh.real_expense_rmb, 0);

  // ── Banner 2 data: transfer ──
  const hasTransfer = !!(
    ts && (ts.total_income_rmb > 0.01 || ts.total_expense_rmb > 0.01)
  );

  // Three-category view (from backend categorized field)
  const cat = ts?.categorized;
  const fxTotalLoss = fl?.total_loss ?? 0;
  const residual = cat
    ? (ts?.diff_rmb ?? 0) - fxTotalLoss - cat.unmatched_net_rmb
    : 0;

  return (
    <div className="summary-page">
      {/* ═══ Header ═══ */}
      <div className="summary-header">
        <h2>核对总表</h2>
        <span className="date-badge">{data.date}</span>
      </div>

      {/* ═══ KPI Row ═══ */}
      <div className="kpi-row">
        <div className="kpi-chip">
          <span className="kpi-chip-label">期初余额</span>
          <span className="kpi-chip-value">{fmtWan(s.prev_balance)}</span>
        </div>
        <div className="kpi-chip income-chip">
          <span className="kpi-chip-label">本日净收款</span>
          <span className="kpi-chip-value">{fmtWan(s.real_income)}</span>
        </div>
        <div className="kpi-chip expense-chip">
          <span className="kpi-chip-label">本日净付款</span>
          <span className="kpi-chip-value">{fmtWan(s.real_expense)}</span>
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
        <div className="kpi-chip">
          <span className="kpi-chip-label">净流入</span>
          <span
            className="kpi-chip-value"
            style={{ color: s.net_flow >= 0 ? "var(--green)" : "var(--red)" }}
          >
            {s.net_flow >= 0 ? "+" : ""}
            {fmtWan(s.net_flow)}
          </span>
        </div>
      </div>

      {/* ═══ Verify Strip ═══ */}
      <div className="verify-strip">
        <div className="verify-item">
          <StatusIcon ok={s.balance_match} />
          <span>
            余额: {fmtFull(s.prev_balance)} + {fmtFull(s.income)} -{" "}
            {fmtFull(s.expense)} = {fmtFull(s.balance)}
          </span>
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

      {/* ═══ BANNER 1: 净收支 ═══ */}
      <div className="banner banner-real">
        {/* Level 1: clickable header with totals */}
        <div
          className="banner-l1"
          onClick={() => setBanner1Open(!banner1Open)}
        >
          <div className="banner-title-row">
            <div className="banner-title-bar">
              <span className="banner-label">净收支</span>
              <span className="banner-sub">排除往来</span>
            </div>
            <span className="banner-chevron">
              {banner1Open ? "▾" : "▸"}
            </span>
          </div>
          <div className="banner-totals">
            <div className="banner-total-item">
              <span className="bt-label">净收入</span>
              <span className="bt-value income">{fmtFull(totalRealIncome)}</span>
            </div>
            <div className="banner-divider" />
            <div className="banner-total-item">
              <span className="bt-label">净支出</span>
              <span className="bt-value expense">
                {fmtFull(totalRealExpense)}
              </span>
            </div>
            <div className="banner-divider" />
            <div className="banner-total-item">
              <span className="bt-label">差额</span>
              <span
                className={`bt-value ${totalRealNet >= 0 ? "income" : "expense"}`}
              >
                {totalRealNet >= 0 ? "+" : ""}
                {fmtWan(totalRealNet)}
              </span>
            </div>
          </div>
        </div>

        {/* Level 2: Account table */}
        {banner1Open && (
          <div className="banner-l2">
            <table className="s-table">
              <thead>
                <tr>
                  <th className="th-arrow"></th>
                  <th>账户</th>
                  <th>分类(笔数)</th>
                  <th className="th-num">收入(RMB)</th>
                  <th className="th-num">支出(RMB)</th>
                </tr>
              </thead>
              <tbody>
                {realGrouped.map(([name, sheetList]) => {
                  const isMerged = sheetList.length > 1;
                  const incomeRmb = sheetList.reduce(
                    (acc, sh) => acc + sh.real_income_rmb,
                    0
                  );
                  const expenseRmb = sheetList.reduce(
                    (acc, sh) => acc + sh.real_expense_rmb,
                    0
                  );
                  const allTxns = sheetList[0].transactions.filter(
                    (t) => !t.is_transfer
                  );
                  const cats = Array.from(
                    new Set(allTxns.map((t) => t.category).filter(Boolean))
                  );
                  const catLabel = cats.join("·") || "-";
                  const txnCount = allTxns.length;
                  const isExpanded = expandedAccount === name;
                  const currency = sheetList[0].currency;
                  const rate = sheetList[0].exchange_rate;
                  const isCNY = currency === "CNY";
                  const localIncome = !isCNY && rate > 0 ? incomeRmb / rate : 0;
                  const localExpense = !isCNY && rate > 0 ? expenseRmb / rate : 0;

                  return (
                    <Fragment key={name}>
                      <tr
                        className={`s-row-clickable ${isExpanded ? "s-row-active" : ""}`}
                        onClick={() =>
                          setExpandedAccount(isExpanded ? null : name)
                        }
                      >
                        <td className="td-arrow">
                          {isExpanded ? "▾" : "▸"}
                        </td>
                        <td>
                          <span className="account-name">{name}</span>
                          {isMerged && (
                            <span className="sub-badge">
                              {sheetList.length}个子账户
                            </span>
                          )}
                          {!sheetList[0].all_ok && (
                            <span className="issue-tag">差异</span>
                          )}
                        </td>
                        <td className="td-cat">
                          {catLabel}{" "}
                          <span className="txn-count">({txnCount}笔)</span>
                        </td>
                        <td className="td-num">
                          {Math.abs(incomeRmb) > 0.01 ? (
                            isCNY ? (
                              <span className="income">{fmtFull(incomeRmb)}</span>
                            ) : (
                              <>
                                {fmtLocal(localIncome, currency)}{" "}
                                <span className="rate-calc">× {rate}</span>
                                {" = "}{fmtFull(incomeRmb)}
                              </>
                            )
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="td-num">
                          {Math.abs(expenseRmb) > 0.01 ? (
                            isCNY ? (
                              <span className="expense">{fmtFull(expenseRmb)}</span>
                            ) : (
                              <>
                                {fmtLocal(localExpense, currency)}{" "}
                                <span className="rate-calc">× {rate}</span>
                                {" = "}{fmtFull(expenseRmb)}
                              </>
                            )
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>

                      {/* Level 3: Account detail */}
                      {isExpanded && (
                        <tr className="s-row-detail">
                          <td colSpan={5}>
                            <div className="detail-panel">
                              {isMerged ? (
                                /* Merged: show sub-account breakdown */
                                <table className="d-table">
                                  <thead>
                                    <tr>
                                      <th>子账户</th>
                                      <th className="th-num">
                                        收入(RMB)
                                      </th>
                                      <th className="th-num">
                                        支出(RMB)
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sheetList.map((sh, i) => (
                                      <tr key={i}>
                                        <td>{sh.summary_name}</td>
                                        <td className="td-num">
                                          {Math.abs(sh.reported_income) > 0.01
                                            ? fmtFull(sh.reported_income)
                                            : "-"}
                                        </td>
                                        <td className="td-num">
                                          {Math.abs(sh.reported_expense) > 0.01
                                            ? fmtFull(sh.reported_expense)
                                            : "-"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                /* Single: show transaction details */
                                <table className="d-table">
                                  <thead>
                                    <tr>
                                      <th>摘要</th>
                                      <th>分类</th>
                                      <th className="th-num">
                                        金额({currency})
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {allTxns.map((t, i) => (
                                      <tr key={i}>
                                        <td className="td-summary">
                                          {t.summary || "-"}
                                        </td>
                                        <td>{t.category || "-"}</td>
                                        <td
                                          className={`td-num ${Math.abs(t.income) > 0.01 ? "income" : "expense"}`}
                                        >
                                          {Math.abs(t.income) > 0.01
                                            ? fmtLocal(t.income, currency)
                                            : Math.abs(t.expense) > 0.01
                                            ? fmtLocal(t.expense, currency)
                                            : "-"}
                                        </td>
                                      </tr>
                                    ))}
                                    {allTxns.length === 0 && (
                                      <tr>
                                        <td
                                          colSpan={3}
                                          className="td-empty"
                                        >
                                          无交易明细
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {/* Total row */}
                <tr className="s-row-total">
                  <td></td>
                  <td>合计</td>
                  <td></td>
                  <td className="td-num">{fmtFull(totalIncomeRmb)}</td>
                  <td className="td-num">{fmtFull(totalExpenseRmb)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ BANNER 2: 往来 ═══ */}
      {hasTransfer && (
        <div
          className={`banner banner-transfer ${cat?.explained ? "balanced" : "unbalanced"}`}
        >
          {/* Level 1: clickable header with explanation line */}
          <div
            className="banner-l1"
            onClick={() => setBanner2Open(!banner2Open)}
          >
            <div className="banner-title-row">
              <div className="banner-title-bar">
                <span className="banner-label">往来</span>
                <span className="banner-sub">内部转账</span>
              </div>
              <span className="banner-chevron">
                {banner2Open ? "▾" : "▸"}
              </span>
            </div>
            <div className="explanation-line-container">
              {cat ? (
                cat.explained ? (
                  <div className="explanation-line ok">
                    ✓ 全部往来已解释 · 差额 {fmtFull(ts!.diff_rmb ?? 0)} ={" "}
                    汇损 {fmtFull(fxTotalLoss)}
                    {cat.unmatched_net_rmb !== 0 && (
                      <> + 未匹配净额 {fmtFull(cat.unmatched_net_rmb)}</>
                    )}
                  </div>
                ) : (
                  <div className="explanation-line warn">
                    ⚠ 差额 {fmtFull(ts!.diff_rmb ?? 0)} − 汇损 {fmtFull(fxTotalLoss)} −{" "}
                    未匹配 {fmtFull(cat.unmatched_net_rmb)} ={" "}
                    {fmtFull(residual)} 未解释
                  </div>
                )
              ) : (
                <div className="explanation-line warn">
                  ⚠ 差额 {fmtFull(ts!.diff_rmb ?? 0)}
                </div>
              )}
            </div>
          </div>

          {/* Level 2: three vertical category sections */}
          {banner2Open && (
            <div className="banner-l2">
              {cat ? (
                <>
                  {/* ─── Section 1: 已配平 ─── */}
                  <div
                    className={`cat-section cat-balanced ${cat1Open ? "expanded" : "collapsed"}`}
                  >
                    <div
                      className="cat-section-header"
                      onClick={() => setCat1Open(!cat1Open)}
                    >
                      <span className="cat-icon">🟢</span>
                      <span className="cat-title">已配平</span>
                      <span className="cat-meta">
                        {cat.balanced_pairs.length} 笔 · ¥0 损耗
                      </span>
                      <span className="cat-chevron">
                        {cat1Open ? "▾" : "▸"}
                      </span>
                    </div>
                    {cat1Open &&
                      (cat.balanced_pairs.length > 0 ? (
                        <table className="s-table cat-table">
                          <thead>
                            <tr>
                              <th>收入方</th>
                              <th className="th-num">收入金额</th>
                              <th>支出方</th>
                              <th className="th-num">支出金额</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cat.balanced_pairs.map((pair, idx) => (
                              <tr key={idx} className="s-row-static">
                                <td>{pair.to_sheet}</td>
                                <td className="td-num">
                                  {pair.to_currency !== "CNY" ? (
                                    <>
                                      {fmtLocal(pair.to_amount, pair.to_currency)}{" "}
                                      <span className="rate-calc">× {pair.to_rate}</span>
                                      {" = "}{fmtFull(pair.to_rmb)}
                                    </>
                                  ) : (
                                    fmtFull(pair.to_rmb)
                                  )}
                                </td>
                                <td>{pair.from_sheet}</td>
                                <td className="td-num">
                                  {pair.from_currency !== "CNY" ? (
                                    <>
                                      {fmtLocal(pair.from_amount, pair.from_currency)}{" "}
                                      <span className="rate-calc">× {pair.from_rate}</span>
                                      {" = "}{fmtFull(pair.from_rmb)}
                                    </>
                                  ) : (
                                    fmtFull(pair.from_rmb)
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="no-data">无已配平往来</div>
                      ))}
                  </div>

                  {/* ─── Section 2: 已识别业务损耗 ─── */}
                  <div
                    className={`cat-section cat-fx-loss ${cat2Open ? "expanded" : "collapsed"}`}
                  >
                    <div
                      className="cat-section-header"
                      onClick={() => setCat2Open(!cat2Open)}
                    >
                      <span className="cat-icon">🟠</span>
                      <span className="cat-title">已识别业务损耗</span>
                      <span className="cat-meta">
                        {cat.fx_loss_pairs.length} 笔汇损 · 合计{" "}
                        {fmtFull(fxTotalLoss)}
                      </span>
                      <span className="cat-chevron">
                        {cat2Open ? "▾" : "▸"}
                      </span>
                    </div>
                    {cat2Open &&
                      (cat.fx_loss_pairs.length > 0 ? (
                        <table className="s-table cat-table">
                          <thead>
                            <tr>
                              <th className="th-arrow"></th>
                              <th>收入方</th>
                              <th className="th-num">收入金额</th>
                              <th>支出方</th>
                              <th className="th-num">支出金额</th>
                              <th className="th-num">汇损</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cat.fx_loss_pairs.map((pair, idx) => {
                              const isExpanded = expandedPair === idx;
                              return (
                                <Fragment key={idx}>
                                  <tr
                                    className={`s-row-clickable s-row-fx ${isExpanded ? "s-row-active" : ""}`}
                                    onClick={() =>
                                      setExpandedPair(isExpanded ? null : idx)
                                    }
                                  >
                                    <td className="td-arrow">
                                      {isExpanded ? "▾" : "▸"}
                                    </td>
                                    <td>{pair.to_sheet}</td>
                                    <td className="td-num">
                                      {pair.to_currency !== "CNY" ? (
                                        <>
                                          {fmtLocal(pair.to_amount, pair.to_currency)}{" "}
                                          <span className="rate-calc">× {pair.to_rate}</span>
                                          {" = "}{fmtFull(pair.to_rmb)}
                                        </>
                                      ) : (
                                        fmtFull(pair.to_rmb)
                                      )}
                                    </td>
                                    <td>{pair.from_sheet}</td>
                                    <td className="td-num">
                                      {pair.from_currency !== "CNY" ? (
                                        <>
                                          {fmtLocal(pair.from_amount, pair.from_currency)}{" "}
                                          <span className="rate-calc">× {pair.from_rate}</span>
                                          {" = "}{fmtFull(pair.from_rmb)}
                                        </>
                                      ) : (
                                        fmtFull(pair.from_rmb)
                                      )}
                                    </td>
                                    <td className="td-num expense">
                                      {fmtFull(pair.loss)}
                                    </td>
                                  </tr>

                                  {/* Level 3: FX calculation detail */}
                                  {isExpanded && (
                                    <tr className="s-row-detail">
                                      <td colSpan={6}>
                                        <div className="detail-panel fx-detail">
                                          <div className="fx-calc-line">
                                            <span className="fx-label">支出方RMB</span>
                                            <span>
                                              {fmtLocal(pair.from_amount, pair.from_currency)}{" "}
                                              × {pair.from_rate} ={" "}
                                              <strong>{fmtFull(pair.from_rmb)}</strong>
                                            </span>
                                          </div>
                                          <div className="fx-calc-line">
                                            <span className="fx-label">收入方RMB</span>
                                            <span>
                                              {fmtLocal(pair.to_amount, pair.to_currency)}{" "}
                                              × {pair.to_rate} ={" "}
                                              <strong>{fmtFull(pair.to_rmb)}</strong>
                                            </span>
                                          </div>
                                          <div className="fx-calc-line fx-calc-result">
                                            <span className="fx-label">汇损</span>
                                            <span>
                                              {fmtFull(pair.to_rmb)} −{" "}
                                              {fmtFull(pair.from_rmb)} ={" "}
                                              <strong className="expense">
                                                {fmtFull(pair.loss)}
                                              </strong>
                                            </span>
                                          </div>
                                          <div className="fx-hint">
                                            📌 此为业务真实损耗（汇率波动），非数据错误
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}

                            {/* Total row */}
                            <tr className="s-row-total">
                              <td></td>
                              <td>合计</td>
                              <td className="td-num">
                                {fmtFull(
                                  cat.fx_loss_pairs.reduce((s, p) => s + p.to_rmb, 0)
                                )}
                              </td>
                              <td></td>
                              <td className="td-num">
                                {fmtFull(
                                  cat.fx_loss_pairs.reduce((s, p) => s + p.from_rmb, 0)
                                )}
                              </td>
                              <td className="td-num">
                                {fmtFull(fxTotalLoss)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      ) : (
                        <div className="no-data">无跨币种汇损</div>
                      ))}
                  </div>

                  {/* ─── Section 3: 真正未匹配 ─── */}
                  <div
                    className={`cat-section cat-unmatched ${cat.unmatched_net_rmb === 0 ? "zero" : "warn"} ${cat3Open ? "expanded" : "collapsed"}`}
                  >
                    <div
                      className="cat-section-header"
                      onClick={() => setCat3Open(!cat3Open)}
                    >
                      <span className="cat-icon">🔴</span>
                      <span className="cat-title">真正未匹配</span>
                      <span className="cat-meta">
                        {cat.unmatched.length} 笔 · 净额{" "}
                        {fmtFull(cat.unmatched_net_rmb)}
                      </span>
                      <span className="cat-chevron">
                        {cat3Open ? "▾" : "▸"}
                      </span>
                    </div>
                    {cat3Open &&
                      (cat.unmatched.length > 0 ? (
                        <>
                          <table className="s-table cat-table">
                            <thead>
                              <tr>
                                <th>方向</th>
                                <th>账户</th>
                                <th>摘要</th>
                                <th className="th-num">原币金额</th>
                                <th className="th-num">RMB 金额</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cat.unmatched.map((u, idx) => (
                                <tr key={idx} className="s-row-static">
                                  <td
                                    className={u.direction === "income" ? "income" : "expense"}
                                  >
                                    <strong>
                                      {u.direction === "income" ? "收入" : "支出"}
                                    </strong>
                                  </td>
                                  <td>{u.sheet}</td>
                                  <td className="td-summary">{u.summary || "-"}</td>
                                  <td className="td-num">
                                    {u.currency !== "CNY"
                                      ? fmtLocal(u.amount, u.currency)
                                      : fmtFull(u.amount)}
                                  </td>
                                  <td
                                    className={`td-num ${u.direction === "income" ? "income" : "expense"}`}
                                  >
                                    {u.direction === "income" ? "+" : "-"}
                                    {fmtFull(u.rmb)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="cat-hint">
                            {cat.unmatched_net_rmb === 0
                              ? `净额 ¥0.00 — 通常因对方账户不在本表内（如子公司招行户）`
                              : `⚠ 净额 ${fmtFull(cat.unmatched_net_rmb)} 无法解释，可能存在数据缺失`}
                          </div>
                        </>
                      ) : (
                        <div className="no-data">无未匹配往来</div>
                      ))}
                  </div>
                </>
              ) : (
                <div className="no-data">暂无分类数据，请重新上传文件</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Summary;
