function VJD_AUTOFILL(P) {
  /* Visa Job Desk autofill. Runs only when the person clicks the bookmark on a
     job application page. Fills empty fields from their saved profile, never
     overwrites what is already typed, never touches passwords or file uploads,
     and never submits. */
  var host = location.hostname;
  var BOX_ID = "vjd-autofill-box";
  function box(html) {
    var old = document.getElementById(BOX_ID);
    if (old) old.remove();
    var d = document.createElement("div");
    d.id = BOX_ID;
    d.setAttribute("role", "status");
    d.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;background:#14213d;color:#fff;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:14px 16px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.3)";
    d.innerHTML = html + '<div style="margin-top:10px;text-align:right"><button type="button" style="background:#4fb3b0;color:#0b1220;border:0;border-radius:5px;padding:6px 12px;font:inherit;cursor:pointer">Close</button></div>';
    d.querySelector("button").onclick = function () { d.remove(); };
    document.body.appendChild(d);
  }
  if (/(^|\.)(linkedin|indeed)\.com$/.test(host)) {
    box("<b>Autofill is off on " + (host.indexOf("linkedin") >= 0 ? "LinkedIn" : "Indeed") + ".</b><br>Their terms ban automated filling. Copy your answers from Visa Job Desk, or apply on the company's own careers site.");
    return;
  }

  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function textOf(n) { return n ? (n.innerText || n.textContent || "") : ""; }
  function esc(id) { return window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"'); }
  function labelText(el) {
    var parts = [];
    if (el.id) {
      var l = document.querySelector('label[for="' + esc(el.id) + '"]');
      if (l) parts.push(textOf(l));
    }
    var wrap = el.closest("label");
    if (wrap) parts.push(textOf(wrap));
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    var lb = el.getAttribute("aria-labelledby");
    if (lb) lb.split(/\s+/).forEach(function (id) { var n = document.getElementById(id); if (n) parts.push(textOf(n)); });
    var fs = el.closest("fieldset");
    if (fs) { var lg = fs.querySelector("legend"); if (lg) parts.push(textOf(lg)); }
    parts.push(el.name || "", el.id || "", el.placeholder || "", el.getAttribute("autocomplete") || "");
    if (parts.join("").replace(/[\s_\-\[\]0-9]/g, "").length < 4) {
      var c = el.parentElement, hops = 0;
      while (c && hops < 4) {
        var t = textOf(c);
        if (t && t.length < 300 && t.replace(/\s/g, "").length > 3) { parts.push(t); break; }
        c = c.parentElement; hops++;
      }
    }
    return norm(parts.join(" | "));
  }

  var YES = /^\s*yes\b/i, NO = /^\s*no\b/i;
  var DECLINE = /decline|don.?t wish|do not wish|prefer not|not to (say|answer|disclose|self.?identify)|choose not|rather not/i;
  var authNoSponsor = P.auth === "Yes" && P.honest === "No" ? "Yes" : "No";

  /* first matching rule wins; kind: text | yesno | decline | choice */
  var RULES = [
    [/sponsor/, function (l) { return /authori[sz]ed|eligible|legally/.test(l) && /without/.test(l) ? authNoSponsor : P.honest; }, "yesno"],
    [/(legally )?authori[sz]ed to work|eligible to work|right to work|work authori[sz]ation|legally (able|permitted) to work/, function () { return P.auth; }, "yesno"],
    [/visa (type|status)|immigration status|current (work )?status in/, function () { return P.route; }, "choice"],
    [/security clearance|clearance/, function () { return P.clearance; }, "yesno"],
    [/\bgender\b|\bsex\b|pronoun/, null, "decline"],
    [/\brace\b|ethnic|hispanic|latin[oa]/, null, "decline"],
    [/veteran|military/, null, "decline"],
    [/disabilit/, null, "decline"],
    [/cover letter/, function () { return P.cover; }, "text"],
    [/first[\s_\-]?name|given[\s_\-]?name|fname|given-name/, function () { return P.first; }, "text"],
    [/last[\s_\-]?name|surname|family[\s_\-]?name|lname|family-name/, function () { return P.last; }, "text"],
    [/e-?mail/, function () { return P.email; }, "text"],
    [/phone|mobile|\btel\b/, function () { return P.phone; }, "text"],
    [/linkedin/, function () { return P.linkedin; }, "text"],
    [/github/, function () { return P.github; }, "text"],
    [/website|portfolio|personal (site|url)|other url|\burl\b/, function () { return P.website; }, "text"],
    [/years of (relevant |professional )?experience|how many years/, function () { return P.years; }, "choice"],
    [/salary|compensation|pay expectation|desired pay/, function () { return P.salary; }, "text"],
    [/start date|notice period|when can you start|earliest (start|available)|availability to start/, function () { return P.notice; }, "text"],
    [/current (company|employer)|most recent (company|employer)|company name|\bemployer\b/, function () { return P.company; }, "text"],
    [/current (job )?(title|role|position)|most recent (title|role)|job title/, function () { return P.title; }, "text"],
    [/school|university|college|institution/, function () { return P.school; }, "choice"],
    [/\bdegree\b/, function () { return P.degree; }, "choice"],
    [/discipline|field of study|\bmajor\b|area of study/, function () { return P.discipline; }, "choice"],
    [/graduation|grad(uation)? year|year (of )?(graduation|completed)/, function () { return P.gradYear; }, "choice"],
    [/zip|postal/, function () { return P.zip; }, "text"],
    [/\bcountry\b/, function () { return P.country; }, "choice"],
    [/\bstate\b|province|region/, function () { return /authori|sponsor|united states/.test(arguments[0]) ? "" : P.state; }, "choice"],
    [/\bcity\b|location|where (are you|do you) (based|located|live)|current address/, function () { return P.location; }, "text"],
    [/full[\s_\-]?name|your name|legal name|^name\b|\bname$/, function (l) { return /company|school|employer|university|referr|manager|recruit/.test(l) ? "" : P.full; }, "text"]
  ];

  function ruleFor(label) {
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i][0].test(label)) {
        var v = RULES[i][1] ? RULES[i][1](label) : "";
        return { kind: RULES[i][2], value: v };
      }
    }
    return null;
  }
  function setNative(el, value) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function mark(el) { el.style.outline = "2px solid #0f6a6c"; el.style.outlineOffset = "1px"; filled++; }
  function pickOption(texts, rule) {
    var want = String(rule.value || "");
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      if (rule.kind === "decline" && DECLINE.test(t)) return i;
      if (rule.kind === "yesno" && want === "Yes" && YES.test(t)) return i;
      if (rule.kind === "yesno" && want === "No" && NO.test(t)) return i;
    }
    if (rule.kind === "choice" || (rule.kind === "yesno" && want && want !== "Yes" && want !== "No")) {
      var w = norm(want);
      if (!w) return -1;
      for (var j = 0; j < texts.length; j++) if (norm(texts[j]) === w) return j;
      for (var k = 0; k < texts.length; k++) { var n = norm(texts[k]); if (n && (n.indexOf(w) >= 0 || w.indexOf(n) >= 0) && n.length > 1) return k; }
      var level = (w.match(/bachelor|master|doctor|ph\.?d|associate|high school|mba/) || [])[0];
      if (level) {
        var lv = level === "ph.d" || level === "phd" ? "doctor|ph\\.?d" : level === "mba" ? "mba|master" : level;
        var lre = new RegExp(lv);
        for (var q = 0; q < texts.length; q++) if (lre.test(norm(texts[q]))) return q;
      }
      var num = parseFloat(want);
      if (!isNaN(num)) {
        for (var m = 0; m < texts.length; m++) {
          var r = texts[m].match(/(\d+)\s*(?:-|–|to)\s*(\d+)/), plus = texts[m].match(/(\d+)\s*\+/);
          if (r && num >= +r[1] && num <= +r[2]) return m;
          if (plus && num >= +plus[1]) return m;
        }
      }
    }
    return -1;
  }

  var filled = 0, needsYou = 0;
  var fields = Array.prototype.slice.call(document.querySelectorAll("input, textarea, select"));
  var radioGroups = {};
  fields.forEach(function (el) {
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (el.disabled || el.readOnly || type === "hidden" || type === "password" || type === "file" || type === "submit" || type === "button" || type === "search" || type === "checkbox") return;
    if (el.offsetParent === null && type !== "radio") return;
    if (type === "radio") {
      var key = el.name || el.id;
      (radioGroups[key] = radioGroups[key] || []).push(el);
      return;
    }
    var label = labelText(el);
    var rule = ruleFor(label);
    if (!rule) { if (el.required && !el.value) needsYou++; return; }
    if (el.tagName === "SELECT") {
      if (el.selectedIndex > 0 && el.value) return;
      var texts = Array.prototype.map.call(el.options, function (o) { return o.text; });
      var idx = pickOption(texts, rule);
      if (idx > 0 || (idx === 0 && el.options[0].value)) { el.selectedIndex = idx; setNative(el, el.options[idx].value); mark(el); }
      else if (el.required) needsYou++;
      return;
    }
    if (el.value) return;
    var v = rule.kind === "decline" ? "" : String(rule.value || "");
    if (!v) { if (el.required) needsYou++; return; }
    if (rule.kind === "yesno" && el.tagName === "INPUT" && type !== "text" && type !== "") return;
    setNative(el, v);
    mark(el);
  });
  Object.keys(radioGroups).forEach(function (key) {
    var group = radioGroups[key];
    if (group.some(function (r) { return r.checked; })) return;
    var first = group[0];
    var label = "";
    var fs = first.closest("fieldset");
    if (fs) { var lg = fs.querySelector("legend"); if (lg) label = textOf(lg); }
    if (!label) {
      var c = first.parentElement, hops = 0;
      while (c && hops < 5 && !label) {
        var t = textOf(c);
        if (t && t.replace(/\s/g, "").length > 12 && t.length < 400) label = t;
        c = c.parentElement; hops++;
      }
    }
    label = norm(label + " " + (first.name || ""));
    var rule = ruleFor(label);
    if (!rule) { if (first.required) needsYou++; return; }
    var texts = group.map(function (r) { return norm(labelOfRadio(r)); });
    var idx = pickOption(texts, rule);
    if (idx >= 0) { group[idx].click(); if (!group[idx].checked) group[idx].checked = true; group[idx].dispatchEvent(new Event("change", { bubbles: true })); mark(group[idx].closest("label") || group[idx]); }
    else if (first.required) needsYou++;
  });
  function labelOfRadio(r) {
    if (r.id) { var l = document.querySelector('label[for="' + esc(r.id) + '"]'); if (l) return textOf(l); }
    var w = r.closest("label"); if (w) return textOf(w);
    return r.value || r.getAttribute("aria-label") || "";
  }

  var embedded = Array.prototype.slice.call(document.querySelectorAll("iframe")).map(function (f) { return f.src || ""; })
    .filter(function (s) { return /greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|myworkdayjobs|icims|jobvite/.test(s); })[0];
  var msg = "<b>Visa Job Desk filled " + filled + " field" + (filled === 1 ? "" : "s") + "</b> (outlined in teal).";
  if (embedded && filled < 3) msg += "<br>The form sits inside a box from another site. <a href=\"" + embedded.replace(/"/g, "%22") + "\" target=\"_blank\" rel=\"noopener\" style=\"color:#4fb3b0\">Open it in its own tab</a> and click the bookmark there.";
  if (needsYou) msg += "<br>" + needsYou + " required field" + (needsYou === 1 ? " still needs" : "s still need") + " you.";
  msg += "<br>Check every answer, attach your resume yourself, then press Submit yourself.";
  box(msg);
}
