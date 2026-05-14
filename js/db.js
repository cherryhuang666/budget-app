// 本地数据库（IndexedDB 封装）
// 表结构：
//   transactions: 交易记录
//     { id, region, type, category, item, amount, currency, date (本地日期字符串 YYYY-MM-DD), note, createdAt, updatedAt, deleted }
//   categories: 自定义类别
//     { id: region + '|' + type, region, type, groups: [{category, items: [...]}] }
//   meta: 元信息（云端同步时间戳等）

const DB_NAME = 'zhangting-budget';
const DB_VERSION = 1;

// 生成稳定 ID（在非安全上下文 http://192.168.x.x 下，crypto.randomUUID 不存在，要降级）
function genId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) { /* 非安全上下文会抛错 */ }
  // RFC4122 v4 兼容降级
  const rnd = (n) => Math.floor(Math.random() * n);
  const hex = (n) => n.toString(16);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = rnd(16);
    return hex(c === 'x' ? r : (r & 0x3) | 0x8);
  });
}

const DB = {
  _db: null,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('transactions')) {
          const s = db.createObjectStore('transactions', { keyPath: 'id' });
          s.createIndex('by_date', 'date');
          s.createIndex('by_region_date', ['region', 'date']);
          s.createIndex('by_updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        this._db = req.result;
        resolve(this._db);
      };
    });
  },

  _tx(stores, mode = 'readonly') {
    return this._db.transaction(stores, mode);
  },

  async _wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // ============ 交易记录 ============
  async addTransaction(t) {
    await this.open();
    const now = Date.now();
    const row = {
      id: t.id || genId(),
      region: t.region,
      type: t.type, // 'income' | 'expense'
      category: t.category,
      item: t.item,
      amount: Number(t.amount),
      currency: t.currency,
      date: t.date, // YYYY-MM-DD 本地日期
      note: t.note || '',
      createdAt: t.createdAt || now,
      updatedAt: now,
      deleted: false
    };
    const tx = this._tx(['transactions'], 'readwrite');
    await this._wrap(tx.objectStore('transactions').put(row));
    return row;
  },

  async updateTransaction(id, patch) {
    await this.open();
    const tx = this._tx(['transactions'], 'readwrite');
    const store = tx.objectStore('transactions');
    const existing = await this._wrap(store.get(id));
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: Date.now() };
    await this._wrap(store.put(updated));
    return updated;
  },

  async deleteTransaction(id) {
    // 软删除：保留 id，标记 deleted，便于云端同步
    return this.updateTransaction(id, { deleted: true });
  },

  async hardDeleteTransaction(id) {
    await this.open();
    const tx = this._tx(['transactions'], 'readwrite');
    await this._wrap(tx.objectStore('transactions').delete(id));
  },

  async getAllTransactions() {
    await this.open();
    const tx = this._tx(['transactions']);
    const all = await this._wrap(tx.objectStore('transactions').getAll());
    return all.filter(r => !r.deleted).sort((a, b) => (b.date.localeCompare(a.date)) || (b.createdAt - a.createdAt));
  },

  async getTransactionsInRange(region, startDate, endDate) {
    const all = await this.getAllTransactions();
    return all.filter(r =>
      r.region === region &&
      r.date >= startDate &&
      r.date <= endDate
    );
  },

  async getTransactionsByMonth(region, yearMonth /* 'YYYY-MM' */) {
    const start = `${yearMonth}-01`;
    const end = `${yearMonth}-31`;
    return this.getTransactionsInRange(region, start, end);
  },

  // ============ 自定义类别 ============
  async getCategoryConfig(region, type) {
    await this.open();
    const id = `${region}|${type}`;
    const tx = this._tx(['categories']);
    const row = await this._wrap(tx.objectStore('categories').get(id));
    if (row) return row;
    // 首次：写入默认值
    const def = DEFAULT_CATEGORIES[region][type];
    const fresh = { id, region, type, groups: JSON.parse(JSON.stringify(def)), updatedAt: Date.now() };
    const tx2 = this._tx(['categories'], 'readwrite');
    await this._wrap(tx2.objectStore('categories').put(fresh));
    return fresh;
  },

  async saveCategoryConfig(config) {
    await this.open();
    config.updatedAt = Date.now();
    const tx = this._tx(['categories'], 'readwrite');
    await this._wrap(tx.objectStore('categories').put(config));
    return config;
  },

  async resetCategoryConfig(region, type) {
    await this.open();
    const id = `${region}|${type}`;
    const def = DEFAULT_CATEGORIES[region][type];
    const fresh = { id, region, type, groups: JSON.parse(JSON.stringify(def)), updatedAt: Date.now() };
    const tx = this._tx(['categories'], 'readwrite');
    await this._wrap(tx.objectStore('categories').put(fresh));
    return fresh;
  },

  async getAllCategoryConfigs() {
    await this.open();
    const tx = this._tx(['categories']);
    return this._wrap(tx.objectStore('categories').getAll());
  },

  // ============ Meta ============
  async getMeta(key) {
    await this.open();
    const tx = this._tx(['meta']);
    const row = await this._wrap(tx.objectStore('meta').get(key));
    return row ? row.value : null;
  },

  async setMeta(key, value) {
    await this.open();
    const tx = this._tx(['meta'], 'readwrite');
    await this._wrap(tx.objectStore('meta').put({ key, value }));
  },

  // ============ 完整备份 / 恢复 ============
  async exportAll() {
    await this.open();
    const [transactions, categories] = await Promise.all([
      this._wrap(this._tx(['transactions']).objectStore('transactions').getAll()),
      this._wrap(this._tx(['categories']).objectStore('categories').getAll())
    ]);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions,
      categories
    };
  },

  async importAll(payload, { merge = true } = {}) {
    await this.open();
    if (!payload || !Array.isArray(payload.transactions)) {
      throw new Error('备份文件格式不正确');
    }
    const tx = this._tx(['transactions', 'categories'], 'readwrite');
    const tStore = tx.objectStore('transactions');
    const cStore = tx.objectStore('categories');
    if (!merge) {
      await this._wrap(tStore.clear());
      await this._wrap(cStore.clear());
    }
    for (const t of payload.transactions) {
      if (merge) {
        const existing = await this._wrap(tStore.get(t.id));
        if (existing && existing.updatedAt >= t.updatedAt) continue;
      }
      await this._wrap(tStore.put(t));
    }
    if (Array.isArray(payload.categories)) {
      for (const c of payload.categories) {
        if (merge) {
          const existing = await this._wrap(cStore.get(c.id));
          if (existing && (existing.updatedAt || 0) >= (c.updatedAt || 0)) continue;
        }
        await this._wrap(cStore.put(c));
      }
    }
  }
};
