import * as semver from "semver"
import { describe, expect, it } from "vitest"
import { featureSetForVersion } from "./featureSet"

describe("check version support", () => {
  it("has logs", () => {
    ;["v1.3.3+e491217", "v2.3.3+e491217"].forEach((v: string) => {
      expect(featureSetForVersion(semver.parse(v)).proxyLogDirectory).toBeFalsy()
    })
    ;["v2.3.4+e491217", "v5.3.4+e491217", "v5.0.4+e491217"].forEach((v: string) => {
      expect(featureSetForVersion(semver.parse(v)).proxyLogDirectory).toBeTruthy()
    })
  })
})
