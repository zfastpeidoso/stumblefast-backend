// PartyInviteUtils.js - convites de grupo via Pusher (Stumble Fast)
// O jogo se inscreve no canal "private-user-<id>" e mostra o toast quando chega
// o evento "stumble:v0:party_invite". Quem manda o evento e este arquivo.
const Pusher = require("pusher");
const Console = require("./ConsoleUtils");
const { database } = require("./BackendUtils");

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || "2216041",
  key: process.env.PUSHER_KEY || "1ba20a0da6e8ee37dbd9",
  secret: process.env.PUSHER_SECRET, // defina no Render (Environment)
  cluster: process.env.PUSHER_CLUSTER || "sa1",
  useTLS: true,
});

if (!process.env.PUSHER_SECRET) Console.error("Pusher", "PUSHER_SECRET nao definido: convites nao vao funcionar");

const EVT_INVITE = "stumble:v0:party_invite";
const EVT_CANCEL = "stumble:v0:party_invite_cancel";
const INVITE_TTL_MS = 60 * 1000;

const users = () => database.collections.Users;
const channelOf = (userId) => `private-user-${userId}`;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// o jogo manda PascalCase (UserIds, PhotonRoomCode...). Normaliza para camelCase.
function norm(body) {
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = Object.fromEntries(new URLSearchParams(body)); }
  }
  const out = {};
  for (const k of Object.keys(body || {})) out[k.charAt(0).toLowerCase() + k.slice(1)] = body[k];
  return out;
}

function profileOf(u) {
  const p = u.userProfile || {};
  return {
    UserId: u.id,
    UserName: p.UserName || p.userName || u.username || "Unknown",
    Country: p.Country || p.country || "",
    Trophies: p.Trophies ?? p.trophies ?? 0,
    Crowns: p.Crowns ?? p.crowns ?? 0,
    Experience: p.Experience ?? p.experience ?? 0,
    Skin: p.Skin || p.skin || (u.equippedCosmetics && u.equippedCosmetics.skin) || "SKIN1",
    IsOnline: true,
  };
}

async function findByUserId(id) {
  const n = parseInt(id);
  if (!Number.isFinite(n)) return null;
  return users().findOne({ id: n });
}

class PartyController {
  // POST /party/invite {UserIds[] | username, PhotonAppId, PhotonRoomCode, PhotonRegion, EventId}
  static async invite(req, res) {
    try {
      const { user } = req;
      const b = norm(req.body);
      const targets = [];
      const notFound = [];

      if (b.username) {
        const name = String(b.username).trim();
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

      const payload = {
        FromUserId: user.id,
        FromUserProfile: profileOf(user),
        PhotonRoomCode: b.photonRoomCode || "",
        PhotonRegion: b.photonRegion || "",
        PhotonAppId: b.photonAppId || "",
        ExpiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      };

      let sent = 0;
      for (const t of targets) {
        if (t.stumbleId === user.stumbleId) continue;
        await pusher.trigger(channelOf(t.id), EVT_INVITE, payload);
        sent++;
      }
      Console.log("Party", `${user.username} convidou ${sent} jogador(es) (sala ${payload.PhotonRoomCode})`);
      return res.status(200).json({ sent, notFound });
    } catch (err) {
      Console.error("Party", "invite error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  // POST /party/cancel {UserId, PhotonAppId, PhotonRoomCode, PhotonRegion}
  static async cancel(req, res) {
    try {
      const { user } = req;
      const b = norm(req.body);
      const t = await findByUserId(b.userId);
      if (!t) return res.status(404).json({ message: "User not found" });
      await pusher.trigger(channelOf(t.id), EVT_CANCEL, {
        FromUserId: user.id,
        UserId: user.id,
        PhotonRoomCode: b.photonRoomCode || "",
        RoomCode: b.photonRoomCode || "",
        PhotonRegion: b.photonRegion || "",
        PhotonAppId: b.photonAppId || "",
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      Console.error("Party", "cancel error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
}

class PusherController {
  // POST /pusher/authorize {channel_name, socket_id}  -> so o proprio canal private-user-<id>
  static async authorize(req, res) {
    try {
      const b = norm(req.body);
      const socketId = b.socket_id || b.socketId;
      const channel = b.channel_name || b.channelName;
      if (!socketId || !channel) return res.status(400).json({ message: "socket_id/channel_name obrigatorios" });
      if (channel !== channelOf(req.user.id)) return res.status(403).json({ message: "Canal nao permitido" });
      return res.status(200).json(pusher.authorizeChannel(socketId, channel));
    } catch (err) {
      Console.error("Pusher", "authorize error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  // POST /pusher/authenticate {socket_id}  -> login do usuario no socket (watchlist)
  static async authenticate(req, res) {
    try {
      const b = norm(req.body);
      const socketId = b.socket_id || b.socketId;
      if (!socketId) return res.status(400).json({ message: "socket_id obrigatorio" });
      return res.status(200).json(pusher.authenticateUser(socketId, { id: String(req.user.id) }));
    } catch (err) {
      Console.error("Pusher", "authenticate error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
}

module.exports = { PartyController, PusherController, INVITE_TTL_MS };
