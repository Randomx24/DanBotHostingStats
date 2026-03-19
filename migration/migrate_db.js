/**
 * migrate_db.js
 * One-time migration from quick.db KV format to native MySQL schemas.
 * Safe to re-run (uses ON DUPLICATE KEY UPDATE — idempotent).
 *
 * Run AFTER backup_db.js and AFTER src/database.js schemas exist.
 * Run with: node migration/migrate_db.js
 *
 * Algorithm per KV table:
 *   1. Fetch all rows (including dot-notation fragment rows like "123.used")
 *   2. Reconstruct full objects by merging fragments into their parent keys
 *   3. Insert into new relational tables using ON DUPLICATE KEY UPDATE
 */

const mysql = require("mysql2/promise");
const Config = require("../config.json");

function isKVFormat(columns) {
    const names = new Set(columns.map((c) => c.Field));
    return names.size === 2 && names.has("ID") && names.has("json");
}

/**
 * Merges quick.db KV rows (including dot-notation fragments) into a Map of
 * rootKey → merged plain object.
 */
function mergeKVRows(rows) {
    const rootMap = new Map();
    const fragments = [];

    for (const row of rows) {
        let value;
        try { value = JSON.parse(row.json); } catch { value = row.json; }

        if (!row.ID.includes(".")) {
            const existing = rootMap.get(row.ID);
            if (existing && typeof existing === "object" && typeof value === "object" && value !== null) {
                rootMap.set(row.ID, Object.assign({}, existing, value));
            } else {
                rootMap.set(row.ID, value);
            }
        } else {
            fragments.push({ id: row.ID, value });
        }
    }

    for (const frag of fragments) {
        const dotIdx = frag.id.indexOf(".");
        const parentKey = frag.id.slice(0, dotIdx);
        const fieldPath = frag.id.slice(dotIdx + 1);

        let obj = rootMap.get(parentKey);
        if (obj === undefined || obj === null || typeof obj !== "object") {
            obj = {};
            rootMap.set(parentKey, obj);
        }

        const parts = fieldPath.split(".");
        let cursor = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (typeof cursor[parts[i]] !== "object" || cursor[parts[i]] === null) {
                cursor[parts[i]] = {};
            }
            cursor = cursor[parts[i]];
        }
        cursor[parts[parts.length - 1]] = frag.value;
    }

    return rootMap;
}

// ---------------------------------------------------------------------------
// Per-table migration functions
// ---------------------------------------------------------------------------

const PROGRESS_INTERVAL = 500;

function logProgress(label, done, total, skipped) {
    const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "100.0";
    console.log(`  [${label}] ${done}/${total} (${pct}%) — skipped: ${skipped}`);
}

async function migrateUserData(conn, rows) {
    const map = mergeKVRows(rows);
    const total = map.size;
    let inserted = 0, skipped = 0, i = 0;

    for (const [discordId, data] of map) {
        i++;
        if (!data || typeof data !== "object") { skipped++; continue; }

        const consoleId = data.consoleID ?? data.console_id ?? null;
        const email     = data.email     ?? null;
        const username  = data.username  ? String(data.username).slice(0, 100) : null;
        const linkDate  = data.linkDate  ?? data.link_date  ?? "";
        const linkTime  = data.linkTime  ?? data.link_time  ?? "";
        const epochTime = data.epochTime ?? data.epoch_time ?? 0;
        const domains   = JSON.stringify(data.domains ?? []);

        if (!consoleId || !email || !username) { skipped++; continue; }

        await conn.execute(
            `INSERT INTO userData (discord_id, console_id, email, username, link_date, link_time, epoch_time, domains)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 console_id = VALUES(console_id),
                 email      = VALUES(email),
                 username   = VALUES(username),
                 link_date  = VALUES(link_date),
                 link_time  = VALUES(link_time),
                 epoch_time = VALUES(epoch_time),
                 domains    = VALUES(domains)`,
            [String(discordId), consoleId, email, username, linkDate, linkTime, epochTime, domains]
        );
        inserted++;
        if (i % PROGRESS_INTERVAL === 0 || i === total) logProgress("userData", i, total, skipped);
    }
    return { inserted, skipped };
}

async function migrateUserPrem(conn, rows) {
    const map = mergeKVRows(rows);
    const total = map.size;
    let inserted = 0, skipped = 0, i = 0;

    for (const [discordId, data] of map) {
        i++;
        if (!data || typeof data !== "object") { skipped++; continue; }

        const donated = parseFloat(data.donated ?? 0) || 0;
        const used    = parseInt(data.used    ?? 0, 10) || 0;

        await conn.execute(
            `INSERT INTO userPrem (discord_id, donated, used)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE donated = VALUES(donated), used = VALUES(used)`,
            [String(discordId), donated, used]
        );
        inserted++;
        if (i % PROGRESS_INTERVAL === 0 || i === total) logProgress("userPrem", i, total, skipped);
    }
    return { inserted, skipped };
}

