/**
 * database.js
 * Native mysql2 replacement for quick.db globals.
 * Exports named async functions for all DB operations.
 *
 * Tables managed:
 *   userData     — user Discord/Pterodactyl account links
 *   userPrem     — premium donation balances
 *   redeemCodes  — premium redemption codes
 *   nodeStatus   — node online/offline/maintenance status
 *   nodeServers  — server counts per node
 */

const mysql = require("mysql2/promise");
const Config = require("../config.json");

const pool = mysql.createPool({
    host: Config.database.host,
    port: Config.database.port,
    user: Config.database.user,
    password: Config.database.pass,
    database: Config.database.db,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
});

// ---------------------------------------------------------------------------
// Schema init
// ---------------------------------------------------------------------------

async function initDB() {
    await Promise.all([
        pool.execute(`
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
            )
        `),
        pool.execute(`
            CREATE TABLE IF NOT EXISTS userPrem (
                discord_id  VARCHAR(20)    NOT NULL,
                donated     DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
                used        INT            NOT NULL DEFAULT 0,
                created_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (discord_id)
            )
        `),
        pool.execute(`
            CREATE TABLE IF NOT EXISTS redeemCodes (
                code         VARCHAR(100) NOT NULL,
                created_by   VARCHAR(20)  NOT NULL,
                balance      INT          NOT NULL DEFAULT 0,
                created_at   BIGINT       NOT NULL,
                drop_msg_id  VARCHAR(20)  NULL DEFAULT NULL,
                drop_channel VARCHAR(20)  NULL DEFAULT NULL,
                PRIMARY KEY (code)
            )
        `),
        pool.execute(`
            CREATE TABLE IF NOT EXISTS nodeStatus (
                node_key     VARCHAR(100) NOT NULL,
                status       TINYINT(1)   NULL DEFAULT NULL,
                is_vm_online TINYINT(1)   NULL DEFAULT NULL,
                maintenance  TINYINT(1)   NULL DEFAULT NULL,
                timestamp    BIGINT       NOT NULL DEFAULT 0,
                updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (node_key)
            )
        `),
        pool.execute(`
            CREATE TABLE IF NOT EXISTS nodeServers (
                node_key   VARCHAR(100) NOT NULL,
                servers    INT          NOT NULL DEFAULT 0,
                max_count  INT          NOT NULL DEFAULT 0,
                updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (node_key)
            )
        `),
    ]);
}

// ---------------------------------------------------------------------------
// userData
// ---------------------------------------------------------------------------

/**
 * Returns the full user row or null.
 * Replaces: userData.get(discordId)
 */
async function getUserData(discordId) {
    const [[row]] = await pool.execute(
        "SELECT * FROM userData WHERE discord_id = ?",
        [String(discordId)]
    );
    if (!row) return null;
    if (typeof row.domains === "string") {
        try { row.domains = JSON.parse(row.domains); } catch { row.domains = []; }
    }
    // camelCase aliases so existing command code (.consoleID, .linkDate, etc.) works
    row.discordID = row.discord_id;
    row.consoleID = row.console_id;
    row.linkDate  = row.link_date;
    row.linkTime  = row.link_time;
    row.epochTime = row.epoch_time;
    return row;
}

/**
 * Returns a single field value from userData, or null.
 * Replaces: userData.get(discordId + ".fieldName")
 */
async function getUserDataField(discordId, field) {
    const ALLOWED = new Set(["discord_id", "console_id", "email", "username", "link_date", "link_time", "epoch_time", "domains"]);
    if (!ALLOWED.has(field)) throw new Error(`getUserDataField: unknown field '${field}'`);
    const [[row]] = await pool.execute(
        `SELECT \`${field}\` FROM userData WHERE discord_id = ?`,
        [String(discordId)]
    );
    if (!row) return null;
    let val = row[field];
    if (field === "domains" && typeof val === "string") {
        try { val = JSON.parse(val); } catch { val = []; }
    }
    return val;
}

/**
 * Upserts a full user record.
 * Replaces: userData.set(discordId, { consoleID, email, username, linkDate, linkTime, epochTime, domains })
 */
async function setUserData(discordId, data) {
    const domains = JSON.stringify(data.domains ?? []);
    await pool.execute(
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
        [
            String(discordId),
            data.consoleID ?? data.console_id,
            data.email,
            data.username,
            data.linkDate ?? data.link_date,
            data.linkTime ?? data.link_time,
            data.epochTime ?? data.epoch_time ?? 0,
            domains,
        ]
    );
}

/**
 * Updates a single field on an existing userData row.
 * Replaces: userData.set(discordId + ".email", value)
 */
async function updateUserDataField(discordId, field, value) {
    const ALLOWED = new Set(["email", "username", "domains", "console_id", "link_date", "link_time", "epoch_time"]);
    if (!ALLOWED.has(field)) throw new Error(`updateUserDataField: unknown field '${field}'`);
    const stored = field === "domains" ? JSON.stringify(value) : value;
    await pool.execute(
        `UPDATE userData SET \`${field}\` = ? WHERE discord_id = ?`,
        [stored, String(discordId)]
    );
}

