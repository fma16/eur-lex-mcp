import test from "node:test";
import assert from "node:assert/strict";

import {
  formatEurLexHttpError,
  isRetryableEurLexError,
  normalizeSearchResponse,
  withEurLexRetry
} from "../server/eurlex-client.js";
import {
  extractArticleFromXhtml,
  extractRecitalsFromXhtml,
  extractTocFromXhtml
} from "../server/legal-text.js";
import {
  parseCelex,
  parseLanguage,
  parsePage,
  parsePageSize,
  parseTimeoutMs
} from "../server/validation.js";
import { errorResponse, successResponse } from "../server/responses.js";
import {
  buildCaseLawExpertQuery,
  parseCaseLawCelex,
  parseCaseLawYear
} from "../server/case-law.js";
import {
  JudilibreClient,
  buildJudilibreDecisionArgs,
  buildJudilibreSearchArgs,
  buildJudilibreTaxonomyArgs,
  buildJudilibreUrl,
  normalizeJudilibreDecision,
  normalizeJudilibreSearchResponse
} from "../server/judilibre-client.js";
import {
  buildLegifranceSearchArgs,
  getLegifranceCaseLawTaxonomy,
  LegifranceClient,
  normalizeLegifranceDecision,
  normalizeLegifranceSearchResponse
} from "../server/legifrance-client.js";
import { FrenchCaseLawRouter } from "../server/french-case-law-router.js";

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

test("case-law helpers enforce CELEX sector 6", () => {
  assert.equal(parseCaseLawCelex("62019CJ0311"), "62019CJ0311");
  assert.throws(() => parseCaseLawCelex("32016R0679"), /sector 6/);
});

test("case-law query builder scopes searches to EU case-law", () => {
  assert.equal(buildCaseLawExpertQuery({}), "DN = 6*");
  assert.equal(buildCaseLawExpertQuery({ year: 2024 }), "DN = 62024*");
  assert.equal(
    buildCaseLawExpertQuery({
      text: "data protection",
      title: "Schrems",
      expert_query: "DD >= 01/01/2020"
    }),
    'DN = 6* AND Text ~ "data protection" AND TI ~ "Schrems" AND (DD >= 01/01/2020)'
  );
  assert.equal(buildCaseLawExpertQuery({ celex: "62019CJ0311", text: "ignored" }), "DN = 62019CJ0311");
  assert.equal(parseCaseLawYear("2020"), 2020);
  assert.throws(() => parseCaseLawYear(1949), /Invalid year/);
  assert.throws(() => buildCaseLawExpertQuery({ text: 'bad "quote' }), /double quotes/);
});

test("Judilibre search args validate filters and keep zero-based pagination", () => {
  const parsed = buildJudilibreSearchArgs(
    {
      query: "responsabilite contractuelle",
      operator: "exact",
      jurisdiction: "cc",
      chamber: ["civ1", "comm"],
      field: ["motivations"],
      date_start: "2024-01-01",
      date_end: "2024-12-31",
      page: 0,
      page_size: 50,
      resolve_references: true
    },
    { maxPageSize: 100, defaultTimeoutMs: 15000 }
  );

  assert.equal(parsed.timeoutMs, 15000);
  assert.equal(parsed.params.page, 0);
  assert.equal(parsed.params.page_size, 50);
  assert.equal(parsed.params.operator, "exact");
  assert.deepEqual(parsed.params.jurisdiction, ["cc"]);
  assert.deepEqual(parsed.params.chamber, ["civ1", "comm"]);
  assert.equal(parsed.params.resolve_references, "true");

  assert.throws(
    () => buildJudilibreSearchArgs({ page: -1 }, { maxPageSize: 50, defaultTimeoutMs: 15000 }),
    /Invalid page/
  );
  assert.throws(
    () =>
      buildJudilibreSearchArgs(
        { page_size: 51 },
        { maxPageSize: 100, defaultTimeoutMs: 15000 }
      ),
    /Invalid page_size/
  );
});

