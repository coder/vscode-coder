import { parse } from "semver"
import { describe, expect, it } from "vitest"
import { supportsCoderAgentLogDirFlag } from "./version"

describe("check version support", () => {
  it("has logs", () => {
    expect(supportsCoderAgentLogDirFlag(parse("v1.3.3+e491217"))).toBeFalsy()
    expect(supportsCoderAgentLogDirFlag(parse("v2.3.3+e491217"))).toBeFalsy()
    expect(supportsCoderAgentLogDirFlag(parse("v2.3.4+e491217"))).toBeTruthy()
    expect(supportsCoderAgentLogDirFlag(parse("v5.3.4+e491217"))).toBeTruthy()
    expect(supportsCoderAgentLogDirFlag(parse("v5.0.4+e491217"))).toBeTruthy()
  })
})
