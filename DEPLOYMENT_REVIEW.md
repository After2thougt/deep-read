# DeepRead 部署一致性审查

## 结论
⚠️ **基本一致，但存在问题** — 核心部署流程正确，但存在多项配置不一致、废弃代码残留、路径硬编码等问题，可能导致全新服务器部署失败或运行时异常。

---

## 1. 项目实际运行结构

| 项目 | 实际值 | 来源 |
|------|--------|------|
| **前端构建命令** | `npm run build` (输出到 `dist/`) | `package.json` + `vite.config.js` |
| **后端启动方式** | `node backend/server.js` | `package.json:start` + `ecosystem.config.cjs` |
| **后端入口文件** | `backend/server.js` (CommonJS, `type: commonjs`) | `backend/package.json` |
| **PM2 进程名** | `deepread` | `ecosystem.config.cjs` |
| **监听端口** | 3000 | `server.js: PORT = Number(process.env.PORT \|\| 3000)` |
| **绑定地址** | 127.0.0.1 | `server.js: HOST = process.env.HOST \|\| "127.0.0.1"` |
| **Node.js 版本要求** | ≥ 22 (LTS) | `install.sh: NODE_MIN_MAJOR=22` |
| **数据库路径** | `/data/deepread/app.db` (生产) / `./data/app.db` (开发) | `db.js: databasePath = path.resolve(process.env.DATABASE_PATH \|\| path.join(__dirname, '..', 'data', 'app.db'))` |
| **上传目录** | `./uploads/articles/` (相对 backend 目录) | `server.js: uploadsRoot = path.resolve(__dirname, "..", "uploads", "articles")` |
| **临时上传目录** | `./uploads/temp/` | `server.js: tempUploadsRoot = path.resolve(__dirname, "..", "uploads", "temp")` |
| **静态文件服务** | Express 静态 `/uploads` → `path.resolve(__dirname, '..', 'uploads')` | `server.js` |
| **前端静态文件** | `dist/` (生产环境由 Express 托管) | `server.js: distPath = path.resolve(__dirname, '..', 'dist')` |
| **代理配置** | HTTP/HTTPS/ALL_PROXY = `http://127.0.0.1:7890` (Mihomo) | `ecosystem.config.cjs` + `server.js` 使用 `ProxyAgent("http://127.0.0.1:7890")` |
| **环境变量文件** | 根目录 `.env` (加载优先级: 根目录 `.env` > `backend/.env`) | `server.js: dotenv.config({ path: path.resolve(__dirname, "..", ".env") })` 两次 |
| **数据库类型** | SQLite (better-sqlite3) + WAL 模式 | `db.js` |
| **Nginx 反代** | 全部请求转发到 `http://127.0.0.1:3000` | `nginx.conf` |

---

## 2. 部署脚本逐项检查

