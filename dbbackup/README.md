# 🔐 Database Backup & Restoration System

Both backup and restore use the **Bridge Method** - the Node.js app handles all database operations internally.

## 📦 Backup

```bash
python3 backup_db.py
# Downloads database from: GET /system-backup?key=SECRET
```

## 🔄 Restore

```bash
python3 restore_db.py
# Uploads backup to: POST /system-restore?key=SECRET
```

---

## ⚙️ Configuration

Edit `config.py`:

```python
BACKUP_URL = "https://your-site.com/system-backup"
BACKUP_SECRET_KEY = "your-secret-key"
MAX_BACKUPS = 7
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                      THE BRIDGE METHOD                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  BACKUP:                                                      │
│  Python ──GET──▶ Node.js ──▶ mysqldump ──▶ .sql.gz ──▶ Python │
│                                                               │
│  RESTORE:                                                     │
│  Python ──POST──▶ Node.js ──▶ mysql import ──▶ Done! ✅       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**No database credentials needed in Python!** The Node.js app (which has access to the database) handles everything.

---

## 📁 Files

| File | Purpose |
|------|---------|
| `backup_db.py` | Download backup from server |
| `restore_db.py` | Upload backup to restore |
| `config.py` | Your settings (gitignored) |
| `backups/` | Stored backup files |
