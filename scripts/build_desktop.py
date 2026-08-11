#!/usr/bin/env python3
import os
import sys
import subprocess
from pathlib import Path

def main():
    root = Path(__file__).resolve().parent.parent
    os.chdir(root)
    
    print("📦 [1/3] Building React Frontend SPA...")
    frontend_dir = root / "frontend"
    subprocess.run(["npm", "run", "build"], cwd=frontend_dir, check=True)
    
    dist_dir = frontend_dir / "dist"
    if not dist_dir.exists():
        print("❌ Error: Frontend dist directory was not created!")
        sys.exit(1)
        
    print("✨ [2/3] Installing PyInstaller packaging requirements...")
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
