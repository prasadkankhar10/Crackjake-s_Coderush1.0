const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGO_DB || 'cme_detector';

let client = null;
let db = null;

async function connect() {
  if (db) return db;
  client = new MongoClient(MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  await client.connect();
  db = client.db(DB_NAME);
  // ensure indexes
  try {
    await db.collection('detections').createIndex({ timeISO: 1 });
    await db.collection('detections').createIndex({ severity_class: 1 });
  // indexes for time-series tables
  await db.collection('plasma').createIndex({ timeISO: 1 }, { unique: true });
  await db.collection('mag').createIndex({ timeISO: 1 }, { unique: true });
  } catch (e) { /* ignore index errors */ }
  return db;
}

function getDb() {
  if (!db) throw new Error('MongoDB not connected yet');
  return db;
}

async function close() {
  if (client) await client.close();
  client = null; db = null;
}

module.exports = { connect, getDb, close };
