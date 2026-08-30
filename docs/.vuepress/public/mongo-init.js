/* global db */

// This script runs only when /data/db is empty. Credentials stay in Docker
// secret files and are never embedded in the image or Compose environment.
const fs = require('fs');

const readSecret = (file) => {
  const value = fs.readFileSync(file, 'utf8').replace(/[\r\n]+$/, '');
  if (!value || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid MongoDB secret file: ${file}`);
  }
  return value;
};

const password = readSecret('/run/secrets/mongo_app_password');
const admin = db.getSiblingDB('admin');

if (admin.getUser('zweiblog')) {
  throw new Error('The ZweiBlog MongoDB application user already exists');
}

admin.createUser({
  user: 'zweiblog',
  pwd: password,
  roles: [
    { role: 'readWrite', db: 'zweiBlog' },
    // Waline is legacy migration data. New comments live in zweiBlog, so the
    // application only needs read access to the old database.
    { role: 'read', db: 'waline' },
  ],
});

print('Created the least-privilege ZweiBlog MongoDB application user.');
