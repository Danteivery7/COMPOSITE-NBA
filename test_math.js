// Verification script to test models.js
const fs = require('fs');

// We need to simulate the environment
global.store = {
    state: {
        rosters: {},
        leagueStats: {},
        roleStats: {},
        players: []
    },
    setRankings() {},
    setPlayers(p) { this.state.players = p; }
};

// We need to load models.js
const modelsCode = fs.readFileSync('d:\\COMPOSITE NBA\\js\\models.js', 'utf8');
// eval the models code so it defines `const models = ...` in this context
eval(modelsCode.replace('const models =', 'global.models ='));

// Load some raw players from the cache if we can, or just mock one to see if there's syntax errors
try {
    const cacheStr = fs.readFileSync('C:\\Users\\dante\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Local Storage\\leveldb', 'utf8');
    // Actually we can't easily read chrome local storage from node.
} catch(e) {}

// Let's just create a mock list of players to test the math
store.state.rosters = {
    "1": {
        athletes: [
            { id: 1, position: {abbreviation: 'C'}, fullName: 'Jalen Duren', realStats: { gp: 40, gs: 40, mpg: 34, ppg: 14, rpg: 14, apg: 2, spg: 0.5, bpg: 1.5, per: 22, tsPct: 65, efgPct: 62, tovPg: 1.5, fga: 10, fta: 4 } },
            { id: 2, position: {abbreviation: 'PG'}, fullName: 'Luka Doncic', realStats: { gp: 40, gs: 40, mpg: 36, ppg: 33, rpg: 9, apg: 9, spg: 1.5, bpg: 0.5, per: 28, tsPct: 59, efgPct: 55, tovPg: 4, fga: 22, fta: 10, assistRatio: 35 } },
            { id: 3, position: {abbreviation: 'SF'}, fullName: 'Jayson Tatum', realStats: { gp: 40, gs: 40, mpg: 36, ppg: 27, rpg: 8, apg: 5, spg: 1.0, bpg: 0.6, per: 24, tsPct: 60, efgPct: 55, tovPg: 2.5, fga: 19, fta: 7, assistRatio: 18 } }
        ]
    }
};

models.computeLeagueStats();

const duren = models.generatePlayerRating(store.state.rosters["1"].athletes[0]);
const luka = models.generatePlayerRating(store.state.rosters["1"].athletes[1]);
const tatum = models.generatePlayerRating(store.state.rosters["1"].athletes[2]);

console.log('Jalen Duren OVR:', duren.rating, 'OFF:', duren.offRating, 'DEF:', duren.defRating);
console.log('Luka Doncic OVR:', luka.rating, 'OFF:', luka.offRating, 'DEF:', luka.defRating);
console.log('Jayson Tatum OVR:', tatum.rating, 'OFF:', tatum.offRating, 'DEF:', tatum.defRating);
