# Sylveris · 春林冷知

> cold.sylveris.top —— 一个安静的冷知识 / 冷笑话 / 废话文学站。
> 简约小清新，纯中文，零外部 UI 库。

页面在请求时从数据库渲染，后台上传写好的文本文档即可自动排期上线。

---

## 技术方案

| 项 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 18 | 无需全局依赖 |
| 页面渲染 | `api/render.js` 动态渲染 | vercel.json rewrite 把页面请求转给它，数据取自数据库 |
| 样式 | 手写 CSS（`public/assets/css/style.css`） | 无 Tailwind / 无组件库 |
| 交互 | 原生 JS（`public/assets/js/site.js`） | 无 React / 无打包器 |
| 存储 | Turso 免费版（云端）→ 本地 JSON 回落（本地） | 内容、排期、投稿、密码哈希、访问计数 |
| 后台 | 隐藏路径 + scrypt 密码哈希 + HMAC 令牌 | 密码明文永不落库 |
| 部署 | Vercel Hobby（免费） | 静态资源 + 函数一体 |
| 应急 | `npm run build:static` | 一键切回全量静态站，脱离数据库也能跑 |

内容模型：每条内容带 `publish_at`（上线日期，按北京时间「今天」判定）。
`status=queued` 且 `publish_at <= 今天` 即为已上线，页面才可见；
未来日期的条目只在后台可见，**不会提前泄露给搜索引擎和访客**。

- 一天一条自动排期：导入时按「明天 → 后天 → …」依次占位。
- 插队：把某条挪到**次日**，后面已排期的内容整体顺延一天，队列不留空档。
- CDN 缓存 5 分钟：改内容最迟 5 分钟后全网生效，无需部署。

---

## 目录结构

```
春林冷知/
├── data/                   # 内容（首次导入用的种子）
│   ├── site.js             # 站点名、域名、关键词
│   ├── facts.js            # 冷知 48 条
│   ├── feihua.js           # 废话 32 句
│   └── jokes.js            # 冷笑话 22 条
├── public/                 # 静态资源源码（CSS / JS / 图标）
├── lib/
│   ├── html.mjs            # head / 页头页脚 / SEO 模板
│   ├── pages.mjs           # 全部页面渲染函数（动态与静态共用）
│   ├── content.mjs         # 内容装载：数据库优先 → 种子兜底
│   ├── db.mjs              # 存储层：内容、排期、投稿、设置
│   ├── parse.mjs           # 上传文档解析（分段文本 / JSON）
│   ├── auth.mjs            # 密码哈希、令牌、登录限流
│   └── config.mjs          # 后台路径、北京时间、缓存策略
├── api/
│   ├── render.js           # 动态渲染入口（一切页面请求）
│   ├── submit.js           # POST 投稿（限流 + 蜜罐 + 校验）
│   └── admin.js            # 后台接口（登录 / 导入 / 编辑 / 插队 / 审核）
├── scripts/
│   ├── build.mjs           # 默认=只出资源；--static=全量静态兜底
│   ├── serve.mjs           # 本地服务（与云端同构：资源 + API + 渲染）
│   ├── seed.mjs            # 把 data/*.js 灌进数据库（只跑一次）
│   ├── set-password.mjs    # 设置/重置后台密码（只存哈希）
│   ├── check.mjs           # 冒烟测试（只读 43 项 / --admin 61 项）
│   ├── check-schedule.mjs  # 排期/插队语义测试（12 项）
│   └── make-icons.mjs      # 重新生成图标
├── dist/                   # 构建产物（git 忽略）
├── vercel.json             # Vercel 配置（含 rewrite）
└── package.json
```

---

## 本地调试

```bash
# 1. 安装依赖（只有 Turso 客户端一个可选依赖，可跳过）
npm install

# 2. 设置后台密码（只存哈希；本地写 data/store.json）
npm run set-password -- 你的密码

# 3. 启动本地服务 → http://localhost:5173
npm run serve

# 4. 后台：http://localhost:5173/admin-z-banana/（以 .env 的 ADMIN_PATH 为准）
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run serve` | 启动本地服务（页面实时从数据渲染，改完刷新即可） |
| `npm run serve -- 5175` | 换端口启动（5173 被占用时用） |
| `npm run set-password` | 设置/重置密码（`-- --check` 查看是否已设置） |
| `npm run seed` | 首次把 `data/*.js` 导入数据库（已有内容会跳过） |
| `npm run check` | 冒烟测试（页面 / SEO / 后台隐藏 / 访问上报，只读 43 项） |
| `npm run check -- --admin` | 后台全链路：导入 / 编辑 / 插队 / 审核（跑完自动清理并还原线上排期，61 项） |
| `npm run check:schedule` | 排期/插队语义专项（12 项，跑完自动清理并还原排期） |
| `npm run check:security` | 安全自检（13 项：明文不留存 / scrypt / 限流 / 令牌；跑完需重启服务清限流） |
| `npm run check -- 5175` | 指定端口 |
| `npm run build` | 只复制静态资源到 `dist/`（云端默认构建） |
| `npm run build:static` | 生成全量静态站（应急兜底） |
| `npm run serve:static` | 用静态兜底产物起服务（需先 `build:static`） |
| `npm run icons` | 重新生成网站图标 |

