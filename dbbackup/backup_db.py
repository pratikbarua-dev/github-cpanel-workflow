#!/usr/bin/env python3
"""
============================================
Database Backup Courier Script
============================================
This script fetches database backups from your Node.js app's
secure backup endpoint and saves them locally.

Usage:
    python backup_db.py

For scheduled backups on PythonAnywhere:
    Set up a scheduled task pointing to this script.
"""

import os
import sys
import requests
from datetime import datetime
from pathlib import Path

# Import configuration
try:
    from config import BACKUP_URL, BACKUP_SECRET_KEY, BACKUP_DIR, MAX_BACKUPS
except ImportError:
    print("❌ Error: config.py not found!")
    print("   Please create config.py with your settings.")
    sys.exit(1)


def get_backup_filename():
    """Generate a timestamped backup filename."""
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    return f"backup_{timestamp}.sql.gz"


def cleanup_old_backups(backup_dir: Path, max_backups: int):
    """Remove old backup files, keeping only the most recent ones."""
    backup_files = sorted(
        backup_dir.glob("backup_*.sql.gz"),
        key=lambda f: f.stat().st_mtime,
        reverse=True  # Newest first
    )
    
    # Delete backups beyond the limit
    for old_file in backup_files[max_backups:]:
        print(f"🗑️  Deleting old backup: {old_file.name}")
        old_file.unlink()


def download_backup():
    """Download database backup from the Node.js app."""
    print("=" * 50)
    print("🚀 Database Backup Courier")
    print("=" * 50)
    
    # Create backup directory if it doesn't exist
    script_dir = Path(__file__).parent
    backup_dir = script_dir / BACKUP_DIR
    backup_dir.mkdir(exist_ok=True)
    
    # Generate filename
    filename = get_backup_filename()
    filepath = backup_dir / filename
    
    print(f"📡 Requesting backup from: {BACKUP_URL}")
    print(f"📁 Saving to: {filepath}")
    
    try:
        # Make the request with the secret key
        response = requests.get(
            BACKUP_URL,
            params={"key": BACKUP_SECRET_KEY},
            stream=True,  # Stream for large files
            timeout=300   # 5 minute timeout for large databases
        )
        
        # Check response status
        if response.status_code == 403:
            print("❌ Access Denied: Invalid secret key!")
            print("   Check that BACKUP_SECRET_KEY matches your .env file.")
            sys.exit(1)
        elif response.status_code == 500:
            print("❌ Server Error: Check your Node.js app logs.")
            sys.exit(1)
        elif response.status_code != 200:
            print(f"❌ Unexpected response: {response.status_code}")
            print(f"   Response: {response.text[:200]}")
            sys.exit(1)
        
        # Save the backup file
        total_size = 0
        with open(filepath, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    total_size += len(chunk)
        
        # Check if we actually got data
        if total_size == 0:
            print("⚠️  Warning: Backup file is empty!")
            filepath.unlink()  # Delete empty file
            sys.exit(1)
        
        # Convert to human-readable size
        if total_size < 1024:
            size_str = f"{total_size} bytes"
        elif total_size < 1024 * 1024:
            size_str = f"{total_size / 1024:.1f} KB"
        else:
            size_str = f"{total_size / (1024 * 1024):.2f} MB"
        
        print(f"✅ Backup saved successfully!")
        print(f"   File: {filename}")
        print(f"   Size: {size_str}")
        
        # Cleanup old backups
        cleanup_old_backups(backup_dir, MAX_BACKUPS)
        
        print("=" * 50)
        print("🎉 Backup complete!")
        print("=" * 50)
        
    except requests.exceptions.Timeout:
        print("❌ Error: Request timed out!")
        print("   Your database might be very large.")
        print("   Try increasing the timeout in this script.")
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print("❌ Error: Could not connect to server!")
        print("   Check that your website is online and BACKUP_URL is correct.")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    download_backup()
