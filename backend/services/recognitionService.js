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

module.exports = {
  summarizeRecognitionSelection,
}
