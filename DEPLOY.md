# 部署到 PythonAnywhere（含云同步）

把"张婷要省钱"完整托管在 PythonAnywhere 上：
**前端 PWA + 同步 API + SQLite 数据库**全在一个域名下，不再依赖 Firebase。

最终效果：
- 访问 `https://你的用户名.pythonanywhere.com` 即可打开 App
- 多台手机用同一个**同步密钥**就能共享数据
- 数据存在 PA 服务器上的 `server/data/budget.db`（SQLite 单文件）
- 免费档够用（512MB 磁盘 / 每日少量 CPU）

---

## 一、本地先跑一遍（确认能用）

```powershell
cd c:\Users\CherryHuang\budget-app\server
python -m pip install -r requirements.txt
python app.py
```

打开浏览器访问 `http://127.0.0.1:5000`，App 应该正常打开。
然后到 **设置 → 设置 / 启用云同步**：
- 服务器地址：`http://127.0.0.1:5000`（默认会自动填好）
- 同步密钥：自己取一串，比如 `zhangting-2026`

点保存，能看到"同步完成"就 OK。本地测完关掉。

---

## 二、注册 PythonAnywhere

1. 打开 <https://www.pythonanywhere.com> → **Pricing & signup** → **Create a Beginner account**（免费）
2. 注册 → 收邮件验证 → 登录
3. 选一个用户名（这就是你之后的网址 `https://用户名.pythonanywhere.com`）

---

## 三、上传项目代码

最简单的两条路，**任选一条**：

### 方法 A：用 GitHub（推荐，以后改代码也方便）

1. 本地把整个 `budget-app/` 推到一个 GitHub 仓库（可以是 private）
2. PA 顶栏点 **Consoles → Bash**，新建一个 Bash 会话
3. 在 Bash 里输入：
   ```bash
   cd ~
   git clone https://github.com/你的用户名/budget-app.git
   ```

### 方法 B：直接上传 ZIP

1. 本地把 `budget-app/` 整个文件夹打包成 `budget-app.zip`
2. PA 顶栏 **Files** → 上传 zip 到 `/home/你的用户名/`
3. 开 Bash 解压：
   ```bash
   cd ~
   unzip budget-app.zip
   ```

完成后，PA 上目录结构是 `/home/你的用户名/budget-app/`。

---

## 四、安装依赖（创建虚拟环境）

在 Bash 控制台里：

```bash
cd ~/budget-app/server
python3 -m venv ~/.venvs/budget
source ~/.venvs/budget/bin/activate
pip install -r requirements.txt
```

---

## 五、创建 Web App

1. PA 顶栏 → **Web** → **Add a new web app**
2. Domain 默认就是 `你的用户名.pythonanywhere.com`，点 Next
3. 选 **Manual configuration**（不是 Flask 模板，免得它自动建文件）
4. Python version：**3.10** 或更新（选最新的就好）
5. 点 Next 完成

---

## 六、配置 WSGI（关键）

在 Web 页里找到 **Code → WSGI configuration file**，会有一个像
`/var/www/你的用户名_pythonanywhere_com_wsgi.py` 的链接，点开编辑。

**把里面的内容全部清空**，换成下面这段（把 `YOUR_USERNAME` 改成你的实际用户名）：

```python
import sys
import os

USERNAME = 'YOUR_USERNAME'
PROJECT_HOME = f'/home/{USERNAME}/budget-app/server'

if PROJECT_HOME not in sys.path:
    sys.path.insert(0, PROJECT_HOME)

os.chdir(PROJECT_HOME)

from app import app as application
```

保存。

---

## 七、配置虚拟环境路径

回到 Web 页：
- **Virtualenv** 一栏，填：
  ```
  /home/你的用户名/.venvs/budget
  ```
- 点旁边的 ✓ 保存

---

## 八、配置静态文件加速（可选但强烈推荐）

PA 让 web app 直接走 Python 渲染静态文件会浪费 CPU；让 PA 的 nginx 直接服务静态文件更快。