| 文件 | 状态 | 问题 | 建议 |
|------|------|------|------|
| **backup-db.sh** | ✅ 基本一致 | 无 | 保持现状 |
| **backup.sh** | ❌ **严重不一致** | 1. `cd /opt/deepread/app` 硬编码路径<br>2. 使用 `npm run db:backup` 但这调用 `backend/scripts/backup.js`，而实际数据库在 `/data/deepread/app.db`<br>3. 设置 `DATABASE_PATH=/data/app.db` (缺少 deepread 子目录) | **需重写** - 应调用 `bash deploy/backup-db.sh` 或直接使用 sqlite3 备份 |
| **check.sh** | ⚠️ 存在问题 | 1. `APP_DIR="/opt/deepread/app"` 硬编码<br>2. 检查 `migrations` 表，但项目未使用 migrations 表 (db.js 中无此表)<br>3. `ASSET_COUNT` 检查 `dist/assets` 但未验证实际构建输出<br>4. 代理测试使用 BBC，依赖外部网络 | 1. 移除 migrations 表检查<br>2. 放宽资产检查<br>3. 代理测试改为可选或内部测试 |
| **deepread-deploy.service** | ✅ 一致 | 无 | 保持现状 |
| **deepread-deploy.sh** | ✅ 基本一致 | 1. 使用 `npm install` 而非 `npm ci` (生产应用 ci)<br>2. 无 `backend` 依赖安装<br>3. 无数据库迁移步骤 | 1. 改为 `npm ci`<br>2. 添加 `cd backend && npm ci`<br>3. 添加 `bash deploy/migrate.sh` |
| **deepread-deploy.timer** | ✅ 一致 | 无 | 保持现状 |
| **ecosystem.config.cjs** | ⚠️ 存在问题 | 1. `env_file: ENV_FILE` 但 PM2 ecosystem 不支持 `env_file` 字段 (应在 env 中直接定义或用 `pm2 start --env-file`)<br>2. 代理环境变量重复定义大小写，但代码中 `ProxyAgent("http://127.0.0.1:7890")` 硬编码，未读取环境变量<br>3. `out_file/error_file: '/dev/null'` 丢失日志，建议输出到 `/data/deepread/logs/` | 1. 移除 `env_file`，将关键变量直接写入 `env`<br>2. 修改 `server.js` 读取 `HTTP_PROXY` 环境变量<br>3. 日志输出到数据目录 |
| **import-db.sh** | ✅ 基本一致 | 1. `APP_DIR="/opt/deepread/app"` 硬编码但未使用<br>2. 依赖 `pm2` 命令，需确保 ubuntu 用户 PATH 正确 | 移除未使用的变量 |
| **install.sh** | ⚠️ 存在关键问题 | 见第 4 节详细分析 | 见第 4 节 |
| **migrate.sh** | ⚠️ 部分问题 | 1. `MIGRATIONS_DIR="${APP_DIR}/deploy/migrations"` 但该目录**不存在**<br>2. 迁移表 `migrations` 在 db.js 中未定义 (会自动创建但无初始迁移文件) | 1. 创建 `deploy/migrations/` 并添加基础迁移<br>2. 或移除 migrate.sh 调用 |
| **nginx.conf** | ✅ 基本一致 | 1. 无 SSL/TLS 配置 (生产需补充)<br>2. 无 gzip/缓存优化<br>3. `server_name _;` 接受任意域名，建议限制 | 生产部署前补充 SSL、gzip、缓存头 |
| **reset-db.sh** | ✅ 一致 | 使用 `${DATABASE_PATH:-/data/deepread/app.db}` 兼容环境变量 | 保持现状 |
| **restore-db.sh** | ✅ 一致 | 无 | 保持现状 |
| **update.sh** | ⚠️ 存在问题 | 1. **重启 Mihomo** (step 5) — 更新应用代码不应重启代理服务，风险极高<br>2. `pm2 reload` 而自动部署用 `pm2 restart`，行为不一致<br>3. 无 `backend` 依赖安装<br>4. 健康检查重复测试代理连通性 | 1. **移除 Mihomo 重启**<br>2. 统一用 `pm2 restart --update-env`<br>3. 添加 `backend npm ci`<br>4. 精简健康检查 |

---

## 3. 代码与部署配置不一致的地方

### 3.1 关键不一致 (P0)

| # | 问题 | 代码实际行为 | 部署脚本假设 | 影响 |
|---|------|-------------|-------------|------|
| 1 | **uploads 目录路径** | `path.resolve(__dirname, "..", "uploads")` → 项目根目录 `/opt/deepread/app/uploads` | 部署脚本创建 `/data/deepread/uploads` 但**代码不读取该路径** | 图片上传存入 `/opt/deepread/app/uploads`，部署脚本备份 `/data/deepread/uploads` 为空，迁移/备份丢失上传文件 |
| 2 | **数据库路径** | `process.env.DATABASE_PATH \|\| path.join(__dirname, '..', 'data', 'app.db')` | `/data/deepread/app.db` (通过 .env 设置) | 只要 .env 正确则一致，**但 install.sh 生成的 .env 使用 `sed` 替换，若模板变动会失效** |
| 3 | **Mihomo 代理使用** | `server.js: new ProxyAgent("http://127.0.0.1:7890")` **硬编码** | `ecosystem.config.cjs` 设置 HTTP_PROXY 等环境变量 | 环境变量**完全不生效**，代理配置仅靠硬编码 |
| 4 | **PM2 env_file** | `ecosystem.config.cjs` 使用 `env_file` 字段 | PM2 **不支持**此字段 | .env 可能不被加载，导致生产环境变量缺失 |
| 5 | **backend 依赖安装** | `backend/package.json` 独立依赖 | `install.sh`/`update.sh`/`deepread-deploy.sh` 均**未安装 backend 依赖** | `better-sqlite3` 等原生模块未编译，启动崩溃 |

### 3.2 一般不一致 (P1)

