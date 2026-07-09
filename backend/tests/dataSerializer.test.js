const test = require("node:test")
const assert = require("node:assert/strict")

const {
  buildEmptyChartResponse,
  buildRealtimeResponse,
} = require("../serializers/dataSerializer")

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

test("buildRealtimeResponse exposes MQTT payload field names", () => {
  const data = buildRealtimeResponse({
    latestData: { d_no: "202111", field1: 32.5 },
    media: null,
    metadataRows: [{
      f_name: "温度",
      unit: "℃",
      db_name: "field1",
      p_name: "temp",
      visible: "1",
    }],
  })

  assert.equal(data.metadata[0].p_name, "temp")
})
