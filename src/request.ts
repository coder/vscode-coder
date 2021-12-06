import * as http from "http"
import * as https from "https"
import * as url from "url"

/**
 * Make a request and return that request.
 *
 * Use this when you want to stream the results.
 */
export const requestResponse = (uri: string): Promise<http.IncomingMessage> => {
  let redirects = 0
  const maxRedirects = 10
  return new Promise((resolve, reject) => {
    const request = (uri: string): void => {
      const httpx = uri.startsWith("https") ? https : http
      const client = httpx.get(uri, { headers: { "User-Agent": "coder" } }, (response) => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 400) {
          response.destroy()
          return reject(new Error(`${uri}: ${response.statusCode || "500"}`))
        }

        if (response.statusCode >= 300) {
          response.destroy()
          ++redirects
          if (redirects > maxRedirects) {
            return reject(new Error("reached max redirects"))
          }
          if (!response.headers.location) {
            return reject(new Error("received redirect with no location header"))
          }
          return request(url.resolve(uri, response.headers.location))
        }

        resolve(response)
      })
      client.on("error", reject)
    }
    request(uri)
  })
}

/**
 * Make a request, read the response, and return that result.
 *
 * Use this when you need the full response before you can act on it.
 */
export const request = async (uri: string): Promise<Buffer> => {
  const response = await requestResponse(uri)
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bufferLength = 0
    response.on("data", (chunk) => {
      bufferLength += chunk.length
      chunks.push(chunk)
    })
    response.on("error", reject)
    response.on("end", () => {
      resolve(Buffer.concat(chunks, bufferLength))
    })
  })
}