test("Judilibre decision and taxonomy args enforce required combinations", () => {
  const decisionArgs = buildJudilibreDecisionArgs(
    { id: "decision-123", text_scope: "motivations", query: "faute" },
    { defaultTimeoutMs: 15000 }
  );

  assert.deepEqual(decisionArgs.params, {
    id: "decision-123",
    resolve_references: "true",
    query: "faute",
    operator: "and"
  });
  assert.equal(decisionArgs.textScope, "motivations");

  assert.throws(
    () => buildJudilibreDecisionArgs({}, { defaultTimeoutMs: 15000 }),
    /Invalid id/
  );
  assert.throws(
    () =>
      buildJudilibreTaxonomyArgs(
        { key: "cc" },
        { defaultTimeoutMs: 15000 }
      ),
    /taxonomy_id is required/
  );
  assert.throws(
    () =>
      buildJudilibreTaxonomyArgs(
        { taxonomy_id: "jurisdiction", key: "cc", value: "Cour de cassation" },
        { defaultTimeoutMs: 15000 }
      ),
    /mutually exclusive/
  );
});

test("Judilibre URL builder repeats array filters", () => {
  const url = buildJudilibreUrl("https://example.test/judilibre", "/search", {
    query: "faute",
    jurisdiction: ["cc", "ca"],
    resolve_references: "true"
  });

  assert.equal(url.pathname, "/judilibre/search");
  assert.equal(url.searchParams.get("query"), "faute");
  assert.deepEqual(url.searchParams.getAll("jurisdiction"), ["cc", "ca"]);
  assert.equal(url.searchParams.get("resolve_references"), "true");
});

test("Judilibre normalizers compact search results and extract decision zones", () => {
  const search = normalizeJudilibreSearchResponse({
    total: 1,
    page: 0,
    page_size: 10,
    results: [
      {
        id: "decision-123",
        jurisdiction: "cc",
        chamber: "civ1",
        decision_date: "2024-02-01",
        solution: "cassation",
        text: "not included in search summary",
        highlights: {
          text: ["<em>faute</em> contractuelle"],
          empty: []
        }
      }
    ]
  });

  assert.equal(search.total, 1);
  assert.equal(search.results[0].id, "decision-123");
  assert.equal(search.results[0].text, undefined);
  assert.deepEqual(search.results[0].highlights, {
    text: ["<em>faute</em> contractuelle"]
  });

  const text = "INTRO EXPOSE MOYENS MOTIFS DISPO ANNEXES";
  const decision = normalizeJudilibreDecision(
    {
      id: "decision-123",
      text,
      zones: {
        motivations: [{ start: text.indexOf("MOTIFS"), end: text.indexOf("MOTIFS") + 6 }],
        dispositif: [{ start: text.indexOf("DISPO"), end: text.indexOf("DISPO") + 5 }]
      }
    },
    { textScope: "motivations" }
  );

  assert.equal(decision.text_scope, "motivations");
  assert.deepEqual(decision.available_zones, ["motivations", "dispositif"]);
  assert.equal(decision.fragments.length, 1);
  assert.equal(decision.fragments[0].text, "MOTIFS");
});

test("Judilibre client requests and caches PISTE OAuth tokens", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/oauth/token")) {
      return new Response(
        JSON.stringify({
          access_token: "sandbox-token",
          expires_in: 3600
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };

  const client = new JudilibreClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    apiUrl: "https://example.test/cassation/judilibre/v1.0",
    tokenUrl: "https://example.test/api/oauth/token",
    fetchImpl
  });

  await client.search({
    params: { query: "faute", jurisdiction: ["cc", "ca"], page: 0, page_size: 5 },
    timeoutMs: 15000
  });
  await client.search({
    params: { query: "contrat", jurisdiction: ["cc"], page: 0, page_size: 5 },
    timeoutMs: 15000
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.body.get("grant_type"), "client_credentials");
  assert.equal(calls[0].options.body.get("client_id"), "client-id");
  assert.equal(calls[0].options.body.get("client_secret"), "client-secret");
  assert.equal(calls[0].options.body.get("scope"), "openid");
  assert.equal(calls[1].options.headers.Authorization, "Bearer sandbox-token");

  const firstSearchUrl = new URL(calls[1].url);
  assert.equal(firstSearchUrl.pathname, "/cassation/judilibre/v1.0/search");
  assert.deepEqual(firstSearchUrl.searchParams.getAll("jurisdiction"), ["cc", "ca"]);
});

