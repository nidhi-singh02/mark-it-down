import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/icons", { recursive: true });
cpSync("popup.html", "dist/popup.html");
cpSync("popup.css", "dist/popup.css");
cpSync("manifest.json", "dist/manifest.json");
cpSync("icons", "dist/icons", { recursive: true });
