module.exports = {
    isGameServer: true,
    isDisabled: true,
    subCategory: "SteamCMD",
    createServer: createServer
}

function createServer(ServerName, UserID){
    return {
        name: ServerName,
        user: UserID,
        nest: 4,
        egg: 55,
        docker_image: "quay.io/pterodactyl/core:source",
        startup:
            './server.sh --galaxy-name \\"{{GALAXY_NAME}}\\" --admin {{ADMIN_ID}} --datapath galaxy --port {{SERVER_PORT}} --query-port {{QUERY_PORT}} --steam-master-port {{STEAM_MASTER_PORT}} --steam-query-port {{STEAM_QUERY_PORT}} --max-players {{MAX_PLAYERS}} --difficulty {{DIFFICULTY}} --collision-damage {{COLLISION_DMG}} --save-interval {{SAVE_INTERVAL}} --same-start-sector {{SAME_START_SECTOR}} --server-name \\"{{SERVER_NAME}}\\" --threads {{GAME_THREADS}} --listed {{SERVER_LISTED}}',
        limits: {
            memory: 6144,
            swap: -1,
            disk: 0,
            io: 500,
            cpu: 0,
        },
        environment: {
            GALAXY_NAME: "Avorion",
            SERVER_NAME: "DBH hosted Avorion Server",
            ADMIN_ID: "0",
            MAX_PLAYERS: "10",
            DIFFICULTY: "0",
            COLLISION_DMG: "1",
            SAVE_INTERVAL: "300",
            SAME_START_SECTOR: "true",
            GAME_THREADS: "1",
            SERVER_LISTED: "true",
            SERVER_BETA: "false",
            APP_ID: "565060",
            LD_LIBRARY_PATH: "./linux64",
            STEAM_MASTER_PORT: "27021",
            STEAM_QUERY_PORT: "27020",
            QUERY_PORT: "27003",
        },
        feature_limits: {
            databases: 2,
            allocations: 5,
            backups: 10,
        },
        deploy: {
            locations: gamingPREM,
            dedicated_ip: false,
            port_range: [],
        },
        start_on_completion: false,
        oom_disabled: false,
    };
};