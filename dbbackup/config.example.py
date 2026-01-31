# ============================================
# Database Backup & Restoration Config TEMPLATE
# ============================================
# Copy this file to config.py and update values

# The URL of your website's backup endpoint
BACKUP_URL = "https://YOUR-WEBSITE.com/system-backup"

# The secret key (must match BACKUP_SECRET_KEY in your .env file)
BACKUP_SECRET_KEY = "your-secret-key-here"

# Directory where backups will be saved (relative to this script)
BACKUP_DIR = "backups"

# Number of backup files to keep (oldest will be deleted)
MAX_BACKUPS = 7
