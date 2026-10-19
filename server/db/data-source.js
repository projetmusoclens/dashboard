const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { exec } = require('child_process');
const { promisify } = require('util');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const { normalizePost } = require('../services/normalization');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://[::1]:27017';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'worldcup2026';
const ARCHIVE_PATH = path.resolve(__dirname, '..', '..', 'wc2026_extract.gz');
const ARCHIVE_DB_NAME = process.env.ARCHIVE_DB_NAME || 'wc2026_archive';

let db = null;
let archiveDb = null;
let archivePosts = null;
let client = null;

let bsonLib = null;
try {
  bsonLib = require('bson');
} catch (error) {
  console.warn('bson module not installed; direct archive parsing is unavailable.');
}

async function parseArchiveInMemory() {
  if (!bsonLib) throw new Error('bson module missing');
  const compressed = fs.readFileSync(ARCHIVE_PATH);
  const buffer = zlib.gunzipSync(compressed);
  const posts = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const length = buffer.readInt32LE(offset);
    if (length <= 0 || offset + length > buffer.length) {
      offset += 1;
      continue;
    }
    try {
      const document = bsonLib.deserialize(buffer.subarray(offset, offset + length));
      if (document && (document.matched_keywords || document.author_handle || document._id || document.text)) posts.push(document);
      offset += length;
    } catch (error) {
      offset += 1;
    }
  }

  if (!posts.length) throw new Error('Direct archive parse found no posts');
  archivePosts = posts.map(normalizePost);
  console.log(`Parsed ${archivePosts.length} posts from archive.`);
}

// Index nécessaires aux conversations (post_id, reply_to_id). createIndex ne fait rien si l'index
// existe déjà : le déploiement les crée sur Atlas au premier démarrage, sans manipulation manuelle.
const POST_INDEXES = [
  { key: { post_id: 1 }, name: 'post_id_1' },
  { key: { reply_to_id: 1 }, name: 'reply_to_id_1' },
];

async function ensureIndexes(database, label) {
  if (!database) return;
  for (const index of POST_INDEXES) {
    try {
      await database.collection('posts').createIndex(index.key, { name: index.name });
    } catch (error) {
      console.warn(`Index ${index.name} non créé sur ${label} (droits en écriture ?) :`, error?.message || error);
    }
  }
}

async function connectMongo() {
  client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await client.connect();
    db = client.db(MONGO_DB_NAME);
    console.log(`MongoDB connected to ${MONGO_URI.replace(/\/\/[^@/]*@/, "//***@")}`);
    await ensureIndexes(db, MONGO_DB_NAME);
  } catch (error) {
    db = null;
    console.warn('MongoDB connect failed; attempting archive-only mode.', error?.message || error);
  }

  if (!fs.existsSync(ARCHIVE_PATH)) {
    console.log('No local archive found at', ARCHIVE_PATH);
    return;
  }

  console.log(`Archive found at ${ARCHIVE_PATH}; attempting restore into '${ARCHIVE_DB_NAME}'.`);
  const command = `mongorestore --gzip --archive="${ARCHIVE_PATH}" --nsFrom="worldcup2026.posts_extract" --nsTo="${ARCHIVE_DB_NAME}.posts" --drop`;
  try {
    const { stdout, stderr } = await promisify(exec)(command);
    if (stdout) console.log('mongorestore stdout:', stdout.slice(0, 2000));
    if (stderr) console.warn('mongorestore stderr:', stderr.slice(0, 2000));
    archiveDb = client.db(ARCHIVE_DB_NAME);
    await ensureIndexes(archiveDb, ARCHIVE_DB_NAME);
  } catch (error) {
    console.warn('mongorestore failed; attempting direct archive parsing:', error?.message || error);
    try {
      await parseArchiveInMemory();
    } catch (parseError) {
      console.warn('Direct archive parse failed:', parseError?.message || parseError);
    }
  }
}

function getDataSource() {
  if (Array.isArray(archivePosts) && archivePosts.length > 0) return { mode: 'archive', posts: archivePosts };
  if (archiveDb) return { mode: 'db', db: archiveDb };
  if (db) return { mode: 'db', db };
  return { mode: 'none' };
}

function getDb() {
  return db;
}

module.exports = { MONGO_DB_NAME, MONGO_URI, connectMongo, getDataSource, getDb };