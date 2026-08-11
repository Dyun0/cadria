#!/usr/bin/env python3
import os
import sys
import subprocess
from pathlib import Path

def main():
    root = Path(__file__).resolve().parent
    os.chdir(root)
    
    print("📦 [1/3] Checking React Frontend SPA dist...")
    frontend_dir = root / "frontend"
    dist_dir = frontend_dir / "dist"
    
    try:
        subprocess.run(["npm", "run", "build"], cwd=frontend_dir, check=True)
    except Exception as e:
        print(f"⚠️ npm run build skipped/failed: {e}")
        if not dist_dir.exists():
            print("❌ Error: Frontend dist directory does not exist!")
            sys.exit(1)
        print("✅ Using existing frontend/dist bundle.")
        
    print("✨ [2/3] Checking PyInstaller packaging requirements...")
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "pyinstaller", "pywebview"], check=False)
    
    print("🔨 [3/3] Packaging Cadria Desktop Application with PyInstaller...")
    spec_file = root / "cadria_desktop.spec"
    subprocess.run([sys.executable, "-m", "PyInstaller", str(spec_file), "--noconfirm"], check=True)
    
    output_exe = root / "dist" / "Cadria_Studio"
    print("\n🎉 Desktop Application Package Built Successfully!")
    print(f"📁 Package Output Directory: {output_exe.resolve()}")
    if sys.platform == "win32":
        print(f"🚀 Executable: {output_exe.resolve() / 'Cadria_Studio.exe'}")
    else:
        print(f"🚀 Executable: {output_exe.resolve() / 'Cadria_Studio'}")

if __name__ == "__main__":
    main()