本地服务是**热重启**的：改 `lib/` `api/` `scripts/` 里的代码会自动重启（约 0.3 秒），
改 `public/` 下的 CSS/JS 刷新页面即可，不用手动重启。

响应头 `X-Serve` 可以看出当前页面来自哪里：`render` = 动态渲染，`static` = 读 `dist/` 静态页，`asset` = 静态资源。

本地未配置 Turso 时，数据写入 `data/store.json`；配置后自动改用 Turso。

**已知坑**：本机 PowerShell 可能挂起，请用 cmd 执行：
`cmd /c "cd /d <项目目录> && node scripts\build.mjs"`

---

## 云端部署（Vercel，零花费）

### 1. 导入项目

推到 GitHub，或用 `vercel cli` 直接上传，Vercel 选 **Hobby（免费）** 计划。

### 2. 构建参数

| 参数 | 值 |
| --- | --- |
| Framework Preset | **Other** |
| Build Command | `node scripts/build.mjs` |
| Output Directory | `dist` |
| Install Command | `npm install` |

`vercel.json` 已固化 rewrite、安全响应头、缓存策略与重定向，一般无需再改。

关键的一条 rewrite（已写好）：

```json
{ "source": "/:path((?!api/).*)", "destination": "/api/render?path=/:path" }
```

页面请求先找 `dist/` 静态文件，找不到就交给 `api/render.js` 动态渲染。
默认构建只出资源，所以**所有页面都走渲染层**，改内容不用重新部署。

### 3. 环境变量（Project → Settings → Environment Variables）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | 是（云端） | `libsql://xxx.turso.io` |
| `TURSO_AUTH_TOKEN` | 是（云端） | Turso API token |
| `ADMIN_PATH` | 否 | 后台路径，默认 `/linjian-7c4f/` |
| `ADMIN_TOKEN` | 否 | 兼容用：给 curl 当 Bearer 用，与密码登录二选一 |
| `STATIC_FALLBACK` | 否 | 设为 `1` 切换到全量静态构建（应急） |

不配 Turso 时页面会回落到 `data/*.js` 内置种子——站点不会白屏，
但**后台上传的内容将无法保存**，所以云端务必配置。

### 4. 建库（Turso 免费版）

```bash
npm i -g @libsql/cli

turso db create chunlin-cold
turso db show chunlin-cold --url
turso db tokens create chunlin-cold
```

表结构由 `lib/db.mjs` 首次连接时自动创建（`submissions` / `content` / `settings`）。

### 5. 首次上线步骤

```bash
# 本地配好 .env（TURSO_DATABASE_URL / TURSO_AUTH_TOKEN）后：
npm run seed              # 把现有 102 条内容导入数据库（按原日期，全部已上线）
npm run set-password      # 设置后台密码（只存哈希）
# 然后部署，打开 https://cold.sylveris.top/<后台路径>/ 登录即可
```

### 6. 域名

Project → Settings → Domains → 添加 `cold.sylveris.top`，
到域名服务商加 CNAME 指向 `cname.vercel-dns.com`。

---

## 后台使用

### 进入口

- 路径默认 `/linjian-7c4f/`，可用环境变量 `ADMIN_PATH` 改成任意难猜的地址。
- 全站没有任何链接指向它；`robots.txt` 里 `Disallow`；不进 sitemap；页面 `noindex` + `no-store`。
- 密码存的是 scrypt 哈希（随机盐），数据库里看不到明文；连续错 10 次锁 10 分钟。
- 登录成功拿到 7 天有效的签名令牌，改密码会立刻让所有已登录会话失效。

### 四个页签