test("Judilibre client can authenticate API requests with PISTE KeyId", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };

  const client = new JudilibreClient({
    apiKey: "sandbox-api-key",
    clientId: "unused-client-id",
    clientSecret: "unused-client-secret",
    apiUrl: "https://example.test/cassation/judilibre/v1.0",
    tokenUrl: "https://example.test/api/oauth/token",
    fetchImpl
  });

  await client.search({
    params: { query: "faute", jurisdiction: ["cc"], page: 0, page_size: 5 },
    timeoutMs: 15000
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.KeyId, "sandbox-api-key");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(new URL(calls[0].url).pathname, "/cassation/judilibre/v1.0/search");
});

test("Legifrance search args map case-law families to fonds and filters", () => {
  const administrative = buildLegifranceSearchArgs(
    {
      case_law_family: "administrative",
      query: "permis de construire",
      case_number: "428409",
      ecli: "ECLI:FR:CECHR:2020:428409.20200101",
      date_start: "2020-01-01",
      date_end: "2020-12-31",
      page: 0,
      page_size: 20
    },
    { maxPageSize: 50, defaultTimeoutMs: 15000 }
  );

  assert.equal(administrative.fond, "CETAT");
  assert.equal(administrative.family, "administrative");
  assert.equal(administrative.body.recherche.pageNumber, 1);
  assert.equal(administrative.body.recherche.pageSize, 20);
  assert.equal(administrative.body.recherche.champs[0].typeChamp, "NUM_DEC");
  assert.equal(administrative.body.recherche.filtres[0].facette, "DATE_DECISION");
  assert.equal(administrative.body.recherche.filtres[1].facette, "ECLI");

  const constitutional = buildLegifranceSearchArgs(
    { case_law_family: "constitutional", case_number: "2023-1067 QPC" },
    { maxPageSize: 50, defaultTimeoutMs: 15000 }
  );
  assert.equal(constitutional.fond, "CONSTIT");
  assert.equal(constitutional.body.recherche.champs[0].typeChamp, "NUM_DEC");

  const financial = buildLegifranceSearchArgs(
    { case_law_family: "financial", query: "gestion de fait" },
    { maxPageSize: 50, defaultTimeoutMs: 15000 }
  );
  assert.equal(financial.fond, "JUFI");
  assert.equal(financial.body.recherche.champs[0].typeChamp, "ALL");
});

test("Legifrance client prefers OAuth bearer authentication when credentials are available", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/oauth/token")) {
      return new Response(
        JSON.stringify({
          access_token: "legifrance-token",
          expires_in: 3600
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ totalResultNumber: 0, results: [] }), { status: 200 });
  };

  const client = new LegifranceClient({
    apiKey: "sandbox-api-key",
    clientId: "client-id",
    clientSecret: "client-secret",
    apiUrl: "https://example.test/dila/legifrance/lf-engine-app",
    tokenUrl: "https://example.test/api/oauth/token",
    fetchImpl
  });

  await client.search({
    body: { fond: "CETAT", recherche: { pageSize: 1 } },
    timeoutMs: 15000
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body.get("client_id"), "client-id");
  assert.equal(calls[1].options.headers.Authorization, "Bearer legifrance-token");
  assert.equal(calls[1].options.headers.KeyId, undefined);
});

