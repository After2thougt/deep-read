export function getLocalDataSummary() {
  return null;
}

export async function migrateLocalDataToDatabase() {
  throw new Error("Legacy browser data has no verified account owner and cannot be imported safely.");
}

export function dismissMigration() {
  return false;
}
