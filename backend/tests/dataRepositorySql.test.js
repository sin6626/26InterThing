const test = require("node:test")
const assert = require("node:assert/strict")

const {
  buildLatestRealtimeRecordSql,
  buildCountPastRowsSql,
  buildPastRowsSql,
} = require("../repositories/dataRepositorySql")

test("latest realtime query does not filter by online status", () => {
  const sql = buildLatestRealtimeRecordSql("t_sensor")

  assert.match(sql, /from\s+t_sensor_data/i)
  assert.match(sql, /where\s+d_no\s*=\s*\?/i)
  assert.doesNotMatch(sql, /online\s*=/i)
})

test("past count query does not filter by online status", () => {
  const sql = buildCountPastRowsSql("t_sensor", true, "")

  assert.match(sql, /count\(\*\)\s+as\s+total/i)
  assert.match(sql, /where\s+d_no\s*=\s*\?/i)
  assert.doesNotMatch(sql, /online\s*=/i)
})

test("past rows query does not filter by online status", () => {
  const sql = buildPastRowsSql("t_sensor", true, "")

  assert.match(sql, /select\s+\*\s+from\s+t_sensor_data/i)
  assert.match(sql, /where\s+d_no\s*=\s*\?/i)
  assert.doesNotMatch(sql, /online\s*=/i)
})
