// BracketUtils.js
// Torneio eliminatório (mata-mata) 1v1 por cima do TournamentX.
// - Entrada: /tournamentx/:id/join  -> inscreve no bracket e devolve a sala (MatchmakerTag) da rodada atual
// - Resultado: /round/tournament/finish/v2 -> os DOIS jogadores relatam; o servidor decide o vencedor
// - Vencedor avança sozinho; campeão e finalistas recebem prêmio
const crypto = require("crypto");
const path = require("path");
const axios = require("axios");

const CFG = {
  firstId: 100,                    // ids dos torneios criados pelo site começam aqui
  sizes: [4, 8, 16, 32],           // tamanhos permitidos (potência de 2)
  currencies: ["gems", "coins", "dust"],
  defaultLevel: "level19_block",
  defaultPrizes: { champion: 500, finalist: 200, semifinalist: 100 },
  fillWaitMs: 45000,               // quanto tempo o join espera (long-poll) pela sala/adversário
  singleReportTimeoutMs: 60000,    // se só um lado relatar, aceita o relato depois disso
  noShowTimeoutMs: 10 * 60 * 1000, // ninguém relatou -> disputa (admin resolve)
  staleRegistrationMs: 30 * 60 * 1000, // bracket que não encheu em 30 min é cancelado e reembolsado
  strictToken: true,               // exige o EntryToken emitido no join
};

let ctx = null;
let indexesReady = false;
const defs = new Map();            // id -> definição do torneio (vem do Mongo, coleção TournamentDefs)
let defsLoadedAt = 0;

