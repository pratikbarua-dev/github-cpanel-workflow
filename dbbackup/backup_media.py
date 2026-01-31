import os
import sys
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

# Import settings
try:
    import config
except ImportError:
    print("❌ Error: config.py not found.")
    sys.exit(1)

def backup_media():
    # Setup paths
    # dbbackup/ is the current directory
    base_dir = Path(__file__).resolve().parent
    # public/ is ../public
    public_dir = base_dir.parent / 'public'
    backup_dir = base_dir / config.BACKUP_DIR
    
    backup_dir.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    filename = f"media_backup_{timestamp}.zip"
    filepath = backup_dir / filename
    
    print(f"📦 Starting Media Backup...")
    print(f"   Source: {public_dir}")
    print(f"   Destination: {filepath}")
    
    if not public_dir.exists():
        print(f"❌ Error: Public directory not found at {public_dir}")
        sys.exit(1)

    try:
        # Create a zip file
        with zipfile.ZipFile(filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(public_dir):
                for file in files:
                    # Create absolute path
                    file_abs_path = Path(root) / file
                    # Create relative path to store in checking zip
                    # We want 'images/logo.png' not 'public/images/logo.png' 
                    # or just relative to public
                    archive_name = file_abs_path.relative_to(public_dir)
                    zipf.write(file_abs_path, archive_name)
                    
        print(f"✅ Media Backup Successful: {filename}")
        print(f"   Size: {filepath.stat().st_size / (1024*1024):.2f} MB")
        
    except Exception as e:
        print(f"❌ Backup Failed: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    backup_media()
