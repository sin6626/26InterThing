const test = require("node:test")
const assert = require("node:assert/strict")

const { summarizeRecognitionSelection } = require("../services/recognitionService")

test("summarizeRecognitionSelection rejects empty selections", () => {
  assert.throws(
    () => summarizeRecognitionSelection([]),
    /请选择需要识别的传感器数据/,
  )
})

test("summarizeRecognitionSelection reports selected rows", () => {
  const result = summarizeRecognitionSelection([{ id: 1 }, { id: 2 }])

  assert.deepEqual(result, {
    recognized: false,
    selectedCount: 2,
    message: "已选择 2 条传感器数据，智能判定接口待接入",
  })
})
