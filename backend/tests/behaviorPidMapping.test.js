const test = require("node:test")
const assert = require("node:assert/strict")

const {
  PID_BEHAVIOR_MAPPING,
  buildBehaviorPidPayload,
  buildEnsureBehaviorPidMappingSql,
} = require("../services/behaviorPid")

test("buildBehaviorPidPayload converts pid list into a behavior payload", () => {
  const payload = buildBehaviorPidPayload({
    d_no: "202111",
    pidList: ["BOX1001", "BOX1002"],
    c_time: "2026-06-04 12:00:00",
  })

  assert.deepEqual(payload, {
    d_no: "202111",
    PID: ["BOX1001", "BOX1002"],
    c_time: "2026-06-04 12:00:00",
    online: "实时数据",
    pid: "BOX1001,BOX1002",
  })
})

test("buildEnsureBehaviorPidMappingSql inserts PID into behavior field mapper", () => {
  const { sql, params } = buildEnsureBehaviorPidMappingSql()

  assert.match(sql, /insert\s+into\s+t_behavior_field_mapper/i)
  assert.deepEqual(params, [
    PID_BEHAVIOR_MAPPING.id,
    PID_BEHAVIOR_MAPPING.f_name,
    PID_BEHAVIOR_MAPPING.db_name,
    PID_BEHAVIOR_MAPPING.unit,
    PID_BEHAVIOR_MAPPING.visible,
    PID_BEHAVIOR_MAPPING.type,
    PID_BEHAVIOR_MAPPING.p_name,
    PID_BEHAVIOR_MAPPING.p_name,
    PID_BEHAVIOR_MAPPING.f_name,
    PID_BEHAVIOR_MAPPING.db_name,
  ])
})
