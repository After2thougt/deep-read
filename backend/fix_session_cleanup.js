const fs = require('fs');
let content = fs.readFileSync('D:\\projects\\deep-read\\backend\\server.js', 'utf8');

// Add session cleanup after loginAttempts Map
const loginAttemptsMap = "const loginAttempts = new Map();\r\nconst SESSION_COOKIE = 'deepread_session';\r\nconst SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;";

const withCleanup = "const loginAttempts = new Map();\r\nconst SESSION_COOKIE = 'deepread_session';\r\nconst SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;\r\n\r\n// Session cleanup: remove expired sessions every 10 minutes\r\nsetInterval(() => {\r\n  const now = Date.now();\r\n  for (const [token, session] of sessions.entries()) {\r\n    if (session.expiresAt < now) {\r\n      sessions.delete(token);\r\n    }\r\n  }\r\n}, 10 * 60 * 1000);";

if (content.includes(loginAttemptsMap)) {
  content = content.replace(loginAttemptsMap, withCleanup);
  fs.writeFileSync('D:\\projects\\deep-read\\backend\\server.js', content, 'utf8');
  console.log('Successfully added session cleanup');
} else {
  console.log('Target text not found');
}