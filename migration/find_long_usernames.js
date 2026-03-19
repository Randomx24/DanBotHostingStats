/**
 * find_long_usernames.js
 * Finds userData_kv rows where the parsed username exceeds VARCHAR(100).
 * Run with: node migration/find_long_usernames.js
 */

const mysql = require("mysql2/promise");
const Config = require("../config.json");

async function main() {
    const conn = await mysql.createConnection({
        host: Config.database.host,
        port: Config.database.port,
        user: Config.database.user,
        password: Config.database.pass,
        database: Config.database.db,
    });

    const [rows] = await conn.query("SELECT ID, `json` FROM `userData_kv`");

    const offenders = [];

    for (const row of rows) {
        let data;
        try { data = JSON.parse(row.json); } catch { continue; }
        if (typeof data !== "object" || data === null) continue;

        const username = data.username ?? data.Username ?? null;
        if (username && String(username).length > 100) {
            offenders.push({
                discord_id: row.ID,
                username: String(username),
                length: String(username).length,
            });
        }
    }

    if (offenders.length === 0) {
        console.log("No usernames exceed 100 characters.");
    } else {
        console.log(`Found ${offenders.length} row(s) with username > 100 chars:\n`);
        for (const o of offenders) {
            console.log(`  discord_id: ${o.discord_id}`);
            console.log(`  username:   ${o.username}`);
            console.log(`  length:     ${o.length}`);
            console.log();
        }
    }

    await conn.end();
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
