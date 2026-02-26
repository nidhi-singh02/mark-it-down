import { describe, it, expect } from "vitest";
import { extractMdx } from "../src/mdx-extractor.js";

/** Helper: wrap MDX content in a Next.js RSC script tag. */
function rscPage(mdx: string): string {
  // JSON-escape the MDX content as it would appear in the RSC payload
  const escaped = mdx
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

  return `<html><head></head><body>
    <script>self.__next_f.push([1,"${escaped}"])</script>
  </body></html>`;
}

describe("extractMdx", () => {
  it("extracts MDX from Next.js RSC payloads", () => {
    const mdx = `---
title: Test Page
description: A test page
---

# Hello World

Some content here.`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("# Hello World");
    expect(result!.markdown).toContain("Some content here.");
  });

  it("returns null for non-Next.js HTML", () => {
    const html = `<html><body><h1>Hello</h1></body></html>`;
    const result = extractMdx(html, "https://example.com");
    expect(result).toBeNull();
  });

  it("parses frontmatter into metadata", () => {
    const mdx = `---
title: My Page Title
description: A description of the page
---

Content here.`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.metadata.title).toBe("My Page Title");
    expect(result!.metadata.excerpt).toBe("A description of the page");
  });

  it("parses multiline frontmatter values", () => {
    const mdx = `---
title: Quick Installation
description:
  A quick installation guide that allows you to set up your local
  development environment with a single command.
---

Content here.`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.metadata.excerpt).toContain("quick installation guide");
  });

  it("strips frontmatter from markdown output", () => {
    const mdx = `---
title: Test
---

# Heading`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).not.toContain("---");
    expect(result!.markdown).toContain("# Heading");
  });

  it("converts Accordion components to headings", () => {
    const mdx = `---
title: Test
---

<Accordion title="Windows">

Install WSL first.

\`\`\`terminal
$ wsl --install
\`\`\`

</Accordion>`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("### Windows");
    expect(result!.markdown).toContain("Install WSL first.");
    expect(result!.markdown).toContain("$ wsl --install");
    expect(result!.markdown).not.toContain("<Accordion");
  });

  it("strips Accordions wrapper", () => {
    const mdx = `---
title: Test
---

<Accordions>
<Accordion title="Item">Content</Accordion>
</Accordions>`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).not.toContain("<Accordions>");
    expect(result!.markdown).not.toContain("</Accordions>");
  });

  it("converts Tab components", () => {
    const mdx = `---
title: Test
---

<Tabs items={[".deb", ".rpm"]}>
<Tab value=".deb">
Install with apt.
</Tab>
<Tab value=".rpm">
Install with dnf.
</Tab>
</Tabs>`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("**.deb**");
    expect(result!.markdown).toContain("Install with apt.");
    expect(result!.markdown).toContain("**.rpm**");
    expect(result!.markdown).toContain("Install with dnf.");
    expect(result!.markdown).not.toContain("<Tabs");
    expect(result!.markdown).not.toContain("<Tab ");
  });

  it("converts Callout to blockquote", () => {
    const mdx = `---
title: Test
---

<Callout>
This is a warning message.
</Callout>`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("> This is a warning message.");
    expect(result!.markdown).not.toContain("<Callout");
  });

  it("preserves code blocks", () => {
    const mdx = `---
title: Test
---

\`\`\`bash
npm install
\`\`\``;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("```bash");
    expect(result!.markdown).toContain("npm install");
  });

  it("resolves relative URLs to absolute", () => {
    const mdx = `---
title: Test
---

[Link](/docs/getting-started)
![Image](/assets/image.png)`;

    const result = extractMdx(rscPage(mdx), "https://example.com/docs/page");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("https://example.com/docs/getting-started");
    expect(result!.markdown).toContain("https://example.com/assets/image.png");
  });

  it("does not modify absolute URLs", () => {
    const mdx = `---
title: Test
---

[Link](https://other.com/page)`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("https://other.com/page");
  });

  it("handles escaped characters in RSC payload", () => {
    const mdx = `---
title: Test "Quoted" Page
---

Content with <html> tags and "quotes".`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("<html>");
    expect(result!.markdown).toContain('"quotes"');
  });

  it("strips unknown JSX components but keeps content", () => {
    const mdx = `---
title: Test
---

<Steps>

Step one content.

Step two content.

</Steps>`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("Step one content.");
    expect(result!.markdown).toContain("Step two content.");
    expect(result!.markdown).not.toContain("<Steps");
  });

  it("collapses excessive blank lines", () => {
    const mdx = `---
title: Test
---

First paragraph.



Second paragraph.`;

    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    // Should not have 3+ consecutive newlines
    expect(result!.markdown).not.toMatch(/\n{3,}/);
  });
});
