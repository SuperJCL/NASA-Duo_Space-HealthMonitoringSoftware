import json
import os
import sqlite3
from contextlib import contextmanager
from .schema import utcnow

@contextmanager
def database():
    conn = sqlite3.connect(os.environ.get('ASTRA_PATCH_DB', 'astra-patch.sqlite3'), timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript('''
        CREATE TABLE IF NOT EXISTS myo_sessions(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS myo_recordings(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS myo_events(id INTEGER PRIMARY KEY, session_id TEXT, created TEXT, event TEXT, payload TEXT);
        CREATE TABLE IF NOT EXISTS myo_observations(id TEXT PRIMARY KEY, session_id TEXT, version INTEGER, payload TEXT, UNIQUE(session_id, version));
        CREATE TABLE IF NOT EXISTS myo_outbox(id TEXT PRIMARY KEY, payload TEXT, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, next_at REAL DEFAULT 0, last_error TEXT, ack TEXT);
        CREATE TABLE IF NOT EXISTS myo_receipts(id TEXT PRIMARY KEY, digest TEXT, ack TEXT);
        CREATE TABLE IF NOT EXISTS myo_research_sources(id TEXT PRIMARY KEY, record TEXT, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS myo_research_imports(fingerprint TEXT PRIMARY KEY, source_id TEXT, observation_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS myo_research_windows(observation_id TEXT, window_index INTEGER, payload TEXT NOT NULL, PRIMARY KEY(observation_id, window_index));
        CREATE TABLE IF NOT EXISTS myo_console_runs(id TEXT PRIMARY KEY, round_id TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS myo_console_events(event_id TEXT PRIMARY KEY, console_id TEXT NOT NULL, round_id TEXT NOT NULL, sequence INTEGER NOT NULL, observation_id TEXT NOT NULL, session_id TEXT NOT NULL, execution TEXT NOT NULL, UNIQUE(console_id,round_id,sequence));
        CREATE TABLE IF NOT EXISTS myo_trigger_policies(version TEXT PRIMARY KEY, digest TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS myo_trigger_streams(id TEXT PRIMARY KEY, round_id TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS myo_trigger_frames(stream_id TEXT, round_id TEXT, sequence INTEGER, digest TEXT NOT NULL, source_session_id TEXT NOT NULL, observation_id TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(stream_id,round_id,sequence), UNIQUE(stream_id,round_id,source_session_id));
        CREATE TABLE IF NOT EXISTS myo_trigger_events(id TEXT PRIMARY KEY, stream_id TEXT, round_id TEXT, kind TEXT, source_session_id TEXT, observation_id TEXT, payload TEXT NOT NULL, status TEXT NOT NULL);
        ''')
        conn.execute('BEGIN IMMEDIATE')
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def event(conn, session_id, name, payload):
    conn.execute('INSERT INTO myo_events(session_id,created,event,payload) VALUES(?,?,?,?)',
        (str(session_id), utcnow().isoformat(), name, json.dumps(payload, allow_nan=False)))
