import axios from "axios"
import * as fs from "fs/promises"
import https from "https"
import * as path from "path"
import { afterAll, beforeAll, it, expect, vi } from "vitest"
import { CertificateError, X509_ERR, X509_ERR_CODE } from "./error"

// Before each test we make a request to sanity check that we really get the
// error we are expecting, then we run it through CertificateError.

// TODO: These sanity checks need to be ran in an Electron environment to
// reflect real usage in VS Code.  We should either revert back to the standard
// extension testing framework which I believe runs in a headless VS Code
// instead of using vitest or at least run the tests through Electron running as
// Node (for now I do this manually by shimming Node).
const isElectron = process.versions.electron || process.env.ELECTRON_RUN_AS_NODE

// TODO: Remove the vscode mock once we revert the testing framework.
beforeAll(() => {
  vi.mock("vscode", () => {
    return {}
  })
})

const logger = {
  writeToCoderOutputChannel(message: string) {
    throw new Error(message)
  },
}

const disposers: (() => void)[] = []
afterAll(() => {
  disposers.forEach((d) => d())
})

async function startServer(certName: string): Promise<string> {
  const server = https.createServer(
    {
      key: await fs.readFile(path.join(__dirname, `../fixtures/tls/${certName}.key`)),
      cert: await fs.readFile(path.join(__dirname, `../fixtures/tls/${certName}.crt`)),
    },
    (req, res) => {
      if (req.url?.endsWith("/error")) {
        res.writeHead(500)
        res.end("error")
        return
      }
      res.writeHead(200)
      res.end("foobar")
    },
  )
  disposers.push(() => server.close())
  return new Promise<string>((resolve, reject) => {
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address) {
        throw new Error("Server has no address")
      }
      if (typeof address !== "string") {
        const host = address.family === "IPv6" ? `[${address.address}]` : address.address
        return resolve(`https://${host}:${address.port}`)
      }
      resolve(address)
    })
  })
}

// Both environments give the "unable to verify" error with partial chains.
it("detects partial chains", async () => {
  const address = await startServer("chain-leaf")
  const request = axios.get(address, {
    httpsAgent: new https.Agent({
      ca: await fs.readFile(path.join(__dirname, "../fixtures/tls/chain-leaf.crt")),
    }),
  })
  await expect(request).rejects.toHaveProperty("code", X509_ERR_CODE.UNABLE_TO_VERIFY_LEAF_SIGNATURE)
  try {
    await request
  } catch (error) {
    const wrapped = await CertificateError.maybeWrap(error, address, logger)
    expect(wrapped instanceof CertificateError).toBeTruthy()
    expect((wrapped as CertificateError).x509Err).toBe(X509_ERR.PARTIAL_CHAIN)
  }
})

it("can bypass partial chain", async () => {
  const address = await startServer("chain-leaf")
  const request = axios.get(address, {
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
  })
  await expect(request).resolves.toHaveProperty("data", "foobar")
})

// In Electron a self-issued certificate without the signing capability fails
// (again with the same "unable to verify" error) but in Node self-issued
// certificates are not required to have the signing capability.
it("detects self-signed certificates without signing capability", async () => {
  const address = await startServer("no-signing")
  const request = axios.get(address, {
    httpsAgent: new https.Agent({
      ca: await fs.readFile(path.join(__dirname, "../fixtures/tls/no-signing.crt")),
      servername: "localhost",
    }),
  })
  if (isElectron) {
    await expect(request).rejects.toHaveProperty("code", X509_ERR_CODE.UNABLE_TO_VERIFY_LEAF_SIGNATURE)
    try {
      await request
    } catch (error) {
      const wrapped = await CertificateError.maybeWrap(error, address, logger)
      expect(wrapped instanceof CertificateError).toBeTruthy()
      expect((wrapped as CertificateError).x509Err).toBe(X509_ERR.NON_SIGNING)
    }
  } else {
    await expect(request).resolves.toHaveProperty("data", "foobar")
  }
})

it("can bypass self-signed certificates without signing capability", async () => {
  const address = await startServer("no-signing")
  const request = axios.get(address, {
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
  })
  await expect(request).resolves.toHaveProperty("data", "foobar")
})

// Both environments give the same error code when a self-issued certificate is
// untrusted.
it("detects self-signed certificates", async () => {
  const address = await startServer("self-signed")
  const request = axios.get(address)
  await expect(request).rejects.toHaveProperty("code", X509_ERR_CODE.DEPTH_ZERO_SELF_SIGNED_CERT)
  try {
    await request
  } catch (error) {
    const wrapped = await CertificateError.maybeWrap(error, address, logger)
    expect(wrapped instanceof CertificateError).toBeTruthy()
    expect((wrapped as CertificateError).x509Err).toBe(X509_ERR.UNTRUSTED_LEAF)
  }
})

// Both environments have no problem if the self-issued certificate is trusted
// and has the signing capability.
it("is ok with trusted self-signed certificates", async () => {
  const address = await startServer("self-signed")
  const request = axios.get(address, {
    httpsAgent: new https.Agent({
      ca: await fs.readFile(path.join(__dirname, "../fixtures/tls/self-signed.crt")),
      servername: "localhost",
    }),
  })
  await expect(request).resolves.toHaveProperty("data", "foobar")
})

it("can bypass self-signed certificates", async () => {
  const address = await startServer("self-signed")
  const request = axios.get(address, {
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
  })
  await expect(request).resolves.toHaveProperty("data", "foobar")
})

// Both environments give the same error code when the chain is complete but the
// root is not trusted.
it("detects an untrusted chain", async () => {
  const address = await startServer("chain")
  const request = axios.get(address)
  await expect(request).rejects.toHaveProperty("code", X509_ERR_CODE.SELF_SIGNED_CERT_IN_CHAIN)
  try {
    await request
  } catch (error) {
    const wrapped = await CertificateError.maybeWrap(error, address, logger)
    expect(wrapped instanceof CertificateError).toBeTruthy()
    expect((wrapped as CertificateError).x509Err).toBe(X509_ERR.UNTRUSTED_CHAIN)
  }
})

// Both environments have no problem if the chain is complete and the root is
// trusted.
it("is ok with chains with a trusted root", async () => {
  const address = await startServer("chain")
  const request = axios.get(address, {
    httpsAgent: new https.Agent({
      ca: await fs.readFile(path.join(__dirname, "../fixtures/tls/chain-root.crt")),
      servername: "localhost",
    }),
  })
  await expect(request).resolves.toHaveProperty("data", "foobar")
})

it("can bypass chain", async () => {
  const address = await startServer("chain")
  const request = axios.get(address, {
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
  })
  await expect(request).resolves.toHaveProperty("data", "foobar")
})

it("falls back with different error", async () => {
  const address = await startServer("chain")
  const request = axios.get(address + "/error", {
    httpsAgent: new https.Agent({
      ca: await fs.readFile(path.join(__dirname, "../fixtures/tls/chain-root.crt")),
      servername: "localhost",
    }),
  })
  await expect(request).rejects.toMatch(/failed with status code 500/)
  try {
    await request
  } catch (error) {
    const wrapped = await CertificateError.maybeWrap(error, "1", logger)
    expect(wrapped instanceof CertificateError).toBeFalsy()
    expect((wrapped as Error).message).toMatch(/failed with status code 500/)
  }
})
