export function calculateElo(
    winnerRating: number,
    loserRating: number,
    kFactor = 32,
): { winner: number; loser: number } {
    const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400))
    const delta = Math.round(kFactor * (1 - expectedWinner))

    return {
        winner: winnerRating + delta,
        loser: loserRating - delta,
    }
}