在 Web 页找到 **Static files**，加 4 行（按你的用户名替换路径）：

| URL              | Directory                                |
| ---------------- | ---------------------------------------- |
| `/css/`          | `/home/你的用户名/budget-app/css/`        |
| `/js/`           | `/home/你的用户名/budget-app/js/`         |
| `/assets/`       | `/home/你的用户名/budget-app/assets/`     |
| `/manifest.webmanifest` | `/home/你的用户名/budget-app/manifest.webmanifest` |
| `/service-worker.js` | `/home/你的用户名/budget-app/service-worker.js` |

> 注：最后两条是单文件映射，URL 写完整文件名即可。

---

## 九、Reload 启动

Web 页右上角 **Reload 你的用户名.pythonanywhere.com** 按一下。
访问 `https://你的用户名.pythonanywhere.com`，App 应该就开了。

---

## 十、首次启用云同步

1. 在手机/电脑浏览器打开 `https://你的用户名.pythonanywhere.com`
2. **设置 → 设置 / 启用云同步**
3. 服务器地址会自动填好（就是当前网址）
4. 同步密钥：取一个**长一点**、只有你记得的字符串，比如 `zt-budget-x7Kp9q2m`
5. 保存 → 看到"同步完成"
6. 在第二台设备上，**填同样的服务器地址 + 同样的密钥**，就能共享数据

> ⚠️ **同步密钥就是你数据的口令**，别人猜到就能看你账本。建议 12 位以上，字母数字混合。

---

## 十一、添加到主屏幕（PWA 安装）

- iPhone Safari：打开网址 → 分享按钮 → "添加到主屏幕"
- Android Chrome：打开网址 → 菜单 → "安装应用"

之后从图标启动，无地址栏，跟原生 App 一样。
PA 默认 HTTPS（`*.pythonanywhere.com`），满足 PWA 安装要求。

---

## 十二、之后改代码怎么部署

1. 本地改代码 → push 到 GitHub
2. PA Bash 里：
   ```bash
   cd ~/budget-app
   git pull
   ```
3. Web 页点 **Reload**

> 注意：每次改 `js/` 或 `service-worker.js`，记得把 `service-worker.js` 顶部的 `CACHE_VERSION = 'zt-budget-vNN'` 数字 +1，否则浏览器会用旧缓存。

---

## 十三、备份你的数据

PA 上的 SQLite 数据库就一个文件，路径：
```
/home/你的用户名/budget-app/server/data/budget.db
```

定期通过 PA **Files** 页下载这个文件做备份，或：
```bash
cd ~/budget-app/server/data
cp budget.db budget-$(date +%Y%m%d).db
```

App 内的 **导出 Excel/JSON 备份** 也仍然可用（导出的是本机 IndexedDB 数据）。

---

## 排错

- **打开网址显示 "Something went wrong" / 502**
  → Web 页右下角看 **Error log**，最常见原因：WSGI 文件里的 `USERNAME` / 路径写错。
- **/api/health 返回 404**
  → 静态文件映射可能把所有路径都拦掉了。`/api/` 不要写在 Static files 表里。
- **同步报"HTTP 400 invalid vault key"**
  → 密钥只能 4-64 位字母/数字/`_`/`-`，别用中文或空格。
- **PA 免费档 CPU 用完了**
  → 一般个人记账远到不了。如果到了，升级 Hacker 套餐（$5/月）就解了。

---

## 附：API 速览（给好奇的你）

| Method | Path                                  | 作用                           |
| ------ | ------------------------------------- | ------------------------------ |
| GET    | `/api/health`                         | 心跳，返回 `{ok:true}`         |
| GET    | `/api/sync?vault=KEY&since=TS`        | 拉取 TS 之后所有变更           |
| POST   | `/api/sync?vault=KEY`                 | 上传 `{transactions,categories}` |
| GET    | `/api/vault/KEY/stats`                | 查看金库内数据量               |

数据存在 SQLite，schema 见 `server/app.py`。
