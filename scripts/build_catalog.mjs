import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const SYSTEMS_DIR = path.join(REPO_ROOT, "systems");
const CATALOG_DIR = path.join(REPO_ROOT, "catalog");
const CATALOG_PATH = path.join(CATALOG_DIR, "catalog.json");
const README_PATH = path.join(REPO_ROOT, "README.md");

const AUTO_START = "<!-- AUTO-LIST:START -->";
const AUTO_END = "<!-- AUTO-LIST:END -->";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function safeSlugFromFolder(folderName) {
  const ok = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folderName);
  assert(ok, `Invalid slug/folder name "${folderName}". Use lowercase letters/numbers/hyphens only.`);
  return folderName;
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeDescription(description) {
  if (typeof description === "string") {
    return { short: description.trim(), long: "" };
  }

  if (description && typeof description === "object") {
    return {
      short: typeof description.short === "string" ? description.short.trim() : "",
      long: typeof description.long === "string" ? description.long.trim() : ""
    };
  }

  return { short: "", long: "" };
}

function normalizeLicense(license) {
  if (typeof license === "string") return license.trim();
  if (license && typeof license === "object" && typeof license.value === "string") {
    return license.value.trim();
  }
  return "";
}

function normalizeAuthors(meta) {
  if (typeof meta.author === "string" && meta.author.trim()) {
    return [meta.author.trim()];
  }

  if (Array.isArray(meta.authors)) {
    return meta.authors
      .map(a => {
        if (typeof a === "string") return a.trim();
        if (a && typeof a === "object" && typeof a.name === "string") return a.name.trim();
        return "";
      })
      .filter(Boolean);
  }

  return [];
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  return tags
    .map(tag => {
      if (typeof tag === "string") return tag.trim();
      if (tag && typeof tag === "object" && typeof tag.value === "string") return tag.value.trim();
      return "";
    })
    .filter(Boolean);
}

