import { describe, it, expect } from "vitest";
import { extractMdx, processRawMdx } from "../src/mdx-extractor.js";

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

// ─── Mintlify Compiled-MDX Tests ──────────────────────────────────────────────

/**
 * Helper: wrap compiled Mintlify MDX in RSC script tags.
 * Optionally includes a metadata wrapper chunk with pageMetadata.
 */
function mintlifyRscPage(
  compiledMdx: string,
  metadata?: { title?: string; description?: string }
): string {
  const escaped = compiledMdx
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");

  let metadataScript = "";
  if (metadata) {
    const metaObj = JSON.stringify({ pageMetadata: metadata });
    const metaEscaped = metaObj.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    metadataScript = `<script>self.__next_f.push([1,"${metaEscaped}"])</script>`;
  }

  return `<html><head></head><body>
    ${metadataScript}
    <script>self.__next_f.push([1,"${escaped}"])</script>
  </body></html>`;
}

/** Minimal compiled MDX wrapper matching Mintlify's output format. */
function mintlifyChunk(jsxBody: string): string {
  return `"use strict";
const {Fragment: _Fragment, jsx: _jsx, jsxs: _jsxs} = arguments[0];
const {useMDXComponents: _provideComponents} = arguments[0];
function _createMdxContent(props) {
  const _components = {
    a: "a", code: "code", em: "em", h2: "h2", h3: "h3",
    li: "li", ol: "ol", p: "p", pre: "pre", span: "span",
    strong: "strong", ul: "ul", blockquote: "blockquote",
    table: "table", thead: "thead", tbody: "tbody", tr: "tr", th: "th", td: "td",
    ..._provideComponents(),
    ...props.components
  }, {Card, CardGroup, CodeBlock, Heading, Info, Warning, Note, Tip, Step, Steps, Accordion, AccordionGroup, Tabs, Tab} = _components;
  return ${jsxBody};
}
function MDXContent(props = {}) {
  const {wrapper: MDXLayout} = {
    ..._provideComponents(),
    ...props.components
  };
  return MDXLayout ? _jsx(MDXLayout, {
    ...props,
    children: _jsx(_createMdxContent, {...props})
  }) : _createMdxContent(props);
}
return { default: MDXContent };
function _missingMdxReference(id, component) {
  throw new Error("Expected " + (component ? "component" : "object") + " \`" + id + "\` to be defined");
}`;
}