test("Legifrance normalizers return unified result and decision shapes", () => {
  const search = normalizeLegifranceSearchResponse(
    {
      totalResultNumber: 1,
      results: [
        {
          titles: [
            {
              id: "CETATEXT000012345678",
              cid: "CETATEXT000012345678",
              title: "Conseil d'Etat, 1ere chambre"
            }
          ],
          text: "Extrait de la decision",
          sections: [
            {
              extracts: [
                {
                  searchFieldName: "Numéro décision",
                  values: ["428409"]
                }
              ]
            }
          ],
          ecli: "ECLI:FR:CECHR:2024:428409.20240110"
        }
      ]
    },
    { fond: "CETAT" }
  );

  assert.equal(search.case_law_family, "administrative");
  assert.equal(search.results[0].source, "legifrance");
  assert.equal(search.results[0].source_id, "CETATEXT000012345678");
  assert.equal(search.results[0].number, "428409");
  assert.equal(search.results[0].summary, "Extrait de la decision");

  const decision = normalizeLegifranceDecision(
    {
      result: {
        id: "CONSTITEXT000012345678",
        title: "Decision QPC",
        dateDecision: Date.parse("2024-02-01T00:00:00Z"),
        numDecision: "2023-1067 QPC",
        html: "<p>Vu la Constitution.</p><p>Decide.</p>"
      }
    },
    { fond: "CONSTIT", textScope: "full_text" }
  );

  assert.equal(decision.case_law_family, "constitutional");
  assert.equal(decision.source_id, "CONSTITEXT000012345678");
  assert.equal(decision.decision_date, "2024-02-01");
  assert.match(decision.text, /Vu la Constitution/);
  assert.doesNotMatch(decision.text, /<p>/);
});

test("Legifrance taxonomy exposes fonds, fields, filters, and sorts", () => {
  const fonds = getLegifranceCaseLawTaxonomy({ taxonomy_id: "fond" });
  assert.ok(fonds.some((fond) => fond.key === "CETAT" && fond.case_law_family === "administrative"));
  assert.ok(fonds.some((fond) => fond.key === "CONSTIT" && fond.case_law_family === "constitutional"));
  assert.ok(fonds.some((fond) => fond.key === "JUFI" && fond.case_law_family === "financial"));

  const filters = getLegifranceCaseLawTaxonomy({
    fond: "JUFI",
    taxonomy_id: "filter"
  });
  assert.ok(filters.some((filter) => filter.value === "JURIDICTION_NATURE"));
});

test("French case-law router sends non-judicial families directly to Legifrance", async () => {
  const calls = [];
  const router = new FrenchCaseLawRouter({
    judilibreClient: {
      search: async () => {
        throw new Error("Judilibre should not be called");
      }
    },
    legifranceClient: {
      search: async ({ body }) => {
        calls.push(body);
        return {
          totalResultNumber: 1,
          results: [{ id: "JUFINAL000012345678", title: "Cour des comptes", dateDecision: "2024-01-01" }]
        };
      }
    },
    maxPageSize: 50,
    defaultTimeoutMs: 15000
  });

  const response = await router.search({
    case_law_family: "financial",
    query: "gestion de fait",
    page_size: 5
  });

  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fond, "JUFI");
  assert.equal(response.data.sources_attempted[0].source, "legifrance");
  assert.equal(response.data.results[0].case_law_family, "financial");
});

test("French case-law router falls back from Judilibre to Legifrance when no exact judicial match exists", async () => {
  const calls = [];
  const router = new FrenchCaseLawRouter({
    judilibreClient: {
      search: async () => ({
        total: 1,
        results: [{ id: "6079a8649ba5988459c4d151", number: "94-86.039", decision_date: "1996-03-27" }]
      })
    },
    legifranceClient: {
      search: async ({ body }) => {
        calls.push(body);
        return {
          totalResultNumber: 1,
          results: [{ id: "JURITEXT000012345678", numAffaire: "95-00.001", dateDecision: "1997-01-01" }]
        };
      }
    },
    maxPageSize: 50,
    defaultTimeoutMs: 15000
  });

  const response = await router.search({
    case_law_family: "judicial",
    case_number: "95-00.001",
    decision_date: "1997-01-01"
  });

  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    response.data.sources_attempted.map((attempt) => attempt.source),
    ["judilibre", "legifrance"]
  );
  assert.equal(response.data.results.some((result) => result.source === "legifrance"), true);
});

