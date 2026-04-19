# Agent Observability

多智能体统一日志监控与控制面板的独立项目设计方案。

当前定位：
- 第一阶段：内部自用监控平台
- 当前目标：统一接入多个基于 LangChain 构建的智能体项目
- 当前范围：只读监控，不做控制写操作

---

## 1. 项目目标

`agent-observability` 旨在将当前 `mhxy` 项目中的日志系统与前端展示能力独立出来，形成一套可复用的多智能体观测平台，满足以下需求：

- 统一监控多个智能体项目
- 支持多项目、多 Agent、多会话统一视图
- 对接现有 `mhxy` JSONL 日志
- 对接 LangSmith tracing 数据
- 对接其它 LangChain 项目的本地日志
- 展示通用观测数据与项目自定义内容
- 重点支持：
  - 全局总览
  - 会话时间线
  - 单次 Trace 详情
  - Token 统计
  - Tool 调用分析
  - Think 内容查看

不在第一阶段范围内：

- 任务重试、回放、重跑
- Agent 控制面板写操作
- 用户权限体系
- 告警通知系统
- 多租户 SaaS 化

---

## 2. 设计原则

### 2.1 分层解耦

平台拆分为四层：

1. 数据源层
2. 采集/适配层
3. 统一存储与查询层
4. 前端控制台层

### 2.2 日志协议统一，接入方式灵活

平台内部使用统一事件模型；各项目不强制立即改造为统一 schema，而是通过 adapter 映射接入。

### 2.3 观测数据与业务语义分离

- 通用观测数据：会话、trace、tool、token、模型调用
- 项目语义数据：自定义 think、业务阶段、任务标签、业务事件

通用部分归一化；业务特有部分以扩展字段保留。

### 2.4 LangSmith 是数据源，不是前端主界面

LangSmith 用于提供 tracing、usage、run tree 等标准观测能力；本平台负责统一聚合和自定义展示。

### 2.5 优先适配已有项目

第一阶段优先降低接入成本，不要求现有项目大规模重构后才能使用。

---

## 3. 技术方案

### 3.1 推荐技术栈

- 前端：`Next.js + React + TypeScript`
- 后端：`FastAPI`
- 数据库：`PostgreSQL`
- 部署：`Docker Compose`

选择理由：

- `Next.js/React` 更适合做长期演进的多视图控制台，远优于 `Streamlit`
- `FastAPI` 适合做接入层、聚合查询层、适配层 API
- `PostgreSQL` 足以承载结构化事件、查询筛选、聚合统计
- `Docker Compose` 适合当前内网自用、低复杂度部署

### 3.2 第一阶段部署形态

建议单机 `Docker Compose`：

- `web`: Next.js 前端
- `api`: FastAPI 后端
- `db`: PostgreSQL
- 可选 `worker`: 异步采集任务

第一阶段可先不引入 Redis；如果后续 LangSmith 拉取量增大，再增加异步队列。

---

## 4. 总体架构

```text
                    +----------------------+
                    |  Existing Agent Apps |
                    |----------------------|
                    | mhxy                 |
                    | other-langchain-apps |
                    +----------+-----------+
                               |
              +----------------+----------------+
              |                                 |
              v                                 v
   +------------------------+       +------------------------+
   | Local Logs / JSONL     |       | LangSmith API          |
   +------------------------+       +------------------------+
              |                                 |
              +----------------+----------------+
                               |
                               v
                   +---------------------------+
                   | Ingestion / Adapter Layer |
                   |---------------------------|
                   | mhxy adapter              |
                   | generic jsonl adapter     |
                   | langsmith adapter         |
                   +-------------+-------------+
                                 |
                                 v
                   +---------------------------+
                   | Normalized Event Storage  |
                   | PostgreSQL                |
                   +-------------+-------------+
                                 |
                                 v
                   +---------------------------+
                   | Query / Aggregation API   |
                   | FastAPI                   |
                   +-------------+-------------+
                                 |
                                 v
                   +---------------------------+
                   | Web Control Plane         |
                   | Next.js / React           |
                   +---------------------------+
```

---

## 5. 数据源接入策略

