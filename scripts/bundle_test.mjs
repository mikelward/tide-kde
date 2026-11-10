// Tests for bundle.mjs: what KWin's engine can't run fails the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function bundle(files) {
  const dir = mkdtempSync(join(tmpdir(), "bundle-test."));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return execFileSync("node", ["scripts/bundle.mjs", join(dir, "main.js")], { encoding: "utf8", stdio: "pipe" });
}

test("modules run in one script, each import given its exports", () => {
  const out = bundle({
    "main.js": 'import * as a from "./a.js";\nimport { two } from "./b.js";\nresult = a.one() + two;\n',
    "a.js": "export function one() { return 1; }\n",
    "b.js": 'import * as a from "./a.js";\nexport const two = a.one() + 1;\n',
  });
  const scope = { result: undefined };
  new Function("scope", `with (scope) { ${out} }`)(scope);
  assert.equal(scope.result, 3);
  assert.equal(out.match(/var __a = /g).length, 1, "a module is bundled once");
});

for (const [what, text] of [
  ["object spread", "const x = { ...y };\n"],
  ["a Unicode property escape", "const r = /\\p{L}/u;\n"],
  ["Object.fromEntries", "Object.fromEntries([]);\n"],
  ["an import this bundler can't take", 'import "./a.js";\n'],
]) {
  test(`${what} fails the build`, () => {
    assert.throws(() => bundle({ "main.js": text, "a.js": "" }), new RegExp(what.replace(/\W/g, ".")));
  });
}

test("a comment may mention what the engine can't run", () => {
  bundle({ "main.js": "// no { ...spread } here\n" });
});
