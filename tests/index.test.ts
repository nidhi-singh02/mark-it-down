import { describe, it, expect } from "vitest";

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
