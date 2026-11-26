// PartyInviteUtils.js - convites de grupo + grupo/sala automatica (Stumble Fast)
const Console = require("./ConsoleUtils");
const { UserModel, database } = require("./BackendUtils");

const INVITE_TTL_MS = 60 * 1000; // convite vale 60s
const MAX_MEMBERS = 2;            // 2 botoes [+]: "left" e "right"
const SLOTS = ["left", "right"];

const users = () => database.collections.Users;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function profileOf(u) {
  if (!u) return null;
  return {
    userId: u.id || 0,
    userName: u.username || "Unknown",
    skin: (u.equippedCosmetics && u.equippedCosmetics.skin) || "SKIN1",
    skinColor: (u.equippedCosmetics && u.equippedCosmetics.color) || null,
    hat: (u.equippedCosmetics && u.equippedCosmetics.hat) || null,
    equippedCosmetics: u.equippedCosmetics || {},
  };
}

async function findByUserId(id) {
  const n = parseInt(id);
  if (!Number.isFinite(n)) return null;
  return users().findOne({ id: n });
}

// grupo do usuario (host ou membro) -> { host, group } ou null
async function resolveGroup(user) {
  const hostStumbleId = user.partyHost || (user.party ? user.stumbleId : null);
  if (!hostStumbleId) return null;
  const host = hostStumbleId === user.stumbleId
    ? user
    : await users().findOne({ stumbleId: hostStumbleId });
  if (!host || !host.party) return null;
  return { host, group: host.party };
}

async function buildState(user) {
  const r = await resolveGroup(user);
  if (!r) return { inGroup: false };
  const { host, group } = r;
  const members = [];
  for (const m of group.members || []) {
    const mu = await users().findOne({ stumbleId: m.stumbleId });
    if (mu) members.push({ slot: m.slot, ...profileOf(mu) });
  }
  return {
    inGroup: true,
    isHost: host.stumbleId === user.stumbleId,
    host: profileOf(host),
    members,
    roomCode: group.roomCode || "",
    photonRegion: group.photonRegion || "",
    photonAppId: group.photonAppId || "",
    roomVersion: group.roomVersion || 0,
  };
}

async function ensureHostGroup(user) {
  if (user.partyHost) return null; // ja e membro de outro grupo
  if (user.party) return user.party;
  const party = { members: [], roomCode: "", photonRegion: "", photonAppId: "", roomVersion: 0, createdAt: Date.now() };
  await users().updateOne({ stumbleId: user.stumbleId }, { $set: { party } });
  user.party = party;
  return party;
}

