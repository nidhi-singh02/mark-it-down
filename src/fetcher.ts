import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { FetchResult } from "./types.js";
import { normalizeIP, isPrivateIP } from "./ssrf.js";
import {
  ValidationError,
  SSRFError,
  NetworkError,
  ContentError,
} from "./errors.js";

// Re-export SSRF utilities so existing consumers keep working
export { normalizeIP, isPrivateIP } from "./ssrf.js";

/** Maximum response body size: 10 MB */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/** Maximum number of HTTP redirects to follow */
const MAX_REDIRECTS = 5;

/** Maximum timeout: 5 minutes */
const MAX_TIMEOUT = 300_000;

/** Minimum timeout: 1 second */
const MIN_TIMEOUT = 1_000;

const BLOCKED_HOSTNAMES: ReadonlySet<string> = Object.freeze(new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]));

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".corp",
  ".home",
  ".lan",
] as const;

export function clampTimeout(timeout: number): number {
  if (!Number.isFinite(timeout) || timeout < MIN_TIMEOUT) return MIN_TIMEOUT;
  if (timeout > MAX_TIMEOUT) return MAX_TIMEOUT;
  return Math.floor(timeout);
}

async function resolveAndValidateHostname(hostname: string): Promise<string> {
  const normalizedIP = normalizeIP(hostname);
  if (normalizedIP !== null) {
    if (isPrivateIP(normalizedIP)) {
      throw new SSRFError(
        `Blocked request to private/internal IP address: ${hostname}. ` +
          "Requests to internal networks are not allowed."
      );
    }
    return normalizedIP;
  }

  try {
    const { address } = await lookup(hostname);
    if (isPrivateIP(address)) {
      throw new SSRFError(
        `Blocked request to "${hostname}" — resolves to private IP. ` +
          "Requests to internal networks are not allowed."
      );
    }
    return address;
  } catch (err: unknown) {
    if (err instanceof SSRFError) throw err;
    if (err instanceof Error) {
      throw new NetworkError(
        `DNS lookup failed for "${hostname}": ${err.message.includes("ENOTFOUND") ? "hostname not found" : "resolution error"}. ` +
          "Check the URL.",
        undefined,
        { cause: err }
      );
    }
    throw new NetworkError(`DNS lookup failed for "${hostname}". Check the URL.`);
  }
}

/**
 * Validate a URL for safety and resolve its hostname to an IP.
 *
 * Checks protocol, hostname blocklists, and private IP ranges.
 * Performs a single DNS lookup and returns the resolved IP for
 * pinned connections that prevent DNS rebinding.
 *
 * @param url - The URL string to validate.
 * @returns The resolved IP address to pin connections to.
 * @throws {ValidationError} If the URL is malformed or uses an unsupported protocol.
 * @throws {SSRFError} If the hostname or resolved IP is private/internal.
 * @throws {NetworkError} If DNS resolution fails.
 */
export async function validateUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(
      "Invalid URL. Please provide a valid HTTP or HTTPS URL."
    );
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ValidationError(
      `Unsupported protocol "${parsed.protocol}". Only HTTP and HTTPS are supported.`
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SSRFError(
      `Blocked request to "${hostname}". Requests to internal hosts are not allowed.`
    );
  }

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      throw new SSRFError(
        `Blocked request to "${hostname}". Requests to internal hosts are not allowed.`
      );
    }
  }

  return resolveAndValidateHostname(hostname);
}

// ─── Content-Type Validation ─────────────────────────────────────────────────

const HTML_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
] as const;

function validateContentType(headers: Record<string, string | string[] | undefined>): void {
  const raw = headers["content-type"];
  const contentType = (typeof raw === "string" ? raw : "").toLowerCase();

  if (!contentType) return;

  const isHtmlLike = HTML_CONTENT_TYPES.some((ct) => contentType.includes(ct));
  if (!isHtmlLike) {
    throw new ContentError(
      `Unexpected Content-Type "${contentType.split(";")[0].trim()}" for the response. ` +
        "Expected an HTML document."
    );
  }
}

// ─── HTTP Fetcher (with DNS pinning) ─────────────────────────────────────────

