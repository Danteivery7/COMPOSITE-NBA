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
     * Captures ALL available stats for the comprehensive rating system.
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
                // Core production
                ppg: nameMap['avgPoints'] || 0,
                rpg: nameMap['avgRebounds'] || 0,
                apg: nameMap['avgAssists'] || 0,
                spg: nameMap['avgSteals'] || 0,
                bpg: nameMap['avgBlocks'] || 0,
                tovPg: nameMap['avgTurnovers'] || 0,
                foulsPg: nameMap['avgFouls'] || 0,

                // Shooting
                fgPct: nameMap['fieldGoalPct'] || 0,
                threePct: nameMap['threePointPct'] || nameMap['threePointFieldGoalPct'] || 0,
                ftPct: nameMap['freeThrowPct'] || 0,
                tsPct: nameMap['trueShootingPct'] || 0,
                efgPct: nameMap['effectiveFGPct'] || 0,
                twoPtPct: nameMap['twoPointFieldGoalPct'] || 0,

                // Volume
                fga: nameMap['avgFieldGoalsAttempted'] || 0,
                fgm: nameMap['avgFieldGoalsMade'] || 0,
                threePA: nameMap['avgThreePointFieldGoalsAttempted'] || 0,
                threePM: nameMap['avgThreePointFieldGoalsMade'] || 0,
                fta: nameMap['avgFreeThrowsAttempted'] || 0,
                ftm: nameMap['avgFreeThrowsMade'] || 0,

                // Availability & role
                gp: nameMap['gamesPlayed'] || 0,
                gs: nameMap['gamesStarted'] || 0,
                mpg: nameMap['avgMinutes'] || 0,
                totalMinutes: nameMap['minutes'] || 0,

                // Advanced
                per: nameMap['PER'] || 0,
                plusMinus: nameMap['plusMinus'] || 0,
                usage: nameMap['usageRate'] || 0,
                vorp: nameMap['VORP'] || 0,
                nbaRating: nameMap['NBARating'] || 0,

                // Ratios
                astTovRatio: nameMap['assistTurnoverRatio'] || 0,
                stlFoulRatio: nameMap['stealFoulRatio'] || 0,
                stlTovRatio: nameMap['stealTurnoverRatio'] || 0,
                assistRatio: nameMap['assistRatio'] || 0,
                turnoverRatio: nameMap['turnoverRatio'] || 0,

                // Rebounding
                offRebPg: nameMap['avgOffensiveRebounds'] || 0,
                defRebPg: nameMap['avgDefensiveRebounds'] || 0,
                offRebPct: nameMap['offensiveReboundPct'] || 0,
                defRebRate: nameMap['defReboundRate'] || 0,
                rebRate: nameMap['reboundRate'] || 0,

                // Per-48 stats (for deriving advanced metrics)
                pts48: nameMap['avg48Points'] || 0,
                reb48: nameMap['avg48Rebounds'] || 0,
                ast48: nameMap['avg48Assists'] || 0,
                stl48: nameMap['avg48Steals'] || 0,
                blk48: nameMap['avg48Blocks'] || 0,
                tov48: nameMap['avg48Turnovers'] || 0,

                // Efficiency
                scoringEfficiency: nameMap['scoringEfficiency'] || 0,
                shootingEfficiency: nameMap['shootingEfficiency'] || 0,
                estimatedPossessions: nameMap['avgEstimatedPossessions'] || 0,

                // Totals (for derived calcs)
                totalPoints: nameMap['points'] || 0,
                totalRebounds: nameMap['totalRebounds'] || nameMap['rebounds'] || 0,
                totalAssists: nameMap['assists'] || 0,
                totalSteals: nameMap['steals'] || 0,
                totalBlocks: nameMap['blocks'] || 0,
                totalTurnovers: nameMap['totalTurnovers'] || nameMap['turnovers'] || 0,

                // Doubles
                doubleDouble: nameMap['doubleDouble'] || 0,
                tripleDouble: nameMap['tripleDouble'] || 0,
            };
        } catch (error) {
            return null;
        }
    },

    /**
     * Fetch detailed team statistics from ESPN Core API.
     * Returns offensive/defensive/general team-level stats.
     */
    async fetchTeamStatistics(teamId) {
        try {
            const currentYear = new Date().getFullYear();
            const seasonYear = new Date().getMonth() >= 9 ? currentYear + 1 : currentYear;

            const res = await fetch(
                `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${seasonYear}/types/2/teams/${teamId}/statistics`
            );
            if (!res.ok) return null;

            const data = await res.json();
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
                tovPg: nameMap['avgTurnovers'] || 0,
                fgPct: nameMap['fieldGoalPct'] || 0,
                threePct: nameMap['threePointPct'] || nameMap['threePointFieldGoalPct'] || 0,
                ftPct: nameMap['freeThrowPct'] || 0,
                efgPct: nameMap['effectiveFGPct'] || nameMap['shootingEfficiency'] || 0,
                twoPtPct: nameMap['twoPointFieldGoalPct'] || 0,
                fta: nameMap['avgFreeThrowsAttempted'] || 0,
                threePA: nameMap['avgThreePointFieldGoalsAttempted'] || 0,
                offRebPg: nameMap['avgOffensiveRebounds'] || 0,
                defRebPg: nameMap['avgDefensiveRebounds'] || 0,
                gp: nameMap['gamesPlayed'] || 0,
            };
        } catch (error) {
            console.error(`Failed to fetch team statistics for ${teamId}:`, error);
            return null;
        }
    },

    /**
     * Fetch game summary/boxscore from ESPN.
     */
    async fetchGameSummary(gameId) {
        try {
            const response = await fetch(`${API_BASE}/summary?event=${gameId}`);
            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            console.error(`Failed to fetch game summary for ${gameId}:`, error);
            return null;
        }
    },

    /**
     * Fetch player stats in PARALLEL BATCHES of 6.
     */
    async fetchPlayerStatsParallel(playerEntries, onProgress, onBatchComplete) {
        const BATCH_SIZE = 6;
        const BATCH_DELAY = 80;
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

            if (onBatchComplete && fetched % (BATCH_SIZE * 4) === 0) {
                onBatchComplete(results);
            }

            if (i + BATCH_SIZE < playerEntries.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }

        return results;
    }
};

window.api = api;
