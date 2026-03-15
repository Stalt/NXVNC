"""
One-command build orchestrator for videowares WebVNC.

Usage:
    python build.py                 # Full build
    python build.py --skip-installer # Skip Inno Setup installer creation
    python build.py --debug         # Enable debug output
"""
import argparse
import io
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from urllib.request import urlopen

NSSM_URL = "https://nssm.cc/release/nssm-2.24.zip"
NSSM_ZIP_PATH = "nssm-2.24/win64/nssm.exe"


def clean():
    """Remove previous build artifacts."""
    print("=" * 60)
    print("Step 1: Cleaning previous builds")
    print("=" * 60)
    for d in ("build", "dist"):
        p = Path(d)
        if p.exists():
            shutil.rmtree(p)
            print(f"  Removed {d}/")
    print("  Clean complete.\n")


def install_dependencies():
    """Install production Node.js dependencies."""
    print("=" * 60)
    print("Step 2: Installing production dependencies")
    print("=" * 60)
    result = subprocess.run(["npm", "ci", "--production"], check=False, shell=True)
    if result.returncode != 0:
        print("WARNING: npm ci failed, trying npm install...")
        subprocess.run(["npm", "install", "--production"], check=False, shell=True)
    print("  Dependencies installed.\n")


def build_service_exe():
    """Compile Node.js service to a single executable using pkg."""
    print("=" * 60)
    print("Step 3: Building service executable (pkg)")
    print("=" * 60)

    dist_dir = Path("dist/WebVNC")
    dist_dir.mkdir(parents=True, exist_ok=True)

    # Check if pkg is available
    result = subprocess.run(
        ["npx", "@yao-pkg/pkg", "service_runner.js",
         "--targets", "node22-win-x64",
         "--output", str(dist_dir / "WebVNCSvc.exe"),
         "--compress", "GZip"],
        check=False, shell=True
    )

    if result.returncode != 0:
        print("  WARNING: pkg compilation failed. Falling back to file copy.")
        # Fallback: copy the Node.js files directly
        copy_node_files(dist_dir)
    else:
        print(f"  Built WebVNCSvc.exe")
        # Copy native addon .node files that pkg cannot embed
        copy_native_modules(dist_dir)
    print()


def copy_native_modules(dist_dir):
    """Copy native .node addon files alongside the compiled exe."""
    print("  Copying native modules...")
    native_patterns = [
        ("node_modules/better-sqlite3/build/Release", "better_sqlite3.node"),
        ("node_modules/bcrypt/prebuilds/win32-x64", "bcrypt.node"),
    ]
    for src_dir, filename in native_patterns:
        src = Path(src_dir) / filename
        if src.exists():
            dest_dir = dist_dir / src_dir
            dest_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest_dir / filename)
            print(f"    Copied {src_dir}/{filename}")
        else:
            # Try glob pattern for prebuilt binaries
            for f in Path(src_dir).rglob("*.node") if Path(src_dir).exists() else []:
                rel = f.relative_to(".")
                dest = dist_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dest)
                print(f"    Copied {rel}")
    # Also copy the client files, config, and migrations (needed at runtime from disk)
    runtime_dirs = ["client", "config", "server/db/migrations"]
    for d in runtime_dirs:
        src = Path(d)
        if src.exists():
            shutil.copytree(src, dist_dir / d, dirs_exist_ok=True)
            print(f"    Copied {d}/")
    # Copy noVNC (entire package - client imports from /novnc/core/rfb.js)
    novnc_src = Path("node_modules/@novnc/novnc")
    if novnc_src.exists():
        novnc_dest = dist_dir / "node_modules/@novnc/novnc"
        novnc_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(novnc_src, novnc_dest, dirs_exist_ok=True)
        print(f"    Copied node_modules/@novnc/novnc/")
    # Copy package.json (needed by health endpoint)
    if Path("package.json").exists():
        shutil.copy2("package.json", dist_dir / "package.json")
        print(f"    Copied package.json")