| # | 问题 | 说明 |
|---|------|------|
| 6 | **npm install vs npm ci** | `deepread-deploy.sh` 用 `npm install`，生产应用 `npm ci` 保证锁文件一致性 |
| 7 | **缺少 backend npm ci** | 所有部署脚本均未 `cd backend && npm ci` |
| 8 | **migrate.sh 调用但目录不存在** | `install.sh`/`update.sh` 调用 `bash deploy/migrate.sh`，但 `deploy/migrations/` 不存在 |
| 9 | **check.sh 检查不存在的 migrations 表** | db.js 未创建 migrations 表，check.sh 会报警告 |
| 10 | **update.sh 重启 Mihomo** | 更新应用代码时重启代理服务是**极高风险**操作，可能导致全站代理中断 |
| 11 | **自动部署 vs 手动更新不一致** | `deepread-deploy.sh`: `pm2 restart` + 无迁移 + 无 backend install；`update.sh`: `pm2 reload` + 有迁移 + 有 proxy 重启 |
| 12 | **server.js 双重加载 .env** | 加载两次：`path.resolve(__dirname, "..", ".env")` 和 `path.resolve(__dirname, ".env")`，第二次无效但无害 |
| 13 | **硬编码路径** | 多脚本硬编码 `/opt/deepread/app`、`/data/deepread`，不支持自定义部署路径 |

### 3.3 细节不一致 (P2)

| # | 问题 | 说明 |
|---|------|------|
| 14 | **nginx.conf 无生产优化** | 无 gzip、无缓存头、无 SSL、无安全头 |
| 15 | **ecosystem.config.cjs 日志丢弃** | `out_file/error_file: '/dev/null'` 导致无法排查问题 |
| 16 | **backup.sh 完全错误** | 使用错误的 DATABASE_PATH 和 npm 脚本，实际不可用 |
| 17 | **install.sh 使用 `npm ci` 但无 package-lock.json 检查** | 首次部署时 package-lock.json 可能不存在 (已在 Git 中) |

---

## 4. install.sh 全新服务器部署检查

### 执行流程分析

| 步骤 | 操作 | 是否正确 | 问题 |
|------|------|----------|------|
| 1 | 系统包安装 | ✅ | 无 |
| 1b | Mihomo 安装 | ✅ | 但配置模板中的 `proxies: []` 为空，需手动配置代理节点才能工作 |
| 2 | 清理遗留部署 | ✅ | 无 |
| 3 | 目录结构创建 | ✅ | 创建 `/data/deepread/uploads` 但**代码实际用 `/opt/deepread/app/uploads`** |
| 4 | Git 克隆 | ✅ | 使用 SSH URL `git@github.com:After2thougt/deep-read.git`，需预先配置 SSH Key |
| 5 | .env 配置 | ⚠️ | `sed` 替换脆弱，模板变动会失效；`AUTH_SESSION_SECRET` 仅提示不生成 |
| 6 | 依赖安装 | ❌ | **未安装 backend 依赖** — `better-sqlite3` 编译失败会导致启动崩溃 |
| 7 | 数据库迁移 | ❌ | 调用 `migrate.sh` 但 `deploy/migrations/` **不存在**，脚本会报错退出 |
| 8 | 前端构建 | ✅ | `npm run build` 正确 |
| 9 | Nginx 配置 | ✅ | 基本正确，但无 SSL |
| 10 | PM2 启动 | ⚠️ | `env_file` 不生效；缺少 backend 依赖会崩溃 |
| 10b | 自动部署配置 | ✅ | systemd service/timer 正确安装 |
| 11 | 健康检查 | ❌ | 因上述原因会失败 |

### **结论：全新服务器执行 install.sh 会失败**
失败点：
1. **Step 7**: `migrate.sh` 找不到 migrations 目录 → 报错退出
2. **Step 10**: PM2 启动但 `better-sqlite3` 未编译 → 进程反复崩溃
3. **Step 11**: 健康检查失败

### 必须修复才能成功部署：
1. 创建 `deploy/migrations/` 目录并添加初始迁移文件，或移除 migrate.sh 调用
2. 在 Step 6 添加 `cd backend && npm ci`
3. 修复 uploads 目录不一致（见第 3.1 项 1）
4. 修复 `ecosystem.config.cjs` 的 `env_file` 问题
5. 修复 `server.js` 硬编码代理地址

---

## 5. 自动 GitHub 部署检查

### 目标架构对照

