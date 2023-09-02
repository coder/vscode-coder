//@ts-check

"use strict"

const path = require("path")

/**@type {import('webpack').Configuration}*/
const nodeConfig = {
  target: "node", // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
  mode: "none", // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: "./src/extension.ts", // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  devtool: "nosources-source-map",
  externals: {
    vscode: "commonjs vscode", // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: [".ts", ".js"],
    // the Coder dependency uses absolute paths
    modules: ["./node_modules", "./node_modules/coder/site/src"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules\/(?!(coder).*)/,
        use: [
          {
            loader: "ts-loader",
            options: {
              allowTsInNodeModules: true,
            },
          },
        ],
      },
      {
        test: /\.(sh|ps1)$/,
        type: "asset/source",
      },
    ],
  },
}
const webConfig = {
  target: "webworker", // web extensions run in a webworker context
  mode: "none", // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: "./src/extension.ts", // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  devtool: "nosources-source-map",
  externals: {
    vscode: "commonjs vscode", // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: [".ts", ".js"],
    // the Coder dependency uses absolute paths
    modules: ["./node_modules", "./node_modules/coder/site/src", "browser"],
    fallback: {
      "https": require.resolve("https-browserify"),
      "http": require.resolve("stream-http"),
      "util": require.resolve("util/"),
      "os": require.resolve("os-browserify/browser"),
      "path": require.resolve("path-browserify"),
      "url": require.resolve("url/"),
      "fs": false, // fs cannot be polyfilled, if it's essential, change your webpack target
      "child_process": false, // child_process can't be polyfilled
      "assert": require.resolve("assert/"),
      "stream": require.resolve("stream-browserify"),
      "constants": require.resolve("constants-browserify"),
      "crypto": require.resolve("crypto-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "tls": false,
      "net": false,
      "module": false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules\/(?!(coder).*)/,
        use: [
          {
            loader: "ts-loader",
            options: {
              allowTsInNodeModules: true,
            },
          },
        ],
      },
      {
        test: /\.(sh|ps1)$/,
        type: "asset/source",
      },
    ],
  },
}
module.exports = [nodeConfig, webConfig]
