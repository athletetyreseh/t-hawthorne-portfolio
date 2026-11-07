// Deployed separately with a five-minute Cron Trigger: Pages Functions do not
// support scheduled events. DB and BUCKET must be the desk's dedicated bindings.
export async function deleteExpiredPhotos(env) {
  let deleted = 0;
  for (let batch = 0; batch < 100; batch++) {
    const {results} = await env.DB.prepare(`SELECT id, photo_key FROM checkouts
      WHERE photo_key IS NOT NULL AND (julianday(checked_out_at) IS NULL OR
      julianday(checked_out_at) <= julianday('now', '-3 days')) LIMIT 100`).all();
    if (!results.length) break;
    let successful = 0;
    for (const record of results) {
      try {
        await env.BUCKET.delete(record.photo_key);
        await env.DB.prepare("UPDATE checkouts SET photo_key=NULL WHERE id=? AND photo_key=?")
          .bind(record.id, record.photo_key).run();
        successful++;
        deleted++;
      } catch {
        // Keep the reference so the next scheduled run retries the deletion.
        console.error("Badge photo retention cleanup failed; will retry");
      }
    }
    if (successful === 0 || results.length < 100) break;
  }
  return deleted;
}

export default {
  async scheduled(_controller, env) {
    await deleteExpiredPhotos(env);
  }
};