| 环节 | 目标架构 | 当前实现 | 是否一致 |
|------|---------|----------|----------|
| Git push | Windows 本地 → GitHub | ✅ 标准 Git 流程 | ✅ |
| 触发检查 | Ubuntu 每分钟检查 | ✅ `deepread-deploy.timer` (OnUnitActiveSec=1min) | ✅ |
| 检测新提交 | `git fetch origin main` + 对比 rev-parse | ✅ `deepread-deploy.sh` 实现 | ✅ |
| 重置代码 | `git reset --hard origin/main` | ✅ 实现 | ✅ |
| 安装依赖 | `npm install` | ⚠️ 用 `npm install` 非 `npm ci`；**无 backend 依赖** | ❌ |
| 前端构建 | `npm run build` | ✅ 实现 | ✅ |
| 重启服务 | `pm2 restart deepread --update-env` | ✅ 实现 | ✅ |
| 环境变量更新 | `--update-env` 重新读取 .env | ⚠️ `env_file` 不生效，环境变量可能不更新 | ❌ |
| 数据库迁移 | 目标架构**未包含** | ❌ `deepread-deploy.sh` 无迁移步骤 | ⚠️ (架构未要求) |
| 代理重启 | 目标架构**未包含** | ✅ `deepread-deploy.sh` 无代理重启 | ✅ |

### 关键缺口
1. **无 backend 依赖安装** — 任何涉及原生模块更新的提交会导致部署后崩溃
2. **env_file 不生效** — `.env` 变更不会通过 `--update-env` 生效
3. **无迁移步骤** — 如数据库结构变更，自动部署不会应用迁移

### 建议修正 `deepread-deploy.sh`：
```bash
git reset --hard origin/main
npm ci
[ -f backend/package.json ] && (cd backend && npm ci)
bash deploy/migrate.sh   # 如果有迁移目录
npm run build
pm2 restart deepread --update-env
```

---

## 6. 高风险问题

### P0 (阻断部署/导致数据丢失/服务不可用)

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| P0-1 | **uploads 目录不一致** | 🔴 Critical | 代码写入 `/opt/deepread/app/uploads`，部署脚本备份 `/data/deepread/uploads`，**用户上传图片会丢失**，备份恢复无效 |
| P0-2 | **backend 依赖未安装** | 🔴 Critical | `better-sqlite3` 需编译，`install.sh`/`update.sh`/`deepread-deploy.sh` 均缺少 `cd backend && npm ci`，全新部署/更新必崩 |
| P0-3 | **migrate.sh 目录不存在** | 🔴 Critical | `install.sh` 调用 `migrate.sh` 但 `deploy/migrations/` 不存在，安装脚本第 7 步直接报错退出 |
| P0-4 | **ecosystem.config.cjs env_file 无效** | 🔴 Critical | PM2 不支持 `env_file`，生产环境变量（数据库路径、密钥、代理）可能不生效 |
| P0-5 | **server.js 硬编码代理地址** | 🔴 Critical | `new ProxyAgent("http://127.0.0.1:7890")` 忽略环境变量，无法通过配置修改代理 |
| P0-6 | **update.sh 重启 Mihomo** | 🔴 Critical | 更新应用时重启代理服务，**极高风险**，可能导致全站外部请求中断 |

### P1 (功能受损/运维困难)

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| P1-1 | **backup.sh 完全不可用** | 🟠 High | 路径错误、DATABASE_PATH 错误、调用错误的 npm 脚本 |
| P1-2 | **自动部署无 backend install/迁移** | 🟠 High | 代码更新涉及后端依赖或数据库结构时，自动部署后服务异常 |
| P1-3 | **PM2 日志丢弃到 /dev/null** | 🟠 High | 生产环境无法排查问题 |
| P1-4 | **check.sh 检查不存在的 migrations 表** | 🟠 High | 产生误导性警告 |
| P1-5 | **nginx.conf 无生产优化** | 🟠 High | 无 gzip、缓存、SSL、安全头 |

### P2 (体验/规范问题)

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| P2-1 | **硬编码路径** | 🟡 Medium | 多脚本硬编码 `/opt/deepread/app`、`/data/deepread` |
| P2-2 | **npm install vs npm ci 不一致** | 🟡 Medium | 自动部署用 `npm install`，手动更新用 `npm ci` |
| P2-3 | **server.js 双重加载 .env** | 🟡 Medium | 无害但不规范 |
| P2-4 | **Mihomo 配置模板 proxies 为空** | 🟡 Medium | 安装后代理不可用，需手动编辑配置 |

---

## 7. 必须修改的文件

