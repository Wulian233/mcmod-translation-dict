<div align="center">
  <img height="150" src="frontend/favicon.ico"/>
</div>

# MC模组翻译参考词典

## 关于本项目

本项目旨在解决两个核心问题：

一方面，为了适应 CFPA 团队翻译数据的持续更新扩充，
同时应对原[MC百科](https://dict.mcmod.cn/)数据更新缓慢、页面使用不便的现状，
我们以MC百科版功能和页面为参照开发了开源网页版本，不仅完整保留原有功能，还新增了**中英互查、暗色模式、移动端适配、加强版数据库**等增强特性；

另一方面，针对部分热门 Minecraft 模组（如机械动力）的简体中文翻译由开发者直接维护（而非通过CFPA社区协作），
导致 CFPA 官方维护的MC百科模组词典（数据源为 i18n-dict）存在更新滞后或内容缺失的问题。
本项目通过使用[加强版的数据库](https://github.com/VM-Chinese-translate-group/i18n-Dict-Extender)，有效弥补了这一缺口。

欢迎各路大佬高手为本项目提出建议和意见，或参与贡献！

## 功能特色

- 智能搜索，搜索结果按输入匹配度和出现次数综合排序，支持按 modid 筛选搜索结果
- 多种模式，支持英查中和中查英两种模式译文互查
- 智能合并，智能识别同一模组的不同版本译文并统一展示
- 自动分页，一页50条结果，网页下方支持快速跳转首页/尾页
- 记录键名，鼠标悬停在`所属模组`条目上方时会显示译文对应的键名
- 及时更新的数据源
- 页面美观，支持暗色模式，并且对手机上的显示效果进行了单独优化

## 技术细节

我们建议开发者搭建属于自己的 API。由于词典数据库过于庞大，超过七十万行，
以及 Cloudflare Worker 的免费限制，一天能查询的数量有限，如果过多的用户查询很有可能不堪重负。

本项目网站关于部署及注意事项均在下面列出，供有兴趣的开发者搭建自己的版本。

### 前端

所需环境：NodeJS

本项目前端网页使用 Vue + JS 编写，并使用 Vite 作为本地开发服务器与构建工具。
请使用下面的命令安装依赖并启动本地开发服务器：

```bash
npm install
npm run dev
```

本项目将其托管在了 Vercel 上并连接了 Github 仓库，仓库推送更新自动同步项目页面。

API 地址通过环境变量 `VITE_API_BASE_URL` 配置。本地开发时，在仓库根目录的
`.env.local` 中设置 API 地址（不要附加 `/search`，该文件不提交到 Git）：

```dotenv
VITE_API_BASE_URL=https://api.vmct-cn.top
```

未设置或留空时使用默认地址 `https://api.vmct-cn.top`，地址末尾的 `/` 会自动去除。
在 Vercel 项目的环境变量中设置同名变量即可覆盖默认地址。
该值会在构建时写入前端；修改后需要重新部署，本地开发则需要重启开发服务器。
参见 [Vite 环境变量说明](https://vite.dev/guide/env-and-mode)。

另外还在前端做了速率限制（可配置时间），每秒最多搜索一次。

### 后端

所需环境：Node.js 22+、Python 3.10+、Cloudflare Worker、D1，以及支持 FTS5/trigram 的 SQLite 3。

新版 Worker 只读取以下三张搜索表：

| 表                    | 用途                                       | 是否手工编辑 |
| :-------------------- | :----------------------------------------- | :----------- |
| `dict_search`         | 聚合后的译文、原文、模组、版本、Key 等数据 | 否           |
| `dict_search_fts`     | 英文分词与前缀搜索索引                     | 否           |
| `dict_search_trigram` | 三个字及以上的中文子串索引                 | 否           |

### 完整初始化或重建

这一流程适用于首次部署，或旧 `dict_search` 缺列、规则已经不兼容的情况。
建议创建一个新的 D1，验证完毕后再修改 `backend/wrangler.jsonc` 的 `database_id` 并部署，
这样旧站点在准备期间仍可使用。完整初始化写入量很大，不适合直接在 D1 Free 上一次完成。

1. 下载 i18n Dict Extender 最新的 `Dict-Sqlite.db`，并从
   [SQLite 官网](https://www.sqlite.org/download.html)安装 SQLite Tools。

2. 将 SQLite 数据库转为 UTF-8 SQL：

   ```shell
   sqlite3 Dict-Sqlite.db ".output input.sql" ".dump"
   ```

   Windows PowerShell 不要使用 `> input.sql`；让 sqlite3 自己写文件可避免中文乱码。

3. 使用 [SQL Cleaner Release](https://github.com/Wulian233/mcmod-translation-dict/releases/tag/sql_cleaner)
   清理 `input.sql`。程序会生成 `Dict-Sqlite.sql`；源代码位于 [sql_cleaner](sql_cleaner/)。

4. 创建新 D1，将下面的数据库名替换为新库名称，然后导入原始数据并构建搜索投影：

   ```shell
   cd backend
   npx wrangler d1 create new-dict-db
   npx wrangler d1 execute new-dict-db --remote --file=../Dict-Sqlite.sql
   npx wrangler d1 execute new-dict-db --remote --file=./schema/search-indexes.sql
   ```

   `search-indexes.sql` 只用于一个尚未包含搜索表的空目标；它故意不会覆盖已有搜索表。
   任一步失败都不要切换 Worker。完成后按上一节第 4 步验证，再更新 `wrangler.jsonc` 并部署。

### 以后维护：只上传增量

新版 Worker 不读取原始 `dict`。日常更新在本地从新版 `Dict-Sqlite.db` 聚合数据，
再比较线上 `dict_search`，只向 D1 写入新增、删除或元数据有变化的译文对。
以下命令均在 `backend` 目录执行。

1. 第一次使用增量工具时，导出线上投影的真实 rowid，并建立本地基线：

   ```shell
   npx wrangler d1 execute prod-d1-tutorial --remote --command "SELECT rowid AS rowid, * FROM dict_search ORDER BY rowid" --json | Out-File -Encoding utf8 baseline.json
   python tools/search_snapshot.py baseline-json --input baseline.json --output deployed.db
   ```

   只需建立一次基线。普通 `.dump` 不保证保留有空洞的隐式 rowid，不能代替这一步。

2. 下载新的 `Dict-Sqlite.db`，在本地生成差异 SQL 和候选基线：

   ```shell
   python tools/search_snapshot.py diff --source Dict-Sqlite.db --baseline deployed.db --output delta.sql --candidate candidate.db
   ```

   工具完全在本地运行，不会连接 Cloudflare。默认估算写入超过 50,000 时会拒绝生成结果；
   估算值不是 D1 的最终计费值，执行前仍应在 D1 Metrics 中检查账户余量。

3. 确保只有这一条更新流水线在运行，然后上传增量：

   ```shell
   npx wrangler d1 execute prod-d1-tutorial --remote --file=delta.sql --json
   ```

   若出现 `search snapshot baseline mismatch` 或额度错误，应立即停止并检查线上状态，
   不要忽略失败继续执行，也不要提前使用候选基线。拆分批次不会重置每日额度。

4. 所有语句成功、线上搜索也验证通过后，用 `candidate.db` 替换本地的 `deployed.db`，
   作为下一次更新基线。中途失败时继续保留原来的 `deployed.db`。

增量工具只维护三张搜索表，不会更新线上旧 `dict`。这不是遗漏：新版 Worker 的运行数据源就是
`dict_search`。如果仍希望保存最新原始库，建议把 `.db` 作为发布产物或对象存储归档，而不是每次写入 D1。

## API 接口文档

### 切换数据源：加强版 / MC百科

英查中时，搜索框右下方的小型文字按钮可切换数据源；中查英隐藏切换，固定使用加强版。
加强版继续请求 `VITE_API_BASE_URL/search`。**百科 HTML 清洗、合并、筛选和分页全部在用户浏览器完成**，
不再请求 `api.vmct-cn.top/search?source=mcmod`，也不需要升级 D1 Worker。

```text
加强版：浏览器 → VITE_API_BASE_URL/search → JSON
百科：  浏览器 → 同站 /api/mcmod?q=bee → 百科原始 HTML → 浏览器本地转换
```

`api/mcmod.js` 仅转发原始 HTML 字节，不解析或转换数据。之所以保留这个传输层，
是因为百科检查 Referer：实测外站 Referer 或不带 Referer 时返回200空正文，
带 `https://dict.mcmod.cn/` 时才有结果。其 CORS 会回显请求 Origin，
但普通网页不能把 Referer 设置成其他站点，故不能仅靠浏览器 fetch 直接访问。

**部署**：Vercel 项目 Root Directory 设为仓库根目录，提交根目录 `api/`、`vercel.json`
及前端代码后重新部署即可；`vercel.json` 配置构建输出为 `dist`，函数与前端同次部署。
仅上传 `dist` 到纯静态托管不包含转发接口，需要自行部署等效的 `/api/mcmod`。
本地 `pnpm dev` 和 `pnpm exec vite preview` 已接入相同转发函数。

英查中遇到加强版网络错误、15秒超时、无效 JSON、HTTP 429 或 5xx 时，
自动尝试百科一次，从第一页开始，保留搜索词与模组筛选，成功后更新数据源提示。
中查英、空结果、参数错误、取消请求不触发切换；两边失败显示错误。
百科转发独立于 D1 Worker，加强版 API 故障时仍可尝试百科。

#### 接口实测（2026-09-27）

来源：[首页](https://dict.mcmod.cn/)脚本及[PHP 搜索接口](https://dict.mcmod.cn/connection/search.php)响应。
请求为表单 POST：`key=bee&max=100&range=1`。HTML 包含统计段落和四列表格，
`<code>` 是高亮，`<tr title>` 为整行 Key，模组之间以 `<br>` 分隔。

- 线上加强版接口即使带 `source=mcmod` 仍返回加强版 JSON、无 `source` 标记；
  原先“未支持百科”提示由此产生，不能把这些结果标记为百科。
- `range=2/3` 未观察到生效：中文“石头”“铁锭”无结果，`range=2` 的 `stone` 仍查英文。
- `stone` 统计5,270个匹配，但只返回100行；`max=2` 实测也返回100行，未发现可用分页参数。
- 首页标注更新于2025-07-27，数据提供者 CFPA，许可 CC BY-NC-SA 4.0。

#### 浏览器转换规则

`frontend/services/mcmodParser.js` 用 parse5 解析，去除脚本、样式、图标和高亮标签，
解码实体后按文本安全显示；只提取有效的 CurseForge 项目标识。同 modid 的版本去重合并，
`frequency` 重算为不同 modid 数。Key 无法可靠归属到各模组且可能已被上游截断，
因此 `all_keys` 留空，`source_keys` 保存去重后的整行 Key，单独展开显示。

浏览器缓存最多20次关键词查询，每份5分钟；翻页和模组筛选使用完整的最多100行快照，
每页50条，不重新请求。`upstreamTotal` 仅保留上游统计，不作为可分页总数；
有截断时 `totalIsExact=false`，页面提示细化关键词。

转发地址固定，限制搜索词50字符、响应2 MiB；成功响应可缓存5分钟。
单次上游请求（含读取正文）限时8秒，连接失败、超时、空响应或上游502/503/504时，
间隔250毫秒最多重试一次；403、429、非HTML及过大响应不重试。
Vercel函数配置在香港 `hkg1` 执行，最大时长25秒；百科前端请求超时22秒，
保证两次尝试有时间完成。加强版请求仍为15秒。
原始 HTML 以 `text/plain` 返回，并设置 nosniff 与 CSP，禁止当成本站 HTML 执行。
不转发上游 Cookie，不缓存失败响应。浏览器遇到空正文或未知结构会报错，不伪装成无结果。

失败响应为JSON：`error`（说明）、`code`（如 `UPSTREAM_NETWORK`、`UPSTREAM_TIMEOUT`）、
`requestId`。超时返回504，其他上游故障返回502；前端显示说明及请求编号。
Vercel Runtime Logs 搜索 `mcmod_upstream_failure` 或请求编号，可看到尝试次数、耗时、
上游状态、底层网络错误码和执行区域，日志不记录查询词。响应头
`X-Mcmod-Request-Id`、`X-Mcmod-Attempts` 可用于核对。

验证：`node --test frontend/services/*.test.js tests/*.test.js`、`pnpm build`。

本项目后端基于 Cloudflare Worker 和 D1 数据库构建，支持高级全文搜索（FTS5）和结果聚合。

### 基础信息

- **Base URL**: `https://api.vmct-cn.top` (请替换为你实际部署的地址)
- **协议**: HTTPS
- **方法**: GET
- **缓存策略**: 浏览器及边缘节点缓存 7 天

### 搜索接口 `/search`

执行关键词搜索，获取翻译结果及关联模组信息。

**完整请求示例：**`https://api.vmct-cn.top/search?q=${query}&page=${currentPage}&mode=${mode}`

#### 请求参数

| 参数名 | 类型   | 必填 | 默认值  | 说明                                         |
| :----- | :----- | :--- | :------ | :------------------------------------------- |
| `q`    | String | 是   | -       | 搜索词（支持高级语法，详见下方）             |
| `page` | Int    | 否   | `1`     | 当前页码                                     |
| `mode` | String | 否   | `en2zh` | 搜索模式：`en2zh` (英查中), `zh2en` (中查英) |
| `mod`  | String | 否   | -       | 只返回包含指定 modid 的译文对                |

#### 高级搜索语法

搜索词 `q` 支持以下逻辑：

- **短语匹配**: 使用引号包裹，如 `"Iron Ingot"`。
- **排除关键词**: 使用减号前缀，如 `machine -input`（搜索包含 machine 但不含 input 的结果）。
- **前缀匹配**: 英文末尾加 `*`，中文默认支持前缀匹配。
- **混合搜索**: 支持中英文混合输入。

#### 响应示例

```json
{
  "query": "Staff",
  "results": [
    {
      "trans_name": "法杖",
      "origin_name": "Staff",
      "all_mods": "actuallyadditions (1.12.2), cqrepoured (1.12.2), hexcasting (1.18), mysticalagriculture (1.20/1.16/1.21/1.18), roots (1.12.2/1.21), rootsclassic (1.12.2), wizardry (1.12.2/1.12.2)",
      "all_keys": "booklet.actuallyadditions.chapter.staff.name,item.staff.name,hexcasting.entry.staff,augmentType.mysticalagriculture.staff,item.staff.name|item.roots.staff,item.staff.name,item.wizardry:staff.name|wizardry.book.items_blocks.staff.title",
      "all_curseforges": "actually-additions,cqrepoured,hexcasting,mystical-agriculture,roots,roots-classic,wizardry-mod",
      "frequency": 7
    }
  ]
}
```

#### 字段说明

| 字段名                    | 说明                                                                              |
| :------------------------ | :-------------------------------------------------------------------------------- |
| `total`                   | 当前已确认的最小匹配数；不再为分页执行高成本的全量 `COUNT(*)`                     |
| `hasMore`                 | 是否还有下一页                                                                    |
| `totalIsExact`            | `total` 是否为精确值（到达最后一页时为 `true`）                                   |
| `results`                 | 结果数组                                                                          |
| `results.trans_name`      | 译文名称                                                                          |
| `results.origin_name`     | 原文名称                                                                          |
| `results.all_mods`        | 出现该翻译的模组及版本列表，多个模组用 `, ` 分隔                                  |
| `results.all_keys`        | 对应模组的语言文件 Key。若单个模组有多个 Key，内部用 `\|` 分隔，模组间用 `,` 分隔 |
| `results.all_curseforges` | 对应模组的 CurseForge 项目 ID                                                     |
| `results.frequency`       | 该翻译对在不同模组配置中出现的频次                                                |

---

### 错误码说明

| 状态码 | 说明       | 错误信息示例                                    |
| :----- | :--------- | :---------------------------------------------- |
| `400`  | 参数错误   | `{"error":"查询参数不能为空"}`                  |
| `400`  | 参数错误   | `{"error": "搜索词长度不能超过50个字符"}`       |
| `404`  | 路径错误   | `Not Found`                                     |
| `500`  | 数据库异常 | `{"error": "数据库查询失败", "details": "..."}` |

## 版权归属

本项目代码部分使用[GPL3协议](LICENSE.md)。
[![GitHub license](https://img.shields.io/github/license/Wulian233/mcmod-translation-dict?style=flat-square)](LICENSE.md)

本项目数据库来自VM汉化组的[i18n Dict Extender](https://github.com/VM-Chinese-translate-group/i18n-Dict-Extender)项目，
翻译数据归属 CFPA 团队及其他模组译者，该作品采用 CC BY-NC-SA 4.0 授权。
