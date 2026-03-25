/* ============================================================
   STORE — Centralized State Management
   Reactive pub/sub store with localStorage persistence
   Includes FULL DATA CACHING for instant page loads
   ============================================================ */
const store = {
    state: {
        games: [],
        teams: [],
        teamStats: {},
        teamDetailedStats: {},     // Core API team statistics
        teamRankings: [],
        players: [],
        rosters: {},
        leagueStats: {},           // min/max/avg for normalization
        favorites: {
            teams: [],
            players: []
        },
        settings: {
            theme: 'dark',
            preset: 'balanced'
        },
        lastUpdated: {
            games: 0,
            teams: 0,
            players: 0,
            rosters: 0
        },
        loadingProgress: {
            rosters: { loaded: 0, total: 30, phase: 'idle' },
            playerStats: { loaded: 0, total: 0, phase: 'idle' }
        },
        cacheLoaded: false  // true if we restored from cache
    },

    listeners: [],

    init() {
        const savedFavs = localStorage.getItem('nbaCompFavs');
        if (savedFavs) {
            try { this.state.favorites = JSON.parse(savedFavs); } catch(e) {}
        }

        const savedSettings = localStorage.getItem('nbaCompSettings');
        if (savedSettings) {
            try { this.state.settings = JSON.parse(savedSettings); } catch(e) {}
        }

        document.body.setAttribute('data-theme', this.state.settings.theme);

        // Force clear cache once to ensure new rating algorithms run
        localStorage.removeItem('nbaCompCache');

        // Load cached data for INSTANT page load
        this.loadCache();
    },

    subscribe(callback) {
        this.listeners.push(callback);
    },

    notify(key) {
        this.listeners.forEach(cb => {
            try { cb(key, this.state); } catch(e) { console.error('Store listener error:', e); }
        });
    },

    toggleFavorite(type, id) {
        if (!this.state.favorites.teams) this.state.favorites.teams = [];
        if (!this.state.favorites.players) this.state.favorites.players = [];
        const list = type === 'team' ? this.state.favorites.teams : this.state.favorites.players;
        const idx = list.indexOf(String(id));
        if (idx === -1) {
            list.push(String(id));
        } else {
            list.splice(idx, 1);
        }
        localStorage.setItem('nbaCompFavs', JSON.stringify(this.state.favorites));
        this.notify('favorites');
    },

    // ==================== DATA CACHE (localStorage) ====================
    /**
     * Save all critical state to localStorage for instant reload.
     * Called after every major data update.
     */
    saveCache() {
        try {
            const cache = {
                teams: this.state.teams,
                teamRankings: this.state.teamRankings,
                players: this.state.players.slice(0, 150), // Cache top 150 players
                rosters: this.state.rosters,
                teamStats: this.state.teamStats,
                teamDetailedStats: this.state.teamDetailedStats,
                lastUpdated: this.state.lastUpdated,
                timestamp: Date.now()
            };
            
            // Try to save; if it exceeds quota, we'll catch and try a smaller version
            try {
                localStorage.setItem('nbaCompCache', JSON.stringify(cache));
            } catch (quotaErr) {
                console.warn('[Cache] Quota exceeded, saving minimal version');
                const minimal = {
                    teams: this.state.teams,
                    teamRankings: this.state.teamRankings,
                    players: this.state.players.slice(0, 50),
                    lastUpdated: this.state.lastUpdated,
                    timestamp: Date.now()
                };
                localStorage.setItem('nbaCompCache', JSON.stringify(minimal));
            }
        } catch (e) {
            console.warn('[Cache] Save failed completely:', e.message);
        }
    },

    /**
     * Load cached data on page load for instant rendering.
     * Data will be refreshed in background.
     */
    loadCache() {
        try {
            const raw = localStorage.getItem('nbaCompCache');
            if (!raw) return;

            const cache = JSON.parse(raw);
            const age = Date.now() - (cache.timestamp || 0);
            const MAX_AGE = 4 * 60 * 60 * 1000; // 4 hours cache age

            if (age > MAX_AGE) {
                console.log('[Cache] Expired, will fetch fresh.');
                return;
            }

            if (cache.teams) this.state.teams = cache.teams;
            if (cache.teamRankings) this.state.teamRankings = cache.teamRankings;
            if (cache.players) this.state.players = cache.players;
            if (cache.rosters) this.state.rosters = cache.rosters;
            if (cache.teamStats) this.state.teamStats = cache.teamStats;
            if (cache.teamDetailedStats) this.state.teamDetailedStats = cache.teamDetailedStats;
            if (cache.lastUpdated) this.state.lastUpdated = { ...this.state.lastUpdated, ...cache.lastUpdated };

            this.state.cacheLoaded = true;
            const ageMins = Math.round(age / 60000);
            console.log(`[Cache] Restored ${cache.teams?.length || 0} teams, ${cache.players?.length || 0} players, ${Object.keys(cache.rosters || {}).length} rosters (${ageMins}m old)`);
        } catch (e) {
            console.warn('[Cache] Load failed:', e.message);
        }
    },

    // ==================== SETTERS ====================
    setGames(games) {
        this.state.games = games;
        this.state.lastUpdated.games = Date.now();
        this.notify('games');
    },

    setTeams(teams) {
        this.state.teams = teams;
        this.state.lastUpdated.teams = Date.now();
        this.notify('teams');
    },

    setTeamStats(teamId, stats) {
        this.state.teamStats[teamId] = stats;
    },

    setRoster(teamId, roster) {
        this.state.rosters[teamId] = roster;
        this.state.lastUpdated.rosters = Date.now();
    },

    setAllPlayers(players) {
        this.state.players = players;
        this.state.lastUpdated.players = Date.now();
        this.notify('players');
        // Save to cache after every player update
        this.saveCache();
    },

    setRankings(rankings) {
        this.state.teamRankings = rankings;
        this.notify('rankings');
        // Save to cache after rankings update
        this.saveCache();
    },

    updateLoadingProgress(category, loaded, total, phase) {
        this.state.loadingProgress[category] = { loaded, total, phase };
        this.notify('loading');
    },

    toggleFavoriteTeam(teamId) {
        const idx = this.state.favorites.teams.indexOf(teamId);
        if (idx > -1) this.state.favorites.teams.splice(idx, 1);
        else this.state.favorites.teams.push(teamId);
        this.saveState();
        this.notify('favorites');
    },

    toggleFavoritePlayer(playerId) {
        const idx = this.state.favorites.players.indexOf(playerId);
        if (idx > -1) this.state.favorites.players.splice(idx, 1);
        else this.state.favorites.players.push(playerId);
        this.saveState();
        this.notify('favorites');
    },

    toggleTheme() {
        this.state.settings.theme = this.state.settings.theme === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', this.state.settings.theme);
        this.saveState();
        this.notify('settings');
    },

    setPreset(preset) {
        this.state.settings.preset = preset;
        this.saveState();
        this.notify('settings');
    },

    saveState() {
        localStorage.setItem('nbaCompFavs', JSON.stringify(this.state.favorites));
        localStorage.setItem('nbaCompSettings', JSON.stringify(this.state.settings));
    }
};

window.store = store;
store.init();
