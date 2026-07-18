const fs = require("node:fs")
const path = require("node:path")

const defaultPayloadTemplatePath = path.join(
  __dirname,
  "..",
  "config",
  "ai-recognize-payload.json",
)

const resolveBackendPath = (filePath) => {
  return path.isAbsolute(filePath) ? filePath : path.join(__dirname, "..", filePath)
}

const summarizeRecognitionSelection = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("请选择需要识别的传感器数据")
  }

  return {
    recognized: false,
    selectedCount: rows.length,
    message: `已选择 ${rows.length} 条传感器数据，智能判定接口待接入`,
  }
}

const getValueByPath = (source, valuePath) => {
  return valuePath.split(".").reduce((current, key) => current?.[key], source)
}

const applyPayloadTemplate = (template, rows) => {
  if (Array.isArray(template)) {
    return template.map((item) => applyPayloadTemplate(item, rows))
  }

  if (template && typeof template === "object") {
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [
        key,
        applyPayloadTemplate(value, rows),
      ]),
    )
  }

  if (typeof template !== "string" || !template.startsWith("$")) {
    return template
  }

  if (template === "$rows") return rows
  if (template === "$firstRow") return rows[0]
  if (template === "$selectedCount") return rows.length
  if (template.startsWith("$firstRow.")) {
    return getValueByPath(rows[0], template.slice("$firstRow.".length))
  }

  return template
}

const buildAiPayload = ({
  rows,
  payloadKey = process.env.AI_RECOGNIZE_PAYLOAD_KEY || "rows",
  payloadTemplatePath = process.env.AI_RECOGNIZE_PAYLOAD_TEMPLATE ||
    defaultPayloadTemplatePath,
} = {}) => {
  const resolvedTemplatePath = payloadTemplatePath
    ? resolveBackendPath(payloadTemplatePath)
    : null

  if (!resolvedTemplatePath || !fs.existsSync(resolvedTemplatePath)) {
    return { [payloadKey]: rows }
  }

  try {
    const template = JSON.parse(fs.readFileSync(resolvedTemplatePath, "utf8"))
    return applyPayloadTemplate(template, rows)
  } catch (error) {
    throw new Error(`智能判定请求模板解析失败：${error.message}`)
  }
}

const recognizeSensorRows = async (
  rows,
  {
    aiUrl = process.env.AI_RECOGNIZE_URL,
    payloadKey = process.env.AI_RECOGNIZE_PAYLOAD_KEY || "rows",
    payloadTemplatePath = process.env.AI_RECOGNIZE_PAYLOAD_TEMPLATE ||
      defaultPayloadTemplatePath,
    fetchImpl = globalThis.fetch,
  } = {},
) => {
  const summary = summarizeRecognitionSelection(rows)

  if (!aiUrl) {
    return summary
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("当前 Node 环境不支持 fetch，无法调用智能判定服务")
  }

  const response = await fetchImpl(aiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAiPayload({ rows, payloadKey, payloadTemplatePath })),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`智能判定服务调用失败：HTTP ${response.status}`)
  }

  const data = await response.json()
  return {
    recognized: true,
    selectedCount: rows.length,
    message: data.message || "智能判定完成",
    result: data,
  }
}

module.exports = {
  applyPayloadTemplate,
  buildAiPayload,
  recognizeSensorRows,
  summarizeRecognitionSelection,
}
