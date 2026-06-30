import { calculateElo } from './elo'

export type StyleLabArenaLeague = 'all' | 'favorites'

export interface ArenaCandidate {
    id: string
    elo: number
    favorite: boolean
}

export interface ArenaBattleRecord extends ArenaCandidate {
    wins: number
    losses: number
    battles: number
    updatedAt: number
}

export function getArenaPool<T extends ArenaCandidate>(
    combinations: T[],
    league: StyleLabArenaLeague,
): T[] {
    return combinations
        .filter(combo => league === 'all' || combo.favorite)
        .sort((a, b) => b.elo - a.elo)
}

export function pickArenaPair<T extends ArenaCandidate>(
    combinations: T[],
    league: StyleLabArenaLeague,
): [string, string] | null {
    const pool = getArenaPool(combinations, league)
    if (pool.length < 2) return null

    const firstIndex = Math.floor(Math.random() * pool.length)
    let secondIndex = Math.floor(Math.random() * pool.length)
    while (secondIndex === firstIndex) {
        secondIndex = Math.floor(Math.random() * pool.length)
    }

    return [pool[firstIndex].id, pool[secondIndex].id]
}

export function applyArenaBattleResult<T extends ArenaBattleRecord>(
    combinations: T[],
    winnerId: string,
    loserId: string,
    updatedAt: number,
): T[] {
    const winner = combinations.find(combo => combo.id === winnerId)
    const loser = combinations.find(combo => combo.id === loserId)
    if (!winner || !loser) return combinations

    const updated = calculateElo(winner.elo, loser.elo)
    return combinations.map(combo => {
        if (combo.id === winnerId) {
            return {
                ...combo,
                elo: updated.winner,
                wins: combo.wins + 1,
                battles: combo.battles + 1,
                updatedAt,
            }
        }
        if (combo.id === loserId) {
            return {
                ...combo,
                elo: updated.loser,
                losses: combo.losses + 1,
                battles: combo.battles + 1,
                updatedAt,
            }
        }
        return combo
    })
}
