import { XMLParser } from "fast-xml-parser";
import { DEFAULT_SERVICE_HTTP, DEFAULT_SERVICE_HTTPS } from "./constants.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  processEntities: false,
  removeNSPrefix: true
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value["#text"] === "string") {
    return value["#text"];
  }
  return "";
}

function buildSoapEnvelope({ username, password, query, page, pageSize, language }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:sear="http://eur-lex.europa.eu/search">
  <soap:Header>
    <wsse:Security soap:mustUnderstand="true" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
    <sear:searchRequest>
      <sear:expertQuery>${escapeXml(query)}</sear:expertQuery>
      <sear:page>${page}</sear:page>
      <sear:pageSize>${pageSize}</sear:pageSize>
      <sear:searchLanguage>${escapeXml(language)}</sear:searchLanguage>
    </sear:searchRequest>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function resolveDocumentTitle(expression) {
  const expressionList = asArray(expression);
  for (const expressionItem of expressionList) {
    const titles = asArray(expressionItem?.EXPRESSION_TITLE);
    for (const titleObj of titles) {
      const title = textValue(titleObj?.VALUE ?? titleObj);
      if (title) return title;
    }
  }
  return "";
}

function resolveCelex(notice) {
  const direct = textValue(notice?.ID_CELEX?.VALUE);
  if (direct) return direct;

  const works = asArray(notice?.WORK);
  for (const work of works) {
    const celex = textValue(work?.ID_CELEX?.VALUE);
    if (celex) return celex;
  }

  return "";
}

function resolveCellarIdFromUrl(url) {
  const match = String(url || "").match(/uri=cellar:([0-9a-f-]{36})/i);
  return match ? match[1].toLowerCase() : "";
}

function resolveCellarId(notice, htmlUrl) {
  const works = asArray(notice?.WORK);
  for (const work of works) {
    const uris = asArray(work?.URI);
    for (const uri of uris) {
      const type = textValue(uri?.TYPE ?? uri?.type).toLowerCase();
      const identifier = textValue(uri?.IDENTIFIER);
      if (type === "cellar" && identifier) {
        return identifier.toLowerCase();
      }
    }
  }

  return resolveCellarIdFromUrl(htmlUrl);
}

function resolveHtmlUrl(documentLinks) {
  const links = asArray(documentLinks);
  const html = links.find((link) => String(link?.TYPE || link?.type || "").toLowerCase() === "html");
  const url = textValue(html) || textValue(html?.URL);
  return url ? String(url) : null;
}

export function normalizeSearchResponse(parsedXml) {
  const envelope = parsedXml?.Envelope;
  const body = envelope?.Body;
  const response = body?.searchRequestResponse;
  const searchResults = response?.searchResults ?? body?.searchResults;
  const resultNodes = asArray(searchResults?.result);

  const results = resultNodes
    .map((node) => {
      const notice = node?.content?.NOTICE;
      const celex = resolveCelex(notice);
      const title = resolveDocumentTitle(notice?.EXPRESSION);
      const url = resolveHtmlUrl(node?.document_link);
      const cellarId = resolveCellarId(notice, url);
      if (!celex || !title) return null;
      return {
        celex,
        title: title.trim(),
        url,
        cellar_id: cellarId || null
      };
    })
    .filter(Boolean);

  return {
    total: Number(searchResults?.totalhits || results.length),
    page: Number(searchResults?.page || 1),
    page_size: Number(searchResults?.pageSize || resultNodes.length || results.length),
    results
  };
}

export class EurLexSoapClient {
  constructor({ username, password, allowInsecureHttp = false, logger }) {
    this.username = username;
    this.password = password;
    this.allowInsecureHttp = allowInsecureHttp;
    this.logger = logger;
  }

  get endpoint() {
    return this.allowInsecureHttp ? DEFAULT_SERVICE_HTTP : DEFAULT_SERVICE_HTTPS;
  }

  async searchRaw({ query, language, page, pageSize, timeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const xml = buildSoapEnvelope({
        username: this.username,
        password: this.password,
        query,
        page,
        pageSize,
        language
      });

      this.logger.debug("Dispatching EUR-Lex SOAP request", {
        endpoint: this.endpoint,
        page,
        pageSize,
        language
      });

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "text/xml, multipart/*",
          "Content-Type":
            'application/soap+xml; charset=utf-8; action="https://eur-lex.europa.eu/ws/doQuery"',
          SOAPAction: "https://eur-lex.europa.eu/ws/doQuery"
        },
        body: xml,
        signal: controller.signal
      });

      const rawXml = await response.text();
      if (!response.ok) {
        throw new Error(formatEurLexHttpError(response.status, rawXml));
      }

      const parsed = parser.parse(rawXml);
      const faultMessage = extractFaultMessage(parsed);
      if (faultMessage) {
        throw new Error(`EUR-Lex SOAP fault: ${faultMessage}`);
      }
      const normalized = normalizeSearchResponse(parsed);
      return {
        rawXml,
        parsed,
        normalized
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`EUR-Lex request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(params) {
    const response = await this.searchRaw(params);
    return response.normalized;
  }

  async getDocumentStreamByCelex({
    celex,
    language = "fr",
    timeoutMs,
    preferredMimeTypes = ["application/xhtml+xml", "application/xml", "application/pdf"]
  }) {
    const response = await this.searchRaw({
      query: `DN = ${celex}`,
      language,
      page: 1,
      pageSize: 1,
      timeoutMs
    });

    const document = response.normalized.results[0] || null;
    if (!document) {
      throw new Error(`Document not found for CELEX ${celex}`);
    }

    const manifestationIds = extractManifestationIds(response.rawXml);
    if (manifestationIds.length === 0) {
      throw new Error("No CELLAR manifestation found in EUR-Lex response");
    }

    const manifestations = [];
    for (const manifestationId of manifestationIds) {
      try {
        const metadata = await this.fetchManifestationMetadata(manifestationId, timeoutMs);
        manifestations.push(metadata);
      } catch (error) {
        this.logger.debug("Skipping manifestation metadata fetch failure", {
          manifestationId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (manifestations.length === 0) {
      throw new Error("Unable to resolve manifestation metadata from CELLAR");
    }

    const ranked = manifestations
      .map((item) => ({
        ...item,
        rank: rankMimeType(item.mimeType, preferredMimeTypes)
      }))
      .sort((a, b) => a.rank - b.rank || a.manifestationId.localeCompare(b.manifestationId));

    const selected = ranked[0];
    const stream = await this.fetchDocStream(selected.manifestationId, timeoutMs);

    return {
      celex: document.celex,
      title: document.title,
      language,
      cellar_id: document.cellar_id || extractCellarIdFromManifestation(selected.manifestationId),
      source_url: document.url,
      selected_manifestation: {
        id: selected.manifestationId,
        mime_type: selected.mimeType,
        rdf_url: selected.rdfUrl
      },
      manifestations: ranked.map((item) => ({
        id: item.manifestationId,
        mime_type: item.mimeType,
        rdf_url: item.rdfUrl
      })),
      stream
    };
  }

  async fetchManifestationMetadata(manifestationId, timeoutMs) {
    const rdfUrl = `https://publications.europa.eu/resource/cellar/${manifestationId}/rdf/object/full`;
    const rdf = await fetchTextWithTimeout(rdfUrl, timeoutMs);
    const mimeType = extractManifestationMimeType(rdf);

    return {
      manifestationId,
      mimeType,
      rdfUrl
    };
  }

  async fetchDocStream(manifestationId, timeoutMs) {
    const urls = [
      `http://publications.europa.eu/resource/cellar/${manifestationId}/DOC_1`,
      `https://publications.europa.eu/resource/cellar/${manifestationId}/DOC_1`
    ];

    const errors = [];
    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(url, {
            method: "GET",
            signal: controller.signal
          });
          if (!response.ok) {
            errors.push(`${url} -> HTTP ${response.status}`);
            continue;
          }

          const contentType = (response.headers.get("content-type") || "").toLowerCase();
          const body = await response.text();
          return {
            url,
            content_type: contentType,
            body
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`Unable to download DOC_1 stream: ${errors.join(" | ")}`);
  }
}