### 5.1 `mhxy` JSONL 日志

作为第一优先数据源。

接入方式：
- 由 `mhxy adapter` 读取 `logs/sessions/*.jsonl`
- 映射为平台统一事件模型
- 保留 `mhxy` 专有字段到 `extra` 中

适配重点：
- `session`
- `message`
- `thought`
- `model_call`
- `tool_call`
- `tool_result`

### 5.2 LangSmith

第一阶段目标不是仅做跳转，而是要纳入统一视图。

接入方式：
- 后端定时或按需调用 LangSmith API
- 拉取 traces / runs / usage / metadata
- 映射到统一事件模型
- 与本地日志通过 `session_id` / `trace_id` / `run_id` 关联

LangSmith 的角色：
- 补充标准 tracing 视图
- 提供 token usage 和 run tree
- 提供通用观测后端能力

### 5.3 其它 LangChain 本地日志

建议采用“统一平台 schema + 项目 adapter 映射”方案。

原因：
- 现有项目日志格式大概率不一致
- 统一要求改日志格式成本高
- adapter 模式更适合自用阶段快速接入多个项目

后续目标：
- 在平台成熟后，再逐步推动新项目直接输出统一 schema

---

## 6. 核心数据模型

### 6.1 统一标识体系

每条事件至少应具备以下字段：

- `project_id`
- `agent_id`
- `session_id`
- `trace_id`
- `run_id`
- `event_id`
- `event_type`
- `timestamp`
- `source`
- `extra`

说明：

- `project_id`：项目维度，如 `mhxy`
- `agent_id`：智能体实例或逻辑 agent，如 `game-bot`
- `session_id`：单次会话
- `trace_id`：跨系统对齐 trace
- `run_id`：单次模型/工具运行标识
- `source`：数据来源，如 `mhxy_jsonl` / `langsmith`
- `extra`：扩展字段容器

### 6.2 统一事件类型

建议统一为以下主类型：

- `session_started`
- `session_ended`
- `message`
- `thought`
- `model_call`
- `tool_call`
- `tool_result`
- `metric`
- `event`
- `error`

### 6.3 事件明细建议

#### `message`

字段：
- `role`
- `content`

#### `thought`

字段：
- `content`
- `provider`
- `kind`

说明：
- `kind` 可区分 `custom_think` / `reasoning_summary` / `extracted`

#### `model_call`

字段：
- `model`
- `provider`
- `prompt`
- `raw_output`
- `input_tokens`
- `output_tokens`
- `reasoning_tokens`
- `cache_read_tokens`
- `duration_ms`
- `success`

#### `tool_call`

字段：
- `tool_name`
- `arguments`

#### `tool_result`

字段：
- `tool_name`
- `success`
- `result`
- `duration_ms`

#### `metric`

字段：
- `metric_name`
- `metric_value`
- `metric_unit`

#### `event`

字段：
- `name`
- `payload`

用于承载项目业务事件，例如：
- 任务阶段切换
- 自动流程开始/结束
- 页面识别成功

---

## 7. 存储设计

### 7.1 为什么不用纯文件

纯 JSONL 适合单项目、单视图快速查看，但不适合：

- 多项目聚合查询
- 多条件筛选
- 统计分析
- LangSmith 融合
- 稳定分页与排序

因此平台内部统一使用 PostgreSQL 做索引与查询层。

### 7.2 推荐表设计

#### `projects`
- `id`
- `name`
- `display_name`
- `source_type`
- `is_active`
- `created_at`

#### `agents`
- `id`
- `project_id`
- `name`
- `display_name`
- `kind`
- `metadata`

#### `sessions`
- `id`
- `project_id`
- `agent_id`
- `external_session_id`
- `external_trace_id`
- `started_at`
- `ended_at`
- `status`
- `metadata`

#### `events`
- `id`
- `project_id`
- `agent_id`
- `session_id`
- `trace_id`
- `run_id`
- `event_type`
- `timestamp`
- `source`
- `payload_json`

#### `daily_usage_stats`
- `date`
- `project_id`
- `agent_id`
- `model`
- `input_tokens`
- `output_tokens`
- `reasoning_tokens`
- `cache_read_tokens`
- `total_tokens`
- `calls`