const Brackets = () => ctx.database.db.collection("Brackets");
const Matches = () => ctx.database.db.collection("Matches");
const Defs = () => ctx.database.db.collection("TournamentDefs");
const log = (...a) => ctx.Console.log("Bracket", ...a);
const err = (...a) => ctx.Console.error("Bracket", ...a);
// fila simples: evita que joins simultâneos criem vários brackets (servidor roda em 1 processo)
let lockChain = Promise.resolve();
const withLock = (fn) => { const run = lockChain.then(fn, fn); lockChain = run.catch(() => {}); return run; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roundsOf = (size) => Math.log2(size);
const newId = () => crypto.randomBytes(5).toString("hex");

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function init({ database, UserModel, Console, TournamentXController, config }) {
  if (config) Object.assign(CFG, config);
  ctx = { database, UserModel, Console, TournamentXController };
  // espera o Mongo conectar e carrega os torneios criados pelo site
  const boot = setInterval(async () => {
    if (!ctx.database.db) return;
    clearInterval(boot);
    try { await loadDefs(true); } catch (e) { err("loadDefs", e); }
  }, 1000);
  setInterval(() => sweep().catch((e) => err("sweep", e)), 15000);
  log("BracketUtils pronto. Painel: /admin/torneios");
}

async function loadDefs(force) {
  if (!ctx.database.db) return;
  if (!force && Date.now() - defsLoadedAt < 30000) return;
  const list = await Defs().find({}).toArray();
  defs.clear();
  list.forEach((d) => defs.set(d.id, d));
  defsLoadedAt = Date.now();
  syncTX();
}

// o cliente enxerga os torneios pela lista do TournamentXController (/tournamentx/active)
function clientEntry(d) {
  const tx = ctx.TournamentXController.tournaments;
  const base = tx.find((t) => t.id === 1) || tx[0] || {};
  const cur = d.prizeCurrency || "gems";
  const aw = (lo, hi, id, amount) => ({ placementRangeLowest: lo, placementRangeHighest: hi, awardId: id, type: "CURRENCY", amount, awardJson: { name: cur } });
  return {
    ...base,
    id: d.id, isEnabled: !!d.enabled,
    nameKey: d.name, descriptionKey: d.description || `Mata-mata 1v1 com ${d.size} jogadores. Vença ${roundsOf(d.size)} rodadas!`,
    entryCurrencyType: d.entryCurrencyType, entryCurrencyCost: d.entryCurrencyCost,
    entryCurrencyType2: undefined, entryCurrencyCost2: undefined,
    rounds: [{ roundOrder: 1, maxPlayersToProgress: 1, minPlayersPerMatch: 2, maxPlayersPerMatch: 5, areLevelsRestricted: true, permittedLevels: [d.level || CFG.defaultLevel] }],
    awards: [aw(1, 1, 1000 + d.id * 3, d.prizes.champion), aw(2, 2, 1001 + d.id * 3, d.prizes.finalist), aw(3, 4, 1002 + d.id * 3, d.prizes.semifinalist)],
  };
}

function syncTX() {
  const tx = ctx.TournamentXController.tournaments;
  for (let i = tx.length - 1; i >= 0; i--) if (tx[i].id >= CFG.firstId && !defs.has(tx[i].id)) tx.splice(i, 1);
  for (const d of defs.values()) {
    const e = clientEntry(d);
    const i = tx.findIndex((t) => t.id === d.id);
    if (i >= 0) tx[i] = e; else tx.push(e);
  }
}

const isBracket = (id) => !!ctx && defs.has(Number(id));

async function ensureIndexes() {
  if (indexesReady) return;
  try {
    await Matches().createIndex({ matchId: 1 }, { unique: true });
    await Matches().createIndex({ bracketId: 1, status: 1 });
    await Brackets().createIndex({ bracketId: 1 }, { unique: true });
    await Brackets().createIndex({ tournamentId: 1, status: 1 });
    indexesReady = true;
  } catch (e) {
    err("indexes", e);
  }
}

// ---------- helpers de consulta ----------
async function myBracket(user, tournamentId) {
  const list = await Brackets()
    .find({ tournamentId: Number(tournamentId), status: { $in: ["registering", "running"] }, "players.stumbleId": user.stumbleId })
    .toArray();
  for (const b of list) {
    const me = b.players.find((p) => p.stumbleId === user.stumbleId);
    if (me && !me.eliminated) return b;
  }
  return null;
}

const myReadyMatch = (bracketId, stumbleId) =>
  Matches().findOne({ bracketId, status: "ready", ids: stumbleId });

const entryResponse = (match, user) => {
  const side = match.a.stumbleId === user.stumbleId ? "a" : "b";
  return { entryToken: match[side].token, MatchmakerTag: match.tag, requestId: user.stumbleId };
};

// espera (long-poll) até existir uma partida pronta para o jogador
async function waitForMatch(req, user, bracketId) {
  let aborted = false;
  req.on("close", () => (aborted = true));
  const end = Date.now() + CFG.fillWaitMs;
  while (!aborted && Date.now() < end) {
    const b = await Brackets().findOne({ bracketId });
    if (!b || b.status === "finished") return { done: true };
    const me = b.players.find((p) => p.stumbleId === user.stumbleId);
    if (me && me.eliminated) return { eliminated: true };
    if (b.status === "running") {
      const m = await myReadyMatch(bracketId, user.stumbleId);
      if (m) return { match: m };
    }
    await sleep(1000);
  }
  return { timeout: true };
}

async function answerJoin(req, res, user, bracketId) {
  const r = await waitForMatch(req, user, bracketId);
  if (r.match) return res.status(200).json(entryResponse(r.match, user));
  if (r.eliminated) return res.status(400).json({ message: "voce foi eliminado do torneio" });
  if (r.done) return res.status(400).json({ message: "torneio finalizado" });
  return res.status(202).json({ message: "aguardando adversario", status: "waiting" });
}

// ---------- rotas ----------
async function join(req, res) {
  try {
    await ensureIndexes();
    await loadDefs();
    const { user } = req;
    const t = defs.get(Number(req.params.tournamentId));
    if (!t || !t.enabled) return res.status(400).json({ message: "torneio desativado" });

    // a inscrição (checar -> cobrar -> encaixar no bracket) roda em fila; a espera pela sala fica fora dela
    const reg = await withLock(async () => {
      const existing = await myBracket(user, t.id);
      if (existing) return { bracket: existing, charged: false };

      if (t.entryCurrencyCost > 0) {
        const bal = await ctx.UserModel.getBalanceAmount(user, t.entryCurrencyType);
        if (bal < t.entryCurrencyCost) return { reply: { code: 400, body: { message: `saldo insuficiente de ${t.entryCurrencyType}` } } };
        await ctx.UserModel.removeBalance(user.deviceId, t.entryCurrencyType, t.entryCurrencyCost);
      }

      const me = { stumbleId: user.stumbleId, userId: user.id, username: user.username, deviceId: user.deviceId, joinedAt: new Date() };

      let b = await Brackets().findOneAndUpdate(
        { tournamentId: t.id, status: "registering", [`players.${t.size - 1}`]: { $exists: false }, "players.stumbleId": { $ne: user.stumbleId } },
        { $push: { players: me } },
        { returnDocument: "after" }
      );
      if (!b) {
        b = {
          bracketId: newId(), tournamentId: t.id, size: t.size, status: "registering", round: 0, totalRounds: roundsOf(t.size),
          fee: { type: t.entryCurrencyType, cost: t.entryCurrencyCost },               // snapshot: reembolso e prêmios não mudam se o torneio for editado
          prizes: t.prizes, prizeCurrency: t.prizeCurrency || "gems",
          players: [me], createdAt: new Date(),
        };
        await Brackets().insertOne(b);
      }

      log(`${user.username} entrou no bracket ${b.bracketId} (${b.players.length}/${b.size})`);
      if (b.players.length === b.size) await startBracket(b.bracketId);
      return { bracket: b, charged: true };
    });
    if (reg.reply) return res.status(reg.reply.code).json(reg.reply.body);
    const b = reg.bracket;
    return answerJoin(req, res, user, b.bracketId);
  } catch (e) {
    err("join", e);
    if (!res.headersSent) res.status(500).json({ message: "erro interno do servidor" });
  }
}

async function leave(req, res) {
  try {
    const { user } = req;
    const b = await myBracket(user, req.params.tournamentId);
    if (!b) return res.status(200).json({ message: "left" });

    if (b.status === "registering") {
      await Brackets().updateOne({ bracketId: b.bracketId, status: "registering" }, { $pull: { players: { stumbleId: user.stumbleId } } });
      if (b.fee && b.fee.cost > 0) await ctx.UserModel.addBalance(user.deviceId, b.fee.type, b.fee.cost);
      log(`${user.username} saiu do bracket ${b.bracketId} antes de começar (reembolsado)`);
      return res.status(200).json({ message: "left" });
    }

    // bracket rodando: sair = W.O., adversário avança, sem reembolso
    const m = await myReadyMatch(b.bracketId, user.stumbleId);
    if (m) {
      const opp = m.a.stumbleId === user.stumbleId ? m.b : m.a;
      await settle(m, opp.stumbleId, "wo");
    }
    return res.status(200).json({ message: "left" });
  } catch (e) {
    err("leave", e);
    res.status(500).json({ message: "internal server error" });
  }
}

async function finish(req, res) {
  try {
    const { Round, TournamentId, EntryToken, SignedPayload } = req.body || {};
    const { user } = req;
    const r = parseInt(Round);
    if (r !== 0 && r !== 1) return res.status(400).json({ mensagem: "round invalido" });

    const b = await myBracket(user, TournamentId);
    const m = b && (await myReadyMatch(b.bracketId, user.stumbleId));
    if (!m) return res.status(404).json({ message: "nenhuma partida de torneio ativa" });

    const side = m.a.stumbleId === user.stumbleId ? "a" : "b";
    if (CFG.strictToken && EntryToken !== m[side].token) {
      err(`token inválido de ${user.username} no match ${m.matchId}`);
      return res.status(403).json({ message: "entry token invalido" });
    }

    // só aceita o primeiro relato de cada lado
    await Matches().updateOne(
      { matchId: m.matchId, status: "ready", [`${side}.report`]: null },
      { $set: { [`${side}.report`]: r, [`${side}.reportedAt`]: new Date() } }
    );
    await evaluate(m.matchId);

    const updatedUser = await ctx.UserModel.findByStumbleId(user.stumbleId);
    return res.status(200).json({
      TournamentId, Round: r, EntryToken, SignedPayload,
      CollectedCurrencies: [],
      Rewards: (updatedUser && updatedUser.Rewards) || [],
      User: updatedUser,
    });
  } catch (e) {
    err("finish", e);
    res.status(500).json({ mensagem: "erro interno do servidor" });
  }
}

// GET /bracket/:tournamentId  -> chaveamento atual (sem tokens)
async function view(req, res) {
  try {
    if (!isBracket(req.params.tournamentId)) return res.status(404).json({ message: "torneio sem bracket" });
    const tid = Number(req.params.tournamentId);
    let b = await Brackets().findOne({ tournamentId: tid, status: "running" });
    if (!b) b = await Brackets().findOne({ tournamentId: tid, status: "registering" });
    if (!b) {
      const last = await Brackets().find({ tournamentId: tid, status: "finished" }).sort({ finishedAt: -1 }).limit(1).toArray();
      b = last[0];
    }
    if (!b) return res.status(404).json({ message: "nenhum bracket" });
    const ms = await Matches().find({ bracketId: b.bracketId }).toArray();
    return res.status(200).json({
      bracketId: b.bracketId, status: b.status, size: b.size, champion: b.champion || null,
      players: b.players.map((p) => ({ stumbleId: p.stumbleId, username: p.username, eliminated: !!p.eliminated })),
      matches: ms.map((m) => ({ matchId: m.matchId, round: m.round, slot: m.slot, a: m.a.username, b: m.b.username, status: m.status, winner: m.winner || null })),
    });
  } catch (e) {
    err("view", e);
    res.status(500).json({ message: "erro interno" });
  }
}

// ---------- painel admin (site) ----------
// Todas as rotas abaixo exigem o header x-admin-key = process.env.ADMIN_KEY
function adminOk(req, res) {
  if (!process.env.ADMIN_KEY || req.headers["x-admin-key"] !== process.env.ADMIN_KEY) {
    res.status(403).json({ message: "chave de admin invalida (defina ADMIN_KEY no servidor)" });
    return false;
  }
  return true;
}
const adminWrap = (fn) => async (req, res) => {
  try { if (!adminOk(req, res)) return; await loadDefs(); await fn(req, res); }
  catch (e) { err("admin", e); if (!res.headersSent) res.status(500).json({ message: "erro interno" }); }
};

const adminPage = (req, res) => res.sendFile(path.join(__dirname, "admin_torneios.html"));

const adminList = adminWrap(async (req, res) => {
  const active = await Brackets().find({ status: { $in: ["registering", "running"] } }).toArray();
  const recent = await Brackets().find({ status: "finished" }).sort({ finishedAt: -1 }).limit(10).toArray();
  const disputes = await Matches().find({ status: "disputed" }).toArray();
  const sum = (b) => ({ bracketId: b.bracketId, tournamentId: b.tournamentId, status: b.status, size: b.size, players: b.players.length, champion: (b.players.find((p) => p.stumbleId === b.champion) || {}).username || null });
  res.json({
    defs: [...defs.values()].sort((x, y) => y.id - x.id),
    active: active.map(sum), recent: recent.map(sum),
    disputes: disputes.map((m) => ({ matchId: m.matchId, bracketId: m.bracketId, reason: m.disputeReason, a: { stumbleId: m.a.stumbleId, username: m.a.username }, b: { stumbleId: m.b.stumbleId, username: m.b.username } })),
    options: { sizes: CFG.sizes, currencies: CFG.currencies, defaultLevel: CFG.defaultLevel, defaultPrizes: CFG.defaultPrizes },
  });
});

const adminBracket = adminWrap(async (req, res) => {
  const b = await Brackets().findOne({ bracketId: req.params.bracketId });
  if (!b) return res.status(404).json({ message: "bracket nao encontrado" });
  const ms = await Matches().find({ bracketId: b.bracketId }).toArray();
  res.json({
    bracketId: b.bracketId, tournamentId: b.tournamentId, status: b.status, size: b.size, champion: b.champion || null,
    players: b.players.map((p) => ({ stumbleId: p.stumbleId, username: p.username, eliminated: !!p.eliminated })),
    matches: ms.map((m) => ({ matchId: m.matchId, round: m.round, slot: m.slot, status: m.status, winner: m.winner || null, reason: m.reason || m.disputeReason || null, a: { stumbleId: m.a.stumbleId, username: m.a.username, report: m.a.report }, b: { stumbleId: m.b.stumbleId, username: m.b.username, report: m.b.report } })),
  });
});

const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

const adminCreate = adminWrap(async (req, res) => {
  const b = req.body || {};
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : "";
  if (!name) return res.status(400).json({ message: "informe o nome do torneio" });
  const size = Number(b.size);
  if (!CFG.sizes.includes(size)) return res.status(400).json({ message: `tamanho deve ser um de ${CFG.sizes.join(", ")}` });
  const type = CFG.currencies.includes(b.entryCurrencyType) ? b.entryCurrencyType : "gems";
  const cost = int(b.entryCurrencyCost ?? 0, 0, 1000000);
  const pz = b.prizes || {};
  const prizes = { champion: int(pz.champion ?? 0, 0, 10000000), finalist: int(pz.finalist ?? 0, 0, 10000000), semifinalist: int(pz.semifinalist ?? 0, 0, 10000000) };
  if (cost === null || Object.values(prizes).some((v) => v === null)) return res.status(400).json({ message: "valores de taxa/prêmio invalidos" });
  const id = Math.max(CFG.firstId - 1, ...defs.keys()) + 1;
  const def = {
    id, name, description: typeof b.description === "string" ? b.description.trim().slice(0, 200) : "",
    size, entryCurrencyType: type, entryCurrencyCost: cost, prizes, prizeCurrency: type,
    level: typeof b.level === "string" && b.level.trim() ? b.level.trim().slice(0, 60) : CFG.defaultLevel,
    enabled: true, createdAt: new Date(),
  };
  await Defs().insertOne(def);
  defs.set(id, def); syncTX();
  log(`Torneio criado pelo site: #${id} ${name} (${size} jogadores)`);
  res.status(201).json({ success: true, tournament: def });
});

const adminToggle = adminWrap(async (req, res) => {
  const id = Number((req.body || {}).id);
  const d = defs.get(id);
  if (!d) return res.status(404).json({ message: "torneio nao encontrado" });
  d.enabled = !!(req.body || {}).enabled;
  await Defs().updateOne({ id }, { $set: { enabled: d.enabled } });
  syncTX();
  res.json({ success: true, enabled: d.enabled });
});

const adminDelete = adminWrap(async (req, res) => {
  const id = Number((req.body || {}).id);
  if (!defs.has(id)) return res.status(404).json({ message: "torneio nao encontrado" });
  const busy = await Brackets().findOne({ tournamentId: id, status: { $in: ["registering", "running"] } });
  if (busy) return res.status(409).json({ message: "ha um bracket em andamento; desative o torneio e espere acabar" });
  await Defs().deleteOne({ id });
  defs.delete(id); syncTX();
  res.json({ success: true });
});

// POST {matchId, winnerStumbleId}
const adminResolve = adminWrap(async (req, res) => {
  const { matchId, winnerStumbleId } = req.body || {};
  const m = await Matches().findOne({ matchId });
  if (!m || !m.ids.includes(winnerStumbleId)) return res.status(400).json({ message: "match/vencedor invalido" });
  await settle(m, winnerStumbleId, "admin");
  res.json({ success: true });
});

// ---------- motor do bracket ----------
async function startBracket(bracketId) {
  const b = await Brackets().findOneAndUpdate(
    { bracketId, status: "registering" },
    { $set: { status: "running", round: 1, startedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!b || b.players.length !== b.size) return;
  const order = shuffle(b.players);
  for (let i = 0; i < b.size / 2; i++) await createMatch(b.bracketId, 1, i, order[2 * i], order[2 * i + 1]);
  log(`Bracket ${bracketId} começou`);
  await announce(bracketId, "🏆 Bracket começou!");
}

async function createMatch(bracketId, round, slot, pa, pb) {
  const matchId = `${bracketId}-r${round}-s${slot}`;
  const side = (p) => ({ stumbleId: p.stumbleId, username: p.username, deviceId: p.deviceId, token: `${matchId}.${crypto.randomBytes(8).toString("hex")}`, report: null });
  const doc = {
    matchId, bracketId, round, slot, tag: crypto.randomInt(100000, 999999),
    a: side(pa), b: side(pb), ids: [pa.stumbleId, pb.stumbleId],
    status: "ready", createdAt: new Date(),
  };
  // upsert determinístico: se dois finishes criarem ao mesmo tempo, só um vale
  await Matches().updateOne({ matchId }, { $setOnInsert: doc }, { upsert: true });
}

async function evaluate(matchId) {
  const m = await Matches().findOne({ matchId });
  if (!m || m.status !== "ready") return;
  const ra = m.a.report, rb = m.b.report;
  if (ra == null || rb == null) return; // espera o outro lado (ou o timeout do sweep)
  if (ra !== rb) return settle(m, ra === 1 ? m.a.stumbleId : m.b.stumbleId, "reported");
  return dispute(m, ra === 1 ? "os dois disseram que ganharam" : "os dois disseram que perderam");
}

async function dispute(m, reason) {
  const r = await Matches().updateOne({ matchId: m.matchId, status: "ready" }, { $set: { status: "disputed", disputeReason: reason } });
  if (!r.modifiedCount) return;
  err(`DISPUTA ${m.matchId}: ${reason} (${m.a.username} x ${m.b.username})`);
  await announce(m.bracketId, `⚠️ Disputa em ${m.matchId}: ${m.a.username} x ${m.b.username} — ${reason}`);
}

async function settle(m, winnerId, reason) {
  const upd = await Matches().findOneAndUpdate(
    { matchId: m.matchId, status: { $in: ["ready", "disputed"] } },
    { $set: { status: "done", winner: winnerId, reason, doneAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!upd) return; // já resolvida
  const loserId = m.ids.find((i) => i !== winnerId);
  await Brackets().updateOne(
    { bracketId: m.bracketId, "players.stumbleId": loserId },
    { $set: { "players.$.eliminated": true, "players.$.eliminatedRound": m.round } }
  );
  log(`${m.matchId}: venceu ${winnerId} (${reason})`);

  const b = await Brackets().findOne({ bracketId: m.bracketId });
  if (m.round === roundsOf(b.size)) return finishBracket(b, winnerId, loserId);

  const sib = await Matches().findOne({ bracketId: m.bracketId, round: m.round, slot: m.slot ^ 1 });
  if (sib && sib.status === "done") {
    const wMine = b.players.find((p) => p.stumbleId === winnerId);
    const wSib = b.players.find((p) => p.stumbleId === sib.winner);
    const [pa, pb] = m.slot % 2 === 0 ? [wMine, wSib] : [wSib, wMine];
    await createMatch(m.bracketId, m.round + 1, Math.floor(m.slot / 2), pa, pb);
    await Brackets().updateOne({ bracketId: m.bracketId }, { $max: { round: m.round + 1 } });
    await announce(m.bracketId, `➡️ Rodada ${m.round + 1} montada`);
  }
}

async function finishBracket(b, championId, finalistId) {
  const r = await Brackets().updateOne({ bracketId: b.bracketId, status: "running" }, { $set: { status: "finished", champion: championId, finishedAt: new Date() } });
  if (!r.modifiedCount) return;
  const dev = (id) => (b.players.find((p) => p.stumbleId === id) || {}).deviceId;
  const pz = b.prizes || CFG.defaultPrizes;
  const cur = b.prizeCurrency || "gems";
  const pay = (id, amount) => dev(id) && amount > 0 ? ctx.UserModel.addBalance(dev(id), cur, amount) : null;
  await pay(championId, pz.champion);
  await pay(finalistId, pz.finalist);
  if (roundsOf(b.size) >= 2) {
    const semis = await Matches().find({ bracketId: b.bracketId, round: roundsOf(b.size) - 1, status: "done" }).toArray();
    for (const s of semis) await pay(s.ids.find((i) => i !== s.winner), pz.semifinalist);
  }
  const champ = b.players.find((p) => p.stumbleId === championId);
  log(`Bracket ${b.bracketId} finalizado. Campeão: ${champ && champ.username}`);
  await announce(b.bracketId, `🥇 Campeão: ${champ && champ.username}!`);
}

// roda a cada 15s: relato único, no-show e bracket que não encheu
async function sweep() {
  if (!ctx || !ctx.database.db) return;
  await loadDefs();
  const now = Date.now();
  const ready = await Matches().find({ status: "ready" }).toArray();
  for (const m of ready) {
    const ra = m.a.report, rb = m.b.report;
    if (ra == null && rb == null) {
      if (now - new Date(m.createdAt).getTime() > CFG.noShowTimeoutMs) await dispute(m, "ninguem relatou o resultado");
      continue;
    }
    if (ra != null && rb != null) { await evaluate(m.matchId); continue; }
    const rep = ra != null ? m.a : m.b, other = ra != null ? m.b : m.a;
    if (now - new Date(rep.reportedAt).getTime() > CFG.singleReportTimeoutMs) {
      await settle(m, rep.report === 1 ? rep.stumbleId : other.stumbleId, "single-report");
    }
  }
  const stale = await Brackets().find({ status: "registering" }).toArray();
  for (const b of stale) {
    if (now - new Date(b.createdAt).getTime() < CFG.staleRegistrationMs) continue;
    const r = await Brackets().updateOne({ bracketId: b.bracketId, status: "registering" }, { $set: { status: "cancelled" } });
    if (!r.modifiedCount) continue;
    for (const p of b.players) if (b.fee && b.fee.cost > 0) await ctx.UserModel.addBalance(p.deviceId, b.fee.type, b.fee.cost);
    log(`Bracket ${b.bracketId} cancelado (não encheu). ${b.players.length} reembolsados`);
  }
}

// ---------- Discord ----------
async function announce(bracketId, title) {
  const url = process.env.BracketWebhookUrl || process.env.WebhookUrl;
  if (!url) return;
  try {
    const ms = await Matches().find({ bracketId }).toArray();
    ms.sort((x, y) => x.round - y.round || x.slot - y.slot);
    let text = `**${title}** (\`${bracketId}\`)\n`;
    let cur = 0;
    for (const m of ms) {
      if (m.round !== cur) { cur = m.round; text += `\n__Rodada ${cur}__\n`; }
      const mark = (s) => (m.winner === s.stumbleId ? `**${s.username}** ✅` : s.username);
      text += `${mark(m.a)} x ${mark(m.b)}${m.status === "disputed" ? " ⚠️" : ""}\n`;
    }
    await axios.post(url, { content: text.slice(0, 1900) });
  } catch (e) {
    /* webhook é opcional */
  }
}

module.exports = { init, isBracket, join, leave, finish, view, adminPage, adminList, adminBracket, adminCreate, adminToggle, adminDelete, adminResolve, _internals: { sweep, CFG, defs } };
