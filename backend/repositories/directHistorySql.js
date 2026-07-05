const buildEnsureDirectHistoryTableSql = () => `
  CREATE TABLE IF NOT EXISTS t_direct_history (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    operate_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    direct_type VARCHAR(64) NOT NULL,
    d_no VARCHAR(64) NULL,
    config_id BIGINT NULL,
    direct_name VARCHAR(255) NULL,
    old_value VARCHAR(255) NULL,
    new_value VARCHAR(255) NULL,
    result VARCHAR(64) NOT NULL DEFAULT 'success',
    remark VARCHAR(255) NULL,
    INDEX idx_direct_history_time (operate_time),
    INDEX idx_direct_history_type (direct_type)
  ) COMMENT='指令操作历史表'
`

const buildCountDirectHistorySql = ({ hasTypeFilter, timeSql }) => `
  select count(*) as total
  from t_direct_history
  where 1=1
    ${hasTypeFilter ? "and direct_type = ?" : ""}
    ${timeSql}
`

const buildDirectHistoryRowsSql = ({ hasTypeFilter, timeSql }) => `
  select *
  from t_direct_history
  where 1=1
    ${hasTypeFilter ? "and direct_type = ?" : ""}
    ${timeSql}
  order by operate_time desc
  limit ? offset ?
`

module.exports = {
  buildCountDirectHistorySql,
  buildDirectHistoryRowsSql,
  buildEnsureDirectHistoryTableSql,
}
