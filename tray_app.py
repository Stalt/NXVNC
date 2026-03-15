"""
NXVNC System Tray Application
Manages the NXVNC Windows Service and provides quick access to the web interface.
"""

import os
import sys
import time
import ctypes
import subprocess
import threading
import logging
import winreg
import webbrowser
import urllib.request
import ssl
from logging.handlers import RotatingFileHandler

# ── Constants ──────────────────────────────────────────────────────────────────

SERVICE_NAME = "NXVNC"
SERVICE_DISPLAY = "NXVNC Remote Desktop"
SERVICE_EXE = "NXVNCSvc.exe"
TRAY_EXE = "NXVNC.exe"
REGISTRY_NAME = "NXVNCTray"
DASHBOARD_URL = "https://localhost:6080"
HEALTH_URL = "https://localhost:6080/health"
HEALTH_POLL_INTERVAL = 5  # seconds

LOG_DIR = os.path.join(os.environ.get("LOCALAPPDATA", ""), "NXVNC")
LOG_FILE = os.path.join(LOG_DIR, "tray.log")
LOG_MAX_BYTES = 5 * 1024 * 1024  # 5 MB
LOG_BACKUP_COUNT = 3

# ── Logging ────────────────────────────────────────────────────────────────────

os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger("NXVNCTray")
logger.setLevel(logging.DEBUG)

_handler = RotatingFileHandler(
    LOG_FILE, maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT, encoding="utf-8"
)
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(_handler)

# ── PIL / pystray imports ─────────────────────────────────────────────────────

try:
    from PIL import Image, ImageDraw, ImageFont
    import pystray
    from pystray import MenuItem, Menu
except ImportError as exc:
    logger.error("Missing dependency: %s  — pip install pystray pillow", exc)
    ctypes.windll.user32.MessageBoxW(
        0,
        "Missing Python packages.\nRun:  pip install pystray pillow",
        "NXVNC Tray",
        0x10,
    )
    sys.exit(1)

# ── Helpers ────────────────────────────────────────────────────────────────────


def _is_admin():
    """Return True if running with elevated privileges."""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False


def _run_elevated(cmd: str, args: str = ""):
    """Launch a command via UAC elevation (ShellExecuteW with runas)."""
    logger.info("Elevating: %s %s", cmd, args)
    ret = ctypes.windll.shell32.ShellExecuteW(None, "runas", cmd, args, None, 0)
    if ret <= 32:
        logger.error("UAC elevation failed (code %s)", ret)
    return ret > 32


def _sc(action: str):
    """Run 'sc <action> NXVNC' with elevation."""
    _run_elevated("sc.exe", f"{action} {SERVICE_NAME}")


