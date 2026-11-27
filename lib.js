/* Legends League server library (stored in the sheet config as key "lib"; loaded by the thin n8n shells).
   Exports (by name): llState(rows, nowIso), llHandle(rows, body, isAdmin, nowIso).
   Sessions: confirmations for Thursday T open automatically at 09:00 America/Toronto on the Monday 10 days before (T minus 10 days), so two sessions can be open at once. */
function llCfg(rows) {
  var cfg = {}; var i; var r;
  for (i = 1; i < rows.length; i++) { r = rows[i]; if (r[3] === "config") { cfg[r[2]] = (r[4] === undefined ? "" : r[4]); } }
  return cfg;
}
function llPad(n) { return n < 10 ? "0" + n : String(n); }
function llEtNow(iso) {
  var parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  var o = {}; var i;
  for (i = 0; i < parts.length; i++) { o[parts[i].type] = parts[i].value; }
  if (o.hour === "24") { o.hour = "00"; }
  return { date: o.year + "-" + o.month + "-" + o.day, time: o.hour + ":" + o.minute };
}
function llAddDays(s, n) {
  var p = s.split("-");
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  return d.getUTCFullYear() + "-" + llPad(d.getUTCMonth() + 1) + "-" + llPad(d.getUTCDate());
}
function llJson(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }
function llSessions(cfg, nowIso) {
  var ladder = llJson(cfg.ladder, {});
  var lw = ladder.lw || 0; var ld = ladder.ld || "";
  var now = llEtNow(nowIso);
  var all = []; var k; var num = lw;
  if (ld) {
    for (k = 1; k <= 6; k++) {
      var T = llAddDays(ld, 7 * k);
      var ov = llJson(cfg["sess:" + T], {});
      var c = { id: T, date: ov.date || T, time: ov.time || "8:00 PM", maxCourts: Number(ov.max) || 0, opensDate: llAddDays(T, -10), cancelled: !!ov.cancel, keep: ov.keep || [], px: ov.px || {}, ropen: ov.ropen || "20:00", mcourts: ov.courts || null, week: null };
      if (!c.cancelled) { num++; c.week = num; }
      all.push(c);
    }
  }
  var open = []; var next = null; var i;
  for (i = 0; i < all.length; i++) {
    var s = all[i];
    if (s.cancelled) { continue; }
    var opened = (now.date > s.opensDate) || (now.date === s.opensDate && now.time >= "09:00");
    if (opened && now.date <= s.date) { open.push(s); }
    else if (!opened && !next) { next = s; }
  }
  return { all: all, open: open, next: next, lw: lw, ladder: ladder };
}
function llKeyOf(all, v) {
  var s = String(v); var i;
  if (s.length > 0 && s.length < 4 && String(Number(s)) === s) {
    for (i = 0; i < all.length; i++) { if (all[i].week === Number(s)) { return all[i].id; } }
  }
  return s;
}
function llCheckPlaces(players, places) {
  var i; var seen = {};
  if (!places || typeof places !== "object") { return "Please give every player a place."; }
  for (i = 0; i < players.length; i++) {
    var v = Number(places[players[i]]);
    if (!(v >= 1 && v <= players.length) || Math.floor(v) !== v) { return "Every player needs a place from 1st to " + players.length + "th."; }
    if (seen[v]) { return "Each place can only be used once."; }
    seen[v] = true;
  }
  if (Object.keys(places).length !== players.length) { return "The players do not match this court."; }
  return "";
}
function llNormPlaces(players, places) {
  var o = {}; var i;
  for (i = 0; i < players.length; i++) { o[players[i]] = Number(places[players[i]]); }
  return o;
}
function llState(rows, nowIso) {
  var cfg = llCfg(rows);
  var S = llSessions(cfg, nowIso);
  var now = llEtNow(nowIso);
  var roster = llJson(cfg.roster, []);
  var engine = null;
  try { if (cfg.engine) { engine = new Function(cfg.engine + " ; return llEngine;")(); } } catch (e1) { engine = null; }
  var byKey = {}; var i; var r;
  for (i = 1; i < rows.length; i++) {
    r = rows[i];
    if (r[3] === "result") {
      var rkey = llKeyOf(S.all, r[1]);
      var rb = byKey[rkey] || (byKey[rkey] = { last: {}, changes: {}, act: [], res: [] });
      var rp = llJson(r[4], null);
      if (rp && rp.court) { rb.res = rb.res || []; rb.res.push({ ts: r[0], by: r[2], court: rp.court, places: rp.places || {}, admin: !!rp.admin, clear: !!rp.clear }); }
      continue;
    }
    if (r[3] !== "confirm" && r[3] !== "cancel") { continue; }
    var key = llKeyOf(S.all, r[1]);
    var b = byKey[key] || (byKey[key] = { last: {}, changes: {}, act: [] });
    b.last[r[2]] = { action: r[3], ts: r[0] };
    b.changes[r[2]] = (b.changes[r[2]] || 0) + 1;
    b.act.push({ ts: r[0], player: r[2], action: r[3], src: r[4] || "" });
  }
  var sessions = [];
  var built = {};
  function mk(s) {
    var bk = byKey[s.id] || { last: {}, changes: {}, act: [], res: [] };
    var names = Object.keys(bk.last).filter(function (n) { return bk.last[n].action === "confirm"; });
    names.sort(function (a, c) { return bk.last[a].ts < bk.last[c].ts ? -1 : 1; });
    var plan = null;
    try {
      if (engine && S.ladder && S.ladder.p) {
        plan = engine(S.ladder, names, s.maxCourts, s.keep);
        if (s.week > S.lw + 1) { plan.notes.push("These courts use the rankings from before Week " + (S.lw + 1) + " results. They update automatically once those results are in."); }
      }
    } catch (e4) { plan = { error: String(e4 && e4.message ? e4.message : e4) }; }
    if (s.mcourts && plan && !plan.error) {
      var mkeys = Object.keys(s.mcourts).sort(); var mplay = [];
      plan.courts = mkeys.map(function (k) { return { name: k, players: s.mcourts[k].map(function (n) { mplay.push(n); var pr = S.ladder && S.ladder.p ? S.ladder.p[n] : null; return { name: n, rank: pr ? pr.r : null, guest: /^Guest/.test(n) }; }) }; });
      plan.playing = mplay; plan.notes = (plan.notes || []).concat(["Courts were set manually by the admin for this session."]);
    }
    return { id: s.id, week: s.week, date: s.date, time: s.time, maxCourts: s.maxCourts, px: s.px, confirmed: names, changes: bk.changes, plan: plan, activity: bk.act.slice(-30).reverse() };
  }
  for (i = 0; i < S.open.length; i++) { built[S.open[i].id] = mk(S.open[i]); sessions.push(built[S.open[i].id]); }
  var results = [];
  for (i = 0; i < S.all.length; i++) {
    var rs = S.all[i];
    if (rs.cancelled || !(rs.week > S.lw) || now.date < rs.date) { continue; }
    var ob = built[rs.id] || mk(rs);
    var rbk = byKey[rs.id] || { res: [] };
    var isOpen = now.date > rs.date || now.time >= rs.ropen;
    var rcourts = []; var allIn = true; var ci; var cj;
    var pl = ob.plan && !ob.plan.error ? ob.plan.courts : [];
    for (ci = 0; ci < pl.length; ci++) {
      var cname = pl[ci].name; var cpl = pl[ci].players.map(function (p) { return p.name; });
      var subs = (rbk.res || []).filter(function (x) { return x.court === cname; });
      var chosen = null; var conflicts = [];
      var lastClear = -1;
      for (cj = 0; cj < subs.length; cj++) { if (subs[cj].admin && subs[cj].clear) { lastClear = cj; } }
      subs = subs.slice(lastClear + 1).filter(function (x) { return !x.clear; });
      var adm = subs.filter(function (x) { return x.admin; });
      if (adm.length) { chosen = adm[adm.length - 1]; } else if (subs.length) { chosen = subs[0]; }
      for (cj = 0; cj < subs.length; cj++) { if (chosen && subs[cj] !== chosen && JSON.stringify(subs[cj].places) !== JSON.stringify(chosen.places)) { conflicts.push({ by: subs[cj].by, places: subs[cj].places, ts: subs[cj].ts }); } }
      if (!chosen) { allIn = false; }
      rcourts.push({ name: cname, players: cpl, done: !!chosen, by: chosen ? chosen.by : "", ts: chosen ? chosen.ts : "", admin: chosen ? chosen.admin : false, places: chosen ? chosen.places : null, conflicts: conflicts });
    }
    results.push({ id: rs.id, week: rs.week, date: rs.date, time: rs.time, open: isOpen, opensAt: rs.ropen, playing: ob.plan && !ob.plan.error ? ob.plan.playing : [], px: rs.px, courts: rcourts, allIn: rcourts.length > 0 && allIn });
  }
  var upcoming = [];
  for (i = 0; i < S.all.length; i++) { upcoming.push({ id: S.all[i].id, week: S.all[i].week, date: S.all[i].date, time: S.all[i].time, maxCourts: S.all[i].maxCourts, cancelled: S.all[i].cancelled, opensDate: S.all[i].opensDate }); }
  var f = sessions[0] || null;
  var nx = S.next ? { id: S.next.id, week: S.next.week, date: S.next.date, time: S.next.time, opensDate: S.next.opensDate } : null;
  return {
    sessions: sessions, results: results, next: nx, upcoming: upcoming, roster: roster, ladderLw: S.lw, lastProcessed: llJson(cfg.lastProcessed, null), autoProcess: cfg.autoProcess === "1", serverTime: nowIso,
    week: f ? f.week : null, date: f ? f.date : "", deadline: null, maxCourts: f ? f.maxCourts : 0, matchTime: f ? f.time : "",
    confirmed: f ? f.confirmed : [], changes: f ? f.changes : {}, courts: null, plan: f ? f.plan : null, activity: f ? f.activity : []
  };
}
function llHandle(rows, b, isAdmin, nowIso) {
  var cfg = llCfg(rows);
  var st = llState(rows, nowIso);
  var ts = nowIso; var add = [];
  function fail(msg) { return { append: false, out: { ok: false, error: msg, state: st } }; }
  function sessById(id) { var i; for (i = 0; i < st.sessions.length; i++) { if (st.sessions[i].id === id) { return st.sessions[i]; } } return null; }
  function sessByWeek(w) { var i; for (i = 0; i < st.sessions.length; i++) { if (st.sessions[i].week === Number(w)) { return st.sessions[i]; } } return null; }
  function candById(id) { var i; for (i = 0; i < st.upcoming.length; i++) { if (st.upcoming[i].id === id) { return st.upcoming[i]; } } return null; }
  function setOv(id, patch) {
    var ov = llJson(cfg["sess:" + id], {}); var k;
    for (k in patch) { ov[k] = patch[k]; }
    add.push([ts, "", "sess:" + id, "config", JSON.stringify(ov)]);
  }
  if (b.kind === "admin") {
    if (!isAdmin) { return fail("Wrong admin key"); }
    var op = b.op;
    if (op === "setLadder") {
      var L = b.ladder;
      if (!L || typeof L.lw !== "number" || typeof L.ld !== "string" || !L.p) { return fail("Ladder needs lw, ld and p"); }
      var ls = JSON.stringify(L);
      if (ls.length < 20 || ls.length > 45000) { return fail("Bad ladder size"); }
      add.push([ts, "", "ladder", "config", ls]);
    } else if (op === "setRoster") {
      if (!Array.isArray(b.roster)) { return fail("Roster must be a list"); }
      add.push([ts, "", "roster", "config", JSON.stringify(b.roster)]);
    } else if (op === "override") {
      var s1 = b.session ? sessById(b.session) : st.sessions[0];
      if (!s1) { return fail("No open session"); }
      if (st.roster.indexOf(b.player) < 0) { return fail("Unknown player"); }
      if (b.action !== "confirm" && b.action !== "cancel") { return fail("Bad action"); }
      add.push([ts, s1.id, b.player, b.action, "admin"]);
    } else if (op === "setMaxCourts") {
      var mc = Number(b.value);
      if (!candById(b.session)) { return fail("Unknown session"); }
      if (!(mc >= 0 && mc <= 12)) { return fail("Max courts must be 0 to 12"); }
      setOv(b.session, { max: Math.floor(mc) });
    } else if (op === "setMatchTime") {
      if (!candById(b.session)) { return fail("Unknown session"); }
      setOv(b.session, { time: String(b.value || "").slice(0, 20) });
    } else if (op === "moveSession") {
      if (!candById(b.session)) { return fail("Unknown session"); }
      var patch = {};
      if (b.date) { patch.date = String(b.date).slice(0, 10); }
      if (b.time) { patch.time = String(b.time).slice(0, 20); }
      setOv(b.session, patch);
    } else if (op === "cancelSession") {
      if (!candById(b.session)) { return fail("Unknown session"); }
      setOv(b.session, { cancel: b.value === false ? 0 : 1 });
    } else if (op === "setResult" || op === "clearResult") {
      var ar = null; var ai;
      for (ai = 0; ai < st.results.length; ai++) { if (st.results[ai].id === b.session) { ar = st.results[ai]; } }
      if (!ar) { return fail("No session is waiting for results."); }
      var ac = null; for (ai = 0; ai < ar.courts.length; ai++) { if (ar.courts[ai].name === b.court) { ac = ar.courts[ai]; } }
      if (!ac) { return fail("Unknown court."); }
      if (op === "setResult") {
        var achk = llCheckPlaces(ac.players, b.places);
        if (achk) { return fail(achk); }
        add.push([ts, ar.id, "admin", "result", JSON.stringify({ court: ac.name, places: llNormPlaces(ac.players, b.places), admin: true })]);
      } else { add.push([ts, ar.id, "admin", "result", JSON.stringify({ court: ac.name, admin: true, clear: true })]); }
    } else if (op === "setResultsOpen") {
      if (!candById(b.session)) { return fail("Unknown session"); }
      setOv(b.session, { ropen: String(b.value || "20:00").slice(0, 5) });
    } else if (op === "setKeep") {
      if (!candById(b.session)) { return fail("Unknown session"); }
      if (!Array.isArray(b.names)) { return fail("names must be a list"); }
      setOv(b.session, { keep: b.names.slice(0, 12) });
    } else if (op === "setPhysical") {
      if (!candById(b.session)) { return fail("Unknown session"); }
      if (!b.map || typeof b.map !== "object") { return fail("map must be an object of name to court number"); }
      var pxm = {}; var pk;
      for (pk in b.map) { if (st.roster.indexOf(pk) >= 0 && Number(b.map[pk]) > 0) { pxm[pk] = Math.floor(Number(b.map[pk])); } }
      setOv(b.session, { px: pxm });
    } else if (op === "process" || op === "applyProcess") {
      var pr = null; var pi;
      for (pi = 0; pi < st.results.length; pi++) { if (st.results[pi].id === b.session) { pr = st.results[pi]; } }
      if (!pr) { return fail("No session is waiting for results."); }
      var lad = llJson(cfg.ladder, null);
      if (!lad || !lad.p) { return fail("No ladder loaded."); }
      if (pr.week !== lad.lw + 1) { return fail("Week " + pr.week + " cannot be processed yet. The ladder is at Week " + lad.lw + "."); }
      if (!pr.allIn) { return fail("Not every League Court has results yet."); }
      var rp2 = llRunProcess(lad, pr, ts);
      if (op === "process") { return { append: false, out: { ok: true, preview: rp2.summ, flags: rp2.flags, state: st } }; }
      rp2.rows.forEach(function (x) { add.push(x); });
    } else if (op === "setAutoProcess") {
      add.push([ts, "", "autoProcess", "config", b.value ? "1" : "0"]);
    } else if (op === "revertProcess") {
      var rp = llJson(cfg.lastProcessed, null);
      if (!rp) { return fail("Nothing to revert."); }
      var prevL = llJson(cfg["ladder_prev:" + (rp.week - 1)], null);
      if (!prevL) { return fail("No snapshot for Week " + (rp.week - 1) + "."); }
      add.push([ts, "", "ladder", "config", JSON.stringify(prevL)]);
      add.push([ts, "", "lastProcessed", "config", ""]);
    } else if (op === "setCourts") {
      if (!candById(b.session)) { return fail("Unknown session"); }
      if (!b.courts || typeof b.courts !== "object") { return fail("courts must be an object of court letter to names"); }
      var cc = {}; var ck; var cn;
      for (ck in b.courts) { cc[ck] = []; for (cn = 0; cn < b.courts[ck].length; cn++) { var nm = String(b.courts[ck][cn]); if (!/^Guest/.test(nm) && st.roster.indexOf(nm) < 0) { return fail("Unknown player " + nm); } cc[ck].push(nm); } if (cc[ck].length < 1 || cc[ck].length > 4) { return fail("Each court needs 1 to 4 players"); } }
      setOv(b.session, { courts: cc });
    } else if (op === "clearCourts") {
      if (!candById(b.session)) { return fail("Unknown session"); }
      setOv(b.session, { courts: null });
    } else if (op === "check") {
      return { append: false, out: { ok: true, state: st } };
    } else { return fail("Unknown admin op"); }
  } else if (b.kind === "result") {
    var rr = null; var ri;
    for (ri = 0; ri < st.results.length; ri++) { if (st.results[ri].id === b.session) { rr = st.results[ri]; } }
    if (!rr) { return fail("There is no session waiting for results right now."); }
    if (!rr.open) { return fail("Results open on game day at " + rr.opensAt + " ET."); }
    if (b.player && rr.playing.indexOf(b.player) < 0) { return fail("Only players who played this session can record results."); }
    var who = b.player || "Players";
    var rc = null; for (ri = 0; ri < rr.courts.length; ri++) { if (rr.courts[ri].name === b.court) { rc = rr.courts[ri]; } }
    if (!rc) { return fail("Unknown court."); }
    var chk = llCheckPlaces(rc.players, b.places);
    if (chk) { return fail(chk); }
    if (rc.done) {
      if (JSON.stringify(llNormPlaces(rc.players, b.places)) === JSON.stringify(llNormPlaces(rc.players, rc.places))) { return { append: false, out: { ok: true, state: st, note: "Already recorded" } }; }
      add.push([ts, rr.id, who, "result", JSON.stringify({ court: rc.name, places: llNormPlaces(rc.players, b.places) })]);
      var st2 = llState(rows.concat(add), nowIso);
      return { append: true, rows: add, out: { ok: false, error: "League Court " + rc.name + " was already recorded.  Your entry differs, so Ben will review it.", state: st2 } };
    }
    add.push([ts, rr.id, who, "result", JSON.stringify({ court: rc.name, places: llNormPlaces(rc.players, b.places) })]);
    if (cfg.autoProcess === "1") {
      var st3 = llState(rows.concat(add), nowIso); var rr3 = null; var r3;
      for (r3 = 0; r3 < st3.results.length; r3++) { if (st3.results[r3].id === rr.id) { rr3 = st3.results[r3]; } }
      var lad3 = llJson(cfg.ladder, null);
      if (rr3 && rr3.allIn && lad3 && lad3.p && rr3.week === lad3.lw + 1) { llRunProcess(lad3, rr3, ts).rows.forEach(function (x) { add.push(x); }); }
    }
  } else if (b.kind === "confirm" || b.kind === "cancel") {
    var p = b.player;
    if (st.roster.indexOf(p) < 0) { return fail("Unknown player"); }
    var s2 = b.session ? sessById(b.session) : (b.week !== undefined ? sessByWeek(b.week) : st.sessions[0]);
    if (!s2) { return fail("That session is not open for confirmations. Please refresh the page."); }
    var isIn = s2.confirmed.indexOf(p) >= 0;
    if ((b.kind === "confirm" && isIn) || (b.kind === "cancel" && !isIn)) { return { append: false, out: { ok: true, state: st, note: "No change needed" } }; }
    if ((s2.changes[p] || 0) >= 8) { return fail("Too many changes for this player. Please contact Ben."); }
    add.push([ts, s2.id, p, b.kind, "public"]);
  } else { return fail("Unknown request"); }
  var ns = llState(rows.concat(add), nowIso);
  return { append: add.length > 0, rows: add, out: { ok: true, state: ns } };
}

