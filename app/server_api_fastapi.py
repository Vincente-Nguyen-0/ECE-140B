from datetime import datetime
import hashlib
import hmac
import os
import secrets
from typing import List, Optional

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from google.auth.transport import requests as grequests
from google.oauth2 import id_token
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer,
                        String, create_engine)
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./eshady.db")
SECRET_KEY = os.environ.get("ESHADY_SECRET_KEY", "eshady-secret-key-2026")

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
    password: str = Field(..., min_length=8)

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
    alert: bool
    paired_at: datetime
    last_seen: datetime

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


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("index.html", {"request": request})


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
    return templates.TemplateResponse("signup.html", {"request": request})


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.post("/api/users/signup", response_model=UserAuthResponse)
def signup_user(user_in: UserCreate, db: Session = Depends(get_db)) -> UserAuthResponse:
    raise HTTPException(status_code=403, detail="Please sign in with Google.")


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

    if id_info.get("iss") not in ["accounts.google.com", "https://accounts.google.com"]:
        raise HTTPException(status_code=401, detail="Invalid Google issuer.")

    email = id_info.get("email", "").lower()
    if email != "david.e.brin@gmail.com":
        raise HTTPException(status_code=403, detail="Google account not authorized.")

    first_name = id_info.get("given_name", "David")
    last_name = id_info.get("family_name", "Brin")

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        token = create_session_token()
        user = User(
            email=email,
            first_name=first_name.strip().title(),
            last_name=last_name.strip().title(),
            password_hash="",
            token=token,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
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


@app.post("/api/users/login", response_model=UserAuthResponse)
def login_user(user_in: UserLogin, db: Session = Depends(get_db)) -> UserAuthResponse:
    raise HTTPException(status_code=403, detail="Please sign in with Google.")


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
            online=station.online,
            safe_zone=station.safe_zone,
            alert=station.alert,
            paired_at=station.paired_at,
            last_seen=station.last_seen,
        )
        for station in db.query(Station).filter(Station.user_id == current_user.id).order_by(Station.last_seen.desc())
    ]


@app.post("/api/stations", response_model=StationOut)
def create_station(
    station_in: StationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StationOut:
    existing = db.query(Station).filter(Station.device_id == station_in.device_id).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="That station is already paired.")

    station = Station(
        device_id=station_in.device_id.strip().upper(),
        name=station_in.name.strip(),
        location=station_in.location.strip() if station_in.location else None,
        latitude=station_in.latitude or 0.0,
        longitude=station_in.longitude or 0.0,
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
    device_id = telemetry.device_id.strip().upper()
    station = db.query(Station).filter(Station.device_id == device_id).first()
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
            last_seen=datetime.utcnow(),
        )
        db.add(station)
        db.commit()
        db.refresh(station)
    else:
        station.battery_pct = telemetry.battery_pct
        station.charge_w = telemetry.charge_w
        station.temperature = telemetry.temperature
        station.voltage = telemetry.voltage or station.voltage
        station.latitude = telemetry.latitude
        station.longitude = telemetry.longitude
        station.safe_zone = telemetry.safe_zone
        station.alert = telemetry.alert
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
        alert=telemetry.alert,
        safe_zone=telemetry.safe_zone,
    )
    db.add(record)
    db.commit()

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
            online=station.online,
            safe_zone=station.safe_zone,
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
