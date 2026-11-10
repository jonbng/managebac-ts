import { ConfigurationError } from "../errors.js";

export function normalizeDomain(domain: string, allowInsecure = false): string {
  if (typeof domain !== "string" || domain.trim() === "") {
    throw new ConfigurationError("domain must be a non-empty URL or hostname.");
  }
  const input = /^https?:\/\//i.test(domain.trim()) ? domain.trim() : `https://${domain.trim()}`;
  let url: URL;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new ConfigurationError("domain is not a valid URL or hostname.", { cause });
  }
  if (url.username || url.password) throw new ConfigurationError("domain must not contain credentials.");
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) {
    throw new ConfigurationError("domain must use HTTPS.");
  }
  return url.origin;
}

export function assertSameOrigin(baseUrl: string, path: string | URL): URL {
  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl) {
    throw new ConfigurationError("Requests must stay on the configured ManageBac domain.");
  }
  return url;
}
