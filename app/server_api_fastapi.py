from datetime import datetime
import math
import hashlib
import hmac
import json
import os
import re
import secrets
from typing import List, Optional
from urllib.parse import urlencode

from pathlib import Path

from dotenv import load_dotenv

# Load app/.env regardless of current working directory
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from google.auth.transport import requests as grequests
from google.oauth2 import id_token
from pydantic import BaseModel, EmailStr, Field
import requests
from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer,
                        String, create_engine, inspect, text)
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

from app.gps_tracker import router as gps_router
from app.gps_tracker import upsert_gps_device, compute_zone_breaches, device_is_online, devices as gps_devices, reverse_geocode_plain

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./eshady.db")
SECRET_KEY = os.environ.get("ESHADY_SECRET_KEY", "eshady-secret-key-2026")
GOOGLE_CALLBACK_PATH = "/auth/google/callback"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    token = Column(String, unique=True, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    stations = relationship("Station", back_populates="owner")


class Station(Base):
    __tablename__ = "stations"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    location = Column(String, nullable=True)
    latitude = Column(Float, default=0.0)
    longitude = Column(Float, default=0.0)
    battery_pct = Column(Integer, default=0)
    charge_w = Column(Integer, default=0)
    temperature = Column(Float, default=0.0)
    voltage = Column(Float, default=0.0)
    online = Column(Boolean, default=True)
    safe_zone = Column(Boolean, default=True)
    alert = Column(Boolean, default=False)
    paired_at = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow)
    safe_zone_radius = Column(Float, default=100.0)
    safe_zone_lat = Column(Float, nullable=True)
    safe_zone_lng = Column(Float, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"))

    owner = relationship("User", back_populates="stations")
    telemetry = relationship("Telemetry", back_populates="station", cascade="all, delete-orphan")


class Telemetry(Base):
    __tablename__ = "telemetry"

    id = Column(Integer, primary_key=True, index=True)
    station_id = Column(Integer, ForeignKey("stations.id"), nullable=False)
    battery_pct = Column(Integer, nullable=False)
    charge_w = Column(Integer, nullable=False)
    temperature = Column(Float, nullable=False)
    voltage = Column(Float, nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    alert = Column(Boolean, default=False)
    safe_zone = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    station = relationship("Station", back_populates="telemetry")


class UserCreate(BaseModel):
    first_name: str = Field(..., min_length=1)
    last_name: str = Field(..., min_length=1)
    email: EmailStr
    password: str = Field(..., min_length=1)

    model_config = {"from_attributes": True}


class UserLogin(BaseModel):
    email: EmailStr
    password: str

    model_config = {"from_attributes": True}


class UserAuthResponse(BaseModel):
    user_id: int
    email: EmailStr
    first_name: str
    last_name: str
    token: str

    model_config = {"from_attributes": True}


class UserOut(BaseModel):
    user_id: int
    email: EmailStr
    first_name: str
    last_name: str

    model_config = {"from_attributes": True}


class StationCreate(BaseModel):
    device_id: str
    name: str
    location: Optional[str] = None
    latitude: Optional[float] = 0.0
    longitude: Optional[float] = 0.0
    safe_zone_radius: Optional[float] = 100.0

    model_config = {"from_attributes": True}


class DevicePairRequest(BaseModel):
    device_id: str
    name: Optional[str] = None
    location: Optional[str] = None
    safe_zone_radius: Optional[float] = 100.0

    model_config = {"from_attributes": True}


class StationUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    battery_pct: Optional[int] = None
    charge_w: Optional[int] = None
    temperature: Optional[float] = None
    safe_zone: Optional[bool] = None
    alert: Optional[bool] = None

    model_config = {"from_attributes": True}


class TelemetryCreate(BaseModel):
    device_id: str
    battery_pct: int
    charge_w: int
    temperature: float
    voltage: Optional[float] = None
    latitude: float
    longitude: float
    alert: Optional[bool] = False
    safe_zone: Optional[bool] = True

    model_config = {"from_attributes": True}


class GoogleLoginRequest(BaseModel):
    credential: str

    model_config = {"from_attributes": True}


class StationOut(BaseModel):
    id: int
    device_id: str
    name: str
    location: Optional[str]
    latitude: float
    longitude: float
    battery_pct: int
    charge_w: int
    temperature: float
    voltage: Optional[float]
    online: bool
    safe_zone: bool
    safe_zone_radius: float
    alert: bool
    paired_at: datetime
    last_seen: datetime

    model_config = {"from_attributes": True}


class DashboardStationOut(BaseModel):
    id: Optional[int] = None
    device_id: str
    name: str
    location: Optional[str]
    latitude: float
    longitude: float
    battery_pct: int
    charge_w: int
    temperature: float
    voltage: Optional[float]
    online: bool
    safe_zone: bool
    alert: bool
    paired_at: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    paired: bool = True
    live_on_map: bool = False

    model_config = {"from_attributes": True}


class DiscoveredDeviceOut(BaseModel):
    device_id: str
    mac: Optional[str] = None
    name: str
    latitude: float
    longitude: float
    online: bool
    fix_valid: bool
    received_at: Optional[datetime] = None
    paired: bool = False

    model_config = {"from_attributes": True}


class TelemetryOut(BaseModel):
    id: int
    station_id: int
    battery_pct: int
    charge_w: int
    temperature: float
    latitude: float
    longitude: float
    alert: bool
    safe_zone: bool
    created_at: datetime

    model_config = {"from_attributes": True}


app = FastAPI(title="E·Shady API")
app.include_router(gps_router)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATE_DIR = os.path.join(BASE_DIR, "template")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATE_DIR)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        SECRET_KEY.encode("utf-8"),
        150_000,
    ).hex()


