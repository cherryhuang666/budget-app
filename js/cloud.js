// 云端同步（自建 Flask 后端）
//
// 设置：用户在"设置 → 云同步"里填两项：
//   - 服务器地址（例如 https://username.pythonanywhere.com）
//   - 同步密钥 syncKey（自己取，4~64 位字母/数字/_/-；多设备用同一个密钥即可共享）
//
// 通信协议：
//   GET  {serverUrl}/api/sync?vault={syncKey}&since={lastSyncAt}
//     → { transactions:[...], categories:[...], serverTime }
//   POST {serverUrl}/api/sync?vault={syncKey}
//     body: { transactions:[...], categories:[...] }
//     → { ok, acceptedTransactions, acceptedCategories, serverTime }
//
// 冲突解决：以 updatedAt 较大者为准（两端独立时间戳）

const Cloud = {
  serverUrl: null,
  vaultKey: null,
  ready: false,
  _syncing: false,
  _autoSyncTimer: null,

  async init() {
    const url = await DB.getMeta('serverUrl');
    const key = await DB.getMeta('syncKey');
    if (!url || !key) {
      this.ready = false;
      return false;
    }
    this.serverUrl = String(url).replace(/\/$/, '');
    this.vaultKey = key;
    this.ready = true;
    return true;
  },

  async setup({ serverUrl, syncKey }) {
    const url = String(serverUrl || '').trim().replace(/\/+$/, '');
    const key = String(syncKey || '').trim();
    if (!/^https?:\/\/.+/.test(url)) {
      throw new Error('服务器地址需以 http:// 或 https:// 开头');
    }
    if (!/^[A-Za-z0-9_\-]{4,64}$/.test(key)) {
      throw new Error('同步密钥仅支持字母/数字/_/-，长度 4~64');
    }
    // 先 ping 一下健康检查接口，验证可达
    const r = await fetch(`${url}/api/health`, { method: 'GET' });
    if (!r.ok) throw new Error(`服务器无响应（HTTP ${r.status}）`);
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) throw new Error('服务器返回格式异常');

    await DB.setMeta('serverUrl', url);
    await DB.setMeta('syncKey', key);
    await this.init();
    return true;
  },

  async disable() {
    await DB.setMeta('serverUrl', null);
    await DB.setMeta('syncKey', null);
    await DB.setMeta('lastSyncAt', null);
    this.serverUrl = null;
    this.vaultKey = null;
    this.ready = false;
  },

  async _request(method, query = '', body = null) {
    const url = `${this.serverUrl}/api/sync?vault=${encodeURIComponent(this.vaultKey)}${query ? '&' + query : ''}`;
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const t = await r.text(); if (t) msg += ': ' + t.slice(0, 200); } catch (_) {}
      throw new Error(msg);
    }
    return r.json();
  },

  async syncNow() {
    if (!this.ready) {
      const ok = await this.init();
      if (!ok) throw new Error('云同步未启用');
    }

    this._syncing = true;
    this._updateStatusLabel('同步中…');

    const lastSyncAt = (await DB.getMeta('lastSyncAt')) || 0;
    let pushed = 0, pulled = 0;

    // ===== 1) 拉取远端 since 之后的变更 =====
    const pull = await this._request('GET', `since=${lastSyncAt}`);
    const db = await DB.open();
    const txStore = (mode) => db.transaction(['transactions'], mode).objectStore('transactions');
    const catStore = (mode) => db.transaction(['categories'], mode).objectStore('categories');

    for (const remote of (pull.transactions || [])) {
      if (!remote || !remote.id) continue;
      const existing = await DB._wrap(txStore('readonly').get(remote.id));
      if (!existing || (existing.updatedAt || 0) < (remote.updatedAt || 0)) {
        await DB._wrap(txStore('readwrite').put(remote));
        pulled++;
      }
    }
    for (const remote of (pull.categories || [])) {
      if (!remote || !remote.id) continue;
      const existing = await DB._wrap(catStore('readonly').get(remote.id));
      if (!existing || (existing.updatedAt || 0) < (remote.updatedAt || 0)) {
        await DB._wrap(catStore('readwrite').put(remote));
      }
    }

    // ===== 2) 推送本地 since 之后的变更 =====
    const allTx = await DB._wrap(txStore('readonly').getAll());
    const allCat = await DB._wrap(catStore('readonly').getAll());
    const txToPush = allTx.filter(t => (t.updatedAt || 0) > lastSyncAt);
    const catToPush = allCat.filter(c => (c.updatedAt || 0) > lastSyncAt);

    if (txToPush.length > 0 || catToPush.length > 0) {
      // 分批推送，单批最多 200 条，防止 payload 过大
      const BATCH = 200;
      const txs = txToPush.slice();
      const cats = catToPush.slice();
      while (txs.length > 0 || cats.length > 0) {
        const chunk = {
          transactions: txs.splice(0, BATCH),
          categories: cats.splice(0, BATCH)
        };
        await this._request('POST', '', chunk);
        pushed += chunk.transactions.length + chunk.categories.length;
      }
    }

    await DB.setMeta('lastSyncAt', pull.serverTime || Date.now());
    this._syncing = false;
    this._updateStatusLabel();
    // 触发 UI 刷新（拉下来的远端变更要显示出来）
    document.dispatchEvent(new CustomEvent('data-changed', { detail: { fromSync: true } }));
    return { pushed, pulled };
  },

  // 防抖式自动同步：数据变更后延迟一小段时间触发，多次变更合并成一次同步
  scheduleAutoSync(delay = 2500) {
    if (!this.ready) return;
    if (this._syncing) return; // 正在同步，跳过
    if (this._autoSyncTimer) clearTimeout(this._autoSyncTimer);
    this._autoSyncTimer = setTimeout(() => this._doAutoSync(), delay);
  },

  async _doAutoSync() {
    this._autoSyncTimer = null;
    if (this._syncing) return;
    try {
      await this.syncNow();
    } catch (e) {
      // 自动同步失败不打扰用户，只更新状态标签
      console.warn('[cloud] auto-sync failed:', e);
      this._syncing = false;
      this._updateStatusLabel('已启用 · 上次同步失败');
    }
  },

  _updateStatusLabel(forceText) {
    const el = document.getElementById('cloud-status-label');
    if (!el) return;
    if (forceText) { el.textContent = forceText; return; }
    this.statusLabel().then(s => { el.textContent = s; });
  },

  async stats() {
    if (!this.ready) {
      const ok = await this.init();
      if (!ok) return null;
    }
    try {
      const r = await fetch(`${this.serverUrl}/api/vault/${encodeURIComponent(this.vaultKey)}/stats`);
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  },

  async statusLabel() {
    const url = await DB.getMeta('serverUrl');
    const key = await DB.getMeta('syncKey');
    if (!url || !key) return '未启用';
    const last = await DB.getMeta('lastSyncAt');
    if (!last) return '已启用 · 未同步';
    return `已启用 · ${new Date(last).toLocaleString('zh-CN')}`;
  }
};