test("formatEurLexHttpError clarifies WS_QUERY_SYNTAX_ERROR", () => {
  const faultXml =
    "<?xml version='1.0' encoding='UTF-8'?><S:Envelope xmlns:S='http://www.w3.org/2003/05/soap-envelope'><S:Body><ns1:Fault xmlns:ns1='http://www.w3.org/2003/05/soap-envelope'><ns1:Code><ns1:Value>ns1:Sender</ns1:Value><ns1:Subcode><ns1:Value xmlns:ns2='http://eur-lex.europa.eu/search'>ns2:WS_QUERY_SYNTAX_ERROR</ns1:Value></ns1:Subcode></ns1:Code><ns1:Reason><ns1:Text xml:lang='en'>Erreur a la ligne 1, caractere 8.</ns1:Text></ns1:Reason></ns1:Fault></S:Body></S:Envelope>";

  const message = formatEurLexHttpError(500, faultXml);
  assert.match(message, /Invalid EUR-Lex expert query syntax/i);
  assert.match(message, /DN = 32016R0679/);
});

test("EUR-Lex retry helper retries idle interval failures", async () => {
  let attempts = 0;
  const sleeps = [];
  const result = await withEurLexRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("EUR-Lex HTTP 500: ns1:Sender - The call must not be performed within the idle interval");
      }
      return "ok";
    },
    {
      retryDelaysMs: [5, 10],
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
      }
    }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [5]);
});

test("EUR-Lex retry helper does not retry syntax errors", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withEurLexRetry(
        async () => {
          attempts += 1;
          throw new Error("Invalid EUR-Lex expert query syntax.");
        },
        {
          retryDelaysMs: [5],
          sleep: async () => {}
        }
      ),
    /Invalid EUR-Lex expert query syntax/
  );
  assert.equal(attempts, 1);
  assert.equal(
    isRetryableEurLexError(new Error("EUR-Lex HTTP 503: Service Unavailable")),
    true
  );
});

test("extractArticleFromXhtml excludes recitals and returns article content", () => {
  const xhtml = `
    <div class="eli-subdivision" id="pbl_1">
      <div class="eli-subdivision" id="rct_1"><p class="oj-normal">(1) Recital text</p></div>
    </div>
    <div class="eli-subdivision" id="enc_1">
      <div class="eli-subdivision" id="art_8">
        <p class="oj-ti-art">Article 8</p>
        <div class="eli-title" id="art_8.tit_1"><p class="oj-sti-art">Titre article 8</p></div>
        <div><p class="oj-normal">Contenu article 8.</p></div>
      </div>
    </div>
  `;

  const article = extractArticleFromXhtml(xhtml, "8");
  assert.ok(article);
  assert.equal(article.article_id, "art_8");
  assert.match(article.text, /Contenu article 8/);
  assert.doesNotMatch(article.text, /Recital text/);
});

test("extractRecitalsFromXhtml returns preamble text", () => {
  const xhtml = `
    <div class="eli-subdivision" id="pbl_1">
      <div class="eli-subdivision" id="rct_1"><p class="oj-normal">(1) Recital text</p></div>
    </div>
    <div class="eli-subdivision" id="art_1"><p class="oj-ti-art">Article premier</p></div>
  `;

  const recitals = extractRecitalsFromXhtml(xhtml);
  assert.ok(recitals);
  assert.match(recitals.text, /Recital text/);
});

test("extractTocFromXhtml returns numbered chapter/article entries with titles", () => {
  const xhtml = `
    <div id="cpt_I">
      <p class="oj-ti-section-1">CHAPITRE I</p>
      <div class="eli-title" id="cpt_I.tit_1"><p>Dispositions générales</p></div>
      <div class="eli-subdivision" id="art_1">
        <p class="oj-ti-art">Article premier</p>
        <div class="eli-title" id="art_1.tit_1"><p>Objet</p></div>
      </div>
    </div>
  `;

  const toc = extractTocFromXhtml(xhtml);
  const chapter = toc.find((entry) => entry.id === "cpt_I");
  const article = toc.find((entry) => entry.id === "art_1");
  assert.ok(chapter);
  assert.equal(chapter.type, "chapter");
  assert.match(chapter.label, /CHAPITRE I/);
  assert.match(chapter.title, /Dispositions générales/i);
  assert.ok(article);
  assert.equal(article.type, "article");
  assert.match(article.label, /Article premier/i);
  assert.match(article.title, /Objet/i);
});
