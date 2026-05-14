// 导出 Excel / JSON

const Exporter = {
  // 导出 Excel
  async exportExcel() {
    const all = await DB.getAllTransactions();
    if (all.length === 0) {
      toast('暂无数据可导出', 'warn');
      return;
    }
    const wb = XLSX.utils.book_new();

    // ===== 全部明细 =====
    const allRows = [['日期', '地区', '币种', '类型', '类别', '项目', '金额', '备注']];
    for (const t of all) {
      allRows.push([
        t.date,
        t.region === 'mainland' ? '大陆' : '台湾',
        t.currency,
        t.type === 'income' ? '收入' : '支出',
        t.category,
        t.item,
        t.amount,
        t.note || ''
      ]);
    }
    const wsAll = XLSX.utils.aoa_to_sheet(allRows);
    wsAll['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, wsAll, '全部明细');

    // ===== 大陆 / 台湾 分表 =====
    for (const region of ['mainland', 'taiwan']) {
      const list = all.filter(t => t.region === region);
      if (list.length === 0) continue;
      const rows = [['日期', '类型', '类别', '项目', '金额', '备注']];
      for (const t of list) {
        rows.push([
          t.date,
          t.type === 'income' ? '收入' : '支出',
          t.category,
          t.item,
          t.amount,
          t.note || ''
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, region === 'mainland' ? '大陆明细' : '台湾明细');
    }

    // ===== 月度汇总 =====
    const summary = buildMonthlySummary(all);
    const sumRows = [['月份', '地区', '币种', '收入', '支出', '结余']];
    for (const r of summary) {
      sumRows.push([r.month, r.regionName, r.currency, r.income, r.expense, r.balance]);
    }
    const wsSum = XLSX.utils.aoa_to_sheet(sumRows);
    wsSum['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsSum, '月度汇总');

    // ===== 类别配置（导出当前自定义类别） =====
    const cats = await DB.getAllCategoryConfigs();
    const catRows = [['地区', '类型', '类别', '项目']];
    for (const c of cats) {
      for (const g of c.groups) {
        for (const item of g.items) {
          catRows.push([
            c.region === 'mainland' ? '大陆' : '台湾',
            c.type === 'income' ? '收入' : '支出',
            g.category,
            item
          ]);
        }
      }
    }
    const wsCat = XLSX.utils.aoa_to_sheet(catRows);
    wsCat['!cols'] = [{ wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsCat, '类别配置');

    const stamp = todayLocal().replace(/-/g, '');
    XLSX.writeFile(wb, `张婷要省钱_备份_${stamp}.xlsx`);
    toast('已导出 Excel 备份', 'success');
  },

  // 导出 JSON
  async exportJSON() {
    const payload = await DB.exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = todayLocal().replace(/-/g, '');
    a.href = url;
    a.download = `张婷要省钱_备份_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('已导出 JSON 备份', 'success');
  },

  // 从 JSON 文件导入
  async importJSON(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const ok = await confirmDialog(`将导入 ${data.transactions?.length || 0} 条记录（与本地数据合并）。继续吗？`);
      if (!ok) return;
      await DB.importAll(data, { merge: true });
      toast('导入完成', 'success');
      document.dispatchEvent(new CustomEvent('data-changed'));
    } catch (err) {
      console.error(err);
      toast('导入失败：' + err.message, 'error');
    }
  },

  // 从 Excel 文件导入
  // 支持两种格式：
  //   1) App 自己导出的 xlsx（含「全部明细」「类别配置」工作表）
  //   2) 类似原 "家庭预算.xlsx" 的格式（只有「类别总览」一张 sheet，仅类别项目）
  async importExcel(file) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });

      const transactions = [];
      const sheetNames = wb.SheetNames || [];

      // ===== A) 尝试读「全部明细」=====
      if (sheetNames.includes('全部明细')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['全部明细'], { header: 1, blankrows: false });
        // header: 日期 | 地区 | 币种 | 类型 | 类别 | 项目 | 金额 | 备注
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r) continue;
          const date = excelToDateStr(r[0]);
          const region = r[1] === '大陆' ? 'mainland' : r[1] === '台湾' ? 'taiwan' : null;
          const currency = r[2] || (region === 'mainland' ? 'CNY' : 'TWD');
          const type = r[3] === '收入' ? 'income' : r[3] === '支出' ? 'expense' : null;
          const category = r[4]; const item = r[5];
          const amount = parseFloat(String(r[6] ?? '').replace(/[, ]/g, ''));
          const note = r[7] ?? '';
          if (!date || !region || !type || !category || !item || !isFinite(amount) || amount <= 0) continue;
          transactions.push({ date, region, type, currency, category, item, amount: Number(amount), note: String(note) });
        }
      } else {
        // ===== B) 尝试读「大陆明细 / 台湾明细」=====
        for (const region of ['mainland', 'taiwan']) {
          const sheetName = region === 'mainland' ? '大陆明细' : '台湾明细';
          if (!sheetNames.includes(sheetName)) continue;
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false });
          // header: 日期 | 类型 | 类别 | 项目 | 金额 | 备注
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r) continue;
            const date = excelToDateStr(r[0]);
            const type = r[1] === '收入' ? 'income' : r[1] === '支出' ? 'expense' : null;
            const category = r[2]; const item = r[3];
            const amount = parseFloat(String(r[4] ?? '').replace(/[, ]/g, ''));
            const note = r[5] ?? '';
            if (!date || !type || !category || !item || !isFinite(amount) || amount <= 0) continue;
            transactions.push({
              date, region, type,
              currency: region === 'mainland' ? 'CNY' : 'TWD',
              category, item, amount: Number(amount), note: String(note)
            });
          }
        }
      }

      // ===== 类别配置 =====
      // 格式 1：App 导出的「类别配置」（地区 | 类型 | 类别 | 项目）
      // 格式 2：原始「类别总览」（序号 | 类型 | 地区 | 项目名称） —— 此时没有"类别"中间层
      const catSheetName = sheetNames.includes('类别配置') ? '类别配置'
                          : sheetNames.includes('类别总览') ? '类别总览'
                          : null;
      const collected = new Map(); // region|type -> Map<category, Set<item>>
      if (catSheetName) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[catSheetName], { header: 1, blankrows: false });
        // 检测表头
        const header = rows.find(r => r && r.some(c => c === '类别' || c === '项目名称' || c === '项目'));
        const startIdx = header ? rows.indexOf(header) + 1 : 1;
        const hasCategoryCol = header && header.includes('类别');

        for (let i = startIdx; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length === 0) continue;
          let regionStr, typeStr, category, item;
          if (hasCategoryCol) {
            // App 导出格式：地区 | 类型 | 类别 | 项目
            [regionStr, typeStr, category, item] = r;
          } else {
            // 原始格式：序号 | 类型 | 地区 | 项目名称  → 此时把项目作为"类别"用，project 也设为同名
            const cols = r.length >= 4 ? [r[1], r[2], r[3]] : [r[0], r[1], r[2]];
            typeStr = cols[0]; regionStr = cols[1]; item = cols[2]; category = null;
          }
          if (!regionStr || !typeStr) continue;
          const region = regionStr === '大陆' ? 'mainland' : regionStr === '台湾' ? 'taiwan' : null;
          const type = typeStr === '收入' ? 'income' : typeStr === '支出' ? 'expense' : null;
          if (!region || !type) continue;
          const k = region + '|' + type;
          if (!collected.has(k)) collected.set(k, new Map());
          const catMap = collected.get(k);
          const cat = category || item || '其他';
          if (!catMap.has(cat)) catMap.set(cat, new Set());
          if (item) catMap.get(cat).add(item);
        }
      }

      if (transactions.length === 0 && collected.size === 0) {
        toast('Excel 中没有可识别的记录或类别配置', 'warn', 3500);
        return;
      }

      const summary = [
        transactions.length > 0 ? `${transactions.length} 条交易记录` : null,
        collected.size > 0 ? `${[...collected.values()].reduce((s, m) => s + m.size, 0)} 组类别配置` : null
      ].filter(Boolean).join(' + ');
      const ok = await confirmDialog(`将导入 ${summary}\n（与本地数据合并，重复内容会自动跳过）。继续吗？`);
      if (!ok) return;

      // 写入交易（去重：相同 date+region+type+category+item+amount+note 不重复）
      let imported = 0, skipped = 0;
      const existingAll = await DB.getAllTransactions();
      const seen = new Set(existingAll.map(t => `${t.date}|${t.region}|${t.type}|${t.category}|${t.item}|${t.amount}|${t.note || ''}`));
      for (const t of transactions) {
        const key = `${t.date}|${t.region}|${t.type}|${t.category}|${t.item}|${t.amount}|${t.note || ''}`;
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        await DB.addTransaction(t);
        imported++;
      }

      // 合并类别配置（新增的插在"其他"之前；已存在的项目跳过）
      let catNew = 0;
      for (const [k, catMap] of collected.entries()) {
        const [region, type] = k.split('|');
        const conf = await DB.getCategoryConfig(region, type);
        for (const [catName, items] of catMap.entries()) {
          let group = conf.groups.find(g => g.category === catName);
          if (!group) {
            group = { category: catName, items: [] };
            insertGroupBeforeOther(conf.groups, group);
            catNew++;
          }
          for (const it of items) {
            if (!group.items.includes(it)) group.items.push(it);
          }
        }
        await DB.saveCategoryConfig(conf);
      }

      const parts = [];
      if (imported > 0) parts.push(`导入 ${imported} 条记录`);
      if (skipped > 0) parts.push(`跳过 ${skipped} 条重复`);
      if (catNew > 0) parts.push(`新增 ${catNew} 个类别`);
      toast(parts.join(' · ') || '没有新数据', 'success', 3500);
      document.dispatchEvent(new CustomEvent('data-changed'));
    } catch (err) {
      console.error(err);
      toast('Excel 导入失败：' + (err?.message || err), 'error', 5000);
    }
  }
};

// Excel 中的日期可能是 Date 对象、序列号或字符串，统一转 YYYY-MM-DD
function excelToDateStr(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !isNaN(raw)) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === 'number') {
    // Excel 序列日期
    try {
      const parsed = XLSX.SSF.parse_date_code(raw);
      if (parsed && parsed.y) {
        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      }
    } catch (_) {}
  }
  if (typeof raw === 'string') {
    const m = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return excelToDateStr(d);
  }
  return null;
}

function buildMonthlySummary(all) {
  const map = new Map();
  for (const t of all) {
    const ym = t.date.slice(0, 7);
    const k = ym + '|' + t.region;
    if (!map.has(k)) {
      map.set(k, { month: ym, region: t.region, currency: t.currency, income: 0, expense: 0 });
    }
    const row = map.get(k);
    if (t.type === 'income') row.income += t.amount;
    else row.expense += t.amount;
  }
  const arr = [...map.values()].map(r => ({
    ...r,
    regionName: r.region === 'mainland' ? '大陆' : '台湾',
    balance: r.income - r.expense
  }));
  arr.sort((a, b) => b.month.localeCompare(a.month) || a.region.localeCompare(b.region));
  return arr;
}
