# CLAUDE.md

本文件为 Claude Code 在此仓库工作时的导航手册。

---

## 项目定位

**agent-observability** 是 omnibot 旗下各 agent LLM 调用的可观测性平台。omnibot 将每次对话写入 JSONL 文件，本项目将其摄取入 PostgreSQL，并通过 Web UI 展示 Token 消耗、模型分布、费用估算等统计。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | FastAPI + SQLAlchemy async + PostgreSQL（宿主机端口 5433） |
| 前端 | Next.js + TypeScript（宿主机端口 3100） |
| 部署 | Docker Compose，三容器：`agent-observability-api-1`、`agent-observability-web-1`、`agent-observability-db-1` |

---

## 常用命令

```bash
# 重建并启动
docker compose up -d --build

# 查看后端日志
docker compose logs api -f

# 连接数据库
docker exec agent-observability-db-1 psql -U agent_obs -d agent_obs

# 手动触发摄取
curl -X POST http://localhost:8000/api/ingest/mhxy
curl -X POST http://localhost:8000/api/ingest/stock-bot
curl -X POST http://localhost:8000/api/ingest/ehs-bot

# 强制全量重扫（跳过 cursor 缓存）
curl -X POST "http://localhost:8000/api/ingest/mhxy?force=true"
```

---

## 目录结构

```
apps/
├── api/
│   └── app/
│       ├── api/router.py          # 所有路由（查询 + ingest 触发 + SSE）
│       ├── db/
│       │   ├── models.py          # ORM 模型（Project/Agent/Session/Event/…）
│       │   └── base.py            # AsyncSession 工厂
│       ├── ingestion/service.py   # 幂等写入：raw blob + normalized event
│       ├── adapters/
│       │   ├── common.py          # 共享工具：now() / parse_ts()
│       │   ├── mhxy_jsonl.py      # mhxy JSONL 格式适配器
│       │   └── omnibot_jsonl.py   # omnibot JSONL 格式适配器
│       └── schemas/events.py      # Pydantic 模型（NormalizedEvent 等）
└── web/
    └── src/
        ├── pages/                 # index.tsx（总览）/ tokens.tsx / sessions.tsx
        ├── lib/
        │   ├── api.ts             # 所有 API 调用封装
        │   └── format.ts          # 共享格式化函数：fmt / fmtCost / fmtTime
        └── types/events.ts        # TypeScript 类型定义
```

---

## 数据流

```
omnibot JSONL 文件
  → POST /api/ingest/{project}        # 手动触发 或 文件 watcher 自动触发
  → adapters/*.py 解析
  → ingestion/service.py 幂等写入 PostgreSQL
  → FastAPI 路由聚合查询
  → Next.js 展示
```

摄取幂等性机制：
- raw blob：按 `(source, project_id, external_key)` 唯一，内容变更时 UPDATE
- event：按 `event_id`（内容 hash）唯一，ON CONFLICT DO NOTHING

---

## 关键设计

**摄取 cursor**：每个 DataSource 存储 `last_sync_cursor`（文件路径→mtime JSON），未变更文件跳过，无需全量扫描。

**费用计算**：`_COST_CONFIG` 在 `router.py` 顶部定义，仅含按量计费模型（deepseek-v4-flash、qwen3-vl-plus）。包月模型返回 `cost: null`，前端显示"包月"。

**stats/overview 批量查询**：3 次固定 SQL（session 聚合、event 聚合、模型费用分组），不随项目数增长查询次数。

**SSE 实时推送**：`/api/stream` 端点，ingest 完成后广播通知前端自动刷新。

**timeline 分页**：`GET /sessions/{id}/timeline?limit=200&offset=0`，默认 200 条，最大 500。

---

## 环境变量（`apps/api/.env`）

```env
DATABASE_URL=postgresql+asyncpg://agent_obs:changeme@db:5432/agent_obs
MHXY_LOG_DIR=/logs/mhxy/sessions
OMNIBOT_STOCK_LOG_DIR=/logs/omnibot/stock/sessions
OMNIBOT_EHS_LOG_DIR=/logs/omnibot/ehs/sessions
```

---

## 代码规范

- 路由返回 dict，不用 Pydantic response_model（灵活迭代阶段）
- 数据库查询统一用 SQLAlchemy ORM，禁止 raw SQL（`text()`）
- 格式化函数统一从 `lib/format.ts` 导入，不在页面内重复定义
- 新增 project 需同时：①在 `router.py` 加 `run_xxx_ingest()` wrapper，②前端 `SYNC_FN_MAP` 登记
