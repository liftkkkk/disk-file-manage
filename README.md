# FileIndex — 本地硬盘文件索引工具

> 高性能本地文件索引与搜索工具，支持 Windows / Linux / macOS。
> 技术栈：Python Flask 后端 + Vue 3 前端。

---

## ✨ 新版亮点

| 优化项 | 说明 | 来源 |
|--------|------|------|
| **SQLite 持久化** | 索引写入本地数据库，重启后立即可用，无需重新扫描 | Jeff Dean / Andrew Ng |
| **并行属主查询** | ThreadPoolExecutor 并行处理 owner lookup，百万文件仍流畅 | Jensen Huang |
| **模糊搜索** | 集成 rapidfuzz，支持拼写容错，可配置匹配阈值（0-100） | Karpathy |
| **拼音搜索** | 集成 pypinyin，输入 `baogao` 可找到「报告.docx」 | Karpathy |
| **忽略规则** | 全局 glob 忽略列表（node_modules、.git 等），可在设置中自定义 | Fei-Fei Li |
| **符号链接检测** | 记录已访问的真实路径，防止符号链接循环导致死循环 | Pieter Abbeel |
| **LRU + TTL 缓存** | 内存缓存最多 20 个索引，1 小时 TTL 自动过期，防止内存泄漏 | Pieter Abbeel |
| **API Key 认证** | 可选的 X-API-Key Header 认证，在设置页面开启 | Dario Amodei |
| **命名索引管理** | 索引可命名、重命名、删除，侧边栏展示所有已建立的索引 | UX |

---

## 🗂 项目结构

```
disk-file-manage/
├── backend/
│   ├── app.py            # Flask 后端（全量重写）
│   ├── requirements.txt  # Python 依赖
│   ├── fileindex.db      # SQLite 数据库（自动生成）
│   ├── settings.json     # 全局设置（自动生成）
│   └── exports/          # CSV 导出临时目录（自动生成）
├── frontend/
│   ├── src/App.vue       # Vue 3 单文件组件（4 页面布局）
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md
```

---

## 🚀 快速开始

### 环境要求

- Python 3.8+
- Node.js 16+

### 1. 启动后端

```bash
cd backend
pip install -r requirements.txt
python app.py
# 服务运行在 http://localhost:3000
```

启动时会显示当前能力：
```
✦ FileIndex backend  →  http://localhost:3000
  fuzzy engine  : rapidfuzz        ← 模糊搜索引擎
  pinyin support: True             ← 拼音搜索是否可用
  database      : /path/to/fileindex.db
```

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev
# 前端运行在 http://localhost:5173
```

### 3. 构建生产版本

```bash
cd frontend
npm run build
```

---

## 📖 使用说明

### 索引目录

1. 切换到「索引目录」页，输入路径，可选填索引名称
2. 点击「开始索引」，进度条通过 SSE 实时推送
3. 完成后自动跳转到「统计分析」页
4. 所有索引持久化存储，侧边栏可切换

### 文件搜索

- 支持文件名、路径、创建者的 **精确子串** 搜索
- 开启「模糊」开关，容忍拼写错误（可在设置中调整阈值）
- 安装 pypinyin 后，支持拼音搜索：输入 `baogao` → 匹配「报告.docx」
- 点击扩展名 Chip 按类型过滤；点击列头排序；支持分页

### 统计分析

- 文件类型分布条形图（点击类型可直接跳转搜索）
- 创建者排行 / 最大文件列表

### 设置

- **忽略规则**：glob 格式，新建索引时自动跳过（已有索引不受影响）
- **模糊阈值**：拖动滑块调整，55% 是经验推荐值
- **API Key**：设置后所有请求须携带 `X-API-Key` Header

---

## 🔌 API 接口

### 创建索引（异步）

```http
POST /api/index
Content-Type: application/json

{
  "directoryPath": "/path/to/dir",
  "name": "我的文档",
  "ignorePatterns": ["*.tmp", "backup"]
}
```

响应：`{ "success": true, "taskId": "...", "indexId": 1 }`

### SSE 进度流

```
GET /api/index/stream?taskId=...
```

事件：`progress` / `done` / `error` / `ping`

### 搜索

```http
POST /api/search
{ "indexId": 1, "searchTerm": "报告", "extFilter": ".pdf",
  "sortBy": "size", "sortOrder": "desc", "page": 1, "pageSize": 100,
  "fuzzy": true }
```

返回字段包含 `score`（模糊匹配百分比）。

### 索引管理

```
GET    /api/indexes                   列出所有索引
DELETE /api/indexes/<id>              删除索引及其文件数据
POST   /api/indexes/<id>/rename       { "name": "新名称" }
GET    /api/stats/<id>                统计信息
GET    /api/export/<id>               流式 CSV 导出
```

### 设置

```
GET  /api/settings
POST /api/settings   { "ignorePatterns": [...], "fuzzyThreshold": 60, "apiKey": "..." }
```

---

## ⚙️ 配置

| 项目 | 默认值 | 修改方式 |
|------|--------|---------|
| 后端端口 | `3000` | 环境变量 `PORT` |
| API 地址（前端） | `http://localhost:3000` | `src/App.vue` 顶部 `const API` |
| 数据库路径 | `backend/fileindex.db` | 代码中 `DB_PATH` |
| 上传限制 | 50 MB | `app.py` `MAX_CONTENT_LENGTH` |
| 缓存大小 | 20 个索引 | `CACHE_MAX_KEYS` |
| 缓存 TTL | 3600 秒 | `CACHE_TTL` |

---

## 🔮 后续规划

- [ ] SQLite FTS5 全文检索（文件内容索引）
- [ ] 增量扫描（只处理变更文件）
- [ ] 多目录并发索引
- [ ] 本地 LLM（Ollama）语义搜索接入
- [ ] 定时自动重建索引
- [ ] 跨机器索引同步

---

## 📄 许可证

ISC License

> **隐私声明**：所有数据均在本地处理，不会上传至任何外部服务器。
