const buildDirectTypesSql = () => `
  select topic as value, t_name as label
  from t_direct_config
  where topic is not null and trim(topic) <> ''
  group by topic, t_name
  order by min(id)
`

module.exports = {
  buildDirectTypesSql,
}
