/* Sponsorship scan for job postings - a port of tools/sponsor_lookup.py
   check-posting (ai-job-search repo). Same phrase lists, same verdict rules. */
(function (root) {
  "use strict";

  var NEGATION = /\b(no|not|never|unable|cannot|can't|won't|will not|do not|does not|don't|doesn't|without)\b[^.;:!?]{0,30}$/i;

  var CITIZEN_ONLY = [
    /\b(u\.?\s?s\.?|united states)\s+citizens?\s+only\b/,
    /\bonly\s+(u\.?\s?s\.?|united states)\s+citizens\b/,
    /\bmust\s+be\s+(a\s+)?(u\.?\s?s\.?|united states)\s+citizen\b/,
    /\b(u\.?\s?s\.?|united states)\s+citizenship\s+(is\s+)?required\b/,
    /\brequires?\s+(u\.?\s?s\.?|united states)\s+citizenship\b/,
    /\b(u\.?\s?s\.?\s+)?citizens?\s+or\s+(lawful\s+)?permanent\s+residents?\s+only\b/,
    /\bgreen\s+card\s+holders?\s+only\b/,
    /\bonly\s+(u\.?\s?s\.?\s+)?(citizens|green\s+card\s+holders|permanent\s+residents)\b/
  ];
  var CLEARANCE = [
    /\b(active|current)\s+(secret|top\s+secret|ts(\/sci)?|public\s+trust)\b/,
    /\b(secret|top\s+secret|ts\/sci|ts\s*\/\s*sci|public\s+trust)\s+(security\s+)?clearance\b/,
    /\bsecurity\s+clearance\s+(is\s+)?required\b/,
    /\b(must|able\s+to)\s+(obtain|hold|maintain)\s+(a|an|the)?\s*(u\.?s\.?\s+)?(government\s+)?(security\s+)?clearance\b/,
    /\bclearance\s+(is\s+)?required\b/
  ];
  var NO_SPONSORSHIP = [
    /\b(not|unable\s+to|cannot|can't|won't|will\s+not|does\s+not|do\s+not|don't|doesn't)\s+(currently\s+)?(be\s+)?(able\s+to\s+)?(provide|offer|support|consider)?\s*(any\s+)?(employment\s+)?(visa\s+|work\s+)?sponsor(ship|ing|s)?\b/,
    /\b(will\s+not|do\s+not|does\s+not|don't|doesn't|won't)\s+(now\s+or\s+in\s+the\s+future\s+)?(currently\s+)?(require|need)\s+(visa\s+|employer\s+|employment\s+)?sponsorship\b/,
    /\bno\s+(employment\s+)?(visa\s+|work\s+)?sponsorship\b/,
    /\bsponsorship\s+(is\s+|will\s+)?(not|un)\s*(be\s+)?(available|provided|offered|possible|considered)\b/,
    /\bnot\s+eligible\s+for\s+(visa\s+)?sponsorship\b/,
    /\bwithout\s+(the\s+need\s+for\s+)?(current\s+or\s+future\s+|now\s+or\s+in\s+the\s+future\s+)?(visa\s+|employer\s+)?sponsorship\b/,
    /\b(must|need\s+to)\s+(be\s+)?(legally\s+)?authori[sz]ed\s+to\s+work\s+in\s+the\s+(u\.?s\.?|united\s+states)\s+(now\s+and\s+in\s+the\s+future\s+)?without\b/,
    /\bsponsorship\s+(is\s+)?not\s+(an\s+option|offered)\b/
  ];
  var POSITIVE = [
    /\b(visa\s+)?sponsorship\s+(is\s+)?(available|provided|offered|possible)\b/,
    /\b(will|can|do|does|happy\s+to|able\s+to|willing\s+to)\s+sponsor\b/,
    /\bwe\s+sponsor\b/,
    /\bsponsor(s|ing)?\s+(h-?1b|e-?3|visas?|work\s+visas?)\b/,
    /\bopen\s+to\s+(visa\s+)?sponsorship\b/,
    /\bh-?1b\s+transfers?\s+(welcome|accepted|considered)\b/,
    /\b(e-?3|h-?1b1?)\s+(visa\s+)?(holders?|candidates?)\s+(are\s+)?(welcome|encouraged|considered)\b/
  ];
  var CITIZEN_OR_AUTHORIZED = /[^.;]{0,40}?\bor\s+(be\s+|have\s+|hold\s+)?(an?\s+)?(legally\s+|otherwise\s+)?(authori[sz]|eligible|permitted|work\s+authori[sz]ation|valid\s+work)/iy;
  var QUESTION = /\b(will|do|would)\s+you\s+(now\s+or\s+in\s+the\s+future\s+)?(require|need)\s+(visa\s+|employer\s+)?sponsorship\b/i;
  var MENTIONS = {
    e3: /\be-?3\s+(visa|status|sponsorship|holders?|candidates?)\b|\be-?3\s*\(australia/i,
    h1b: /\bh-?1b\b(?!1)/i,
    h1b1: /\bh-?1b1\b/i,
    tn: /\btn\s+(visa|status)\b/i,
    opt: /\b(stem\s+)?opt\b(?![-\s]?(in|out)\b)|\bcpt\b/i
  };

  function quote(text, start, end) {
    var pad = 70;
    var snippet = text.slice(Math.max(0, start - pad), Math.min(text.length, end + pad));
    snippet = snippet.split(/\s+/).filter(Boolean).join(" ");
    return (start > pad ? "..." : "") + snippet + (end + pad < text.length ? "..." : "");
  }

  function scan(patterns, text, opts) {
    opts = opts || {};
    var hits = [];
    patterns.forEach(function (pattern) {
      var re = new RegExp(pattern.source, "gi");
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === "") { re.lastIndex++; continue; }
        var s = m.index, e = s + m[0].length;
        if (opts.orAuthorized) {
          CITIZEN_OR_AUTHORIZED.lastIndex = e;
          if (CITIZEN_OR_AUTHORIZED.test(text)) continue;
        }
        if (opts.negated && NEGATION.test(text.slice(Math.max(0, s - 40), s))) continue;
        if (opts.negated && /^\s+(is\s+|will\s+)?(not|un)/i.test(text.slice(e, e + 12))) continue;
        if (opts.question && QUESTION.test(text.slice(Math.max(0, s - 60), e + 10))) continue;
        hits.push({ start: s, end: e });
      }
    });
    hits.sort(function (a, b) { return a.start - b.start; });
    var unique = [], lastEnd = -1;
    hits.forEach(function (h) {
      if (h.start > lastEnd) { unique.push(h); lastEnd = h.end + 40; }
    });
    return unique;
  }

  /**
   * opts: { visa: "e3"|"h1b"|"h1b1"|"tn"|..., needsSponsorship: bool,
   *         noSponsorship: "drop"|"flag", hasClearance: bool }
   * returns { verdict: PASS|FAIL|FLAG|UNVERIFIED, findings, notes, asks, mentions }
   */
  function check(text, opts) {
    text = String(text || "");
    var visa = (opts.visa || "h1b").toLowerCase();
    var needs = !!opts.needsSponsorship;
    var citizen = scan(CITIZEN_ONLY, text, { orAuthorized: true });
    var clearance = scan(CLEARANCE, text);
    var negative = scan(NO_SPONSORSHIP, text, { question: true });
    var positive = scan(POSITIVE, text, { negated: true, question: true }).filter(function (p) {
      return !negative.some(function (n) { return n.start <= p.start && p.start <= n.end + 5; });
    });
    var findings = [];
    [["citizen_only", citizen], ["clearance", clearance], ["no_sponsorship", negative], ["sponsorship_offered", positive]]
      .forEach(function (pair) {
        pair[1].forEach(function (h) { findings.push({ category: pair[0], quote: quote(text, h.start, h.end) }); });
      });
    var asks = QUESTION.test(text);
    var mentions = {};
    Object.keys(MENTIONS).forEach(function (k) { mentions[k] = MENTIONS[k].test(text); });

    var notes = [], verdict;
    if (citizen.length) {
      verdict = "FAIL";
      notes.push("Citizens or permanent residents only. You can't take this job on a visa.");
    } else if (clearance.length && !opts.hasClearance) {
      verdict = "FAIL";
      notes.push("Needs a US security clearance, which requires citizenship.");
    } else if (negative.length && needs) {
      var refusals = findings.filter(function (f) { return f.category === "no_sponsorship"; });
      var h1bOnly = refusals.every(function (f) {
        return MENTIONS.h1b.test(f.quote) && !/\b(any|all|other)\b/i.test(f.quote);
      });
      var special = (visa === "e3" || visa === "h1b1") && h1bOnly;
      if (opts.noSponsorship === "flag" || special) {
        verdict = "FLAG";
        notes.push(special
          ? "The no-sponsorship line names H-1B only. " + (visa === "e3" ? "E-3" : "H-1B1") + " is a different, cheaper filing with no lottery. Ask the recruiter before ruling it out."
          : "The posting says it doesn't sponsor. Your profile says to flag these rather than drop them. Ask the recruiter.");
      } else {
        verdict = "FAIL";
        notes.push("The posting says it doesn't sponsor, and your profile says to drop these.");
      }
    } else if (positive.length) {
      verdict = "PASS";
      notes.push("The posting says sponsorship is available.");
    } else if (!needs) {
      verdict = "PASS";
    } else {
      verdict = "UNVERIFIED";
      notes.push("The posting doesn't mention sponsorship. Check the company's careers page or ask the recruiter before you spend time on it.");
    }
    if (asks && needs) notes.push("The application asks whether you'll need sponsorship. Answer exactly as your profile says.");
    if (mentions.e3 && visa === "e3") notes.push("The posting mentions the E-3 visa by name.");
    return { verdict: verdict, findings: findings, notes: notes, asks: asks, mentions: mentions };
  }

  /* Employer filing record -> Sponsor Strength (same thresholds as the repo tool). */
  var STRONG = { e3: 5, h1b: 25, h1b1: 5 };
  function sponsorScore(visa, filings, sameTitle) {
    var strong = STRONG[visa];
    if (!strong || filings === null || filings === undefined || isNaN(filings)) return null;
    var n = Math.max(0, Math.floor(filings));
    var verdict = n >= strong ? "Strong" : n >= 1 ? "Some history" : "None found";
    var score = verdict === "Strong" ? 90
      : verdict === "Some history" ? 55 + Math.floor(30 * Math.min(n, strong) / strong)
      : (visa === "h1b" ? 15 : 30);
    if (sameTitle && verdict !== "None found") score += 10;
    return { verdict: verdict, score: Math.min(100, score), strong: strong, filings: n };
  }

  var api = { check: check, sponsorScore: sponsorScore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SponsorCheck = api;
})(this);