第一阶段可以先全部从 `events` 实时聚合；后续需要性能时再加物化统计表。

---

## 8. Adapter 设计

### 8.1 Adapter 接口

每个数据源适配器实现统一接口：

```python
class BaseAdapter(Protocol):
    def discover_sources(self) -> list[SourceRef]: ...
    def scan_sessions(self, source: SourceRef) -> list[SessionRef]: ...
    def load_events(self, session: SessionRef) -> list[NormalizedEvent]: ...
```

### 8.2 内置 Adapter

第一阶段建议内置：

- `mhxy_jsonl_adapter`
- `generic_jsonl_adapter`
- `langsmith_adapter`

### 8.3 Adapter 责任边界

Adapter 负责：
- 读取外部数据
- 解析原始格式
- 映射统一 schema
- 补全必要标识

Adapter 不负责：
- 前端展示逻辑
- 聚合统计
- 跨源关联查询

---

## 9. Think 内容设计

### 9.1 目标

平台需要支持优先展示 provider summary，没有时展示自定义 think。

### 9.2 展示优先级

建议按以下顺序：

1. `reasoning_summary`
2. `custom_think`
3. 从模型正文中提取的 `think`
4. 无 think 数据

### 9.3 Think 规范化字段

```json
{
  "kind": "reasoning_summary | custom_think | extracted",
  "provider": "openai | dashscope | custom",
  "content": "...",
  "summary_level": "brief | detailed | unknown"
}
```

### 9.4 为什么要单独建模

因为 `think` 并不是所有 provider 都原生支持，而且来源不统一：

- 有的来自官方 reasoning summary
- 有的来自应用层自行记录
- 有的来自 `<think>...</think>` 提取

单独建模后，前端可以统一展示，不依赖底层来源。

---

## 10. 前端信息架构

### 10.1 页面优先级

按已确认需求，第一阶段优先页面为：

1. 全局总览
2. 会话时间线
3. 单次 Trace 详情
4. Token 统计
5. Tool 调用分析
6. Think 内容查看

### 10.2 页面结构建议

#### 页面 1：全局总览

展示内容：
- 项目卡片
- Agent 数量
- 今日会话数
- 今日错误数
- Token 总消耗
- 最近活跃会话
- 最近异常会话

筛选维度：
- 项目
- 时间范围
- Agent

#### 页面 2：会话时间线

展示内容：
- 左侧：会话列表
- 右侧：单会话事件时间线

时间线事件：
- 用户消息
- Agent 回复
- think
- tool call/result
- model call
- error
- 自定义业务事件

#### 页面 3：Trace 详情

展示内容：
- trace 树
- run 层级
- 模型输入输出
- tool 参数与结果
- 持续时间
- trace_id / run_id / LangSmith 链接

#### 页面 4：Token 统计

展示内容：
- 按日总量
- 按项目拆分
- 按模型拆分
- 输入/输出/reasoning/cache token
- 调用次数趋势

#### 页面 5：Tool 调用分析

展示内容：
- 工具调用次数排行
- 失败率
- 平均耗时
- 按项目/Agent 过滤
- 近 24 小时异常工具调用

#### 页面 6：Think 查看

展示内容：
- 每个会话中的 think 片段
- 来源类型
- 与 tool/model 调用联动
- 支持按关键词搜索

---

## 11. API 设计建议

### 11.1 项目与 Agent

- `GET /api/projects`
- `GET /api/projects/{project_id}/agents`

### 11.2 会话

- `GET /api/sessions`
- `GET /api/sessions/{session_id}`
- `GET /api/sessions/{session_id}/timeline`

### 11.3 Trace

- `GET /api/traces/{trace_id}`
- `GET /api/traces/{trace_id}/tree`

### 11.4 Token

- `GET /api/stats/tokens/overview`
- `GET /api/stats/tokens/by-model`
- `GET /api/stats/tokens/by-project`

### 11.5 Tools

- `GET /api/stats/tools`
- `GET /api/stats/tools/errors`

### 11.6 Think

