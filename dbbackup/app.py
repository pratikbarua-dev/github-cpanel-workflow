import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime
from flask import Flask, render_template_string, request, redirect, url_for, send_from_directory, flash
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user

# Import settings
try:
    import config
except ImportError:
    print("❌ Error: config.py not found. Please create it.")
    sys.exit(1)

app = Flask(__name__)
app.secret_key = config.FLASK_SECRET_KEY

# --- LOGIN SETUP ---
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

class User(UserMixin):
    def __init__(self, id):
        self.id = id

@login_manager.user_loader
def load_user(user_id):
    return User(user_id) if user_id == config.ADMIN_USER else None

# --- HTML TEMPLATES (Modern UI) ---
LOGIN_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Vault Login</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f1f5f9; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; color: #334155; }
        .card { background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); width: 100%; max-width: 350px; }
        h2 { text-align: center; color: #0f172a; margin-top: 0; margin-bottom: 1.5rem; }
        input { width: 100%; padding: 12px; margin: 8px 0; border: 1px solid #cbd5e1; border-radius: 8px; box-sizing: border-box; font-size: 16px; transition: border 0.2s; }
        input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        button { width: 100%; padding: 12px; background: #0f172a; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 1rem; font-size: 16px; transition: background 0.2s; }
        button:hover { background: #334155; }
        .flash { color: #ef4444; text-align: center; margin-bottom: 1rem; font-size: 0.9em; background: #fee2e2; padding: 8px; border-radius: 6px; }
    </style>
</head>
<body>
    <div class="card">
        <h2>🔒 Database Vault</h2>
        {% with messages = get_flashed_messages() %}
            {% if messages %}<div class="flash">{{ messages[0] }}</div>{% endif %}
        {% endwith %}
        <form method="post">
            <input type="text" name="username" placeholder="Username" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Unlock Dashboard</button>
        </form>
    </div>
</body>
</html>
"""

DASHBOARD_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Database Control Center</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        :root { --primary: #2563eb; --danger: #ef4444; --success: #10b981; --bg: #f8fafc; --card: #ffffff; --text: #1e293b; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; line-height: 1.5; }
        .container { max-width: 1000px; margin: 0 auto; }
        
        /* Header */
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; padding: 0 10px; }
        .brand { font-size: 1.5rem; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 10px; }
        .logout { color: #64748b; text-decoration: none; font-weight: 500; padding: 8px 16px; border-radius: 6px; background: white; border: 1px solid #e2e8f0; transition: all 0.2s; }
        .logout:hover { background: #f1f5f9; color: #0f172a; }

        /* Cards */
        .card { background: var(--card); border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); padding: 24px; margin-bottom: 24px; border: 1px solid #e2e8f0; }
        
        /* Action Area */
        .action-grid { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 20px; }
        .action-text h3 { margin: 0 0 5px 0; font-size: 1.1rem; }
        .action-text p { margin: 0; color: #64748b; font-size: 0.9rem; }
        
        .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; border: none; cursor: pointer; transition: transform 0.1s, opacity 0.2s; font-size: 0.95rem; }
        .btn:active { transform: scale(0.98); }
        .btn-primary { background: var(--primary); color: white; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2); }
        .btn-primary:hover { background: #1d4ed8; }
        
        /* File List */
        .file-list { list-style: none; padding: 0; margin: 0; }
        .file-item { display: grid; grid-template-columns: 1fr auto; gap: 15px; padding: 16px; border-bottom: 1px solid #f1f5f9; align-items: center; }
        .file-item:last-child { border-bottom: none; }
        .file-info { display: flex; flex-direction: column; }
        .file-name { font-weight: 600; color: #334155; font-family: monospace; font-size: 1rem; }
        .file-meta { font-size: 0.85rem; color: #94a3b8; margin-top: 4px; display: flex; gap: 12px; align-items: center; }
        .badge { background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-size: 0.75rem; color: #475569; }

        /* File Actions */
        .btn-group { display: flex; gap: 8px; }
        .btn-icon { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid #e2e8f0; color: #64748b; background: white; cursor: pointer; transition: all 0.2s; text-decoration: none; }
        .btn-icon:hover { border-color: #cbd5e1; color: #0f172a; background: #f8fafc; }
        .btn-restore { color: var(--danger); border-color: #fecaca; background: #fef2f2; }
        .btn-restore:hover { background: #fee2e2; border-color: #fca5a5; }

        /* Alerts */
        .flash { padding: 16px; border-radius: 10px; margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
        .flash-success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
        .flash-error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }

        /* Modal */
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: none; justify-content: center; align-items: center; z-index: 1000; }
        .modal { background: white; padding: 30px; border-radius: 16px; width: 90%; max-width: 400px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }
        .modal h3 { margin-top: 0; color: #0f172a; }
        .modal p { color: #64748b; margin-bottom: 25px; }
        .modal-actions { display: flex; gap: 10px; justify-content: center; }
    </style>
    <script>
        function confirmRestore(filename, url) {
            document.getElementById('modal-filename').textContent = filename;
            document.getElementById('confirm-btn').href = url;
            document.getElementById('restore-modal').style.display = 'flex';
        }
        function closeModal() {
            document.getElementById('restore-modal').style.display = 'none';
        }
    </script>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="brand"><i class="fas fa-database"></i> Database Control</div>
            <a href="/logout" class="logout">Log Out</a>
        </div>

        {% with messages = get_flashed_messages(with_categories=true) %}
            {% if messages %}
                {% for category, message in messages %}
                    <div class="flash flash-{{ category }}">
                        <i class="fas fa-{{ 'check-circle' if category == 'success' else 'exclamation-circle' }}"></i>
                        {{ message }}
                    </div>
                {% endfor %}
            {% endif %}
        {% endwith %}

        <div class="card">
            <div class="action-grid">
                <div class="action-text">
                    <h3>Manual Backup</h3>
                    <p>Immediately trigger the courier script to fetch the latest database state.</p>
                </div>
                <div style="display: flex; gap: 10px;">
                    <a href="{{ url_for('run_backup') }}" class="btn btn-primary">
                        <i class="fas fa-database"></i> Backup DB
                    </a>
                    <a href="{{ url_for('run_media_backup') }}" class="btn btn-primary" style="background-color: #0d9488;">
                        <i class="fas fa-photo-video"></i> Backup Media
                    </a>
                </div>
            </div>
        </div>

        <div class="card">
            <h3 style="margin-top: 0; margin-bottom: 20px;">Backup History</h3>
            <ul class="file-list">
                {% for file in files %}
                <li class="file-item">
                    <div class="file-info">
                        <span class="file-name">
                            {% if 'media' in file.name %}
                                <i class="fas fa-file-image" style="color: #0d9488; margin-right: 8px;"></i>
                            {% else %}
                                <i class="fas fa-database" style="color: #2563eb; margin-right: 8px;"></i>
                            {% endif %}
                            {{ file.name }}
                        </span>
                        <div class="file-meta">
                            <span class="badge">{{ file.size }}</span>
                            <span><i class="far fa-clock"></i> {{ file.date }}</span>
                        </div>
                    </div>
                    <div class="btn-group">
                        <button onclick="confirmRestore('{{ file.name }}', '{{ url_for('run_restore', filename=file.name) }}')" class="btn-icon btn-restore" title="Restore to Server">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </li>
                {% else %}
                    <li style="text-align: center; padding: 40px; color: #94a3b8;">
                        <i class="fas fa-folder-open" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
                        No backups found yet.
                    </li>
                {% endfor %}
            </ul>
        </div>
    </div>

    <div id="restore-modal" class="modal-overlay">
        <div class="modal">
            <div style="width: 50px; height: 50px; background: #fee2e2; color: #ef4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px auto; font-size: 1.5rem;">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <h3>Confirm Restoration</h3>
            <p>Are you sure you want to overwrite the live data with <br><b id="modal-filename"></b>?</p>
            <div class="modal-actions">
                <button onclick="closeModal()" class="logout" style="cursor: pointer;">Cancel</button>
                <a id="confirm-btn" href="#" class="btn btn-primary" style="background: #ef4444; box-shadow: none;">Yes, Restore It</a>
            </div>
        </div>
    </div>
</body>
</html>
"""

# --- UTILITIES ---
def get_backup_path():
    return Path(__file__).parent / config.BACKUP_DIR

def format_size(size):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024: return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"

# --- ROUTES ---
@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form['username'] == config.ADMIN_USER and request.form['password'] == config.ADMIN_PASS:
            login_user(User(config.ADMIN_USER))
            return redirect(url_for('dashboard'))
        flash("Invalid credentials", "error")
    return render_template_string(LOGIN_HTML)

@app.route('/dashboard')
@login_required
def dashboard():
    path = get_backup_path()
    path.mkdir(exist_ok=True)
    
    files_data = []
    # Sort by time (newest first)
    # Include both .gz (DB) and .zip (Media)
    files = sorted(list(path.glob("*.gz")) + list(path.glob("*.zip")), key=lambda f: f.stat().st_mtime, reverse=True)
    
    for f in files:
        files_data.append({
            'name': f.name,
            'size': format_size(f.stat().st_size),
            'date': datetime.fromtimestamp(f.stat().st_mtime).strftime('%Y-%m-%d %H:%M')
        })
            
    return render_template_string(DASHBOARD_HTML, files=files_data)

@app.route('/download/<filename>')
@login_required
def download(filename):
    return send_from_directory(get_backup_path(), filename, as_attachment=True)

@app.route('/backup')
@login_required
def run_backup():
    """Triggers the backup_db.py script."""
    script = Path(__file__).parent / "backup_db.py"
    try:
        # Run the script safely
        result = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)
        
        if result.returncode == 0:
            flash("✅ Backup completed successfully!", "success")
        else:
            print(result.stderr) # Log error to console
            flash(f"❌ Backup failed. Check console logs.", "error")
            
    except Exception as e:
        flash(f"❌ Error: {str(e)}", "error")
        
    return redirect(url_for('dashboard'))

@app.route('/backup-media')
@login_required
def run_media_backup():
    """Triggers the backup_media.py script."""
    script = Path(__file__).parent / "backup_media.py"
    try:
        # Run the script safely
        result = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)
        
        if result.returncode == 0:
            flash("✅ Media Backup completed successfully!", "success")
        else:
            print(result.stderr) # Log error to console
            flash(f"❌ Media Backup failed. Check console logs.", "error")
            
    except Exception as e:
        flash(f"❌ Error: {str(e)}", "error")
        
    return redirect(url_for('dashboard'))

@app.route('/restore/<filename>')
@login_required
def run_restore(filename):
    """Triggers the restore scripts based on file type."""
    file_path = get_backup_path() / filename
    
    if not file_path.exists():
        flash("❌ File not found.", "error")
        return redirect(url_for('dashboard'))

    # Determine script based on extension
    if filename.endswith('.zip'):
        script = Path(__file__).parent / "restore_media.py"
    else:
        script = Path(__file__).parent / "restore_db.py"

    try:
        # Run restore script with the filename as an argument
        result = subprocess.run(
            [sys.executable, str(script), str(filename)], 
            capture_output=True, 
            text=True
        )
        
        if result.returncode == 0:
            flash(f"✅ Restoration process completed successfully.", "success")
        else:
            # Capture the last line of error output for the UI
            err = result.stderr.splitlines()[-1] if result.stderr else "Unknown error"
            flash(f"❌ Restore failed: {err}", "error")

    except Exception as e:
        flash(f"❌ Execution Error: {str(e)}", "error")

    return redirect(url_for('dashboard'))

@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('login'))

if __name__ == "__main__":
    get_backup_path().mkdir(exist_ok=True)
    app.run(debug=True, port=5000)