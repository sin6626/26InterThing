const test = require("node:test")
const assert = require("node:assert/strict")

const { buildEmptyChartResponse } = require("../serializers/dataSerializer")

test("buildEmptyChartResponse returns an empty chart payload", () => {
  const data = buildEmptyChartResponse("202111")

  assert.deepEqual(data, {
    baseInfo: {
      编号: "202111",
      是否在线数据: "全部数据",
    },
    xAxisData: [],
    seriesData: [],
  })
})
