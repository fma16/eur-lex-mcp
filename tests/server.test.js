import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSearchResponse } from "../server/eurlex-client.js";
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
