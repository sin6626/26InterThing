const test = require("node:test")
const assert = require("node:assert/strict")

const { buildDirectTypesSql } = require("../repositories/directRepositorySql")

test("direct type query can order distinct options under mysql strict mode", () => {
  const sql = buildDirectTypesSql()

  assert.match(sql, /select\s+topic\s+as\s+value,\s+t_name\s+as\s+label/i)
  assert.match(sql, /group by\s+topic,\s+t_name/i)
  assert.match(sql, /order by\s+min\(id\)/i)
  assert.doesNotMatch(sql, /select\s+distinct/i)
})
