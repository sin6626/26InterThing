const test = require("node:test")
const assert = require("node:assert/strict")

const {
  recognizeSensorRows,
  summarizeRecognitionSelection,
} = require("../services/recognitionService")

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

test("recognizeSensorRows forwards rows to configured AI service", async () => {
  const calls = []
  const result = await recognizeSensorRows(
    [{ id: 1 }],
    {
      aiUrl: "http://127.0.0.1:8000/predict",
      fetchImpl: async (url, options) => {
        calls.push({ url, options })
        return {
          ok: true,
          json: async () => ({ message: "识别成功", type: "normal" }),
        }
      },
    },
  )

  assert.equal(calls[0].url, "http://127.0.0.1:8000/predict")
  assert.equal(calls[0].options.method, "POST")
  assert.equal(calls[0].options.body, JSON.stringify({ rows: [{ id: 1 }] }))
  assert.deepEqual(result, {
    recognized: true,
    selectedCount: 1,
    message: "识别成功",
    result: { message: "识别成功", type: "normal" },
  })
})
