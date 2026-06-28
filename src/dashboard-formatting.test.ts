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

test("dashboard release-note markdown escapes HTML before rendering", () => {
  const source = fs.readFileSync(path.join(appRootDir, "client", "dashboard.ts"), "utf8");
  const context = {
    result: ""
  };

  vm.createContext(context);
  vm.runInContext(
    [
      extractFunction(source, "htmlEscape"),
      extractFunction(source, "formatMarkdown"),
      "result = formatMarkdown('- safe & sound\\n- <img src=x onerror=alert(1)>');"
    ].join("\n"),
    context
  );

  assert.match(context.result, /<li>safe &amp; sound<\/li>/);
  assert.match(context.result, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(context.result, /<img/);
});
