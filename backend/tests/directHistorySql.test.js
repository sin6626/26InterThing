const test = require("node:test")
const assert = require("node:assert/strict")

const {
  buildCountDirectHistorySql,
  buildDirectHistoryRowsSql,
  buildEnsureDirectHistoryTableSql,
} = require("../repositories/directHistorySql")

test("direct history table stores command audit records", () => {
  const sql = buildEnsureDirectHistoryTableSql()

  assert.match(sql, /create table if not exists t_direct_history/i)
  assert.match(sql, /operate_time datetime/i)
  assert.match(sql, /direct_type varchar\(64\)/i)
  assert.match(sql, /old_value varchar\(255\)/i)
  assert.match(sql, /new_value varchar\(255\)/i)
})

test("direct history query filters by command type and time", () => {
  const whereSql = " AND operate_time >= ? AND operate_time <= ?"
  const sql = buildDirectHistoryRowsSql({ hasTypeFilter: true, timeSql: whereSql })

  assert.match(sql, /from t_direct_history/i)
  assert.match(sql, /where 1=1/i)
  assert.match(sql, /direct_type = \?/i)
  assert.match(sql, /operate_time >= \?/i)
  assert.match(sql, /order by operate_time desc/i)
  assert.match(sql, /limit \? offset \?/i)
})

test("direct history count uses same filters", () => {
  const whereSql = " AND operate_time >= ?"
  const sql = buildCountDirectHistorySql({ hasTypeFilter: true, timeSql: whereSql })

  assert.match(sql, /count\(\*\) as total/i)
  assert.match(sql, /direct_type = \?/i)
  assert.match(sql, /operate_time >= \?/i)
})