/**
 * Create a pinned DNS lookup function that always returns the pre-resolved IP.
 * This prevents DNS rebinding: the TCP connection is forced to the validated IP
 * while TLS SNI and certificate validation use the original hostname.
 *
 * Handles both callback signatures:
 * - all:false (default on Node <20): callback(null, address, family)
 * - all:true  (Node 20+ autoSelectFamily): callback(null, [{address, family}])
 */
function createPinnedLookup(resolvedIP: string): LookupFunction {
  const family = resolvedIP.includes(":") ? 6 : 4;
  return ((
    _hostname: string,
    options: unknown,
    callback?: (...args: unknown[]) => void
  ) => {
    // Node's lookup can be called with 2 or 3 args; normalize
    const cb = (typeof options === "function" ? options : callback) as (...args: unknown[]) => void;
    const opts = (typeof options === "object" && options !== null) ? options as { all?: boolean } : {};
    if (opts.all) {
      cb(null, [{ address: resolvedIP, family }]);
    } else {
      cb(null, resolvedIP, family);
    }
  }) as LookupFunction;
}

/**
 * Perform an HTTP/HTTPS request using Node's native http/https modules
 * with a pinned DNS lookup to prevent DNS rebinding.
 * Returns the response status, headers, and body.
 */
interface PinnedResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** Response body as UTF-8 string (for HTML processing). */
  body: string;
  /** Response body as raw Buffer (for binary-safe forwarding). */
  bodyBuffer: Buffer;
  responseUrl: string;
}

function pinnedRequest(
  url: string,
  resolvedIP: string,
  timeout: number
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;

    const req = requestFn(
      url,
      {
        method: "GET",
        timeout,
        lookup: createPinnedLookup(resolvedIP),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; web-to-markdown/0.1; +https://github.com/nidhi-singh02/mark-it-down)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_RESPONSE_SIZE) {
            req.destroy();
            reject(
              new ContentError(
                `Response too large: exceeded ${(MAX_RESPONSE_SIZE / 1024 / 1024).toFixed(0)} MB limit.`
              )
            );
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          const bodyBuffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: bodyBuffer.toString("utf-8"),
            bodyBuffer,
            responseUrl: url,
          });
        });

        res.on("error", reject);
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new NetworkError("Request timed out."));
    });

    req.on("error", (err: Error) => {
      reject(new NetworkError(`Request failed: ${err.message}`, undefined, { cause: err }));
    });

    req.end();
  });
}

/**
 * Fetch a URL using Node's native http/https modules with DNS pinning.
 * Follows redirects manually with per-hop SSRF validation and hop limit.
 * The pinned lookup ensures TLS SNI uses the original hostname for cert validation,
 * while the TCP connection goes to the validated IP — preventing DNS rebinding.
 */
export async function fetchWithHttp(
  url: string,
  resolvedIP: string,
  timeout: number,
  remainingRedirects: number = MAX_REDIRECTS
): Promise<FetchResult> {
  const safTimeout = clampTimeout(timeout);

  const response = await pinnedRequest(url, resolvedIP, safTimeout);

  // Handle redirects manually to validate each hop
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (remainingRedirects <= 0) {
      throw new NetworkError(
        `Too many redirects (exceeded ${MAX_REDIRECTS}). The URL may be in a redirect loop.`
      );
    }
    const location = response.headers["location"];
    const locationStr = typeof location === "string" ? location : undefined;
    if (!locationStr) {
      throw new NetworkError(`Redirect ${response.status} with no Location header.`);
    }
    const redirectUrl = new URL(locationStr, url).toString();
    const redirectIP = await validateUrl(redirectUrl);
    return fetchWithHttp(
      redirectUrl,
      redirectIP,
      safTimeout,
      remainingRedirects - 1
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new NetworkError(`HTTP ${response.status} for the requested URL.`, response.status);
  }

  validateContentType(response.headers);

  return { html: response.body, finalUrl: url };
}

// ─── Playwright / Browser Fetcher ────────────────────────────────────────────

/**
 * Fetch a URL using Playwright headless browser (for SPAs).
 * Playwright is dynamically imported so it's only loaded when needed.
 * All HTTP requests are validated for SSRF via route interception.
 * WebSocket connections are disabled at the Chromium level.
 * DNS is pinned for the initial hostname via --host-resolver-rules.
 */
