# 张婷要省钱

> 一款简体中文、移动端友好的个人预算与记账 PWA。两地（大陆 / 台湾）账目分别用人民币和台币管理，本地优先 + 云端可选同步。

## 功能一览

- **首页**
  - 顶部显示当月「大陆」「台湾」两张汇总卡（收入 / 支出 / 结余）
  - 月度分类饼图，**点击类别可展开看到该类别下每个项目的明细金额和笔数**
  - 近 6 个月 收入/支出对比柱状图（两地分组）
- **大陆**（人民币 ¥）
  - 月度小结 + 全部明细
  - 一键记一笔：支出/收入 → 类别 → 项目 → 金额 → 日期 → 备注
- **台湾**（台币 NT$）：与大陆页结构一致
- **设置**
  - **字体大小**：小 / 中 / 大 / 特大（影响全 App）
  - **类别管理**：完全可自定义。原 Excel 中所有项目已按照「车、房屋、餐饮…」等中间层分好组，您可以随时增删类别和项目
  - **导出 Excel**：作为 secondary 备份（含「全部明细 / 大陆 / 台湾 / 月度汇总 / 类别配置」5 个工作表）
  - **JSON 备份 / 恢复**
  - **云同步**：Firebase Firestore（可选，需要您填一次配置；多设备共享同一份数据）

## 关于"日期不随时区变化"

记账时**只存"本地日期字符串"**（如 `2026-05-14`），不存 UTC 时间戳。所以您在台湾记录的 5 月 14 日，飞到大陆后看到的还是 5 月 14 日，不会被时区偏移影响。

## 项目结构

```
budget-app/
├─ index.html              # 应用入口（PWA shell）
├─ manifest.webmanifest    # PWA 清单
├─ service-worker.js       # 离线缓存
├─ app-logo.jpeg           # 顶栏 logo
├─ 家庭预算.xlsx           # 原始项目清单（仅供参考）
├─ assets/icons/           # 各尺寸 PWA 图标（由 logo 自动生成）
├─ css/styles.css          # 全部样式（含可调字体变量）
└─ js/
   ├─ defaults.js          # 默认分类（地区 → 类别 → 项目）
   ├─ utils.js             # 工具函数（本地日期、Toast、弹窗等）
   ├─ db.js                # IndexedDB 数据层
   ├─ charts.js            # Chart.js 图表封装
   ├─ export.js            # Excel / JSON 导出
   ├─ cloud.js             # Firebase Firestore 同步
   └─ app.js               # 主 UI 逻辑
```

## 如何使用 / 安装到手机

由于 PWA 必须从 HTTPS（或 localhost）加载，请按以下任一方式之一启动：

### 方式 A：本地预览（同一 WiFi 下可在手机访问）

电脑上需要任意一种静态服务器（任选一个）：

- **Node.js**：`npx serve .`（首次会下载工具）
- **Python**：`python -m http.server 5173`
- **VS Code**：安装 "Live Server" 扩展，右键 `index.html` → Open with Live Server

然后用手机浏览器（iPhone Safari / Android Chrome）打开电脑 IP，例如 `http://192.168.1.10:5173`。

- iPhone：Safari → 分享 → "添加到主屏幕"
- Android：Chrome → 菜单 → "安装应用 / 添加到主屏幕"

### 方式 B：部署到 Web（推荐，可在任何地方使用）

把整个文件夹推到 GitHub，启用 GitHub Pages，或者直接拖到：

- [Netlify Drop](https://app.netlify.com/drop) — 把文件夹拖进去即可拿到一个 HTTPS 网址
- [Vercel](https://vercel.com) — 一键导入仓库
- [Cloudflare Pages](https://pages.cloudflare.com)

部署后在手机浏览器打开网址，"添加到主屏幕"即可像原生 App 一样使用。

## 启用云同步（可选）

数据默认存在手机本地（IndexedDB），不丢但只在本设备上可见。要让大陆设备和台湾设备同步同一份账：

1. 打开 [Firebase 控制台](https://console.firebase.google.com)，新建一个项目（免费）
2. 在项目里开启：
   - **Authentication → 登录方式 → 启用"匿名"**
   - **Firestore Database → 创建数据库**（任选区域，从测试模式开始）
3. 把 Firestore **安全规则**设为：
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /vaults/{vault}/{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
4. **项目设置 → 您的应用 → Web App**，复制 `firebaseConfig` 这块 JSON
5. 在 App 里：设置 → 设置 / 启用云同步 → 粘贴 JSON + 填一个"同步密钥"（您自己想一个字符串，如 `zhangting-2026`）
6. 在另一台手机上用**完全相同的 Firebase 配置 + 同步密钥**就能共享同一份数据

> 同步采用「以 `updatedAt` 为准的双向合并」，离线照常记账，联网后点"立即同步"即可。

## 默认类别（已按家庭预算.xlsx 整理）

**大陆 · 支出**：房屋 / 餐饮 / 服装 / 车 / 医疗 / 美容 / 交通 / 红包 / 其他  
**大陆 · 收入**：工作收入 / 红包 / 投资理财 / 其他  
**台湾 · 支出**：房屋 / 车 / 餐饮 / 购物 / 交通 / 医疗 / 社保 / 其他  
**台湾 · 收入**：房产 / 其他  

每个类别下都已经填好对应的"项目"，例如「车」里有：车险 / 车保养 / 车加油 / 车维修。任何项目都可以在「设置 → 类别管理」里增删改。

## 浏览器兼容

- iOS Safari 15+
- Android Chrome 100+
- 桌面 Chrome / Edge / Firefox 最新版

## License

Personal use.
