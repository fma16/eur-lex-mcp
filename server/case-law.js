import { parseCelex, sanitizeString } from "./validation.js";

export function parseCaseLawCelex(celex) {
  const value = parseCelex(celex);
  if (!value.startsWith("6")) {
    throw new Error("Invalid celex: EU case-law documents must use CELEX sector 6");
  }
  return value;
}

export function parseCaseLawYear(year) {
  if (year === undefined || year === null || year === "") return null;
  const parsed = Number(year);
  const value = Math.trunc(parsed);
  if (!Number.isFinite(parsed) || value < 1950 || value > 9999) {
    throw new Error("Invalid year: expected integer 1950-9999");
  }
  return value;
}

function normalizeExpertValue(value, field, maxLength) {
  const normalized = sanitizeString(value, field, maxLength).replace(/\s+/g, " ");
  if (normalized.includes('"')) {
    throw new Error(`Invalid ${field}: double quotes are not supported`);
  }
  return normalized;
}

function quotedContainsClause(field, value, inputName) {
  return `${field} ~ "${normalizeExpertValue(value, inputName, 1000)}"`;
}

export function buildCaseLawExpertQuery({ celex, year, text, title, expert_query: expertQuery }) {
  if (celex !== undefined && celex !== null && celex !== "") {
    return `DN = ${parseCaseLawCelex(celex)}`;
  }

  const parsedYear = parseCaseLawYear(year);
  const clauses = [`DN = 6${parsedYear || ""}*`];

  if (text !== undefined && text !== null && text !== "") {
    clauses.push(quotedContainsClause("Text", text, "text"));
  }

  if (title !== undefined && title !== null && title !== "") {
    clauses.push(quotedContainsClause("TI", title, "title"));
  }

  if (expertQuery !== undefined && expertQuery !== null && expertQuery !== "") {
    clauses.push(`(${sanitizeString(expertQuery, "expert_query", 3000)})`);
  }

  return clauses.join(" AND ");
}