function resolveThumbnail(slug, meta, sysDir) {
  const fromMeta = meta?.files?.thumbnail;
  const fallback = "00_thumb.png";
  const raw = typeof fromMeta === "string" && fromMeta.trim() ? fromMeta.trim() : fallback;

  const withoutLeading = raw.replace(/^\.\//, "").replace(/^\//, "");
  const withoutSlugPrefix = withoutLeading.startsWith(`${slug}/`)
    ? withoutLeading.slice(slug.length + 1)
    : withoutLeading;

  const localPath = path.join(sysDir, withoutSlugPrefix);
  assert(exists(localPath), `Missing ${path.relative(REPO_ROOT, localPath)} (required thumbnail)`);

  const repoRelative = path.posix.join("systems", slug, withoutSlugPrefix.split(path.sep).join("/"));
  return repoRelative;
}

function buildSystemsIndex() {
  assert(exists(SYSTEMS_DIR), `Missing folder: ${SYSTEMS_DIR}`);

  const entries = fs.readdirSync(SYSTEMS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const systems = [];

  for (const folder of entries) {
    const slug = safeSlugFromFolder(folder);
    const sysDir = path.join(SYSTEMS_DIR, folder);

    const aggregationPath = path.join(sysDir, "aggregation.json");
    const metaPath = path.join(sysDir, "meta.json");
    // required files
    assert(exists(aggregationPath), `Missing ${path.relative(REPO_ROOT, aggregationPath)}`);
    assert(exists(metaPath), `Missing ${path.relative(REPO_ROOT, metaPath)}`);

    const meta = readJson(metaPath);
    const description = normalizeDescription(meta.description);
    const authors = normalizeAuthors(meta);
    const thumbnail = resolveThumbnail(slug, meta, sysDir);

    const name = firstNonEmptyString([meta.title, meta.name, slug]);
    const tags = normalizeTags(meta.tags);
    const license = normalizeLicense(meta.license);
    const author = authors.join(", ");

    systems.push({
      slug,
      name,
      description: description.short,
      description_long: description.long,
      tags,
      license,
      author,
      authors,
      thumbnail,
      aggregation_url: `systems/${slug}/aggregation.json`,
      meta_url: `systems/${slug}/meta.json`
    });
  }

  return systems;
}

function writeCatalog(systems) {
  if (!exists(CATALOG_DIR)) fs.mkdirSync(CATALOG_DIR, { recursive: true });

  const catalog = {
    generated_at: new Date().toISOString(),
    count: systems.length,
    systems
  };

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");
}

function mdEscape(text) {
  return String(text).replace(/\|/g, "\\|").trim();
}

function buildSystemReadme(system) {
  const tags = system.tags.length
    ? system.tags.map(t => `\`${t}\``).join(" ")
    : "_No tags_";

  const descriptionShort = system.description || "_No description provided._";
  const descriptionLong = system.description_long || "";
  const description = descriptionLong
    ? `${descriptionShort}\n\n${descriptionLong}`
    : descriptionShort;

  const author = system.author
    ? system.author
    : "_Unknown author_";

  const license = system.license
    ? system.license
    : "_No license specified_";

  return `# ${system.name}

![${system.name}](00_thumb.png)

## Description

${description}

## Information

| Field | Value |
|---|---|
| Slug | \`${system.slug}\` |
| Author | ${author} |
| License | ${license} |
| Tags | ${tags} |

## Files

- [aggregation.json](aggregation.json)
- [meta.json](meta.json)

---

This README was generated automatically from \`meta.json\` by \`scripts/build_catalog.mjs\`.
`;
}


function writeSystemReadmes(systems) {
  for (const system of systems) {
    const sysDir = path.join(SYSTEMS_DIR, system.slug);
    const readmePath = path.join(sysDir, "README.md");
    const content = buildSystemReadme(system);

    fs.writeFileSync(readmePath, content, "utf8");
  }
}

function buildSystemCard(s) {
  const tags = s.tags.length
    ? s.tags.map(t => `<code>${mdEscape(t)}</code>`).join(" ")
    : "";

  const author = s.author
    ? `<sub>by ${mdEscape(s.author)}</sub><br/>`
    : "";

  const folderUrl = `systems/${s.slug}`;

  return `
<table>
  <tr>
    <td width="90">
      <img src="${s.thumbnail}" width="72" />
    </td>
    <td>
      <strong><a href="${folderUrl}">${mdEscape(s.name)}</a></strong><br/>
      ${author}
      ${tags ? `${tags}<br/>` : ""}
      <a href="${s.aggregation_url}">aggregation.json</a> · <a href="${s.meta_url}">meta.json</a>
    </td>
  </tr>
</table>`;
}


function buildReadmeSection(systems) {
  const lines = [];
  lines.push("");
  lines.push(`<table width="100%">`);
  lines.push(`  <tbody>`);

  for (let i = 0; i < systems.length; i += 2) {
    const left = systems[i];
    const right = systems[i + 1];

    lines.push(`    <tr>`);
    lines.push(`      <td width="50%" valign="top">`);
    lines.push(buildSystemCard(left));
    lines.push(`      </td>`);

    lines.push(`      <td width="50%" valign="top">`);
    if (right) {
      lines.push(buildSystemCard(right));
    } else {
      lines.push(`&nbsp;`);
    }
    lines.push(`      </td>`);

    lines.push(`    </tr>`);
  }

  lines.push(`  </tbody>`);
  lines.push(`</table>`);
  lines.push("");

  return lines.join("\n");
}


function updateReadme(systems) {
  assert(exists(README_PATH), "Missing README.md");

  const readme = fs.readFileSync(README_PATH, "utf8");
  const start = readme.indexOf(AUTO_START);
  const end = readme.indexOf(AUTO_END);

  assert(start !== -1 && end !== -1 && end > start, "README markers not found or in wrong order.");

  const before = readme.slice(0, start + AUTO_START.length);
  const after = readme.slice(end);

  const section = buildReadmeSection(systems);

  const next = `${before}\n${section}\n${after}`;
  fs.writeFileSync(README_PATH, next, "utf8");
}

const systems = buildSystemsIndex();
writeCatalog(systems);
updateReadme(systems);
writeSystemReadmes(systems);

console.log(
  `Generated ${path.relative(REPO_ROOT, CATALOG_PATH)}, updated root README, and generated system READMEs for ${systems.length} systems.`
);