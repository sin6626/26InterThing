const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")

const loadEnv = require("../config/loadEnv")

test("loadEnv reads backend env files without overriding existing variables", () => {
  delete process.env.AI_RECOGNIZE_URL
  process.env.QUOTED_VALUE = "keep"

  loadEnv(path.join(__dirname, "fixtures", "sample.env"))

  assert.equal(process.env.AI_RECOGNIZE_URL, "http://127.0.0.1:8000/predict")
  assert.equal(process.env.QUOTED_VALUE, "keep")

  delete process.env.AI_RECOGNIZE_URL
  delete process.env.QUOTED_VALUE
})
