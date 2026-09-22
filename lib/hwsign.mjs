// lib/hwsign.mjs — 华为云 API 请求签名（SDK-HMAC-SHA256）
// 参考《API 签名指南》：CanonicalRequest → StringToSign → Signature → Authorization
import { createHash, createHmac } from "node:crypto";

const ALGORITHM = "SDK-HMAC-SHA256";

function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

// 规范化请求头：所有 key 小写、按字典序排序，格式 key:value\n
function canonicalHeaders(headers) {
  const keys = Object.keys(headers).sort();
  return keys.map((k) => `${k.toLowerCase()}:${String(headers[k]).trim()}\n`).join("");
}

function signedHeaders(headers) {
  return Object.keys(headers).sort().map((k) => k.toLowerCase()).join(";");
}

/**
 * 生成 Authorization 头
 * @param {object} opt {ak, sk, method, uri, query, headers, payload, date, region, service}
 */
export function signRequest({ ak, sk, method, uri, query = "", headers, payload = "", region, service }) {
  const date = headers["X-Sdk-Date"];
  const contentType = headers["Content-Type"] || "";
  const allHeaders = {
    "content-type": contentType,
    "x-sdk-date": date,
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  };

  const payloadHash = sha256Hex(payload);
  // CanonicalRequest
  const canonicalRequest = [
    method.toUpperCase(),
    uri,
    query,
    canonicalHeaders(allHeaders),
    signedHeaders(allHeaders),
    payloadHash,
  ].join("\n");

  const credentialScope = `${date.slice(0, 8)}/${region}/${service}/sdk-huawei-cloud`;
  const stringToSign = [
    ALGORITHM,
    date,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = hmacSha256(sk, stringToSign).toString("hex");
  const authorization =
    `${ALGORITHM} Credential=${ak}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders(allHeaders)}, Signature=${signature}`;
  return authorization;
}

export function iso8601Basic(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:-]/g, "").replace(/\.\d{3}Z$/, "Z");
}