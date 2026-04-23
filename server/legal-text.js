function decodeHtmlEntities(input) {
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function normalizeWhitespace(input) {
  return String(input).replace(/\s+/g, " ").trim();
}

function toPlainText(xmlFragment) {
  const withBreaks = String(xmlFragment)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n");
}

function extractFirstInnerText(xmlFragment, regex) {
  const match = regex.exec(xmlFragment);
  if (!match) return "";
  return normalizeWhitespace(decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " ")));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractDivBlockById(xhtml, id) {
  const re = new RegExp(`<div\\b[^>]*\\bid="${escapeRegex(id)}"[^>]*>`, "i");
  const match = re.exec(xhtml);
  if (!match) return null;
  return extractDivBlockFromIndex(xhtml, match.index);
}

function extractDivBlockFromIndex(xhtml, startIndex) {
  const tokenRe = /<div\b[^>]*>|<\/div>/gi;
  tokenRe.lastIndex = startIndex;

  let depth = 0;
  let started = false;
  let token;

  while ((token = tokenRe.exec(xhtml)) !== null) {
    const fragment = token[0].toLowerCase();
    if (fragment.startsWith("</div")) {
      depth -= 1;
      if (started && depth === 0) {
        const end = token.index + token[0].length;
        return xhtml.slice(startIndex, end);
      }
      continue;
    }

    depth += 1;
    if (!started) {
      started = true;
    }
  }

  return null;
}

function normalizeArticleToken(article) {
  const normalized = normalizeWhitespace(String(article || ""))
    .toLowerCase()
    .replace(/^article\s+/i, "");

  if (!normalized) return "";
  if (normalized === "premier" || normalized === "1er") return "1";
  return normalized.replace(/[^a-z0-9]/g, "");
}

export function extractArticleFromXhtml(xhtml, article) {
  const token = normalizeArticleToken(article);
  if (!token) return null;

  const block = extractDivBlockById(xhtml, `art_${token}`);
  if (!block) return null;

  const heading = extractFirstInnerText(
    block,
    /<p\b[^>]*class="[^"]*\boj-ti-art\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i
  );
  const title = extractFirstInnerText(
    block,
    /<div\b[^>]*class="[^"]*\beli-title\b[^"]*"[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i
  );

  return {
    article_id: `art_${token}`,
    heading,
    title,
    text: toPlainText(block)
  };
}

export function extractRecitalsFromXhtml(xhtml) {
  const block = extractDivBlockById(xhtml, "pbl_1");
  if (!block) return null;

  return {
    section_id: "pbl_1",
    text: toPlainText(block)
  };
}

export function extractFullTextFromXhtml(xhtml) {
  return toPlainText(xhtml);
}

function classifyTocId(rawId) {
  const id = String(rawId || "");
  if (!id || id.includes(".tit_")) return null;

  const segments = id.split(".");
  const structural = [...segments]
    .reverse()
    .find((segment) => /^(prt|ttl|cpt|sec|sct|art)_[a-z0-9ivxlc]+$/i.test(segment));

  if (!structural) return null;

  const [prefix, ...rest] = structural.split("_");
  const number = rest.join("_");
  const typeByPrefix = {
    prt: "part",
    ttl: "title",
    cpt: "chapter",
    sec: "section",
    sct: "subsection",
    art: "article"
  };

  return {
    type: typeByPrefix[prefix.toLowerCase()] || "node",
    number
  };
}

export function extractTocFromXhtml(xhtml) {
  const entries = [];
  const seen = new Set();
  const divRe = /<div\b[^>]*\bid="([^"]+)"[^>]*>/gi;

  let match;
  let order = 0;
  while ((match = divRe.exec(xhtml)) !== null) {
    const id = match[1];
    const classification = classifyTocId(id);
    if (!classification) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const block = extractDivBlockFromIndex(xhtml, match.index);
    if (!block) continue;

    const numberLabel = extractFirstInnerText(
      block,
      /<p\b[^>]*class="[^"]*\boj-ti-[^"]*"[^>]*>([\s\S]*?)<\/p>/i
    );
    const title = extractFirstInnerText(
      block,
      /<div\b[^>]*class="[^"]*\beli-title\b[^"]*"[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i
    );

    entries.push({
      order: ++order,
      id,
      type: classification.type,
      number: classification.number,
      label: numberLabel || "",
      title: title || ""
    });
  }

  return entries;
}
