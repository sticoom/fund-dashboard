interface KPICardProps {
  title: string;
  value: string;
  change?: string;
  changePct?: number;
  positive?: boolean;
}

function KPICard({ title, value, change, changePct, positive }: KPICardProps) {
  const changeColor = positive ? "var(--green)" : "var(--red)";
  const changeBg = positive ? "var(--green-light)" : "var(--red-light)";
  const arrow = positive ? "▲" : "▼";

  return (
    <div className="kpi-card">
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{value}</div>
      {change != null && changePct != null && (
        <div className="kpi-change" style={{ color: changeColor, background: changeBg }}>
          {arrow} {change} ({changePct > 0 ? "+" : ""}{changePct}%)
        </div>
      )}
    </div>
  );
}

export default KPICard;
