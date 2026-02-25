import { resolve, dirname } from "node:path";
import { existsSync, lstatSync } from "node:fs";
import { realpath, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { convert } from "./index.js";

/**
 * Validate the output path to prevent writing to sensitive locations.
 * Checks both logical path and real filesystem path (following symlinks).
 */
async function validateOutputPath(outputPath: string): Promise<string> {
  const resolved = resolve(outputPath);
  const cwd = process.cwd();

  // Ensure resolved path is strictly within CWD
  if (!resolved.startsWith(cwd + "/") && resolved !== cwd) {
    throw new Error(
      `Output path "${outputPath}" resolves outside the current directory.\n` +
        `Resolved to: ${resolved}\n` +
        "For safety, output files must be within the working directory."
    );
  }

  // Walk up from the target to CWD, checking for symlinks that escape CWD
  let checkPath = resolved;
  while (checkPath !== cwd && checkPath !== dirname(checkPath)) {
    if (existsSync(checkPath)) {
      // Reject if the existing component is a symlink
      const stat = lstatSync(checkPath);
      if (stat.isSymbolicLink()) {
        const realTarget = await realpath(checkPath);
        const realCwd = await realpath(cwd);
        if (!realTarget.startsWith(realCwd + "/") && realTarget !== realCwd) {
          throw new Error(
            `Output path "${outputPath}" follows a symlink outside the current directory.\n` +
              `Symlink "${checkPath}" points to "${realTarget}".\n` +
              "For safety, output files must not escape the working directory via symlinks."
          );
        }
      }
      break;
    }
    checkPath = dirname(checkPath);
  }

  return resolved;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("markitdown")
    .description("Convert any web page to clean Markdown")
    .version("0.1.0")
    .argument("<url>", "URL of the web page to convert")
    .option("-o, --output <file>", "Write to file instead of stdout")
    .option(
      "-b, --browser",
      "Force headless browser rendering (for SPAs)",
      false
    )
    .option(
      "-r, --raw",
      "Convert full HTML without content extraction",
      false
    )
    .option(
      "-f, --frontmatter",
      "Include YAML frontmatter with metadata",
      false
    )
    .option("--no-images", "Strip images from output")
    .option(
      "--timeout <ms>",
      "Timeout for page loading in milliseconds",
      "30000"
    )
    .action(async (url: string, opts: Record<string, unknown>) => {
      try {
        const result = await convert(url, {
          browser: Boolean(opts.browser),
          raw: Boolean(opts.raw),
          frontmatter: Boolean(opts.frontmatter),
          noImages: !opts.images, // commander parses --no-images as images=false
          timeout: Number(opts.timeout),
        });

        if (opts.output) {
          const safePath = await validateOutputPath(opts.output as string);
          await writeFile(safePath, result.markdown, "utf-8");
          process.stderr.write(`Written to ${safePath}\n`);
        } else {
          process.stdout.write(result.markdown);
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }
    });

  return program;
}

export async function run(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);
}
