export async function batchExec(db: D1Database, stmts: D1PreparedStatement[], size = 50) {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size));
  }
}
