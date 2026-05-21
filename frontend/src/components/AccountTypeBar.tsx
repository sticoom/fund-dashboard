import { useEffect, useRef } from "react";
import * as echarts from "echarts";

interface TypeItem {
  type: string;
  balance: number;
  display: string;
}

interface AccountsData {
  typeDistribution: TypeItem[];
}

function AccountTypeBar() {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current);

    fetch("/data/accounts.json")
      .then((r) => r.json())
      .then((data: AccountsData) => {
        const items = data.typeDistribution
          .filter((d) => d.balance > 0)
          .sort((a, b) => b.balance - a.balance);

        chart.setOption({
          title: { text: "账户类型分布", left: 0, textStyle: { fontSize: 15, fontWeight: 600 } },
          tooltip: {
            trigger: "axis",
            axisPointer: { type: "shadow" },
            formatter: (params: unknown) => {
              const p = Array.isArray(params) ? params[0] : params;
              const d = p as { name: string; value: number };
              return `${d.name}<br/>余额: ¥${(d.value / 10000).toFixed(1)}万`;
            },
          },
          grid: { left: 100, right: 40, top: 40, bottom: 20 },
          xAxis: {
            type: "value",
            axisLabel: {
              formatter: (v: number) => `${(v / 10000).toFixed(0)}万`,
            },
          },
          yAxis: { type: "category", data: items.map((i) => i.type) },
          series: [
            {
              type: "bar",
              data: items.map((i) => i.balance),
              barWidth: 20,
              itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                  { offset: 0, color: "#2563eb" },
                  { offset: 1, color: "#60a5fa" },
                ]),
                borderRadius: [0, 4, 4, 0],
              },
              label: {
                show: true,
                position: "right",
                formatter: (p: { value: number }) => `${(p.value / 10000).toFixed(1)}万`,
                fontSize: 12,
              },
            },
          ],
        });
      })
      .catch(console.error);

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
    };
  }, []);

  return <div ref={chartRef} style={{ width: "100%", height: 300 }} />;
}

export default AccountTypeBar;
