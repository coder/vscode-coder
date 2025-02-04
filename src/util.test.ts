import { it, expect } from "vitest"
import { parseRemoteAuthority, toSafeHost } from "./util"

it("ignore unrelated authorities", async () => {
  const tests = [
    "vscode://ssh-remote+some-unrelated-host.com",
    "vscode://ssh-remote+coder-vscode",
    "vscode://ssh-remote+coder-vscode-test",
    "vscode://ssh-remote+coder-vscode-test--foo--bar",
    "vscode://ssh-remote+coder-vscode-foo--bar",
    "vscode://ssh-remote+coder--foo--bar",
  ]
  for (const test of tests) {
    expect(parseRemoteAuthority(test)).toBe(null)
  }
})

it("should error on invalid authorities", async () => {
  const tests = [
    "vscode://ssh-remote+coder-vscode--foo",
    "vscode://ssh-remote+coder-vscode--",
    "vscode://ssh-remote+coder-vscode--foo--",
    "vscode://ssh-remote+coder-vscode--foo--bar--",
  ]
  for (const test of tests) {
    expect(() => parseRemoteAuthority(test)).toThrow("Invalid")
  }
})

it("should parse authority", async () => {
  expect(parseRemoteAuthority("vscode://ssh-remote+coder-vscode--foo--bar")).toStrictEqual({
    agent: "",
    host: "coder-vscode--foo--bar",
    label: "",
    username: "foo",
    workspace: "bar",
  })
  expect(parseRemoteAuthority("vscode://ssh-remote+coder-vscode--foo--bar--baz")).toStrictEqual({
    agent: "baz",
    host: "coder-vscode--foo--bar--baz",
    label: "",
    username: "foo",
    workspace: "bar",
  })
  expect(parseRemoteAuthority("vscode://ssh-remote+coder-vscode.dev.coder.com--foo--bar")).toStrictEqual({
    agent: "",
    host: "coder-vscode.dev.coder.com--foo--bar",
    label: "dev.coder.com",
    username: "foo",
    workspace: "bar",
  })
  expect(parseRemoteAuthority("vscode://ssh-remote+coder-vscode.dev.coder.com--foo--bar--baz")).toStrictEqual({
    agent: "baz",
    host: "coder-vscode.dev.coder.com--foo--bar--baz",
    label: "dev.coder.com",
    username: "foo",
    workspace: "bar",
  })
  expect(parseRemoteAuthority("vscode://ssh-remote+coder-vscode.dev.coder.com--foo--bar.baz")).toStrictEqual({
    agent: "baz",
    host: "coder-vscode.dev.coder.com--foo--bar.baz",
    label: "dev.coder.com",
    username: "foo",
    workspace: "bar",
  })
})

it("escapes url host", async () => {
  expect(toSafeHost("https://foobar:8080")).toBe("foobar")
  expect(toSafeHost("https://ほげ")).toBe("xn--18j4d")
  expect(toSafeHost("https://test.😉.invalid")).toBe("test.xn--n28h.invalid")
  expect(toSafeHost("https://dev.😉-coder.com")).toBe("dev.xn---coder-vx74e.com")
  expect(() => toSafeHost("invalid url")).toThrow("Invalid URL")
  expect(toSafeHost("http://ignore-port.com:8080")).toBe("ignore-port.com")
})
