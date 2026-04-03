# 本地硬盘文件索引工具

一个功能强大的本地文件索引和搜索工具，支持多平台（Windows、Linux、macOS），帮助您快速管理和搜索本地文件。

## 功能特性

- **文件索引**：递归遍历本地目录，收集文件元数据（路径、大小、修改时间、创建者）
- **快速搜索**：基于索引文件进行高效的文件搜索
- **CSV 导出**：将索引结果导出为 CSV 格式，便于后续处理
- **文件上传**：支持上传已有的 CSV 文件进行搜索
- **搜索历史**：自动记录搜索历史，方便快速重复搜索
- **多平台支持**：支持 Windows、Linux 和 macOS 系统
- **安全验证**：防止路径遍历攻击，确保操作安全

## 技术栈

### 前端
- **Vue 3** - 渐进式 JavaScript 框架
- **Vite** - 下一代前端构建工具
- **Axios** - HTTP 客户端

### 后端
- **Node.js + Express** - 高性能 Web 服务器
- **Python + Flask** - 轻量级 Web 框架
- **CSV 处理** - CSV 文件的读写和解析

## 项目结构

```
file/
├── backend/              # 后端代码
│   ├── app.py           # Flask 后端服务器
│   ├── index.js         # Express 后端服务器
│   ├── package.json     # Node.js 依赖配置
│   ├── requirements.txt # Python 依赖配置
│   └── temp/            # 临时文件目录（自动生成）
├── frontend/            # 前端代码
│   ├── src/
│   │   ├── App.vue     # 主应用组件
│   │   ├── main.js     # 应用入口
│   │   └── assets/     # 静态资源
│   ├── public/         # 公共资源
│   ├── index.html      # HTML 模板
│   ├── package.json    # 前端依赖配置
│   └── vite.config.js  # Vite 配置
├── .gitignore          # Git 忽略配置
└── README.md           # 项目文档
```

## 快速开始

### 环境要求

- Node.js 14+ 
- Python 3.7+
- npm 或 yarn

### 安装步骤

#### 1. 克隆项目

```bash
git clone <repository-url>
cd file
```

#### 2. 安装后端依赖

**Node.js 版本：**

```bash
cd backend
npm install
```

**Python 版本：**

```bash
cd backend
pip install -r requirements.txt
```

#### 3. 安装前端依赖

```bash
cd frontend
npm install
```

### 运行项目

#### 启动后端服务

**Node.js 版本：**

```bash
cd backend
npm start
```

服务将在 `http://localhost:3000` 启动

**Python 版本：**

```bash
cd backend
python app.py
```

服务将在 `http://localhost:5000` 启动

#### 启动前端开发服务器

```bash
cd frontend
npm run dev
```

前端将在 `http://localhost:5173` 启动（Vite 默认端口）

### 构建生产版本

```bash
cd frontend
npm run build
```

构建产物将生成在 `frontend/dist/` 目录

## 使用说明

### 文件索引

1. 在"目录路径"输入框中输入要索引的文件夹路径
   - Windows: `C:\Users\Documents`
   - Linux/macOS: `/home/user/documents`
2. 点击"开始索引"按钮
3. 等待索引完成，系统会显示找到的文件数量
4. 可以下载生成的 CSV 文件

### 文件搜索

1. 确保已经完成索引或上传了 CSV 文件
2. 在"搜索关键词"输入框中输入搜索词
3. 点击"搜索"按钮
4. 查看搜索结果，包括文件路径、大小、修改时间和创建者

### 上传 CSV 文件

如果您已有之前生成的 CSV 文件，可以直接上传：

1. 点击"选择文件"按钮
2. 选择 CSV 文件
3. 使用搜索功能进行文件搜索

## API 接口

### 文件索引

```http
POST /api/index
Content-Type: application/json

{
  "directoryPath": "C:\\Users\\Documents"
}
```

响应：
```json
{
  "success": true,
  "totalFiles": 1234,
  "csvFilePath": "file_index_1234567890.csv"
}
```

### 文件搜索

```http
POST /api/search
Content-Type: application/json

{
  "csvFileName": "file_index_1234567890.csv",
  "searchTerm": "document"
}
```

响应：
```json
{
  "success": true,
  "results": [
    {
      "path": "C:\\Users\\Documents\\report.pdf",
      "size": "1024.5 KB",
      "modifiedTime": "2024-01-01 12:00:00",
      "creator": "user"
    }
  ],
  "total": 1
}
```

### CSV 文件上传搜索

```http
POST /api/search/upload
Content-Type: multipart/form-data

file: <CSV file>
searchTerm: document
```

### 下载 CSV 文件

```http
GET /api/download/:filename
```

## 配置说明

### 后端配置

- **端口**：默认 3000 (Node.js) 或 5000 (Python)
- **文件大小限制**：50MB
- **临时文件目录**：`backend/temp/`

### 前端配置

- **API 基础 URL**：`http://localhost:3000`（可在 `src/App.vue` 中修改）
- **请求超时**：1 小时（用于大目录索引）

## 安全特性

- 路径遍历防护
- 文件类型验证（仅接受 CSV 文件）
- 文件大小限制
- 输入验证和清理

## 性能优化

- 支持大目录索引（带进度提示）
- 高效的 CSV 文件解析
- 搜索历史缓存
- 响应式设计，支持移动端

## 未来规划

- [ ] 增量索引功能
- [ ] 文件内容预览
- [ ] 高级搜索（正则表达式、文件类型过滤）
- [ ] 知识图谱可视化
- [ ] AI 智能分析集成
- [ ] 数据库支持（SQLite）
- [ ] 用户认证和权限管理

## 常见问题

### Q: 索引大目录时超时怎么办？

A: 可以尝试索引较小的子目录，或者修改后端的超时设置。

### Q: 支持哪些操作系统？

A: 支持 Windows、Linux 和 macOS。

### Q: 如何修改 API 端口？

A: 在后端代码中修改 `PORT` 环境变量或配置文件。

### Q: CSV 文件存储在哪里？

A: CSV 文件存储在 `backend/temp/` 目录中。

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

本项目采用 ISC 许可证。

## 联系方式

如有问题或建议，请通过以下方式联系：

- 提交 Issue
- 发送邮件

## 致谢

感谢所有为这个项目做出贡献的开发者！

---

**注意**：本工具仅用于本地文件索引和搜索，不会上传任何文件到外部服务器。所有数据都在本地处理，确保您的隐私安全。
