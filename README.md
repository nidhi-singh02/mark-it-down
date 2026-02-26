# web-to-markdown

Convert any web page to clean Markdown. Built for developers and LLM pipelines.

Handles documentation sites (Mintlify, GitBook, Docusaurus, Next.js docs), blogs, news articles, and more. Automatically extracts the main content, strips navigation chrome, and produces readable Markdown with GFM support.

## Quick Start

```bash
# No install needed
npx web-to-markdown https://example.com

# Save to a file
npx web-to-markdown https://example.com -o page.md
```

## Install

```bash
# Global CLI
npm install -g web-to-markdown

# Project dependency
npm install web-to-markdown
```

Requires Node.js 20 or later.

## CLI Usage

```bash
web-to-markdown <url> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <file>` | Write to file instead of stdout |
| `-b, --browser` | Force headless browser rendering (for SPAs) |
| `-r, --raw` | Convert full HTML without content extraction |
| `-f, --frontmatter` | Include YAML frontmatter with metadata |
| `--no-images` | Strip images from output |
| `--timeout <ms>` | Timeout for page loading (default: 30000) |

### Examples

```bash
# Convert a blog post
web-to-markdown https://example.com/blog/post

# Include title, author, date as YAML frontmatter
web-to-markdown https://example.com/blog/post -f

# Strip all images
web-to-markdown https://example.com --no-images

# Convert full page HTML without content extraction
web-to-markdown https://example.com -r

# Pipe to another tool
web-to-markdown https://example.com | head -20
```

### JavaScript-Rendered Pages (SPAs)

Some pages (React, Vue, Angular apps) render content with JavaScript. Use `--browser` to launch a headless Chromium instance:

```bash
# One-time setup
npm install playwright
npx playwright install chromium

# Use the --browser flag
web-to-markdown https://myapp.com --browser
```

Playwright is an optional peer dependency and is only needed for JS-rendered pages.

## Programmatic API

```typescript
import { convert } from "web-to-markdown";

const { markdown, metadata, warnings } = await convert("https://example.com", {
  frontmatter: true,
  noImages: false,
  timeout: 30_000,
});

console.log(metadata.title);
console.log(markdown);
```

## How It Works

The converter tries multiple extraction strategies in order, using the first one that succeeds:

### Strategy 1: Raw Markdown Endpoint

Many documentation sites serve raw markdown when `.md` is appended to the URL path. The converter tries this first (e.g., `/docs/guide` becomes `/docs/guide.md`). Works with Mintlify, Stripe Docs, GitHub Docs, React docs, Next.js docs, and others.

### Strategy 2: MDX Extraction (Next.js / Mintlify)

For sites built with Next.js and Mintlify, the converter extracts MDX content directly from React Server Component payloads embedded in the HTML. It parses YAML frontmatter, strips JSX components (Accordion, Tab, Callout, Card, etc.) into clean Markdown equivalents, and resolves relative URLs.

### Strategy 3: Readability + Turndown

The general-purpose fallback:

1. **Extract** -- Mozilla Readability removes boilerplate (nav, footer, ads), isolating the main content
2. **Convert** -- Turndown converts the cleaned HTML to Markdown with GFM support (tables, task lists, strikethrough, fenced code blocks)

If Readability drops significant content (detected via `<pre>` block comparison), the converter falls back to extracting from `<article>` or `<main>` elements directly.

### Site-Specific Handling

**GitBook** -- Detects GitBook pages via `data-gb-*` attributes and removes navigation chrome before extraction: site header, sidebar TOC, breadcrumbs, SVG icons in headings, dark-mode duplicate images, and "Was this helpful?" boilerplate.

**Code blocks** -- Language detection from `class="language-X"`, `data-lang` attributes, and Sphinx/Pygments span classes. Adaptive fence length for code containing backticks.

## Security

- **SSRF protection** -- Blocks requests to private IPs, localhost, link-local, and cloud metadata endpoints. Handles obfuscated IPs (hex, octal, decimal encoding, IPv6-mapped IPv4, NAT64). DNS is resolved once and pinned to prevent rebinding attacks.
- **Dangerous protocol filtering** -- Strips `javascript:`, `data:`, `vbscript:`, and other dangerous URL schemes from links and images, with control character and zero-width character normalization.
- **Content limits** -- 10MB response size limit, 100K DOM element cap, 500-level nesting depth guard.
- **Redirect validation** -- Each redirect hop is re-validated for SSRF (max 5 redirects).
- **Sandboxed MDX evaluation** -- Compiled MDX is executed with a mock React runtime; dangerous patterns (`require`, `import`, `eval`, `fetch`, `process`) are blocked.
- **Typed errors** -- All failures throw specific error classes (`ValidationError`, `SSRFError`, `NetworkError`, `ContentError`) with ES2022 error cause chaining.

## License

MIT