def copy_node_files(dist_dir):
    """Fallback: copy Node.js app files to dist (no compilation)."""
    print("  Copying Node.js application files...")

    dirs_to_copy = ["server", "client", "config", "node_modules"]
    files_to_copy = ["service_runner.js", "package.json"]

    for d in dirs_to_copy:
        src = Path(d)
        if src.exists():
            shutil.copytree(src, dist_dir / d, dirs_exist_ok=True)
            print(f"    Copied {d}/")

    for f in files_to_copy:
        src = Path(f)
        if src.exists():
            shutil.copy2(src, dist_dir / f)
            print(f"    Copied {f}")


def build_tray_exe(debug=False):
    """Build the tray control panel with PyInstaller."""
    print("=" * 60)
    print("Step 4: Building tray control panel (PyInstaller)")
    print("=" * 60)

    # Check if PyInstaller is available
    try:
        import PyInstaller
    except ImportError:
        print("  WARNING: PyInstaller not installed. Run: pip install pyinstaller")
        print("  Skipping tray build.\n")
        return

    dist_dir = Path("dist/WebVNC")
    dist_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--noconsole",
        "--name", "WebVNC",
        "--distpath", str(dist_dir),
        "--workpath", "build/tray",
        "--specpath", "build",
    ]

    # Add icon if it exists
    icon_path = Path("assets/icon.ico")
    if icon_path.exists():
        cmd.extend(["--icon", str(icon_path)])

    if debug:
        cmd.append("--log-level=DEBUG")

    cmd.append("tray_app.py")

    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print("  ERROR: PyInstaller failed!")
    else:
        print("  Tray app built: WebVNC.exe")
    print()


def download_nssm():
    """Download NSSM and place it in the dist folder."""
    print("=" * 60)
    print("Step 5: Downloading NSSM")
    print("=" * 60)

    dist_dir = Path("dist/WebVNC")
    nssm_dest = dist_dir / "nssm.exe"

    if nssm_dest.exists():
        print("  NSSM already present, skipping download.")
        return

    # Check local copy
    if Path("nssm.exe").exists():
        shutil.copy2("nssm.exe", nssm_dest)
        print("  Copied local nssm.exe to dist.")
        return

    print(f"  Downloading from {NSSM_URL}...")
    try:
        with urlopen(NSSM_URL, timeout=30) as resp:
            zip_data = resp.read()
        with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
            with zf.open(NSSM_ZIP_PATH) as src:
                nssm_dest.write_bytes(src.read())
        print(f"  Downloaded NSSM to {nssm_dest}")
    except Exception as e:
        print(f"  WARNING: Failed to download NSSM: {e}")
        print("  The installer will still work but manage_service.bat will")
        print("  download NSSM on first use.")


def copy_dist_files():
    """Copy support files to dist."""
    print("=" * 60)
    print("Step 6: Copying support files to dist")
    print("=" * 60)

    dist_dir = Path("dist/WebVNC")
    if not dist_dir.exists():
        print("  WARNING: dist/WebVNC not found. Skipping.")
        return

    for f in ["manage_service.bat"]:
        src = Path(f)
        if src.exists():
            shutil.copy2(src, dist_dir / f)
            print(f"  Copied {f}")

    print("  Copy complete.\n")


def verify_build():
    """Verify the build output."""
    print("=" * 60)
    print("Build verification")
    print("=" * 60)

    dist_dir = Path("dist/WebVNC")

    for name, filename in [
        ("Tray control panel", "WebVNC.exe"),
        ("Service executable", "WebVNCSvc.exe"),
        ("NSSM", "nssm.exe"),
        ("Service manager", "manage_service.bat"),
    ]:
        p = dist_dir / filename
        if p.exists():
            size_mb = p.stat().st_size / (1024 * 1024)
            print(f"  {name}: {p} ({size_mb:.1f} MB)")
        else:
            # Check fallback (Node.js files instead of exe)
            if filename == "WebVNCSvc.exe" and (dist_dir / "service_runner.js").exists():
                print(f"  {name}: Using Node.js files (no pkg compilation)")
            else:
                print(f"  WARNING: {filename} not found!")

    print()


