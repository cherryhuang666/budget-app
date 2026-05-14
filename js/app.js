// 主应用逻辑

const App = {
  state: {
    currentView: 'view-home',
    // 各页面的"当前月份"独立
    monthByView: {
      home: currentMonth(),
      mainland: currentMonth(),
      taiwan: currentMonth()
    },
    chartRegion: 'mainland',
    chartType: 'expense',
    openCategory: null, // 在饼图明细中展开的类别
    barRangeMonths: 6,  // 收支对比图覆盖的月数；'max' = 全部历史
    barRegion: 'mainland' // 收支对比图当前显示哪个地区
  },

  async init() {
    await DB.open();
    await this.restoreSettings();
    this.bindEvents();
    this.switchView('view-home');
    await this.refreshAll();
    this._syncBackToCurrent();
    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(err =>
        console.warn('Service Worker 注册失败:', err)
      );
    }
    // 异步初始化云端：显示状态，并在启动时拉一次远端最新数据
    Cloud.init().then(async (ok) => {
      const el = document.getElementById('cloud-status-label');
      if (el) el.textContent = await Cloud.statusLabel();
      if (ok) Cloud.scheduleAutoSync(800);
    });
  },

  async restoreSettings() {
    const scale = (await DB.getMeta('fontScale')) || '1';
    document.documentElement.style.setProperty('--font-scale', scale);
    document.querySelectorAll('#font-size-options .chip').forEach(c => {
      c.classList.toggle('active', c.dataset.scale === scale);
    });
    const labelMap = { '0.9': '小', '1': '中', '1.15': '大', '1.3': '特大' };
    document.getElementById('font-size-cur').textContent = labelMap[scale] || '中';
  },

  bindEvents() {
    // 底部导航
    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => this.switchView(t.dataset.view));
    });

    // 月份切换（首页）
    document.getElementById('home-prev-month').addEventListener('click', () => this.shiftHomeMonth(-1));
    document.getElementById('home-next-month').addEventListener('click', () => this.shiftHomeMonth(1));

    // 月份切换（大陆/台湾）
    document.querySelectorAll('.month-prev').forEach(b => {
      b.addEventListener('click', () => this.shiftRegionMonth(b.dataset.region, -1));
    });
    document.querySelectorAll('.month-next').forEach(b => {
      b.addEventListener('click', () => this.shiftRegionMonth(b.dataset.region, 1));
    });

    // 月份快速跳转：点击月份文字弹出 input[type=month] 选年月
    document.querySelectorAll('[data-month-picker]').forEach(wrap => {
      const view = wrap.dataset.monthPicker; // home | mainland | taiwan
      const input = wrap.querySelector('.month-hidden-input');
      input.value = this.state.monthByView[view];
      wrap.addEventListener('click', () => this._openMonthPicker(input));
      input.addEventListener('change', () => {
        const v = input.value; // YYYY-MM
        if (!v) return;
        this.state.monthByView[view] = v;
        if (view === 'home') this.refreshHome();
        else this.refreshRegion(view);
        this._syncBackToCurrent();
      });
    });

    // 回到本月按钮
    document.querySelectorAll('.back-to-current').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.state.monthByView[view] = currentMonth();
        if (view === 'home') this.refreshHome();
        else this.refreshRegion(view);
        this._syncBackToCurrent();
      });
    });

    // 收支对比 地区切换
    document.getElementById('bar-region-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.chart-tab');
      if (!btn) return;
      this.state.barRegion = btn.dataset.region;
      document.querySelectorAll('#bar-region-tabs .chart-tab').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      this.refreshHomeBar();
    });

    // 收支对比 时间范围
    document.getElementById('bar-range-bar').addEventListener('click', e => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      const v = btn.dataset.range;
      this.state.barRangeMonths = v === 'max' ? 'max' : parseInt(v, 10);
      document.querySelectorAll('#bar-range-bar .chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      this.refreshHomeBar();
    });

    // 图表 region/type 切换
    document.getElementById('chart-region-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.chart-tab');
      if (!btn) return;
      this.state.chartRegion = btn.dataset.region;
      this.state.openCategory = null;
      this._updateChartTabs();
      this.refreshHomePieAndList();
    });
    document.getElementById('chart-type-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.chart-tab');
      if (!btn) return;
      this.state.chartType = btn.dataset.type;
      this.state.openCategory = null;
      this._updateChartTabs();
      this.refreshHomePieAndList();
    });

    // 打开记账（大陆/台湾按钮 + 顶部 ＋）
    document.querySelectorAll('[data-open-record]').forEach(b => {
      b.addEventListener('click', () => this.openRecordSheet(b.dataset.openRecord));
    });
    document.getElementById('btn-quick-add').addEventListener('click', () => {
      const region = this.state.currentView === 'view-taiwan' ? 'taiwan' : 'mainland';
      this.openRecordSheet(region);
    });

    // 字体大小
    document.getElementById('font-size-options').addEventListener('click', async e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const scale = chip.dataset.scale;
      document.documentElement.style.setProperty('--font-scale', scale);
      document.querySelectorAll('#font-size-options .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const labelMap = { '0.9': '小', '1': '中', '1.15': '大', '1.3': '特大' };
      document.getElementById('font-size-cur').textContent = labelMap[scale] || '中';
      await DB.setMeta('fontScale', scale);
    });

    // 设置项动作
    document.querySelectorAll('[data-action]').forEach(row => {
      row.addEventListener('click', e => this.handleSettingAction(row));
    });

    // 数据导入
    document.getElementById('file-import').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) await Exporter.importJSON(file);
      e.target.value = '';
    });
    document.getElementById('file-import-xlsx').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) await Exporter.importExcel(file);
      e.target.value = '';
    });

    // 同步拉下来的远端变更 → 只刷新 UI（避免循环触发自动同步）
    document.addEventListener('data-changed', () => this.refreshAll());

    // 本地写入 → 调度一次自动同步
    document.addEventListener('db-mutation', () => Cloud.scheduleAutoSync());

    // 切回标签页 / 唤醒手机时，自动拉一次远端变更
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) Cloud.scheduleAutoSync(300);
    });
    window.addEventListener('online', () => Cloud.scheduleAutoSync(500));
  },

  _updateChartTabs() {
    document.querySelectorAll('#chart-region-tabs .chart-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.region === this.state.chartRegion);
    });
    document.querySelectorAll('#chart-type-tabs .chart-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.type === this.state.chartType);
    });
    const regionName = this.state.chartRegion === 'mainland' ? '大陆' : '台湾';
    const typeName = this.state.chartType === 'expense' ? '支出' : '收入';
    document.getElementById('chart-region-label').textContent = `${regionName} · ${typeName}`;
  },

  switchView(viewId) {
    this.state.currentView = viewId;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === viewId));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === viewId));
    window.scrollTo({ top: 0 });
    if (viewId === 'view-settings') {
      Cloud.statusLabel().then(s => {
        document.getElementById('cloud-status-label').textContent = s;
      });
    }
  },

  shiftHomeMonth(delta) {
    this.state.monthByView.home = shiftMonth(this.state.monthByView.home, delta);
    this.state.openCategory = null;
    this.refreshHome();
    this._syncBackToCurrent();
  },

  shiftRegionMonth(region, delta) {
    this.state.monthByView[region] = shiftMonth(this.state.monthByView[region], delta);
    this.refreshRegion(region);
    this._syncBackToCurrent();
  },

  // 主动弹出原生年月选择器（iOS Safari 16+/Chrome 99+）
  _openMonthPicker(input) {
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      try { input.showPicker(); return; } catch (_) { /* fall through */ }
    }
    input.focus();
    try { input.click(); } catch (_) {}
  },

  // 同步所有月份输入框的值 + 是否显示"回到本月"
  _syncBackToCurrent() {
    const cur = currentMonth();
    for (const view of ['home', 'mainland', 'taiwan']) {
      const ym = this.state.monthByView[view];
      const wrap = document.querySelector(`[data-back-wrap="${view}"]`);
      if (wrap) wrap.classList.toggle('show', ym !== cur);
      const input = view === 'home'
        ? document.getElementById('home-month-input')
        : document.querySelector(`[data-month-input="${view}"]`);
      if (input) input.value = ym;
    }
  },

  async refreshAll() {
    await this.refreshHome();
    await this.refreshRegion('mainland');
    await this.refreshRegion('taiwan');
  },

  // ============ 首页 ============
  async refreshHome() {
    const ym = this.state.monthByView.home;
    document.getElementById('home-month-label').textContent = monthLabel(ym);

    // 两个地区的本月汇总
    for (const region of ['mainland', 'taiwan']) {
      const list = await DB.getTransactionsByMonth(region, ym);
      const cfg = DEFAULT_CATEGORIES[region];
      const inc = list.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const exp = list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const prefix = region === 'mainland' ? 'sum-mainland' : 'sum-taiwan';
      document.getElementById(`${prefix}-income`).textContent = formatAmount(inc, cfg.symbol);
      document.getElementById(`${prefix}-expense`).textContent = formatAmount(exp, cfg.symbol);
      const balEl = document.getElementById(`${prefix}-balance`);
      const bal = inc - exp;
      balEl.textContent = formatAmount(bal, cfg.symbol);
      balEl.classList.toggle('positive', bal >= 0);
      balEl.classList.toggle('negative', bal < 0);
    }

    this._updateChartTabs();
    await this.refreshHomePieAndList();
    await this.refreshHomeBar();
  },

  async refreshHomePieAndList() {
    const ym = this.state.monthByView.home;
    const region = this.state.chartRegion;
    const type = this.state.chartType;
    const cfg = DEFAULT_CATEGORIES[region];

    const list = await DB.getTransactionsByMonth(region, ym);
    const filtered = list.filter(t => t.type === type);

    // 按类别 → 项目 → 单笔记录 分组
    const byCat = new Map();
    for (const t of filtered) {
      const key = t.category;
      if (!byCat.has(key)) byCat.set(key, { category: key, amount: 0, items: new Map() });
      const row = byCat.get(key);
      row.amount += t.amount;
      const itemKey = t.item;
      if (!row.items.has(itemKey)) row.items.set(itemKey, { item: itemKey, amount: 0, count: 0, txs: [] });
      const itRow = row.items.get(itemKey);
      itRow.amount += t.amount;
      itRow.count += 1;
      itRow.txs.push(t);
    }
    const breakdown = [...byCat.values()].sort((a, b) => b.amount - a.amount);
    const total = breakdown.reduce((s, b) => s + b.amount, 0);

    // 渲染饼图
    const centerTitle = type === 'expense' ? '合计支出' : '合计收入';
    Charts.renderPie(
      document.getElementById('pie-chart'),
      breakdown.map(b => ({ category: b.category, amount: b.amount })),
      cfg.symbol,
      centerTitle
    );

    // 渲染类别列表（可点开）
    const wrap = document.getElementById('category-breakdown');
    wrap.innerHTML = '';
    if (breakdown.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="emoji">🌤️</div>本月无${type === 'expense' ? '支出' : '收入'}记录</div>`;
      return;
    }
    // 抓一下该地区/类型的类别配置，用于显示自定义 icon
    const catCfg = await DB.getCategoryConfig(region, type);
    const iconByName = new Map(catCfg.groups.map(g => [g.category, g.icon || CATEGORY_ICONS[g.category] || '📁']));

    breakdown.forEach((b, idx) => {
      const color = CHART_PALETTE[idx % CHART_PALETTE.length];
      const pct = total ? (b.amount / total * 100).toFixed(1) : 0;
      const icon = iconByName.get(b.category) || CATEGORY_ICONS[b.category] || '📁';
      const open = this.state.openCategory === b.category;

      const row = document.createElement('div');
      row.className = 'category-row' + (open ? ' open' : '');
      row.innerHTML = `
        <span class="swatch" style="background:${color}"></span>
        <span class="icon">${icon}</span>
        <span class="name">${escapeHtml(b.category)}</span>
        <span class="pct">${pct}%</span>
        <span class="amount">${escapeHtml(formatAmount(b.amount, cfg.symbol))}</span>
        <span class="chevron">›</span>
      `;
      const detail = document.createElement('div');
      detail.className = 'category-detail' + (open ? ' open' : '');

      // 第二层：项目 - 每一项可再展开看到原始记录
      const items = [...b.items.values()].sort((x, y) => y.amount - x.amount);
      for (const it of items) {
        const itRow = document.createElement('div');
        itRow.className = 'detail-row';
        itRow.innerHTML = `
          <span class="item-name">${escapeHtml(it.item)} <span style="color:var(--color-text-mute);font-size:var(--fs-xs);">×${it.count}</span></span>
          <span class="item-amt">${escapeHtml(formatAmount(it.amount, cfg.symbol))}</span>
          <span class="chevron-sm">›</span>
        `;
        // 第三层：单笔记录
        const recordsWrap = document.createElement('div');
        recordsWrap.className = 'item-records';
        const txsSorted = [...it.txs].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt - a.createdAt));
        recordsWrap.innerHTML = txsSorted.map(t => `
          <div class="record-row" data-tx-id="${escapeHtml(t.id)}">
            <span class="r-date">${escapeHtml(formatDayLabel(t.date))}</span>
            <span class="r-note">${escapeHtml(t.note || '')}</span>
            <span class="r-amt ${t.type}">${t.type === 'income' ? '+' : '-'}${escapeHtml(formatAmount(t.amount, cfg.symbol))}</span>
          </div>
        `).join('') || '<div class="record-row"><span class="r-note">暂无明细</span></div>';

        // 点击项目：展开/收起记录
        itRow.addEventListener('click', e => {
          e.stopPropagation();
          const wasOpen = itRow.classList.contains('open');
          // 同级只展开一个
          detail.querySelectorAll('.detail-row.open').forEach(r => r.classList.remove('open'));
          detail.querySelectorAll('.item-records.open').forEach(d => d.classList.remove('open'));
          if (!wasOpen) {
            itRow.classList.add('open');
            recordsWrap.classList.add('open');
          }
        });

        // 点击记录：打开编辑弹窗
        recordsWrap.addEventListener('click', async e => {
          const rec = e.target.closest('.record-row');
          if (!rec) return;
          const txId = rec.dataset.txId;
          if (!txId) return;
          e.stopPropagation();
          const all = await DB.getAllTransactions();
          const tx = all.find(x => x.id === txId);
          if (tx) this.openRecordSheet(region, tx);
        });

        detail.appendChild(itRow);
        detail.appendChild(recordsWrap);
      }

      row.addEventListener('click', () => {
        const wasOpen = row.classList.contains('open');
        wrap.querySelectorAll('.category-row.open').forEach(r => r.classList.remove('open'));
        wrap.querySelectorAll('.category-detail.open').forEach(d => d.classList.remove('open'));
        // 切换类别时收起所有项目级的展开
        wrap.querySelectorAll('.detail-row.open').forEach(r => r.classList.remove('open'));
        wrap.querySelectorAll('.item-records.open').forEach(d => d.classList.remove('open'));
        if (!wasOpen) {
          row.classList.add('open');
          detail.classList.add('open');
          this.state.openCategory = b.category;
        } else {
          this.state.openCategory = null;
        }
      });
      wrap.appendChild(row);
      wrap.appendChild(detail);
    });
  },

  // 根据当前地区的实际数据范围，决定哪些时间范围选项可见
  // 规则：选项 < 数据跨度 显示，最小的 >= 数据跨度 显示（含），更大的隐藏
  async _updateRangeBar() {
    const region = this.state.barRegion;
    const ym = this.state.monthByView.home;
    const all = await DB.getAllTransactions();
    const regionAll = all.filter(t => t.region === region);
    let span = 0;
    if (regionAll.length > 0) {
      const earliest = regionAll.reduce((m, t) => (t.date < m ? t.date : m), regionAll[0].date);
      const earliestYm = earliest.slice(0, 7);
      span = (ym >= earliestYm) ? monthDiff(earliestYm, ym) + 1 : 1;
    }

    const STANDARD = [1, 2, 3, 6, 12, 24, 36, 60];
    const visible = new Set();
    for (const n of STANDARD) {
      if (n < span) visible.add(n);
      else if (n >= span) { visible.add(n); break; }
    }
    if (visible.size === 0) visible.add(1);

    document.querySelectorAll('#bar-range-bar .chip').forEach(chip => {
      const r = chip.dataset.range;
      if (r === 'max') {
        chip.style.display = ''; // "全部" 永远显示
      } else {
        chip.style.display = visible.has(parseInt(r, 10)) ? '' : 'none';
      }
    });

    // 当前选中的 range 如果已被隐藏，回退到最大可见的标准选项
    if (this.state.barRangeMonths !== 'max' && !visible.has(this.state.barRangeMonths)) {
      const fallback = Math.max(...visible);
      this.state.barRangeMonths = fallback;
      document.querySelectorAll('#bar-range-bar .chip').forEach(c => c.classList.remove('active'));
      const target = document.querySelector(`#bar-range-bar .chip[data-range="${fallback}"]`);
      if (target) target.classList.add('active');
    }
  },

  async refreshHomeBar() {
    await this._updateRangeBar();
    const ym = this.state.monthByView.home;
    const region = this.state.barRegion;
    const cfg = DEFAULT_CATEGORIES[region];
    let months = [];
    const rangeVal = this.state.barRangeMonths;

    if (rangeVal === 'max') {
      // 取最早交易月份到当前选定月份的完整跨度（限制最多 60 个月）
      const all = await DB.getAllTransactions();
      const regionAll = all.filter(t => t.region === region);
      if (regionAll.length === 0) {
        months = [ym];
      } else {
        const minDate = regionAll.reduce((min, t) => (t.date < min ? t.date : min), regionAll[0].date);
        let cur = minDate.slice(0, 7);
        while (cur <= ym) {
          months.push(cur);
          cur = shiftMonth(cur, 1);
        }
        if (months.length > 60) months = months.slice(months.length - 60);
      }
    } else {
      const n = Math.max(1, parseInt(rangeVal, 10) || 6);
      for (let i = n - 1; i >= 0; i--) months.push(shiftMonth(ym, -i));
    }

    const data = { income: [], expense: [] };
    for (const m of months) {
      const list = await DB.getTransactionsByMonth(region, m);
      data.income.push(list.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0));
      data.expense.push(list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
    }

    // 标题
    const titleEl = document.getElementById('bar-chart-title');
    if (rangeVal === 'max') {
      titleEl.textContent = `全部 月度结余 · ${months.length} 个月`;
    } else if (rangeVal === 1) {
      titleEl.textContent = `当月 结余`;
    } else if (rangeVal % 12 === 0) {
      titleEl.textContent = `近 ${rangeVal/12} 年 月度结余`;
    } else {
      titleEl.textContent = `近 ${rangeVal} 个月 月度结余`;
    }
    document.getElementById('bar-region-label').textContent = `${cfg.name} · ${cfg.symbol}`;

    Charts.renderRegionBar(document.getElementById('bar-chart'), months, data, cfg);
  },

  // ============ 大陆 / 台湾 ============
  async refreshRegion(region) {
    const ym = this.state.monthByView[region];
    const cfg = DEFAULT_CATEGORIES[region];
    const prefix = region === 'mainland' ? 'ml' : 'tw';
    document.querySelector(`[data-month-label="${region}"]`).textContent = monthLabel(ym);

    const list = await DB.getTransactionsByMonth(region, ym);
    const inc = list.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const bal = inc - exp;
    document.getElementById(`${prefix}-this-month-income`).textContent = formatAmount(inc, cfg.symbol);
    document.getElementById(`${prefix}-this-month-expense`).textContent = formatAmount(exp, cfg.symbol);
    const netEl = document.getElementById(`${prefix}-this-month-net`);
    netEl.textContent = `结余 ${formatAmount(bal, cfg.symbol)}`;
    netEl.style.color = bal >= 0 ? 'var(--color-income)' : 'var(--color-expense)';

    // 列表（按日期分组）
    const wrap = document.getElementById(`${prefix}-tx-list`);
    if (list.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="emoji">📒</div>本月还没有记录</div>`;
      return;
    }
    // 把两种类型的类别图标都查出来，用于历史记录展示
    const [incomeCfg, expenseCfg] = await Promise.all([
      DB.getCategoryConfig(region, 'income'),
      DB.getCategoryConfig(region, 'expense')
    ]);
    const iconLookup = new Map();
    for (const c of [incomeCfg, expenseCfg]) {
      for (const g of c.groups) iconLookup.set(c.type + '|' + g.category, g.icon || CATEGORY_ICONS[g.category] || '📁');
    }
    const byDate = new Map();
    for (const t of list) {
      if (!byDate.has(t.date)) byDate.set(t.date, []);
      byDate.get(t.date).push(t);
    }
    const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
    wrap.innerHTML = '';
    for (const d of dates) {
      const items = byDate.get(d);
      const header = document.createElement('div');
      header.className = 'tx-day-header';
      header.innerHTML = `<span>${escapeHtml(formatFullDayLabel(d))}</span>`;
      wrap.appendChild(header);
      for (const t of items) {
        const icon = iconLookup.get(t.type + '|' + t.category) || CATEGORY_ICONS[t.category] || '📁';
        const row = document.createElement('div');
        row.className = 'tx-row';
        row.innerHTML = `
          <div class="tx-icon">${icon}</div>
          <div class="tx-info">
            <div class="tx-title-line">
              <span class="tx-item">${escapeHtml(t.item)}</span>
              <span class="tx-cat">· ${escapeHtml(t.category)}</span>
            </div>
            ${t.note ? `<div class="tx-note">${escapeHtml(t.note)}</div>` : ''}
          </div>
          <div class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '-'}${escapeHtml(formatAmount(t.amount, cfg.symbol))}</div>
        `;
        row.addEventListener('click', () => this.openRecordSheet(region, t));
        wrap.appendChild(row);
      }
    }
  },

  // ============ 记账弹窗 ============
  async openRecordSheet(region, existing = null) {
    const cfg = DEFAULT_CATEGORIES[region];
    const type0 = existing?.type || 'expense';
    const initialDate = existing ? existing.date : todayLocal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-title">
          ${existing ? '编辑记录' : '记一笔'} <span style="color:var(--color-text-soft);font-size:var(--fs-sm);font-weight:500;">· ${escapeHtml(cfg.name)}</span>
        </div>
        <div class="tx-form">
          <div class="type-toggle">
            <button type="button" class="${type0==='expense'?'active expense':''}" data-type="expense">支出</button>
            <button type="button" class="${type0==='income'?'active income':''}" data-type="income">收入</button>
          </div>

          <div class="field">
            <span class="field-label">金额</span>
            <div class="amount-input-wrap">
              <span class="currency">${cfg.symbol}</span>
              <input type="text" inputmode="decimal" placeholder="0.00" class="amt-input" value="${existing ? existing.amount : ''}" />
            </div>
          </div>

          <div class="field">
            <span class="field-label">类别</span>
            <div class="cat-chips" data-role="category-chips"></div>
          </div>

          <div class="field" data-role="item-field" style="display:none;">
            <span class="field-label">项目</span>
            <div class="cat-chips" data-role="item-chips"></div>
          </div>

          <div class="field">
            <span class="field-label">日期</span>
            <label class="date-control">
              <span class="date-display">${escapeHtml(formatDateSlash(initialDate))}</span>
              <span class="date-hint">点击修改</span>
              <input type="date" class="date-input" value="${initialDate}" />
            </label>
          </div>

          <div class="field">
            <span class="field-label">备注（可选）</span>
            <textarea class="note-input" placeholder="写点备注...">${existing ? escapeHtml(existing.note || '') : ''}</textarea>
          </div>

          <div class="modal-actions">
            ${existing ? '<button type="button" class="btn btn-danger" data-act="delete">删除</button>' : ''}
            <button type="button" class="btn btn-ghost" data-act="cancel">取消</button>
            <button type="button" class="btn btn-primary btn-save" style="flex:2;">保存</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const card = overlay.querySelector('.modal-card');

    const state = {
      type: type0,
      category: existing?.category || null,
      item: existing?.item || null
    };

    const renderCategories = async () => {
      try {
        const config = await DB.getCategoryConfig(region, state.type);
        const wrap = card.querySelector('[data-role="category-chips"]');
        wrap.innerHTML = '';
        for (const g of config.groups) {
          const icon = g.icon || CATEGORY_ICONS[g.category] || '📁';
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip' + (state.category === g.category ? ' active' : '');
          chip.innerHTML = `${icon} ${escapeHtml(g.category)}`;
          chip.addEventListener('click', () => {
            state.category = g.category;
            state.item = null;
            renderCategories();
            renderItems();
          });
          wrap.appendChild(chip);
        }
        // "+ 新建类别"
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'chip muted';
        add.textContent = '＋ 新增类别';
        add.addEventListener('click', async () => {
          const result = await App.promptNewCategory();
          if (!result) return;
          const { name, icon } = result;
          const cfg2 = await DB.getCategoryConfig(region, state.type);
          if (cfg2.groups.some(g => g.category === name)) {
            toast('该类别已存在', 'warn');
            return;
          }
          insertGroupBeforeOther(cfg2.groups, { category: name, icon, items: [] });
          await DB.saveCategoryConfig(cfg2);
          state.category = name;
          state.item = null;
          renderCategories();
          renderItems();
        });
        wrap.appendChild(add);
      } catch (err) {
        console.error('renderCategories failed', err);
        toast('类别加载失败: ' + err.message, 'error', 4000);
      }
    };

    const renderItems = async () => {
      try {
        const itemField = card.querySelector('[data-role="item-field"]');
        const wrap = card.querySelector('[data-role="item-chips"]');
        wrap.innerHTML = '';
        if (!state.category) {
          itemField.style.display = 'none';
          return;
        }
        itemField.style.display = '';
        const config = await DB.getCategoryConfig(region, state.type);
        const g = config.groups.find(x => x.category === state.category);
        if (!g) { itemField.style.display = 'none'; return; }
        for (const itemName of g.items) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip' + (state.item === itemName ? ' active' : '');
          chip.textContent = itemName;
          chip.addEventListener('click', () => {
            state.item = itemName;
            renderItems();
          });
          wrap.appendChild(chip);
        }
        // "+ 新建项目"
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'chip muted';
        add.textContent = '＋ 新增项目';
        add.addEventListener('click', async () => {
          const name = await promptDialog(`在「${state.category}」下新增项目`);
          if (!name) return;
          const cfg2 = await DB.getCategoryConfig(region, state.type);
          const g2 = cfg2.groups.find(x => x.category === state.category);
          if (!g2) return;
          if (g2.items.includes(name)) { toast('该项目已存在', 'warn'); return; }
          g2.items.push(name);
          await DB.saveCategoryConfig(cfg2);
          state.item = name;
          renderItems();
        });
        wrap.appendChild(add);
      } catch (err) {
        console.error('renderItems failed', err);
        toast('项目加载失败: ' + err.message, 'error', 4000);
      }
    };

    // 类型切换
    card.querySelectorAll('[data-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.type = btn.dataset.type;
        state.category = null;
        state.item = null;
        card.querySelectorAll('[data-type]').forEach(b => {
          b.classList.remove('active', 'expense', 'income');
        });
        btn.classList.add('active', btn.dataset.type);
        renderCategories();
        renderItems();
      });
    });

    // 日期：用 input[type=date] 实际选，用 display 文本显示 YYYY/MM/DD
    const dateControl = card.querySelector('.date-control');
    const dateInput = card.querySelector('.date-input');
    const dateDisplay = card.querySelector('.date-display');
    const refreshDateDisplay = () => {
      dateDisplay.textContent = formatDateSlash(dateInput.value || todayLocal());
    };
    dateInput.addEventListener('change', refreshDateDisplay);
    dateInput.addEventListener('input', refreshDateDisplay);
    // iOS / 某些浏览器要主动调用 showPicker 才会弹出
    dateControl.addEventListener('click', e => {
      if (e.target === dateInput) return; // 原生输入自己处理
      e.preventDefault();
      try {
        if (typeof dateInput.showPicker === 'function') {
          dateInput.showPicker();
          return;
        }
      } catch (_) { /* showPicker 不可用或被拒绝 */ }
      dateInput.focus();
      try { dateInput.click(); } catch (_) {}
    });

    const closeModal = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    // 保存（用按钮点击，不依赖 form submit，避免事件被吃掉）
    const doSave = async () => {
      try {
        const amountStr = card.querySelector('.amt-input').value.trim().replace(/[, ]/g, '');
        const amount = parseFloat(amountStr);
        if (!isFinite(amount) || amount <= 0) { toast('请填写有效金额', 'warn'); return; }
        if (!state.category) { toast('请选择类别', 'warn'); return; }
        if (!state.item) { toast('请选择项目', 'warn'); return; }
        const date = dateInput.value || todayLocal();
        const note = card.querySelector('.note-input').value.trim();
        const payload = {
          id: existing?.id,
          region, type: state.type, category: state.category, item: state.item,
          amount, currency: cfg.currency, date, note,
          createdAt: existing?.createdAt
        };
        const saveBtn = card.querySelector('.btn-save');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';
        await DB.addTransaction(payload);
        closeModal();
        toast(existing ? '已更新' : '已记录', 'success');
        this.refreshAll();
      } catch (err) {
        console.error('save failed', err);
        toast('保存失败: ' + (err?.message || err), 'error', 5000);
        const saveBtn = card.querySelector('.btn-save');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存'; }
      }
    };

    card.querySelector('.btn-save').addEventListener('click', doSave);
    card.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    if (existing) {
      card.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        const ok = await confirmDialog('确定删除这条记录吗？');
        if (!ok) return;
        try {
          await DB.hardDeleteTransaction(existing.id);
          closeModal();
          toast('已删除', 'success');
          this.refreshAll();
        } catch (err) {
          toast('删除失败: ' + err.message, 'error');
        }
      });
    }

    // 最后渲染 categories/items —— 即使失败也不影响保存按钮
    renderCategories();
    renderItems();
  },

  // 新增类别的"输入名称 + 选 emoji"弹窗
  async promptNewCategory(initialName = '', initialIcon = '📁') {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      let chosen = initialIcon;
      let name = initialName;
      const renderEmoji = () => {
        const sections = Object.entries(EMOJI_LIBRARY).map(([title, list]) => `
          <div class="emoji-section-title">${escapeHtml(title)}</div>
          <div class="emoji-row">
            ${list.map(e => `<button type="button" class="emoji-cell ${e===chosen?'active':''}" data-emoji="${e}">${e}</button>`).join('')}
          </div>
        `).join('');
        overlay.querySelector('.emoji-grid').innerHTML = sections;
      };
      overlay.innerHTML = `
        <div class="modal-card">
          <div class="modal-title">新增类别</div>
          <div class="emoji-picker-preview">
            <div class="big" data-role="preview">${chosen}</div>
            <div>
              <div style="font-size:var(--fs-sm);color:var(--color-text-soft);">类别图标</div>
              <div style="font-weight:600;font-size:var(--fs-base);" data-role="name-preview">${escapeHtml(name || '类别名称')}</div>
            </div>
          </div>
          <div class="field">
            <span class="field-label">类别名称</span>
            <input class="input cat-name" type="text" placeholder="例如：旅游" value="${escapeHtml(name)}" />
            <div class="suggested-emojis" data-role="suggested">
              <div class="suggested-title">✨ 根据名称推荐</div>
              <div class="suggested-list"></div>
            </div>
          </div>
          <div class="field">
            <span class="field-label">所有图标</span>
            <div class="emoji-grid"></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-act="cancel">取消</button>
            <button type="button" class="btn btn-primary" data-act="ok">确定</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      renderEmoji();
      const nameInput = overlay.querySelector('.cat-name');
      const suggestedWrap = overlay.querySelector('[data-role="suggested"]');
      const suggestedList = suggestedWrap.querySelector('.suggested-list');

      const renderSuggested = () => {
        const list = suggestEmojisByName(nameInput.value);
        if (list.length === 0) {
          suggestedWrap.classList.remove('show');
          suggestedList.innerHTML = '';
          return;
        }
        suggestedWrap.classList.add('show');
        suggestedList.innerHTML = list.map(e =>
          `<button type="button" class="emoji-cell ${e===chosen?'active':''}" data-emoji="${e}">${e}</button>`
        ).join('');
      };

      nameInput.focus();
      nameInput.addEventListener('input', () => {
        name = nameInput.value.trim();
        overlay.querySelector('[data-role="name-preview"]').textContent = name || '类别名称';
        renderSuggested();
      });
      // 初始也试着推荐（重命名情况）
      renderSuggested();

      overlay.addEventListener('click', e => {
        const cell = e.target.closest('.emoji-cell');
        if (cell) {
          chosen = cell.dataset.emoji;
          overlay.querySelector('[data-role="preview"]').textContent = chosen;
          overlay.querySelectorAll('.emoji-cell.active').forEach(c => c.classList.remove('active'));
          // 同时把推荐区和完整库里相同的格子都点亮
          overlay.querySelectorAll(`.emoji-cell[data-emoji="${chosen}"]`).forEach(c => c.classList.add('active'));
          return;
        }
        const act = e.target?.dataset?.act;
        if (act === 'cancel' || (e.target === overlay && e.target.classList.contains('modal-overlay'))) {
          overlay.remove();
          resolve(null);
        } else if (act === 'ok') {
          const finalName = nameInput.value.trim();
          if (!finalName) { toast('请填写类别名称', 'warn'); return; }
          overlay.remove();
          resolve({ name: finalName, icon: chosen });
        }
      });
    });
  },

  // ============ 设置项动作 ============
  async handleSettingAction(row) {
    const act = row.dataset.action;
    if (act === 'edit-cats') {
      this.openCategoryEditor(row.dataset.region, row.dataset.type);
    } else if (act === 'export-xlsx') {
      await Exporter.exportExcel();
    } else if (act === 'import-xlsx') {
      document.getElementById('file-import-xlsx').click();
    } else if (act === 'export-json') {
      await Exporter.exportJSON();
    } else if (act === 'import-json') {
      document.getElementById('file-import').click();
    } else if (act === 'cloud-setup') {
      this.openCloudSetup();
    } else if (act === 'cloud-sync-now') {
      try {
        toast('正在同步...', 'info');
        const r = await Cloud.syncNow();
        toast(`同步完成（上传 ${r.pushed} 条，下载 ${r.pulled} 条）`, 'success');
        Cloud.statusLabel().then(s => {
          document.getElementById('cloud-status-label').textContent = s;
        });
      } catch (err) {
        toast('同步失败：' + err.message, 'error', 4000);
      }
    } else if (act === 'cloud-status') {
      Cloud.statusLabel().then(s => {
        document.getElementById('cloud-status-label').textContent = s;
      });
    }
  },

  async openCategoryEditor(region, type) {
    const cfg = await DB.getCategoryConfig(region, type);
    const regionName = region === 'mainland' ? '大陆' : '台湾';
    const typeName = type === 'income' ? '收入' : '支出';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-title">${regionName} · ${typeName} 类别管理</div>
        <div class="tip">每个"类别"下可以有多个"项目"。例如：车 → 车险 / 车保养 / 车加油。点击 ✎ 可重命名 / 改图标，点 × 删除。</div>
        <div data-role="groups"></div>
        <button type="button" class="btn btn-ghost btn-block" data-act="add-group" style="margin-top:8px;">＋ 新增类别</button>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="reset">恢复默认</button>
          <button type="button" class="btn btn-primary" data-act="done">完成</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const renderGroups = () => {
      const wrap = overlay.querySelector('[data-role="groups"]');
      wrap.innerHTML = '';
      cfg.groups.forEach((g, gIdx) => {
        const icon = g.icon || CATEGORY_ICONS[g.category] || '📁';
        const box = document.createElement('div');
        box.className = 'cat-editor-group';
        box.innerHTML = `
          <div class="cat-editor-group-head">
            <span style="font-size:var(--fs-lg);">${icon}</span>
            <span class="name">${escapeHtml(g.category)}</span>
            <button class="icon-btn" data-act="rename-group" data-idx="${gIdx}" title="重命名 / 改图标">✎</button>
            <button class="icon-btn danger" data-act="del-group" data-idx="${gIdx}" title="删除类别">🗑</button>
          </div>
          <div class="cat-editor-items">
            ${g.items.map((it, iIdx) => `
              <span class="cat-item-chip">
                ${escapeHtml(it)}
                <button class="rename" data-act="rename-item" data-g="${gIdx}" data-i="${iIdx}" title="重命名">✎</button>
                <button class="remove" data-act="del-item" data-g="${gIdx}" data-i="${iIdx}" title="删除">×</button>
              </span>
            `).join('')}
            <button class="chip muted" data-act="add-item" data-idx="${gIdx}">＋ 项目</button>
          </div>
        `;
        wrap.appendChild(box);
      });
    };
    renderGroups();

    overlay.addEventListener('click', async e => {
      const target = e.target.closest('[data-act]');
      if (!target) {
        if (e.target === overlay) document.body.removeChild(overlay);
        return;
      }
      const act = target.dataset.act;

      if (act === 'add-group') {
        const result = await App.promptNewCategory();
        if (!result) return;
        if (cfg.groups.some(g => g.category === result.name)) { toast('已存在', 'warn'); return; }
        insertGroupBeforeOther(cfg.groups, { category: result.name, icon: result.icon, items: [] });
        await DB.saveCategoryConfig(cfg);
        renderGroups();

      } else if (act === 'rename-group') {
        const idx = +target.dataset.idx;
        const cur = cfg.groups[idx];
        const result = await App.promptNewCategory(cur.category, cur.icon || CATEGORY_ICONS[cur.category] || '📁');
        if (!result) return;
        if (cfg.groups.some((g, i) => i !== idx && g.category === result.name)) { toast('已存在', 'warn'); return; }
        cfg.groups[idx].category = result.name;
        cfg.groups[idx].icon = result.icon;
        await DB.saveCategoryConfig(cfg);
        renderGroups();

      } else if (act === 'del-group') {
        const idx = +target.dataset.idx;
        const ok = await confirmDialog(`确认删除类别「${cfg.groups[idx].category}」？已记录的历史不会受影响。`);
        if (!ok) return;
        cfg.groups.splice(idx, 1);
        await DB.saveCategoryConfig(cfg);
        renderGroups();

      } else if (act === 'add-item') {
        const idx = +target.dataset.idx;
        const name = await promptDialog(`在「${cfg.groups[idx].category}」下新增项目`);
        if (!name) return;
        if (cfg.groups[idx].items.includes(name)) { toast('已存在', 'warn'); return; }
        cfg.groups[idx].items.push(name);
        await DB.saveCategoryConfig(cfg);
        renderGroups();

      } else if (act === 'rename-item') {
        const g = +target.dataset.g, i = +target.dataset.i;
        const oldName = cfg.groups[g].items[i];
        const newName = await promptDialog('重命名项目', oldName);
        if (!newName || newName === oldName) return;
        if (cfg.groups[g].items.includes(newName)) { toast('已存在', 'warn'); return; }
        cfg.groups[g].items[i] = newName;
        await DB.saveCategoryConfig(cfg);
        // 同步更新所有历史记录里的项目名
        try {
          const all = await DB.getAllTransactions();
          let n = 0;
          for (const t of all) {
            if (t.region === region && t.type === type &&
                t.category === cfg.groups[g].category && t.item === oldName) {
              await DB.updateTransaction(t.id, { item: newName });
              n++;
            }
          }
          if (n > 0) toast(`已更新 ${n} 条历史记录`, 'success');
        } catch (err) {
          console.warn('update historical records failed', err);
        }
        renderGroups();

      } else if (act === 'del-item') {
        const g = +target.dataset.g, i = +target.dataset.i;
        cfg.groups[g].items.splice(i, 1);
        await DB.saveCategoryConfig(cfg);
        renderGroups();

      } else if (act === 'reset') {
        const ok = await confirmDialog('恢复为默认类别？您自定义添加的类别会被覆盖。');
        if (!ok) return;
        const fresh = await DB.resetCategoryConfig(region, type);
        cfg.groups = fresh.groups;
        renderGroups();
        toast('已恢复默认', 'success');

      } else if (act === 'done') {
        document.body.removeChild(overlay);
        this.refreshAll();
      }
    });
  },

  async openCloudSetup() {
    const curUrl = await DB.getMeta('serverUrl');
    const curKey = await DB.getMeta('syncKey');
    const defaultUrl = curUrl || location.origin;  // 默认就是当前域，方便单机自建场景
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-title">设置云同步</div>
        <div class="tip">
          多台设备使用<strong>相同的服务器地址 + 同一个同步密钥</strong>就能共享数据。<br>
          如果是把 App 部署在 PythonAnywhere 上，<strong>服务器地址默认填当前网址即可</strong>。
        </div>
        <div class="field" style="margin-top:12px;">
          <span class="field-label">服务器地址</span>
          <input class="input server-url" type="url" placeholder="https://username.pythonanywhere.com" value="${escapeHtml(defaultUrl)}" />
        </div>
        <div class="field">
          <span class="field-label">同步密钥（自己取一个，多设备保持一致）</span>
          <input class="input sync-key" type="text" placeholder="例如：zhangting-2026" value="${curKey ? escapeHtml(curKey) : ''}" />
        </div>
        <div class="tip">
          <strong>密钥规则：</strong>4~64 位英文/数字/_/-。<strong>这个就是你数据的访问口令</strong>，别人猜到就能看你的账。建议用 12+ 位带数字/字母混合的字符串。<br>
          <strong>多设备同步：</strong>在另一台手机里填同样的服务器地址和密钥，再点"立即同步"即可。
        </div>
        <div class="modal-actions">
          ${curUrl ? '<button type="button" class="btn btn-danger" data-act="disable">关闭同步</button>' : ''}
          <button type="button" class="btn btn-ghost" data-act="cancel">取消</button>
          <button type="button" class="btn btn-primary" data-act="save">保存并启用</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', async e => {
      const act = e.target?.dataset?.act;
      if (act === 'cancel' || (e.target === overlay && e.target.classList.contains('modal-overlay'))) {
        overlay.remove();
      } else if (act === 'disable') {
        await Cloud.disable();
        toast('已关闭云同步', 'success');
        document.getElementById('cloud-status-label').textContent = '未启用';
        overlay.remove();
      } else if (act === 'save') {
        const url = overlay.querySelector('.server-url').value.trim();
        const key = overlay.querySelector('.sync-key').value.trim();
        try {
          await Cloud.setup({ serverUrl: url, syncKey: key });
          toast('已启用，正在首次同步...', 'success');
          overlay.remove();
          try {
            const r = await Cloud.syncNow();
            toast(`同步完成（上传 ${r.pushed}，下载 ${r.pulled}）`, 'success');
          } catch (err) {
            toast('同步失败：' + err.message, 'error', 4000);
          }
          Cloud.statusLabel().then(s => {
            document.getElementById('cloud-status-label').textContent = s;
          });
        } catch (err) {
          toast('设置失败：' + err.message, 'error', 4000);
        }
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
