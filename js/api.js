/* ============================================================
   API — ESPN Data Fetching Layer
   Handles all ESPN public API calls with error handling
   ============================================================ */
const API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

const api = {
    async fetchScoreboard() {
        try {
            const response = await fetch(`${API_BASE}/scoreboard`);
            const data = await response.json();
            return data.events || [];
        } catch (error) {
            console.error('Failed to fetch scoreboard:', error);
            return [];
        }
    },

    async fetchTeams() {
        try {
            const response = await fetch(`${API_BASE}/teams?limit=30`);
            const data = await response.json();
            const teams = data.sports[0].leagues[0].teams.map(t => t.team);
            return teams;
        } catch (error) {
            console.error('Failed to fetch teams:', error);
            return [];
        }
    },

    async fetchTeamStats(teamId) {
        try {
            const response = await fetch(`${API_BASE}/teams/${teamId}`);
            const data = await response.json();
            return data.team;
        } catch (error) {
            console.error(`Failed to fetch stats for team ${teamId}:`, error);
            return null;
        }
    },

    /**
     * Fetch team roster. ESPN groups athletes by position.
     */
    async fetchTeamRoster(teamId) {
        try {
            const response = await fetch(`${API_BASE}/teams/${teamId}/roster`);
            const data = await response.json();

            let coachName = 'N/A';
            if (data.coach && data.coach.length > 0) {
                coachName = `${data.coach[0].firstName} ${data.coach[0].lastName}`;
            }

            let allAthletes = [];
            if (Array.isArray(data.athletes)) {
                data.athletes.forEach(group => {
                    if (group && Array.isArray(group.items)) {
                        group.items.forEach(athlete => {
                            if (!athlete.position && group.position) {
                                athlete.position = { name: group.position, abbreviation: group.position.charAt(0) };
                            }
                            allAthletes.push(athlete);
                        });
                    } else if (group && group.id) {
                        allAthletes.push(group);
                    }
                });
            }

            return { athletes: allAthletes, coach: coachName };
        } catch (error) {
            console.error(`Failed to fetch roster for team ${teamId}:`, error);
            return { athletes: [], coach: 'N/A' };
        }
    },

    /**
     * Fetch individual player season stats from ESPN Core API.
     *
     * CRITICAL: ESPN returns stats with the same abbreviation for totals
     * and per-game. We key on stat `name` (e.g. "avgPoints") not abbreviation.
     */
    async fetchPlayerStats(playerId) {
        try {
            const currentYear = new Date().getFullYear();
            const seasonYear = new Date().getMonth() >= 9 ? currentYear + 1 : currentYear;

            let statsRes = await fetch(
                `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${seasonYear}/types/2/athletes/${playerId}/statistics`
            );
            if (!statsRes.ok) {
                statsRes = await fetch(
                    `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${seasonYear - 1}/types/2/athletes/${playerId}/statistics`
                );
            }

            if (!statsRes.ok) return null;

            const data = await statsRes.json();
            const categories = data.splits?.categories || [];

            let nameMap = {};
            categories.forEach(cat => {
                if (cat.stats && Array.isArray(cat.stats)) {
                    cat.stats.forEach(s => {
                        nameMap[s.name] = parseFloat(s.value) || 0;
                    });
                }
            });

            return {
                ppg: nameMap['avgPoints'] || 0,
                rpg: nameMap['avgRebounds'] || 0,
                apg: nameMap['avgAssists'] || 0,
                spg: nameMap['avgSteals'] || 0,
                bpg: nameMap['avgBlocks'] || 0,
                gp:  nameMap['gamesPlayed'] || 0,
                mpg: nameMap['avgMinutes'] || 0,
                fgPct: nameMap['fieldGoalPct'] || 0,
                threePct: nameMap['threePointPct'] || 0,
                ftPct: nameMap['freeThrowPct'] || 0,
                tsPct: nameMap['trueShootingPct'] || 0,
                per: nameMap['PER'] || 0,
                plusMinus: nameMap['plusMinus'] || 0,
                usage: nameMap['usageRate'] || 0
            };
        } catch (error) {
            return null;
        }
    },

    /**
     * Fetch game summary/boxscore from ESPN.
     * Returns leaders and boxscore data for a specific game.
     */
    async fetchGameSummary(gameId) {
        try {
            const response = await fetch(`${API_BASE}/summary?event=${gameId}`);
            if (!response.ok) return null;
            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`Failed to fetch game summary for ${gameId}:`, error);
            return null;
        }
    },

    /**
     * Fetch player stats in PARALLEL BATCHES of 6.
     * ~10x faster than sequential 200ms fetching.
     * Uses 50ms pause between batches to stay under rate limits.
     */
    async fetchPlayerStatsParallel(playerEntries, onProgress, onBatchComplete) {
        const BATCH_SIZE = 6;
        const BATCH_DELAY = 80; // ms between batches
        const results = {};
        let fetched = 0;

        for (let i = 0; i < playerEntries.length; i += BATCH_SIZE) {
            const batch = playerEntries.slice(i, i + BATCH_SIZE);

            const batchResults = await Promise.allSettled(
                batch.map(entry =>
                    this.fetchPlayerStats(entry.id).then(stats => ({
                        id: entry.id,
                        teamId: entry.teamId,
                        stats
                    }))
                )
            );

            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value.stats) {
                    results[result.value.id] = {
                        stats: result.value.stats,
                        teamId: result.value.teamId
                    };
                }
            });

            fetched += batch.length;
            if (onProgress) onProgress(fetched, playerEntries.length);

            // Call batch complete to trigger incremental UI updates
            if (onBatchComplete && fetched % (BATCH_SIZE * 4) === 0) {
                onBatchComplete(results);
            }

            // Brief pause between batches
            if (i + BATCH_SIZE < playerEntries.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }

        return results;
    }
};

window.api = api;