/* Legends League results processing engine (two-step order, Rulebook sections 2-6).
   llProcess(ladder, week, courts) -> { ladder, rows, step1, flags, summary }
   ladder: { lw, ld, p:{Name:{r,b,s,f,lp,au}} }; courts: [{name, players:[names], places:{name:1..4}}] */
function llProcess(ladder, week, courts, opts) {
  opts = opts || {};
  var P = ladder.p; var names = Object.keys(P); var flags = []; var i; var j; var n;
  var played = {}; var info = {}; // name -> {court, place, ci}
  for (i = 0; i < courts.length; i++) { for (j = 0; j < courts[i].players.length; j++) { n = courts[i].players[j]; if (/^Guest/.test(n)) { continue; } played[n] = true; var lg = courts[i].players.filter(function (y) { return !/^Guest/.test(y) && courts[i].places[y] < courts[i].places[n]; }).length + 1; info[n] = { court: courts[i].name, place: lg, ci: i }; } }
  var seq = names.slice().sort(function (a, b) { return P[a].r - P[b].r; });
  var why = {}; function addWhy(nm, t) { (why[nm] = why[nm] || []).push(t); }
  var oldRank = {}; seq.forEach(function (x, k) { oldRank[x] = k + 1; });
  // outsiders (not part of the waterfall): unknown players, New-status players, and Inactive players who played
  var outsiders = [];
  Object.keys(played).forEach(function (nm) {
    if (!P[nm]) {
      P[nm] = { r: seq.length + 1, b: seq.length + 1, s: "New", f: [], lp: 0, au: 0 };
      seq.push(nm); oldRank[nm] = null; flags.push(nm + " is not on the ladder. Joins at the bottom of the active players as New.");
    }
  });
  seq.forEach(function (nm) { if (P[nm].s === "New" || (P[nm].s === "Locked" && played[nm])) { outsiders.push(nm); } });
  outsiders.forEach(function (nm) {
    if (P[nm].s === "Locked") { addWhy(nm, "Played again, so leaves the Inactive block and re-enters at the bottom of the active players. The block moves down one place."); flags.push(nm + " was Inactive and played. Re-entered at the bottom, please confirm."); }
  });
  // ---- Step 1: status pipeline and penalty waterfall
  var newS = {}; var pen = {};
  seq.forEach(function (nm) {
    var s = P[nm].s;
    if (played[nm]) { newS[nm] = "Active"; if (s !== "Active" && s !== "New" && s !== "Locked") { addWhy(nm, "Played, so back to Active (was " + s + ")."); } return; }
    if (s === "Locked") { newS[nm] = "Locked"; return; }
    if (s === "New") { newS[nm] = "Active"; flags.push(nm + " was New and did not play. Treated as Active with no miss, please confirm."); return; }
    if (s === "Active") { newS[nm] = "Grace"; addWhy(nm, "Missed: Active to Grace, rank held."); }
    else if (s === "Grace") { newS[nm] = "At Risk"; addWhy(nm, "Missed again: Grace to At Risk, rank held."); }
    else { newS[nm] = "Penalty"; pen[nm] = true; }
  });
  // locked anchors by absolute position; active sequence is everything else (outsiders are appended after the waterfall)
  var anchors = {}; var act = []; var tail = [];
  var lockedPos = []; seq.forEach(function (nm, k) { if (newS[nm] === "Locked") { anchors[k] = nm; } else if (outsiders.indexOf(nm) >= 0) { tail.push(nm); } else { act.push(nm); } });
  var lockedAbove = false; var seenLocked = false;
  seq.forEach(function (nm) { if (newS[nm] === "Locked") { seenLocked = true; } else if (seenLocked && outsiders.indexOf(nm) < 0) { lockedAbove = true; } });
  if (lockedAbove) { flags.push("An inactive player sits above an active player. The block is not at the bottom, please check."); }
  var w = act.slice();
  var origPen = act.filter(function (x) { return pen[x]; });
  // contiguous blocks in original order
  var blocks = []; var cur = null;
  act.forEach(function (x) { if (pen[x]) { if (cur) { cur.push(x); } else { cur = [x]; blocks.push(cur); } } else { cur = null; } });
  blocks.forEach(function (blk) {
    var start = w.indexOf(blk[0]); var k = blk.length; var found = []; var idx;
    for (idx = start + k; idx < w.length && found.length < 2; idx++) { if (!pen[w[idx]]) { found.push(w[idx]); } }
    if (!found.length) { blk.forEach(function (b) { addWhy(b, "Penalty drop: no room below, rank held."); }); return; }
    var after = found[found.length - 1];
    w.splice(start, k);
    var at = w.indexOf(after) + 1;
    Array.prototype.splice.apply(w, [at, 0].concat(blk));
    blk.forEach(function (b) { addWhy(b, "Penalty drop: falls past " + found.join(" & ") + (found.length < 2 ? " (room limited)." : ".")); });
    found.forEach(function (f2) { addWhy(f2, "Climbs as " + blk.join(" & ") + " falls past."); });
  });
  // leapfrog safety
  var slots = []; w.forEach(function (x, k) { if (pen[x]) { slots.push(k); } });
  slots.forEach(function (sl, k) { w[sl] = origPen[k]; });
  function build(arr) { /* locked players occupy the bottom slots in their order */ var lk = seq.filter(function (x) { return newS[x] === "Locked"; }); return arr.concat(lk); }
  function build_old(arr) { var out = []; var ai = 0; var total = arr.length + Object.keys(anchors).length; var k; for (k = 0; k < total; k++) { if (anchors[k]) { out.push(anchors[k]); } else { out.push(arr[ai++]); } } return out; }
  var s1 = build(w.concat(tail)); var step1 = {}; s1.forEach(function (x, k) { step1[x] = k + 1; });
  // ---- Step 2: same-court leapfrog on the step-1 order
  var s2 = s1.slice();
  var order = []; courts.forEach(function (c) { c.players.slice().sort(function (a, b) { return c.places[a] - c.places[b]; }).forEach(function (x) { if (!/^Guest/.test(x)) { order.push({ x: x, c: c }); } }); });
  order.forEach(function (o) {
    var x = o.x; var c = o.c; var beaten = c.players.filter(function (y) { return y !== x && !/^Guest/.test(y) && c.places[y] > c.places[x] && step1[y] < step1[x]; });
    if (!beaten.length) { return; }
    beaten.sort(function (a, b) { return step1[a] - step1[b]; });
    var tgt = beaten[0]; var xi = s2.indexOf(x); var ti = s2.indexOf(tgt);
    if (xi < ti) { return; }
    s2.splice(xi, 1); s2.splice(s2.indexOf(tgt), 0, x);
    addWhy(x, "Finished " + c.places[x] + " on League Court " + c.name + ", out-placing " + beaten.join(" & ") + ": moves directly above " + tgt + ".");
  });
  // ---- build new ladder
  var NL = { lw: week, ld: opts.date || ladder.ld, p: {} }; var rows = [];
  s2.forEach(function (nm, k) {
    var o = P[nm]; var r = k + 1; var f = (o.f || []).slice();
    if (info[nm] && info[nm].place) { f.push([info[nm].place, info[nm].ci, week]); f = f.slice(-2); }
    NL.p[nm] = { r: r, b: Math.min(o.b || r, r), s: newS[nm], f: f, lp: played[nm] ? week : o.lp, au: o.au || 0 };
    var prev = oldRank[nm]; var tr = prev === null ? "New" : (r === prev ? "=" : (r < prev ? "up " + (prev - r) : "down " + (r - prev)));
    var det = (why[nm] || []).join(" ");
    if (!det && newS[nm] === "Locked" && prev !== null && r !== prev) { var nw = Object.keys(played).filter(function (q) { return oldRank[q] === null || P[q].s === "New"; }); det = "Inactive block moves " + (r > prev ? "down" : "up") + " one place as " + (nw.length ? nw.join(" & ") : "a returning player") + " joins above it."; }
    if (!det) { det = prev !== null && r !== prev ? "Moves " + (r < prev ? "up" : "down") + " as others ahead or behind change places." : (played[nm] ? "Played, no rank movement." : (newS[nm] === "Locked" ? "Inactive, rank held." : "Rank held.")); }
    if (info[nm] && info[nm].place === 1 && !/Finished 1/.test(det)) { det = "1st on League Court " + info[nm].court + ". " + det; }
    rows.push({ rank: r, name: nm, prev: prev, trend: tr, status: newS[nm], detail: det, court: info[nm] ? info[nm].court : "", place: info[nm] ? info[nm].place : null });
  });
  return { ladder: NL, rows: rows, step1: step1, flags: flags, week: week };
}

