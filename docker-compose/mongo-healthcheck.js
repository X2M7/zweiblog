/* global connect, quit */

const fs = require('fs');
const uri = fs.readFileSync('/run/secrets/mongo_app_uri', 'utf8').replace(/[\r\n]+$/, '');

if (!/^mongodb:\/\//.test(uri) || uri.length > 8192) {
  throw new Error('Invalid ZweiBlog MongoDB connection URI secret');
}

const connection = connect(uri);
const result = connection.getSiblingDB('admin').runCommand({ ping: 1 });
quit(result.ok === 1 ? 0 : 1);
