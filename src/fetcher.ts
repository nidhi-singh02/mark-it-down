import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { FetchResult } from "./types.js";

/** Maximum response body size: 10 MB */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/** Maximum number of HTTP redirects to follow */
const MAX_REDIRECTS = 5;

/** Maximum timeout: 5 minutes */
const MAX_TIMEOUT = 300_000;

/** Minimum timeout: 1 second */
const MIN_TIMEOUT = 1_000;

// ─── IP Normalization & SSRF Protection ──────────────────────────────────────

function decimalToIPv4(decimal: number): string | null {
  if (!Number.isInteger(decimal) || decimal < 0 || decimal > 0xffffffff) {
    return null;
  }
  return [
    (decimal >>> 24) & 0xff,
    (decimal >>> 16) & 0xff,
    (decimal >>> 8) & 0xff,
    decimal & 0xff,
  ].join(".");
}

function parseOctalIPv4(hostname: string): string | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    const num = part.startsWith("0") && part.length > 1
      ? parseInt(part, 8)
      : parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    octets.push(num);
  }
  return octets.join(".");
}

function expandIPv6(ip: string): string {
  const halves = ip.split("::");
  let groups: string[] = [];

  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    groups = ip.split(":");
  }

  return groups.map((g) => g.toLowerCase()).join(":");
}

