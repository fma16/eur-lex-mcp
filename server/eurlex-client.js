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
      <sear:exactCount>true</sear:exactCount>
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

function resolveHtmlUrl(documentLinks) {
  const links = asArray(documentLinks);
  const html = links.find((link) => String(link?.TYPE || "").toLowerCase() === "html");
  return html?.URL ? String(html.URL) : null;
}

export function normalizeSearchResponse(parsedXml) {
  const envelope = parsedXml?.Envelope;
  const body = envelope?.Body;
  const response = body?.searchRequestResponse;
  const searchResults = response?.searchResults;
  const resultNodes = asArray(searchResults?.result);

  const results = resultNodes
    .map((node) => {
      const notice = node?.content?.NOTICE;
      const celex = textValue(notice?.ID_CELEX?.VALUE);
      const title = resolveDocumentTitle(notice?.EXPRESSION);
      const url = resolveHtmlUrl(node?.document_link);
      if (!celex || !title) return null;
      return {
        celex,
        title: title.trim(),
        url
      };
    })
    .filter(Boolean);

  return {
    total: Number(searchResults?.totalhits || results.length),
    page: Number(searchResults?.page || 1),
    page_size: Number(searchResults?.pageSize || results.length),
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

  async search({ query, language, page, pageSize, timeoutMs }) {
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
          "Content-Type": "application/soap+xml; charset=utf-8",
          SOAPAction: "https://eur-lex.europa.eu/EURLexWebService/doQuery"
        },
        body: xml,
        signal: controller.signal
      });

      const rawXml = await response.text();
      if (!response.ok) {
        const preview = rawXml.slice(0, 500);
        throw new Error(`EUR-Lex HTTP ${response.status}: ${preview}`);
      }

      const parsed = parser.parse(rawXml);
      const faultMessage = extractFaultMessage(parsed);
      if (faultMessage) {
        throw new Error(`EUR-Lex SOAP fault: ${faultMessage}`);
      }
      const normalized = normalizeSearchResponse(parsed);
      return normalized;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`EUR-Lex request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
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
