/**
 * SSRF (Server-Side Request Forgery) protection utilities.
 *
 * Provides IP normalization and private IP detection to prevent requests
 * to internal/private networks via various IP encoding techniques.
 *
 * @module
 */

import { isIP } from "node:net";

// ─── Internal Helpers ─────────────────────────────────────────────────────────

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
    const num = part.startsWith("0") && part.length > 1 ? parseInt(part, 8) : parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    octets.push(num);
  }
  return octets.join(".");
}

function expandIPv6(ip: string): string {
  const halves = ip.split("::");
  let groups: string[];

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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize an IP address from any encoding to a canonical form.
 *
 * Handles IPv4, IPv6, hex (`0x7f000001`), decimal (`2130706433`), octal
 * (`0177.0.0.01`), IPv6-mapped IPv4, IPv4-compatible IPv6, and NAT64.
 *
 * @param hostname - The raw hostname or IP string (may include brackets).
 * @returns The normalized IPv4 or expanded IPv6 string, or `null` if not an IP.
 */
export function normalizeIP(hostname: string): string | null {
  // Strip brackets and IPv6 zone IDs (%eth0, %en0, %12) — zone IDs cause
  // isIP() to return 0, which would bypass IP recognition entirely.
  const bare = hostname.replace(/^\[|\]$/g, "").replace(/%.*$/, "");

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

/**
 * Check whether an IP address belongs to a private or reserved range.
 *
 * Covers RFC 1918, loopback, link-local, CGNAT, test networks,
 * IPv6 ULA, IPv6 link-local, multicast, 6to4, Teredo, and more.
 *
 * @param ip - A normalized IPv4 or expanded IPv6 address.
 * @returns `true` if the IP is private/reserved and should be blocked.
 */
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

  // Multicast (224-239) and Class E reserved (240-255) — covers the full range
  const firstOctet = parseInt(ip.split(".")[0], 10);
  if (firstOctet >= 224) return true;

  const expanded = ip.includes("::") ? expandIPv6(ip) : ip.toLowerCase();

  if (
    ip === "::1" ||
    ip === "::" ||
    expanded === "0:0:0:0:0:0:0:1" ||
    expanded === "0:0:0:0:0:0:0:0"
  )
    return true;
  if (expanded.startsWith("fc") || expanded.startsWith("fd")) return true;
  if (
    expanded.startsWith("fe80:") ||
    expanded.startsWith("fe8") ||
    expanded.startsWith("fe9") ||
    expanded.startsWith("fea") ||
    expanded.startsWith("feb")
  )
    return true;
  if (
    expanded.startsWith("fec0:") ||
    expanded.startsWith("fec") ||
    expanded.startsWith("fed") ||
    expanded.startsWith("fee") ||
    expanded.startsWith("fef")
  )
    return true;
  if (expanded.startsWith("ff")) return true;
  if (expanded.startsWith("64:ff9b:")) return true;
  if (expanded.startsWith("2002:")) return true;
  if (expanded.startsWith("2001:db8:")) return true;
  if (expanded.startsWith("2001:0:")) return true;

  return false;
}