/** @internal Exported for testing — will move to ssrf.ts */
export function normalizeIP(hostname: string): string | null {
  const bare = hostname.replace(/^\[|\]$/g, "");

  if (isIP(bare) === 4) return bare;

  if (isIP(bare) === 6) {
    const ffmpDotted = bare.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (ffmpDotted) return ffmpDotted[1];

    const ffmpHex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (ffmpHex) {
      const high = parseInt(ffmpHex[1], 16);
      const low = parseInt(ffmpHex[2], 16);
      return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    }

    const fullFfmpHex = expandIPv6(bare);
    const fullFfmpMatch = fullFfmpHex.match(/^0:0:0:0:0:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (fullFfmpMatch) {
      const high = parseInt(fullFfmpMatch[1], 16);
      const low = parseInt(fullFfmpMatch[2], 16);
      return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    }

    const compatDotted = bare.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (compatDotted) return compatDotted[1];
    const compatHex = bare.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (compatHex) {
      const high = parseInt(compatHex[1], 16);
      const low = parseInt(compatHex[2], 16);
      return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    }

    const nat64Dotted = bare.match(/^64:ff9b::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (nat64Dotted) return nat64Dotted[1];
    const nat64Hex = bare.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (nat64Hex) {
      const high = parseInt(nat64Hex[1], 16);
      const low = parseInt(nat64Hex[2], 16);
      return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    }

    return expandIPv6(bare);
  }

  if (/^0x[0-9a-f]+$/i.test(bare)) {
    const decimal = parseInt(bare, 16);
    return decimalToIPv4(decimal);
  }

  if (/^\d+$/.test(bare) && !bare.includes(".")) {
    const decimal = parseInt(bare, 10);
    return decimalToIPv4(decimal);
  }

  if (/^[\d.]+$/.test(bare) && bare.split(".").length === 4) {
    const hasOctal = bare.split(".").some((p) => p.startsWith("0") && p.length > 1);
    if (hasOctal) {
      return parseOctalIPv4(bare);
    }
  }

  return null;
}

/** @internal Exported for testing — will move to ssrf.ts */
export function isPrivateIP(ip: string): boolean {
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("0.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;

  const cgnatMatch = ip.match(/^100\.(\d+)\./);
  if (cgnatMatch) {
    const secondOctet = parseInt(cgnatMatch[1], 10);
    if (secondOctet >= 64 && secondOctet <= 127) return true;
  }

  if (ip.startsWith("192.0.0.")) return true;
  if (ip.startsWith("192.0.2.")) return true;
  if (ip.startsWith("198.51.100.")) return true;
  if (ip.startsWith("203.0.113.")) return true;
  if (/^198\.(18|19)\./.test(ip)) return true;
  if (/^24[0-9]\./.test(ip) || ip.startsWith("255.")) return true;

  const expanded = ip.includes("::") ? expandIPv6(ip) : ip.toLowerCase();

  if (ip === "::1" || ip === "::" || expanded === "0:0:0:0:0:0:0:1" || expanded === "0:0:0:0:0:0:0:0") return true;
  if (expanded.startsWith("fc") || expanded.startsWith("fd")) return true;
  if (expanded.startsWith("fe80:") || expanded.startsWith("fe8") || expanded.startsWith("fe9") || expanded.startsWith("fea") || expanded.startsWith("feb")) return true;
  if (expanded.startsWith("fec0:") || expanded.startsWith("fec") || expanded.startsWith("fed") || expanded.startsWith("fee") || expanded.startsWith("fef")) return true;
  if (expanded.startsWith("ff")) return true;
  if (expanded.startsWith("64:ff9b:")) return true;
  if (expanded.startsWith("2002:")) return true;
  if (expanded.startsWith("2001:db8:")) return true;
  if (expanded.startsWith("2001:0:")) return true;

  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".corp",
  ".home",
  ".lan",
];

export function clampTimeout(timeout: number): number {
  if (!Number.isFinite(timeout) || timeout < MIN_TIMEOUT) return MIN_TIMEOUT;
  if (timeout > MAX_TIMEOUT) return MAX_TIMEOUT;
  return Math.floor(timeout);
}

async function resolveAndValidateHostname(hostname: string): Promise<string> {
  const normalizedIP = normalizeIP(hostname);
  if (normalizedIP !== null) {
    if (isPrivateIP(normalizedIP)) {
      throw new Error(
        `Blocked request to private/internal IP address: ${hostname}. ` +
          "Requests to internal networks are not allowed."
      );
    }
    return normalizedIP;
  }

  try {
    const { address } = await lookup(hostname);
    if (isPrivateIP(address)) {
      throw new Error(
        `Blocked request to "${hostname}" — resolves to private IP. ` +
          "Requests to internal networks are not allowed."
      );
    }
    return address;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Blocked")) throw err;
    if (err instanceof Error) {
      throw new Error(
        `DNS lookup failed for "${hostname}": ${err.message.includes("ENOTFOUND") ? "hostname not found" : "resolution error"}. ` +
          "Check the URL."
      );
    }
    throw new Error(`DNS lookup failed for "${hostname}". Check the URL.`);
  }
}

export async function validateUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "Invalid URL. Please provide a valid HTTP or HTTPS URL."
    );
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `Unsupported protocol "${parsed.protocol}". Only HTTP and HTTPS are supported.`
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Blocked request to "${hostname}". Requests to internal hosts are not allowed.`
    );
  }

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      throw new Error(
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
];

function validateContentType(headers: Record<string, string | string[] | undefined>): void {
  const raw = headers["content-type"];
  const contentType = (typeof raw === "string" ? raw : "").toLowerCase();

  if (!contentType) return;

  const isHtmlLike = HTML_CONTENT_TYPES.some((ct) => contentType.includes(ct));
  if (!isHtmlLike) {
    throw new Error(
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
function createPinnedLookup(resolvedIP: string) {
  const family = resolvedIP.includes(":") ? 6 : 4;
  return (
    _hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: Function
  ) => {
    // options can be {all: true} (object), a family number, or undefined
    const opts = (typeof options === "object" && options !== null) ? options : {};
    if (opts.all) {
      callback(null, [{ address: resolvedIP, family }]);
    } else {
      callback(null, resolvedIP, family);
    }
  };
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
        lookup: createPinnedLookup(resolvedIP) as any,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; markitdown/0.1; +https://github.com/user/markitdown)",
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
              new Error(
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
      reject(new Error("Request timed out."));
    });

    req.on("error", (err: Error) => {
      reject(new Error(`Request failed: ${err.message}`));
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
      throw new Error(
        `Too many redirects (exceeded ${MAX_REDIRECTS}). The URL may be in a redirect loop.`
      );
    }
    const location = response.headers["location"];
    const locationStr = typeof location === "string" ? location : undefined;
    if (!locationStr) {
      throw new Error(`Redirect ${response.status} with no Location header.`);
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
    throw new Error(`HTTP ${response.status} for the requested URL.`);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let playwright: any;

  try {
    const mod = "playwright";
    playwright = await import(/* @vite-ignore */ mod);
  } catch {
    throw new Error(
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
    await context.route("**/*", async (route: any) => {
      const requestUrl = route.request().url();
      try {
        const subIP = await validateUrl(requestUrl);
        // Fetch the resource ourselves with DNS pinning, then fulfill
        // the Playwright request with our response. This prevents Chromium
        // from doing a second (potentially rebinding) DNS resolution.
        const subResponse = await pinnedRequest(requestUrl, subIP, safTimeout);
        await route.fulfill({
          status: subResponse.status,
          headers: subResponse.headers as Record<string, string>,
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
      throw new Error(
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
 * Validates the URL for SSRF and resolves DNS once.
 * The resolved IP is pinned to the connection to prevent DNS rebinding.
 */
export async function fetchPage(
  url: string,
  options: { browser: boolean; timeout: number }
): Promise<FetchResult> {
  const safTimeout = clampTimeout(options.timeout);

  // Validate and resolve DNS once — returns the IP to pin connections to
  const resolvedIP = await validateUrl(url);

  if (options.browser) {
    return fetchWithBrowser(url, resolvedIP, safTimeout);
  }

  return fetchWithHttp(url, resolvedIP, safTimeout);
}