async function migrateRedeemCodes(conn, rows) {
    const map = mergeKVRows(rows);
    const total = map.size;
    let inserted = 0, skipped = 0, i = 0;

    for (const [codeKey, data] of map) {
        i++;
        if (!data || typeof data !== "object") { skipped++; continue; }

        const code      = data.code      ?? codeKey;
        const createdBy = data.createdBy ?? null;
        const balance   = parseInt(data.balance ?? 0, 10);
        const createdAt = data.createdAt ?? Date.now();

        const dropMsgId   = data.drop?.message?.ID      ?? null;
        const dropChannel = data.drop?.message?.channel ?? null;

        if (!createdBy) { skipped++; continue; }

        await conn.execute(
            `INSERT INTO redeemCodes (code, created_by, balance, created_at, drop_msg_id, drop_channel)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 created_by   = VALUES(created_by),
                 balance      = VALUES(balance),
                 created_at   = VALUES(created_at),
                 drop_msg_id  = VALUES(drop_msg_id),
                 drop_channel = VALUES(drop_channel)`,
            [String(code), createdBy, balance, createdAt, dropMsgId, dropChannel]
        );
        inserted++;
        if (i % PROGRESS_INTERVAL === 0 || i === total) logProgress("redeemCodes", i, total, skipped);
    }
    return { inserted, skipped };
}

async function migrateNodeStatus(conn, rows) {
    // nodeStatus stores root-level objects per node (e.g. ID="pnode1", json="{status:true,...}")
    const map = new Map();

    for (const row of rows) {
        let value;
        try { value = JSON.parse(row.json); } catch { value = row.json; }

        if (!row.ID.includes(".")) {
            if (typeof value === "object" && value !== null) {
                const existing = map.get(row.ID) ?? {};
                map.set(row.ID, Object.assign({}, existing, value));
            }
            continue;
        }

        const dotIdx    = row.ID.indexOf(".");
        const nodeKey   = row.ID.slice(0, dotIdx).toLowerCase();
        const fieldName = row.ID.slice(dotIdx + 1);

        if (!map.has(nodeKey)) map.set(nodeKey, {});
        map.get(nodeKey)[fieldName] = value;
    }

    const total = map.size;
    let inserted = 0, i = 0;
    for (const [nodeKey, data] of map) {
        i++;
        const status      = data.status       === undefined ? null : (data.status       ? 1 : 0);
        const isVmOnline  = data.is_vm_online === undefined ? null : (data.is_vm_online ? 1 : 0);
        const maintenance = data.maintenance  === undefined ? null : (data.maintenance  ? 1 : 0);
        const timestamp   = data.timestamp    ?? 0;

        await conn.execute(
            `INSERT INTO nodeStatus (node_key, status, is_vm_online, maintenance, timestamp)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 status       = VALUES(status),
                 is_vm_online = VALUES(is_vm_online),
                 maintenance  = VALUES(maintenance),
                 timestamp    = VALUES(timestamp)`,
            [nodeKey, status, isVmOnline, maintenance, timestamp]
        );
        inserted++;
        if (i % PROGRESS_INTERVAL === 0 || i === total) logProgress("nodeStatus", i, total, 0);
    }
    return { inserted, skipped: 0 };
}

async function migrateNodeServers(conn, rows) {
    const map = mergeKVRows(rows);
    const total = map.size;
    let inserted = 0, skipped = 0, i = 0;

    for (const [nodeKey, data] of map) {
        i++;
        if (!data || typeof data !== "object") { skipped++; continue; }

        const servers  = parseInt(data.servers  ?? 0, 10);
        const maxCount = parseInt(data.maxCount ?? data.max_count ?? 0, 10);

        await conn.execute(
            `INSERT INTO nodeServers (node_key, servers, max_count)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE servers = VALUES(servers), max_count = VALUES(max_count)`,
            [String(nodeKey).toLowerCase(), servers, maxCount]
        );
        inserted++;
        if (i % PROGRESS_INTERVAL === 0 || i === total) logProgress("nodeServers", i, total, skipped);
    }
    return { inserted, skipped };
}

// ---------------------------------------------------------------------------
// Relational DDL
// ---------------------------------------------------------------------------

