import os
import sys
import zipfile
from pathlib import Path

# Import settings
try:
    import config
except ImportError:
    print("❌ Error: config.py not found.")
    sys.exit(1)

def restore_media(filename):
    # Setup paths
    base_dir = Path(__file__).resolve().parent
    public_dir = base_dir.parent / 'public'
    backup_file = base_dir / config.BACKUP_DIR / filename
    
    print(f"📦 Starting Media Restore...")
    print(f"   Backup File: {backup_file}")
    print(f"   Destination: {public_dir}")
    
    if not backup_file.exists():
        print(f"❌ Error: Backup file not found at {backup_file}")
        sys.exit(1)
        
    if not public_dir.exists():
        print(f"⚠️ Public directory missing. Creating it.")
        public_dir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(backup_file, 'r') as zipf:
            zipf.extractall(public_dir)
            
        print(f"✅ Media Restore Successful.")
        
    except Exception as e:
        print(f"❌ Restore Failed: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python restore_media.py <filename>")
        sys.exit(1)
    
    filename = sys.argv[1]
    restore_media(filename)
