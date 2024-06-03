import url from "url"

/**
 * Given a URL, return the host in a format that is safe to write.
 */
export function toSafeHost(rawUrl: string): string {
  const u = new URL(rawUrl)
  // If the host is invalid, an empty string is returned.  Although, `new URL`
  // should already have thrown in that case.
  return url.domainToASCII(u.hostname) || u.hostname
}