const CREATE_TABLES = {
    userData: `
        CREATE TABLE IF NOT EXISTS userData (
            discord_id  VARCHAR(20)  NOT NULL,
            console_id  INT          NOT NULL,
            email       VARCHAR(255) NOT NULL,
            username    VARCHAR(100) NOT NULL,
            link_date   VARCHAR(20)  NOT NULL,
            link_time   VARCHAR(20)  NOT NULL,
            epoch_time  DOUBLE       NOT NULL DEFAULT 0,
            domains     JSON         NOT NULL,
            created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (discord_id)
        )`,
    userPrem: `
        CREATE TABLE IF NOT EXISTS userPrem (
            discord_id  VARCHAR(20)    NOT NULL,
            donated     DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
            used        INT            NOT NULL DEFAULT 0,
            created_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (discord_id)
        )`,
    redeemCodes: `
        CREATE TABLE IF NOT EXISTS redeemCodes (
            code         VARCHAR(100) NOT NULL,
            created_by   VARCHAR(20)  NOT NULL,
            balance      INT          NOT NULL DEFAULT 0,
            created_at   BIGINT       NOT NULL,
            drop_msg_id  VARCHAR(20)  NULL DEFAULT NULL,
            drop_channel VARCHAR(20)  NULL DEFAULT NULL,
            PRIMARY KEY (code)
        )`,
    nodeStatus: `
        CREATE TABLE IF NOT EXISTS nodeStatus (
            node_key     VARCHAR(100) NOT NULL,
            status       TINYINT(1)   NULL DEFAULT NULL,
            is_vm_online TINYINT(1)   NULL DEFAULT NULL,
            maintenance  TINYINT(1)   NULL DEFAULT NULL,
            timestamp    BIGINT       NOT NULL DEFAULT 0,
            updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (node_key)
        )`,
    nodeServers: `
        CREATE TABLE IF NOT EXISTS nodeServers (
            node_key   VARCHAR(100) NOT NULL,
            servers    INT          NOT NULL DEFAULT 0,
            max_count  INT          NOT NULL DEFAULT 0,
            updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (node_key)
        )`,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const MIGRATIONS = [
    { table: "userData",    fn: migrateUserData    },
    { table: "userPrem",    fn: migrateUserPrem    },
    { table: "redeemCodes", fn: migrateRedeemCodes },
    { table: "nodeStatus",  fn: migrateNodeStatus  },
    { table: "nodeServers", fn: migrateNodeServers },
];

async function main() {
    const conn = await mysql.createConnection({
        host: Config.database.host,
        port: Config.database.port,
        user: Config.database.user,
        password: Config.database.pass,
        database: Config.database.db,
        multipleStatements: false,
    });

    console.log(`\nConnected to MySQL: ${Config.database.host}:${Config.database.port} / ${Config.database.db}\n`);

    const [tables] = await conn.query("SHOW TABLES");
    const tableKey = Object.keys(tables[0])[0];
    let existingTables = new Set(tables.map((r) => r[tableKey]));

    console.log("Starting migration...\n");
    const summary = [];

    for (const { table, fn } of MIGRATIONS) {
        const kvBackup = `${table}_kv`;

        let sourceTable;
        if (existingTables.has(kvBackup)) {
            sourceTable = kvBackup;

            if (!existingTables.has(table)) {
                console.log(`  Creating new relational ${table} table...`);
                await conn.query(CREATE_TABLES[table]);
                existingTables.add(table);
            } else {
                const [columns] = await conn.query(`DESCRIBE \`${table}\``);
                if (isKVFormat(columns)) {
                    const kvBackup2 = `${table}_kv2`;
                    console.log(`  ⚠️  ${table} still in KV format — renaming to ${kvBackup2}`);
                    await conn.query(`RENAME TABLE \`${table}\` TO \`${kvBackup2}\``);
                    await conn.query(CREATE_TABLES[table]);
                }
            }
        } else if (existingTables.has(table)) {
            const [columns] = await conn.query(`DESCRIBE \`${table}\``);
            if (!isKVFormat(columns)) {
                console.log(`SKIP: ${table} — already relational, no KV backup found`);
                summary.push({ table, status: "skipped", reason: "already relational" });
                continue;
            }
            console.log(`  Renaming ${table} → ${kvBackup}...`);
            await conn.query(`RENAME TABLE \`${table}\` TO \`${kvBackup}\``);
            existingTables.add(kvBackup);
            existingTables.delete(table);
            console.log(`  Creating new relational ${table} table...`);
            await conn.query(CREATE_TABLES[table]);
            existingTables.add(table);
            sourceTable = kvBackup;
        } else {
            console.log(`SKIP: ${table} — table does not exist`);
            summary.push({ table, status: "skipped", reason: "does not exist" });
            continue;
        }

        console.log(`Migrating: ${table} (from ${sourceTable})...`);
        const [rows] = await conn.query(`SELECT ID, \`json\` FROM \`${sourceTable}\``);
        console.log(`  Found ${rows.length} KV rows in ${sourceTable}`);

        const result = await fn(conn, rows);
        console.log(`  ✅ Inserted/updated: ${result.inserted}, Skipped: ${result.skipped}`);
        summary.push({ table, status: "migrated", ...result });
    }

    console.log("\n" + "=".repeat(60));
    console.log("MIGRATION SUMMARY");
    console.log("=".repeat(60));
    for (const s of summary) {
        if (s.status === "migrated") {
            console.log(`  ✅ ${s.table}: ${s.inserted} rows inserted/updated, ${s.skipped} skipped`);
        } else {
            console.log(`  ⏭️  ${s.table}: ${s.reason}`);
        }
    }
    console.log("\n⚠️  The old KV tables were renamed to *_kv (e.g. userData_kv).");
    console.log("    Verify row counts then drop them manually once migration is confirmed.\n");

    await conn.end();
    console.log("Connection closed. Migration complete.");
}

main().catch((err) => {
    console.error("Error:", err.message);
    console.error(err.stack);
    process.exit(1);
});
