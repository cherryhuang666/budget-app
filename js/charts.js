// 图表渲染（基于 Chart.js）

// 中央标签插件（一次性注册）
const CenterLabelPlugin = {
  id: 'centerLabel',
  afterDatasetsDraw(chart, args, opts) {
    if (!opts || !opts.enabled) return;
    const { ctx, chartArea } = chart;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillText(opts.title || '合计', cx, cy - 14);
    ctx.fillStyle = '#1F2937';
    ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillText(opts.text || '', cx, cy + 8);
    ctx.restore();
  }
};

// 柱状图数值标签：每根柱子上方/下方显示结余金额
// 没有数据的月份（hasData[i]=false）不显示标签
const BarValueLabelsPlugin = {
  id: 'barValueLabels',
  afterDatasetsDraw(chart, args, opts) {
    if (!opts || !opts.enabled) return;
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;
    const values = chart.data.datasets[0].data || [];
    const hasData = opts.hasData || [];
    ctx.save();
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    meta.data.forEach((bar, i) => {
      if (hasData.length && !hasData[i]) return; // 没数据的月份留空
      const v = values[i] || 0;
      const text = (typeof opts.format === 'function') ? opts.format(v) : String(v);
      const x = bar.x;
      let y;
      if (v > 0) {
        y = bar.y - 4;
        ctx.fillStyle = '#5DAD83';
        ctx.textBaseline = 'bottom';
      } else if (v < 0) {
        // 标签贴在柱子顶端（0 基线上方）—— 避免和 x 轴标签重叠
        y = bar.base - 4;
        ctx.fillStyle = '#E76F51';
        ctx.textBaseline = 'bottom';
      } else {
        // 收入与支出相抵（有数据但结余为 0）：贴在 0 基线上方
        const zeroY = chart.scales.y.getPixelForValue(0);
        y = zeroY - 4;
        ctx.fillStyle = '#9CA3AF';
        ctx.textBaseline = 'bottom';
      }
      ctx.fillText(text, x, y);
    });
    ctx.restore();
  }
};

if (typeof Chart !== 'undefined') {
  Chart.register(CenterLabelPlugin);
  Chart.register(BarValueLabelsPlugin);
}

const Charts = {
  pie: null,
  bar: null,

  // ===== 月度分类饼图 =====
  // title: 中央上方那行文字（如 "合计支出" / "合计收入"），可选
  renderPie(canvas, breakdown, currency, title) {
    const data = breakdown.map(b => b.amount);
    const labels = breakdown.map(b => b.category);
    const colors = breakdown.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]);
    const total = data.reduce((s, n) => s + n, 0);

    if (this.pie) this.pie.destroy();
    if (data.length === 0 || total === 0) {
      this._renderEmpty(canvas, '本月还没有记录');
      return;
    }

    this.pie = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = ctx.parsed;
                const pct = total ? (v / total * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${formatAmount(v, currency)} (${pct}%)`;
              }
            },
            bodyFont: { size: 14 }
          },
          centerLabel: {
            enabled: true,
            title: title || '合计',
            text: formatAmountShort(total, currency)
          }
        }
      }
    });
  },

  _renderEmpty(canvas, msg) {
    if (this.pie) this.pie.destroy();
    const ctx = canvas.getContext('2d');
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;
    canvas.width = w * (window.devicePixelRatio || 1);
    canvas.height = h * (window.devicePixelRatio || 1);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, w / 2, h / 2);
  },

  // ===== 单地区 月度结余 柱状图 =====
  renderRegionBar(canvas, months, data, cfg) {
    if (this.bar) this.bar.destroy();
    const balances = months.map((_, i) => (data.income[i] || 0) - (data.expense[i] || 0));
    const positiveColor = 'rgba(93, 173, 131, 0.9)';   // 结余正：绿色
    const negativeColor = 'rgba(244, 162, 97, 0.9)';   // 结余负：暖橙色

    this.bar = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: months.map(m => formatBarMonthLabel(m)),
        datasets: [{
          label: `月度结余 ${cfg.symbol}`,
          data: balances,
          backgroundColor: balances.map(v => v >= 0 ? positiveColor : negativeColor),
          borderRadius: 4,
          maxBarThickness: 36
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 18, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => {
                const l = items[0].label;
                return Array.isArray(l) ? l.join('') : l;
              },
              label: ctx => {
                const i = ctx.dataIndex;
                const inc = data.income[i] || 0;
                const exp = data.expense[i] || 0;
                const bal = inc - exp;
                return [
                  ` 收入: ${formatAmount(inc, cfg.symbol)}`,
                  ` 支出: ${formatAmount(exp, cfg.symbol)}`,
                  ` 结余: ${bal >= 0 ? '+' : ''}${formatAmount(bal, cfg.symbol)}`
                ];
              }
            }
          },
          barValueLabels: {
            enabled: months.length <= 12, // 月份太多就不显示数值标签，避免拥挤
            format: v => formatAxisInt(v),
            hasData: months.map((_, i) => (data.income[i] || 0) > 0 || (data.expense[i] || 0) > 0)
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          },
          y: {
            grid: { color: '#F1E9E5' },
            ticks: {
              callback: v => formatAxisInt(v)
            }
          }
        }
      }
    });
  }
};

// y 轴标签统一用「万」为单位
// 例：0 → "0"  ·  5000 → "0.5万"  ·  10000 → "1万"  ·  25000 → "2.5万"  ·  100000 → "10万"
function formatAxisInt(num) {
  if (num === 0) return '0';
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  const wan = abs / 10000;
  let str;
  if (wan >= 10) {
    // ≥ 10 万：直接取整，带千分位（10 万 / 100 万 / 1,000 万）
    str = Math.round(wan).toLocaleString('zh-CN');
  } else {
    // < 10 万：保留 1 位小数，干掉 .0
    str = (Math.round(wan * 10) / 10).toString();
    if (str.endsWith('.0')) str = str.slice(0, -2);
  }
  return sign + str + '万';
}
