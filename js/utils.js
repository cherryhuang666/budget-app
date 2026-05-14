// 通用工具

// 本地日期 YYYY-MM-DD：基于设备当前时区，但只保留"年-月-日"字符串
// 因此当设备移动到其他时区后，已记录的日期不会改变（因为我们存的是字符串而不是时间戳）
function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentMonth() {
  return todayLocal().slice(0, 7); // YYYY-MM
}

function parseMonth(ym /* YYYY-MM */) {
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: m };
}

function shiftMonth(ym, delta) {
  let { year, month } = parseMonth(ym);
  month += delta;
  while (month > 12) { month -= 12; year += 1; }
  while (month < 1) { month += 12; year -= 1; }
  return `${year}-${String(month).padStart(2, '0')}`;
}

// 计算两个 YYYY-MM 之间相差几个月（b - a）
function monthDiff(a, b) {
  const A = parseMonth(a);
  const B = parseMonth(b);
  return (B.year - A.year) * 12 + (B.month - A.month);
}

function monthLabel(ym) {
  const { year, month } = parseMonth(ym);
  return `${year}年${month}月`;
}

// 给柱状图 x 轴用：两行 ["2026年", "5月"]，年份在上、月份在下
// 没有补零，1 月就是 "1月"
function formatBarMonthLabel(ym) {
  const { year, month } = parseMonth(ym);
  return [`${year}年`, `${month}月`];
}

// 把 YYYY-MM-DD 显示为 YYYY/MM/DD
function formatDateSlash(d) {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${y}/${m}/${dd}`;
}

// 把 MM-DD 显示为「5月14日」(不补 0) —— 给空间紧的地方用
function formatDayLabel(d) {
  const [, m, dd] = d.split('-');
  return `${parseInt(m, 10)}月${parseInt(dd, 10)}日`;
}

// 完整日期：「2026年5月14日」—— 给本月明细的日期头用
function formatFullDayLabel(d) {
  const [y, m, dd] = d.split('-');
  return `${y}年${parseInt(m, 10)}月${parseInt(dd, 10)}日`;
}

// 新类别要插在「其他」之前
function insertGroupBeforeOther(groups, newGroup, otherName = '其他') {
  const idx = groups.findIndex(g => g.category === otherName);
  if (idx === -1) groups.push(newGroup);
  else groups.splice(idx, 0, newGroup);
  return groups;
}

function formatAmount(num, symbol = '') {
  if (num == null || isNaN(num)) num = 0;
  const fixed = Number(num).toFixed(2);
  const [intPart, dec] = fixed.split('.');
  const withComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${symbol}${withComma}.${dec}`;
}

function formatAmountShort(num, symbol = '') {
  if (num == null || isNaN(num)) num = 0;
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${symbol}${(num/100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${symbol}${(num/10000).toFixed(2)}万`;
  return formatAmount(num, symbol);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg, type = 'info', duration = 2200) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function confirmDialog(msg) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-body">${escapeHtml(msg)}</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="ok">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      const act = e.target?.dataset?.act;
      if (act === 'ok' || act === 'cancel' || e.target === overlay) {
        document.body.removeChild(overlay);
        resolve(act === 'ok');
      }
    });
  });
}

function promptDialog(msg, defaultValue = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-body">
          <div class="modal-title">${escapeHtml(msg)}</div>
          <input class="input" type="text" value="${escapeHtml(defaultValue)}" />
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="ok">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    input.focus();
    input.select();
    overlay.addEventListener('click', e => {
      const act = e.target?.dataset?.act;
      if (act === 'cancel' || e.target === overlay && e.target.classList.contains('modal-overlay')) {
        document.body.removeChild(overlay);
        resolve(null);
      } else if (act === 'ok') {
        const v = input.value.trim();
        document.body.removeChild(overlay);
        resolve(v || null);
      }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const v = input.value.trim();
        document.body.removeChild(overlay);
        resolve(v || null);
      } else if (e.key === 'Escape') {
        document.body.removeChild(overlay);
        resolve(null);
      }
    });
  });
}

// 防抖
function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
