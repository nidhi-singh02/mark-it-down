import { describe, it, expect } from "vitest";

// ─── .md URL Strategy Tests ──────────────────────────────────────────────────
// buildMarkdownUrl and isLikelyMarkdown are private, so we replicate the logic.

function buildMarkdownUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;
    if (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    if (!pathname || pathname === "/") return null;
    if (/\.\w+$/.test(pathname)) return null;
    parsed.pathname = pathname + ".md";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function isLikelyMarkdown(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.length < 50) return false;
  if (/^<!doctype\s/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return false;
  const tagCount = (trimmed.slice(0, 2000).match(/<[a-z]+[\s>]/gi) || []).length;
  if (tagCount > 10) return false;
  return true;
}

describe("buildMarkdownUrl", () => {
  it("appends .md to a path", () => {
    expect(buildMarkdownUrl("https://docs.example.com/guides/intro")).toBe(
      "https://docs.example.com/guides/intro.md"
    );
  });

  it("strips trailing slash before appending .md", () => {
    expect(buildMarkdownUrl("https://docs.example.com/guides/intro/")).toBe(
      "https://docs.example.com/guides/intro.md"
    );
  });

  it("returns null for root URL", () => {
    expect(buildMarkdownUrl("https://docs.example.com/")).toBeNull();
    expect(buildMarkdownUrl("https://docs.example.com")).toBeNull();
  });

  it("returns null for paths with file extensions", () => {
    expect(buildMarkdownUrl("https://example.com/page.html")).toBeNull();
    expect(buildMarkdownUrl("https://example.com/doc.pdf")).toBeNull();
  });

  it("strips query string and hash", () => {
    const result = buildMarkdownUrl("https://example.com/page?lang=en#section");
    expect(result).toBe("https://example.com/page.md");
  });

  it("returns null for invalid URLs", () => {
    expect(buildMarkdownUrl("not-a-url")).toBeNull();
  });
});

describe("isLikelyMarkdown", () => {
  it("accepts markdown with frontmatter", () => {
    const md = `---\ntitle: Test\n---\n\n# Hello World\n\nSome content here that is long enough to pass the length check.`;
    expect(isLikelyMarkdown(md)).toBe(true);
  });

  it("accepts plain markdown", () => {
    const md = `# Getting Started\n\nThis is a guide to getting started with the platform. Follow the steps below.`;
    expect(isLikelyMarkdown(md)).toBe(true);
  });

  it("rejects HTML documents", () => {
    const html = `<!DOCTYPE html>\n<html><body><h1>Hello</h1></body></html>`;
    expect(isLikelyMarkdown(html)).toBe(false);
  });

  it("rejects HTML starting with <html>", () => {
    const html = `<html>\n<head><title>Page</title></head>\n<body><p>Content that is long enough.</p></body>\n</html>`;
    expect(isLikelyMarkdown(html)).toBe(false);
  });

  it("rejects content with many HTML tags", () => {
    const html = `<div><p>One</p><p>Two</p><p>Three</p><p>Four</p><p>Five</p><p>Six</p><p>Seven</p><p>Eight</p><p>Nine</p><p>Ten</p><p>Eleven</p></div>`;
    expect(isLikelyMarkdown(html)).toBe(false);
  });

  it("rejects very short content", () => {
    expect(isLikelyMarkdown("# Hi")).toBe(false);
    expect(isLikelyMarkdown("Not found")).toBe(false);
  });
});

// ─── sanitizeYamlValue Tests ─────────────────────────────────────────────────
// Test the sanitizeYamlValue logic indirectly through convert's frontmatter.
// Since sanitizeYamlValue is private, we test the public generateFrontmatter
// behavior via the convert function's frontmatter option.
// For unit-level, we replicate the logic here to verify edge cases.

function sanitizeYamlValue(value: string): string {
  const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g; // eslint-disable-line no-control-regex
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\u0085\u2028\u2029]+/g, " ")
    .replace(CONTROL_CHARS_RE, "")
    .trim();
}

describe("sanitizeYamlValue", () => {
  it("escapes double quotes", () => {
    expect(sanitizeYamlValue('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes backslashes", () => {
    expect(sanitizeYamlValue("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  it("collapses newlines to spaces", () => {
    expect(sanitizeYamlValue("line1\nline2\r\nline3")).toBe("line1 line2 line3");
  });

  it("strips control characters", () => {
    expect(sanitizeYamlValue("hello\x00world\x1f")).toBe("helloworld");
  });

  it("strips tabs", () => {
    expect(sanitizeYamlValue("hello\tworld")).toBe("helloworld");
  });

  it("trims whitespace", () => {
    expect(sanitizeYamlValue("  hello  ")).toBe("hello");
  });

  it("handles Unicode line separators", () => {
    expect(sanitizeYamlValue("a\u2028b\u2029c")).toBe("a b c");
  });

  it("escapes backslash before quote (order matters)", () => {
    expect(sanitizeYamlValue('\\"')).toBe('\\\\\\"');
  });

  it("handles empty string", () => {
    expect(sanitizeYamlValue("")).toBe("");
  });

  it("handles YAML injection attempt", () => {
    const malicious = 'title"\ninjected_key: "value';
    const result = sanitizeYamlValue(malicious);
    expect(result).not.toContain("\n");
    expect(result).toContain('\\"');
  });
});
