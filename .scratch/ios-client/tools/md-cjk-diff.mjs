import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [corpus, gui] = process.argv.slice(2);
const pnpm = path.join(gui, "node_modules/.pnpm");
const find = (prefix) => fs.readdirSync(pnpm).find((d) => d.startsWith(prefix));
const entry = (root) => {
  const pj = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  let e = pj.exports?.["."] ?? pj.exports ?? pj.module ?? pj.main ?? "index.js";
  while (typeof e === "object") e = e.import ?? e.default ?? e.node ?? Object.values(e)[0];
  return path.join(root, e);
};
const imp = (dir, name) => import(pathToFileURL(entry(path.join(pnpm, find(dir), "node_modules", name))).href);
const { unified } = await imp("unified@", "unified");
const remarkParse = (await imp("remark-parse@", "remark-parse")).default;
const remarkGfm = (await imp("remark-gfm@", "remark-gfm")).default;
const remarkCjk = (await imp("remark-cjk-friendly@", "remark-cjk-friendly")).default;
const desk = unified().use(remarkParse).use(remarkGfm).use(remarkCjk);
const std = unified().use(remarkParse).use(remarkGfm);
function stats(proc, text) {
  const tree = proc.runSync(proc.parse(text));
  let emph = 0, stray = 0;
  (function walk(n) {
    if (n.type === "strong" || n.type === "emphasis") emph++;
    if (n.type === "text" && /\*\*/.test(n.value)) stray++;
    (n.children || []).forEach(walk);
  })(tree);
  return { emph, stray };
}
const lines = fs.readFileSync(corpus, "utf8").trim().split("\n").map((l) => JSON.parse(l));
let withEmph = 0, diff = 0; const examples = [];
for (const t of lines) {
  const a = stats(desk, t), b = stats(std, t);
  if (a.emph > 0) withEmph++;
  if (a.emph !== b.emph || a.stray !== b.stray) {
    diff++;
    if (examples.length < 4) {
      const m = t.match(/[^\n]{0,12}\*\*[^\n]{0,24}\*\*[^\n]{0,8}/g) || [];
      const bad = m.find((s) => stats(desk, s).emph !== stats(std, s).emph);
      if (bad) examples.push(bad);
    }
  }
}
console.log(JSON.stringify({ texts: lines.length, withEmphasis: withEmph, renderDiffers: diff, examples }, null, 1));