function extractManifestationIds(rawXml) {
  const ids = new Set();
  const re = /https?:\/\/publications\.europa\.eu\/resource\/cellar\/([0-9a-f-]{36}\.[0-9]{4}\.[0-9]{2})/gi;
  let match;
  while ((match = re.exec(String(rawXml || ""))) !== null) {
    ids.add(match[1].toLowerCase());
  }
  return [...ids];
}

function extractManifestationMimeType(rdf) {
  const match = String(rdf || "").match(
    /<[^>]*manifestationMimeType[^>]*>([^<]+)<\/[^>]*manifestationMimeType>/i
  );
  return (match?.[1] || "").trim().toLowerCase();
}

function rankMimeType(mimeType, preferredMimeTypes) {
  const normalized = String(mimeType || "").toLowerCase();
  const rank = preferredMimeTypes.findIndex((preferred) => normalized.includes(preferred));
  return rank === -1 ? preferredMimeTypes.length + 1 : rank;
}

function extractCellarIdFromManifestation(manifestationId) {
  const match = String(manifestationId || "").match(/^([0-9a-f-]{36})\.[0-9]{4}\.[0-9]{2}$/i);
  return match ? match[1].toLowerCase() : null;
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`${url} -> HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatEurLexHttpError(status, rawXml) {
  const fallbackPreview = String(rawXml || "").slice(0, 500);

  try {
    const parsed = parser.parse(rawXml);
    const faultMessage = extractFaultMessage(parsed);
    const subcode = extractFaultSubcode(parsed);
    const compact = `${faultMessage || ""} ${subcode || ""}`.toUpperCase();

    if (compact.includes("WS_QUERY_SYNTAX_ERROR")) {
      return [
        "Invalid EUR-Lex expert query syntax.",
        "Use expert syntax, for example:",
        "DN = 32016R0679",
        "DN = 32016R0679 AND TI contains data",
        `EUR-Lex HTTP ${status}: ${faultMessage || "WS_QUERY_SYNTAX_ERROR"}`
      ].join(" ");
    }

    if (faultMessage) {
      return `EUR-Lex HTTP ${status}: ${faultMessage}`;
    }
  } catch {
    // Ignore parser failures and fallback to raw preview.
  }

  return `EUR-Lex HTTP ${status}: ${fallbackPreview}`;
}

function extractFaultMessage(parsedXml) {
  const body = parsedXml?.Envelope?.Body;
  const fault = body?.Fault;
  if (!fault) return null;

  const reasonText = textValue(fault?.Reason?.Text) || textValue(fault?.faultstring);
  const codeValue = textValue(fault?.Code?.Value) || textValue(fault?.faultcode);
  const compact = [codeValue, reasonText].filter(Boolean).join(" - ").trim();
  return compact || "Unknown SOAP fault";
}

function extractFaultSubcode(parsedXml) {
  const body = parsedXml?.Envelope?.Body;
  const fault = body?.Fault;
  if (!fault) return "";

  return (
    textValue(fault?.Code?.Subcode?.Value) ||
    textValue(fault?.code?.subcode?.value) ||
    ""
  );
}
