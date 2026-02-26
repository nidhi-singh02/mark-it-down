import { describe, it, expect } from "vitest";
import { extractContent, isProbablyReaderable } from "../src/extractor.js";

describe("extractContent", () => {
  const articleHtml = `
    <html>
    <head><title>Test Article</title></head>
    <body>
      <nav>Navigation</nav>
      <article>
        <h1>Test Article</h1>
        <p>This is a long enough article body that Readability should
        be able to extract it properly. We need enough text to pass the
        character threshold. Let's add some more content here to make sure
        the extraction works correctly. This paragraph has plenty of text
        for the readability algorithm to detect.</p>
        <p>Another paragraph with substantial content to ensure the article
        is long enough for extraction. Readability uses a character threshold
        to determine if content is meaningful enough to extract.</p>
      </article>
      <footer>Footer content</footer>
    </body>
    </html>`;

  it("extracts article content from well-structured HTML", () => {
    const result = extractContent(articleHtml, "https://example.com");
    expect(result).not.toBeNull();
    // Readability extracts body paragraphs (title goes to metadata)
    expect(result!.content).toContain("article body");
    expect(result!.metadata.title).toBeTruthy();
  });

  it("returns extraction result with content field", () => {
    const result = extractContent(articleHtml, "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.content).toBeTruthy();
    expect(typeof result!.content).toBe("string");
  });

  it("populates metadata fields", () => {
    const html = `
      <html lang="en">
      <head>
        <title>My Article</title>
        <meta property="og:site_name" content="Test Site">
        <meta property="article:published_time" content="2024-01-01">
        <meta name="description" content="A test article">
      </head>
      <body>
        <article>
          <h1>My Article</h1>
          <p>This is a sufficiently long article body for Readability
          to extract. We need enough text to pass the character threshold
          that Readability uses to determine if content is meaningful.
          Let's add more content to be safe about passing extraction.</p>
          <p>Second paragraph with additional content to ensure proper
          extraction by the readability algorithm and metadata parsing.</p>
        </article>
      </body>
      </html>`;
    const result = extractContent(html, "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.metadata.lang).toBe("en");
  });

  it("returns metadata with null fields for missing data", () => {
    const result = extractContent(articleHtml, "https://example.com");
    expect(result).not.toBeNull();
    // publishedTime won't exist unless the page has the right meta tags
    expect(result!.metadata).toHaveProperty("publishedTime");
    expect(result!.metadata).toHaveProperty("siteName");
  });
});

describe("isProbablyReaderable", () => {
  it("returns true for pages with substantial text", () => {
    const html = `<html><body><p>${"word ".repeat(100)}</p></body></html>`;
    expect(isProbablyReaderable(html)).toBe(true);
  });

  it("returns false for pages with minimal text", () => {
    const html = "<html><body><p>short</p></body></html>";
    expect(isProbablyReaderable(html)).toBe(false);
  });

  it("returns false for empty body", () => {
    const html = "<html><body></body></html>";
    expect(isProbablyReaderable(html)).toBe(false);
  });
});