| 文件 | 修改原因 | 优先级 |
|------|----------|--------|
| **deploy/install.sh** | 修复：添加 backend npm ci、处理 migrations 目录不存在、修正 uploads 目录一致性 | P0 |
| **deploy/update.sh** | 修复：**移除 Mihomo 重启**、添加 backend npm ci、统一 pm2 restart、添加迁移步骤 | P0 |
| **deploy/deepread-deploy.sh** | 修复：改用 npm ci、添加 backend npm ci、添加迁移步骤 | P0 |
| **deploy/ecosystem.config.cjs** | 修复：移除 env_file、将关键变量写入 env、修正日志路径、读取 HTTP_PROXY 环境变量 | P0 |
| **backend/server.js** | 修复：ProxyAgent 读取 HTTP_PROXY 环境变量而非硬编码 | P0 |
| **backend/package.json** | 确认：已有独立依赖，部署脚本必须安装 | P0 |
| **deploy/migrate.sh** | 修复：创建 deploy/migrations/ 目录并添加初始迁移，或使脚本在目录不存在时优雅退出 | P0 |
| **deploy/backup.sh** | 重写：完全重写，应调用 backup-db.sh 或直接 sqlite3 备份 | P0 |
| **deploy/check.sh** | 修复：移除 migrations 表检查、修正资产检查、代理测试可选化 | P1 |
| **deploy/nginx.conf** | 增强：添加 gzip、缓存头、安全头、SSL 模板 | P1 |
| **deploy/backup-db.sh** | 检查：确认上传目录备份包含实际 uploads 路径 (`/opt/deepread/app/uploads`) | P1 |

---

## 8. 不需要修改的文件

| 文件 | 理由 |
|------|------|
| **deepread-deploy.service** | systemd service 配置正确 |
| **deepread-deploy.timer** | systemd timer 配置正确 |
| **import-db.sh** | 逻辑正确，仅需移除未使用的 APP_DIR 变量 |
| **restore-db.sh** | 逻辑正确，恢复流程完整 |
| **reset-db.sh** | 逻辑正确，危险操作有多重确认 |
| **backup-db.sh** | 核心备份逻辑正确 (SQLite .backup + 完整性校验 + 保留策略) |
| **package.json / backend/package.json** | 依赖声明正确，构建/启动命令正确 |
| **vite.config.js** | 开发代理配置正确，生产由 nginx+express 处理 |
| **db.js** | 数据库初始化、迁移、schema 管理正确 |
| **.gitignore** | 正确排除 .env、数据库、uploads、node_modules、dist |

---

## 附录：关键路径对照表

| 资源 | 代码实际路径 | 部署脚本假设路径 | 是否一致 |
|------|-------------|-----------------|----------|
| SQLite 数据库 | `/data/deepread/app.db` (via DATABASE_PATH) | `/data/deepread/app.db` | ✅ (依赖 .env 正确) |
| 文章图片上传 | `/opt/deepread/app/uploads/articles/` | `/data/deepread/uploads/` | ❌ **严重不一致** |
| 临时图片上传 | `/opt/deepread/app/uploads/temp/` | `/data/deepread/uploads/temp/` (未显式创建) | ❌ |
| 前端构建输出 | `/opt/deepread/app/dist/` | `/opt/deepread/app/dist/` | ✅ |
| PM2 日志 | `/dev/null` (丢弃) | `/data/deepread/logs/` (目录创建但未使用) | ❌ |
| Nginx 配置 | `/etc/nginx/sites-available/deepread` | 同上 | ✅ |
| Mihomo 配置 | `/etc/mihomo/config.yaml` | 同上 | ✅ |
| .env 文件 | `/opt/deepread/app/.env` | 同上 | ✅ |
| Git 仓库 | `/opt/deepread/app/.git` | 同上 | ✅ |

---

## 核心建议摘要

1. **统一 uploads 目录**：建议修改 `server.js` 使用 `/data/deepread/uploads` (通过环境变量 `UPLOADS_DIR`)，或修改部署脚本创建软链接 `/opt/deepread/app/uploads → /data/deepread/uploads`
2. **必须添加 backend 依赖安装**：所有部署脚本 (install/update/deepread-deploy) 必须包含 `cd backend && npm ci`
3. **修复 ecosystem.config.cjs**：移除 `env_file`，关键变量直接写入 `env`，日志输出到数据目录
4. **修复 server.js 代理**：`ProxyAgent` 读取 `process.env.HTTP_PROXY` 而非硬编码
5. **移除 update.sh 中的 Mihomo 重启**：更新应用代码不应重启基础设施服务
6. **创建 deploy/migrations/**：至少包含初始 schema 迁移，避免 install.sh 失败
7. **重写 backup.sh**：当前完全不可用
8. **统一 pm2 restart --update-env**：自动部署和手动更新行为一致

---

*审查基于当前代码提交状态 (main 分支) 生成，未修改任何文件。*