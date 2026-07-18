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

const recognizeSensorRows = async (
  rows,
  {
    aiUrl = process.env.AI_RECOGNIZE_URL,
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
    body: JSON.stringify({ rows }),
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
  recognizeSensorRows,
  summarizeRecognitionSelection,
}
