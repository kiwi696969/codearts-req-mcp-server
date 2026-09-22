# MCP · 将华为云服务封装成 MCP Server（CodeArts Req）

ICT 大赛云赛道赛题 1.8：理解 MCP 与 Rule/Skill 的差异，掌握写好一个 MCP Server 的关键要素，并用 MCP Builder 的方式从零构建一个封装华为云 CodeArts 需求管理 API（创建项目 / 查询项目列表）的可跑通的 MCP Server。

## 作品内容

```
codearts-req-mcp-server/
├── server.mjs          # MCP Server 主程序（stdio 传输，@modelcontextprotocol/sdk）
├── lib/hwsign.mjs      # 华为云 AK/SK 签名工具（SDK-HMAC-SHA256）
├── mcp_settings.json   # 码道 MCP 配置示例
└── package.json        # Node.js 依赖
```

## MCP 与 Rule / Skill 的分工

| 维度 | 规则（Rule） | 技能（Skill） | MCP Server |
|------|------------|--------------|-----------|
| 定义 | 约束智能体的行为方式 | 描述如何完成特定任务 | 提供外部工具的调用能力 |
| 加载方式 | 对话开始时加载，持续参与推理 | 按需加载，减少上下文占用 | 不参与推理，按需调用外部接口 |
| 一句话 | Rule 定边界 | Skill 给流程 | MCP 提供"能动手"的外部工具 |

## 写好一个 MCP Server 的四要素

1. **工具名（name）**：用 `动词_名词` 的 snake_case —— `create_project`、`list_projects`；
2. **描述（description）**：写清"什么时候该用它、做什么、返回什么"，智能体据此决定是否调用；
3. **参数 Schema（input schema）**：每个参数的类型、是否必填、含义写清（Zod 定义 + describe）；
4. **错误处理（error handling）**：结构化错误——`INVALID_ARGUMENTS`（参数非法）、`MISSING_CONFIG`（缺配置）、`API_ERROR`（透传 error_code/error_msg/http_status）、`NETWORK_ERROR`（网络异常）。

## 工具定义

### create_project — 创建项目
- 请求：`POST /v4/project`
- 参数：`project_name`（string，必填，1-128）、`project_type`（enum：scrum/normal/xboard/basic/phoenix/ipd，必填）、`description` / `enterprise_id` / `source` / `template_id`（选填，template_id 在 project_type=ipd 时必传）
- 返回：project_id、project_num_id、project_name、project_type、user_num_id

### list_projects — 查询项目列表
- 请求：`GET /v4/projects`
- 参数：`offset`（默认 0，须为 limit 整数倍）、`limit`（默认 10）、`search` / `project_type` / `sort` / `archive` / `query_type`（选填）
- 返回：projects 数组 与 total

## 配置与运行

```bash
npm install

# 配置环境变量
export CODEARTS_REQ_ENDPOINT="https://projectman.cn-north-4.myhuaweicloud.com"
export CODEARTS_REQ_AK="你的AK"
export CODEARTS_REQ_SK="你的SK"
export CODEARTS_REQ_REGION="cn-north-4"

# 启动（stdio 模式，供 MCP 客户端/码道连接）
node server.mjs
```

在码道中配置 MCP 服务器时，将 `mcp_settings.json` 中的 `${CODEARTS_REQ_AK}` / `${CODEARTS_REQ_SK}` 替换为实际凭据。

## 验证

使用 MCP Inspector 或任意 MCP 客户端连接后，应能列出 `create_project` 与 `list_projects` 两个工具；
未配置 AK/SK 时调用工具返回 `MISSING_CONFIG` 结构化错误，配置后会真实调用 CodeArts Req API。