**① 上传导入**
把 AI 写好的 `.txt` 或 `.json` 拖进来（或粘贴）→「解析预览」→ 检查识别结果和排期 →「确认入库」。
入库后从**次日**起一天一条自动排期；也可指定起始日期。
解析失败的段落会红色列出，不会写进数据库。

**② 内容库**
按「待上线 / 已上线 / 草稿」筛选、搜索、编辑（标题、正文、来源、标签、日期、状态）、
「插队（次日）」把某条提到明天并顺延后面所有排期、删除。

**③ 投稿审核**
访客投稿在这里；「通过（次日插队上线）」会自动占用次日槽位，
并标记 `来自林间投稿`；「退回」不再展示。

**④ 访问统计**
今日 / 昨日 / 近 30 天访问次数，以及按天、按板块（首页、冷知、冷笑话……）的分布。
数据由页面脚本每次加载时上报一次，服务端按「日期 + 板块」累加：
**只记次数，不存 IP、不存 UA、不存任何可识别信息**，并已过滤已知爬虫；
跨站 Origin 直接拒绝。后台页自己不上报，看后台不会把数字刷上去。

### 给 AI 的提示词模板

后台「上传导入」里可一键复制，内容如下：

```
你是冷知识编辑。按下面格式输出，用 --- 分隔每条，一次给 N 条：

【冷知】
标题：一句话标题（12 字以内）
正文：一段 80~200 字的冷知识，最后一句收个尾。
来源：书名 / 资料方向
标签：两个标签，用中文逗号隔开
废话：一句相关的废话（可空）
---
【冷笑话】
分类：动物 / 生活 / 文字梗
题目：题目
正文：完整的梗，别太长
---
【废话】
正文：一句说了等于没说的话
标签：关键词
```

也支持 JSON：`[{ "kind":"fact", "title":"…", "body":"…", "tags":["…"], "source":"…" }]`。
字段别名（`题目`/`内容`/`category` 等）都会被自动识别；只有一行短文本时会自动当正文。

---

## SEO 已做事项 / 上线后要做的

已内置：

- 独立 title / description / canonical / 关键词 meta
- Open Graph + Twitter Card
- Article / WebSite / BreadcrumbList / FAQPage / CollectionPage / AboutPage JSON-LD
- `sitemap.xml`、`rss.xml`、`robots.txt`（动态生成，含最新内容）
- `cleanUrls`、语义化标签、`lang="zh-CN"`，无 JS 也能读全内容
- 未来排期内容不进 sitemap / index.json，不会被提前抓取
- 后台路径不进 sitemap、被 robots 屏蔽、页面 `noindex`

Lighthouse 实测：**Accessibility 100 / SEO 100 / Best Practices 100**。

上线后手动做：

1. Google Search Console → 提交 `https://cold.sylveris.top/sitemap.xml`
2. 百度站长平台 → 提交 sitemap（可加主动推送）
3. Bing Webmaster Tools → 提交 sitemap

---

## 内容维护

**日常（推荐）**：进后台上传 AI 文档即可，页面、sitemap、RSS 自动更新，无需构建。

**种子数据**：`data/*.js` 只在首次 `npm run seed` 时用到，之后改它不影响线上。

- 改站名/域名/关键词：`data/site.js`
- 改样式：`public/assets/css/style.css`（改完部署后 CDN 约 1 小时内刷新）

---

## 应急回退（数据库故障时）

页面渲染本身就有双保险：数据库不可用时自动回落 `data/*.js` 种子，站点不会白屏。

如果连 Serverless 都不可用，可切到纯静态：

```bash
# 本地
npm run build:static     # 用数据库（或种子）生成 66 个静态页
npm run serve:static     # 起服务验证：响应头 X-Serve 会变成 static
```

或在 Vercel 上把环境变量 `STATIC_FALLBACK=1`、Build Command 改成
`node scripts/build.mjs --static` 后 Redeploy —— 页面会从 `dist/` 直接读取，
后台接口仍然可用。恢复后删掉该变量即回到动态渲染。

---

## 已知说明

- 动效仅保留：首屏淡入、按钮悬停变色；并遵循 `prefers-reduced-motion`。
- 无积分、无排行、无弹窗、无深浅色切换、无 Emoji 装饰。
- 投稿有蜜罐字段 + 频率限制（5 次 / 10 分钟 / IP）。
- 验收：`npm run check -- --admin` 61 项、`npm run check:schedule` 12 项、`npm run check:security` 13 项，合计 **86 项**（`npm run check` 不加 `--admin` 是 43 项只读冒烟）。
