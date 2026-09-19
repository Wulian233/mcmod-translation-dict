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

在部署自己的项目时，请记得将 `frontend\config.js` 里的 `baseUrl` 替换为你部署的 API 地址。

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