/**
 * Deletes a user record.
 * Replaces: userData.delete(discordId)
 */
async function deleteUserData(discordId) {
    await pool.execute("DELETE FROM userData WHERE discord_id = ?", [String(discordId)]);
}

// ---------------------------------------------------------------------------
// userPrem
// ---------------------------------------------------------------------------

/**
 * Returns the full premium row or null.
 * Replaces: userPrem.get(discordId)
 */
async function getUserPrem(discordId) {
    const [[row]] = await pool.execute(
        "SELECT * FROM userPrem WHERE discord_id = ?",
        [String(discordId)]
    );
    if (!row) return null;
    row.donated = parseFloat(row.donated);
    row.used = parseInt(row.used, 10);
    return row;
}

/**
 * Returns a single field from userPrem, or null.
 * Replaces: userPrem.get(discordId + ".donated") / userPrem.get(discordId + ".used")
 */
async function getUserPremField(discordId, field) {
    const ALLOWED = new Set(["donated", "used"]);
    if (!ALLOWED.has(field)) throw new Error(`getUserPremField: unknown field '${field}'`);
    const [[row]] = await pool.execute(
        `SELECT \`${field}\` FROM userPrem WHERE discord_id = ?`,
        [String(discordId)]
    );
    if (!row) return null;
    return field === "donated" ? parseFloat(row[field]) : parseInt(row[field], 10);
}

/**
 * Upserts a full premium record.
 * Replaces: userPrem.set(discordId, { donated, used })
 */
async function setUserPrem(discordId, data) {
    await pool.execute(
        `INSERT INTO userPrem (discord_id, donated, used)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE donated = VALUES(donated), used = VALUES(used)`,
        [String(discordId), data.donated ?? 0, data.used ?? 0]
    );
}

/**
 * Updates a single field on userPrem, inserting the row if it doesn't exist.
 * Replaces: userPrem.set(discordId + ".used", 0) / userPrem.set(discordId + ".donated", n)
 */
async function setUserPremField(discordId, field, value) {
    const ALLOWED = new Set(["donated", "used"]);
    if (!ALLOWED.has(field)) throw new Error(`setUserPremField: unknown field '${field}'`);
    await pool.execute(
        `INSERT INTO userPrem (discord_id, ${field})
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`${field}\` = VALUES(\`${field}\`)`,
        [String(discordId), value]
    );
}

/**
 * Ensures a userPrem row exists with defaults (donated=0, used=0).
 * Replaces the repetitive null-check + set-defaults pattern.
 */
async function ensureUserPrem(discordId) {
    await pool.execute(
        "INSERT IGNORE INTO userPrem (discord_id, donated, used) VALUES (?, 0, 0)",
        [String(discordId)]
    );
}

/**
 * Atomically increments used count.
 * Replaces: userPrem.add(discordId + ".used", amount)
 */
async function incrementUserPremUsed(discordId, amount = 1) {
    await pool.execute(
        `INSERT INTO userPrem (discord_id, donated, used)
         VALUES (?, 0, ?)
         ON DUPLICATE KEY UPDATE used = used + VALUES(used)`,
        [String(discordId), amount]
    );
}

/**
 * Atomically decrements used count (floor 0).
 * Replaces: userPrem.sub(discordId + ".used", amount)
 */
async function decrementUserPremUsed(discordId, amount = 1) {
    await pool.execute(
        "UPDATE userPrem SET used = GREATEST(0, used - ?) WHERE discord_id = ?",
        [amount, String(discordId)]
    );
}

/**
 * Deletes a premium record.
 * Replaces: userPrem.delete(discordId)
 */
async function deleteUserPrem(discordId) {
    await pool.execute("DELETE FROM userPrem WHERE discord_id = ?", [String(discordId)]);
}

// ---------------------------------------------------------------------------
// redeemCodes
// ---------------------------------------------------------------------------

/**
 * Returns a code object in the shape callers expect, or null.
 * Shape: { code, createdBy, balance, createdAt, drop: {message:{ID,channel}} | null }
 * Replaces: codes.get(code)
 */
async function getCode(code) {
    const [[row]] = await pool.execute(
        "SELECT * FROM redeemCodes WHERE code = ?",
        [String(code)]
    );
    if (!row) return null;
    return {
        code: row.code,
        createdBy: row.created_by,
        balance: row.balance,
        createdAt: row.created_at,
        drop: (row.drop_msg_id && row.drop_channel)
            ? { message: { ID: row.drop_msg_id, channel: row.drop_channel } }
            : null,
    };
}

/**
 * Upserts a code record.
 * Replaces: codes.set(code, { code, createdBy, balance, createdAt })
 */
