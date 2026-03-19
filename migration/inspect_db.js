/**
 * inspect_db.js
 * Debug script: connects to MySQL and lists all tables, schemas, row counts, and sample data.
 * Detects which tables are still in quick.db KV format (ID, json columns).
 *
 * Run with: node migration/inspect_db.js
 */

const mysql = require("mysql2/promise");
const Config = require("../config.json");

function isKVFormat(columns) {
    const names = new Set(columns.map((c) => c.Field));
    return names.size === 2 && names.has("ID") && names.has("json");
}

async function main() {
    const connection = await mysql.createConnection({
        host: Config.database.host,
        port: Config.database.port,
        user: Config.database.user,
        password: Config.database.pass,
        database: Config.database.db,
    });

    console.log(`\nConnected to MySQL: ${Config.database.host}:${Config.database.port} / ${Config.database.db}\n`);

    const [tables] = await connection.query("SHOW TABLES");
    const tableKey = Object.keys(tables[0])[0];

    if (tables.length === 0) {
        console.log("No tables found.");
        await connection.end();
        return;
    }

    console.log(`Found ${tables.length} table(s):\n`);

    for (const row of tables) {
        const tableName = row[tableKey];

        console.log("=".repeat(60));
        console.log(`TABLE: ${tableName}`);
        console.log("=".repeat(60));

        const [columns] = await connection.query(`DESCRIBE \`${tableName}\``);
        const kv = isKVFormat(columns);
        console.log(`FORMAT: ${kv ? "⚠️  quick.db KV format (ID, json) — needs migration" : "✅  relational schema"}`);
        console.log("\nCOLUMNS:");
        for (const col of columns) {
            const nullable = col.Null === "YES" ? "NULL" : "NOT NULL";
            const key = col.Key ? ` [${col.Key}]` : "";
            const def = col.Default !== null ? ` DEFAULT '${col.Default}'` : "";
            console.log(`  ${col.Field.padEnd(20)} ${col.Type.padEnd(25)} ${nullable}${key}${def}`);
        }

        const [[countRow]] = await connection.query(`SELECT COUNT(*) AS cnt FROM \`${tableName}\``);
        console.log(`\nROW COUNT: ${countRow.cnt}`);

        const [sampleRows] = await connection.query(`SELECT * FROM \`${tableName}\` LIMIT 3`);
        if (sampleRows.length === 0) {
            console.log("\nSAMPLE: (empty table)");
        } else {
            console.log(`\nSAMPLE (up to 3 rows):`);
            for (const sRow of sampleRows) {
                console.log("  ---");
                for (const [k, v] of Object.entries(sRow)) {
                    let display = v;
                    if (typeof v === "string" && v.length > 120) {
                        display = v.slice(0, 120) + "…";
                    }
                    console.log(`  ${String(k).padEnd(20)} ${display}`);
                }
            }
        }

        console.log();
    }

    // Summary
    const kvTables = [];
    const relTables = [];
    for (const row of tables) {
        const tableName = row[tableKey];
        const [columns] = await connection.query(`DESCRIBE \`${tableName}\``);
        (isKVFormat(columns) ? kvTables : relTables).push(tableName);
    }

    console.log("=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    if (kvTables.length > 0) {
        console.log(`\n⚠️  Tables still in quick.db KV format (need migration):`);
        for (const t of kvTables) console.log(`     - ${t}`);
    }
    if (relTables.length > 0) {
        console.log(`\n✅  Tables already in relational format:`);
        for (const t of relTables) console.log(`     - ${t}`);
    }
    console.log();

    await connection.end();
    console.log("Connection closed.");
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
