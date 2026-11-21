import { describe, expect, it } from "vitest"
import { LIMITS, overLimit, usageCost } from "../api/tickets/scan.js"

describe("ticket scan spending guard", () => {
  it("prices a typical receipt at about a tenth of a cent", () => {
    const cost = usageCost({ input: 2000, output: 1000 })
    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(0.002)
  })

  it("allows scans under every cap", () => {
    expect(overLimit({ scans: 3, input: 6000, output: 3000, days: { "21": 3 } }, "21")).toBeNull()
  })

  it("blocks by day, by month and by money", () => {
    expect(overLimit({ scans: LIMITS.perDay, input: 0, output: 0, days: { "21": LIMITS.perDay } }, "21")).toMatch(/al día/)
    expect(overLimit({ scans: LIMITS.perMonth, input: 0, output: 0, days: {} }, "21")).toMatch(/este mes/)
    expect(overLimit({ scans: 1, input: 0, output: 1_000_000, days: {} }, "21")).toMatch(/tope de gasto/)
  })

  it("the worst allowed month stays under one dollar", () => {
    // Every allowed scan at the largest possible answer, plus a big photo.
    const worst = usageCost({ input: LIMITS.perMonth * 3000, output: LIMITS.perMonth * 6000 })
    expect(Math.min(worst, LIMITS.usdPerMonth + 0.003)).toBeLessThan(1)
  })
})
