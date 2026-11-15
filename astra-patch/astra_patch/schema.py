from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4
from pydantic import BaseModel, ConfigDict, Field, model_validator

def utcnow():
    return datetime.now(timezone.utc)

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Configuration(StrictModel):
    astronaut_id: str = Field(min_length=1, max_length=64)
    device_id: str = Field(default='sim-patch-001', min_length=1, max_length=64)
    muscle: str = 'left_quadriceps'
    protocol: str = 'simulated_isometric_v1'
    conditions: str = 'simulated_seated'
    sensor_configuration: str = 'surface-array-v1'
    channels: list[str] = Field(default_factory=lambda: ['E01', 'E02', 'E03', 'E04'], min_length=1, max_length=256)
    emg_sample_rate_hz: int = Field(default=2000, ge=1000, le=4096)
    imu_sample_rate_hz: int = Field(default=100, ge=10, le=200)
    seed: int = Field(default=42, ge=0, le=2**32-1)
    motion_threshold_m_s2: float = Field(default=1.5, gt=0, le=100)
    scheduled_at: datetime | None = None

    @model_validator(mode='after')
    def valid(self):
        if len(set(self.channels)) != len(self.channels):
            raise ValueError('Channel identifiers must be unique')
        if self.scheduled_at and (self.scheduled_at.tzinfo is None or self.scheduled_at.utcoffset().total_seconds() != 0):
            raise ValueError('Schedule must use UTC')
        return self

class Session(StrictModel):
    session_id: UUID = Field(default_factory=uuid4)
    configuration: Configuration
    source_type: Literal['synthetic'] = 'synthetic'
    state: Literal['IDLE', 'ARMED', 'RECORDING', 'PAUSED', 'COMPLETED', 'ERROR'] = 'IDLE'
    trigger: Literal['manual', 'scheduled', 'imu_motion'] | None = None
    permission_to_record: bool = False
    operator: str | None = None
    started_at: datetime | None = None
    events: list[dict] = Field(default_factory=list)

class Recording(StrictModel):
    schema_version: Literal['1.0'] = '1.0'
    session_id: UUID
    source_type: Literal['synthetic', 'research', 'patch']
    subject_id: str
    astronaut_id: str | None
    device_id: str
    muscle: str
    protocol: str
    conditions: str
    sensor_configuration: str
    trigger: str
    started_at: datetime
    emg_sample_rate_hz: float
    imu_sample_rate_hz: float | None
    emg_units: str
    accel_units: str = 'm/s2'
    gyro_units: str = 'rad/s'
    channels: list[str]
    emg: list[list[float | None]]
    emg_time_s: list[float]
    emg_sequence: list[int]
    imu: list[list[float | None]]
    imu_time_s: list[float]
    imu_sequence: list[int]
    quality: dict
    provenance: dict

class Transition(StrictModel):
    action: Literal['arm', 'start', 'motion', 'schedule', 'pause', 'resume', 'complete', 'disconnect']
    operator: str = Field(min_length=2, max_length=100)
    approved: bool = False
    acceleration_m_s2: float = Field(default=0, ge=0, le=100)

class Capture(StrictModel):
    duration_s: float = Field(default=2, ge=1, le=10)
    scenario: Literal['normal', 'drop', 'flatline', 'saturation', 'contact', 'artifact', 'missing'] = 'normal'
