/**
 * debug-status.js
 * Dumps raw DB values for every node/service key used in the status embed.
 * Simulates the same logic as parseStatus() in src/serverStatus.js.
 *
 * Run with: node debug-status.js
 */

const mysql = require("mysql2/promise");
const Config = require("./config.json");
const Status = require("./config/status-configs.js");

async function main() {
    const conn = await mysql.createConnection({
        host: Config.database.host,
        port: Config.database.port,
        user: Config.database.user,
        password: Config.database.pass,
        database: Config.database.db,
    });

    console.log(`\nConnected to MySQL: ${Config.database.host}:${Config.database.port} / ${Config.database.db}\n`);

    // -------------------------------------------------------------------------
    // Nodes
    // -------------------------------------------------------------------------
    console.log("=".repeat(70));
    console.log("NODES");
    console.log("=".repeat(70));

    for (const [category, nodes] of Object.entries(Status.Nodes)) {
        console.log(`\n[${category}]`);

        for (const [nodeKey, data] of Object.entries(nodes)) {
            const key = nodeKey.toLowerCase();

            const [[statusRow]] = await conn.execute(
                "SELECT * FROM nodeStatus WHERE node_key = ?", [key]
            );
            const [[serverRow]] = await conn.execute(
                "SELECT * FROM nodeServers WHERE node_key = ?", [key]
            );

            console.log(`\n  Node key : ${key}`);
            console.log(`  Name     : ${data.Name}`);
            console.log(`  MaxLimit : ${data.MaxLimit} (from config)`);

            if (!statusRow) {
                console.log(`  nodeStatus  → ⚠️  NO ROW FOUND`);
            } else {
                console.log(`  nodeStatus  → status=${statusRow.status} | is_vm_online=${statusRow.is_vm_online} | maintenance=${statusRow.maintenance} | timestamp=${statusRow.timestamp}`);
            }

            if (!serverRow) {
                console.log(`  nodeServers → ⚠️  NO ROW FOUND`);
            } else {
                console.log(`  nodeServers → servers=${serverRow.servers} | max_count=${serverRow.max_count}`);
            }

            // Simulate what parseStatus() would compute
            const ns = statusRow ? {
                status:       statusRow.status       === null ? null : statusRow.status       === 1,
                is_vm_online: statusRow.is_vm_online === null ? null : statusRow.is_vm_online === 1,
                maintenance:  statusRow.maintenance  === null ? null : statusRow.maintenance  === 1,
            } : null;

            const maxCount = serverRow?.max_count ?? "N/A";
            const servers  = serverRow?.servers  ?? "N/A";
            const serverUsage = serverRow ? `(${servers} / ${maxCount})` : "";

            let statusText;
            if (!ns) {
                statusText = "❓ no data in DB";
            } else if (ns.maintenance) {
                statusText = `🟣 Maintenance ~ Returning Soon!`;
            } else if (ns.status) {
                statusText = `🟢 Online ${serverUsage}`;
            } else if (ns.is_vm_online == null) {
                statusText = "🔴 Offline";
            } else {
                statusText = (ns.is_vm_online ? "🟠 Wings" : "🔴 System") + ` offline ${serverUsage}`;
            }

            console.log(`  → Computed: ${statusText}`);
        }
    }

    // -------------------------------------------------------------------------
    // Other categories (VPS Hosting, Misc, etc.)
    // -------------------------------------------------------------------------
    for (const [category, services] of Object.entries(Status)) {
        if (category === "Nodes") continue;

        console.log(`\n${"=".repeat(70)}`);
        console.log(category.toUpperCase());
        console.log("=".repeat(70));

        for (const [name, data] of Object.entries(services)) {
            const key = name.toLowerCase();

            const [[statusRow]] = await conn.execute(
                "SELECT * FROM nodeStatus WHERE node_key = ?", [key]
            );

            console.log(`\n  Service key : ${key}`);
            console.log(`  Name        : ${data.name}`);

            if (!statusRow) {
                console.log(`  nodeStatus  → ⚠️  NO ROW FOUND`);
            } else {
                console.log(`  nodeStatus  → status=${statusRow.status} | timestamp=${statusRow.timestamp}`);
            }

            const statusBool = statusRow ? statusRow.status === 1 : null;
            const statusText = statusBool === null
                ? "❓ no data in DB"
                : (statusBool ? "🟢 Online" : "🔴 Offline");

            console.log(`  → Computed: ${statusText}`);
        }
    }

    console.log("\n" + "=".repeat(70));
    console.log("Done.");
    console.log("=".repeat(70) + "\n");

    await conn.end();
}

main().catch((err) => {
    console.error("Error:", err.message);
    console.error(err.stack);
    process.exit(1);
});
