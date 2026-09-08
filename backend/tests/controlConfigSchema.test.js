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
      "pipe_inner_diameter",
      "min_operating_pressure",
      "pressure_flow_diagnosis_confirm_time",
      'temperature_control_strategy', 'pid_kp', 'pid_ki', 'pid_kd',
      'pid_cycle_time', 'pid_min_on_time', 'pid_min_off_time',
      'pid_resume_hysteresis',
      'pid_overshoot_allowance',
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

test('旧PID节点原位改名，保留配置ID及设备覆盖，规范节点存在时不改旧节点', async () => {
  for (const canonicalExists of [false, true]) {
    const calls = []
    await ensureWaterControlConfigs(async (sql, params) => {
      calls.push({ sql, params })
      if (sql.includes('WHERE topic = ?')) {
        if (params[0] === 'pid_min_on_time' && canonicalExists) return [{ id: 150 }]
        if (params[0] === 'pid_min_open_time') return [{ id: 140 }]
        return []
      }
      if (sql.startsWith('SELECT')) return []
      return { insertId: 200 }
    })
    const renames = calls.filter(call => call.sql.startsWith('UPDATE t_direct_config SET topic'))
    assert.equal(renames.length, canonicalExists ? 0 : 1)
    if (!canonicalExists) assert.deepEqual(renames[0].params, ['pid_min_on_time', 140, 'pid_min_open_time'])
    assert.ok(!calls.some(call => /UPDATE t_direct SET|DELETE|DROP/.test(call.sql)))
  }
})