class PartyController {
  // POST /party/invite  {username | userIds[], slot, photonRoomCode, photonRegion, photonAppId, eventId}
  static async invite(req, res) {
    try {
      const { user } = req;
      const b = req.body || {};
      const targets = [];
      const notFound = [];

      if (b.username) {
        const name = String(b.username).trim();
        if (name.length < 4 || name.length > 12) return res.status(400).json({ message: "Nickname deve ter de 4 a 12 caracteres" });
        const t = await users().findOne({ username: { $regex: "^" + esc(name) + "$", $options: "i" } });
        if (t) targets.push(t); else notFound.push(name);
      }
      if (Array.isArray(b.userIds)) {
        for (const id of b.userIds) {
          const t = await findByUserId(id);
          if (t) targets.push(t); else notFound.push(String(id));
        }
      }
      if (!targets.length) return res.status(404).json({ message: "Jogador nao encontrado", notFound });

      if (user.partyHost) return res.status(409).json({ message: "Somente o host pode convidar" });
      const party = await ensureHostGroup(user);

      const slot = SLOTS.includes(b.slot) ? b.slot : null;
      if (b.photonRoomCode) {
        await users().updateOne({ stumbleId: user.stumbleId }, { $set: {
          "party.roomCode": String(b.photonRoomCode),
          "party.photonRegion": b.photonRegion || "",
          "party.photonAppId": b.photonAppId || "",
        }, $inc: { "party.roomVersion": 1 } });
      }

      let sent = 0;
      for (const t of targets) {
        if (t.stumbleId === user.stumbleId) continue;
        const invite = {
          fromUserId: user.id,
          fromUsername: user.username,
          fromStumbleId: user.stumbleId,
          photonRoomCode: b.photonRoomCode || party.roomCode || "",
          photonRegion: b.photonRegion || party.photonRegion || "",
          photonAppId: b.photonAppId || party.photonAppId || "",
          eventId: b.eventId || null,
          slot,
          sentAt: Date.now(),
          expiresAt: Date.now() + INVITE_TTL_MS,
        };
        await users().updateOne({ stumbleId: t.stumbleId }, { $pull: { receivedPartyInvites: { fromStumbleId: user.stumbleId } } });
        await users().updateOne({ stumbleId: t.stumbleId }, { $push: { receivedPartyInvites: invite } });
        sent++;
      }
      return res.status(200).json({ sent, notFound });
    } catch (err) {
      Console.error("Party", "invite error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  // POST /party/cancel {userId}
  static async cancel(req, res) {
    try {
      const { user } = req;
      const t = await findByUserId((req.body || {}).userId);
      if (!t) return res.status(404).json({ message: "User not found" });
      await users().updateOne({ stumbleId: t.stumbleId }, { $pull: { receivedPartyInvites: { fromStumbleId: user.stumbleId } } });
      return res.status(200).json({ ok: true });
    } catch (err) {
      Console.error("Party", "cancel error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  // POST /party/decline {fromUserId}
  static async decline(req, res) {
    try {
      const { user } = req;
      const from = await findByUserId((req.body || {}).fromUserId);
      if (!from) return res.status(404).json({ message: "User not found" });
      await users().updateOne({ stumbleId: user.stumbleId }, { $pull: { receivedPartyInvites: { fromStumbleId: from.stumbleId } } });
      return res.status(200).json({ ok: true });
    } catch (err) {
      Console.error("Party", "decline error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  // POST /party/accept {fromUserId}
  static async accept(req, res) {
    try {
      const { user } = req;
      const from = await findByUserId((req.body || {}).fromUserId);
      if (!from) return res.status(404).json({ message: "User not found" });

      const invites = Array.isArray(user.receivedPartyInvites) ? user.receivedPartyInvites : [];
      const invite = invites.find((i) => i.fromStumbleId === from.stumbleId);
      await users().updateOne({ stumbleId: user.stumbleId }, { $pull: { receivedPartyInvites: { fromStumbleId: from.stumbleId } } });
      if (!invite) return res.status(404).json({ message: "Convite nao encontrado" });
      if (invite.expiresAt && invite.expiresAt < Date.now()) return res.status(410).json({ message: "Convite expirado" });

      const host = await users().findOne({ stumbleId: from.stumbleId });
      if (!host || !host.party || host.partyHost) return res.status(404).json({ message: "Grupo nao existe mais" });

      // sai do grupo atual (se houver)
      if (user.partyHost && user.partyHost !== host.stumbleId) await PartyController._leave(user);
      if (user.party) await PartyController._leave(user);

      const members = host.party.members || [];
      if (members.some((m) => m.stumbleId === user.stumbleId)) return res.status(200).json(await buildState(user));
      if (members.length >= MAX_MEMBERS) return res.status(409).json({ message: "Grupo cheio" });

      const taken = new Set(members.map((m) => m.slot));
      let slot = SLOTS.includes(invite.slot) && !taken.has(invite.slot) ? invite.slot : SLOTS.find((s) => !taken.has(s));

      await users().updateOne({ stumbleId: host.stumbleId }, { $push: { "party.members": { stumbleId: user.stumbleId, slot } } });
      await users().updateOne({ stumbleId: user.stumbleId }, { $set: { partyHost: host.stumbleId } });
      user.partyHost = host.stumbleId;
      return res.status(200).json(await buildState(user));
    } catch (err) {
      Console.error("Party", "accept error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  // GET /party/state  (o jogo consulta de ~2 em 2s)
  static async state(req, res) {
    try {
      const fresh = await UserModel.findByStumbleId(req.user.stumbleId);
      return res.status(200).json(await buildState(fresh || req.user));
    } catch (err) {
      Console.error("Party", "state error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  // POST /party/room {photonRoomCode, photonRegion, photonAppId}  -> so o host; todos os membros entram automatico
  static async room(req, res) {
    try {
      const { user } = req;
      if (user.partyHost) return res.status(403).json({ message: "Somente o host" });
      const b = req.body || {};
      await ensureHostGroup(user);
      await users().updateOne({ stumbleId: user.stumbleId }, { $set: {
        "party.roomCode": String(b.photonRoomCode || ""),
        "party.photonRegion": b.photonRegion || "",
        "party.photonAppId": b.photonAppId || "",
      }, $inc: { "party.roomVersion": 1 } });
      const fresh = await UserModel.findByStumbleId(user.stumbleId);
      return res.status(200).json(await buildState(fresh));
    } catch (err) {
      Console.error("Party", "room error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  static async _leave(user) {
    if (user.partyHost) {
      await users().updateOne({ stumbleId: user.partyHost }, { $pull: { "party.members": { stumbleId: user.stumbleId } } });
      await users().updateOne({ stumbleId: user.stumbleId }, { $unset: { partyHost: "" } });
      delete user.partyHost;
    } else if (user.party) {
      for (const m of user.party.members || []) {
        await users().updateOne({ stumbleId: m.stumbleId }, { $unset: { partyHost: "" } });
      }
      await users().updateOne({ stumbleId: user.stumbleId }, { $unset: { party: "" } });
      delete user.party;
    }
  }

  // POST /party/leave  ("Sair Da Sala"; se for o host o grupo e desfeito)
  static async leave(req, res) {
    try {
      const fresh = (await UserModel.findByStumbleId(req.user.stumbleId)) || req.user;
      await PartyController._leave(fresh);
      return res.status(200).json({ inGroup: false });
    } catch (err) {
      Console.error("Party", "leave error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
}

module.exports = { PartyController, INVITE_TTL_MS };
