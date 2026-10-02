import Database from 'better-sqlite3';
import type { SqlValue } from 'yomitan-core';
import type { OpSqliteConnection, OpenDatabase } from '../src/index';

function binding(value: SqlValue): SqlValue | Buffer {
    return value instanceof Uint8Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : value;
}

/** Only the op-sqlite 17.1 calls the driver is allowed to use. */
export function createOpSqliteDouble(): OpenDatabase {
    return ({ name, location }) => {
        const database = new Database(location === ':memory:' ? ':memory:' : location ? `${location}/${name}` : name);
        let closed = false;
        let pending = Promise.resolve();
        const executeSync = (sql: string, params: SqlValue[] = []) => {
            if (closed) {
                throw new Error('Database is closed');
            }
            const statement = database.prepare(sql);
            const values = params.map(binding);
            if (statement.reader) {
                const rows = (statement.all(...values) as Record<string, unknown>[]).map((row) =>
                    Object.fromEntries(
                        Object.entries(row).map(([key, value]) => [
                            key,
                            value instanceof Uint8Array ? new Uint8Array(value).buffer : value,
                        ]),
                    ),
                );
                return { rows, rowsAffected: 0 };
            }
            const result = statement.run(...values);
            return { rows: [], rowsAffected: result.changes, insertId: Number(result.lastInsertRowid) };
        };
        const connection: OpSqliteConnection & {
            executeSync(): never;
            executeBatch(): never;
        } = {
            execute(sql, params) {
                const task = pending.then(() => executeSync(sql, params));
                pending = task.then(
                    () => undefined,
                    () => undefined,
                );
                return task;
            },
            executeSync() {
                throw new Error('executeSync is forbidden in the op-sqlite driver');
            },
            executeBatch() {
                throw new Error('executeBatch is forbidden in the op-sqlite driver');
            },
            async closeAsync() {
                await pending;
                database.close();
                closed = true;
            },
        };
        return connection;
    };
}
