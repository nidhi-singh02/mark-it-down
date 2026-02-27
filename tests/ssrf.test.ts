import { describe, it, expect } from "vitest";
import { normalizeIP, isPrivateIP } from "../src/ssrf.js";
import { validateUrl, clampTimeout } from "../src/fetcher.js";

// ─── normalizeIP ─────────────────────────────────────────────────────────────

describe("normalizeIP", () => {
  it("returns standard IPv4 as-is", () => {
    expect(normalizeIP("1.2.3.4")).toBe("1.2.3.4");
  });

  it("converts hex IP to dotted decimal", () => {
    expect(normalizeIP("0x7f000001")).toBe("127.0.0.1");
  });

  it("converts decimal IP to dotted decimal", () => {
    expect(normalizeIP("2130706433")).toBe("127.0.0.1");
  });

  it("converts octal IP to dotted decimal", () => {
    expect(normalizeIP("0177.0.0.01")).toBe("127.0.0.1");
  });

  it("strips brackets from IPv6", () => {
    expect(normalizeIP("[::1]")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
  });

  it("expands abbreviated IPv6 with zero-padded groups", () => {
    expect(normalizeIP("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
  });

  it("converts IPv6-mapped IPv4 (dotted) to IPv4", () => {
    expect(normalizeIP("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });

  it("converts IPv6-mapped IPv4 (hex) to IPv4", () => {
    expect(normalizeIP("::ffff:7f00:0001")).toBe("127.0.0.1");
  });

  it("converts IPv4-compatible address to IPv4", () => {
    expect(normalizeIP("::127.0.0.1")).toBe("127.0.0.1");
  });

  it("converts NAT64 (dotted) to IPv4", () => {
    expect(normalizeIP("64:ff9b::10.0.0.1")).toBe("10.0.0.1");
  });

  it("converts NAT64 (hex) to IPv4", () => {
    expect(normalizeIP("64:ff9b::0a00:0001")).toBe("10.0.0.1");
  });

  it("strips IPv6 zone IDs before normalization", () => {
    // Linux-style zone ID
    expect(normalizeIP("fe80::1%eth0")).toBe("fe80:0000:0000:0000:0000:0000:0000:0001");
    // macOS-style zone ID
    expect(normalizeIP("[fe80::1%en0]")).toBe("fe80:0000:0000:0000:0000:0000:0000:0001");
    // Windows-style numeric zone ID
    expect(normalizeIP("fe80::1%12")).toBe("fe80:0000:0000:0000:0000:0000:0000:0001");
  });

  it("returns null for non-IP hostnames", () => {
    expect(normalizeIP("example.com")).toBeNull();
    expect(normalizeIP("localhost")).toBeNull();
  });

  it("returns null for out-of-range decimal", () => {
    expect(normalizeIP("4294967296")).toBeNull(); // 0xFFFFFFFF + 1
  });
});

// ─── isPrivateIP ─────────────────────────────────────────────────────────────

describe("isPrivateIP", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.255", "loopback range"],
    ["10.0.0.1", "class A private"],
    ["10.255.255.255", "class A private end"],
    ["172.16.0.1", "class B private start"],
    ["172.31.255.255", "class B private end"],
    ["192.168.0.1", "class C private"],
    ["192.168.255.255", "class C private end"],
    ["169.254.1.1", "link-local"],
    ["0.0.0.0", "unspecified"],
    ["100.64.0.1", "CGNAT start"],
    ["100.127.255.255", "CGNAT end"],
    ["192.0.0.1", "IETF protocol"],
    ["192.0.2.1", "TEST-NET-1"],
    ["198.51.100.1", "TEST-NET-2"],
    ["203.0.113.1", "TEST-NET-3"],
    ["198.18.0.1", "benchmarking"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast end"],
    ["240.0.0.1", "reserved class E"],
    ["250.0.0.1", "reserved class E mid-range"],
    ["254.0.0.1", "reserved class E near-end"],
    ["255.255.255.255", "broadcast"],
  ])("returns true for %s (%s)", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each([
    ["8.8.8.8", "Google DNS"],
    ["1.1.1.1", "Cloudflare DNS"],
    ["93.184.216.34", "example.com"],
    ["172.15.255.255", "just below class B private"],
    ["172.32.0.0", "just above class B private"],
    ["100.63.255.255", "just below CGNAT"],
    ["100.128.0.0", "just above CGNAT"],
  ])("returns false for %s (%s)", (ip) => {
    expect(isPrivateIP(ip)).toBe(false);
  });

  it("detects IPv6 loopback", () => {
    expect(isPrivateIP("::1")).toBe(true);
  });

  it("detects IPv6 unspecified", () => {
    expect(isPrivateIP("::")).toBe(true);
  });

  it("detects IPv6 ULA (fc00::/7)", () => {
    expect(isPrivateIP("fc00::1")).toBe(true);
    expect(isPrivateIP("fd12:3456::1")).toBe(true);
  });

  it("does not false-positive on unallocated ranges resembling ULA/multicast", () => {
    // 00fc::1 is NOT in fc00::/7 — the first group 00fc != fc00
    // These are currently unallocated but should not be blocked as private
    expect(isPrivateIP("0000:0000:0000:0000:0000:0000:0000:00fc")).toBe(false);
  });

  it("detects IPv6 link-local (fe80::/10)", () => {
    expect(isPrivateIP("fe80::1")).toBe(true);
  });

  it("detects IPv6 multicast (ff00::/8)", () => {
    expect(isPrivateIP("ff02::1")).toBe(true);
  });

  it("detects 6to4 (2002::/16)", () => {
    expect(isPrivateIP("2002::1")).toBe(true);
  });

  it("detects Teredo (2001:0::/32)", () => {
    expect(isPrivateIP("2001:0::1")).toBe(true);
  });

  it("detects documentation prefix (2001:db8::/32)", () => {
    expect(isPrivateIP("2001:db8::1")).toBe(true);
  });
});

// ─── clampTimeout ────────────────────────────────────────────────────────────

describe("clampTimeout", () => {
  it("clamps below minimum to 1000ms", () => {
    expect(clampTimeout(0)).toBe(1_000);
    expect(clampTimeout(-1)).toBe(1_000);
    expect(clampTimeout(500)).toBe(1_000);
  });

  it("clamps above maximum to 300000ms", () => {
    expect(clampTimeout(999_999)).toBe(300_000);
  });

  it("floors fractional values", () => {
    expect(clampTimeout(5000.7)).toBe(5000);
  });

  it("passes through valid values", () => {
    expect(clampTimeout(30_000)).toBe(30_000);
  });

  it("handles NaN and Infinity", () => {
    expect(clampTimeout(NaN)).toBe(1_000);
    expect(clampTimeout(Infinity)).toBe(1_000);
    expect(clampTimeout(-Infinity)).toBe(1_000);
  });
});

// ─── validateUrl ─────────────────────────────────────────────────────────────

describe("validateUrl", () => {
  it("rejects non-HTTP protocols", async () => {
    await expect(validateUrl("ftp://example.com")).rejects.toThrow("Unsupported protocol");
    await expect(validateUrl("file:///etc/passwd")).rejects.toThrow("Unsupported protocol");
    await expect(validateUrl("javascript:alert(1)")).rejects.toThrow("Unsupported protocol");
  });

  it("rejects invalid URLs", async () => {
    await expect(validateUrl("not-a-url")).rejects.toThrow("Invalid URL");
    await expect(validateUrl("")).rejects.toThrow("Invalid URL");
  });

  it("rejects blocked hostnames", async () => {
    await expect(validateUrl("http://localhost")).rejects.toThrow("Blocked");
    await expect(validateUrl("http://localhost.localdomain")).rejects.toThrow("Blocked");
    await expect(validateUrl("http://metadata.google.internal")).rejects.toThrow("Blocked");
  });

  it("rejects blocked hostname suffixes", async () => {
    await expect(validateUrl("http://app.internal")).rejects.toThrow("Blocked");
    await expect(validateUrl("http://myhost.local")).rejects.toThrow("Blocked");
    await expect(validateUrl("http://box.localhost")).rejects.toThrow("Blocked");
    await expect(validateUrl("http://server.corp")).rejects.toThrow("Blocked");
    await expect(validateUrl("http://router.home")).rejects.toThrow("Blocked");
    await expect(validateUrl("http://nas.lan")).rejects.toThrow("Blocked");
  });

  it("rejects private IP addresses", async () => {
    await expect(validateUrl("http://127.0.0.1")).rejects.toThrow("private");
    await expect(validateUrl("http://10.0.0.1")).rejects.toThrow("private");
    await expect(validateUrl("http://192.168.1.1")).rejects.toThrow("private");
    await expect(validateUrl("http://[::1]")).rejects.toThrow("private");
  });

  it("rejects IP obfuscation techniques", async () => {
    // Hex encoding of 127.0.0.1
    await expect(validateUrl("http://0x7f000001")).rejects.toThrow("private");
    // Decimal encoding of 127.0.0.1
    await expect(validateUrl("http://2130706433")).rejects.toThrow("private");
    // IPv6-mapped IPv4
    await expect(validateUrl("http://[::ffff:127.0.0.1]")).rejects.toThrow("private");
  });
});
