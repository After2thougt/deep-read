const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const databasePath = path.resolve(__dirname, '..', 'data', 'app.db');
const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
const tempUploadsRoot = path.join(uploadsRoot, 'temp');

function cleanupTempImages(db, maxAgeHours = 24) {
  if (!fs.existsSync(tempUploadsRoot)) {
    return { deleted: [], count: 0 };
  }

  const now = Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const files = fs.readdirSync(tempUploadsRoot);

  // Get all referenced image URLs from article_blocks
  const referencedRows = db.prepare("SELECT content FROM article_blocks WHERE type = 'image' AND content LIKE '/uploads/temp/%'").all();
  const referencedPaths = new Set(referencedRows.map(r => path.basename(r.content)));

  const deleted = [];
  for (const fileName of files) {
    const filePath = path.join(tempUploadsRoot, fileName);
    
    // Skip directories
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) continue;

    // Skip if referenced in database
    if (referencedPaths.has(fileName)) {
      continue;
    }

    // Check file age
    const fileAge = now - stat.mtimeMs;
    if (fileAge < maxAgeMs) {
      continue; // Not old enough
    }

    // Delete the file
    try {
      fs.unlinkSync(filePath);
      deleted.push(fileName);
    } catch (err) {
      console.warn(`Failed to delete temp image ${fileName}:`, err.message);
    }
  }

  return { deleted, count: deleted.length };
}

// If run directly (not imported)
if (require.main === module) {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  console.log('[Cleanup] Starting temp image cleanup...');
  const result = cleanupTempImages(db, 24);
  console.log('[Cleanup] Result:', result);
  
  db.close();
}

module.exports = { cleanupTempImages };