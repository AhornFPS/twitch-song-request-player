// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const appRootDir = path.resolve(moduleDir, "..");

function extractFunction(source, functionName) {
  const startIndex = source.indexOf(`function ${functionName}`);
  assert.notEqual(startIndex, -1);

  const bodyStartIndex = source.indexOf("{", startIndex);
  assert.notEqual(bodyStartIndex, -1);

  let depth = 0;
  for (let index = bodyStartIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  throw new Error(`Could not extract ${functionName}.`);
}

function renderReleaseNotes(input) {
  const source = fs.readFileSync(path.join(appRootDir, "client", "dashboard.ts"), "utf8");
  const context = {
    input,
    result: ""
  };

  vm.createContext(context);
  vm.runInContext(
    [
      extractFunction(source, "htmlEscape"),
      extractFunction(source, "escapeReleaseNoteHtmlText"),
      extractFunction(source, "stripUnsafeReleaseNoteBlocks"),
      extractFunction(source, "sanitizeReleaseNotesHtml"),
      extractFunction(source, "hasReleaseNoteHtml"),
      extractFunction(source, "formatMarkdown"),
      "result = formatMarkdown(input);"
    ].join("\n"),
    context
  );

  return context.result;
}

test("dashboard release-note markdown escapes HTML before rendering", () => {
  const result = renderReleaseNotes("- safe & sound\n- <img src=x onerror=alert(1)>");

  assert.match(result, /<li>safe &amp; sound<\/li>/);
  assert.match(result, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(result, /<img/);
});

test("dashboard release-note html renders allowed updater markup without unsafe tags", () => {
  const result = renderReleaseNotes(
    '<h2>2.10.0 </h2><ul><li>Added OBS fallback &amp; update notes.</li><li><img src=x onerror=alert(1)>Safe text</li></ul><script>alert("x")</script>'
  );

  assert.match(result, /<h2>2\.10\.0 <\/h2>/);
  assert.match(result, /<ul><li>Added OBS fallback &amp; update notes\.<\/li><li>Safe text<\/li><\/ul>/);
  assert.doesNotMatch(result, /&lt;h2/);
  assert.doesNotMatch(result, /<img/);
  assert.doesNotMatch(result, /onerror|script|alert/);
});
