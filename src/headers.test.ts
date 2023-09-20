import * as os from "os"
import { it, expect } from "vitest"
import { getHeaders } from "./headers"

const logger = {
  writeToCoderOutputChannel() {
    // no-op
  },
}

it("should return no headers", async () => {
  await expect(getHeaders(undefined, undefined, logger)).resolves.toStrictEqual({})
  await expect(getHeaders("localhost", undefined, logger)).resolves.toStrictEqual({})
  await expect(getHeaders(undefined, "command", logger)).resolves.toStrictEqual({})
  await expect(getHeaders("localhost", "", logger)).resolves.toStrictEqual({})
  await expect(getHeaders("", "command", logger)).resolves.toStrictEqual({})
  await expect(getHeaders("localhost", "  ", logger)).resolves.toStrictEqual({})
  await expect(getHeaders("  ", "command", logger)).resolves.toStrictEqual({})
})

it("should return headers", async () => {
  await expect(getHeaders("localhost", "printf 'foo=bar\\nbaz=qux'", logger)).resolves.toStrictEqual({
    foo: "bar",
    baz: "qux",
  })
  await expect(getHeaders("localhost", "printf 'foo=bar\\r\\nbaz=qux'", logger)).resolves.toStrictEqual({
    foo: "bar",
    baz: "qux",
  })
  await expect(getHeaders("localhost", "printf 'foo=bar\\r\\n'", logger)).resolves.toStrictEqual({ foo: "bar" })
  await expect(getHeaders("localhost", "printf 'foo=bar'", logger)).resolves.toStrictEqual({ foo: "bar" })
  await expect(getHeaders("localhost", "printf 'foo=bar='", logger)).resolves.toStrictEqual({ foo: "bar=" })
  await expect(getHeaders("localhost", "printf 'foo=bar=baz'", logger)).resolves.toStrictEqual({ foo: "bar=baz" })
  await expect(getHeaders("localhost", "printf 'foo='", logger)).resolves.toStrictEqual({ foo: "" })
})

it("should error on malformed or empty lines", async () => {
  await expect(getHeaders("localhost", "printf 'foo=bar\\r\\n\\r\\n'", logger)).rejects.toMatch(/Malformed/)
  await expect(getHeaders("localhost", "printf '\\r\\nfoo=bar'", logger)).rejects.toMatch(/Malformed/)
  await expect(getHeaders("localhost", "printf '=foo'", logger)).rejects.toMatch(/Malformed/)
  await expect(getHeaders("localhost", "printf 'foo'", logger)).rejects.toMatch(/Malformed/)
  await expect(getHeaders("localhost", "printf '  =foo'", logger)).rejects.toMatch(/Malformed/)
  await expect(getHeaders("localhost", "printf 'foo  =bar'", logger)).rejects.toMatch(/Malformed/)
  await expect(getHeaders("localhost", "printf 'foo  foo=bar'", logger)).rejects.toMatch(/Malformed/)
  await expect(getHeaders("localhost", "printf ''", logger)).rejects.toMatch(/Malformed/)
})

it("should have access to environment variables", async () => {
  const coderUrl = "dev.coder.com"
  await expect(
    getHeaders(coderUrl, os.platform() === "win32" ? "printf url=%CODER_URL%" : "printf url=$CODER_URL", logger),
  ).resolves.toStrictEqual({ url: coderUrl })
})

it("should error on non-zero exit", async () => {
  await expect(getHeaders("localhost", "exit 10", logger)).rejects.toMatch(/exited unexpectedly with code 10/)
})