describe("extractMdx — Mintlify compiled MDX", () => {
  it("extracts basic paragraph", () => {
    const chunk = mintlifyChunk(`_jsx(_components.p, { children: "Hello from Mintlify." })`);
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("Hello from Mintlify.");
  });

  it("extracts Heading component with level", () => {
    const chunk = mintlifyChunk(
      `_jsxs(_Fragment, { children: [
        _jsx(Heading, { level: "2", id: "intro", children: "Introduction" }),
        "\\n",
        _jsx(Heading, { level: "3", id: "setup", children: "Setup" })
      ] })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("## Introduction");
    expect(result!.markdown).toContain("### Setup");
  });

  it("extracts standard HTML heading elements", () => {
    const chunk = mintlifyChunk(`_jsx(_components.h2, { children: "HTML Heading" })`);
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("## HTML Heading");
  });

  it("extracts links", () => {
    const chunk = mintlifyChunk(
      `_jsx(_components.p, { children: _jsx(_components.a, { href: "/docs/page", children: "Click here" }) })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com/docs");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("[Click here](https://example.com/docs/page)");
  });

  it("extracts inline formatting", () => {
    const chunk = mintlifyChunk(
      `_jsxs(_components.p, { children: [
        _jsx(_components.strong, { children: "bold" }),
        " and ",
        _jsx(_components.em, { children: "italic" }),
        " and ",
        _jsx(_components.code, { children: "code" })
      ] })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("**bold**");
    expect(result!.markdown).toContain("*italic*");
    expect(result!.markdown).toContain("`code`");
  });

  it("extracts code blocks with Shiki spans", () => {
    const chunk = mintlifyChunk(
      `_jsx(CodeBlock, {
        language: "typescript",
        children: _jsx(_components.pre, {
          children: _jsxs(_components.code, {
            language: "typescript",
            children: [
              _jsxs(_components.span, {
                className: "line",
                children: [
                  _jsx(_components.span, { style: { color: "#CF222E" }, children: "const" }),
                  _jsx(_components.span, { style: { color: "#1F2328" }, children: " x = 42;" })
                ]
              }),
              "\\n",
              _jsxs(_components.span, {
                className: "line",
                children: [
                  _jsx(_components.span, { style: { color: "#CF222E" }, children: "console" }),
                  _jsx(_components.span, { style: { color: "#1F2328" }, children: ".log(x);" })
                ]
              })
            ]
          })
        })
      })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("```typescript");
    expect(result!.markdown).toContain("const x = 42;");
    expect(result!.markdown).toContain("console.log(x);");
    expect(result!.markdown).toContain("```");
  });

  it("extracts unordered lists", () => {
    const chunk = mintlifyChunk(
      `_jsxs(_components.ul, { children: [
        _jsx(_components.li, { children: _jsx(_components.p, { children: "Item one" }) }),
        _jsx(_components.li, { children: _jsx(_components.p, { children: "Item two" }) })
      ] })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("- Item one");
    expect(result!.markdown).toContain("- Item two");
  });

  it("extracts ordered lists", () => {
    const chunk = mintlifyChunk(
      `_jsxs(_components.ol, { children: [
        _jsx(_components.li, { children: _jsx(_components.p, { children: "First" }) }),
        _jsx(_components.li, { children: _jsx(_components.p, { children: "Second" }) })
      ] })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("1. First");
    expect(result!.markdown).toContain("2. Second");
  });

  it("extracts Warning admonition", () => {
    const chunk = mintlifyChunk(
      `_jsx(Warning, { children: _jsx(_components.p, { children: "Do not do this." }) })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("> **Warning:**");
    expect(result!.markdown).toContain("Do not do this.");
  });

  it("extracts Info admonition", () => {
    const chunk = mintlifyChunk(
      `_jsx(Info, { children: _jsx(_components.p, { children: "Helpful information." }) })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("> **Info:**");
    expect(result!.markdown).toContain("Helpful information.");
  });

  it("extracts Steps with titles", () => {
    const chunk = mintlifyChunk(
      `_jsxs(Steps, { children: [
        _jsx(Step, { title: "Build", children: _jsx(_components.p, { children: "Build the project." }) }),
        _jsx(Step, { title: "Deploy", children: _jsx(_components.p, { children: "Deploy to prod." }) })
      ] })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("**1. Build**");
    expect(result!.markdown).toContain("Build the project.");
    expect(result!.markdown).toContain("**2. Deploy**");
    expect(result!.markdown).toContain("Deploy to prod.");
  });

  it("extracts Card with title and href", () => {
    const chunk = mintlifyChunk(
      `_jsx(Card, {
        title: "Getting Started",
        href: "/docs/start",
        children: _jsx(_components.p, { children: "Begin your journey." })
      })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("### [Getting Started](https://example.com/docs/start)");
    expect(result!.markdown).toContain("Begin your journey.");
  });

  it("extracts Accordion with title", () => {
    const chunk = mintlifyChunk(
      `_jsx(Accordion, {
        title: "Advanced Options",
        children: _jsx(_components.p, { children: "Hidden content here." })
      })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("### Advanced Options");
    expect(result!.markdown).toContain("Hidden content here.");
  });

  it("extracts Tabs", () => {
    const chunk = mintlifyChunk(
      `_jsxs(Tabs, { children: [
        _jsx(Tab, { title: "JavaScript", children: _jsx(_components.p, { children: "Use npm." }) }),
        _jsx(Tab, { title: "Python", children: _jsx(_components.p, { children: "Use pip." }) })
      ] })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("**JavaScript**");
    expect(result!.markdown).toContain("Use npm.");
    expect(result!.markdown).toContain("**Python**");
    expect(result!.markdown).toContain("Use pip.");
  });

  it("extracts metadata from pageMetadata", () => {
    const chunk = mintlifyChunk(`_jsx(_components.p, { children: "Content." })`);
    const result = extractMdx(
      mintlifyRscPage(chunk, {
        title: "My API Guide",
        description: "Learn how to use the API.",
      }),
      "https://example.com"
    );
    expect(result).not.toBeNull();
    expect(result!.metadata.title).toBe("My API Guide");
    expect(result!.metadata.excerpt).toBe("Learn how to use the API.");
  });

  it("returns null for dangerous code patterns", () => {
    const dangerous = `"use strict";
const {jsx: _jsx} = arguments[0];
const {useMDXComponents: _provideComponents} = arguments[0];
require("child_process").exec("rm -rf /");
function _createMdxContent(props) {
  return _jsx("p", { children: "evil" });
}
function MDXContent(props = {}) { return _createMdxContent(props); }
return { default: MDXContent };`;
    const result = extractMdx(mintlifyRscPage(dangerous), "https://example.com");
    expect(result).toBeNull();
  });

  it("returns null for non-Mintlify HTML", () => {
    const html = `<html><body><h1>Plain page</h1></body></html>`;
    const result = extractMdx(html, "https://example.com");
    expect(result).toBeNull();
  });

  it("extracts mixed content", () => {
    const chunk = mintlifyChunk(
      `_jsxs(_Fragment, { children: [
        _jsx(_components.p, { children: "Intro paragraph." }),
        "\\n",
        _jsx(Heading, { level: "2", id: "options", children: "Options" }),
        "\\n",
        _jsxs(_components.p, { children: [
          "Use the ",
          _jsx(_components.code, { children: "sendTransaction" }),
          " method."
        ] }),
        "\\n",
        _jsx(Warning, { children: _jsx(_components.p, { children: "Be careful!" }) }),
        "\\n",
        _jsxs(_components.ul, { children: [
          _jsxs(_components.li, { children: [
            _jsx(_components.strong, { children: "Option A" }),
            ": Fast."
          ] }),
          _jsxs(_components.li, { children: [
            _jsx(_components.strong, { children: "Option B" }),
            ": Reliable."
          ] })
        ] })
      ] })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("Intro paragraph.");
    expect(result!.markdown).toContain("## Options");
    expect(result!.markdown).toContain("`sendTransaction`");
    expect(result!.markdown).toContain("> **Warning:**");
    expect(result!.markdown).toContain("Be careful!");
    expect(result!.markdown).toContain("- **Option A**: Fast.");
    expect(result!.markdown).toContain("- **Option B**: Reliable.");
    // No excessive blank lines
    expect(result!.markdown).not.toMatch(/\n{3,}/);
  });

  it("extracts tables", () => {
    const chunk = mintlifyChunk(
      `_jsxs(_components.table, { children: [
        _jsx(_components.thead, { children:
          _jsxs(_components.tr, { children: [
            _jsx(_components.th, { children: "Name" }),
            _jsx(_components.th, { children: "Type" })
          ] })
        }),
        _jsx(_components.tbody, { children:
          _jsxs(_components.tr, { children: [
            _jsx(_components.td, { children: "id" }),
            _jsx(_components.td, { children: "string" })
          ] })
        })
      ] })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("| Name");
    expect(result!.markdown).toContain("| id");
    expect(result!.markdown).toContain("---");
  });

  it("collapses excessive blank lines", () => {
    const chunk = mintlifyChunk(
      `_jsxs(_Fragment, { children: [
        _jsx(_components.p, { children: "First." }),
        "\\n\\n\\n\\n",
        _jsx(_components.p, { children: "Second." })
      ] })`
    );
    const result = extractMdx(mintlifyRscPage(chunk), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).not.toMatch(/\n{3,}/);
  });

  it("existing frontmatter tests still take priority over Mintlify path", () => {
    // A page with YAML frontmatter should use Strategy 1, not Mintlify
    const mdx = `---
title: Frontmatter Page
---

# Content`;
    const result = extractMdx(rscPage(mdx), "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("# Content");
    expect(result!.metadata.title).toBe("Frontmatter Page");
  });
});

// ─── processRawMdx Tests ─────────────────────────────────────────────────────

describe("processRawMdx", () => {
  it("processes raw MDX with frontmatter", () => {
    const mdx = `---
title: My Page
description: A description
---

# Hello World

Some content here.`;

    const result = processRawMdx(mdx, "https://example.com");
    expect(result.markdown).toContain("# Hello World");
    expect(result.markdown).toContain("Some content here.");
    expect(result.metadata.title).toBe("My Page");
    expect(result.metadata.excerpt).toBe("A description");
  });

  it("strips MDX components from raw content", () => {
    const mdx = `---
title: Test
---

<Accordion title="Details">

Hidden content.

</Accordion>

<Callout>
Important note.
</Callout>`;

    const result = processRawMdx(mdx, "https://example.com");
    expect(result.markdown).toContain("### Details");
    expect(result.markdown).toContain("Hidden content.");
    expect(result.markdown).toContain("> Important note.");
    expect(result.markdown).not.toContain("<Accordion");
    expect(result.markdown).not.toContain("<Callout");
  });

  it("resolves relative URLs", () => {
    const mdx = `---
title: Test
---

[Link](/docs/page)
![Image](/assets/img.png)`;

    const result = processRawMdx(mdx, "https://example.com/docs");
    expect(result.markdown).toContain("https://example.com/docs/page");
    expect(result.markdown).toContain("https://example.com/assets/img.png");
  });

  it("handles content without frontmatter", () => {
    const mdx = `# No Frontmatter

Just content.`;

    const result = processRawMdx(mdx, "https://example.com");
    expect(result.markdown).toContain("# No Frontmatter");
    expect(result.markdown).toContain("Just content.");
    expect(result.metadata.title).toBeNull();
  });

  it("collapses excessive blank lines", () => {
    const mdx = `---
title: Test
---

First.



Second.`;

    const result = processRawMdx(mdx, "https://example.com");
    expect(result.markdown).not.toMatch(/\n{3,}/);
  });
});
