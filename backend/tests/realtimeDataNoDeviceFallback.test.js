const test = require("node:test")
const assert = require("node:assert/strict")

const {
  buildLatestRealtimeRecordSql,
  buildCountPastRowsSql,
  buildPastRowsSql,
} = require("../repositories/dataRepositorySql")

test("latest realtime query should support querying latest record when d_no is not provided", () => {
  const sqlWithoutDno = buildLatestRealtimeRecordSql("t_sensor", false)
  // 当没有提供 d_no 时，不应该硬编码 where d_no = ? 或 where d_no = '202111'
  assert.match(sqlWithoutDno, /from\s+t_sensor_data/i)
  assert.match(sqlWithoutDno, /order\s+by\s+c_time\s+desc/i)
  assert.doesNotMatch(sqlWithoutDno, /where\s+d_no\s*=\s*'202111'/i)
  assert.doesNotMatch(sqlWithoutDno, /where\s+d_no\s*=\s*\?/i)
})

test("count past rows query when hasDeviceFilter is false should use 1=1 instead of hardcoded 202111", () => {
  const sql = buildCountPastRowsSql("t_sensor", false, "")
  assert.match(sql, /1=1/)
  assert.doesNotMatch(sql, /202111/)
})
