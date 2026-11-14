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

for (const [what, text, error = what] of [
  ["object spread", "const x = { ...y };\n"],
  ["a Unicode property escape", "const r = /\\p{L}/u;\n"],
  ["Object.fromEntries", "Object.fromEntries([]);\n"],
  ["structuredClone", "structuredClone({});\n"],
  ["a class field", "class A {\n  x = 1;\n}\n"],
  ["a static class field", "class A {\n  m() {}\n  static count;\n}\n", "a class field"],
  ["a private class field", "class A extends B { #secret = 2; }\n", "a class field"],
  ["an import this bundler can't take", 'import "./a.js";\n'],
]) {
  test(`${what} fails the build`, () => {
    assert.throws(() => bundle({ "main.js": text, "a.js": "" }), new RegExp(error.replace(/\W/g, ".")));
  });
}

test("a class's methods may set names and take defaults", () => {
  bundle({
    "main.js":
      'class A {\n  constructor(a = 1) {\n    this.x = a;\n    let y;\n  }\n  get z() {\n    return "{ w = 1; }";\n  }\n}\n' +
      "const b = { c: 1 };\nlet d = 2;\n",
  });
});

test("a comment may mention what the engine can't run", () => {
  bundle({ "main.js": "// no { ...spread } here\n" });
});