async function setCode(code, data) {
    await pool.execute(
        `INSERT INTO redeemCodes (code, created_by, balance, created_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             created_by = VALUES(created_by),
             balance    = VALUES(balance),
             created_at = VALUES(created_at)`,
        [String(code), data.createdBy, data.balance, data.createdAt]
    );
}

/**
 * Sets the drop message metadata on an existing code.
 * Replaces: codes.set(code + ".drop", { message: { ID, channel } })
 */
async function setCodeDrop(code, dropData) {
    await pool.execute(
        "UPDATE redeemCodes SET drop_msg_id = ?, drop_channel = ? WHERE code = ?",
        [dropData.message.ID, dropData.message.channel, String(code)]
    );
}

/**
 * Deletes a single code.
 * Replaces: codes.delete(code)
 */
async function deleteCode(code) {
    await pool.execute("DELETE FROM redeemCodes WHERE code = ?", [String(code)]);
}

/**
 * Deletes all codes.
 * Replaces: codes.deleteAll()
 */
async function deleteAllCodes() {
    await pool.execute("DELETE FROM redeemCodes");
}

// ---------------------------------------------------------------------------
// nodeStatus
// ---------------------------------------------------------------------------

/**
 * Returns a node status object or null.
 * TINYINT(1) values are converted: null → null, 0 → false, 1 → true.
 * Replaces: nodeStatus.get(nodeKey)
 */
async function getNodeStatus(nodeKey) {
    const [[row]] = await pool.execute(
        "SELECT * FROM nodeStatus WHERE node_key = ?",
        [String(nodeKey).toLowerCase()]
    );
    if (!row) return null;
    return {
        node_key:     row.node_key,
        status:       row.status       === null ? null : row.status       === 1,
        is_vm_online: row.is_vm_online === null ? null : row.is_vm_online === 1,
        maintenance:  row.maintenance  === null ? null : row.maintenance  === 1,
        timestamp:    row.timestamp,
    };
}

/**
 * Upserts one or more fields on a nodeStatus row.
 * Accepts any subset of { timestamp, status, is_vm_online, maintenance }.
 * Replaces multiple: nodeStatus.set(key + ".field", val)
 *
 * Example:
 *   await db.setNodeStatusFields("pnode1", { status: true, timestamp: Date.now() });
 */
async function setNodeStatusFields(nodeKey, fields) {
    const ALLOWED = new Set(["timestamp", "status", "is_vm_online", "maintenance"]);
    const entries = Object.entries(fields).filter(([k]) => ALLOWED.has(k));
    if (entries.length === 0) return;

    const key = String(nodeKey).toLowerCase();
    const cols = entries.map(([k]) => k);
    const vals = entries.map(([, v]) => (typeof v === "boolean" ? (v ? 1 : 0) : v));

    const insertCols = ["node_key", ...cols].join(", ");
    const insertPlaceholders = ["?", ...cols.map(() => "?")].join(", ");
    const updateClauses = cols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");

    await pool.execute(
        `INSERT INTO nodeStatus (${insertCols}) VALUES (${insertPlaceholders})
         ON DUPLICATE KEY UPDATE ${updateClauses}`,
        [key, ...vals]
    );
}

// ---------------------------------------------------------------------------
// nodeServers
// ---------------------------------------------------------------------------

/**
 * Returns { node_key, servers, max_count } or null.
 * Replaces: nodeServers.get(nodeKey)
 */
async function getNodeServers(nodeKey) {
    const [[row]] = await pool.execute(
        "SELECT * FROM nodeServers WHERE node_key = ?",
        [String(nodeKey).toLowerCase()]
    );
    if (!row) return null;
    return { node_key: row.node_key, servers: row.servers, max_count: row.max_count, maxCount: row.max_count };
}

/**
 * Upserts server count data for a node.
 * Replaces: nodeServers.set(nodeKey, { servers, maxCount })
 */
async function setNodeServers(nodeKey, data) {
    await pool.execute(
        `INSERT INTO nodeServers (node_key, servers, max_count)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE servers = VALUES(servers), max_count = VALUES(max_count)`,
        [String(nodeKey).toLowerCase(), data.servers ?? 0, data.maxCount ?? data.max_count ?? 0]
    );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    pool,
    initDB,

    // userData
    getUserData,
    getUserDataField,
    setUserData,
    updateUserDataField,
    deleteUserData,

    // userPrem
    getUserPrem,
    getUserPremField,
    setUserPrem,
    setUserPremField,
    ensureUserPrem,
    incrementUserPremUsed,
    decrementUserPremUsed,
    deleteUserPrem,

    // redeemCodes
    getCode,
    setCode,
    setCodeDrop,
    deleteCode,
    deleteAllCodes,

    // nodeStatus
    getNodeStatus,
    setNodeStatusFields,

    // nodeServers
    getNodeServers,
    setNodeServers,
};
