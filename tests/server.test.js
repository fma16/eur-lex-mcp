import test from "node:test";
import assert from "node:assert/strict";

import { formatEurLexHttpError, normalizeSearchResponse } from "../server/eurlex-client.js";
import {
  parseCelex,
  parseLanguage,
  parsePage,
  parsePageSize,
  parseTimeoutMs
} from "../server/validation.js";
import { errorResponse, successResponse } from "../server/responses.js";

test("validation utilities enforce constraints", () => {
  assert.equal(parseLanguage("EN"), "en");
  assert.equal(parsePage(3), 3);
  assert.equal(parsePageSize(10, 50), 10);
  assert.equal(parseTimeoutMs(4000, 15000), 4000);
  assert.equal(parseCelex("32016R0679"), "32016R0679");

  assert.throws(() => parseLanguage("english"));
  assert.throws(() => parsePage(0));
  assert.throws(() => parsePageSize(500, 50));
  assert.throws(() => parseTimeoutMs(10, 15000));
  assert.throws(() => parseCelex("bad value with spaces"));
});

test("normalizeSearchResponse returns compact structured result", () => {
  const parsed = {
    Envelope: {
      Body: {
        searchRequestResponse: {
          searchResults: {
            totalhits: "1",
            page: "1",
            pageSize: "10",
            result: {
              content: {
                NOTICE: {
                  ID_CELEX: { VALUE: "32016R0679" },
                  EXPRESSION: {
                    EXPRESSION_TITLE: {
                      VALUE: "General Data Protection Regulation"
                    }
                  }
                }
              },
              document_link: [{ TYPE: "html", URL: "https://example.test/doc" }]
            }
          }
        }
      }
    }
  };

  const normalized = normalizeSearchResponse(parsed);
  assert.equal(normalized.total, 1);
  assert.equal(normalized.results.length, 1);
  assert.equal(normalized.results[0].celex, "32016R0679");
});

test("normalizeSearchResponse handles direct searchResults body and document_link attribute format", () => {
  const parsed = {
    Envelope: {
      Body: {
        searchResults: {
          totalhits: "1",
          page: "1",
          result: {
            content: {
              NOTICE: {
                ID_CELEX: { VALUE: "32016R0679" },
                EXPRESSION: {
                  EXPRESSION_TITLE: {
                    VALUE: "Reglement general sur la protection des donnees"
                  }
                }
              }
            },
            document_link: [{ type: "html", "#text": "https://example.test/rgpd" }]
          }
        }
      }
    }
  };

  const normalized = normalizeSearchResponse(parsed);
  assert.equal(normalized.total, 1);
  assert.equal(normalized.page, 1);
  assert.equal(normalized.page_size, 1);
  assert.equal(normalized.results[0].url, "https://example.test/rgpd");
});

test("normalizeSearchResponse extracts CELEX from NOTICE.WORK.ID_CELEX", () => {
  const parsed = {
    Envelope: {
      Body: {
        searchResults: {
          totalhits: "1",
          page: "1",
          result: {
            content: {
              NOTICE: {
                EXPRESSION: {
                  EXPRESSION_TITLE: {
                    VALUE: "RGPD"
                  }
                },
                WORK: {
                  ID_CELEX: { VALUE: "32016R0679" }
                }
              }
            },
            document_link: [{ type: "html", "#text": "https://example.test/rgpd" }]
          }
        }
      }
    }
  };

  const normalized = normalizeSearchResponse(parsed);
  assert.equal(normalized.results.length, 1);
  assert.equal(normalized.results[0].celex, "32016R0679");
});

test("response helpers produce consistent shape", () => {
  const ok = successResponse({ hello: "world" });
  assert.deepEqual(ok, {
    ok: true,
    data: { hello: "world" },
    error: null
  });

  const failure = errorResponse("boom", { code: "ERR" });
  assert.equal(failure.ok, false);
  assert.equal(failure.error.message, "boom");
  assert.equal(failure.error.code, "ERR");
});

test("formatEurLexHttpError clarifies WS_QUERY_SYNTAX_ERROR", () => {
  const faultXml =
    "<?xml version='1.0' encoding='UTF-8'?><S:Envelope xmlns:S='http://www.w3.org/2003/05/soap-envelope'><S:Body><ns1:Fault xmlns:ns1='http://www.w3.org/2003/05/soap-envelope'><ns1:Code><ns1:Value>ns1:Sender</ns1:Value><ns1:Subcode><ns1:Value xmlns:ns2='http://eur-lex.europa.eu/search'>ns2:WS_QUERY_SYNTAX_ERROR</ns1:Value></ns1:Subcode></ns1:Code><ns1:Reason><ns1:Text xml:lang='en'>Erreur a la ligne 1, caractere 8.</ns1:Text></ns1:Reason></ns1:Fault></S:Body></S:Envelope>";

  const message = formatEurLexHttpError(500, faultXml);
  assert.match(message, /Invalid EUR-Lex expert query syntax/i);
  assert.match(message, /DN = 32016R0679/);
});