def _query_service_status():
    """Query the Windows service status. Returns one of: running, stopped, starting, stopping, unknown."""
    try:
        result = subprocess.run(
            ["sc.exe", "query", SERVICE_NAME],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        output = result.stdout
        if "RUNNING" in output:
            return "running"
        elif "STOPPED" in output:
            return "stopped"
        elif "START_PENDING" in output:
            return "starting"
        elif "STOP_PENDING" in output:
            return "stopping"
        elif "does not exist" in result.stderr.lower() or result.returncode != 0:
            return "not_installed"
        return "unknown"
    except Exception as e:
        logger.debug("sc query failed: %s", e)
        return "unknown"


def _check_health():
    """Check if the NXVNC server is responding on HTTPS.
    Any HTTP response (200, 302, 401, etc.) means the server is up."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request(HEALTH_URL, method="GET")
        resp = urllib.request.urlopen(req, timeout=3, context=ctx)
        resp.close()
        return True
    except urllib.error.HTTPError:
        # Any HTTP error (401, 403, 500, etc.) means server is listening
        return True
    except Exception:
        return False


def _autostart_enabled():
    """Check if tray app is registered for auto-start in the registry."""
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_READ,
        )
        try:
            winreg.QueryValueEx(key, REGISTRY_NAME)
            return True
        except FileNotFoundError:
            return False
        finally:
            winreg.CloseKey(key)
    except Exception:
        return False


def _set_autostart(enabled: bool):
    """Add or remove tray app from Windows startup."""
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        )
        if enabled:
            exe_path = os.path.abspath(sys.argv[0])
            # If running as .py, wrap with pythonw; if compiled .exe, use directly
            if exe_path.endswith(".py"):
                value = f'pythonw.exe "{exe_path}"'
            else:
                value = f'"{exe_path}"'
            winreg.SetValueEx(key, REGISTRY_NAME, 0, winreg.REG_SZ, value)
            logger.info("Autostart enabled: %s", value)
        else:
            try:
                winreg.DeleteValue(key, REGISTRY_NAME)
                logger.info("Autostart disabled")
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    except Exception as e:
        logger.error("Failed to set autostart: %s", e)


# ── Icon Generation ───────────────────────────────────────────────────────────


def _create_icon(color: str) -> Image.Image:
    """Create a 64x64 tray icon with 'NX' text in the given color."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background circle
    margin = 2
    draw.ellipse([margin, margin, size - margin, size - margin], fill=(30, 30, 30, 230))

    # Color mapping
    color_map = {
        "green": (0, 200, 80),
        "yellow": (220, 180, 0),
        "red": (200, 50, 50),
        "gray": (120, 120, 120),
    }
    rgb = color_map.get(color, (120, 120, 120))

    # Status ring
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        outline=rgb,
        width=3,
    )

    # Draw "NX" text
    try:
        font = ImageFont.truetype("arial.ttf", 22)
    except Exception:
        try:
            font = ImageFont.truetype("C:\\Windows\\Fonts\\arial.ttf", 22)
        except Exception:
            font = ImageFont.load_default()

    text = "NX"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) // 2
    ty = (size - th) // 2 - 2
    draw.text((tx, ty), text, fill=rgb, font=font)

    return img


# ── Tray Application ─────────────────────────────────────────────────────────