def verify_password(password: str, stored_hash: str) -> bool:
    computed = hash_password(password)
    return hmac.compare_digest(computed, stored_hash)


def create_session_token() -> str:
    return secrets.token_urlsafe(32)


def get_or_create_google_user(db: Session, id_info: dict) -> User:
    email = id_info.get("email", "").lower().strip()
    if not email:
        raise HTTPException(status_code=401, detail="Google account did not include an email.")

    first_name = id_info.get("given_name") or id_info.get("name") or "User"
    last_name = id_info.get("family_name") or ""

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(
            email=email,
            first_name=first_name.strip().title(),
            last_name=last_name.strip().title(),
            password_hash="",
            token=create_session_token(),
        )
    else:
        user.token = create_session_token()

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_token(db: Session, token: str) -> Optional[User]:
    return db.query(User).filter(User.token == token).first()


def get_current_user(
    authorization: Optional[str] = Header(None), db: Session = Depends(get_db)
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token.",
        )

    token = authorization.split(" ", 1)[1].strip()
    user = get_user_by_token(db, token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token expired or invalid.",
        )
    return user


def migrate_db_schema() -> None:
    """SQLite has no automatic migrations; add missing columns if needed."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    if "stations" in tables:
        cols = {c["name"] for c in inspector.get_columns("stations")}
        if "voltage" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE stations ADD COLUMN voltage FLOAT DEFAULT 0.0"))
        if "safe_zone_radius" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE stations ADD COLUMN safe_zone_radius FLOAT DEFAULT 100.0"))
        if "safe_zone_lat" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE stations ADD COLUMN safe_zone_lat FLOAT"))
        if "safe_zone_lng" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE stations ADD COLUMN safe_zone_lng FLOAT"))

    if "telemetry" in tables:
        cols = {c["name"] for c in inspector.get_columns("telemetry")}
        if "voltage" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE telemetry ADD COLUMN voltage FLOAT"))


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    migrate_db_schema()


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("index.html", {"request": request})


@app.head("/")
def index_head() -> Response:
    return Response(status_code=status.HTTP_200_OK)


@app.get("/health", response_class=JSONResponse)
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.head("/health")
def health_head() -> Response:
    return Response(status_code=status.HTTP_200_OK)


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        "login.html",
        {
            "request": request,
            "google_client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        },
    )


@app.get("/signup", response_class=HTMLResponse)
def signup_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        "signup.html",
        {
            "request": request,
            "google_client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        },
    )


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        "dashboard.html",
        {"request": request, "active_page": "dashboard"},
    )


@app.get("/map", response_class=HTMLResponse)
def map_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        "maps.html",
        {"request": request, "active_page": "map"},
    )


@app.get("/alerts", response_class=HTMLResponse)
def alerts_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        "alerts.html",
        {"request": request, "active_page": "alerts"},
    )


def get_public_base_url(request: Request) -> str:
    configured_base_url = os.getenv("PUBLIC_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL")
    if configured_base_url:
        return configured_base_url.rstrip("/")

    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if forwarded_host:
        scheme = forwarded_proto or request.url.scheme
        return f"{scheme}://{forwarded_host}".rstrip("/")

    return str(request.base_url).rstrip("/")


def get_google_redirect_uri(request: Request) -> str:
    configured_redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")
    if configured_redirect_uri:
        return configured_redirect_uri
    return f"{get_public_base_url(request)}{GOOGLE_CALLBACK_PATH}"


def google_oauth_config_status(request: Request) -> dict:
    redirect_uri = get_google_redirect_uri(request)
    return {
        "client_id_configured": bool(os.getenv("GOOGLE_CLIENT_ID")),
        "client_secret_configured": bool(os.getenv("GOOGLE_CLIENT_SECRET")),
        "redirect_uri": redirect_uri,
        "redirect_uri_is_callback": redirect_uri.endswith(GOOGLE_CALLBACK_PATH),
    }


@app.get("/api/auth/google/config", response_class=JSONResponse)
def google_config(request: Request) -> JSONResponse:
    return JSONResponse(google_oauth_config_status(request))


@app.get("/auth/google")
def google_oauth_start(request: Request, next: str = "/dashboard") -> RedirectResponse:
    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
    google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not google_client_id or not google_client_secret:
        missing = "client_id" if not google_client_id else "client_secret"
        return RedirectResponse(f"/login?oauth_error=missing_google_{missing}")

    safe_next = next if next.startswith("/") and not next.startswith("//") else "/dashboard"
    params = {
        "client_id": google_client_id,
        "redirect_uri": get_google_redirect_uri(request),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
        "state": safe_next,
    }
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}")


@app.get("/auth/google/callback", response_class=HTMLResponse)
def google_oauth_callback(
    request: Request,
    code: Optional[str] = None,
    state: str = "/dashboard",
    error: Optional[str] = None,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    if error:
        return HTMLResponse(f"Google sign-in failed: {error}", status_code=400)
    if not code:
        return HTMLResponse("Google sign-in failed: missing authorization code.", status_code=400)

    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
    google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not google_client_id or not google_client_secret:
        return HTMLResponse(
            "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, "
            f"and GOOGLE_REDIRECT_URI={get_google_redirect_uri(request)} in Render.",
            status_code=500,
        )

    token_response = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": google_client_id,
            "client_secret": google_client_secret,
            "redirect_uri": get_google_redirect_uri(request),
            "grant_type": "authorization_code",
        },
        timeout=10,
    )
    if not token_response.ok:
        return HTMLResponse("Google sign-in failed while exchanging the authorization code.", status_code=401)

    token_data = token_response.json()
    google_id_token = token_data.get("id_token")
    if not google_id_token:
        return HTMLResponse("Google sign-in failed: missing identity token.", status_code=401)

    try:
        id_info = id_token.verify_oauth2_token(google_id_token, grequests.Request(), google_client_id)
    except ValueError:
        return HTMLResponse("Google sign-in failed: invalid identity token.", status_code=401)

    user = get_or_create_google_user(db, id_info)
    redirect_to = state if state.startswith("/") and not state.startswith("//") else "/dashboard"

    return HTMLResponse(
        f"""
        <!doctype html>
        <html lang="en">
        <head><meta charset="utf-8"><title>Signing in...</title></head>
        <body>
          <script>
            localStorage.setItem("eshady_token", {json.dumps(user.token)});
            window.location.replace({json.dumps(redirect_to)});
          </script>
          Signing you in...
        </body>
        </html>
        """
    )


@app.post("/api/users/signup", response_model=UserAuthResponse)
def signup_user(user_in: UserCreate, db: Session = Depends(get_db)) -> UserAuthResponse:
    existing = db.query(User).filter(User.email == user_in.email.lower()).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="Email already registered.")

    token = create_session_token()
    user = User(
        email=user_in.email.lower(),
        first_name=user_in.first_name.strip().title(),
        last_name=user_in.last_name.strip().title(),
        password_hash=hash_password(user_in.password),
        token=token,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return UserAuthResponse(
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        token=user.token,
    )


@app.post("/api/users/google-login", response_model=UserAuthResponse)
def google_login(request_body: GoogleLoginRequest, db: Session = Depends(get_db)) -> UserAuthResponse:
    credential = request_body.credential
    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not google_client_id:
        raise HTTPException(status_code=500, detail="Google OAuth is not configured.")

    try:
        id_info = id_token.verify_oauth2_token(credential, grequests.Request(), google_client_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google credential.")

    user = get_or_create_google_user(db, id_info)

    return UserAuthResponse(
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        token=user.token,
    )


@app.post("/api/users/login", response_model=UserAuthResponse)
def login_user(user_in: UserLogin, db: Session = Depends(get_db)) -> UserAuthResponse:
    user = db.query(User).filter(User.email == user_in.email.lower()).first()
    if user is None or not verify_password(user_in.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user.token = create_session_token()
    db.add(user)
    db.commit()
    db.refresh(user)

    return UserAuthResponse(
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        token=user.token,
    )


@app.get("/api/users/me", response_model=UserOut)
def get_profile(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(
        user_id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
    )


@app.get("/api/stations", response_model=List[StationOut])
def list_stations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> List[StationOut]:
    return [
        StationOut(
            id=station.id,
            device_id=station.device_id,
            name=station.name,
            location=station.location,
            latitude=station.latitude,
            longitude=station.longitude,
            battery_pct=station.battery_pct,
            charge_w=station.charge_w,
            temperature=station.temperature,
            voltage=station.voltage,
            online=station.online,
            safe_zone=station.safe_zone,
            safe_zone_radius=station.safe_zone_radius,
            alert=station.alert,
            paired_at=station.paired_at,
            last_seen=station.last_seen,
        )
        for station in db.query(Station).filter(Station.user_id == current_user.id).order_by(Station.last_seen.desc())
    ]


def _normalize_device_id(raw: str) -> str:
    value = (raw or "").strip().upper()
    compact_mac = re.sub(r"[^0-9A-F]", "", value)
    if len(compact_mac) == 12 and re.fullmatch(r"[0-9A-F]{12}", compact_mac):
        return compact_mac
    return value


def _parse_iso_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _location_label(lat: float, lng: float) -> Optional[str]:
    """Use cached geocode only — never block dashboard on external API calls."""
    if not lat and not lng:
        return None
    from app.gps_tracker import _geocode_cache

    key = f"{lat:.4f},{lng:.4f}"
    cached = _geocode_cache.get(key)
    if cached:
        return cached.replace("<br>", ", ").replace(", ,", ",").strip(" ,")
    return None


def _gps_aliases(device: dict, fallback_id: str) -> set[str]:
    return {
        _normalize_device_id(str(value))
        for value in (fallback_id, device.get("id"), device.get("mac"))
        if value
    }


def _find_live_gps_device(device_id: str) -> Optional[dict]:
    normalized = _normalize_device_id(device_id)
    for live_id, live in gps_devices.items():
        if normalized in _gps_aliases(live, live_id):
            return live
    return None


def _find_station_by_device_id(db: Session, device_id: str) -> Optional[Station]:
    normalized = _normalize_device_id(device_id)
    station = db.query(Station).filter(Station.device_id == normalized).first()
    if station is not None:
        return station
    for candidate in db.query(Station).all():
        if _normalize_device_id(candidate.device_id) == normalized:
            return candidate
    return None


def _station_alert_for_position(station: Station, lat: float, lng: float) -> bool:
    if not station.safe_zone:
        return False
    if station.safe_zone_lat is None or station.safe_zone_lng is None:
        return bool(station.alert)
    radius = float(station.safe_zone_radius or 100.0)
    return haversine_distance(float(station.safe_zone_lat), float(station.safe_zone_lng), lat, lng) > radius


def _discovered_device_out(live_id: str, live: dict, paired_ids: set[str]) -> DiscoveredDeviceOut:
    aliases = _gps_aliases(live, live_id)
    device_id = _normalize_device_id(str(live.get("mac") or live.get("id") or live_id))
    received_at = _parse_iso_dt(live.get("received_at"))
    return DiscoveredDeviceOut(
        device_id=device_id,
        mac=live.get("mac") or device_id,
        name=str(live.get("name") or device_id),
        latitude=float(live.get("latitude", 0) or 0),
        longitude=float(live.get("longitude", 0) or 0),
        online=device_is_online(live),
        fix_valid=bool(live.get("fix_valid")),
        received_at=received_at,
        paired=bool(aliases & paired_ids),
    )


@app.get("/api/dashboard/stations", response_model=List[DashboardStationOut])
def list_dashboard_stations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[DashboardStationOut]:
    # Paired stations from DB
    paired_rows = (
        db.query(Station)
        .filter(Station.user_id == current_user.id)
        .order_by(Station.last_seen.desc())
        .all()
    )
    paired_by_device: dict[str, Station] = { _normalize_device_id(s.device_id): s for s in paired_rows }

    out: list[DashboardStationOut] = []

    # Merge: paired stations, enriched by live GPS if available
    for station in paired_rows:
        dev_id = _normalize_device_id(station.device_id)
        live = _find_live_gps_device(dev_id)

        lat = station.latitude
        lng = station.longitude
        last_seen = station.last_seen
        online = station.online

        if live:
            live_lat = float(live.get("latitude", 0) or 0)
            live_lng = float(live.get("longitude", 0) or 0)
            if not (live_lat == 0 and live_lng == 0):
                lat = live_lat
                lng = live_lng
            online = device_is_online(live)
            live_seen = _parse_iso_dt(live.get("received_at"))
            if live_seen:
                last_seen = live_seen

        location = (
            (live.get("address_label") if live else None)
            or station.location
            or _location_label(lat, lng)
        )

        out.append(
            DashboardStationOut(
                id=station.id,
                device_id=station.device_id,
                name=station.name,
                location=location,
                latitude=lat,
                longitude=lng,
                battery_pct=station.battery_pct,
                charge_w=station.charge_w,
                temperature=station.temperature,
                voltage=station.voltage,
                online=online,
                safe_zone=station.safe_zone,
                alert=_station_alert_for_position(station, float(lat or 0), float(lng or 0)),
                paired_at=station.paired_at,
                last_seen=last_seen,
                paired=True,
                live_on_map=bool(live),
            )
        )

    # Add unpaired live GPS devices (seen on map) so dashboard can show them
    for live_id, live in gps_devices.items():
        dev_id = _normalize_device_id(live_id)
        if not dev_id or (_gps_aliases(live, live_id) & set(paired_by_device.keys())):
            continue
        lat = float(live.get("latitude", 0) or 0)
        lng = float(live.get("longitude", 0) or 0)
        if lat == 0 and lng == 0:
            continue
        out.append(
            DashboardStationOut(
                id=None,
                device_id=dev_id,
                name=str(live.get("name") or dev_id),
                location=live.get("address_label") or _location_label(lat, lng),
                latitude=lat,
                longitude=lng,
                battery_pct=0,
                charge_w=0,
                temperature=0.0,
                voltage=None,
                online=device_is_online(live),
                safe_zone=False,
                alert=False,
                paired_at=None,
                last_seen=_parse_iso_dt(live.get("received_at")),
                paired=False,
                live_on_map=True,
            )
        )

    # Put paired devices first, then unpaired live
    out.sort(key=lambda s: (0 if s.paired else 1, s.name.lower()))
    return out


@app.get("/api/esp32/discover", response_model=List[DiscoveredDeviceOut])
def discover_esp32_devices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[DiscoveredDeviceOut]:
    paired_rows = db.query(Station).filter(Station.user_id == current_user.id).all()
    paired_ids = {_normalize_device_id(station.device_id) for station in paired_rows}
    discovered = [
        _discovered_device_out(live_id, live, paired_ids)
        for live_id, live in gps_devices.items()
    ]
    discovered.sort(key=lambda item: (item.paired, not item.online, item.name.lower()))
    return discovered


@app.post("/api/esp32/pair", response_model=StationOut)
def pair_esp32_device(
    pair_in: DevicePairRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StationOut:
    device_id = _normalize_device_id(pair_in.device_id)
    if not device_id:
        raise HTTPException(status_code=400, detail="Device ID is required.")

    live = _find_live_gps_device(device_id)
    existing = _find_station_by_device_id(db, device_id)
    if existing is not None and existing.user_id not in (None, current_user.id):
        raise HTTPException(status_code=400, detail="That station is already paired.")

    live_lat = float(live.get("latitude", 0) or 0) if live else 0.0
    live_lng = float(live.get("longitude", 0) or 0) if live else 0.0
    station_name = (pair_in.name or (live.get("name") if live else None) or f"E-Shady {device_id[-4:]}").strip()
    location = (pair_in.location or (live.get("address_label") if live else None) or _location_label(live_lat, live_lng) or "Current GPS location").strip()

    station = existing or Station(device_id=device_id, name=station_name)
    station.device_id = device_id
    station.user_id = current_user.id
    station.name = station_name
    station.location = location
    station.online = device_is_online(live) if live else station.online
    station.latitude = live_lat or station.latitude or 0.0
    station.longitude = live_lng or station.longitude or 0.0
    station.safe_zone = True
    station.safe_zone_radius = float(pair_in.safe_zone_radius or station.safe_zone_radius or 100.0)
    if live_lat or live_lng:
        station.safe_zone_lat = live_lat
        station.safe_zone_lng = live_lng
    station.alert = False
    station.paired_at = datetime.utcnow()
    station.last_seen = datetime.utcnow()

    db.add(station)
    db.commit()
    db.refresh(station)

    return StationOut(
        id=station.id,
        device_id=station.device_id,
        name=station.name,
        location=station.location,
        latitude=station.latitude,
        longitude=station.longitude,
        battery_pct=station.battery_pct,
        charge_w=station.charge_w,
        temperature=station.temperature,
        voltage=station.voltage,
        online=station.online,
        safe_zone=station.safe_zone,
        safe_zone_radius=station.safe_zone_radius,
        alert=station.alert,
        paired_at=station.paired_at,
        last_seen=station.last_seen,
    )


@app.post("/api/stations", response_model=StationOut)
def create_station(
    station_in: StationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StationOut:
    device_id = _normalize_device_id(station_in.device_id)
    existing = _find_station_by_device_id(db, device_id)
    if existing is not None:
        if existing.user_id is not None and existing.user_id != current_user.id:
            raise HTTPException(status_code=400, detail="That station is already paired.")

        existing.user_id = current_user.id
        existing.device_id = device_id
        existing.name = station_in.name.strip()
        existing.location = station_in.location.strip() if station_in.location else existing.location
        existing.latitude = station_in.latitude or existing.latitude
        existing.longitude = station_in.longitude or existing.longitude
        existing.safe_zone_radius = float(station_in.safe_zone_radius or existing.safe_zone_radius or 100.0)
        if station_in.latitude or station_in.longitude:
            existing.safe_zone_lat = station_in.latitude
            existing.safe_zone_lng = station_in.longitude
        existing.paired_at = datetime.utcnow()
        station = existing
    else:
        latitude = station_in.latitude or 0.0
        longitude = station_in.longitude or 0.0
        station = Station(
            device_id=device_id,
            name=station_in.name.strip(),
            location=station_in.location.strip() if station_in.location else None,
            latitude=latitude,
            longitude=longitude,
            safe_zone_radius=float(station_in.safe_zone_radius or 100.0),
            safe_zone_lat=latitude if latitude or longitude else None,
            safe_zone_lng=longitude if latitude or longitude else None,
            user_id=current_user.id,
            last_seen=datetime.utcnow(),
        )

    db.add(station)
    db.commit()
    db.refresh(station)

    return StationOut(
        id=station.id,
        device_id=station.device_id,
        name=station.name,
        location=station.location,
        latitude=station.latitude,
        longitude=station.longitude,
        battery_pct=station.battery_pct,
        charge_w=station.charge_w,
        temperature=station.temperature,
        voltage=station.voltage,
        online=station.online,
        safe_zone=station.safe_zone,
        safe_zone_radius=station.safe_zone_radius,
        alert=station.alert,
        paired_at=station.paired_at,
        last_seen=station.last_seen,
    )


@app.patch("/api/stations/{station_id}", response_model=StationOut)
def update_station(
    station_id: int,
    station_update: StationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StationOut:
    station = db.query(Station).filter(Station.id == station_id, Station.user_id == current_user.id).first()
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")

    for field, value in station_update.model_dump(exclude_unset=True).items():
        setattr(station, field, value)

    station.last_seen = datetime.utcnow()
    db.add(station)
    db.commit()
    db.refresh(station)

    return StationOut(
        id=station.id,
        device_id=station.device_id,
        name=station.name,
        location=station.location,
        latitude=station.latitude,
        longitude=station.longitude,
        battery_pct=station.battery_pct,
        charge_w=station.charge_w,
        temperature=station.temperature,
        voltage=station.voltage,
        online=station.online,
        safe_zone=station.safe_zone,
        safe_zone_radius=station.safe_zone_radius,
        alert=station.alert,
        paired_at=station.paired_at,
        last_seen=station.last_seen,
    )


@app.delete("/api/stations/{station_id}")
def delete_station(
    station_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JSONResponse:
    station = db.query(Station).filter(Station.id == station_id, Station.user_id == current_user.id).first()
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")

    db.delete(station)
    db.commit()
    return JSONResponse({"detail": "Station deleted."})


@app.post("/api/esp32/telemetry", response_model=StationOut)
def receive_esp32_telemetry(
    telemetry: TelemetryCreate,
    db: Session = Depends(get_db),
    user_id: Optional[int] = None,
) -> StationOut:
    device_id = _normalize_device_id(telemetry.device_id)
    station = _find_station_by_device_id(db, device_id)
    if station is None:
        station = Station(
            device_id=device_id,
            name=f"E·Shady {device_id}",
            location="Unknown location",
            latitude=telemetry.latitude,
            longitude=telemetry.longitude,
            battery_pct=telemetry.battery_pct,
            charge_w=telemetry.charge_w,
            temperature=telemetry.temperature,
            voltage=telemetry.voltage or 0.0,
            online=True,
            safe_zone=telemetry.safe_zone,
            alert=telemetry.alert,
            safe_zone_lat=telemetry.latitude,
            safe_zone_lng=telemetry.longitude,
            last_seen=datetime.utcnow(),
        )
        db.add(station)
        db.commit()
        db.refresh(station)
    else:
        station.device_id = device_id
        station.battery_pct = telemetry.battery_pct
        station.charge_w = telemetry.charge_w
        station.temperature = telemetry.temperature
        station.voltage = telemetry.voltage or station.voltage
        station.safe_zone = telemetry.safe_zone
        if station.user_id is not None and station.safe_zone:
            if station.safe_zone_lat is None or station.safe_zone_lng is None:
                station.safe_zone_lat = telemetry.latitude
                station.safe_zone_lng = telemetry.longitude
            station.alert = _station_alert_for_position(station, telemetry.latitude, telemetry.longitude)
        else:
            station.alert = telemetry.alert
        station.latitude = telemetry.latitude
        station.longitude = telemetry.longitude
        station.online = True
        station.last_seen = datetime.utcnow()
        db.add(station)
        db.commit()

    record = Telemetry(
        station_id=station.id,
        battery_pct=telemetry.battery_pct,
        charge_w=telemetry.charge_w,
        temperature=telemetry.temperature,
        voltage=telemetry.voltage,
        latitude=telemetry.latitude,
        longitude=telemetry.longitude,
        alert=station.alert,
        safe_zone=telemetry.safe_zone,
    )
    db.add(record)
    db.commit()

    # Keep in-memory map state in sync for /map and /api/devices
    upsert_gps_device(
        device_id,
        name=station.name,
        latitude=telemetry.latitude,
        longitude=telemetry.longitude,
        fix_valid=True,
    )

    return StationOut(
        id=station.id,
        device_id=station.device_id,
        name=station.name,
        location=station.location,
        latitude=station.latitude,
        longitude=station.longitude,
        battery_pct=station.battery_pct,
        charge_w=station.charge_w,
        temperature=station.temperature,
        voltage=station.voltage,
        online=station.online,
        safe_zone=station.safe_zone,
        safe_zone_radius=station.safe_zone_radius,
        alert=station.alert,
        paired_at=station.paired_at,
        last_seen=station.last_seen,
    )


@app.get("/api/alerts", response_model=List[StationOut])
def list_alerts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> List[StationOut]:
    return [
        StationOut(
            id=station.id,
            device_id=station.device_id,
            name=station.name,
            location=station.location,
            latitude=station.latitude,
            longitude=station.longitude,
            battery_pct=station.battery_pct,
            charge_w=station.charge_w,
            temperature=station.temperature,
            voltage=station.voltage,
            online=station.online,
            safe_zone=station.safe_zone,
            safe_zone_radius=station.safe_zone_radius,
            alert=station.alert,
            paired_at=station.paired_at,
            last_seen=station.last_seen,
        )
        for station in db.query(Station)
        .filter(Station.user_id == current_user.id, Station.alert == True)
        .order_by(Station.last_seen.desc())
    ]


@app.get("/api/telemetry", response_model=List[TelemetryOut])
def get_telemetry(
    station_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[TelemetryOut]:
    query = db.query(Telemetry).join(Station).filter(Station.user_id == current_user.id)
    if station_id is not None:
        query = query.filter(Telemetry.station_id == station_id)
    records = query.order_by(Telemetry.created_at.desc()).limit(50).all()
    return [
        TelemetryOut(
            id=record.id,
            station_id=record.station_id,
            battery_pct=record.battery_pct,
            charge_w=record.charge_w,
            temperature=record.temperature,
            latitude=record.latitude,
            longitude=record.longitude,
            alert=record.alert,
            safe_zone=record.safe_zone,
            created_at=record.created_at,
        )
        for record in records
    ]


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in meters between two lat/lon points."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


if __name__ == "__main__":
    import uvicorn

    # Bind on all interfaces so ESP32 / other devices can reach the server.
    uvicorn.run("server_api_fastapi:app", host="0.0.0.0", port=8000, reload=True)
