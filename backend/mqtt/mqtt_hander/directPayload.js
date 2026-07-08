const normalizeReportedDirectValue = (value) => {
  const parts = String(value ?? "").trim().split(/\s+/)
  return parts[1] || parts[0] || ""
}

module.exports = {
  normalizeReportedDirectValue,
}
