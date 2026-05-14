"""
张婷要省钱 · 后端
- 服务静态前端文件（index.html、css/js/assets/...）
- 提供云同步 API（基于 SQLite，单文件存储）

在 PythonAnywhere / 本机均可运行：
    本机:     python app.py
    PA 部署:  通过 wsgi.py 引用，由 Web tab 配置 WSGI 启动
"""

from flask import Flask, request, jsonify, send_from_directory, abort
import sqlite3
import json
import time
import re
import os

APP_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(APP_DIR)           # budget-app/
DATA_DIR = os.path.join(APP_DIR, 'data')
DB_PATH = os.path.join(DATA_DIR, 'budget.db')

os.makedirs(DATA_DIR, exist_ok=True)

# static_folder = budget-app/ ：让 / 直接服务前端 PWA
app = Flask(__name__, static_folder=ROOT_DIR, static_url_path='')

# vault（"金库"）名称的合法字符：英文字母、数字、下划线、短横线
VAULT_PATTERN = re.compile(r'^[A-Za-z0-9_\-]{4,64}$')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS transactions (
            vault TEXT NOT NULL,
            id TEXT NOT NULL,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (vault, id)
        );
        CREATE INDEX IF NOT EXISTS idx_tx_updated ON transactions(vault, updated_at);

        CREATE TABLE IF NOT EXISTS categories (
            vault TEXT NOT NULL,
            id TEXT NOT NULL,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (vault, id)
        );
        CREATE INDEX IF NOT EXISTS idx_cat_updated ON categories(vault, updated_at);
    """)
    conn.commit()
    conn.close()


init_db()


def check_vault(vault):
    if not vault or not VAULT_PATTERN.match(vault):
        abort(400, description='vault key 不合法：4-64 位英文/数字/_/-')


# 允许跨域，便于在不同域托管前端时也能用
@app.after_request
def add_cors_headers(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    resp.headers['Access-Control-Max-Age'] = '86400'
    return resp


# ============ API ============
@app.route('/api/health', methods=['GET', 'OPTIONS'])
def health():
    if request.method == 'OPTIONS':
        return '', 204
    return jsonify({'ok': True, 'serverTime': int(time.time() * 1000)})


@app.route('/api/sync', methods=['GET', 'POST', 'OPTIONS'])
def sync():
    if request.method == 'OPTIONS':
        return '', 204

    vault = (request.args.get('vault') or '').strip()
    check_vault(vault)

    conn = get_db()
    try:
        if request.method == 'GET':
            try:
                since = int(request.args.get('since', '0') or 0)
            except ValueError:
                since = 0
            tx_rows = conn.execute(
                'SELECT data FROM transactions WHERE vault=? AND updated_at>? ORDER BY updated_at',
                (vault, since)
            ).fetchall()
            cat_rows = conn.execute(
                'SELECT data FROM categories WHERE vault=? AND updated_at>? ORDER BY updated_at',
                (vault, since)
            ).fetchall()
            return jsonify({
                'transactions': [json.loads(r['data']) for r in tx_rows],
                'categories':   [json.loads(r['data']) for r in cat_rows],
                'serverTime':   int(time.time() * 1000)
            })

        # POST：上传一批本地变更
        payload = request.get_json(silent=True) or {}
        transactions = payload.get('transactions') or []
        categories   = payload.get('categories') or []
        now = int(time.time() * 1000)

        accepted_tx = 0
        for t in transactions:
            if not isinstance(t, dict) or 'id' not in t:
                continue
            tid = str(t['id'])
            try:
                updated = int(t.get('updatedAt') or now)
            except (TypeError, ValueError):
                updated = now
            existing = conn.execute(
                'SELECT updated_at FROM transactions WHERE vault=? AND id=?',
                (vault, tid)
            ).fetchone()
            if existing and existing['updated_at'] >= updated:
                # 服务器版本更新或一样新，跳过
                continue
            conn.execute(
                'INSERT OR REPLACE INTO transactions(vault, id, data, updated_at) VALUES(?, ?, ?, ?)',
                (vault, tid, json.dumps(t, ensure_ascii=False), updated)
            )
            accepted_tx += 1

        accepted_cat = 0
        for c in categories:
            if not isinstance(c, dict) or 'id' not in c:
                continue
            cid = str(c['id'])
            try:
                updated = int(c.get('updatedAt') or now)
            except (TypeError, ValueError):
                updated = now
            existing = conn.execute(
                'SELECT updated_at FROM categories WHERE vault=? AND id=?',
                (vault, cid)
            ).fetchone()
            if existing and existing['updated_at'] >= updated:
                continue
            conn.execute(
                'INSERT OR REPLACE INTO categories(vault, id, data, updated_at) VALUES(?, ?, ?, ?)',
                (vault, cid, json.dumps(c, ensure_ascii=False), updated)
            )
            accepted_cat += 1

        conn.commit()
        return jsonify({
            'ok': True,
            'acceptedTransactions': accepted_tx,
            'acceptedCategories':   accepted_cat,
            'serverTime': now
        })
    finally:
        conn.close()


# 简单的"金库统计"端点（看看自己的数据量）
@app.route('/api/vault/<vault>/stats', methods=['GET'])
def vault_stats(vault):
    check_vault(vault)
    conn = get_db()
    try:
        tx_count = conn.execute('SELECT COUNT(*) AS n FROM transactions WHERE vault=?', (vault,)).fetchone()['n']
        cat_count = conn.execute('SELECT COUNT(*) AS n FROM categories WHERE vault=?', (vault,)).fetchone()['n']
        last_tx = conn.execute(
            'SELECT MAX(updated_at) AS t FROM transactions WHERE vault=?', (vault,)
        ).fetchone()['t']
        return jsonify({
            'vault': vault,
            'transactions': tx_count,
            'categories':   cat_count,
            'lastUpdatedAt': last_tx or 0
        })
    finally:
        conn.close()


# ============ 静态前端 ============
@app.route('/')
def index():
    return send_from_directory(ROOT_DIR, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    # 防止 /api/* 走到这里（Flask 路由优先级会先匹配 /api/...，所以一般不会进来）
    if path.startswith('api/'):
        abort(404)
    full = os.path.join(ROOT_DIR, path)
    if not os.path.exists(full) or os.path.isdir(full):
        # PWA fallback：路由不存在时回到 index.html
        return send_from_directory(ROOT_DIR, 'index.html')
    return send_from_directory(ROOT_DIR, path)


# 本机开发：python app.py
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
