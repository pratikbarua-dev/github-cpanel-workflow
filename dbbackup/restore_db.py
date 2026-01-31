#!/usr/bin/env python3
"""
============================================
Database Restoration via Bridge Method
============================================
Uploads a backup file to the Node.js app's restore endpoint.
The Node.js app handles the actual database restoration.

Usage:
    python restore_db.py [backup_file]
"""

import sys
import requests
from datetime import datetime
from pathlib import Path

# Import configuration
try:
    from config import BACKUP_URL, BACKUP_SECRET_KEY, BACKUP_DIR
except ImportError:
    print("❌ Error: config.py not found!")
    print("   Please create config.py with your settings.")
    sys.exit(1)


# Derive restore URL from backup URL
RESTORE_URL = BACKUP_URL.replace("/system-backup", "/system-restore")

# Safety constants
MIN_BACKUP_SIZE = 1024  # 1KB minimum


def get_script_dir() -> Path:
    """Get the directory where this script lives."""
    return Path(__file__).parent


def list_backups() -> list:
    """List all available backup files sorted by date (newest first)."""
    backup_dir = get_script_dir() / BACKUP_DIR
    
    if not backup_dir.exists():
        return []
    
    backups = []
    for f in backup_dir.glob("backup_*.gz"):
        stat = f.stat()
        backups.append({
            "path": f,
            "name": f.name,
            "size": stat.st_size,
            "mtime": datetime.fromtimestamp(stat.st_mtime)
        })
    
    backups.sort(key=lambda x: x["mtime"], reverse=True)
    return backups


def format_size(size_bytes: int) -> str:
    """Convert bytes to human-readable format."""
    if size_bytes < 1024:
        return f"{size_bytes} bytes"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.2f} MB"


def format_age(dt: datetime) -> str:
    """Convert datetime to human-readable age."""
    delta = datetime.now() - dt
    
    if delta.days > 0:
        return f"{delta.days} day{'s' if delta.days > 1 else ''} ago"
    elif delta.seconds >= 3600:
        hours = delta.seconds // 3600
        return f"{hours} hour{'s' if hours > 1 else ''} ago"
    elif delta.seconds >= 60:
        mins = delta.seconds // 60
        return f"{mins} min{'s' if mins > 1 else ''} ago"
    else:
        return "just now"


def validate_backup(backup_path: Path) -> tuple:
    """Validate backup file integrity."""
    if not backup_path.exists():
        return False, f"File not found: {backup_path}"
    
    size = backup_path.stat().st_size
    if size < MIN_BACKUP_SIZE:
        return False, f"File too small ({format_size(size)}). May be corrupted."
    
    # Check gzip header
    try:
        with open(backup_path, 'rb') as f:
            if f.read(2) != b'\x1f\x8b':
                return False, "Invalid gzip format."
    except Exception as e:
        return False, f"Cannot read file: {e}"
    
    return True, None


def show_backup_menu(backups: list) -> Path:
    """Show interactive menu to select a backup file."""
    print()
    print("Available backups:")
    print()
    
    for i, backup in enumerate(backups, 1):
        size_str = format_size(backup["size"])
        age_str = format_age(backup["mtime"])
        print(f"  [{i}] {backup['name']}  ({size_str}, {age_str})")
    
    print()
    
    while True:
        choice = input("Select backup number (or 'q' to quit): ").strip()
        
        if choice.lower() == 'q':
            return None
        
        try:
            idx = int(choice) - 1
            if 0 <= idx < len(backups):
                return backups[idx]["path"]
            else:
                print("Invalid selection. Try again.")
        except ValueError:
            print("Please enter a number.")


def upload_restore(backup_path: Path) -> bool:
    """Upload backup file to the Node.js restore endpoint."""
    print(f"📡 Uploading to: {RESTORE_URL}")
    print(f"📁 File: {backup_path.name} ({format_size(backup_path.stat().st_size)})")
    
    try:
        with open(backup_path, 'rb') as f:
            response = requests.post(
                RESTORE_URL,
                params={"key": BACKUP_SECRET_KEY},
                files={"backup": (backup_path.name, f, "application/gzip")},
                timeout=600  # 10 minute timeout
            )
        
        # Check response
        if response.status_code == 403:
            print("❌ Access Denied: Invalid secret key!")
            return False
        elif response.status_code == 400:
            data = response.json()
            print(f"❌ Bad Request: {data.get('error', 'Unknown error')}")
            return False
        elif response.status_code == 500:
            data = response.json()
            print(f"❌ Server Error: {data.get('error', 'Unknown error')}")
            return False
        elif response.status_code != 200:
            print(f"❌ Unexpected response: {response.status_code}")
            print(f"   {response.text[:200]}")
            return False
        
        # Success!
        data = response.json()
        if data.get('success'):
            print(f"✅ {data.get('message', 'Restoration successful!')}")
            if 'size' in data:
                print(f"   Database size: {format_size(data['size'])}")
            if 'rollback' in data:
                print(f"   Rollback file: {data['rollback']}")
            return True
        else:
            print(f"❌ Restoration failed: {data.get('error', 'Unknown error')}")
            return False
        
    except requests.exceptions.Timeout:
        print("❌ Error: Request timed out!")
        print("   Your database might be very large.")
        return False
    except requests.exceptions.ConnectionError:
        print("❌ Error: Could not connect to server!")
        print("   Check that your website is online and BACKUP_URL is correct.")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False


def main():
    """Main restoration flow."""
    print("=" * 50)
    print("🔄 Database Restoration (Bridge Method)")
    print("=" * 50)
    
    # Check for command-line argument
    if len(sys.argv) > 1:
        backup_path = Path(sys.argv[1])
        if not backup_path.is_absolute():
            backup_path = get_script_dir() / BACKUP_DIR / backup_path
    else:
        # List available backups
        backups = list_backups()
        
        if not backups:
            print()
            print("❌ No backup files found in the backups/ directory.")
            print("   Run backup_db.py first to create a backup.")
            sys.exit(1)
        
        backup_path = show_backup_menu(backups)
        
        if backup_path is None:
            print("Aborted.")
            sys.exit(0)
    
    # Validate
    print()
    print(f"📄 Selected: {backup_path.name}")
    
    is_valid, error = validate_backup(backup_path)
    if not is_valid:
        print(f"❌ Validation failed: {error}")
        sys.exit(1)
    
    print("✓  Backup file validated")
    print()
    
    # Upload and restore
    success = upload_restore(backup_path)
    
    print()
    print("=" * 50)
    
    if success:
        # Extract timestamp from filename
        try:
            timestamp = backup_path.stem.replace("backup_", "").replace(".sql", "").replace(".sqlite", "")
            timestamp = timestamp.replace("_", " ").replace("-", ":", 2)
            print(f"🎉 Database restored to state: {timestamp}")
        except:
            print("🎉 Restoration successful!")
    else:
        print("💥 Restoration failed. Check the errors above.")
        sys.exit(1)
    
    print("=" * 50)


if __name__ == "__main__":
    main()
