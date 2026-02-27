import { convert } from "./convert";

/** Maximum HTML size to process (5 MB). Prevents the popup from freezing on huge pages. */
const MAX_HTML_SIZE = 5 * 1024 * 1024;

const CHECKMARK_SVG = `<svg class="checkmark" viewBox="0 0 20 20" fill="currentColor">
  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
</svg>`;

const ERROR_SVG = `<svg class="error-icon" viewBox="0 0 20 20" fill="currentColor">
  <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
</svg>`;

function showSuccess(message: string): void {
  const status = document.getElementById("status");
  const spinner = document.getElementById("spinner");
  const msg = document.getElementById("message");
  if (!status || !spinner || !msg) return;
  status.className = "success";
  spinner.outerHTML = CHECKMARK_SVG;
  msg.textContent = message;
}

function showError(message: string): void {
  const status = document.getElementById("status");
  const spinner = document.getElementById("spinner");
  const msg = document.getElementById("message");
  if (!status || !spinner || !msg) return;
  status.className = "error";
  spinner.outerHTML = ERROR_SVG;
  msg.textContent = message;
}

async function run(): Promise<void> {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url) {
      showError("No active tab found.");
      return;
    }

    // Skip chrome://, about:, and other restricted pages
    if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://")) {
      showError("Cannot convert this page (restricted URL).");
      return;
    }

    // Grab the page HTML from the active tab
    let html: string | undefined;
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML,
      });
      html = result?.result as string | undefined;
    } catch {
      showError("Cannot access this page. Some sites block extensions.");
      return;
    }

    if (!html) {
      showError("Could not read page content.");
      return;
    }

    // Guard against extremely large pages that could freeze the popup
    if (html.length > MAX_HTML_SIZE) {
      showError("Page is too large to convert.");
      return;
    }

    // Convert HTML to Markdown
    const { markdown } = convert(html, tab.url);

    if (!markdown.trim()) {
      showError("No content found on this page.");
      return;
    }

    // Copy to clipboard
    await navigator.clipboard.writeText(markdown);

    showSuccess("Copied to clipboard!");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Conversion failed.";
    showError(message);
  }
}

document.addEventListener("DOMContentLoaded", run);
