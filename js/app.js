/* ============================================================
   APP — Main Controller
   Cache-first architecture: show cached data instantly,
   then refresh from ESPN APIs in background
   ============================================================ */
const app = {

    async init() {
        console.log('[CompositeNBA] Initializing...');
        
        // Fast-path: Load cache before anything else
        window.store.loadCache();

        window.ui.init();

        // Subscribe to state changes
        window.store.subscribe((key) => {
            if (key === 'games') window.ui.renderLiveGames(window.store.state.games);
            if (key === 'rankings') {
                window.ui.renderRankings(window.store.state.teamRankings);
                window.ui.renderPredictorSetup();
            }
            if (key === 'teams') window.ui.renderTeamsList(window.store.state.teams);
            if (key === 'players') window.ui.renderPlayersList(window.store.state.players);
            if (key === 'loading') {
                // Only show loading progress if we don't have cached data yet
                if (!window.store.state.cacheLoaded) window.ui.renderLoadingProgress();
            }
        });

        // ---- INSTANT RENDER from cache ----
        if (window.store.state.cacheLoaded) {
            console.log('[CompositeNBA] Rendering cached data instantly...');
            // Re-run models to ensure derived state (ratings) are available from the raw cached stats
            window.models.updateAllPlayers();
            window.models.updateTeamRankings();

            window.ui.renderLiveGames(window.store.state.games || []);
            window.ui.renderRankings(window.store.state.teamRankings);
            window.ui.renderTeamsList(window.store.state.teams);
            window.ui.renderPlayersList(window.store.state.players);
            window.ui.renderPredictorSetup();
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
        window.ui.setSyncing(true);
        try {
            // Parallel fetch teams + scoreboard
            const [games, teams] = await Promise.all([
                window.api.fetchScoreboard(),
                window.api.fetchTeams()
            ]);

            window.store.setGames(games);
            window.store.setTeams(teams);

            // Fetch team profile stats + Core API detailed stats — all 30 in parallel
            const [teamProfiles, teamDetailedStats] = await Promise.all([
                Promise.all(teams.map(t => window.api.fetchTeamStats(t.id))),
                Promise.all(teams.map(t => window.api.fetchTeamStatistics(t.id)))
            ]);

            teamProfiles.forEach((profile, idx) => {
                if (profile) window.store.setTeamStats(teams[idx].id, profile);
            });

            teamDetailedStats.forEach((stats, idx) => {
                if (stats) window.store.state.teamDetailedStats[teams[idx].id] = stats;
            });

            // Generate initial rankings
            window.models.updateTeamRankings();

            // Fetch ALL rosters
            await this.fetchAllRosters(teams);

            // Final save to cache
            window.store.saveCache();
        } catch (e) {
            console.error('[CompositeNBA] Critical boot failure:', e);
        } finally {
            window.ui.setSyncing(false);
        }
    },

    /**
     * Fetch all 30 rosters in batches of 10 (faster than 6).
     */
    async fetchAllRosters(teams) {
        window.store.updateLoadingProgress('rosters', 0, teams.length, 'loading');
        let loaded = 0;
        const BATCH = 10;

        for (let i = 0; i < teams.length; i += BATCH) {
            const batch = teams.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(t => window.api.fetchTeamRoster(t.id)));

            batch.forEach((t, j) => {
                if (results[j]) {
                    window.store.setRoster(t.id, results[j]);
                }
                loaded++;
                window.store.updateLoadingProgress('rosters', loaded, teams.length, 'loading');
            });

            if (i + BATCH < teams.length) {
                await new Promise(r => setTimeout(r, 50));
            }
        }

        window.store.updateLoadingProgress('rosters', teams.length, teams.length, 'done');
        console.log(`[CompositeNBA] All ${teams.length} rosters loaded.`);

        // Build player list with estimated stats first
        window.models.updateAllPlayers();
        window.models.updateTeamRankings();
        console.log(`[CompositeNBA] ${window.store.state.players.length} players aggregated.`);

        // Fetch real player stats in parallel
        this.fetchPlayerStatsInParallel();
    },

    /**
     * Fetch real stats for all players using parallel batches of 8.
     */
    async fetchPlayerStatsInParallel() {
        const rosters = window.store.state.rosters;
        let allPlayerEntries = [];

        Object.keys(rosters).forEach(teamId => {
            const rosterObj = rosters[teamId];
            if (!rosterObj || !rosterObj.athletes) return;
            rosterObj.athletes.forEach(p => {
                if (p.id) allPlayerEntries.push({ id: p.id, teamId });
            });
        });

        console.log(`[CompositeNBA] Starting parallel stats fetch for ${allPlayerEntries.length} players...`);
        window.store.updateLoadingProgress('playerStats', 0, allPlayerEntries.length, 'loading');

        const results = await window.api.fetchPlayerStatsParallel(
            allPlayerEntries,
            (fetched, total) => {
                window.store.updateLoadingProgress('playerStats', fetched, total, 'loading');
            },
            (batchResults) => {
                // Apply stats incrementally
                Object.keys(batchResults).forEach(playerId => {
                    const { stats, teamId } = batchResults[playerId];
                    const rosterObj = window.store.state.rosters[teamId];
                    if (rosterObj && rosterObj.athletes) {
                        const athlete = rosterObj.athletes.find(a => String(a.id) === String(playerId));
                        if (athlete && stats) {
                            athlete.realStats = stats;
                        }
                    }
                });
                
                // Trigger UI refresh every 25 players to show progress
                const fetchedCount = window.store.state.loadingProgress.playerStats.current || 0;
                if (fetchedCount % 25 === 0) {
                    window.models.updateAllPlayers();
                    window.models.updateTeamRankings();
                    window.ui.renderTeamRankings();
                    if (window.ui.currentView === 'players') window.ui.renderPlayers();
                }
            }
        );

        // 3. Final Model Update & UI Refresh
        window.window.store.updateLoadingProgress('playerStats', allPlayerEntries.length, allPlayerEntries.length, 'done');
        window.window.models.updateAllPlayers();
        window.window.models.updateTeamRankings();
        window.window.ui.renderTeamRankings();
        if (window.window.ui.currentView === 'players') window.window.ui.renderPlayers();

        console.log(`[CompositeNBA] Stats sync complete: ${allPlayerEntries.length} players tracked.`);
    },

    /**
     * Adaptive live game polling.
     */
    startLivePolling() {
        let pollInterval = null;

        const poll = async () => {
            const games = await window.api.fetchScoreboard();
            if (games && games.length) window.store.setGames(games);

            // If a specific game detail is open, refresh it too
            if (window.store.state.activeGameId) {
                const summary = await window.api.fetchGameSummary(window.store.state.activeGameId);
                if (summary) {
                    window.ui.updateGameDetailContent(summary);
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
            const teams = await window.api.fetchTeams();
            if (teams && teams.length) {
                window.store.setTeams(teams);

                const profiles = await Promise.all(teams.map(t => window.api.fetchTeamStats(t.id)));
                profiles.forEach((p, i) => { if (p) window.store.setTeamStats(teams[i].id, p); });

                window.models.updateTeamRankings();
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