export async function fetchWithBrowser(
  url: string,
  resolvedIP: string,
  timeout: number
): Promise<FetchResult> {
  const safTimeout = clampTimeout(timeout);

  // Playwright is optional — define minimal structural types for the APIs we use
  type PwRoute = { request(): { url(): string }; fulfill(opts: Record<string, unknown>): Promise<void>; abort(reason: string): Promise<void> };
  type PwPage = { goto(url: string, opts: Record<string, unknown>): Promise<void>; waitForTimeout(ms: number): Promise<void>; content(): Promise<string>; url(): string };
  type PwContext = { newPage(): Promise<PwPage>; route(pattern: string, handler: (route: PwRoute) => Promise<void>): Promise<void> };
  type PwBrowser = { newContext(opts: Record<string, unknown>): Promise<PwContext>; close(): Promise<void> };
  type PwModule = { chromium: { launch(opts: Record<string, unknown>): Promise<PwBrowser> } };

  let playwright: PwModule;

  try {
    const mod = "playwright";
    playwright = await import(/* @vite-ignore */ mod) as PwModule;
  } catch {
    throw new NetworkError(
      [
        "Playwright is required for browser mode but is not installed.",
        "",
        "Install it with:",
        "  npm install playwright",
        "  npx playwright install chromium",
        "",
        "Playwright is an optional dependency (~100MB) needed only for",
        "JavaScript-rendered pages (SPAs).",
      ].join("\n")
    );
  }

  // Pin DNS for the initial hostname and disable WebSockets at the Chromium level
  const parsed = new URL(url);
  const hostResolverRule = `MAP ${parsed.hostname} ${resolvedIP}`;

  const browser = await playwright.chromium.launch({
    headless: true,
    args: [
      "--disable-websockets",
      `--host-resolver-rules=${hostResolverRule}`,
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // Intercept all sub-resource requests and fetch them via our pinned HTTP
    // client to prevent DNS rebinding on sub-resource hostnames. The initial
    // page load is pinned via --host-resolver-rules, but sub-resources to
    // different hostnames need per-request DNS pinning.
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      try {
        const subIP = await validateUrl(requestUrl);
        // Fetch the resource ourselves with DNS pinning, then fulfill
        // the Playwright request with our response. This prevents Chromium
        // from doing a second (potentially rebinding) DNS resolution.
        const subResponse = await pinnedRequest(requestUrl, subIP, safTimeout);
        await route.fulfill({
          status: subResponse.status,
          headers: subResponse.headers,
          body: subResponse.bodyBuffer,
        });
      } catch {
        await route.abort("blockedbyclient");
      }
    });

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: safTimeout,
    });

    // Extra wait for late JS rendering
    await page.waitForTimeout(1000);

    const html = await page.content();

    if (Buffer.byteLength(html, "utf-8") > MAX_RESPONSE_SIZE) {
      throw new ContentError(
        `Page content too large: exceeded ${(MAX_RESPONSE_SIZE / 1024 / 1024).toFixed(0)} MB limit.`
      );
    }

    return { html, finalUrl: page.url() };
  } finally {
    await browser.close();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch a page using either HTTP or headless browser.
 *
 * Validates the URL for SSRF and resolves DNS once.
 * The resolved IP is pinned to the connection to prevent DNS rebinding.
 *
 * @param url - The URL to fetch.
 * @param options - Fetch options.
 * @param options.browser - If `true`, use Playwright headless browser for SPAs.
 * @param options.timeout - Request timeout in milliseconds (clamped to 1–300 s).
 * @returns The raw HTML and final URL after redirects.
 * @throws {ValidationError} If the URL is invalid.
 * @throws {SSRFError} If the URL targets a private/internal host.
 * @throws {NetworkError} On timeout, DNS failure, or HTTP error.
 * @throws {ContentError} If the response is too large or not HTML.
 */
export async function fetchPage(
  url: string,
  options: Readonly<{ browser: boolean; timeout: number }>
): Promise<FetchResult> {
  const safTimeout = clampTimeout(options.timeout);

  // Validate and resolve DNS once — returns the IP to pin connections to
  const resolvedIP = await validateUrl(url);

  if (options.browser) {
    return fetchWithBrowser(url, resolvedIP, safTimeout);
  }

  return fetchWithHttp(url, resolvedIP, safTimeout);
}