def _read_version():
    """Read version from package.json."""
    try:
        import json
        with open("package.json") as f:
            return json.load(f).get("version", "1.0.0")
    except Exception:
        return "1.0.0"


def _next_build_number(override=None):
    """Read build number from build_number.txt."""
    bn_file = Path("build_number.txt")
    if override is not None:
        bn_file.write_text(f"{override + 1}\n")
        return override
    current = int(bn_file.read_text().strip()) if bn_file.exists() else 10001
    bn_file.write_text(f"{current + 1}\n")
    return current


def build_installer(build_number_override=None):
    """Build the Inno Setup installer."""
    print("=" * 60)
    print("Step 7: Building installer (Inno Setup)")
    print("=" * 60)

    iss_file = Path("installer.iss")
    if not iss_file.exists():
        print("  WARNING: installer.iss not found. Skipping installer.")
        return

    iscc_paths = [
        Path(os.path.expandvars(r"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe")),
        Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
        Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
    ]

    iscc = None
    for p in iscc_paths:
        if p.exists():
            iscc = p
            break

    if not iscc:
        result = subprocess.run(["where", "ISCC.exe"], capture_output=True, text=True)
        if result.returncode == 0:
            iscc = Path(result.stdout.strip().splitlines()[0])

    if not iscc:
        print("  WARNING: Inno Setup (ISCC.exe) not found.")
        print("  Install from: https://jrsoftware.org/isdl.php")
        print("  Skipping installer creation.\n")
        return

    build_num = _next_build_number(build_number_override)
    version = _read_version()
    full_version = f"{version}.{build_num}"
    print(f"  Version: {full_version}")
    print(f"  Using: {iscc}")

    result = subprocess.run(
        [str(iscc), f"/DMyBuildNumber={build_num}", str(iss_file)],
        check=False,
    )
    if result.returncode != 0:
        print("  ERROR: Installer compilation failed!")
        return

    installer = list(Path("dist").glob("WebVNCSetup_*.exe"))
    if installer:
        size_mb = installer[-1].stat().st_size / (1024 * 1024)
        print(f"  Installer: {installer[-1]} ({size_mb:.1f} MB)")
    print("  Installer build complete.\n")


def main():
    parser = argparse.ArgumentParser(description="Build videowares WebVNC")
    parser.add_argument("--skip-installer", action="store_true")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--build-number", type=int, default=None)
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("  videowares WebVNC — Build")
    print("=" * 60 + "\n")

    clean()
    install_dependencies()
    build_service_exe()
    build_tray_exe(debug=args.debug)
    download_nssm()
    copy_dist_files()
    verify_build()

    if not args.skip_installer:
        build_installer(build_number_override=args.build_number)
    else:
        print("Step 7: SKIPPED (--skip-installer)\n")

    print("=" * 60)
    print("  BUILD COMPLETE")
    print("=" * 60)

    installers = sorted(Path("dist").glob("WebVNCSetup_*.exe"))
    installer = installers[-1] if installers else None
    if installer and installer.exists():
        print()
        print(f"  ONE-CLICK INSTALLER: {installer}")
        print()
        print("  Users just double-click the installer. It handles everything:")
        print("    - Installs files to Program Files")
        print("    - Registers the Windows Service (auto-start at boot)")
        print("    - Starts the service immediately")
        print("    - Sets up tray control panel on login")
        print("    - Creates Start Menu shortcuts")
    else:
        print()
        print("  Manual setup (no installer):")
        print("  1. Copy dist\\WebVNC\\ to target machine")
        print("  2. Run manage_service.bat install  (as Admin, once)")
        print("  3. Run manage_service.bat start    (starts the service)")
        print("  4. Double-click WebVNC.exe (tray control panel)")
        print()
        print("  The service runs at boot without login.")
        print("  The tray app starts on user login for web access.")


if __name__ == "__main__":
    main()
