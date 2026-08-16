const { query } = require("../repositories/query")

const EXTRA_COLUMNS = [
  {
    name: "publish_topic",
    definition: "VARCHAR(255) NULL DEFAULT NULL COMMENT 'MQTT实际发布主题'",
  },
  {
    name: "payload_template",
    definition: "TEXT NULL COMMENT 'MQTT载荷模板JSON'",
  },
  {
    name: "value_map",
    definition: "TEXT NULL COMMENT '控制值到设备值的JSON映射'",
  },
]

let ensuredDatabase = null
let ensuringPromise = null

const getCurrentDatabaseName = async () => {
  const rows = await query("SELECT DATABASE() AS database_name")
  return rows[0]?.database_name || null
}

const ensureColumnExists = async (databaseName, column) => {
  const rows = await query(
    `SELECT COUNT(*) AS total
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 't_direct_config' AND column_name = ?`,
    [databaseName, column.name],
  )

  if (Number(rows[0]?.total || 0) > 0) {
    return
  }

  await query(`ALTER TABLE t_direct_config ADD COLUMN ${column.name} ${column.definition}`)
}

const ensureControlConfigSchema = async () => {
  const databaseName = await getCurrentDatabaseName()
  if (!databaseName || ensuredDatabase === databaseName) {
    return
  }
  if (ensuringPromise) {
    await ensuringPromise
    return
  }

  ensuringPromise = (async () => {
    for (const column of EXTRA_COLUMNS) {
      await ensureColumnExists(databaseName, column)
    }
    ensuredDatabase = databaseName
  })().finally(() => {
    ensuringPromise = null
  })

  await ensuringPromise
}

module.exports = {
  ensureControlConfigSchema,
}