- `GET /api/think`
- `GET /api/sessions/{session_id}/think`

### 11.7 同步与接入

- `POST /api/ingest/jsonl`
- `POST /api/sync/langsmith`

第一阶段这些接口只需服务前端与后台同步任务，不开放外部多租户能力。

---

## 12. 与 `mhxy` 的迁移策略

### 12.1 原则

先适配，不先破坏。

即：
- 先让 `agent-observability` 通过 adapter 读取 `mhxy` 当前日志
- 确认展示和查询稳定
- 再考虑将 `mhxy` 的日志写入规范逐步迁移到统一 schema

### 12.2 `mhxy` 第一阶段迁移内容

- 复用当前 `logs/sessions/*.jsonl`
- 保留现有 `session_logger` 逻辑
- 为每条记录补充更稳定的：
  - `trace_id`
  - `run_id`
  - `project_id=mhxy`
  - `agent_id`

### 12.3 `mhxy` 第二阶段迁移内容

- 增强 LangSmith 对齐
- 在日志中显式记录 LangSmith 关联字段
- 统一 `thought` 类型与 `reasoning_summary` 类型

---

## 13. LangSmith 融合策略

### 13.1 第一阶段能力

支持：
- 配置 LangSmith 项目
- 拉取 traces/runs/usage
- 建立与本地 session 的关联
- 在 Trace 详情页中展示：
  - LangSmith trace_id
  - 跳转链接
  - run tree 映射结果

### 13.2 关联策略

优先通过以下字段关联：

- `trace_id`
- `session_id`
- 时间窗口 + project_id + agent_id

### 13.3 为什么不直接完全依赖 LangSmith

因为你还需要：
- 自定义 think
- 自定义业务事件
- 统一跨项目视图
- 非 LangSmith 数据源接入

所以 LangSmith 是重要数据源，但不是唯一真相源。

---

## 14. 可扩展性设计

### 14.1 多项目

平台必须从第一天支持 `project_id` 维度。

### 14.2 多 Agent

一个项目内允许多个 Agent，例如：
- `planner`
- `executor`
- `reviewer`

### 14.3 多来源

同一会话可由多个来源补充：
- 本地 JSONL
- LangSmith
- 未来 webhook

### 14.4 自定义扩展字段

任何项目专有字段均不应污染主 schema，而应进入 `payload_json.extra`。

---

## 15. 安全与权限

第一阶段：
- 不做登录鉴权
- 默认内网部署

但设计预留：
- API 认证中间件
- 反向代理鉴权
- 项目级访问控制

---

## 16. 项目目录建议

```text
agent-observability/
├── README.md
├── docker-compose.yml
├── .env.example
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   ├── adapters/
│   ├── schemas/
│   └── shared/
├── docs/
│   ├── architecture.md
│   ├── schema.md
│   ├── adapters.md
│   └── roadmap.md
└── migrations/
```

说明：
- `apps/api`：FastAPI
- `apps/web`：Next.js
- `packages/adapters`：各类数据源 adapter
- `packages/schemas`：统一事件 schema 与类型定义

---

## 17. 迭代路线图

### Phase 1：设计与基建

- 确定统一 schema
- 建立项目骨架
- 建立 PostgreSQL 模型
- 建立 `mhxy` adapter
- 建立基础前端壳

### Phase 2：可用 MVP

- 接通 `mhxy` JSONL
- 实现全局总览
- 实现会话时间线
- 实现 Trace 详情
- 实现 Token 统计
- 实现 Think 查看

### Phase 3：LangSmith 集成

- 增加 LangSmith 配置
- 拉取 traces/runs/usage
- 统一 trace 详情页
- 支持本地日志与 LangSmith 对照

### Phase 4：多项目接入

- generic jsonl adapter
- 第二个项目接入验证
- 多项目总览与对比能力

### Phase 5：增强能力

- 异常聚合
- 统计预计算
- 告警系统
- 权限系统

---

## 18. 关键结论

### 18.1 为什么这个项目值得独立

因为它已经不再只是 `mhxy` 的一个辅助页面，而是在演变成：

