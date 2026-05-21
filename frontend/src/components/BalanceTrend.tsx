import { useEffect, useRef } from "react";
import * as echarts from "echarts";

interface HistoryData {
  dates: string[];
  totalBalance: number[];
  realIncome: number[];
  realExpense: number[];
}

function BalanceTrend() {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current);

    fetch("/data/history.json")
      .then((r) => r.json())
      .then((data: HistoryData) => {
        const dates = data.dates.map((d) => d.slice(5));
        chart.setOption({
          title: { text: "总余额趋势", left: 0, textStyle: { fontSize: 15, fontWeight: 600 } },
          tooltip: {
            trigger: "axis",
            formatter: (params: unknown) => {
              const p = Array.isArray(params) ? params[0] : params;
              const d = p as { axisValue: string; value: number };
              return `${d.axisValue}<br/>余额: ¥${(d.value / 10000).toFixed(1)}万`;
            },
          },
          grid: { left: 60, right: 20, top: 40, bottom: 30 },
          xAxis: { type: "category", data: dates, boundaryGap: false },
          yAxis: {
            type: "value",
            axisLabel: {
              formatter: (v: number) => `${(v / 10000).toFixed(0)}万`,
            },
          },
          series: [
            {
              type: "line",
              data: data.totalBalance,
              smooth: true,
              symbol: "circle",
              symbolSize: 6,
              lineStyle: { width: 2, color: "#2563eb" },
              itemStyle: { color: "#2563eb" },
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: "rgba(37,99,235,0.15)" },
                  { offset: 1, color: "rgba(37,99,235,0.01)" },
                ]),
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

export default BalanceTrend;
