const fs = require("node:fs")
const path = require("node:path")

function loadEnv(filePath = path.join(__dirname, "..", ".env")) {
  if (!fs.existsSync(filePath)) return

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (!match || match[1].startsWith("#") || process.env[match[1]] !== undefined) {
      continue
    }

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
  }
}

module.exports = loadEnv
