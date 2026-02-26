import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "../src/converter.js";

describe("htmlToMarkdown", () => {
  it("converts basic HTML to markdown", () => {
    const html = "<h1>Hello</h1><p>World</p>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Hello");
    expect(md).toContain("World");
  });

  it("converts links", () => {
    const html = '<a href="https://example.com">click here</a>';
    const md = htmlToMarkdown(html, { baseUrl: "https://base.com" });
    expect(md).toContain("[click here](https://example.com");
  });

  it("resolves relative URLs to absolute", () => {
    const html = '<a href="/page">link</a>';
    const md = htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(md).toContain("https://example.com/page");
  });

  it("strips dangerous javascript: links", () => {
    const html = '<a href="javascript:alert(1)">click</a>';
    const md = htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(md).not.toContain("javascript:");
    expect(md).toContain("click");
  });

  it("strips dangerous data: links", () => {
    const html = '<a href="data:text/html,<script>alert(1)</script>">xss</a>';
    const md = htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(md).not.toContain("data:");
  });

  it("strips javascript: with embedded control characters", () => {
    const html = '<a href="java\tscript:alert(1)">bypass</a>';
    const md = htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(md).not.toContain("javascript:");
  });

  it("strips javascript: from images", () => {
    const html = '<img src="javascript:alert(1)" alt="xss">';
    const md = htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(md).not.toContain("javascript:");
  });

  it("converts images with alt text", () => {
    const html = '<img src="https://example.com/img.png" alt="photo">';
    const md = htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(md).toContain("![photo](https://example.com/img.png)");
  });

  it("strips images when stripImages is true", () => {
    const html = '<p>text</p><img src="https://example.com/img.png" alt="photo">';
    const md = htmlToMarkdown(html, { stripImages: true });
    expect(md).not.toContain("![");
    expect(md).toContain("text");
  });

  it("uses adaptive fence length for code blocks", () => {
    const html = "<pre><code>some ```backticks``` here</code></pre>";
    const md = htmlToMarkdown(html);
    // Should use 4 backticks since content has 3
    expect(md).toContain("````");
  });

  it("limits language tag length to 50 chars", () => {
    const longLang = "a".repeat(100);
    const html = `<pre><code class="language-${longLang}">code</code></pre>`;
    const md = htmlToMarkdown(html);
    // Language tag should be truncated
    const fenceMatch = md.match(/```(\w+)/);
    expect(fenceMatch).not.toBeNull();
    expect(fenceMatch![1].length).toBeLessThanOrEqual(50);
  });

  it("escapes brackets in link text", () => {
    const html = '<a href="https://example.com">[test]</a>';
    const md = htmlToMarkdown(html, { baseUrl: "https://example.com" });
    // Brackets in link text are escaped to prevent markdown breakout.
    // Turndown escapes once, then our escapeMarkdownBrackets adds another layer.
    // The raw output should not contain unescaped bare [test] inside the link text.
    expect(md).not.toMatch(/\[(?<!\\)\[test(?<!\\)\]\]/);
    expect(md).toContain("test");
    expect(md).toContain("example.com");
  });

  it("escapes parentheses in URLs", () => {
    const html = '<a href="https://example.com/page_(1)">link</a>';
    const md = htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(md).toContain("%28");
    expect(md).toContain("%29");
  });

  it("escapes quotes in link titles", () => {
    const html = '<a href="https://example.com" title=\'say "hello"\'>link</a>';
    const md = htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(md).not.toContain('"say "hello"');
  });

  it("converts GFM tables", () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody><tr><td>A</td><td>1</td></tr></tbody>
      </table>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("Name");
    expect(md).toContain("Value");
    // Turndown may add extra whitespace in cells — just verify structure
    expect(md).toMatch(/\|.*A.*\|.*1.*\|/);
  });

  it("collapses excessive blank lines", () => {
    const html = "<p>one</p><br><br><br><br><br><p>two</p>";
    const md = htmlToMarkdown(html);
    // Should never have more than 2 consecutive newlines
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("throws on deeply nested HTML (stack overflow protection)", () => {
    const depth = 600;
    const html = "<div>".repeat(depth) + "deep" + "</div>".repeat(depth);
    expect(() => htmlToMarkdown(html)).toThrow("too deeply nested");
  });

  it("filters dangerous protocols without baseUrl", () => {
    const html = '<a href="javascript:void(0)">link</a>';
    const md = htmlToMarkdown(html); // no baseUrl
    expect(md).not.toContain("javascript:");
    expect(md).toContain("link");
  });

  it("filters dangerous image protocols without baseUrl", () => {
    const html = '<img src="data:image/png;base64,abc" alt="img">';
    const md = htmlToMarkdown(html); // no baseUrl
    expect(md).not.toContain("data:");
  });
});
