#!/usr/bin/env node
// codearts-req-mcp-server — 封装华为云 CodeArts 需求管理 API 的本地 stdio MCP Server
//
// 工具：
//   1. create_project  创建项目（POST /v4/project）
//   2. list_projects   查询项目列表（GET /v4/projects）
//
// 配置（环境变量）：
//   CODEARTS_REQ_ENDPOINT   API 终端节点，如 https://projectman.cn-north-4.myhuaweicloud.com
//   CODEARTS_REQ_AK         华为云 Access Key Id
//   CODEARTS_REQ_SK         华为云 Secret Access Key
//   CODEARTS_REQ_REGION     区域，默认 cn-north-4
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { signRequest, iso8601Basic } from "./lib/hwsign.mjs";

const { CODEARTS_REQ_ENDPOINT = "", CODEARTS_REQ_AK = "", CODEARTS_REQ_SK = "", CODEARTS_REQ_REGION = "cn-north-4" } = process.env;

const PROJECT_TYPES = ["scrum", "normal", "xboard", "basic", "phoenix", "ipd"];
const SERVICE = "projectman";

function error(code, message, detail = {}) {
  return { content: [{ type: "text", text: JSON.stringify({ error_code: code, error_msg: message, ...detail }) }], isError: true };
}

function checkConfig() {
  if (!CODEARTS_REQ_AK || !CODEARTS_REQ_SK) {
    return "请先配置环境变量 CODEARTS_REQ_AK 和 CODEARTS_REQ_SK（华为云访问密钥）";
  }
  if (!CODEARTS_REQ_ENDPOINT) {
    return "请先配置环境变量 CODEARTS_REQ_ENDPOINT（CodeArts Req 终端节点）";
  }
  return null;
}

async function callApi(method, uri, query, payload) {
  const missing = checkConfig();
  if (missing) return { configError: missing };

  const date = iso8601Basic();
  const headers = {
    "X-Sdk-Date": date,
    "Content-Type": "application/json",
    "Host": new URL(CODEARTS_REQ_ENDPOINT).host,
  };
  const authorization = signRequest({
    ak: CODEARTS_REQ_AK, sk: CODEARTS_REQ_SK,
    method, uri, query, headers, payload: payload || "", region: CODEARTS_REQ_REGION, service: SERVICE,
  });
  headers.Authorization = authorization;

  const url = `${CODEARTS_REQ_ENDPOINT}${uri}${query ? `?${query}` : ""}`;
  const resp = await fetch(url, {
    method,
    headers,
    body: payload || undefined,
    signal: AbortSignal.timeout(15000),
  });
  const body = await resp.text();
  let json;
  try { json = JSON.parse(body); } catch { json = { raw: body }; }
  return { status: resp.status, json };
}

const server = new McpServer({
  name: "codearts-req",
  version: "1.0.0",
});

// 工具 1：创建项目
server.tool(
  "create_project",
  "创建华为云 CodeArts 需求管理项目。当用户需要新建一个项目（如 Scrum 敏捷项目、DevOps 看板项目）时使用。参数校验失败返回 INVALID_ARGUMENTS，缺配置返回 MISSING_CONFIG，API 报错透传 error_code/error_msg/http_status。",
  {
    project_name: z.string().min(1).max(128).describe("项目名称，1-128 字符，必填"),
    project_type: z.enum(PROJECT_TYPES).describe("项目类型：scrum/normal/xboard/basic/phoenix/ipd，必填"),
    description: z.string().optional().describe("项目描述，选填"),
    enterprise_id: z.string().optional().describe("企业项目 ID，选填"),
    source: z.string().min(0).max(64).optional().describe("来源标识，0-64 字符，选填"),
    template_id: z.string().optional().describe("模板 ID（10001/10002/10003），project_type=ipd 时必传"),
  },
  async ({ project_name, project_type, description, enterprise_id, source, template_id }) => {
    if (!project_name || !PROJECT_TYPES.includes(project_type)) {
      return error("INVALID_ARGUMENTS", "project_name 必填（1-128 字符），project_type 必须是 " + PROJECT_TYPES.join("/"));
    }
    const body = {
      project_name, project_type,
      description: description || "",
      enterprise_id: enterprise_id || "",
      source: source || "",
      ...(template_id ? { template_id } : {}),
    };
    try {
      const r = await callApi("POST", "/v4/project", "", JSON.stringify(body));
      if (r.configError) return error("MISSING_CONFIG", r.configError);
      if (r.status >= 400) {
        return error(r.json?.error_code || "API_ERROR", r.json?.error_msg || r.json?.message || "请求失败", { http_status: r.status });
      }
      return { content: [{ type: "text", text: JSON.stringify(r.json || { status: r.status }, null, 2) }] };
    } catch (e) {
      return error("NETWORK_ERROR", `网络异常: ${e.message}`);
    }
  }
);

// 工具 2：查询项目列表
server.tool(
  "list_projects",
  "查询华为云 CodeArts 需求管理项目列表。当用户需要查看当前账号下有哪些项目、统计项目数量时使用。支持分页、按名称搜索、按类型过滤。",
  {
    offset: z.number().int().min(0).max(10000).optional().describe("分页偏移量，默认 0，须为 limit 的整数倍"),
    limit: z.number().int().min(1).max(1000).optional().describe("每页数量，默认 10"),
    search: z.string().optional().describe("按项目名称模糊搜索"),
    project_type: z.enum(["scrum", "normal", "xboard"]).optional().describe("按项目类型过滤"),
    sort: z.string().optional().describe("排序，格式 字段:方向，最多 4 组"),
    archive: z.boolean().optional().describe("是否查询归档项目"),
    query_type: z.enum(["domain_projects", "absent"]).optional().describe("查询范围"),
  },
  async (params) => {
    const { offset = 0, limit = 10, search, project_type, sort, archive, query_type } = params;
    if (offset % limit !== 0) {
      return error("INVALID_ARGUMENTS", `offset(${offset}) 必须是 limit(${limit}) 的整数倍`);
    }
    const qs = new URLSearchParams();
    qs.set("offset", String(offset));
    qs.set("limit", String(limit));
    if (search) qs.set("search", search);
    if (project_type) qs.set("project_type", project_type);
    if (sort) qs.set("sort", sort);
    if (archive !== undefined) qs.set("archive", String(archive));
    if (query_type) qs.set("query_type", query_type);
    try {
      const r = await callApi("GET", "/v4/projects", qs.toString(), "");
      if (r.configError) return error("MISSING_CONFIG", r.configError);
      if (r.status >= 400) {
        return error(r.json?.error_code || "API_ERROR", r.json?.error_msg || r.json?.message || "请求失败", { http_status: r.status });
      }
      return { content: [{ type: "text", text: JSON.stringify(r.json || { status: r.status }, null, 2) }] };
    } catch (e) {
      return error("NETWORK_ERROR", `网络异常: ${e.message}`);
    }
  }
);

// 启动 stdio 传输
const transport = new StdioServerTransport();
await server.connect(transport);