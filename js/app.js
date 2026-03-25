/* ============================================================
   APP — Main Controller
   Cache-first architecture: show cached data instantly,
   then refresh from ESPN APIs in background
   ============================================================ */
const app = {

    async init() {
        console.log('[CompositeNBA] Initializing...');
        
        // Fast-path: Load cache before anything else
        store.loadCache();

        ui.init();

        // Subscribe to state changes
        store.subscribe((key) => {
            if (key === 'games') ui.renderLiveGames(store.state.games);
            if (key === 'rankings') {
                ui.renderRankings(store.state.teamRankings);
                ui.renderPredictorSetup();
            }
            if (key === 'teams') ui.renderTeamsList(store.state.teams);
            if (key === 'players') ui.renderPlayersList(store.state.players);
            if (key === 'loading') {
                // Only show loading progress if we don't have cached data yet
                if (!store.state.cacheLoaded) ui.renderLoadingProgress();
            }
        });

        // ---- INSTANT RENDER from cache ----
        if (store.state.cacheLoaded) {
            console.log('[CompositeNBA] Rendering cached data instantly...');
            // Re-run models to ensure derived state (ratings) are available from the raw cached stats
            models.updateAllPlayers();
            models.updateTeamRankings();

            ui.renderLiveGames(store.state.games || []);
            ui.renderRankings(store.state.teamRankings);
            ui.renderTeamsList(store.state.teams);
            ui.renderPlayersList(store.state.players);
            ui.renderPredictorSetup();
        }

        // ---- Background refresh (non-blocking) ----
        this.fetchBaseData();

        // Smart polling for live games
        this.startLivePolling();

        // Periodic team/roster refresh every 15 minutes
        setInterval(() => this.refreshTeamsAndRosters(), 15 * 60000);

        console.log('[CompositeNBA] Boot complete.');
    },

    async fetchBaseData() {
        ui.setSyncing(true);
        try {
            // Parallel fetch teams + scoreboard
            const [games, teams] = await Promise.all([
                api.fetchScoreboard(),
                api.fetchTeams()
            ]);

            store.setGames(games);
            store.setTeams(teams);

            // Fetch team profile stats + Core API detailed stats — all 30 in parallel
            const [teamProfiles, teamDetailedStats] = await Promise.all([
                Promise.all(teams.map(t => api.fetchTeamStats(t.id))),
                Promise.all(teams.map(t => api.fetchTeamStatistics(t.id)))
            ]);

            teamProfiles.forEach((profile, idx) => {
                if (profile) store.setTeamStats(teams[idx].id, profile);
            });

            teamDetailedStats.forEach((stats, idx) => {
                if (stats) store.state.teamDetailedStats[teams[idx].id] = stats;
            });

            // Generate initial rankings
            models.updateTeamRankings();

            // Fetch ALL rosters
            await this.fetchAllRosters(teams);

            // Final save to cache
            store.saveCache();
        } catch (e) {
            console.error('[CompositeNBA] Critical boot failure:', e);
        } finally {
            ui.setSyncing(false);
        }
    },

    /**
     * Fetch all 30 rosters in batches of 10 (faster than 6).
     */
    async fetchAllRosters(teams) {
        store.updateLoadingProgress('rosters', 0, teams.length, 'loading');
        let loaded = 0;
        const BATCH = 10;

        for (let i = 0; i < teams.length; i += BATCH) {
            const batch = teams.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(t => api.fetchTeamRoster(t.id)));

            batch.forEach((t, j) => {
                if (results[j]) {
                    store.setRoster(t.id, results[j]);
                }
                loaded++;
                store.updateLoadingProgress('rosters', loaded, teams.length, 'loading');
            });

            if (i + BATCH < teams.length) {
                await new Promise(r => setTimeout(r, 50));
            }
        }

        store.updateLoadingProgress('rosters', teams.length, teams.length, 'done');
        console.log(`[CompositeNBA] All ${teams.length} rosters loaded.`);

        // Build player list with estimated stats first
        models.updateAllPlayers();
        models.updateTeamRankings();
        console.log(`[CompositeNBA] ${store.state.players.length} players aggregated.`);

        // Fetch real player stats in parallel
        this.fetchPlayerStatsInParallel();
    },

    /**
     * Fetch real stats for all players using parallel batches of 8.
     */
    async fetchPlayerStatsInParallel() {
        const rosters = store.state.rosters;
        let allPlayerEntries = [];

        Object.keys(rosters).forEach(teamId => {
            const rosterObj = rosters[teamId];
            if (!rosterObj || !rosterObj.athletes) return;
            rosterObj.athletes.forEach(p => {
                if (p.id) allPlayerEntries.push({ id: p.id, teamId });
            });
        });

        console.log(`[CompositeNBA] Starting parallel stats fetch for ${allPlayerEntries.length} players...`);
        store.updateLoadingProgress('playerStats', 0, allPlayerEntries.length, 'loading');

        const results = await api.fetchPlayerStatsParallel(
            allPlayerEntries,
            (fetched, total) => {
                store.updateLoadingProgress('playerStats', fetched, total, 'loading');
            },
            (batchResults) => {
                // Apply stats incrementally
                Object.keys(batchResults).forEach(playerId => {
                    const { stats, teamId } = batchResults[playerId];
                    const rosterObj = store.state.rosters[teamId];
                    if (rosterObj && rosterObj.athletes) {
                        const athlete = rosterObj.athletes.find(a => String(a.id) === String(playerId));
                        if (athlete && stats) {
                            athlete.realStats = stats;
                        }
                    }
                });
                
                // Only trigger expensive model updates every 120 players (10 batches of 12)
                // to keep the UI responsive during high-volume data ingestion
                if (Object.keys(batchResults).length % (12 * 10) === 0) {
                    models.updateAllPlayers();
                    models.updateTeamRankings();
                }
            }
        );

        // Final pass
        Object.keys(results).forEach(playerId => {
            const { stats, teamId } = results[playerId];
            const rosterObj = store.state.rosters[teamId];
            if (rosterObj && rosterObj.athletes) {
                const athlete = rosterObj.athletes.find(a => String(a.id) === String(playerId));
                if (athlete) athlete.realStats = stats;
            }
        });

        store.updateLoadingProgress('playerStats', allPlayerEntries.length, allPlayerEntries.length, 'done');
        models.updateAllPlayers();
        models.updateTeamRankings();

        console.log(`[CompositeNBA] Stats complete: ${Object.keys(results).length}/${allPlayerEntries.length} players.`);
    },

    /**
     * Adaptive live game polling.
     */
    startLivePolling() {
        let pollInterval = null;

        const poll = async () => {
            const games = await api.fetchScoreboard();
            if (games && games.length) store.setGames(games);

            // If a specific game detail is open, refresh it too
            if (store.state.activeGameId) {
                const summary = await api.fetchGameSummary(store.state.activeGameId);
                if (summary) {
                    ui.updateGameDetailContent(summary);
                }
            }

            const hasLive = (games || []).some(g => g.status?.type?.state === 'in');
            const nextDelay = hasLive ? 10000 : 60000;

            clearTimeout(pollInterval);
            pollInterval = setTimeout(poll, nextDelay);
        };

        pollInterval = setTimeout(poll, 15000);
    },

    /**
     * Full refresh — every 15 minutes.
     */
    async refreshTeamsAndRosters() {
        console.log('[CompositeNBA] Periodic refresh...');
        try {
            const teams = await api.fetchTeams();
            if (teams && teams.length) {
                store.setTeams(teams);

                const profiles = await Promise.all(teams.map(t => api.fetchTeamStats(t.id)));
                profiles.forEach((p, i) => { if (p) store.setTeamStats(teams[i].id, p); });

                models.updateTeamRankings();
                await this.fetchAllRosters(teams);
            }
        } catch (e) {
            console.error('[CompositeNBA] Refresh error:', e);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
