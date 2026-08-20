const test = require("node:test")
const assert = require("node:assert/strict")

const {
  ensureWaterControlConfigs,
  WATER_CONTROL_CONFIGS,
} = require("../services/waterControlConfigSeed")

test("ensureWaterControlConfigs idempotently seeds every required water control node", async () => {
  const calls = []
  await ensureWaterControlConfigs(async (sql, params) => {
    const normalizedSql = sql.replace(/\s+/g, " ").trim()
    calls.push({ sql: normalizedSql, params })
    if (normalizedSql.startsWith("SELECT")) return []
    return { insertId: params?.[0] }
  })

  const configInserts = calls.filter((call) => call.sql.startsWith("INSERT INTO t_direct_config"))
  const defaultInserts = calls.filter((call) => call.sql.startsWith("INSERT IGNORE INTO t_direct_global"))
  assert.equal(configInserts.length, WATER_CONTROL_CONFIGS.length)
  assert.equal(defaultInserts.length, WATER_CONTROL_CONFIGS.length)
  assert.deepEqual(
    configInserts.map((call) => call.params[6]),
    [
      "master",
      "target_temperature",
      "temperature_hysteresis",
      "min_safe_flow",
      "max_safe_pressure",
      "max_safe_temperature",
      "build_flow_timeout",
      "low_flow_confirm_time",
      "cooling_delay",
      "data_timeout",
      "command_timeout",
      "pump",
      "heater",
    ],
  )
  assert.ok(calls.every((call) => !call.sql.includes("ON DUPLICATE KEY UPDATE")))
})

test("ensureWaterControlConfigs reuses semantic topics and falls back to generated ids on collisions", async () => {
  const calls = []
  await ensureWaterControlConfigs(async (sql, params) => {
    const normalizedSql = sql.replace(/\s+/g, " ").trim()
    calls.push({ sql: normalizedSql, params })
    if (normalizedSql.includes("WHERE topic = ?") && params[0] === "pump") return [{ id: 99 }]
    if (normalizedSql.includes("WHERE topic = ?")) return []
    if (normalizedSql.includes("WHERE id = ?") && params[0] === 20) return [{ id: 20 }]
    if (normalizedSql.startsWith("SELECT")) return []
    if (normalizedSql.startsWith("INSERT INTO t_direct_config") && !normalizedSql.includes(" id,")) {
      return { insertId: 120 }
    }
    return { insertId: params?.[0] }
  })

  const pumpConfigInserts = calls.filter((call) => (
    call.sql.startsWith("INSERT INTO t_direct_config") && call.params.includes("pump")
  ))
  assert.equal(pumpConfigInserts.length, 0)
  assert.ok(calls.some((call) => (
    call.sql.startsWith("INSERT IGNORE INTO t_direct_global")
      && call.params[0] === 99
  )))
  assert.ok(calls.some((call) => (
    call.sql.startsWith("INSERT IGNORE INTO t_direct_global")
      && call.params[0] === 120
  )))
})
