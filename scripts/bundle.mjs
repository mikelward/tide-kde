// Bundles src/main.js and what it imports into one script, as KWin's
// script engine runs no modules: each module becomes a function whose
// exports a `var` holds, in the order they're needed. Only the two import
// forms src/ uses are taken, so anything else fails here, not in KWin.
//   node scripts/bundle.mjs src/main.js > package/contents/code/main.js
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const entry = process.argv[2];
const done = new Map(); // path -> variable name
const out = [];

function varName(path) {
  return "__" + relative(dirname(entry), path).replace(/\.js$/, "").replace(/\W/g, "_");
}

function load(path) {
  if (done.has(path)) return done.get(path);
  const name = varName(path);
  done.set(path, name);
  let text = readFileSync(path, "utf8");
  const header = [];
  text = text.replace(/^import\s+(.+?)\s+from\s+"(\.\/[^"]+)";\s*$/gm, (_, what, from) => {
    const dep = load(join(dirname(path), from));
    const star = /^\*\s+as\s+(\w+)$/.exec(what);
    const named = /^\{\s*([\w\s,]+?)\s*\}$/.exec(what);
    if (star) header.push(`const ${star[1]} = ${dep};`);
    else if (named) header.push(`const { ${named[1]} } = ${dep};`);
    else throw new Error(`${path}: can't bundle import ${what}`);
    return "";
  });
  if (/^\s*import\b/m.test(text)) throw new Error(`${path}: an import this bundler can't take`);
  // What KWin's script engine (QV4) can't run, found in a headless KWin:
  // it would fail to load, or, for \\p, silently match nothing.
  const unsupported = [
    [/\{\s*\.\.\./, "object spread"],
    [/\\p\{/, "a Unicode property escape"],
    [/Object\.fromEntries/, "Object.fromEntries"],
    [/structuredClone/, "structuredClone"],
  ];
  const code = text.replace(/^\s*\/\/.*$/gm, "");
  for (const [re, what] of unsupported) {
    if (re.test(code)) throw new Error(`${path}: ${what}, which KWin's script engine can't run`);
  }
  const exported = [];
  text = text.replace(/^export\s+(function|class|const|let)\s+(\w+)/gm, (_, kind, id) => {
    exported.push(id);
    return `${kind} ${id}`;
  });
  if (/^\s*export\b/m.test(text)) throw new Error(`${path}: an export this bundler can't take`);
  out.push(`// ${relative(".", path)}\nvar ${name} = (function () {\n${header.join("\n")}\n${text}\nreturn { ${exported.join(", ")} };\n})();\n`);
  return name;
}

load(entry);
process.stdout.write(`// Built by scripts/bundle.mjs from src/; edit those, not this.\n"use strict";\n${out.join("\n")}`);