- 通用 Agent 观测平台
- 多项目统一控制面板
- 通用日志与 Trace 聚合层

### 18.2 当前最优接入策略

不是强制所有项目立即统一日志格式，而是：

- 平台内部定义统一 schema
- 项目侧通过 adapter 接入
- 成熟后再逐步推动上游统一

### 18.3 当前最优产品策略

先做“可用的统一读监控平台”，不要过早加入控制写操作。

### 18.4 当前最优技术选择

- 前端：Next.js
- 后端：FastAPI
- 数据库：PostgreSQL
- 部署：Docker Compose

这套更适合你后续持续演进成真正的多智能体控制面板。

---

## 19. 下一步编码建议

后续编码顺序建议严格按下面执行：

1. 定义统一 schema
2. 搭项目骨架
3. 搭 PostgreSQL 模型
4. 实现 `mhxy` adapter
5. 实现最小查询 API
6. 实现前端 3 个核心页面：
   - 总览
   - 会话时间线
   - Trace 详情
7. 接入 LangSmith
8. 扩展 Token/Tool/Think 专题页

在这之前，不建议直接开始零散写页面或先接 LangSmith。

---

## 20. 实施补充约束

这一节用于补齐“可以写代码”所需的实施级约束，避免不同编码 agent 各自理解导致架构发散。

### 20.1 平台内部必须区分三类数据

平台内部必须明确区分：

1. `raw source payload`
- 原始输入数据
- 来源可能是 JSONL 行、LangSmith API 返回对象

2. `normalized event`
- 经过 adapter 标准化后的统一事件
- 前端查询与统计全部基于它

3. `derived aggregate`
- 统计结果或预计算结果
- 例如日粒度 token 统计、tool 失败排行

禁止将“原始对象”和“标准化对象”混存为一种概念。

### 20.2 必须支持重放与重建

由于第一阶段会同时接多个异构数据源，平台必须支持：

- 从原始数据重新跑 adapter
- 重建 normalized events
- 重建统计表

因此建议增加一张原始入库表：

#### `raw_event_blobs`
- `id`
- `project_id`
- `source`
- `external_key`
- `collected_at`
- `payload_json`
- `payload_hash`

作用：
- 作为审计底稿
- 便于 adapter 变更后重放
- 避免因为一次错误映射丢失原始信息

### 20.3 增量同步必须幂等

`mhxy` 文件扫描和 LangSmith 拉取都必须按“可重复执行、不产生重复记录”设计。

最少需要满足：

- 同一条源事件重复同步，不应生成重复 normalized event
- 同一会话多次扫描，不应重复插入
- 同一 LangSmith run 多次拉取，应更新或跳过，而不是重复生成

建议幂等键：

- `source`
- `project_id`
- `external_key`
- `payload_hash`

其中：
- `external_key` 可是 JSONL 文件路径 + 行序号，或 LangSmith run id / trace id
- `payload_hash` 用于检测内容变化

### 20.4 会话与 Trace 不是同一个概念

编码实现时必须强制保留下面这个边界：

- `session_id`：用户视角或业务视角的一次会话
- `trace_id`：一次 agent 执行链路
- 一个 session 可能包含多个 trace
- 一个 trace 可能跨多个 run

前端展示必须优先基于 `session` 组织，再在 session 内展示 trace/run。

否则后续接入其它 agent 项目时会出现视图混乱。

### 20.5 时间排序要有明确规则

统一排序规则建议如下：

1. 优先使用事件自身 `timestamp`
2. 如果缺失，使用采集时间 `collected_at`
3. 如果同秒内冲突，使用 `event_id` 或 `source sequence`

不要依赖数据库插入顺序作为展示顺序。

---

## 21. 数据源配置模型

为避免后续接入多个项目时散落在环境变量里，建议从第一版开始定义“数据源注册配置”。

### 21.1 推荐表：`data_sources`

- `id`
- `project_id`
- `source_type`
- `display_name`
- `enabled`
- `config_json`
- `last_sync_cursor`
- `last_sync_at`
- `last_error`

### 21.2 `source_type` 建议

- `mhxy_jsonl`
- `generic_jsonl`
- `langsmith`

