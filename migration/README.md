# Database Migration: quick.db → Native MySQL

## Overview

The bot previously used **quick.db v9.1.7** with a `MySQLDriver` backend. quick.db stores all data as key-value pairs in MySQL tables with exactly two columns: `ID VARCHAR(255) PRIMARY KEY` and `json TEXT`. Every value — regardless of type or complexity — was serialized to JSON and stored in the `json` column.

This migration replaced that with **native mysql2/promise** and a proper relational schema, giving us typed columns, indexes, atomic operations, and direct SQL queries.

---

## What Changed

### Removed
- `quick.db` package (removed from `package.json`)
- All global DB variables in `index.js`: `userData`, `userPrem`, `codes`, `nodeStatus`, `nodeServers`
- The `MySQLDriver` and `QuickDB` setup in `index.js`

### Added
- **`src/database.js`** — single module with a mysql2 connection pool and all CRUD functions
- `initDB()` called on bot startup to ensure tables exist

### Updated
- All ~25 command and event files updated to use `db.*` functions instead of globals

---

## Old Table Structure (quick.db KV format)

```
ID varchar(255) PRIMARY KEY
json text
```

Every row stored one serialized value. For example:

```
ID: "123456789"   json: '{"email":"user@example.com","consoleID":42,"username":"player1",...}'
ID: "123456789.email"   json: '"user@example.com"'   ← dot-notation fragment (field override)
```

---

## New Relational Schemas

### `userData`
| Column | Type | Notes |
|---|---|---|
| discord_id | VARCHAR(20) PK | Discord user ID |
| console_id | INT | Pterodactyl panel user ID |
| email | VARCHAR(255) | |
| username | VARCHAR(100) | Truncated at 100 chars during migration |
| link_date | VARCHAR(20) | |
| link_time | VARCHAR(20) | |
| epoch_time | DOUBLE | Unix timestamp of account link |
| domains | JSON | Array of custom domains |
| created_at | TIMESTAMP | Auto-set on insert |
| updated_at | TIMESTAMP | Auto-updated on change |

### `userPrem`
| Column | Type | Notes |
|---|---|---|
| discord_id | VARCHAR(20) PK | |
| donated | DECIMAL(10,2) | Total donated amount |
| used | INT | Servers created with premium allocation |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### `redeemCodes`
| Column | Type | Notes |
|---|---|---|
| code | VARCHAR(100) PK | Redeem code string |
| created_by | VARCHAR(20) | Discord ID of staff who created it |
| balance | INT | Server slots the code grants |
| created_at | BIGINT | Unix ms timestamp |
| drop_msg_id | VARCHAR(20) NULL | Message ID if code was dropped in a channel |
| drop_channel | VARCHAR(20) NULL | Channel ID of the drop |

### `nodeStatus`
| Column | Type | Notes |
|---|---|---|
| node_key | VARCHAR(100) PK | e.g. `pnode1` |
| status | TINYINT(1) NULL | Online/offline (null = unknown) |
| is_vm_online | TINYINT(1) NULL | VM-level ping |
| maintenance | TINYINT(1) NULL | Maintenance mode flag |
| timestamp | BIGINT | Last status update time |
| updated_at | TIMESTAMP | |

### `nodeServers`
| Column | Type | Notes |
|---|---|---|
| node_key | VARCHAR(100) PK | |
| servers | INT | Current server count on node |
| max_count | INT | Node capacity |
| updated_at | TIMESTAMP | |

---

## Migration Process

### Pre-migration state (from `inspect_db.js`)

| Table | Format | Rows |
|---|---|---|
| userData | KV | 18,839 |
| userPrem | KV | 32,924 |
| redeemCodes | KV | 0 (empty) |
| nodeStatus | KV | 32 |
| nodeServers | KV | 29 |
| nodeStatus_backup | relational (untouched) | 2,581 |
| nodePing | relational (unused) | — |
| json | empty | 0 |
| nodeData | empty | 0 |

### Steps Taken

1. **`node migration/backup_db.js`**
   Created JSON backups of all KV-format tables in `./backups/` before any changes.

2. **`node migration/migrate_db.js`**
   For each KV table:
   - Renamed old table to `<table>_kv` (e.g. `userData` → `userData_kv`)
   - Created new relational table with the schema above
   - Read all rows from `<table>_kv`, merged dot-notation fragments into root objects
   - Inserted into new table using `ON DUPLICATE KEY UPDATE` (idempotent — safe to re-run)

3. **Migration was interrupted** on the first run due to one `userData` row with a 104-character username (junk test account, all `a`s). `find_long_usernames.js` was used to identify it. The migration script was updated to truncate usernames to 100 chars with `.slice(0, 100)`. Re-run completed successfully.

### Post-migration

The KV backup tables (`userData_kv`, `userPrem_kv`, etc.) remain in the database. Once the bot has been running stably in production:

```sql
DROP TABLE userData_kv;
DROP TABLE userPrem_kv;
DROP TABLE redeemCodes_kv;
DROP TABLE nodeStatus_kv;
DROP TABLE nodeServers_kv;
```

---

## Scripts in this folder

| Script | Purpose |
|---|---|
| `inspect_db.js` | Lists all tables, schemas, row counts, and sample data. Flags KV-format tables. |
| `backup_db.js` | Dumps all KV-format tables to JSON files in `./backups/`. |
| `migrate_db.js` | One-time migration. Renames KV tables, creates relational schemas, migrates data. Safe to re-run. |
| `find_long_usernames.js` | Debug script used during migration to find `userData_kv` rows with usernames over 100 chars. |

All scripts read database credentials from `config.json` in the project root.

```
node migration/inspect_db.js
node migration/backup_db.js
node migration/migrate_db.js
```
