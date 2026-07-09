# Dynamic Realtime Field Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make realtime cards and charts resolve MQTT payload values from database field metadata instead of hard-coded field names.

**Architecture:** Add `p_name` to the existing realtime metadata response. Put the small payload-resolution rules beside the existing minute-series helper, then reuse them from sensor and behavior realtime pages.

**Tech Stack:** Node.js `node:test`, Vue 3, existing Express serializers.

---

### Task 1: Expose MQTT field names

**Files:**
- Modify: `backend/tests/dataSerializer.test.js`
- Modify: `backend/serializers/dataSerializer.js`

- [ ] Add a failing serializer test asserting `buildRealtimeResponse()` metadata contains `p_name: "temp"`.
- [ ] Run `node --test tests/dataSerializer.test.js` from `backend`; expect the new assertion to fail because `p_name` is absent.
- [ ] Add `p_name: field.p_name` to `buildRealtimeMetadata()`.
- [ ] Re-run the serializer test; expect all tests to pass.

### Task 2: Resolve realtime payload dynamically

**Files:**
- Modify: `frontend/tests/useMinuteSeries.test.js`
- Modify: `frontend/src/composables/useMinuteSeries.js`

- [ ] Add failing tests for `resolveRealtimeValues(payload, metadata)`, using `{ temp: 32.5, flow: 18.6, pressurre: 12.4 }`; assert output is keyed by `f_name`, preserves zero, and returns `null` for a missing value.
- [ ] Run `npm test -- --test-name-pattern="resolveRealtimeValues"` from `frontend`; expect failure because the export does not exist.
- [ ] Implement `resolveRealtimeValues()` by reading each metadata row in `p_name`, `db_name`, `f_name` order and returning both display and database keyed values.
- [ ] Re-run the focused test; expect it to pass.

### Task 3: Replace hard-coded realtime mappings

**Files:**
- Modify: `frontend/src/views/showSensor/RealTimeData.vue`
- Modify: `frontend/src/views/showBehavior/RealTimeData.vue`

- [ ] Import `resolveRealtimeValues` and replace each page's hard-coded card field mapping with metadata-driven display values.
- [ ] Replace each page's hard-coded chart normalization with metadata-driven values selected by `series.db_name`; pass `null` for missing values rather than fabricating zero.
- [ ] Run `npm test` and `npm run build` from `frontend`; expect both to pass.
- [ ] Run `npm test` from `backend`; expect all tests to pass.
- [ ] Confirm `rg -n "Tout|LXin|Tin|field[1-5]|水温1|水质1" frontend/src/views/showSensor/RealTimeData.vue frontend/src/views/showBehavior/RealTimeData.vue` finds no realtime mapping hard-codes.
- [ ] Commit only the implementation and regression-test files.