function llSummary(lad, out, courts, pr, ts) {
  var rows = out.rows; var winners = []; var i; var byName = {};
  rows.forEach(function (r) { byName[r.name] = r; });
  courts.forEach(function (c) { var w = null; var bp = 99; c.players.forEach(function (n) { if (!/^Guest/.test(n) && c.places[n] < bp) { bp = c.places[n]; w = n; } }); if (w) { var r = byName[w]; winners.push({ name: w, court: c.name, prev: r.prev, rank: r.rank, players: c.players.slice().sort(function (a, b) { return c.places[a] - c.places[b]; }) }); } });
  var moves = rows.filter(function (r) { return r.prev !== null && r.prev !== r.rank; });
  var up = moves.filter(function (r) { return r.rank < r.prev; }).sort(function (a, b) { return (b.prev - b.rank) - (a.prev - a.rank); }).slice(0, 5).map(function (r) { return { name: r.name, prev: r.prev, rank: r.rank }; });
  var down = moves.filter(function (r) { return r.rank > r.prev; }).sort(function (a, b) { return (b.rank - b.prev) - (a.rank - a.prev); }).slice(0, 5).map(function (r) { return { name: r.name, prev: r.prev, rank: r.rank }; });
  var top = rows.slice(0, 5).map(function (r) { return { name: r.name, prev: r.prev, rank: r.rank }; });
  var pen = rows.filter(function (r) { return r.status === "Penalty" && r.detail.indexOf("Penalty drop") >= 0; }).map(function (r) { return r.name; });
  return { week: pr.week, date: pr.date, ts: ts, winners: winners, risers: up, fallers: down, top: top, penalized: pen, played: rows.filter(function (r) { return r.place; }).length, rows: rows.map(function (r) { return { rank: r.rank, name: r.name, prev: r.prev, trend: r.trend, status: r.status, detail: r.detail, court: r.court, place: r.place }; }), flags: out.flags };
}

function llRunProcess(lad, rr, ts) {
  var pcourts = rr.courts.map(function (c) { return { name: c.name, players: c.players, places: c.places }; });
  var out2 = llProcess(JSON.parse(JSON.stringify(lad)), rr.week, pcourts, { date: rr.date });
  var summ = llSummary(lad, out2, pcourts, rr, ts);
  var rowsAdd = [[ts, "", "ladder_prev:" + lad.lw, "config", JSON.stringify(lad)], [ts, "", "ladder", "config", JSON.stringify(out2.ladder)], [ts, "", "lastProcessed", "config", JSON.stringify(summ)]];
  return { summ: summ, flags: out2.flags, rows: rowsAdd };
}
