import { it, expect } from "vitest"
import { toSafeHost } from "./util"

it("escapes url host", async () => {
  expect(toSafeHost("https://foobar:8080")).toBe("foobar")
  expect(toSafeHost("https://ほげ")).toBe("xn--18j4d")
  expect(toSafeHost("https://test.😉.invalid")).toBe("test.xn--n28h.invalid")
  expect(toSafeHost("https://dev.😉-coder.com")).toBe("dev.xn---coder-vx74e.com")
  expect(() => toSafeHost("invalid url")).toThrow("Invalid URL")
  expect(toSafeHost("http://ignore-port.com:8080")).toBe("ignore-port.com")
})