### 21.3 `config_json` 示例

#### mhxy jsonl

```json
{
  "log_dir": "/logs/sessions",
  "glob": "**/*.jsonl"
}
```

#### langsmith

```json
{
  "workspace_id": "xxx",
  "project_name": "mhxy-prod",
  "base_url": "https://api.smith.langchain.com"
}
```

### 21.4 `last_sync_cursor`

不同 source_type 自己解释：

- 文件日志：文件 mtime / inode / offset
- LangSmith：最后成功同步的时间戳或分页游标

这样 worker 可以做稳定的增量同步。

---

## 22. 查询与索引要求

如果不在设计期写清楚，后续实现很容易把所有查询都压到 JSON 字段上，导致性能快速变差。

### 22.1 高频查询场景

第一阶段必须支持的高频查询：

- 按项目列会话
- 按 Agent 列会话
- 按时间范围筛会话
- 拉取单会话时间线
- 拉取单 trace 详情
- 聚合 token 统计
- 按 tool_name 聚合统计
- 搜索 think 内容

### 22.2 必要索引

建议至少建立：

- `events(project_id, timestamp)`
- `events(session_id, timestamp)`
- `events(trace_id, timestamp)`
- `events(event_type, timestamp)`
- `sessions(project_id, started_at desc)`
- `sessions(agent_id, started_at desc)`

如果第一版就做 PostgreSQL 全文检索，可考虑：

- 为 think/message 内容建立 tsvector 索引

否则第一版先限制搜索范围在单 session 内，避免全局模糊查询过重。

---

## 23. 非功能要求

### 23.1 性能目标

第一阶段目标：

- 单会话时间线打开时间：`< 1s`
- 全局总览打开时间：`< 2s`
- 最近 7 天 token 统计：`< 2s`

这是内网自用系统，可接受不是极致，但必须达到“可稳定使用”。

### 23.2 数据保留策略

必须从第一版明确：

- `normalized events` 默认长期保留
- `raw_event_blobs` 可设保留周期，例如 30-90 天
- `derived aggregates` 可重建，不要求永久不可变

### 23.3 平台自身可观测性

平台本身也需要最小观测：

- 每个 source 的最近同步时间
- 最近同步失败原因
- 同步任务耗时
- 最近一次 ingest 条数

建议在总览中增加一个“平台状态”区域，而不是只展示被监控项目。

---

## 24. 项目接入流程

为了便于后续接其它项目，建议将接入流程标准化。

### 24.1 新项目接入步骤

1. 注册 `project`
2. 注册 `agent`
3. 注册 `data_source`
4. 选择已有 adapter 或新建 adapter
5. 运行一次 dry-run 映射
6. 校验事件数量与字段完整性
7. 正式启用增量同步

### 24.2 Dry-run 输出必须包含

- 发现的 session 数
- 发现的 event 数
- 事件类型分布
- 丢弃记录数
- 解析错误样本

这一步非常关键，能显著降低接入其它历史项目时的调试成本。

---

## 25. 第一阶段明确不做的事情

为避免实施过程中范围失控，第一阶段明确不做：

- 实时 websocket 推送
- 告警通知
- 自定义 dashboard 拖拽编排
- 多租户与权限体系
- 多数据库支持
- 非 PostgreSQL 的 OLAP 方案
- Agent 控制动作
- 复杂搜索 DSL

这些都可以留到后续版本，不应阻塞 MVP。

---

## 26. 对编码 Agent 的执行要求

后续实施必须遵守：

1. 先定 schema，再写 adapter
2. 先通 `mhxy`，再接 LangSmith
3. 先做读模型与查询，再做前端复杂交互
4. 任何项目特有字段不得污染统一 schema 主字段
5. 所有 ingest/sync 逻辑必须可重跑、可幂等
6. 前端页面围绕 `project -> agent -> session -> trace` 逐层展开

如果实现过程中需要在“快速写死”和“通用抽象”之间取舍，第一阶段应优先：

- 保证内部 schema 稳定
- 保证 adapter 可插拔
- 保证数据库模型可扩展

而不是过度优化 UI 细节。
