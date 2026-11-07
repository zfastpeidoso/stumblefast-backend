const Console = require("./ConsoleUtils");

// Limites considerados impossíveis/suspeitos
const LIMITS = {
  maxXpPerRound: 5000,
  maxCrownsPerRound: 3,
  maxSkillRatingPerRound: 100,
  maxRoundsPerMinute: 3,       // mais de 3 rounds/min = impossível
  maxGemsPerDay: 50000,
  maxCoinsPerDay: 500000,
  maxReportsBeforeAutoBan: 5,  // reports de outros jogadores
};

// Cache em memória de atividade recente por deviceId
const activityCache = new Map(); // deviceId -> { rounds: [{ts}], lastCheck }

function getActivity(deviceId) {
  if (!activityCache.has(deviceId)) {
    activityCache.set(deviceId, { rounds: [], flagCount: 0 });
  }
  return activityCache.get(deviceId);
}

class AntiCheatUtils {

  /**
   * Verifica se os ganhos de um round são suspeitos.
   * Retorna { flagged: bool, reasons: string[] }
   */
  static checkRoundRewards({ xpGained, crownsGained, skillRatingGained, deviceId }) {
    const reasons = [];

    if (xpGained > LIMITS.maxXpPerRound) {
      reasons.push(`XP impossível: ${xpGained} (max ${LIMITS.maxXpPerRound})`);
    }
    if (crownsGained > LIMITS.maxCrownsPerRound) {
      reasons.push(`Crowns impossível: ${crownsGained} (max ${LIMITS.maxCrownsPerRound})`);
    }
    if (skillRatingGained > LIMITS.maxSkillRatingPerRound) {
      reasons.push(`SkillRating impossível: ${skillRatingGained} (max ${LIMITS.maxSkillRatingPerRound})`);
    }

    // Velocidade de rounds
    const activity = getActivity(deviceId);
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    activity.rounds = activity.rounds.filter(r => r.ts > oneMinuteAgo);
    activity.rounds.push({ ts: now });

    if (activity.rounds.length > LIMITS.maxRoundsPerMinute) {
      reasons.push(`Velocidade suspeita: ${activity.rounds.length} rounds no último minuto`);
    }

    if (reasons.length > 0) {
      activity.flagCount = (activity.flagCount || 0) + 1;
    }

    return { flagged: reasons.length > 0, reasons };
  }

  /**
   * Verifica se o saldo de uma moeda está em valor impossível.
   */
  static checkBalanceAnomaly(currency, amount) {
    const limits = {
      gems: 9_999_999,
      coins: 99_999_999,
      crowns: 99_999,
      stumble_coins: 99_999_999,
    };
    const max = limits[currency];
    if (max && amount > max) {
      return { flagged: true, reason: `Saldo impossível de ${currency}: ${amount} (max ${max})` };
    }
    return { flagged: false };
  }

  /**
   * Verifica quantas flags acumuladas um device tem.
   */
  static getFlagCount(deviceId) {
    return getActivity(deviceId).flagCount || 0;
  }

  /**
   * Incrementa flag manualmente (ex: report de outro jogador).
   */
  static addFlag(deviceId, reason) {
    const activity = getActivity(deviceId);
    activity.flagCount = (activity.flagCount || 0) + 1;
    Console.warn("AntiCheat", `Flag adicionada para ${deviceId}: ${reason} (total: ${activity.flagCount})`);
    return activity.flagCount;
  }

  /**
   * Retorna true se o device deve ser banido automaticamente.
   */
  static shouldAutoBan(deviceId) {
    return this.getFlagCount(deviceId) >= LIMITS.maxReportsBeforeAutoBan;
  }

  /**
   * Limpa o cache de um device (após ban ou revisão manual).
   */
  static clearFlags(deviceId) {
    activityCache.delete(deviceId);
  }
}

module.exports = AntiCheatUtils;
