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

test("latest realtime query supports querying latest record without device filter", () => {
  const sql = buildLatestRealtimeRecordSql("t_sensor", false)

  assert.match(sql, /from\s+t_sensor_data/i)
  assert.match(sql, /order\s+by\s+c_time\s+desc/i)
  assert.doesNotMatch(sql, /where\s+d_no\s*=\s*\?/i)
  assert.doesNotMatch(sql, /202111/)
})

test("past count query does not filter by online status", () => {
  const sql = buildCountPastRowsSql("t_sensor", true, "")

  assert.match(sql, /count\(\*\)\s+as\s+total/i)
  assert.match(sql, /where\s+d_no\s*=\s*\?/i)
  assert.doesNotMatch(sql, /online\s*=/i)
})

test("past count query without device filter uses 1=1 instead of hardcoded 202111", () => {
  const sql = buildCountPastRowsSql("t_sensor", false, "")

  assert.match(sql, /count\(\*\)\s+as\s+total/i)
  assert.match(sql, /where\s+1=1/i)
  assert.doesNotMatch(sql, /202111/)
})

test("past rows query does not filter by online status", () => {
  const sql = buildPastRowsSql("t_sensor", true, "")

  assert.match(sql, /select\s+\*\s+from\s+t_sensor_data/i)
  assert.match(sql, /where\s+d_no\s*=\s*\?/i)
  assert.doesNotMatch(sql, /online\s*=/i)
})

test("past rows query without device filter queries all records", () => {
  const sql = buildPastRowsSql("t_sensor", false, "")

  assert.match(sql, /select\s+\*\s+from\s+t_sensor_data/i)
  assert.match(sql, /where\s+1=1/i)
  assert.doesNotMatch(sql, /202111/)
})
