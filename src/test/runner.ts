import * as glob from "glob"
import * as Mocha from "mocha"
import * as path from "path"
import * as util from "util"

export async function run(): Promise<void> {
  const testsRoot = path.resolve(__dirname, "../../out")

  // TODO: There do not appear to be any types for nyc.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nyc = new (require("nyc"))({
    cwd: path.resolve(__dirname, "../.."),
    exclude: ["**/test/**", ".vscode-test/**", "**/*.test.js"],
    reporter: ["text", "html"],
    all: true,
    checkCoverage: true,
    instrument: true,
    hookRequire: true,
    hookRunInContext: true,
    hookRunInThisContext: true,
  })

  await nyc.reset()
  await nyc.wrap()

  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  })

  const files = await util.promisify(glob)("**/*.test.js", { cwd: testsRoot })
  files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)))

  try {
    await new Promise<void>((c, e) => {
      mocha.run((failures) => {
        if (failures > 0) {
          e(new Error(`${failures} tests failed.`))
        } else {
          c()
        }
      })
    })
  } finally {
    await nyc.writeCoverageFile()
    await nyc.report()
  }
}
