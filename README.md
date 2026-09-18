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
- 自动分页，一页50条结果，支持上一页/下一页，不为总页数执行全量计数
- 记录键名，鼠标悬停在`所属模组`条目上方时会显示译文对应的键名
- 及时更新的数据源
- 页面美观，支持暗色模式，并且对手机上的显示效果进行了单独优化

## 技术细节

词典原始数据超过七十万行。D1 Free 的限额是账户每天读取 500 万行、写入 10 万行，
单库容量 500 MB；查询返回的行数并不等于读取行数，索引维护也消耗写入额度。
额度在 UTC 00:00 重置，超额后读写请求会失败。
详见 [D1 定价](https://developers.cloudflare.com/d1/platform/pricing/)。

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

前端对未缓存的搜索统一限制为至少间隔 1000ms，模组输入在最后一次输入后防抖 1000ms。
缓存结果可立即恢复；筛选因加载或节流被推迟时，只补发最新的筛选值。

### 后端

所需环境：NodeJS 22+、Python 3.10+（SQLite 支持 FTS5/trigram）、Cloudflare Worker + D1。

Worker 只读 `dict_search`、`dict_search_fts` 和 `dict_search_trigram`。
已有这三张搜索表的部署可直接更新代码，**不需要重建索引**。缺表时返回 503，
不会回退到原始 `dict` 的高成本聚合查询。

发布时必须包含更新后的 `backend/wrangler.jsonc`，其中配置了 `SEARCH_RATE_LIMITER`：
每个 Cloudflare 节点、每个来源 IP，每 60 秒最多 30 次**缓存未命中**的搜索。
该原生绑定不使用 D1 保存计数；命中缓存仍可返回，即使限流已触发或限流服务不可用。
缺少绑定或绑定异常时，未缓存请求会返回 503，而不是绕过保护继续查库。
`namespace_id` 为字符串 `"2331001"`，部署多个 Worker 时应确保它在账户内不与无关限流器共用。

这是匿名站点的折中：NAT/代理下多个用户会共享 IP 限额；不同节点计数独立且最终一致，
不能作为账户每日 D1 额度的精确账本。参见 [原生限流文档](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。

搜索最多展示 100 页（5000 条）；超出范围、负数、小数或非完整十进制的页码返回 400。
第 100 页还有匹配项时，返回 `pageLimitReached: true`、`hasMore: false`，
前端提示细化搜索词，不将截断误报成“已经没有其他匹配结果”。

每次实际成功执行 D1 查询，会在现有 Worker 日志中记录 `event: search`、
`rows_read`、`rows_written`、`duration`、页码、模式和查询路径分类。
计量直接取自 D1 `meta`，缺失时为 `null`；成功计量日志不包含搜索词、模组 ID 或 IP。
`substring` 表示没有正向 FTS/trigram 条件缩小候选，应重点关注其读取量。
缓存命中不产生这条 D1 查询日志；账户总使用量仍应看 D1 Metrics，不能由采样日志推断剩余额度。

### 已有数据库：增量更新流程

**不要再远程执行 `schema/search-indexes.sql`，不要先删除搜索表，也不要每次重新导入原始 `dict`。**
全量创建投影曾产生约 143 万条写入，超过 Free 一天的额度。
现在将聚合和差异计算放在本地，只提交变化的译文对。

如果今天读写额度已经用尽，停止数据库操作，等待下一次 UTC 00:00 重置。
以下远程命令只能在确认有额度后执行，工具本身不会连接 Cloudflare。

1. 首次迁移到增量流程时，保存**实际部署投影的 rowid**。在 `backend` 目录执行：

   ```shell
   npx wrangler d1 execute prod-d1-tutorial --remote --command "SELECT rowid AS rowid, * FROM dict_search ORDER BY rowid" --json
   ```

   将完整 JSON 输出保存为 UTF-8 的 `baseline.json`。PowerShell 可将输出管道到
   `Out-File -Encoding utf8 baseline.json`；工具支持 UTF-8 BOM。
   导出会消耗读取额度，只需建立一次可靠基线，不要每次更新都重新导出。
   普通 `.dump` 不保证保留有空洞的隐式 rowid，不能替代这一步。

   ```shell
   python tools/search_snapshot.py baseline-json --input baseline.json --output deployed.db
   ```

2. 下载新的本地 `Dict-Sqlite.db`，生成增量：

   ```shell
   python tools/search_snapshot.py diff --source Dict-Sqlite.db --baseline deployed.db --output delta.sql --candidate candidate.db
   ```

   本地聚合复用 `schema/search-indexes.sql` 的规则。相同译文对保留 rowid；
   只变化模组、版本、Key 等元数据时不改 FTS；新增、删除通过触发器原子维护两套 FTS。
   每条命令在同一个 SQLite 语句内比较目标 rowid 的完整旧值，再修改内容和索引：
   - 与预期旧值一致才执行；已经是完整目标值则幂等跳过。
   - 删除目标已经不存在时跳过；更新目标不存在则报冲突。
   - rowid 被占用成其他内容，或旧元数据已被修改时，报 `search snapshot baseline mismatch`，
     该命令不修改任何内容或 FTS。检查与写入之间没有独立请求造成的竞态窗口。

   未变化的数据不产生 SQL 写入。**旧版生成的 `delta.sql` 没有这层保护，必须用新版工具重新生成。**
   保护覆盖本次修改的行，并不是整库快照锁；仍只允许一条更新流水线。

   工具在本地模拟增量，计算包含 FTS 内部写入的 SQLite changes，加普通索引余量和
   2 倍系数后估算预算，默认超过 50,000 就拒绝输出 SQL 和候选基线。
   可用 `--max-estimated-writes` 调低预算；**估算不是 D1 实际计费保证**，
   也不知道账户今天其他数据库已经消耗的额度。仍需检查实际 `rows_written` 和剩余额度。

3. 确认剩余额度足够、没有其他进程更新投影后，执行增量：

   ```shell
   npx wrangler d1 execute prod-d1-tutorial --remote --file=delta.sql --json
   ```

   文件先安装少量 FTS 维护触发器和一个空的比较更新视图，再提交逐行命令。
   视图不保存命令数据；每个译文对的条件检查、内容及索引变更是单条 SQL 的原子操作。
   `BATCH` 注释用于分段执行；`--batch-size` 只改变分段，不会重置每日额度，
   也不保证整份文件全局原子。发生基线冲突应立即停止，核对实际状态后重新生成增量，
   不能忽略失败后继续执行或提升候选基线。
   每批检查 Wrangler 输出的实际 `rows_written` 和账户余量；余额不足则等待下一个配额窗口。
   大更新应另行安排维护窗口/跨日迁移，不要为绕过拒绝而盲目调高预算。

4. 所有语句成功并检查搜索结果后，再将 `candidate.db` 保存为下一次的 `deployed.db`。
   中途失败时保留原基线和 SQL，不能提前使用候选基线。只允许一条更新流水线，
   不能在两份基线之间交叉更新。响应仍缓存 7 天，数据更新后旧缓存可能暂时可见。

工具不会把原始 `dict` 上传或同步回 D1。旧原表和旧索引暂时可以保留，
不要在额度耗尽时清理；删除也可能消耗额度，清理应另行安排。

### 本地构建与首次部署

```shell
python tools/search_snapshot.py build --source Dict-Sqlite.db --output local-search.db
```

这会在本地生成投影和索引，可用于检查行数、体积和搜索行为；
**不能把它当作已有 D1 的 rowid 基线，也不能直接将 `.db` 上传到 D1。**
`schema/search-indexes.sql` 仅用于含 `dict` 的本地空搜索库，
已有搜索表会报错而不是被删除。

首次部署仍需单独规划搜索结构创建和数据导入预算，本地预计算不免除远程导入写入。
增量工具默认拒绝非空数据对空基线的初始化；`--allow-initial` 是显式迁移选项，
仍受预算检查约束，不是 Free 全量导入的捷径。不要对 Free 库一次执行原始全量导入与建索引。

### 验证

在仓库根目录运行 `npm run check`，统一执行 JS 回归、Python 增量更新回归和 Vue 生产构建。
单独的 `npm test` 不会编译 `.vue` 文件，不能替代完整检查。
各项也可分别执行：`npm test`、`python -m unittest discover -s backend/test -p "test_*.py"`、`npm run build`。

三字及以上的中文子串使用 trigram MATCH 加字面校验；一、二字搜索保留原有功能，
但在没有其他正向条件缩小候选时仍扫描投影。分页上限限制了可请求的 OFFSET，
并未消除广泛匹配的排序与扫描成本；`LIMIT 51`、七天缓存和按 IP 限流都不是每日额度保证。

## API 接口文档

本项目后端基于 Cloudflare Worker 和 D1 数据库构建，支持高级全文搜索（FTS5）和结果聚合。

### 基础信息

- **Base URL**: `https://api.vmct-cn.top` (请替换为你实际部署的地址)
- **协议**: HTTPS
- **方法**: GET
- **缓存策略**: 浏览器及边缘节点缓存 7 天

### 1. 搜索接口 `/search`

执行关键词搜索，获取翻译结果及关联模组信息。

**完整请求示例：**`https://api.vmct-cn.top/search?q=${query}&page=${currentPage}&mode=${mode}`

#### 请求参数

| 参数名 | 类型   | 必填 | 默认值  | 说明                                         |
| :----- | :----- | :--- | :------ | :------------------------------------------- |
| `q`    | String | 是   | -       | 搜索词（支持高级语法，详见下方）             |
| `page` | Int    | 否   | `1`     | 页码，范围 1–100；非法或越界返回 400         |
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
| `total`                   | 已确认的最小匹配数；空的非首页为 `null`，不能由 OFFSET 推断总数                   |
| `hasMore`                 | 是否允许请求下一页；到达展示上限时为 `false`                                      |
| `pageLimitReached`        | 第 100 页仍有额外匹配项时为 `true`，需要缩小搜索范围                              |
| `totalIsExact`            | `total` 是否精确；空的非首页为 `false`                                            |
| `results`                 | 结果数组                                                                          |
| `results.trans_name`      | 译文名称                                                                          |
| `results.origin_name`     | 原文名称                                                                          |
| `results.all_mods`        | 出现该翻译的模组及版本列表，多个模组用 `, ` 分隔                                  |
| `results.all_keys`        | 对应模组的语言文件 Key。若单个模组有多个 Key，内部用 `\|` 分隔，模组间用 `,` 分隔 |
| `results.all_curseforges` | 对应模组的 CurseForge 项目 ID                                                     |
| `results.frequency`       | 该译文对的全局不同模组数；筛选后仍保持全局值，与排序含义一致                      |

---

### 2. 错误码说明

| 状态码 | 说明                                   | 错误信息示例                                                      |
| :----- | :------------------------------------- | :---------------------------------------------------------------- |
| `400`  | 参数错误                               | `{"error":"查询参数不能为空"}`                                    |
| `400`  | 参数错误                               | `{"error": "搜索词长度不能超过50个字符"}`                         |
| `404`  | 路径错误                               | `Not Found`                                                       |
| `429`  | 未缓存搜索过于频繁                     | `Retry-After: 60`，失败响应不缓存                                 |
| `500`  | 数据库异常                             | `{"error": "数据库查询失败，请稍后重试。"}`                       |
| `503`  | 索引/限流/缓存服务不可用或每日额度用尽 | 响应包含可展示的 `error`；已知索引/每日额度错误附带 `Retry-After` |

### 3. 开发注意事项

1. **跨域支持 (CORS)**: 允许所有来源访问；CORS 不是鉴权或资源消耗防护。
2. **速率限制**: 服务端原生限流保护缓存未命中的数据库查询；前端节流只减少无意的重复请求。
3. **数据清洗**: 本地聚合会处理重复的 Key；服务端不再逐请求聚合原始数据。

## 版权归属

本项目代码部分使用[GPL3协议](LICENSE.md)。
[![GitHub license](https://img.shields.io/github/license/Wulian233/mcmod-translation-dict?style=flat-square)](LICENSE.md)

本项目数据库来自VM汉化组的[i18n Dict Extender](https://github.com/VM-Chinese-translate-group/i18n-Dict-Extender)项目，
翻译数据归属 CFPA 团队及其他模组译者，该作品采用 CC BY-NC-SA 4.0 授权。