class NXVNCTray:
    def __init__(self):
        self._status = "unknown"
        self._healthy = False
        self._icon = None
        self._stop_event = threading.Event()

        logger.info("NXVNC Tray starting (pid=%d)", os.getpid())

    # ── Actions ────────────────────────────────────────────────────────────

    def _start_service(self, icon=None, item=None):
        logger.info("User requested: start service")
        svc_status = _query_service_status()
        if svc_status == "not_installed":
            # Attempt fallback direct start
            logger.info("Service not installed, attempting direct start")
            self._fallback_direct_start()
        else:
            _sc("start")

    def _stop_service(self, icon=None, item=None):
        logger.info("User requested: stop service")
        _sc("stop")

    def _restart_service(self, icon=None, item=None):
        logger.info("User requested: restart service")
        # Stop, wait, start
        _sc("stop")
        threading.Thread(target=self._delayed_start, daemon=True).start()

    def _delayed_start(self):
        """Wait for service to stop, then start it."""
        for _ in range(20):
            time.sleep(1)
            st = _query_service_status()
            if st in ("stopped", "not_installed"):
                break
        _sc("start")

    def _fallback_direct_start(self):
        """Start the server directly if the Windows Service is not installed."""
        script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
        svc_exe = os.path.join(script_dir, SERVICE_EXE)
        runner_js = os.path.join(script_dir, "service_runner.js")

        if os.path.exists(svc_exe):
            logger.info("Fallback: starting %s", svc_exe)
            subprocess.Popen([svc_exe], cwd=script_dir, creationflags=subprocess.CREATE_NO_WINDOW)
        elif os.path.exists(runner_js):
            logger.info("Fallback: starting node service_runner.js")
            subprocess.Popen(["node", runner_js], cwd=script_dir, creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            logger.error("Cannot find %s or %s for fallback start", SERVICE_EXE, runner_js)

    def _open_web_interface(self, icon=None, item=None):
        logger.info("Opening web interface: %s", DASHBOARD_URL)
        webbrowser.open(DASHBOARD_URL)

    def _show_service_log(self, icon=None, item=None):
        """Open the service log file (or tray log) in the default text editor."""
        script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
        service_log = os.path.join(script_dir, "service.log")
        if os.path.exists(service_log):
            os.startfile(service_log)
        elif os.path.exists(LOG_FILE):
            os.startfile(LOG_FILE)
        else:
            logger.warning("No log file found to open")

    def _toggle_autostart(self, icon=None, item=None):
        current = _autostart_enabled()
        _set_autostart(not current)
        logger.info("Autostart toggled: %s -> %s", current, not current)
        self._update_icon()

    def _exit(self, icon=None, item=None):
        logger.info("User requested exit (service keeps running)")
        self._stop_event.set()
        if self._icon:
            self._icon.stop()

    # ── Status Polling ─────────────────────────────────────────────────────

    def _poll_status(self):
        """Background thread: poll service status and health every N seconds."""
        while not self._stop_event.is_set():
            try:
                self._status = _query_service_status()
                self._healthy = _check_health()
                self._update_icon()
            except Exception as e:
                logger.debug("Poll error: %s", e)
            self._stop_event.wait(HEALTH_POLL_INTERVAL)

    def _determine_color(self):
        """Determine icon color based on service status and health."""
        if self._status == "running" and self._healthy:
            return "green"
        elif self._status == "running" and not self._healthy:
            return "yellow"
        elif self._status in ("starting", "stopping"):
            return "yellow"
        elif self._status == "not_installed" and self._healthy:
            # Running outside of service
            return "green"
        else:
            return "red"

    def _determine_tooltip(self):
        color = self._determine_color()
        if color == "green":
            return f"{SERVICE_DISPLAY} — Running"
        elif color == "yellow":
            return f"{SERVICE_DISPLAY} — Starting..."
        else:
            return f"{SERVICE_DISPLAY} — Stopped"

    def _update_icon(self):
        if not self._icon:
            return
        try:
            color = self._determine_color()
            tooltip = self._determine_tooltip()
            self._icon.icon = _create_icon(color)
            self._icon.title = tooltip[:127]
            # Force Windows notification area to refresh the tooltip
            try:
                self._icon._update_title()
            except Exception:
                pass
        except Exception as e:
            logger.debug("Icon update error: %s", e)

    # ── Menu ───────────────────────────────────────────────────────────────

    def _build_menu(self):
        return Menu(
            MenuItem("Start Service", self._start_service),
            MenuItem("Stop Service", self._stop_service),
            MenuItem("Restart Service", self._restart_service),
            MenuItem("Open Web Interface", self._open_web_interface, default=True),
            MenuItem("Show Service Log", self._show_service_log),
            Menu.SEPARATOR,
            MenuItem(
                "Start Tray with Windows",
                self._toggle_autostart,
                checked=lambda item: _autostart_enabled(),
            ),
            Menu.SEPARATOR,
            MenuItem("Exit", self._exit),
        )

    # ── Run ────────────────────────────────────────────────────────────────

    def run(self):
        """Create the tray icon and start polling."""
        # Do initial status check before creating icon
        self._status = _query_service_status()
        self._healthy = _check_health()
        initial_color = self._determine_color()
        initial_tooltip = self._determine_tooltip()

        icon_image = _create_icon(initial_color)
        self._icon = pystray.Icon(
            SERVICE_NAME,
            icon_image,
            initial_tooltip,
            menu=self._build_menu(),
        )

        # Start health polling in background
        poller = threading.Thread(target=self._poll_status, daemon=True)
        poller.start()

        logger.info("Tray icon running")
        self._icon.run()
        logger.info("Tray icon stopped")


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    try:
        tray = NXVNCTray()
        tray.run()
    except Exception:
        logger.exception("Fatal error in tray app")
        sys.exit(1)
