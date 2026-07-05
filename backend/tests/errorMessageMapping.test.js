const test = require("node:test")
const assert = require("node:assert/strict")

const {
  DEFAULT_ERROR_MAPPINGS,
  buildEnsureErrorMessageTableSql,
  buildSeedErrorMessageMappingsSql,
  fallbackErrorMessage,
  resolveMappedErrorMessage,
} = require("../services/errorMessageMapping")

test("resolveMappedErrorMessage prefers explicit device message", async () => {
  const message = await resolveMappedErrorMessage({
    e_no: "E001",
    type: "3",
    e_msg: "device text",
    findMapping: async () => ({ e_msg: "mapped text" }),
  })

  assert.equal(message, "device text")
})

test("resolveMappedErrorMessage uses database mapping when e_msg is missing", async () => {
  const message = await resolveMappedErrorMessage({
    e_no: "E001",
    type: "3",
    findMapping: async () => ({ e_msg: "温度传感器连接超时" }),
  })

  assert.equal(message, "温度传感器连接超时")
})

test("resolveMappedErrorMessage falls back when mapping is missing", async () => {
  const message = await resolveMappedErrorMessage({
    e_no: "E999",
    type: "9",
    findMapping: async () => null,
  })

  assert.equal(message, fallbackErrorMessage({ e_no: "E999", type: "9" }))
})

test("buildEnsureErrorMessageTableSql creates the mapping table", () => {
  const sql = buildEnsureErrorMessageTableSql()

  assert.match(sql, /create table if not exists t_error_code_mapper/i)
  assert.match(sql, /unique key/i)
})

test("buildSeedErrorMessageMappingsSql seeds default mappings", () => {
  const { sql, params } = buildSeedErrorMessageMappingsSql()

  assert.match(sql, /insert into t_error_code_mapper/i)
  assert.equal(params.length, DEFAULT_ERROR_MAPPINGS.length * 3)
  assert.deepEqual(params.slice(0, 3), [
    DEFAULT_ERROR_MAPPINGS[0].e_no,
    DEFAULT_ERROR_MAPPINGS[0].type,
    DEFAULT_ERROR_MAPPINGS[0].e_msg,
  ])
})
