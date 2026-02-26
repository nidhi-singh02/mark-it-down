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

// ─── GitBook Preprocessing Tests ──────────────────────────────────────────────

/** Helper: minimal GitBook-like page with data-gb-* attributes. */
function gitbookPage(mainContent: string): string {
  return `<html><head><title>GitBook Page</title></head><body>
    <header data-gb-site-header="true">
      <div>Logo</div>
      <div>⌘K</div>
    </header>
    <aside data-gb-table-of-contents="true">
      <nav><a href="/page1">Page 1</a><a href="/page2">Page 2</a></nav>
    </aside>
    <aside class="group/aside">
      <nav>On this page: Heading 1, Heading 2</nav>
    </aside>
    <nav aria-label="Breadcrumb">
      <a href="/">Home</a> / <a href="/docs">Docs</a>
    </nav>
    <main>
      ${mainContent}
    </main>
    <footer>Was this helpful? <button>Yes</button> <button>No</button></footer>
  </body></html>`;
}

describe("extractContent — GitBook cleanup", () => {
  it("removes site header with search shortcut", () => {
    const html = gitbookPage(`
      <h1>Getting Started</h1>
      <p>This is a long enough article body that Readability should
      be able to extract it properly. We need enough text to pass the
      character threshold for extraction. Let's add more content here
      to make sure the extraction works correctly for GitBook pages.</p>
      <p>Second paragraph with additional content to ensure proper
      extraction by the readability algorithm and metadata parsing.</p>
    `);
    const result = extractContent(html, "https://docs.gitbook.com/getting-started");
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain("⌘K");
  });

  it("removes sidebar table of contents", () => {
    const html = gitbookPage(`
      <h1>Content Page</h1>
      <p>This is a long enough article body that Readability should
      be able to extract it properly. We need enough text to pass the
      character threshold for extraction. Let's add more content here
      to make sure the extraction works correctly for GitBook pages.</p>
      <p>Second paragraph with additional content to ensure proper
      extraction by the readability algorithm and metadata parsing.</p>
    `);
    const result = extractContent(html, "https://docs.gitbook.com/content");
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain("Page 1");
    expect(result!.content).not.toContain("Page 2");
  });

  it("removes SVG icons from headings", () => {
    const html = gitbookPage(`
      <h1><svg><use href="#book-open"></use></svg>Documentation</h1>
      <p>This is a long enough article body that Readability should
      be able to extract it properly. We need enough text to pass the
      character threshold for extraction. Let's add more content here
      to make sure the extraction works correctly for GitBook pages.</p>
      <p>Second paragraph with additional content to ensure proper
      extraction by the readability algorithm and metadata parsing.</p>
    `);
    const result = extractContent(html, "https://docs.gitbook.com/docs");
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain("book-open");
    expect(result!.content).toContain("Documentation");
  });

  it("preserves main article content", () => {
    const html = gitbookPage(`
      <h1>API Reference</h1>
      <p>This is the API reference documentation. It contains detailed
      information about all available endpoints, parameters, and response
      formats. Use this guide to integrate with our platform effectively.</p>
      <h2>Authentication</h2>
      <p>All API requests require authentication using an API key. Include
      your key in the Authorization header of every request you make.
      This ensures secure access to all API endpoints and resources.</p>
      <pre><code class="language-bash">curl -H "Authorization: Bearer YOUR_KEY" https://api.example.com</code></pre>
    `);
    const result = extractContent(html, "https://docs.gitbook.com/api");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("API Reference");
    expect(result!.content).toContain("Authentication");
    expect(result!.content).toContain("Authorization: Bearer YOUR_KEY");
  });

  it("does not affect non-GitBook pages", () => {
    const html = `<html><head><title>Normal Page</title></head><body>
      <aside><nav>Sidebar</nav></aside>
      <main>
        <h1>Normal Article</h1>
        <p>This is a long enough article body that Readability should
        be able to extract it properly. We need enough text to pass the
        character threshold for extraction. Let's add enough content.</p>
        <p>Second paragraph with additional content to ensure proper
        extraction by the readability algorithm and metadata parsing.</p>
      </main>
    </body></html>`;
    const result = extractContent(html, "https://example.com");
    expect(result).not.toBeNull();
    // Aside should NOT be removed on non-GitBook pages
    // (Readability handles it via its own heuristics)
    expect(result!.content).toContain("Normal Article");
  });

  it("removes breadcrumb navigation", () => {
    const html = gitbookPage(`
      <h1>Deep Page</h1>
      <p>This is a long enough article body that Readability should
      be able to extract it properly. We need enough text to pass the
      character threshold for extraction. Let's add more content here
      to make sure the extraction works correctly for GitBook pages.</p>
      <p>Second paragraph with additional content to ensure proper
      extraction by the readability algorithm and metadata parsing.</p>
    `);
    const result = extractContent(html, "https://docs.gitbook.com/deep");
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain("Breadcrumb");
    expect(result!.content).not.toContain("Home");
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
