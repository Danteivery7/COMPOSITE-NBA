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
     * Helper to get the correct NBA season year.
     * Often ESPN's core API 404s for the 'future' year during the transition.
     */
    getSeasonYear() {
        const d = new Date();
        const year = d.getFullYear();
        // If we are in Jan-Sept, it's the current year's season. 
        // If Oct-Dec, it's the next year's.
        return d.getMonth() >= 9 ? year + 1 : year;
    },

    /**
     * Fetch FULL player stats from the high-reliability Site API.
     * Uses the /stats endpoint to get the complete dictionary of metrics.
     */
    async fetchPlayerStats(playerId) {
        try {
            const url = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/stats`;
            const statsRes = await fetch(url);
            if (!statsRes.ok) return null;

            const data = await statsRes.json();
            const categories = data.categories || [];
            
            let nameMap = {};
            
            // PRIORITY 1: Averages (the stats we actually use for ratings)
            const avgCat = categories.find(c => c.name === 'averages');
            if (avgCat && avgCat.statistics && avgCat.statistics[0]) {
                const names = avgCat.names || [];
                const values = avgCat.statistics[0].stats || [];
                names.forEach((name, idx) => {
                    nameMap[name] = parseFloat(values[idx]) || 0;
                });
            }

            // PRIORITY 2: Totals and other categories (fill in the gaps, don't overwrite averages)
            categories.forEach(cat => {
                if (cat.name === 'averages') return;
                const names = cat.names || [];
                const statistics = cat.statistics || [];
                if (statistics[0] && statistics[0].stats) {
                    const values = statistics[0].stats;
                    names.forEach((name, idx) => {
                        if (nameMap[name] === undefined) {
                            nameMap[name] = parseFloat(values[idx]) || 0;
                        }
                    });
                }
            });

            // Failsafe for missing keys
            const getStat = (keys) => {
                for (let k of keys) {
                    if (nameMap[k] !== undefined) return nameMap[k];
                }
                return 0;
            };

            const ppg = getStat(['avgPoints', 'points', 'avgPts']);
            if (ppg === 0 && !nameMap['gamesPlayed']) return null;

            const apg = getStat(['avgAssists', 'assists', 'avgAst']);
            const tovPg = getStat(['avgTurnovers', 'turnovers', 'avgTov']);
            const spg = getStat(['avgSteals', 'steals', 'avgStl']);
            const bpg = getStat(['avgBlocks', 'blocks', 'avgBlk']);
            const mpg = getStat(['avgMinutes', 'minutes', 'mpg']);

            // Build the EXACT object models.js expects
            return {
                ppg: ppg,
                rpg: getStat(['avgRebounds', 'rebounds', 'avgReb']),
                apg: apg,
                spg: spg,
                bpg: bpg,
                tovPg: tovPg,
                foulsPg: getStat(['avgFouls', 'fouls']),
                mpg: mpg,
                gp: getStat(['gamesPlayed', 'gp']),
                gs: getStat(['gamesStarted', 'gs']),
                
                // Efficiency (Must match models.js keys exactly)
                fgPct: getStat(['fieldGoalPct', 'fg%']),
                threePct: getStat(['threePointFieldGoalPct', 'threePointPct', '3p%']), // models.js uses 'threePct'
                ftPct: getStat(['freeThrowPct', 'ft%']),
                efgPct: getStat(['effectiveFGPct', 'efg%']),
                tsPct: getStat(['trueShootingPct', 'ts%']) || 55,
                
                // Volume
                fga: getStat(['avgFieldGoalsAttempted', 'fga']),
                fta: getStat(['avgFreeThrowsAttempted', 'fta']),

                // Advanced / Derived
                per: getStat(['PER', 'per']) || 15,
                usage: getStat(['usageRate', 'usage']) || 20,
                vorp: getStat(['VORP', 'vorp']),
                plusMinus: getStat(['plusMinus', 'avgPlusMinus']),
                assistRatio: getStat(['assistRatio']),
                astTovRatio: nameMap['assistTurnoverRatio'] || (apg / (tovPg || 0.1)),
                defRebPg: getStat(['avgDefensiveRebounds', 'defensiveRebounds']),
                stl48: nameMap['avg48Steals'] || (spg / (mpg || 30) * 48),
                blk48: nameMap['avg48Blocks'] || (bpg / (mpg || 30) * 48),
                estimatedPossessions: getStat(['avgEstimatedPossessions', 'estimatedPossessions']) || (mpg * 2)
            };
        } catch (error) {
            console.warn(`[Stats] Full fetch failed for ${playerId}:`, error.message);
            return null;
        }
    },

    /**
     * Fetch detailed team statistics from ESPN Core API.
     * Returns offensive/defensive/general team-level stats.
     */
    async fetchTeamStatistics(teamId) {
        try {
            let seasonYear = this.getSeasonYear();

            let res = await fetch(
                `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${seasonYear}/types/2/teams/${teamId}/statistics`
            );

            if (!res.ok) {
                seasonYear--;
                res = await fetch(
                    `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${seasonYear}/types/2/teams/${teamId}/statistics`
                );
            }

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
        const BATCH_SIZE = 12; // Back to high speed
        const BATCH_DELAY = 40;
        const results = {};
        let fetched = 0;

        for (let i = 0; i < playerEntries.length; i += BATCH_SIZE) {
            const batch = playerEntries.slice(i, i + BATCH_SIZE);
            const currentBatchResults = {};

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
                if (result.status === 'fulfilled' && result.value && result.value.stats) {
                    const { id, teamId, stats } = result.value;
                    results[id] = { stats, teamId };
                    currentBatchResults[id] = { stats, teamId };
                }
            });

            fetched += batch.length;
            if (onProgress) onProgress(fetched, playerEntries.length);
            if (onBatchComplete) onBatchComplete(currentBatchResults);

            if (i + BATCH_SIZE < playerEntries.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }

        return results;
    },

    /**
     * Fetch the schedule for a specific team (last 5 games)
     */
    async fetchTeamSchedule(teamId) {
        try {
            let seasonYear = this.getSeasonYear();

            // Using ESPN's team events endpoint
            let res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=${seasonYear}`);
            
            if (!res.ok) {
                seasonYear--;
                res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=${seasonYear}`);
            }

            if (!res.ok) return [];

            const data = await res.json();
            if (!data.events) return [];

            // Filter for completed games
            const completedEvents = data.events.filter(e => e.competitions[0].status.type.completed);

            // Return the 5 most recent completed games
            return completedEvents.slice(-5).reverse(); // Reverse so most recent is first
        } catch (error) {
            console.error(`[API] Error fetching schedule for team ${teamId}:`, error);
            return [];
        }
    }
};

window.api = api;
