#!/bin/bash
# Backup Studio (draf + gambar belum terbit) -> HDD /mnt/KorokNas-1-1/Backups/Studio
# Cron: harian 03:30 (selepas vaultwarden 03:00). Simpan 14 hari.
#
# PENTING: studio.db guna journal_mode=WAL, jadi `cp studio.db` sahaja TIDAK selamat
# (hampir semua tulisan terbaru ada dalam studio.db-wal). Skrip ini guna API backup
# sqlite (snapshot konsisten) + verify integrity_check.
set -uo pipefail

HD=/mnt/KorokNas-1-1/Backups/Studio
SRC=/home/safibnrahman/studio
DATA=$SRC/data
KEEP=14
LOG=$SRC/backup-hdd.log

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

if ! mountpoint -q /mnt/KorokNas-1-1; then
  say "ABORT: /mnt/KorokNas-1-1 tidak mounted — backup dilangkau"
  exit 1
fi
mkdir -p "$HD" || { say "ABORT: tak boleh tulis ke $HD"; exit 1; }

TS=$(date +%Y%m%d_%H%M%S)
TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

# 1. SQLite snapshot yang konsisten + verify
python3 - "$TMP" <<'PY' || { say "GAGAL: sqlite backup"; exit 1; }
import sqlite3, sys, pathlib
out = pathlib.Path(sys.argv[1]) / "studio.db"
src = sqlite3.connect("file:/home/safibnrahman/studio/data/studio.db?mode=ro", uri=True)
dst = sqlite3.connect(str(out))
src.backup(dst)
integrity = dst.execute("PRAGMA integrity_check").fetchone()[0]
drafts = dst.execute("SELECT COUNT(*) FROM drafts").fetchone()[0]
dst.close(); src.close()
print(f"  sqlite snapshot: integrity={integrity}, draf={drafts}")
if integrity != "ok":
    sys.exit(1)
PY

# 2. Gambar/aset + fail konfigurasi (env ada GITHUB_TOKEN -> arkib di-chmod 600)
cp -a "$DATA/uploads" "$DATA/assets" "$TMP/" 2>/dev/null
cp -a "$SRC/docker-compose.yml" "$SRC/Dockerfile" "$SRC/package.json" "$SRC/README.md" "$TMP/" 2>/dev/null
cp -a "$SRC/.env" "$TMP/env-backup.txt" 2>/dev/null

# 3. Arkib + verify
tar czf "$HD/studio-backup-$TS.tar.gz" -C "$TMP" . || { say "GAGAL: tar"; exit 1; }
chmod 600 "$HD/studio-backup-$TS.tar.gz"
if ! gzip -t "$HD/studio-backup-$TS.tar.gz"; then
  say "GAGAL: arkib rosak"; rm -f "$HD/studio-backup-$TS.tar.gz"; exit 1
fi

# 4. Retensi
ls -t "$HD"/studio-backup-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm

say "OK $(du -h "$HD/studio-backup-$TS.tar.gz" | cut -f1) -> studio-backup-$TS.tar.gz (simpan $KEEP terakhir: $(ls -1 "$HD"/studio-backup-*.tar.gz | wc -l) fail)"
